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
