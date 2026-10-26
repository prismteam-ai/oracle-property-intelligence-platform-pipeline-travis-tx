# A-14 design consult: alakazam (retrieval, query-core tool layer, confidence, citations, golden grader)

Read-only consult, 2026-10-22. Sources read: `specs/014-agent-and-mcp/spec.md`, `stories/A-14-agent-and-mcp.md`, `docs/architecture-constitution.md` (AD-05, AD-07, AD-19 to AD-21, AD-24, AD-25, AD-27, AM-04, AM-06, P0-9/11/13), `.specify/memory/constitution.md`, `docs/02-design.md` (D-10 to D-12, Explore · AI, Help · MCP), `../assessment-guide/reference/checks.md` § 7, `packages/query-core` on this branch (`builders.ts`, `views.sql`, `bind-manifest.ts`, gazetteer `travis-places@1.0.0`), `packages/contract/src/columns.ts`, `apps/api/src/routers/{query,runs}.ts`, and branch `013-explorer-and-pages` (A-13, Done but not merged): `query-core/src/explore.ts`, `query-core/src/places.ts`, `apps/api/src/routers/explore.ts`. Skills loaded: `build-rag-systems`, `apply-engineering-guidelines`.

## 0. Use-case classification (why this is RAG, and which kind)

- **Class:** hybrid search over operational data + knowledge Q&A / grounded generation. The corpus is the published `contract/v1` views (`v_property`, `v_roofing_permit`, `v_contractor`, `v_run`) bound to one run manifest. Retrieval is **structured and deterministic**: gazetteer exact-match for places, typed filters over view columns, haversine radius. The model only (1) turns the question into typed tool arguments and (2) writes prose over rows it was handed.
- **No embeddings, no vector index, no OpenSearch.** The kit skill defaults to OpenSearch + Bedrock embeddings, but its own non-negotiable 3 ("do not use embeddings when exact aliases, schema metadata or deterministic rules are available") applies to every field here: places are exact gazetteer names, filters are numeric thresholds on frozen AD-07 columns, permits are exact numbers. A vector index would also bill while idle (constitution A7, P0-19) and would be a second public-data path (A2). The ARD (AD-19, AD-20: "structured retrieval over published tables") wins over the skill default. The skill's "SAM local + Docker OpenSearch replay" becomes **fixture replay over the committed pilot Parquet with `scripts/duckdb-engine.ts`** (same `QueryEngine` interface as the Lambda), then hosted replay. Record this as a Complexity Tracking row in plan.md.
- **No human-review/learning loop.** The agent takes no runtime action (read-only answers), so there is nothing to auto-apply; the "review band" becomes an honest "no answer / ask to clarify" path (§ 4).

## 1. Components and files touched

New or changed, by owner (builder groups in `/speckit-implement`):

