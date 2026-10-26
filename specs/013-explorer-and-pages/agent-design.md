# A-13 agent design

**Design agent:** `soofi-xyz-team-kit:metagross` (read-only), 2026-10-21, with skills build-frontend-backends, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines. The answer below is saved word for word; the Disagreements table and PO decisions follow it.

---

## metagross answer

I read the spec, story, ARD §§ 7, 9, 10, 12, 15, 16, 02-design §§ 1–3, ADR-0001 and the manifest contract, and checked the fact sheet against the code. I wrote, deployed and committed nothing.

### Components and files

**No contract change is needed.** `RunManifestV1` is `.strict()` (`packages/contract/src/manifest.ts:82`), so a new top-level manifest key, such as `events`, would make the deployed web reject every manifest. Any key A-11 adds must ship in `contract` and the web first.

- **query-core**
  - `exploreSearchSql(input)`: one builder for area, radius, roof, permit, openYrs, tenure, ooa, sort and limit. It returns `total_within_r`, the rows, `tenure_unknown` and close matches.
  - `resolvePlace(text)`: reads the gazetteer.
  - Subpath exports `./gazetteer` and `./builders`, plus `"sideEffects": false`. Today `exports` is only `./src/index.ts`, and that barrel pulls in `VIEWS_SQL`, the profile and the gazetteer.
- **api**: `routers/explore.ts` with `explore.search` (Zod-bounded, ≤ 1,000 rows, `as_of` from the bound run), registered additively in `routers/index.ts`.
- **shared**: the new fixed texts (Verify lanes, Explore header, Coming soon sentences, county message), so tests import them and never retype them.
- **web data modules**: `verify-lane.ts`, `parquet-meta.ts`, `run-events.ts`, `run-chain.ts`, `coverage-rows.ts`, `site-links.ts`.
- **web routes**: Hub (`/`), Runs (extended), RunsCompare, RunsLog, Coverage, DataManifest, DataVerify, DataCatalog, Explore (Filters, SQL, Property drawer), HelpMcp, Legal ×3, ComingSoon.
  - `/permits` stays, because A-03 TC-012 uses it.
  - A route list is kept as plain data (`routes/route-list.ts`), and the e2e scan reads it.
- **Shell**: destinations Explore, Runs, Coverage, Data and More (Coming soon items go in More). The app-bar title links to the Hub.
- **Tests to update in the same commit**: `app-shell.test.tsx` (it expects `/` → `/runs` and two links) and TC-014 step 4 (it clicks "Permits").
- **infra**: `web-stack.ts` gets `VITE_PINATA_GATEWAY_HOST`, plus the link variables (Q4).

### Answers

**1. DuckDB lazy-loading.**
- Only the SQL panel (`?mode=sql`) runs `import("../engine/duckdb-wasm")`, when it is first opened.
- Filters run on Lambda (Q8), so Filters, the Hub and every content page never touch it. An idle prefetch is allowed on the Explore route only.
- `fetch-by-cid` imports `rawCid` from the query-core barrel, so the Hub must not import it. It reads `/runs/index.json` with `RunsIndexV1` only.
- `scripts/bundle-size.ts` sums all `assets/*.js` except files named `duckdb`. Make the engine chunk's file name contain "duckdb" (the adapter already does).
- Add a Playwright check: on `/`, 0 requests matching `/duckdb|\.wasm/`, and the JS transferred is ≤ 300 KB gzipped (aim for ≤ 150 KB, Q7).

**2. Procedures.**
- The Hub chip uses no procedure: same-origin `runs/index.json`, {n} = 1-based position by `finishedAt`.
- The Catalog and the Runs log read published files directly (index plus manifests by CID through `fetch-by-cid`).
- Manifest, Compare and Coverage are also direct reads.
- `meta.latest`, `manifest.get`, `schema.get`, `runs.events` and `search.suggest` are not needed now. Places resolve in the browser from the 31-row gazetteer; address search is not possible while addresses are `not_in_export`, and owner/contractor name search is cut.
- The only new procedure is `explore.search` (additive).

