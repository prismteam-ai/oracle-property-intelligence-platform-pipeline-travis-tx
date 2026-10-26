# Research: A-13 Explorer UI and pages

All decisions follow [agent-design.md](agent-design.md) (metagross) and the PO decisions in [run-log.md](run-log.md). No NEEDS CLARIFICATION remains.

## R1 · Where Explore searches run
- **Decision:** every Filters search (radius, roof age, open permits, tenure, out-of-area, Close matches, the live radius change with a 250 ms debounce) calls the additive tRPC procedure `explore.search` on the Lambda DuckDB; the SQL panel alone runs DuckDB-WASM in the browser. Engine lines: "DuckDB on the server · same views" (Filters), "DuckDB-WASM in your browser · read-only" (SQL).
- **Rationale:** ARD AM-04/AM-06 (full-scale browser COUNT measured p95 11.7 s); P0-13 keeps free-form SQL in the browser.
- **Alternatives:** browser for small runs, Lambda for large (rejected: two engines, no demo gain); browser only (rejected by AM-06). **AC-6 wording confirmed by the PO at R3.**

## R2 · DuckDB-WASM loading and the bundle
- **Decision:** dynamic `import()` of `engine/duckdb-wasm` only on `?mode=sql`; engine chunk names contain "duckdb" so `scripts/bundle-size.ts` excludes them; `query-core` gets subpath exports and `sideEffects:false`; Hub imports only `RunsIndexV1`. Playwright asserts 0 `duckdb|.wasm` requests on `/`.
- **Alternatives:** prefetch on every route (rejected: LCP on the Hub).

## R3 · Verify through Pinata and Filebase
- **Decision:** simple CORS GET (`credentials:"omit"`, no Range, no custom headers), 30 s timeout per lane, SHA-256 with WebCrypto, compare size and digest with the manifest (and the multihash for raw CIDs). Readable 429 → "rate-limited, retrying" (honour `Retry-After`); unreadable network error → "no readable response (rate-limited or blocked), retrying"; backoff 2/4/8 s, 3 tries; ✓ only on a matching digest. Never the CID copy. Directory or > 50 MB → "Verify via CAR".
- **Rationale:** AM-01; Pinata's preflight lacks `Access-Control-Allow-Headers`; Filebase's 429 lacks CORS (ERR-15).

## R4 · Catalog columns
- **Decision:** read each table part's Parquet footer by Range from the CID copy with `hyparquet` 1.31.2 (pure JS, MIT, no dependencies, lazy chunk on `/data/catalog` only); columns, types and rows summed per table, labelled "rows in the published file"; `published_rows` shown beside it where a coverage key maps to the table; if the manifest lists a `tables-export.json` artifact later, its columns are used.
- **Alternatives:** `contract/v1/columns.json` (not a published file), DuckDB `DESCRIBE` (breaks Catalog LCP), a hand-written Thrift parser (fallback only).

## R5 · Run events (Runs · Log)
- **Decision:** events = each manifest's `startedAt`, every `sources[].captured_at` (with source name), and `finishedAt` with the run's limitations; plus any optional `events` list a future contract adds. Time-ordered across all manifests in `runs/index.json`.
- **Rationale:** spec clarification; a manifest cannot contain its own publish/verify time (CID fixed before upload). `RunManifestV1` is strict, so A-11 must ship any new key in `packages/contract` and the web first.

## R6 · Hub links and CRM switch
- **Decision:** CDK context → Amplify variables `CRM_URL`, `DEMO_VIDEO_URL`, `PR_URL` (empty by default) → `amplify.yml` writes `public/site-links.json` → the Hub Zod-validates (https only); empty or invalid = hidden, CRM card stays "Coming soon · Not deployed yet". Switching = Web-stack deploy + Amplify rebuild, no code change (FR-020, D-6).

## R7 · Coming soon skeleton and county selector
- **Decision:** new `ComingSoonSkeleton` (Atlas `surface-container-highest` blocks, fixed heights, `aria-hidden`, no animation, no text nodes) — the existing `Skeleton` pulses and has loading semantics. County selector: Travis only selectable; any other choice shows "CountyLens has data for Travis County, TX only" inline.

## R8 · No-sample-data scan
- **Decision:** denylist `tests/e2e/fixtures/prototype-placeholders.json` (curated strings: "SAMPLE, JORDAN A", "128 within 5 mi", "Run 4", "38.2 MB", "not wired", ProtoBar selectors) plus CID-shaped tokens extracted from `design/prototype/**` at test time; allowlist = union of manifest CID, `previousManifestCid`, `artifacts[].cid`, `carCid` over every manifest in the hosted `runs/index.json`. Every CID-shaped token in text, `data-cid`, `title`, `href` (full or `{4}…{4}`) must match the allowlist. Routes from `route-list.ts` + each Coming soon item.

## R9 · Web vitals on mobile 4G
- **Decision:** Lighthouse mobile profile (150 ms RTT, 1.6 Mbps, 4× CPU, 390 px) via CDP throttling + `PerformanceObserver`, median of 5; Hub graph ≤ 150 KB gzipped; CLS guards: fixed-size chip skeleton, `.icon {width:1em;height:1em;overflow:hidden}`, card min-heights, nothing injected above the fold.

## R10 · Coverage denominators
- **Decision:** read only from the manifest (PO D-4). Proposed A-11 input: coverage keys `source_total:{source}` with `derivation: capture_receipt` and time from `sources[].captured_at`. Until then each row shows "denominator not in this run's manifest · A-01 source {name}". Unknown coverage keys are tolerated, never thrown on.

## R11 · A-03 TC-061
- **Decision:** choose the evidence file from the deployed `build.json.branch` (`/^(\d{3})-/` → `docs/evidence/A-{NN}.md`); `test.skip` with a reason on `feature/oracle-pipeline` or a non-story branch. On `013-explorer-and-pages` it checks `docs/evidence/A-13.md` (fails until written, by design).