| Path | Change | Builder |
| --- | --- | --- |
| `packages/query-core/src/tools/schemas.ts` (new) | Zod input schemas for the six question shapes (§ 2), shared by agent, MCP and the explore router; `AreaInput`, `RunRef`, `ResultEnvelope`, `EmptyReason` | alakazam |
| `packages/query-core/src/tools/functions.ts` (new) | The six functions `searchProperties`, `listPermits`, `getProperty`, `getCoverage`, `listRuns`, `getSchema`, plus `geocodePlace`. Each = validate → build SQL (existing builders) → `engine.all` → map rows → envelope. Takes a `QueryEngine` + `BoundRun` (no driver import, ARD § 4) | alakazam |
| `packages/query-core/src/permits.ts` (new) | `permitsSql()`: permit-level statement over `v_roofing_permit` ⋈ `v_property` (radius optional, `status_class`, min open days, exact `permit_number`, sort by `open_days DESC`), plus its count statement. Reuses `geoSql`, `STATUS_CLASSES`, `DAYS_PER_YEAR` from explore.ts | alakazam |
| `packages/query-core/src/explore.ts` (A-13 file, **additive only**) | Add `roof_unknown` and `owner_area_unknown` to the `summary` statement (as `tenure_unknown` already is). Export `STATUS_CLASSES`. No change to `rows`/`close` | alakazam |
| `packages/query-core/src/places.ts` (A-13 file, additive) | Add `partial_in_travis` and `counties` to `ResolvedPlace` (already on the gazetteer `Found`; A-13 drops them). Needed for the Round Rock edge case | alakazam |
| `packages/query-core/src/index.ts` | Export `tools/*`, `permits.ts` | alakazam |
| `packages/query-core/test/tools.*.test.ts` (new) | Unit + fixture tests (§ 6.1); contract test "agent tool ≡ MCP tool ≡ explore.search" | alakazam |
| `apps/api/src/agent/tools.ts` (new) | Four camelCase AI SDK tools: thin adapters (§ 8) | ash |
| `apps/api/src/agent/citations.ts` (new) | Citation registry and `matches[]` builder (§ 5) | alakazam (logic) + ash (wiring) |
| `apps/api/src/mcp/tools.ts` (new) | Six snake_case MCP tools: thin adapters | oracle |
| `apps/api/src/routers/explore.ts` (A-13) | Unchanged in behaviour; may import `SearchPropertiesInput` pieces later (not required) | — |
| `tests/agent/golden.json`, `tests/agent/golden.test.ts`, `tests/agent/grader.ts` (new) | Golden set + grader against the **deployed** `agent.ask` (§ 6) | alakazam |

Branch dependency: the tool layer calls `exploreSearchSql` / `resolvePlace` from A-13, which are **not on this branch**. Groups that need them (searchProperties, geocodePlace, the parity test) are sequenced after `014` is rebased onto `feature/oracle-pipeline` once A-13 merges. `listPermits`, `getProperty`, `getCoverage`, `listRuns`, `getSchema`, the citation registry and the grader can be built now on A-03's slice. (Merging `013` into `014` early is a PO decision, not mine; see risks.)

## 2. query-core functions

Common shapes (all Zod, in `tools/schemas.ts`):

- `RunRef = z.object({ manifest_cid: CidV1.optional() })`. Omitted → the latest run of `runs/index.json`. The agent pins one `manifest_cid` per conversation (the one the page is showing) so all three surfaces compare on the same run. Every result echoes `run: {run_id, manifest_cid, as_of}`.
- `AreaInput = z.union([ z.object({ place: z.string().trim().min(1).max(100) }).strict(), z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict() ])`. `place` accepts a Census place name (LSAD word optional), a 5-digit ZIP/ZCTA, or a 7-digit GEOID (A-13 `resolvePlace` already accepts all three). Global lat/lon bounds in Zod on purpose: a point outside the Travis box (`EXPLORE_BOUNDS`) must come back as `out_of_scope`, not as a validation error (AC-11).
- **Field names**: the filter fields are the AD-07 column names with an explicit operator suffix (AC-7: "Zod-derived input schemas using the AD-07 column names"). The function maps them onto A-13's `ExploreSearchInput` (URL names `roof`, `openYrs`, `tenure`, `ooa`) and calls the **same** `exploreSearchSql`, so the Explore page keeps its URL names and the three surfaces still run identical SQL.
- `ResultEnvelope<Row> = { rows: Row[], returned: number, total: number, truncated: boolean, empty_reason: EmptyReason | null, unknown_excluded: Record<string, number>, area?: AreaEcho, run: RunEcho, applied: Record<string, unknown> }`
  - `truncated = total > returned`; `total` is the true count from the summary/count statement, never `rows.length`.
  - `EmptyReason = z.enum(["out_of_scope", "not_found", "no_match", "field_not_published", "run_not_found"])`, non-null **iff** `returned === 0`.
  - `unknown_excluded`: per filter, how many rows inside the radius were left out because the filtered field is null (`roof_age_years`, `tenure_years`, `owner_is_out_of_area`). This is what lets an answer say "unknown" instead of "none".
  - `applied`: the exact thresholds after defaults, echoed for the "How I read this" chips (`radius_mi: 5, roof_age_years_min: 15, …`).
  - `AreaEcho = { label, point: {lat, lon}, kind: "place"|"zcta"|"point", id?, partial_in_travis, source: {url, file_date, sha256}, gazetteer: {version, sha256} }`.