**3. Run events.** I agree with the clarification: `startedAt`, each `sources[].captured_at` with its source, and `finishedAt` with its limitations.
- Publish and verify times cannot be inside their own manifest, because the CID is fixed before upload. They would have to come from the next run or a release asset.
- Simplest: A-11 adds no `events` key. If it ever does, it must be optional in `contract` and deployed first.

**4. CRM, Watch demo and PR links.**
- The Web stack gets three Amplify variables, `CRM_URL`, `DEMO_VIDEO_URL` and `PR_URL`, from cdk.json context, empty by default.
- `amplify.yml` writes `public/site-links.json` next to `build.json` (not inlined into the JS).
- The Hub fetches it and Zod-checks it (https only). Empty or invalid means hidden, and the CRM card stays "Coming soon".
- To switch: a Web-stack deploy plus an Amplify rebuild. That is a config change, not a code change.

**5. Coming soon.**
- The existing `Skeleton` cannot be reused: it pulses and is `role=status aria-busy` (loading semantics).
- New `ComingSoonSkeleton`: blocks drawn with `surface-container-highest`, `aria-hidden`, no animation, no text nodes inside, fixed heights.
- Outside it: a "Coming soon" label and one sentence.
- The county selector lists only Travis as selectable. Choosing another county shows "CountyLens has data for Travis County, TX only" inline, with no navigation and no numbers.

**6. No-sample-data scan.**
- **Denylist**: a reviewed file `tests/e2e/fixtures/prototype-placeholders.json`. It holds curated strings from HANDOFF and the review log ("SAMPLE, JORDAN A", "128 within 5 mi", "Run 4", "38.2 MB", "not wired", ProtoBar selectors, the `person` table) plus every CID-shaped token pulled from `design/prototype/**` when the test runs. Those are truncated, for example `bafybeigr7…`.
- **Allowlist**: at runtime, the union over all manifests in the hosted `runs/index.json` of the manifest CID, `previousManifestCid`, `artifacts[].cid` and `carCid`.
- Every CID-shaped token in rendered text, `data-cid`, `title` and `href`, full or `{4}…{4}`, must match an allowed CID by prefix and suffix.
- Routes come from `route-list.ts` plus each Coming soon item.

**7. LCP < 2.5 s and CLS < 0.1.** Measure with Lighthouse's mobile profile: 150 ms RTT, 1.6 Mbps, 4× CPU, 390 px. Use CDP throttling plus `PerformanceObserver`, take the median of 5 runs, and write the profile into the evidence. At 1.6 Mbps, 300 KB is about 1.5 s, so the budget is tight.
- Keep the Hub in the entry chunk or `modulepreload` it, and keep its graph ≤ 150 KB gzipped.
- Fonts already use `display=swap`.
- **CLS fixes**:
  - Reserve the chip's box with a static skeleton of fixed size.
  - Icons render the ligature through `attr(data-icon)`, so the word shows until the font loads. Give `.icon` `width:1em; height:1em; overflow:hidden`.
  - Cards get fixed minimum heights.
  - No content injected above the fold after data arrives.

**8. Browser vs Lambda.** This needs a PO wording decision (amend AC-6).
- All Filters searches go to Lambda `explore.search` (AM-04 and AM-06), including the live radius change (250 ms debounce).
- SQL stays browser-only (P0-13).
- The engine line reads "DuckDB on the server · same views" for Filters and "DuckDB-WASM in your browser · read-only" for SQL.
- **What AC-6 measures on the hosted page**:
  - **First load**: navigate to `/tx/travis/explore?place=…&r=5&roof=15` until the header count shows: ≤ 8 s, with the progress bar seen.
  - **Searches**: 20 runs each of radius + roof and open-permit, timed from the input change to the updated header: p95 < 3 s, whatever the engine.
  - **SQL panel**: one run of `SELECT count(*) FROM v_property`. No p95 claim, because that view joins tables and AM-06 measured 11.7 s at full scale.
- A size-based dual engine is rejected: more code for no demo benefit.

