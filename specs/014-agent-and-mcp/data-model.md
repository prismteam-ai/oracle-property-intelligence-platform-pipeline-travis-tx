# Phase 1 data model: A-14 agent + MCP server

No new persisted entities beyond one DynamoDB counter item — both surfaces are read-only views over the existing published contract (`packages/contract`, unchanged this story). This file names the in-flight shapes that pass between the agent/MCP layer and the shared `query-core` functions, taken from `agent-design.md`.

## ResultEnvelope\<Row\> (query-core, shared by every function)

| Field | Type | Meaning |
| --- | --- | --- |
| `rows` | `Row[]` | the returned rows, ≤ `limit`, ≤ `MAX_ROWS` (1,000) |
| `returned` | `number` | `rows.length` |
| `total` | `number` | true count from the summary/count statement, never `rows.length` |
| `truncated` | `boolean` | `total > returned` |
| `empty_reason` | `"out_of_scope" \| "not_found" \| "no_match" \| "field_not_published" \| "run_not_found" \| null` | non-null **iff** `returned === 0` |
| `unknown_excluded` | `Record<string, number>` | per filtered field, how many in-radius rows were excluded because that field is null |
| `area` | `AreaEcho?` | centre point used, its source and the gazetteer version/digest |
| `run` | `{run_id, manifest_cid, as_of}` | the published run every row is pinned to |
| `applied` | `Record<string, unknown>` | the exact thresholds after defaults, for the "How I read this" chips |

## AreaInput / AreaEcho

- `AreaInput = { place: string } | { lat: number, lon: number }` — `place` accepts a Census place name, a 5-digit ZIP/ZCTA, or a 7-digit GEOID.
- `AreaEcho = { label, point: {lat, lon}, kind: "place"|"zcta"|"point", id?, partial_in_travis, source: {url, file_date, sha256}, gazetteer: {version, sha256} }`.

## The six query-core functions and their inputs (owner: alakazam)

| Function | Input (Zod, `.strict()`) | Returns |
| --- | --- | --- |
| `searchProperties` | `RunRef & {area, radius_mi, roof_age_years_min?, tenure_years_min?, owner_is_out_of_area?, status_class?, open_years_min?, sort, limit}` | `ResultEnvelope<ExploreRow>` |
| `listPermits` | `RunRef & {area?, radius_mi?, permit_number?, status_class?, open_years_min?, sort, limit}` | `ResultEnvelope<PermitRow>` |
| `getProperty` | `RunRef & {property_cid?, request_identifier?}` (exactly one) | `ResultEnvelope<PropertyDetail>` (0 or 1 row) |
| `getCoverage` | `RunRef` | `{coverage, run, derivation_labels}` — manifest `coverage` section unchanged |
| `listRuns` | `{limit}` | `{runs: {run_id, manifest_cid, finished_at}[], latest}` |
| `getSchema` | `{view?}` | `{views, uncarried, enums, tool_inputs}` |
| `geocodePlace` | `{query}` | `{status:"found", id, kind, name, point, label, partial_in_travis, counties, source, gazetteer} \| {status:"out_of_scope", query}` |

## ExploreRow / PermitRow / PropertyDetail (row shapes)

- **ExploreRow**: all AD-07 property columns + `roof_age_years`, `roof_age_basis` (`permit_date`|`built_year`), `roof_age_confidence` (`high`|`medium`|`low`), `dist_mi`, `provenance` (`source_url, captured_at, table, table_cid, run_id, manifest_cid, as_of`), `missing: {field, reason}[]`.
- **PermitRow**: `permit_cid, permit_number, property_cid, status_class, status_raw, improvement_status, issue_date, open_days, open_years, dist_mi?, contractor: {name_as_printed, resolution, company_cid}, bbb_status, bbb_status_reason, provenance, missing[]`. `status_raw` and `contractor.name_as_printed` are `null` with a `missing[]` entry (`reason: "no_lexicon_carrier"`) when the source doesn't carry that field — never synthesized.
- **PropertyDetail**: the `ExploreRow` fields plus its roofing permits (≤100, `PermitRow[]`) and resolved contractors.

## agent.ask contract (owner: ash)

**Request**: `{ prompt: string, turns?: {prompt, outcome}[] (≤4), overrides?: Record<string, unknown>, manifest_cid?: CidV1 }`

**Response**: `{ answer: string, how: string, steps: {tool, input, summary}[], matches: Match[], query: Record<string, unknown>, missing: {field, reason}[], outcome: "answered"|"failed"|"paused"|"throttled"|"timed_out"|"cancelled" }`

`Match = { n, property_cid, permit_cid?, permit_number?, source_url, captured_at, table, table_cid, run_id, manifest_cid, as_of, roof_age_years?, roof_age_basis?, roof_age_confidence?, open_days?, status_class?, contractor_resolution?, bbb_status?, bbb_status_reason?, missing: {field,reason}[] }` — copied verbatim from the tool row's provenance, never from model text.

## The six MCP tools (owner: oracle, AD-21 fixed names)

`search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema` — each a snake_case adapter whose `inputSchema` **is** (not re-derives) the corresponding query-core Zod schema, and whose output is the function's `ResultEnvelope` unchanged (full rows, ≤1,000, with provenance). See `contracts/mcp-tools.md`.

## Spend counter (new persisted entity)

`SpendCounter = { pk: "SPEND#<utc-date>", spent_usd: number, model_calls: number, alarmed: boolean }` — one on-demand DynamoDB item per UTC day, read before each model call (pre-empt to `paused` if `spent_usd ≥ 3`), incremented after. No TTL needed (one row per day, tiny; cost is in on-demand request units, not storage).

## Outcome taxonomy

`answered | failed | paused | throttled | timed_out | cancelled` — exactly the AD-09 enum. A correct "nothing found" / "out of scope" / "can't tell" answer is `answered` with `matches = []` and `empty_reason` set; it is never `failed`. A partial answer after any timeout layer fires is never returned as `answered`.