- Row cap: `MAX_ROWS = 1000` (existing constant). Default `limit` 50 for MCP; the agent adapter passes 25 (token budget; § 5 explains why recall is still measured on the full set).
- Errors: invalid input → Zod error (adapters turn it into a plain message / MCP `isError`), never a thrown SQL error. Engine failure → typed error `engine_unavailable`; no SQL or stack text leaves the function (same rule as A-13 `EXPLORE_ENGINE_ERROR`).

### 2.1 `searchProperties(engine, run, input) → ResultEnvelope<ExploreRow>`

```
SearchPropertiesInput = RunRef.extend({
  area: AreaInput,
  radius_mi: z.number().min(0.25).max(25),
  roof_age_years_min: z.number().int().min(0).max(120).optional(),     // ≥
  tenure_years_min: z.number().int().min(1).max(100).optional(),       // ≥ ; maps to explore tenure = n − 1 (explore is strict >)
  owner_is_out_of_area: z.literal(true).optional(),
  status_class: z.enum(["open_or_stalled","open","stalled"]).optional(), // property has such a roofing permit
  open_years_min: z.number().min(0).max(60).optional(),                // needs status_class
  sort: z.enum(["nearest","open_desc","roof_desc"]).default("nearest"),
  limit: z.number().int().min(1).max(1000).default(50),
}).strict()
```

- Resolves `area` (§ 3); `out_of_scope` → envelope with `empty_reason: "out_of_scope"`, no SQL run.
- SQL: `exploreSearchSql(...)` `summary` then `rows`; `close` is **not** run (close matches are a UI affordance, and an answer must not cite rows outside the stated radius). Rows mapped with A-13 `toExploreRow` → identical row shape to the Explore page (provenance block + `missing[]`).
- `empty_reason` when 0 rows: `field_not_published` if, for some active filter, `unknown_excluded[field]` equals every row in the radius (today: `owner_is_out_of_area`, because the owner mailing ZIP is not in the export, `UNCARRIED.v_property`); else `no_match`.
- Roof semantics: "older than 15 years" → `roof_age_years_min: 15`. `roof_age_years` is whole years floored to `as_of`, so `≥ 15` is `age ≥ 15.0`; the only difference from `> 15` is the anniversary day. This keeps AC-1 ("roof > 15") and AC-8 ("roof ≥ 15") on **one** number; the `how` chip says "roof age ≥ 15 whole years". Unknown roof ages are excluded (as in Explore) and counted in `unknown_excluded.roof_age_years`.

### 2.2 `listPermits(engine, run, input) → ResultEnvelope<PermitRow>`

```
ListPermitsInput = RunRef.extend({
  area: AreaInput.optional(),                 // omitted = county-wide (AC-10)
  radius_mi: z.number().min(0.25).max(25).optional(),   // required when area is given (refine)
  permit_number: z.string().trim().regex(/^\d{4}-\d{6} [A-Z]{2}$/).optional(), // exact, e.g. "1982-012866 BP"
  status_class: z.enum(["open_or_stalled","open","stalled","closed"]).optional(),
  open_years_min: z.number().min(0).max(60).optional(),
  sort: z.enum(["open_desc","nearest","issue_desc"]).default("open_desc"),
  limit: z.number().int().min(1).max(1000).default(50),
}).strict()
```