**9. Verify with plain GETs.**
- Make a "simple" CORS request: `fetch(url, {credentials:"omit"})` with no Range, no custom header and no non-safelisted `Accept`. Pinata answers GETs with `ACAO *` and never sees a preflight.
- Hash with `crypto.subtle.digest("SHA-256", buffer)`. Compare it with the manifest's size and `sha256`, and with the CID multihash for raw CIDs.
- Allow a 30 s timeout per lane (Pinata takes about 4.5 s per request).
- Filebase sends its 429 without CORS (ERR-15), so the browser sees a `TypeError`, not a status. Treat a readable 429 as "rate-limited, retrying" (honour `Retry-After` if it is exposed). Show a `TypeError` as "no readable response (rate-limited or blocked), retrying". Back off 2, 4 and 8 s, at most 3 tries; ✓ only when the digest matches.
- Never use the CID copy.
- In tests, `page.route` serves a 429 with ACAO for a deterministic case.

**10. Catalog columns.** This is feasible without DuckDB.
- Use `hyparquet` (pure JS, version pinned, lazy chunk on the Catalog page) to read the Parquet footer by Range from the CID copy. CloudFront supports Range with CORS.
- That gives columns, types and `num_rows` per part, summed per table.
- Label it "rows in the published file". Show `published_rows` beside it only where a coverage key maps to that table.
- Each CID links to Verify. A footer read cannot check the CID itself.
- Alternatives:
  - `contract/v1/columns.json`: these are view columns and not a published file. Reject.
  - DuckDB `DESCRIBE`: breaks the Catalog's LCP target. Reject.
  - A hand-written Thrift footer parser: about 150 lines. Fallback only.

**11. Coverage denominators.** Recommend A-11 publishes them as ordinary coverage keys with `derivation: capture_receipt` (AD-04 allows "capture-time source totals").
- Example keys: `source_total:tcad-2026-certified-json`, `source_total:austin-3syk-w9eu`, `source_total:comptroller-9cir-efmm-227`.
- Collection time comes from the matching `sources[].captured_at`.
- No schema change is needed, because `coverage` is a record.
- Static dated text from A-01 is weaker: it is not from the run and it breaks FR-002.
- Until then, show "denominator not in this run's manifest · A-01 source {name}", with no number.
- Check that Runs and Coverage treat an unknown coverage key gracefully rather than throwing.

**12. A-03 TC-061.** It hard-codes `docs/evidence/A-03.md`, which names A-03's branch URL and build, so it fails on every other runtime. Smallest correct fix:
- Pick the evidence file from the deployed `build.json.branch`: `/^(\d{3})-/` gives `docs/evidence/A-{NN}.md`.
- `test.skip` with a reason on `feature/oracle-pipeline`, or when the branch matches no story.
- The check itself stays the same. On `013-explorer-and-pages` it checks the A-13 evidence, and fails until that is written, which is intended.

**13. Builder groups.** No file is owned by two groups. G1 lands first; G2, G3 and G4 then run in parallel.

| Group | Files it owns | Time |
| --- | --- | --- |
| **G1 Data and query layer** | `packages/query-core/**` (builder, `resolvePlace`, exports), `apps/api/src/routers/{explore,index}.ts`, `packages/shared/**`, `apps/web/src/data/*` (new modules), `App.tsx`, `AppShell.*`, `routes/route-list.ts`, `app-shell.test.tsx`, and their unit tests | ~100 min |
| **G2 Explorer pages** | `routes/{Runs,RunsCompare,Coverage,DataManifest,DataVerify,Explore*,PropertyDrawer,HelpMcp}*`, Explore components (FilterSheet, ResultRow, PermitChip, ContractorBadge, VerifyLane), and their unit tests | ~150 min |
| **G3 Content pages** | `routes/{Hub,DataCatalog,RunsLog,Legal*,ComingSoon}*`, `components/ComingSoonSkeleton*`, `apps/web/src/content/legal.ts`, and their unit tests | ~90 min |
| **G4 Tests and infra** | `tests/e2e/**` (D-1 to D-9, pages, scan, web-vitals, the TC-061 and TC-014 fixes), `tests/e2e/fixtures/prototype-placeholders.json`, `infra/src/web-stack.ts`, `infra/test/**`, `amplify.yml`, `scripts/bundle-size.ts` (initial-graph check) | ~100 min |

### Risks

