# A-14 agent design

Read-only design consult, 2026-10-22, three parallel subagents (alakazam, ash, oracle) plus a fourth subagent drafting test cases (testplans/A-14-test-cases.md, not reproduced here). Each section below is that agent's full answer, word for word, written originally to its own file (kept alongside this one for traceability).

---

## alakazam (retrieval: query-core functions, geocodePlace, confidence, citations, golden grader)

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

---

## ash (agent runtime: agent.ask, getModel(), limits, conversation state, timeouts, spend cap, AI tab)

# A-14 agent design consult — ash (agent runtime, `agent.ask`)

Scope: the `agent.ask` tRPC procedure, `getModel()`, limits, conversation state, timeout layering, spend cap, outcome taxonomy, Explore · AI tab states. Read-only consult; MCP server internals and `query-core` tool implementation are `oracle`'s and `alakazam`'s areas respectively — this file only specifies the contract `agent.ask` needs from them.

## Components & files touched

- `apps/api/src/agent/ask.ts` — the `agent.ask` tRPC procedure (handler, orchestration loop via `ToolLoopAgent`/Vercel AI SDK `generateText` with `tools`, `stopWhen`/`maxSteps`).
- `apps/api/src/agent/getModel.ts` — provider switch (`AI_PROVIDER=bedrock|gateway`); no provider name anywhere else in `apps/api/src/agent/**`.
- `apps/api/src/agent/budget.ts` — DynamoDB spend-counter read/increment (one on-demand item per UTC day), 80% alarm wiring hook.
- `apps/api/src/agent/conversation.ts` — in-memory-per-request conversation-state shaping (client sends last 4 turns; server does not persist turns server-side — see below).
- `apps/api/src/agent/outcomes.ts` — the typed outcome union and the AbortSignal/timeout plumbing.
- `apps/api/src/agent/tools.ts` — thin adapters wrapping `packages/query-core`'s Zod tool schemas (`geocodePlace`, `searchProperties`, `searchRoofingPermits`, `getProperty`) as Vercel AI SDK `tool()` defs. Not this consult's area to design the SQL, only the adapter shape and step/row budget enforcement.
- `apps/web/src/routes/Explore/AiTab.tsx` (lands once A-13 merges) — Working… / answer / no-results / throttled / paused / timed-out / limit-reached states; this design keeps the `agent.ask` response shape stable so AiTab can be built against it today without the A-13 shell.
- `infra/CountyLensApi` (CDK) — agent Lambda function, DynamoDB spend table, CloudWatch alarm, API Gateway route + stage throttle for `agent.ask`.
- Powertools: `Logger`/`Tracer`/`Metrics` in `apps/api/src/agent/ask.ts`, one log line per tool call with latency, one trace segment per model call.

## `agent.ask` contract

**Request**
```ts
{
  question: string,
  turns: Array<{ role: "user" | "assistant", content: string }>, // last ≤4 turns, client-supplied
  context?: { area?: string, radiusMi?: number, roofYears?: number, openYears?: number, ...editableAssumptions },
  sessionQuestionCount: number, // client-tracked (sessionStorage), 0-based; server rejects if ≥10
}
```
Conversation state is **not** persisted server-side (no DB row per turn) — the client resends the last 4 turns plus any edited "How I read this" chip values as `context` on every call. This matches FR-004 ("remember… across at least the last few turns") without adding a stateful store the spend/lock layers don't already need, and matches AD-09's "one response, no streaming" model: each call is self-contained and idempotent-ish from the server's point of view.

**Response**
```ts
{
  answer: string,
  how: string,                 // "How I read this" prose
  steps: Array<{ tool: string, input: unknown, summary: string }>, // shown all at once (AD-09)
  matches: Array<{             // citation n → row n
    citationIndex: number,
    property_cid: string,
    source_url: string,
    run_id: string,
    captured_at?: string,
  }>,
  query: { area?: string, radiusMi?: number, roofYears?: number, permit?: string, openYears?: number },
  missing: string[],           // plain-language gaps, e.g. "contractor not printed on most permits"
  outcome: "answered" | "failed" | "paused" | "throttled" | "timed_out" | "cancelled",
  message?: string,            // present when outcome !== "answered"; the plain user-facing text
}
```
This matches `docs/02-design.md` § "Explore · AI" exactly (same field names, same outcome enum) and AC-1/AC-2/AC-12. Zod-validate both directions.

## `getModel()` / provider-switch design

```ts
// apps/api/src/agent/getModel.ts
export function getModel() {
  const provider = process.env.AI_PROVIDER; // "bedrock" | "gateway", no default fallback silently assumed
  if (provider === "bedrock") {
    return bedrock(process.env.BEDROCK_MODEL_ID!); // eu.anthropic.claude-sonnet-4-6, eu-north-1 inference profile
  }
  if (provider === "gateway") {
    return gateway(process.env.AI_GATEWAY_MODEL_ID ?? "anthropic/claude-sonnet-4.6");
  }
  throw new Error(`AI_PROVIDER must be "bedrock" or "gateway", got: ${provider}`);
}
```
`ask.ts` calls only `getModel()`; it never imports `@ai-sdk/amazon-bedrock` or the gateway package directly, and never branches on provider itself — satisfies constitution VI and AD-20. The gateway key comes from SSM SecureString (AD-14), read once at cold start, never logged. Switching providers is an env var change in CDK context + redeploy, not a code change — exercised by one of the edge cases (`AI_PROVIDER=gateway` → same answers).

## Limits & how enforced

| Limit | Enforcement |
| --- | --- |
| ≤ 6 tool steps | `ToolLoopAgent`/`generateText` `stopWhen: stepCountIs(6)` (AI SDK v5) or manual step counter incremented in the tool-call loop; once hit, loop exits and the model is asked to finalize with what it has — never silently truncated mid-answer. |
| ≤ 3 model calls | Explicit counter around each `generateText`/`streamText`-less call (no streaming per AD-09); increment before each Bedrock/Gateway invocation; abort the loop and return `outcome: failed` with message if a 4th would be needed. |
| ≤ 1,500 output tokens | `maxOutputTokens: 1500` passed to `getModel()` call options; AI SDK truncation is backstopped by instructing the model (system prompt) to be concise, since a hard token cut mid-sentence would violate "never a partial answer shown as complete" — so the prompt asks for citations+assumptions+missing-data in a bounded format that fits the budget, verified in Stage 0/golden-query evidence, not relied on as the only safety net. |
| ≤ 1,000 rows per tool call | Enforced inside each `query-core`-backed tool adapter in `tools.ts` (`LIMIT 1001`, `truncated` flag if the 1001st row exists), mirroring AD-21's MCP cap so the two surfaces agree (FR-011). |