- Permit-level (one row per `v_roofing_permit` row), so G2/G3 list permits, not properties. `PermitRow = { permit_cid, permit_number, property_cid, status_class, status_raw: null, improvement_status, issue_date, open_days, open_years, dist_mi?, contractor: { name_as_printed: null, resolution, company_cid }, bbb_status, bbb_status_reason, provenance, missing[] }` (same mapping conventions as `toExploreRow`, including `permit.status_raw` / `contractor.name_as_printed` → `no_lexicon_carrier`).
- Parity rule (tested): for the same area, radius, `status_class` and `open_years_min`, the distinct `property_cid`s of `listPermits` equal the `property_cid`s of `searchProperties` with the same permit filter (no roof/tenure filters). Both use `STATUS_CLASSES` and `open_days >= openYrs × 365.25` from explore.ts.
- `permit_number` given and no row → `not_found`. The regex keeps a raw SQL string out (edge case "free-form SQL argument → Zod rejects it"); every other string field is an enum or the gazetteer key.
- AC-3 behaviour lives in the agent prompt plus this function: `status_class: "open"` with 0 rows → `no_match`; the agent then calls once more with `"stalled"` and labels them "stalled" (and "source says Expired" only when `status_raw` has a carrier; today it does not, so "stalled" alone, AC-3 / A-02 AC-1).

### 2.3 `getProperty(engine, run, input) → ResultEnvelope<PropertyDetail>`

```
GetPropertyInput = RunRef.extend({
  property_cid: CidV1.optional(),
  request_identifier: z.string().trim().regex(/^\d{1,10}$/).optional(),   // TCAD pID as printed (P0-5)
}).strict().refine(exactly one)
```

- Returns 0 or 1 row: the `v_property` row (all AD-07 columns + provenance + `missing`), its roofing permits (`v_roofing_permit` rows, capped 100), and resolved contractors from `v_contractor`. `not_found` when absent from the bound run.

### 2.4 `getCoverage(engine, run) → { coverage, run, derivation_labels }`

- `SELECT run_id, manifest_cid, finished_at, coverage, limitations FROM v_run`. Returns the manifest `coverage` section **unchanged** (AC-9), with its AD-28 `derivation` labels as published. No rows, no truncation. `run_not_found` when the CID is not in the copy.

### 2.5 `listRuns(index: RunsIndexV1, input) → { runs: {run_id, manifest_cid, finished_at}[], latest }`

- Pure function over the committed `runs/index.json` (already Zod-validated by `packages/contract`); the adapter fetches the index. `Input = z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict()`. Newest first.

### 2.6 `getSchema(input) → { views: {name, columns: {name, type, enum?, nullable, meaning, missingReason}[]}[], uncarried, enums, tool_inputs }`

- Pure, no engine: from `@countylens/contract` `VIEWS`, `COLUMN_ENUMS`, `UNCARRIED`, plus the JSON Schema of the six tool inputs (`z.toJSONSchema`). `Input = z.object({ view: z.enum(["v_property","v_roofing_permit","v_contractor","v_run"]).optional() }).strict()`. This is what lets an MCP client learn "owner_mailing_postal_code: not_in_export" without SQL.

### 2.7 Behaviour against today's data (A-03 slice, A-11 not merged)

- Functions take whatever `manifest_cid` `runs/index.json` lists (today one run, `travis-202609-permits-20261021t103516z`, ≈ 37 rows). Nothing in them knows the run size.
- On that slice, G1 near Pflugerville most likely returns 0 rows → `no_match` with the area and thresholds echoed; that is a correct, honest answer and is what the unit/fixture tests assert. The full-county numbers (AC-1 recall, AC-3 stalled count, AC-10 2,213 truncation) are verified only after A-11 merges; the grader reads expectations from the run, not from constants, so no test changes then.

## 3. `geocodePlace` design