- **Two laptop deploys** need PO approval (AM-08): CountyLensApi for `explore.search`, and CountyLensWeb for the Pinata and link variables. All Amplify previews share one API, which is fine because the change is additive.
- **Thin data**: 35 permits, so Pflugerville results are likely 0 rows. Close matches and the empty texts must carry the demo honestly. Addresses are `not_in_export` and `owner_area_class` is always `unknown`.
- **BBB label**: the views emit `not_checked`, while the catalog says `blocked`. Show the view value with its reason; do not relabel it.
- **Bundle gate**: it counts every route chunk, so new routes and hyparquet press on 300 KB.
- **Strict manifest schema**: any A-11 key addition must ship in the contract and web first.
- **Story text** still names ipfs.io and dweb.link in places: amend it to Pinata and Filebase.

### Hosted verification

- Run on `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com` once `/build.json` shows the commit SHA, with `RUNTIME_URL` set to that URL.
- **Playwright**: D-1 to D-9; every route and Coming soon item renders; the scan finds 0 placeholders.
- **Network checks**: Verify requests go to `gateway.pinata.cloud` and `ipfs.filebase.io` only, never the copy. Filters calls `/api/trpc/explore.search`. Only SQL loads the duckdb assets, and `/` loads none.
- **Web vitals**: under the throttled mobile profile; record the 20-run p95 in `docs/evidence/A-13.md`.
- **Responsive**: `smeargle` at 390, 768 and 1440.
- The A-11-dependent proofs wait for A-11: 3 runs, Compare, full-county coverage and the AC-6 scale test.

---

## Disagreements (metagross vs the approved docs) and decisions

PO pre-approved rule for D-5 (2026-10-21, "i approve your recommendations"): the ARD and `02-design.md` win on what; metagross wins on how within them. Items that change an AC's meaning go back to the PO.

| # | Topic | metagross says | ARD / 02-design / story says | Recommendation · decision |
| --- | --- | --- | --- | --- |
| 1 | Explore Filters engine | every Filters search runs on the server-side DuckDB (`explore.search`, Lambda); only SQL runs in the browser | AC-6 "full-county tables loaded in the browser … p95 < 3 s"; ARD AM-04/AM-06 move radius, roof-age and COUNT to the Lambda at full scale | ARD wins (AM-06). **Changes AC-6's wording → PO confirms at R3.** Plan proceeds on AM-06 |
| 2 | `search.suggest`, `meta.latest`, `manifest.get`, `schema.get` | not needed: places resolve in the browser from the 31-row gazetteer; pages read published files directly | 02-design § 2 lists them; walkthrough mentions `search.suggest` | How, within the ARD → metagross. Same data, fewer moving parts; D-1 "via `meta.latest`" becomes a direct read of `runs/index.json` |
| 3 | Run events | none added by A-11; events = manifest timestamps | 02-design § 2: inside the manifest or a release asset | Agrees with spec clarification. No change |
| 4 | Catalog columns | read Parquet footers with a pinned pure-JS reader (lazy chunk) from the CID copy | AC-10 says "columns from `tables-export.json`" | Spec clarification already allows the files' schema while the export is unpublished. How → metagross |
| 5 | Coverage denominators | A-11 publishes `source_total:*` coverage keys; until then "denominator not in this run's manifest · A-01 source {name}" | AD-04 counts from the manifest | Matches PO D-4. Recorded as an A-11 input |
| 6 | Verify retries | Filebase 429 without CORS appears as a network error; label "no readable response (rate-limited or blocked), retrying" | AC-7: "rate-limited, retrying" | Readable 429 keeps the AC string; the second label covers an unreadable response. No change of meaning |
| 7 | BBB label | show the view value `not_checked` with its reason, not "blocked" | AC-7 example "BBB status `blocked`" | Data honesty (XI) wins: the reason follows the published value. Example list unchanged |
| 8 | TC-061 | pick evidence file by deployed branch; skip on `feature/oracle-pipeline` | A-03 G6-approved test | PO-approved fix (R2) |
| 9 | Deploys | CountyLensApi (new procedure) and CountyLensWeb (Pinata + link variables) from the laptop | AM-08 | Asked at D-13 (R4) |