All four counters are logged per request via Powertools `Metrics` (`toolSteps`, `modelCalls`, `outputTokens`, `durationMs`) so AC-5 (p95 < 20s, step/call/token ceilings) is checkable from CloudWatch without re-running golden queries.

## Conversation-state design

No server-side session store for turns (see contract above) — this keeps `agent.ask` stateless and Lambda-friendly, avoids a second state layer beyond the Chat-SDK-style guidance's general caution against ad hoc state, and avoids needing DynamoDB locking for a single-request-per-call API (there's no concurrent-message-to-one-thread problem here, unlike a chat-platform adapter). "That area" resolution works by:
1. Client includes the last ≤4 turns verbatim in `turns[]`.
2. Client includes the last-used `context` (area, radius, thresholds) as structured state, refreshed from the previous response's `query` field and any edited chips.
3. The system prompt instructs the model: "if the question refers to 'that area' or similar, use `context.area` unless the question names a new place."
4. `geocodePlace` is only called when `context.area` is absent or the question names a new place — this also keeps tool-step budget tight on follow-up turns (AC-2's G2 shouldn't re-geocode).

The 10-question-per-session cap (FR per Assumptions) is tracked client-side in `sessionStorage` and sent as `sessionQuestionCount`; the server independently re-validates nothing beyond honoring `outcome: answered` counting rules — only `answered` counts toward the 10, so a `paused`/`throttled`/`timed_out` call doesn't consume a question. This logic belongs in `AiTab.tsx`, not the server, per `docs/02-design.md` ("the 10-per-session count lives in `sessionStorage`; only `answered` counts").

## Timeout layering implementation