- Agent tool `geocodePlace({ query })`, Zod `z.object({ query: z.string().trim().min(1).max(100) }).strict()`. Implementation = A-13 `resolvePlace` over `travis-places@1.0.0` (US Census 2024 Gazetteer), plus `partial_in_travis` and `counties` (additive, § 1).
- Result: `{ status: "found", id, kind, name, point, label, partial_in_travis, counties, source: {url, file_date, sha256}, gazetteer: {version, sha256} }` or `{ status: "out_of_scope", query }`. The `label` is the exact string AC-1 expects: "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116".
- Matching is **exact only** (case-insensitive name, optional LSAD word, ZIP, GEOID). No fuzzy match is ever auto-applied: a misspelling is `out_of_scope` and the agent asks the person to rephrase, optionally listing up to 5 prefix suggestions from `searchPlaces` (labelled as suggestions, not used). Same-name place and CDP → the incorporated place is chosen (existing rule) and the answer names which one.
- `partial_in_travis: true` (Round Rock, Lakeway is not, check per place) → the answer must say "Round Rock city (partly in Williamson County); results are limited to Travis County".
- ZIP 99999 → `out_of_scope` (not in the Travis ZCTA list) → the agent does not call any search tool, `matches = []`, `empty_reason = out_of_scope` (G6).
- `searchProperties` / `listPermits` accept `area.place` directly and resolve it themselves (same `resolvePlace`), echoing `area`. So G1 needs only one tool step; `geocodePlace` is for disambiguation and "that area" checks. This keeps G1/G2 inside ≤ 3 model calls and ≤ 6 tool steps (AC-5). The previous turn's `area.id` (GEOID) is what the conversation context carries for "that area".

## 4. Confidence threshold and honest "no answer" behaviour

There is no similarity score to calibrate, so the threshold is a set of **hard gates**, each deterministic and evaluated by server code, not by the model:

| Gate | Pass | Fail → behaviour |
| --- | --- | --- |
| G-area: place resolution | exact gazetteer hit (confidence 1.0) | `out_of_scope` → zero results, "X is not in Travis County (travis-places@1.0.0)"; never a guessed centre |
| G-args: tool arguments | Zod-valid, thresholds within bounds | plain "I couldn't read the threshold" + no rows; the model may retry once inside the step budget |
| G-filter-known: filtered field is published | `unknown_excluded[f] < in-radius rows` | `field_not_published` → "can't tell: owner mailing address is not in the published export (not_in_export)"; never "none found" |
| G-grounded: every cited CID came from a tool result in this turn | yes | uncited/unknown `[n]` and any CID-looking string not in the registry are stripped from the answer and logged as `ungrounded_citation` (metric); if the answer would be left with claims but no citations, `outcome = failed` with "I couldn't back this answer with records" |
| G-row-confidence: per-row `roof_age_confidence` | `high`/`medium`/`low` included, labelled | `none` (unknown) excluded and counted in `missing` ("12 properties in the radius have no roof date") |

- **Row confidence is shown, not hidden.** `built_year` basis = `low`; the answer groups or tags rows "roof age from built year (low confidence)". Excluding `low` would break recall against the grader's SQL and hide real evidence; labelling satisfies constitution XI.
- **Honest outcomes.** `outcome` stays in the AD-09 enum (`answered | failed | paused | throttled | timed_out | cancelled`); a correct "nothing found / out of scope / can't tell" is `answered` with `matches = []` and `empty_reason` set. Partial results after a timeout are never returned as `answered` (AC-6).
- **Server composes the structured parts.** `how` (centre label + source, radius, thresholds from `applied`), `query`, `matches[]`, `missing[]` and `empty_reason` are built by server code from tool results. The model writes only `answer` prose and chooses tool arguments. That makes groundedness and honesty properties of the code, testable without an LLM.
- **`missing[]`** = union of (a) `unknown_excluded` counts, (b) distinct `missing[].reason` across returned rows with counts (e.g. `contractor.name_as_printed: no_lexicon_carrier ×44`, `bbb_status: not_checked / contractor_unresolved`), (c) `truncated` with the true total, (d) gazetteer partial-county note. Plain-language labels come from `packages/shared` missing-reason labels.
- **BBB (G2, G5):** `bbb_status` is always `not_checked` in v1 with reason `contractor_unresolved` or `no_lexicon_carrier` (AD-25). The answer must say "BBB rating not available: {reason}", never a rating.

