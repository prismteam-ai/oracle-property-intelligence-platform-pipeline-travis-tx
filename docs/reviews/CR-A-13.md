---
id: CR-A-13
type: code-review-log
story: A-13
branch: 013-explorer-and-pages
reviewed_commit: 70561ec (all three reviews on the whole branch after wave 3); fixes in the commit that follows it
tools: [soofi-xyz-team-kit:metagross, soofi-xyz-team-kit:audino, /code-review]        # /code-review ultra once per repo before G8
created: 2026-10-22
---

# Code Review Log: A-13 Explorer UI with its hub, legal, catalog and Coming soon pages

One review round on the whole branch (light lane L5). Reviewers read the code and tests; they did not run the pages in a browser. No re-score was needed: both reviewers scored 75 or more before the fixes.

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/code-review` (whole branch, read-only) | medium | 2026-10-22 | `70561ec` | 8 (0 Critical, 3 correctness defects fixed, 5 Minor) | n/a (all fixed or deferred below) |
| 2 | `soofi-xyz-team-kit:metagross` (read-only reviewer) | n/a | 2026-10-22 | `70561ec` | 3 Major, 11 Minor | **77 / 100** (pass) |
| 3 | `soofi-xyz-team-kit:audino` (read-only reviewer, with frontend-bug-fix) | n/a | 2026-10-22 | `70561ec` | 2 Major, 5 Minor | **82 / 100** (pass) |

## Findings

CR-n = `/code-review`, MG-n = metagross, AU-n = audino.

| # | Severity | File:line | Finding | Resolution |
| --- | --- | --- | --- | --- |
| CR-1 | Major | `ExploreSql.engine.ts:83` | read-only guard stripped `--` and `/* */` before blanking strings, so `SELECT '--'; DROP TABLE v_property` reached the engine | Fixed: one tokenizer pass; 30 refuse and 13 allow cases; also refuses file/URL readers (`read_*`, `parquet_scan`, `glob`, `COPY`, `ATTACH`, `INSTALL`, `LOAD`) and allows `load`/`set` as identifiers (covers MG-12) |
| CR-2 | Major | `FilterSheet.tsx:74` | the Radius field could not be cleared; typing "3" after Backspace gave 53 and a silent 5 mi search | Fixed: local draft, clamped commit on valid input, optional fields clear to "no filter" |
| CR-3 | Major | `ExploreFilters.tsx:154` | the `answered` ref paired an older result with the new area name from the URL (header "37 within 5 mi of Pflugerville" for Austin rows) | Fixed: the place name is built into the request (`AskedSearch`); race test red → green |
| CR-4 | Minor | `ExploreFilters.tsx:100` | header template split with `.split(" · roof")` | Fixed: `EXPLORE_TEXTS.headerNoRoof` (covers MG-9) |
| CR-5 | Major | `ExploreSql.tsx:88` | unbounded SQL result materialised in React state | Fixed: `LIMIT 501` wrapper; caption "showing the first 500 rows" |
| CR-6 | Minor | `explore.ts:150` | the `perm` window CTE ranked every roofing permit in every statement | Fixed: ranking restricted to properties inside the bounding box (`explore-rank.test.ts`). Summary and rows stay separate statements (not merged): deferred, no measured need at today's data size, re-measure with A-11's full county |
| CR-7 | Minor | `DataVerify.tsx:85` | `findCid` loaded the whole chain before checking any manifest | Fixed: one link at a time, stops at the first hit |
| CR-8 | Minor | `RunsCompare.tsx:54` | empty or 0 run number treated as valid | Fixed: defaults; numbering contract shown on the page |
| CR-9 | Minor | `ExploreFilters.tsx:297` | only the first 200 rows reachable | Fixed: "Load more" (page+1, de-duplicated, announced) |
| MG-1 | Major | `Provenance.tsx:60` | `source_url` from published data rendered as `href` without a scheme check | Fixed: `safeHttpUrl()` (http/https only), plain text otherwise; also used for manifest `source.url` in Runs and Coverage |
| MG-2 | Minor | `contract manifest.ts:22` | `z.string().url()` accepts any scheme | Accepted: contract is frozen and shared with the pipeline; every rendering site now goes through `safeHttpUrl()` |
| MG-3 | Major | `parquet-meta.ts:49-50` | a host that ignores Range sends the whole part; parts fetched in parallel | Fixed: a 200, or a 206 larger than asked, is refused and the body cancelled ("footer unavailable · host ignored Range"); 4 MiB cap; one footer at a time per table, 2 tables at once; Catalog uses `readTableMeta` |
| MG-4 | Minor | `verify-lane.ts:130`, `run-chain.ts:76` | unbounded `arrayBuffer()` | Fixed: streamed read with a byte cap (size + 1; manifests 1 MB); oversize = mismatch, never ✓ |
| MG-5 | Major | `scripts/bundle-size.ts:88` | the bundle gate forbade only duckdb and `.wasm`; the zod / hyparquet / barrel guardrails were not enforced | Fixed: `checkPlacement` (Vite manifest + chunk-content markers) with passing and failing fixtures; real build: `/` holds no zod, hyparquet, DuckDB or query-core barrel |
| MG-6 | Minor | `ExploreFilters.tsx:10-16` | barrel import pulled bind-manifest, zod and gazetteer into the Explore chunk | Fixed: subpaths `@countylens/query-core/{places,explore}` |
| MG-7 | Minor | `ExploreFilters.tsx` | BAD_REQUEST showed a Zod JSON dump, no retry | Fixed: API sentence ("radius_mi must be at most 25") and page text `filtersOutOfRange` with Retry |
| MG-8 | Minor | `ExploreFilters.state.ts` | no paging | Fixed (CR-9) |
| MG-10 | Minor | `ExploreFilters.tsx` | "no open roofing permits…" shown when another filter excluded the rows | Fixed: only when the permit filter is the only active filter |
| MG-11 | Minor | `ExploreFilters.tsx` | `sel` outside the current results silently ignored | Fixed: "property not in these results" notice |
| MG-13 | Minor | `explore.search` | public, unthrottled? | Checked: `infra/src/api-stack.ts:300` sets stage throttle 10 req/s, burst 20 (applies to `/api/trpc`). No change |
| AU-1 | Major | `VerifyLane.tsx:~107-143` | final Verify states not announced (new `<p>`, no live region) | Fixed: one persistent `role="status" aria-live="polite"` paragraph; `role="alert"` for mismatch/failed |
| AU-2 | Major | `Hub.tsx:~56-66` | Hub chip loading and ready states silent to assistive technology | Fixed: chip row is a persistent `role="status"`; "Loading latest run" for AT while the fixed-size skeleton shows |
| AU-3 | Minor | `AppShell.tsx:~52-75` | More sheet `role="dialog"` with no modal behaviour | Fixed: `aria-modal`, scrim, focus moved in and trapped, background `inert`, Escape returns focus |
| AU-4 | Minor | `FilterSheet.tsx:~91-140` | combobox without keyboard support | Fixed: ArrowUp/Down, `aria-activedescendant`, `aria-selected`, Enter, Escape |
| AU-5 | Minor | `Hub.tsx:~60` | error chip styled differently from the ready chip | Fixed: named `StatusPill` with the reason and the index link |
| AU-6 | Minor | tests | CSS guarantees (48 px, no animation, CLS boxes) asserted only from CSS source in jsdom | Open by design: the hosted `A-13-scan`, `A-13-vitals` and responsive specs run at final HEAD in TZ03/TZ04 |
| AU-7 | Minor | CSS modules | `overflow-x: auto` on tables and code blocks | Open by design: confirmed by the hosted no-horizontal-scroll check at 390 (TC-080) |

## Known gaps carried forward (not review defects)

- Help · MCP shows an input schema for `search_properties` only; the other five tools say "published with the MCP server in story A-14" (no Zod schemas exist in query-core yet).
- The BBB terms page answers 403 from this network; recorded as such in `content/legal.ts`, not bypassed. The PO confirms the link in a browser at A-2.
- The published run holds one month of Austin permits (35 permits, 14 parcels, 0 stalled), so Pflugerville is empty and no permit is open for years. Demo area: PO decision D-11 (round R4).

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | ✅ | `explore.search` input strict and bounded; published files parsed with Zod (Hub index by a dependency-free reader so the Hub stays small) |
| LLM calls only through the Vercel AI SDK | n/a | no LLM call in this story |
| Powertools logger, tracer and metrics in every Lambda | ✅ | `explore.search` reuses the A-03 handler: `procedure`, `queryDurationMs`, `duckdb.query` subsegment, `exploreSearchSql` builder label |
| No secrets or PII in code or logs | ✅ | none; link URLs are public config; gitleaks runs in CI |
| P0 rules in `docs/architecture-constitution.md` | ✅ | AD-01/02/03/04/05/07/08/18/19/24/25, AM-01/04/06/08 (see plan Constitution Check); Verify never uses the CID copy; SQL only in query-core |

**Open Critical findings:** 0. **Reviewer scores:** metagross 77, audino 82 (both ≥ 75).

## Post-merge review (2026-10-25): the delta `3749547..HEAD`

Scope: the code A-13 changed after it was merged with A-04, A-07 and A-11, for the full-county re-test: `catalogTables` batched grouping, `bindAllViews` for the SQL panel, `retry: false` on Explore search, `tabIndex={0}` on `<main>`, API DuckDB limit 2 GB and Lambda timeout 29 s, the seven-shard CI and `scripts/ci-watch.sh`, and the e2e test edits. Reviewers read the diff and files; they did not run the hosted site.

| Reviewer | Score | Open Critical | Verdict |
| --- | --- | --- | --- |
| `metagross` (architecture, final review) | **80** | 0 | PASS: sound; add a spend and concurrency guard for the 29 s / 2 GB Lambda and document the 5-sample p95 |
| `audino` (frontend) | **80** | 0 | PASS: catalog grouping, `retry: false` and `tabIndex` are sound; explain the long SQL wait |

`/code-review medium` on the same delta was not run as a separate pass: both reviewers read the full diff and report no Critical or correctness findings. (If you want the separate pass, say so; it is one command.)

### Findings and what was done

| # | Reviewer | Severity | Finding | Disposition |
| --- | --- | --- | --- | --- |
| 1 | metagross | Major | Lambda timeout 29 s at 3,008 MB bills up to about 87 GB-s per failing Explore search (about $0.0012 each); the stage throttle allows 10 rps, so a polling client could cost about $40 an hour and about 290 concurrent executions would hit the account concurrency quota (AD-11 forbids reserved concurrency); the credit budget is $120 | **Recorded, not fixed here.** Every Explore search now fails at 29 s whether the timeout is 15 s or 29 s, so the 29 s setting buys nothing and doubles the cost. Recommendation: put the timeout back to 15 s (one CDK deploy, needs the PO's go) until A-16 gap 1 closes, and add a per-route throttle for `explore.search` and a duration alarm in A-16. Written into the DEC and A-16 gap 6 |
| 2 | metagross | Major | DuckDB 2 GB under a 3,008 MB Lambda leaves about 1 GB for Node, Arrow and `/tmp`; no peak-memory evidence | **Recorded.** A-16 gap 6: read `Max Memory Used` from the Lambda REPORT line for a cold Explore search and keep the cap only if the peak stays under 2.8 GB |
| 3 | metagross | Major | TC-041 sample 20 → 5: a p95 over 5 samples is the maximum; stale "20 runs" comments | **Fixed in the comments; documented.** The 5-sample hosted sample follows the A-11 convention (PO 2026-10-25); the 20-run rule stays the operator benchmark; restore 20 when TC-041 is unparked (A-16 gap 1). TC-041 is parked, so nothing is weakened today |
| 4 | both | Minor | `catalogTables` skips a part whose batch group is unknown, with no row and no reason ("missing data says why") | **Recorded** (A-16 follow-up): show an "unclassified table parts (N)" row; the old code had the same gap, so no regression |
| 5 | audino | Major | The 97 s first SQL query is not explained to the user (only the stage text "Binding the published tables") | **Recorded** (A-16 gap 2 follow-up): a one-line `role="status"` note under the bar. Copy change; not made now so the deployed code stays `dc46a6d` |
| 6 | audino | Minor | The SQL engine-error banner has no Retry, so a failure after 97 s means a reload and another wait | **Recorded** (A-16 gap 2) |
| 7 | audino, metagross | Minor | `<main tabIndex={0}>`: the global focus ring (Atlas token) may be clipped at the viewport edge; `<main>` has no accessible name | **Recorded.** A negative `outline-offset` was tried and rejected by the repository's no-negative-values test; use an inset ring token or `aria-label` in A-16 |
| 8 | metagross | Minor | `retry: false` also drops the retry for transient 5xx on fast searches | Accepted trade-off (the page has its own Retry button; documented in the code comment and ERR-59) |
| 9 | metagross | Minor | `ci-watch.sh` matches `failure` only, not `timed_out` | **Recorded** (A-16 follow-up); not changed now because `scripts/` is not on the docs-only list the evidence check allows after the deployed commit |
| 10 | metagross | Minor | TC-004 falls back to a fixed 441,961 (documented in `docs/evidence/A-04.md`) | Accepted while parked; derive it from the Query DB oracle when unparked |

No reviewer found a weakened assertion beyond the documented, parked A-16 gaps. Both scores are 75 or more and no Critical finding is open, so C-03 is met for the delta.