Four layers, outside-in, matching AD-09/AD-27 exactly:
1. **23s server abort** — `AbortSignal.timeout(23_000)` passed into the AI SDK call(s) and into every tool's underlying fetch/query. On abort, `ask.ts` catches the `AbortError`, returns `outcome: "timed_out"`, message "Took too long" with `Try again` / `Use Filters instead` actions, **before** Lambda itself would be killed. This is the layer that actually produces the honest typed outcome.
2. **25s Lambda timeout** — CDK `Function` prop `timeout: Duration.seconds(25)`, matching AD-11/AM-06's envelope for this Lambda (note: AM-06's 15s figure is the *separate* query/explore API Lambda, not this one — `agent.ask` keeps AD-09's 25s). This is the backstop if the 23s abort itself hangs (e.g., a stuck SDK promise); it ensures Lambda never silently runs past the HTTP API ceiling.
3. **25s client-visible stop** — the web client's own request timeout mirrors 25s so the UI shows "Took too long" even if the HTTP response never arrives (covers Lambda cold-start-plus-throttle edge cases where the 23s abort response itself doesn't make it back in time).
4. **29–30s HTTP API ceiling** — API Gateway's hard integration timeout; this is a safety net only, never the layer that should fire in normal operation — if it does, that's a bug in layer 1, worth alarming on separately (a CloudWatch metric filter or Gateway 5xx alarm, flagged as a risk below since AD-16 doesn't explicitly cost this one).

Code shape:
```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 23_000);
try {
  const result = await generateText({ model: getModel(), tools, abortSignal: controller.signal, ... });
  return { ...shapeResponse(result), outcome: "answered" };
} catch (e) {
  if (isAbortError(e)) return { outcome: "timed_out", message: "Took too long", ... };
  if (isThrottleError(e)) return { outcome: "throttled", message: "...", ... };
  throw e; // unexpected — Lambda error, not swallowed as a fake outcome
} finally {
  clearTimeout(timer);
}
```

## Spend-cap + alarm design (CDK resources)

- **DynamoDB table** `CountyLensAiSpend` (on-demand billing, no provisioned capacity — zero idle cost per AD-13): one item per UTC day, key `date` (e.g. `2026-10-22`), attribute `spendCents` (or `callCount` × a fixed per-call cost estimate if real per-token billing isn't queryable in real time — token-based estimate is more honest; use output+input token counts × the Bedrock/Gateway per-token rate for the active provider, summed via a conditional `UpdateItem` with `ADD spendCents :delta`).
- Before each model call, `budget.ts` does a `GetItem` for today's key; if `spendCents >= $3.00 equivalent`, return `outcome: "paused"` immediately without calling the model (never a half-run). After each successful call, `UpdateItem` with the delta.
- **CloudWatch alarm**: a custom metric (`Metrics.addMetric("aiSpendCents", ...)` via Powertools, or an EMF-derived metric from the Lambda logs) compared against 80% of $3.00 ($2.40); alarm action per constitution IX (PagerDuty Events API v2 or documented substitute — likely just an SNS→email given this is a take-home, documented as the substitute).
- `ai.status` tRPC procedure (already in `docs/02-design.md`) reads the same DynamoDB item to return `{ paused, resetsAt }` to the client for a pre-emptive "limit reached" banner, so the UI doesn't have to wait for a failed `agent.ask` call to learn it's paused.
- This is the same DynamoDB-per-UTC-day-item pattern named in `docs/02-design.md` § "Hosted state, $0.00 fixed per month" — no new infra pattern invented.

## Outcome taxonomy and how to trigger each for testing

| Outcome | Trigger condition | How to produce it on the deployed endpoint for real (no fake test data) |
| --- | --- | --- |
| `answered` | Normal path | Any golden query G1–G5 |
| `failed` | Unexpected error (bad tool input rejected by Zod, model returns something unparseable) | Send a malformed `context` object that fails Zod validation server-side (real validation failure, not a mocked one) |
| `paused` | Daily spend cap reached | Drive the real DynamoDB counter to the cap by issuing enough real golden-query calls against the deployed endpoint in one UTC day (document the token math so the count is reproducible and cheap — e.g. run G1–G6 repeatedly until the $3 counter trips), or temporarily lower `AI_DAILY_CAP_CENTS` via an env var for a verification run and restore it after — this is a config change, not synthetic data, and should be logged in the evidence file as "cap temporarily lowered to $0.05 for this verification, restored after" |
| `throttled` | Bedrock's real 10 req/min limit | Fire 11+ real concurrent golden-query requests at the deployed endpoint within one minute; Bedrock's `ThrottlingException` surfaces as `outcome: throttled` — this is a genuine provider throttle, not simulated |
| `timed_out` | 23s abort fires | Ask a real but deliberately broad/slow question (e.g. a countywide multi-filter query forcing more tool steps/larger scans) against the deployed endpoint and let the real 23s abort trip; alternatively, temporarily set the abort to 1s via env var for one verification call (documented the same way as the spend-cap test) then restore — again a config change on real infra, not fabricated output |
| `cancelled` | User clicks Cancel during Working… | Playwright: click the Cancel button shown during the real Working… state on the hosted AI tab |

All of these are triggered by manipulating real config/timing against the live deployed Lambda — never by hand-crafting a fake `outcome` value in a mock, consistent with "no synthetic data presented as real" (CLAUDE.md) and the design-sample-data-not-reviewed memory rule, which is about prototype sample data, not about this kind of real-infra fault injection.

## AI tab states

Mapped 1:1 to prototype screens already named in the story (`ExploreQ-ai`, `ExploreQ-aiworking`, `ExploreQ-aicontractor`, `ExploreQ-aislow`, `ExploreQ-ailimit`, `ExploreQ-aipaused`, `HelperStates`) and to `outcome`:

| UI state | Driven by |
| --- | --- |
| Working… | request in flight; elapsed timer + Cancel button (Cancel = abort the fetch client-side, no server outcome needed, or surfaces as `cancelled` if the server already responded) |
| Answered | `outcome: "answered"` — answer, "How I read this" editable chips, citations [n] ↔ `matches[]` rows |
| No results | `outcome: "answered"` with empty `matches[]` and non-empty `missing[]` (AC-3, AC-4 G6) |
| Throttled | `outcome: "throttled"` |
| Paused | `outcome: "paused"` (daily cap) — also proactively shown from `ai.status` |
| Timed out | `outcome: "timed_out"` — "Took too long", Try again / Use Filters instead |
| Limit reached | client-side `sessionQuestionCount >= 10`, blocks the call before it's even sent |

Because A-13's shell isn't merged yet, this response contract is the thing AiTab.tsx will bind to once it lands — no component code assumed here, only field names and the outcome enum, which already match `docs/02-design.md`'s `Explore · AI` row verbatim.

## Risks

- **Lambda concurrency (flagged per this run's environment check).** The account's `ConcurrentExecutions` **and** `UnreservedConcurrentExecutions` are both 10, account-wide, not per-stack. AD-11 says reserved concurrency only if the account allows it; it does not here — reserving even 3 for `agent.ask` would starve every other Lambda in the account (query/explore API, MCP server, admin, pipeline bridge) down to 7 shared slots, and CDK would need to budget reserved concurrency across *all* functions summing to ≤10, which this account cannot safely do with a single-digit margin. **Recommendation: no reserved concurrency on `agent.ask`** (matches AM-06's existing precedent for the query API Lambda — "no reserved concurrency, account limit 10"). Rely instead on: API Gateway stage throttle (burst/rate limit) in front of `agent.ask`, the DynamoDB spend cap as a cost backstop, and Bedrock's own 10 req/min limit as the natural concurrency ceiling for the only expensive part of this path. Document this as consistent with the existing AM-06 decision rather than a new deviation.
- **Token-budget truncation vs honesty.** A hard `maxOutputTokens` cut could in principle land mid-citation-list; mitigated by prompting for a bounded answer shape and verifying against golden queries, but worth a dedicated test case (ask a maximally broad question and confirm the answer is never truncated mid-sentence/mid-citation).
- **23s abort racing Lambda's 25s.** If the model call's internal retry/backoff ignores `abortSignal` (some SDK paths), the 23s layer could fail to fire cleanly; verify the AI SDK's Bedrock/Gateway providers honor `abortSignal` end-to-end in Stage 0, not assumed.
- **HTTP API 29-30s ceiling firing in practice** would present as a raw Gateway timeout (likely a 503) rather than a typed outcome — this is explicitly supposed to never happen per AD-27, so any real occurrence should alarm, which isn't currently budgeted; flagged for `oracle`/`alakazam`/metagross to confirm whether an extra Gateway-5xx alarm is in scope or accepted as an untested edge.
- **Provider parity edge case.** Gateway fallback requires a paid top-up per CLAUDE.md; the "no visible change in behavior" requirement (edge case) can only be verified once that top-up exists — until then this is config-verified by code inspection (one `getModel()` switch point) rather than a live A/B, which should be stated plainly in evidence rather than implied as fully tested.

## How to verify on the hosted URL

1. **Golden queries G1–G6** (`checks.md` § 7.1) as Vitest against the deployed `agent.ask` endpoint (not localhost) — groundedness (every `property_cid` exists in published data), correctness (≥80% recall vs re-run `query-core` SQL), honesty (assumptions + missing data stated in `answer`/`missing[]`), G6 empty + out-of-scope message. Commit results + trace IDs to `docs/evidence/A-14-agent.md`.
2. **Provider confirmation** — one live call with `AI_PROVIDER=bedrock` showing a real Bedrock trace in LangSmith/Powertools (Bedrock quota is new-account-fresh per CLAUDE.md, so Stage 0 must re-check it with a real call, not assume quota from the support case ticket).
3. **Conversation memory** — run G1 then G2 in the same session (reusing `turns[]` + `context`) and confirm G2's answer references "that area" correctly without a fresh `geocodePlace` tool step (check `steps[]` in the response).
4. **Outcome taxonomy** — exercise `paused`, `throttled`, `timed_out` per the table above against the live endpoint with documented, reversible config changes; capture request/response pairs + the restored config value in the evidence file.
5. **Limits** — confirm via Powertools-logged metrics (`toolSteps`, `modelCalls`, `outputTokens`, `durationMs`) across the G1–G6 run that no call exceeded 6 steps / 3 model calls / 1,500 tokens, and p95 duration < 20s.
6. **Spend cap + alarm** — confirm the DynamoDB daily item increments correctly across the verification run, and that the CloudWatch alarm's 80% threshold is reachable and fires (can be checked by temporarily lowering the cap, as above).
7. **AI tab states** — Playwright against the hosted URL, one test per state (Working…, Answered, No results, Throttled, Paused, Timed out, Limit reached), per `responsive-design-tests`/`smeargle` conventions once A-13's shell lands; until then, contract-level tests (direct `agent.ask` calls asserting `outcome` values) stand in.
8. **Cross-surface agreement (FR-011)** — compare `agent.ask`'s `matches[]` `property_cid`s against the Explore page's `explore.search` result for the same question/run, and against the MCP server's `search_properties` result once `oracle`'s MCP Lambda is live, per AC-8.

---

## oracle (MCP server: six AD-21 tool adapters, transport, auth, limits, stdio)

# Oracle design consult — A-14/A-15 MCP server (AD-21 six fixed tools)

Read-only design consult, story `014-agent-and-mcp`, evaluation point A6. Scope: the six
AD-21 tool adapters, provenance, row cap, empty-result reasons, token check, Origin
allowlist, rate limiting, stdio build, and how CountyLens's own MCP differs from the kit
Elephant MCP 2.0. Grounded against the code actually in this worktree as of 2026-10-22,
not against the story notes alone.

## Components & files touched

New (AD-21: "our own TypeScript server... on a separate Lambda"):

- `apps/mcp/src/server.ts` — builds the `@modelcontextprotocol/sdk` `McpServer`, registers
  exactly the six tools below, shared between the stdio and HTTP transports.
- `apps/mcp/src/tools/{search_properties,list_permits,get_property,get_coverage,list_runs,get_schema}.ts`
  — one adapter per tool, each a thin wrapper that (a) parses input with its Zod schema,
  (b) calls one `query-core` function or `@countylens/contract` constant, (c) binds
  provenance, (d) caps/truncates, (e) returns a typed empty-result reason on no match.
- `apps/mcp/src/engine.ts` — the AD-18 `@duckdb/node-api` binder. See **Risk 3**: this
  should not be a fresh reimplementation; it should be the same binder `apps/api` already
  runs.
- `apps/mcp/src/auth.ts` — SSM SecureString bearer-token check, cold-start cache, fail-fast.
- `apps/mcp/src/origin.ts` — Origin allowlist (wraps the SDK's own DNS-rebinding guard,
  not hand-rolled).
- `apps/mcp/src/handlers/http.ts` — Lambda handler: `POST /mcp` (stateless Streamable
  HTTP) and `GET /health`.
- `apps/mcp/bin/stdio.ts` — local stdio entrypoint (`StdioServerTransport`), same tool
  registrations, same engine module, different transport and manifest resolution (reads
  the local/dev CID copy or `runs/index.json` directly rather than presigned S3 GETs).
- `infra` (wherever the CDK `Api` stack already lives, alongside `apps/api`'s stack): a
  **separate** Lambda + API Gateway route for `/mcp` and `/health`, its own throttle, its
  own SSM `Parameter` resource and scoped IAM read, separate from the tRPC API's Lambda
  (AD-21's point of a separate Lambda is a separate throttle/blast radius — do not fold it
  into `apps/api`'s stack).
- `docs/mcp.md` — Claude Desktop / Claude Code / Inspector setup, bearer-token line.
- `apps/api/src/routers/*` — one new procedure (name TBD, e.g. `mcpTry.callTool`) that the
  Help · MCP page's "Try a tool" button calls; it adds the token **server-side** (AD-10)
  and should call the tool adapter function **in-process**, not re-enter the public
  `/mcp` HTTP route — one fewer network hop, one fewer place the token can leak, and it
  still demonstrates the identical tool output shape. This procedure, and
  `apps/web/src/routes/HelpMcp.tsx` itself, do not exist yet on this branch (A-13 not
  merged into this worktree) — see **Risk 2**.
- `packages/query-core` (owned by alakazam, not oracle) — two missing builders this
  design needs; see the tool table below.

Already present and reused as-is (confirmed by reading the files, not assumed):

- `packages/query-core/src/builders.ts`: `radiusSql`, `roofAgeSql`, `listRoofingPermitsSql`,
  `runSummarySql`, `MAX_ROWS = 1000`, `DEFAULT_LIMIT = 500`.
- `packages/query-core/src/bind-manifest.ts`: `bindManifest`, `BoundRun`, `REQUIRED_TABLES`.
- `packages/query-core/gazetteer/travis-places@1.0.0/index.ts`: `lookup(query)` → `Found
  (place|zcta)` with `point`, `partial_in_travis`, `counties`, `source` (url, file_date,
  sha256) and `gazetteer` (version, sha256), or `OutOfScope`. This **is** `geocodePlace`
  — public, versioned, citable — oracle adds no new geocoder.
- `packages/contract/src/provenance.ts`: `Provenance` — `cid, source_url, captured_at,
  table, table_cid, run_id, manifest_cid, as_of, missing[]` — on every view row already.
- `packages/contract/src/rows.ts`: `PropertyRow`, `RoofingPermitRow`, `ContractorRow`,
  `RunRow` (Zod, generated from `columns.ts`, AD-07 names).
- `packages/contract/src/manifest.ts`: `RunManifestV1.coverage` (`Record<string,
  {count, derivation, note?}>`), `RunsIndexV1` (`runs/index.json`, schema
  `oracle-travis-runs-index.v1`).
- `apps/api/src/engine/duckdb-node.ts` + `s3-read.ts`: the AD-18 engine — `getEngine()`,
  `bindOnce`, `timedQuery`, presigned-GET reads over the AD-02 CID copy, `BIND_TTL_MS`
  re-bind, `MAX_ROWS` cap. This is the engine the MCP Lambda needs, not a new one.
- `apps/api/src/routers/{runs,query}.ts`: the existing `runs.summary`, `query.radius`,
  `query.roofAge` tRPC procedures — today's only consumers of the builders above, and the
  pattern the MCP adapters should mirror (parse Zod → `bindOnce` → `timedQuery`).

## The six tool adapters

All six take their filter fields in the AD-07 column names (story AC-7). None takes raw
SQL (P0-13); none adds a query `query-core` doesn't already define or that alakazam
hasn't agreed to add.

### 1. `search_properties`

```ts
z.object({
  area: z.string().min(1),           // place name or "ZIP 78753" / "78753", via gazetteer.lookup
  radiusMi: z.number().gt(0).max(25),
  roofAgeMinYears: z.number().int().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(1000).default(500),
})
```

Shape needed from `query-core`: nothing new. The adapter calls
`gazetteer.lookup(area)` for the centre point + its `source`/`gazetteer` stamps (cited in
the answer per FR-002), then `roofAgeSql({...point, miles: radiusMi, minYears:
roofAgeMinYears, asOf: bound.asOf, limit})` when `roofAgeMinYears` is given, else
`radiusSql({...point, miles: radiusMi, limit})`. This is exactly AC-8's Pflugerville/5
mi/roof ≥ 15 case and exactly what `query.roofAge`/`query.radius` already run — the
adapter must produce **the same SQL text** those tRPC procedures run (FR-011, FR-007),
so it should import the same builder functions, not a re-derivation of the same logic.

### 2. `list_permits`

```ts
z.object({
  area: z.string().min(1),
  radiusMi: z.number().gt(0).max(25),
  statusClass: z.array(z.enum(["open", "stalled", "closed"])).min(1).optional(),
  limit: z.number().int().min(1).max(1000).default(500),
})
```

Shape needed: **a new builder**, `permitsInAreaSql`, does not exist yet.
`listRoofingPermitsSql()` returns every permit countywide ordered by `permit_number`,
with no radius join and no `statusClass` filter; `radiusSql`/`roofAgeSql` return
`v_property` rows, not permits. AC-9 needs permits inside a radius, filtered by
`status_class`, sorted by `open_days` descending. This needs a join from
`v_roofing_permit` to `v_property`'s geometry on `property_cid`, reusing the same
bbox/haversine helper `builders.ts` already has internal to `radiusSql`/`roofAgeSql` (no
new public export needed — the new function lives in the same file and can call the
existing private `geo()`/`radius()` helpers). **Ask alakazam for**: `permitsInAreaSql(input:
RadiusInput & { statusClass?: StatusClass[] })`, ordered by `open_days DESC NULLS LAST,
cid`, filtered by `status_class IN (...)` when given.

### 3. `get_property`

```ts
z.object({ propertyCid: CidV1 })
```

Shape needed: **a new builder**, `propertyByCidSql`, does not exist yet —
`SELECT * FROM v_property WHERE cid = :propertyCid LIMIT 1`. Nothing in `builders.ts`
does a single-row lookup by CID today.

### 4. `get_coverage`

```ts
z.object({ manifestCid: CidV1.optional() })  // default: the latest entry in runs/index.json
```

Shape needed: none from `query-core`'s SQL side — `coverage` is a manifest JSON field,
not a view. The adapter parses `RunManifestV1.parse(await getManifest(manifestCid))` and
returns `.coverage` **unchanged** (AC-9's "coverage-summary tool returns the published
run's coverage figures unchanged"). No DuckDB bind is needed for this tool at all.

### 5. `list_runs`

```ts
z.object({})
```

Shape needed: a loader for the committed `runs/index.json` (`RunsIndexV1`, schema
`oracle-travis-runs-index.v1`). Today it is a repo-root file (confirmed:
`./runs/index.json`, currently one entry — `travis-202609-permits-20261021t103516z`); no
loader for it exists yet in `apps/api` or `query-core`. Oracle needs to know from
metagross/alakazam where the Lambda reads this from in production (bundled asset, a key
beside the CID copy on S3, or the same CloudFront distribution) before writing the
adapter — this is an open question, not a guess.

### 6. `get_schema`

```ts
z.object({ table: z.enum(["v_property", "v_roofing_permit", "v_contractor", "v_run"]).optional() })
```

Shape needed: none new — `@countylens/contract`'s `VIEWS`/`columns.ts` already carries
the full column catalog (name, kind, nullability, carrier, description) per view, in
AD-07 names. With no `table`, return the four view names; with `table`, return its exact
column list (as `use-elephant-mcp`'s `getAtlasSchema` does for the kit MCP, but over our
own four views instead of Atlas's per-lexicon-class tables).

## Provenance field design

No new design needed: `Provenance` (`packages/contract/src/provenance.ts`) is already on
every `v_property`/`v_roofing_permit`/`v_contractor` row — `cid, source_url, captured_at,
table, table_cid, run_id, manifest_cid, as_of, missing[]`. Every tool response row passes
this object through unchanged; the adapter must not rename, drop, or recompute any of
these fields (AC-8's literal list — `source_url, captured_at, table_cid, run_id,
manifest_cid` — is a subset of what's already there; `table`, `as_of`, and `missing` ride
along for free and should stay). `get_coverage` and `get_schema` are not row-shaped and
carry no per-row provenance, but both outputs should be stamped with the `manifestCid`
(or the gazetteer `sha256`, for `get_schema`'s "what froze these names" story) that
produced them, so a caller can tell which run/version they're reading.

## Row cap / truncation

`MAX_ROWS = 1000` already exists in `query-core` (`builders.ts`). Every row-returning
tool (`search_properties`, `list_permits`) must: (1) clamp `limit` to `[1, 1000]` in its
Zod schema (already true for the existing `radiusSql`/`roofAgeSql` builders' `limit`
field), (2) request `limit + 1` rows or run a separate `COUNT(*)` when the caller needs
the **true total** (the builders today return only the limited rows, no count — the
adapter, not `query-core`, is responsible for deciding truncation and fetching the total,
e.g. a second lightweight `COUNT(*)` query over the same `WHERE`, or asking alakazam to
add a `trueTotal` sibling query), (3) return `{ rows, truncated: boolean, totalMatches:
number }`. **A-11 is not yet merged** on this base, so the only way to exercise AC-10's
real example (2,213 county-wide stalled reroofs on 2026-10-19) is against the full
publish; today's single run (`runs/index.json`) is small. Build and unit-test truncation
against a synthetic over-1,000-row fixture now; defer the real 2,213-row check to when
A-11 lands, and say so explicitly in evidence rather than skip it silently.

## Empty-result reasons

Two typed reasons only (per the task's scope and FR-009/AC-11):

- `not_found` — a well-formed identifier that doesn't exist: `get_property` with a
  `propertyCid` not in `v_property`; `get_coverage` with a `manifestCid` not in
  `runs/index.json`.
- `out_of_scope` — a location outside Travis County: `search_properties`/`list_permits`
  when `gazetteer.lookup(area)` returns `{status: "out_of_scope"}` (this already covers
  AC-11's "a non-Travis ZIP" and the README's ZIP 99999 case, G6, for free — no new
  geocoding logic needed, just surfacing the gazetteer's own typed result).

A **valid area with genuinely zero matches inside the radius** (AC-3's Pflugerville/0-open
case) is not an error and gets no `reason` — it's `{ rows: [], truncated: false,
totalMatches: 0 }`; the honesty requirement is satisfied by the agent/UI stating "zero
found" from `totalMatches`, not by the MCP tool inventing a reason code for a true zero.
Never return an empty **success** with no distinction between "valid, zero matches" and
"invalid request" — the two must be visibly different response shapes (a `reason` field
present vs. absent), per the edge case "never an empty success... never invented rows."

## Token-check design

Cold start (module scope, same lazy-singleton pattern as `getEngine()` in
`duckdb-node.ts`): one `GetParameter` call with `WithDecryption: true` against an SSM
SecureString (AD-10, AD-14 — never Secrets Manager, never a default/fallback value). If
the call throws or returns no value, the Lambda must fail before registering any route —
log a clear, secret-free line ("MCP bearer token not configured") and let every request
500 rather than silently serve with no auth (the edge case this guards against
explicitly). Per-request check: constant-time compare (`crypto.timingSafeEqual` on
fixed-length buffers, never `===`) of the `Authorization: Bearer <token>` header against
the cached value, **before** any Origin check side-effect or engine bind; missing or
wrong token → `401`, nothing executed (AC-11). Cache + rotation: the token is cached for
the Lambda instance's lifetime (no TTL by default, mirroring `BIND_TTL_MS`'s pattern but
simpler since there's no expiring presigned URL involved) — rotating the SSM value takes
effect only on the next cold start. For a short-lived evaluation token this is an
acceptable trade (simpler, fewer moving parts) but it is a real limitation worth a one-
line call-out in the evidence doc; if a tighter rotation story is wanted, add a short
re-fetch TTL (e.g. 5 minutes) — flag this choice for ash/oracle sign-off at Stage 3 rather
than deciding it unilaterally here.

## Origin allowlist

`/mcp` is called by non-browser clients (Claude Desktop, Claude Code, MCP Inspector) and,
indirectly, by the website's own tRPC proxy procedure running server-side in Lambda (no
`Origin` header at all in that path). The website's browser code must never call `/mcp`
directly (AD-10, edge case). So the allowlist should be **empty** — no browser origin is
ever trusted to call `/mcp` directly — using the `@modelcontextprotocol/sdk`'s own
`StreamableHTTPServerTransport` DNS-rebinding/Origin guard (it has a built-in
`allowedOrigins`/rebinding-protection option; pin the exact SDK version before building
and read its option name off that version rather than guessing) rather than hand-rolling
a second Origin check. A request carrying an `Origin` header that isn't on the (empty)
allowlist is rejected before the token check; a request with no `Origin` header (every
real client here) proceeds to the token check.

## Rate limiting & CDK assertions needed

NFR-003 / AC-10: `tools/list` < 500 ms, `tools/call` p95 < 3 s over 20 calls, 5 rps
sustained with burst 10, `429` beyond it. Implement as a **route-level** (not stage-wide)
API Gateway throttle on `/mcp` specifically, separate from the tRPC API's own limits
(AD-21's "separate Lambda... its own throttle"). CDK test assertions to add (Vitest +
`aws-cdk-lib/assertions.Template`, per `apply-engineering-guidelines`'s testing-strategy
rule):

- a `Template.hasResourceProperties` check that the `/mcp` route/stage carries
  `ThrottleSettings: { RateLimit: 5, BurstLimit: 10 }`, and that this is scoped to that
  route, not the whole API (so a change here can't silently loosen the tRPC API's limits
  or vice versa);
- the MCP Lambda is a distinct `AWS::Lambda::Function` logical ID from the tRPC Lambda;
- exactly one `AWS::SSM::Parameter` (type `SecureString`) and an IAM policy statement
  granting that Lambda `ssm:GetParameter` scoped to that parameter's ARN only (no
  wildcard, no Secrets Manager resource at all — AD-14);
- no resource sets `Access-Control-Allow-Origin: '*'` anywhere in the `/mcp` stack
  (guards the Origin-allowlist decision above against an accidental open CORS policy);
- Powertools Logger/Tracer/Metrics wrap the handler (Golden Path non-negotiable #6/#7) and
  emit at least `tool_calls_total` (by tool name), `truncated_total`, `auth_failures_total`
  as business metrics.

PagerDuty critical-failure alerting is a Golden Path non-negotiable in general, but this
is a time-boxed assessment demo with no PagerDuty account in scope per the task guide —
note the gap rather than building a PagerDuty integration nobody asked for.

## stdio build

`apps/mcp/bin/stdio.ts`: the same `server.ts` tool registrations, connected via
`StdioServerTransport` instead of the HTTP transport. It differs from the hosted handler
only in how it resolves "the current run" and "the CID copy": for local dev it can read
`runs/index.json` and the local tables directory directly (no S3 presigning, no SSM — a
local token env var or no auth at all, since stdio has no network exposure), while the
hosted Lambda always goes through SSM + the AD-02 S3/CloudFront copy. `docs/mcp.md` gives
the Claude Desktop/Code config pointing at this local entrypoint for development and at
the hosted `/mcp` + bearer token for the graded demo.

## Which `deploy-open-data-mcp` patterns carry over vs. don't

Carries over (same shape, different content):

- `POST /mcp` (stateless Streamable HTTP) + `GET /health`, with no network synchronization
  performed inside a request — this server has no "sync" step at all (there's no Atlas
  index to resolve); it reads the CID copy / DuckDB bind per request, which is the
  AD-18/AD-02 equivalent of "serve from an already-accepted snapshot, never fetch inside
  the request."
- A bearer token gating `/mcp`, read from configuration, never a browser-visible secret.
- The general shape "every tool response carries its provenance/`source`" — the kit's
  `{state, county, dataGroup, archiveCid, tablesCid, schemaCid, indexCid, syncedAt}` maps
  conceptually onto this server's per-row `Provenance` object plus the manifest/run
  identifiers.
- A stdio build for local MCP clients alongside the hosted HTTP route.

Does not apply here, and must not be copied:

- **No Atlas sync at all.** There is no `ATLAS_IPNS`, no gateway list, no `sync` command,
  and no scheduled reconciliation job — CountyLens's own CID copy (AD-02) is read
  directly by `@duckdb/node-api`; it is not a separate "snapshot" that something else
  populates.
- **No `queryAtlas` / free-form SQL tool.** P0-13 and AD-21 forbid any SQL tool on this
  server; the six tools are the entire fixed surface, and a client sending something that
  looks like a raw SQL string as an argument must be rejected by Zod, not executed (the
  edge case named explicitly in the story).
- **This is not the kit Elephant MCP.** `listAtlasCounties`, `getAtlasDatasetInfo`,
  `getAtlasSchema`, `listAtlasProperties`, `getAtlasProperty`, and the lexicon tools are a
  different server entirely, serving a different index (Atlas, Jackson County FL today),
  and cannot serve Travis until Atlas merges it — confirmed unreachable for this county as
  of 2026-10-15 per the story. Nothing in `apps/mcp` should import from or depend on the
  kit's `@elephant-xyz/mcp` package.
- **Removed Atlas-only tools** (`listAtlasProperties`'s offset paging,
  `getAtlasProperty`'s relationship-walk assembly) have no equivalent need here: `v_property`
  rows are already flat, provenance-stamped rows, not assembled graphs.

## Risks

1. **Query-core gaps block two of the six adapters.** `get_property` and `list_permits`
   need `propertyByCidSql` and `permitsInAreaSql`, neither of which exists in
   `packages/query-core/src/builders.ts` today. This is alakazam's file to change
   (AD-19 ownership); oracle's adapters are blocked on it, not able to work around it by
   writing SQL inline (that would violate "one shared query layer" and FR-011/FR-007's
   agreement-across-surfaces requirement).
2. **A-11 not merged.** Only one small run is published (`runs/index.json` has one entry,
   `travis-202609-permits-20261021t103516z`). AC-10's full-scale truncation check (2,213
   county-wide stalled reroofs) cannot run for real until A-11 merges; build/unit-test
   against a synthetic fixture now and re-run the real check after, per the task's
   explicit instruction — do not claim AC-10 passed on the strength of the synthetic test
   alone.
3. **Engine duplication risk.** `apps/api/src/engine/duckdb-node.ts` plus `s3-read.ts` is
   the only AD-18-compliant binder that exists; it is currently app-local to `apps/api`.
   AD-21 wants `/mcp` on a *separate* Lambda, which means either (a) promoting this engine
   module into a shared package both apps import, or (b) `apps/mcp` quietly growing its
   own copy. (b) directly contradicts AD-19 ("one shared query layer... used by the UI,
   agent and MCP") the moment the two copies drift — recommend (a), coordinated with
   whoever owns `apps/api`'s stack, before Stage 5 build starts.
4. **`v_roofing_permit` has no `status_raw` column in v1.** `columns.ts`'s own gap list
   marks `status_raw` as `no_lexicon_carrier`, with `fallback: "Expired is published as
   improvement_status null → status_class stalled (D-4a)"`. AC-9's example ("status_raw =
   Expired if A-02 found a carrier") is conditional on exactly this; today it has not.
   `list_permits` must surface this via the row's `missing: [{field: "status_raw",
   reason: "no_lexicon_carrier"}]`, never synthesize a status word that isn't published.
5. **Token cache has no rotation TTL by default** (see Token-check design) — acceptable
   for a short evaluation window, but a revoked token stays valid on an already-warm
   Lambda instance until it recycles; call this out in evidence rather than letting it be
   discovered during grading.
6. **`list_runs`'s source file location in production is unconfirmed.** `runs/index.json`
   is a repo-root file today; nothing shows where the Lambda reads it from once hosted
   (bundled asset vs. an S3 key beside the CID copy). Resolve with metagross/alakazam
   before writing the adapter, not by guessing a path.
7. **MCP SDK Origin/DNS-rebinding option name is version-specific.** Pin the
   `@modelcontextprotocol/sdk` version in `plan.md` and read its actual guard API off that
   version rather than off memory of an earlier release.

## How to verify on the hosted `/mcp` URL

1. `GET /health` → `200`, fast, no `Authorization` header needed.
2. MCP Inspector connects to `https://<host>/mcp` with
   `Authorization: Bearer <token from SSM, shared privately>`; `tools/list` returns in
   well under 500 ms and lists exactly the six tools above with Zod-derived schemas in
   AD-07 names (AC-7).
3. `search_properties({area:"Pflugerville", radiusMi:5, roofAgeMinYears:15})` → rows with
   `property_cid` + the full `Provenance` object; cross-check against `query.roofAge`
   (apps/api) for the same `manifestCid` and against the Explore page's own query for AC-8.
4. `list_permits({area:"Pflugerville", radiusMi:5, statusClass:["open","stalled"]})` →
   compare against the Stage-0 re-measured stalled count for the *current* run (the
   3-vs-18 discrepancy in the story notes must be re-measured once, not guessed).
5. `get_coverage({})` → the published manifest's `coverage` object, byte-for-byte, on the
   latest `runs/index.json` entry.
6. `list_runs({})` → one entry matching the committed `runs/index.json` exactly.
7. `get_schema({})` → the four view names; `get_schema({table:"v_roofing_permit"})` → its
   exact AD-07 column list.
8. No token / wrong token on any of the above → `401`, and confirm (via logs/trace) that
   no DuckDB bind or query ran for that request.
9. `get_property` with an unknown `propertyCid`, and `search_properties({area:"99999"})`
   → `not_found` and `out_of_scope` respectively, never fabricated rows (AC-11).
10. 20 consecutive `tools/call`s timed, p95 < 3 s; a short burst above 5 rps/burst 10 gets
    some `429`s.
11. Local stdio build: connect Claude Desktop and Claude Code per `docs/mcp.md`, confirm
    the same six tools; run `donphan` configured to use only this server and save its
    transcript as evidence (AC-12).
12. Explicitly mark the 2,213-row county-wide truncation case as **deferred, not failed**,
    pending A-11, in `docs/evidence/A-14-mcp.md` — do not report AC-10 as fully passed
    before that run exists.

---

## Disagreements

| Topic | alakazam says | ash says | oracle says | story/ARD says | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Agent tools vs MCP tools: same definitions or separate adapters? | Separate thin adapters over the same `query-core` functions and Zod schemas (§ 9 of its report: MCP needs full ≤1,000-row payloads in snake_case fixed by AD-21; the agent needs a ≤25-row citation-indexed projection to stay inside the 1,500-token budget — sharing the tool object would either flood the model or leak agent-only concerns into the public MCP contract) | — (did not address; consumes alakazam's query-core functions as given) | Builds its six adapters directly over query-core functions, consistent with "separate adapters" | ARD AD-19/AD-20: "one shared query layer"; story Merge notes leave this as a Stage 3 question for alakazam + oracle | **Separate thin adapters over the same query-core functions/schemas** (alakazam's recommendation, matching the walkthrough's own default at D-4 in the walkthrough file). No real disagreement among the three; recorded as the agreed design. |
| Is `searchProperties`/`geocodePlace` blocked on A-13 merging? | Yes for true AC-8 parity: these should literally call A-13's `exploreSearchSql`/`resolvePlace` (not reimplement equivalent SQL from `builders.ts`), because reimplementing risks subtle divergence (e.g. the tenure off-by-one it flags in its own risk 6) that would break the "same `property_cid`s" requirement. Proposes sequencing those two functions (and the parity test) after A-13 merges; builds `listPermits`, `getProperty`, `getCoverage`, `listRuns`, `getSchema`, the citation registry and the grader now | Not blocked for the agent runtime itself — its contract (request/response shape, limits, timeouts) is designed to be stable once A-13's AI tab lands, without needing A-13's code now | `get_property`/`list_permits` are blocked on alakazam's new query-core functions existing (not on A-13) — already resolved: alakazam's design (§ 2.2–2.3) defines exactly these (`permits.ts`'s `permitsSql()`, `getProperty`) | Story Merge notes / G4-8 finding (already approved at D-1): A-13 is an implicit dependency; "the AI tab and the demo area need A-13," full build proceeds on A-03's slice otherwise | **No new stop needed — this matches the already-approved G4-8/D-1 decision.** Build tracks S (shared functions minus `searchProperties`/`geocodePlace`), the citation registry and the grader now; sequence `searchProperties`, `geocodePlace` and the AC-8 three-way parity check after A-13 merges (or after a PO decision to merge `013` into `014` early, which none of the three agents recommends on their own). Oracle's "blocked" note is resolved: alakazam's design already supplies the functions oracle's adapters need. |
| AC-1 "roof > 15" vs AC-8 "roof ≥ 15" | Resolves it: use `roof_age_years_min: 15` (≥) for both; floored whole-year roof age makes `> 15` and `≥ 15` equal except on the exact anniversary day, so this is a wording inconsistency, not a real behavior difference. Flags it for the plan to record as a clarification, with the UI chip reading "≥ 15 whole years" | — | — | AC-1 says "roof > 15"; AC-8 says "roof ≥ 15" (verbatim story text) | **Accept alakazam's resolution (≥ 15 for both)** — raised to the user at round R2 (D-3) for confirmation since it touches two frozen ACs' exact wording, even though the practical difference is negligible. |
| Where the DuckDB/CID-copy engine binder should live | — | — | Currently app-local to `apps/api` (`src/engine/duckdb-node.ts` + `s3-read.ts`); AD-21 puts MCP on a separate Lambda, so either promote the binder to a shared package (oracle's recommendation) or let `apps/mcp` grow its own copy (oracle flags this as a direct AD-19 violation risk the moment the two drift) | ARD AD-19: "one shared query layer... used by the UI, agent and MCP" | **Promote the binder to a shared package** (oracle's recommendation; no disagreement, just needs doing before Stage 5 build starts) — record as a plan.md task, not a user stop. |
| "> 15 whole years" vs "15 years" and other roof-age/tenure wording, and the owner-out-of-area filter's real answer | alakazam: `owner_is_out_of_area` is null on every published row (owner mailing ZIP not in the export, per `docs/decisions/0002-lexicon-carriers.md`), so G4 ("owners outside the area") cannot get a positive answer in v1 — the correct, honest answer is `empty_reason: field_not_published` / "can't tell, not_in_export" | — | — | AC-4 (G4, Lakeway) expects the agent to answer the question, not necessarily with matches | **Raised to the user at round R2 (D-3-adjacent)**: confirm that an honest "can't tell, this field isn't published" is the accepted answer to G4, not a defect, since the data genuinely doesn't carry owner-out-of-area information in v1. |

**Not a disagreement, but load-bearing and independently confirmed by this session (not by any of the three agents) before compiling this table:** the Lambda-timeout concern both alakazam (risk 9) and ash (risk 1) raised — AD-27's 23s/25s layering is for the **agent** Lambda; AM-06's 15s is a **different**, already-deployed query-API Lambda (A-03's). Confirmed by reading `docs/architecture-constitution.md` lines 207, 237 and 435 directly: no conflict, agent.ask keeps AD-27's 25s. No stop needed.