## 5. Citation mapping (`matches[]` ↔ rows)

- A per-request **citation registry** in `apps/api/src/agent/citations.ts`. Every row any tool returns in this turn is registered once, keyed by `cid` (property or permit), and gets a stable index `n` in first-seen order. The model sees rows in a compact projection that carries `n` (`{n, property_cid, permit_number?, dist_mi, roof_age_years, roof_age_basis, status_class?, open_years?}`, ≤ 25 per call) and is told to cite as `[n]`.
- `matches[n-1] = { n, property_cid, permit_cid?, permit_number?, source_url, captured_at, table, table_cid, run_id, manifest_cid, as_of, roof_age_years?, roof_age_basis?, roof_age_confidence?, open_days?, status_class?, contractor_resolution?, bbb_status?, bbb_status_reason?, missing[] }`, copied from the tool row's provenance, never from model text. Citation `[n]` in the answer ↔ row `n` in the AI tab (FR-012).
- `matches[]` contains **every row the tools returned that satisfies the final `applied` filters**, not only the ones the prose mentions, so the grader can measure recall on the structured result and the UI can list them. The prose may summarise ("44 stalled permits; the 5 longest-open are [1]–[5]").
- Post-check: regex `\[(\d+)\]` over `answer`; any `n` outside `1..matches.length` is removed and counted (`ungrounded_citation`). Any 59-char `bafy…`/`bafk…` token in `answer` not in the registry is removed the same way.
- Chip edit (5 → 3 years): the client re-sends with an `overrides` object; ash may short-circuit to the query-core function without a model call (deterministic, free) and rebuild `matches[]`; citations update by construction.

## 6. Golden set and grader

### 6.1 Fixture replay (local, before hosted)

- `packages/query-core/test/tools.fixture.test.ts` runs every function over the committed pilot tables with `scripts/duckdb-engine.ts` (the same `QueryEngine` as the Lambda): envelopes, `truncated` at a forced `limit`, each `empty_reason` path, parity agent-input ≡ MCP-input ≡ explore-input (same `property_cid` set), Zod rejection of SQL-looking strings, and `getCoverage` deep-equals the manifest `coverage`.

### 6.2 `tests/agent/golden.json` (hosted)

Each case: `{ id, turns: [{prompt}], expect: { area_id?, radius_mi?, applied: {...}, oracle: {fn, input}, must_mention: [regex], must_flag_missing: [field], empty_reason?, max_steps: 6, max_model_calls: 3, max_output_tokens: 1500 } }`.

| id | oracle (query-core call the grader re-runs) | must |
| --- | --- | --- |
| G1 | `searchProperties({area:{place:"Pflugerville"}, radius_mi:5, roof_age_years_min:15, limit:1000})` | centre label + "Census 2024 Gazetteer"; "5"; "15"; roof-age basis on each match |
| G2 (turn 2 after G1) | `listPermits({area:{place:"<G1 area.id>"}, radius_mi:5, status_class:"open", open_years_min:5})`, then if empty `status_class:"stalled"` | keeps G1 `area.id`; states "≥ 5 years"; "contractor not printed"/identity state; "BBB not available" + reason; if open = 0: "no open roofing permits" and "stalled" label |
| G3 | `listPermits({area:{place:"Manor"}, radius_mi:5, status_class:"open", open_years_min:5, sort:"open_desc"})` | exact thresholds; matches in `open_days` desc order |
| G4 | `searchProperties({area:{place:"Lakeway"}, radius_mi:5, tenure_years_min:10, owner_is_out_of_area:true})` | explains "outside the area" (mailing ZIP outside Travis/regional counties); `empty_reason = field_not_published` today, with "not_in_export" stated |
| G5 | `listPermits({permit_number:"<real number from the bound run>"})` | the permit number; BBB "not available" + reason (or `not_found` on runs without it) |
| G6 | `geocodePlace({query:"ZIP 99999"})` → `out_of_scope` | `matches.length === 0`; text says not in Travis County; no CID in text |

- The G5 permit number and the demo radius are read from the bound run at test start (first stalled permit near the demo area), not hard-coded, so the test is valid on A-03's slice and after A-11. The README example 1982-012866 BP is used when present in the run.
- Default radius for G4 ("near Lakeway") is 5 mi, stated as an assumption; the grader asserts the stated radius equals `applied.radius_mi`.

### 6.3 Grader (`tests/agent/grader.ts`, Vitest against the deployed `agent.ask`)

1. **Groundedness**: every `matches[].property_cid` (and `permit_cid`) exists in the bound run: one `getProperty`/`listPermits` existence check through the hosted MCP or tRPC (never a local DB). 100% required.
2. **Correctness / precision**: every match satisfies the oracle filter (each returned CID is in the oracle result set). 100% required.
3. **Recall**: `|matches ∩ oracle_topN| / |oracle_topN| ≥ 0.80`, with `N = min(oracle.total, 25)` and the oracle ordered by the same sort. When `oracle.total = 0`, recall is defined as pass iff `matches.length = 0`.
4. **Honesty**: `must_mention` regexes (centre label, radius, thresholds) appear in `answer` or `how`; every `must_flag_missing` field appears in `missing[]`; `empty_reason` equals the oracle's when the oracle is empty.
5. **G6**: zero matches and an out-of-scope sentence; any CID-shaped token in `answer` fails.
6. **Budget**: `steps.length ≤ 6`, model calls ≤ 3, output tokens ≤ 1,500, duration recorded; p95 < 20 s over ≥ 3 runs of each case (AC-5), spaced to stay under Bedrock 10 req/min.
7. Writes a results table (case, duration, steps, groundedness, precision, recall, honesty, trace ID, model + provider) to `docs/evidence/A-14-agent.md`.

The same oracle inputs are replayed against the hosted MCP `tools/call` and `explore.search` to produce the AC-8 three-way comparison (same `property_cid` set, same `manifest_cid`).

## 7. Risks

1. **A-13 not merged.** `exploreSearchSql`, `resolvePlace`, `toExploreRow` are on `013-explorer-and-pages` only. Building `searchProperties` before the rebase means duplicating them (forbidden: constitution IV). Mitigation: sequence those tasks after A-13 merges; build the rest now. Merging `013` into `014` early needs a PO decision.
2. **A-11 not merged.** Today's run is a ≈ 37-row permits slice; G1–G5 will mostly return honest empties. Recall/AC-3/AC-10 numbers cannot be proven until A-11; the grader is data-driven so only re-running is needed. G7 for A-14 waits on A-11 (already noted at G4-8).
3. **G4 cannot be answered positively in v1.** `owner_is_out_of_area` is null on every row (owner mailing ZIP not in the export, ADR-0002). The correct answer is "can't tell, not_in_export". Risk is a reviewer reading that as a failure; the evidence must cite `UNCARRIED.v_property`.
4. **"> 15" vs "≥ 15".** AC-1 and AC-8 disagree in wording; this design uses `roof_age_years_min: 15` for both (whole-year floor makes them equal except on the anniversary day). The plan should record it as a clarification so the evaluator sees the chip "≥ 15 whole years".
5. **Field-name mismatch.** Spec says "the same field names the website uses"; AC-7 says AD-07 column names. The website URL uses `roof/openYrs/tenure/ooa`. This design gives MCP/agent the AD-07-based names and maps to the Explore builder inside query-core, so the SQL is shared; the Help · MCP page must show the AD-07 names.
6. **Explore `tenure` is strict `>`.** `tenure_years_min: n` maps to `tenure: n − 1`; an off-by-one there would break AC-8 parity. Covered by the parity test.
7. **Token budget vs recall.** The model sees ≤ 25 rows; `matches[]` holds all filtered rows (≤ 1,000). Recall is measured on `matches[]`, which is server-built, so it does not depend on the model reading every row.
8. **Model paraphrasing numbers.** The prose could misstate a count. Mitigation: `how`/`missing`/counts are server-built; the prompt tells the model to quote `total` and `applied` verbatim; the grader checks numbers in `answer` against `total` where present.
9. **Lambda DuckDB latency at full scale** (AM-04/AM-06: COUNT p95 11.7 s in the browser; Lambda timeout 15 s per AM-06, while AD-27 assumes a 23 s agent abort). Two tool calls at full scale could approach the agent budget. Check that the agent Lambda timeout is 25 s (AD-27), not the 15 s API timeout of AM-06 — this is a metagross/ash decision to confirm in plan.md.

## 8. How to verify on the hosted URL

1. `https://countylens.aldarraj.com/explore?mode=ai` (or the `014-*` Amplify preview): ask G1, then G2; check Working… → answer, "How I read this" chips with the centre label and thresholds, citations `[n]` linked to rows, missing-data list; edit the 5 → 3 chip and see `matches` change.
2. Ask G6: zero rows, out-of-scope sentence.
3. `pnpm vitest run tests/agent` with `AGENT_URL` set to the hosted API (the config throws on localhost): G1–G6 grader, results to `docs/evidence/A-14-agent.md` with trace IDs.
4. MCP Inspector against `https://<api>/mcp` with the bearer token: `tools/list` shows six tools with AD-07 input names (< 500 ms); `search_properties {area:{place:"Pflugerville"}, radius_mi:5, roof_age_years_min:15}` returns the same `property_cid`s as step 1 and as `explore.search` for the same `manifest_cid`; `list_permits {status_class:"stalled", limit:1000}` county-wide shows `truncated` + `total` once A-11 is live; `get_property` with an unknown CID → `not_found`; ZIP 99999 → `out_of_scope`; no token → 401.
5. `donphan` with only the hosted MCP answers the Lakeway question (expected: "can't tell, owner mailing address not in the export", with cited CIDs for the tenure matches); transcript to `docs/evidence/A-14-mcp.md`.

## 9. Same definitions, or separate thin adapters over the same functions?

**Separate thin adapters over the same query-core functions and the same Zod input schemas; not the same tool definitions.** The agreement requirement (FR-011, AC-8, SC-005) is about *which rows match*, and that is guaranteed by both surfaces calling the same function with the same validated input, not by sharing a tool object. The two surfaces genuinely differ above that line: the MCP tools must return full rows up to 1,000 with provenance, use snake_case names fixed by AD-21, and serve clients that see raw JSON; the agent tools must return a compact ≤ 25-row projection with citation indexes to stay inside the 1,500-token / 3-call budget, register every row in the server-side citation registry, and add `geocodePlace`, which has no MCP counterpart. Making the agent call the MCP definitions would either flood the model with 1,000-row payloads or push agent-only concerns (citation numbering, projections) into the public MCP contract. So: query-core owns `SearchPropertiesInput`, `ListPermitsInput`, `GetPropertyInput`, `GetCoverageInput`, `ListRunsInput`, `GetSchemaInput` and the six functions; `apps/api/src/mcp/tools.ts` maps each 1:1 to a snake_case tool (`inputSchema` = the query-core schema, output = the envelope); `apps/api/src/agent/tools.ts` maps `searchProperties`→`searchProperties`, `searchRoofingPermits`→`listPermits`, `getProperty`→`getProperty`, `geocodePlace`→`geocodePlace`, reusing the same schemas (optionally `.pick`/`.omit` of `manifest_cid`, which the agent pins), and adds only projection and citation registration. A parity test in query-core and the hosted three-way comparison catch any drift.
