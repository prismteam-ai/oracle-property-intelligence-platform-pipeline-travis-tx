---
id: EV-A-13-duckdb
type: evidence
story: A-13
feature: FEAT-A13
test_cases: [A-13-TC-004, A-13-TC-038, A-13-TC-039, A-13-TC-040]
runtime_url: https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com/tx/travis/explore?mode=sql
data_snapshot: bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i
branch: 013-explorer-and-pages
created: 2026-10-22
---

# A-13 evidence: the SQL panel runs DuckDB in the browser (demo line D-4, AC-6)

Hosted preview `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com`. The page reads below were made on build `015fbf9` (`/build.json` sha `015fbf99bed1d784c908714c56418c83ce2d5e4f`); the final build is `2e14516` (sha `2e145161d15c1675d628cfdfc120dabd7fcf60c2`), where TC-004, 038 and 039 pass again and TC-040 fails on a slow link (see the next section). Page `/tx/travis/explore?mode=sql`. Snapshot: run `travis-202609-permits-20261021t103516z`, manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`, 14 properties and 35 reroof permits (a slice of the county; see the limits at the end).

## Action

1. Open `/tx/travis/explore?mode=sql` in a fresh browser context (no cache).
2. Wait for the progress bar to finish and the SQL box to become editable.
3. Type `SELECT count(*) FROM v_property` and press **Run**.
4. Read the result grid and the engine line.

## Observed (read on the page, 2026-10-22 09:07 UTC)

| What | Value |
| --- | --- |
| Result | one row, one column `count_star()`: **14** |
| Engine line | **DuckDB-WASM in your browser · read-only** |
| Expected | 14 = the manifest's `coverage.parcels_published.count`; TC-004 asserts this equality on every run |
| Server call | none: TC-004 records the requests between pressing Run and the result and asserts no `/api/` or `/trpc/` request |
| First load (this read) | 4,371 ms from navigation until the progress bar was gone and the box editable |
| Also run | `SELECT count(*) FROM v_roofing_permit` returned **35**, which equals the 35 reroof permits in the manifest |

## First-load time (TC-040): two measurements

Limit 8,000 ms, five cold loads per run, from navigation until the progress bar is gone and the box is editable. `docs/evidence/A-13-TC-040-timings.json` holds the latest run (`2e14516`, marked `"provisional": true`). The time is mostly the download of the compressed engine file `duckdb-eh-CfdE9-rk.wasm.gz` (8,090,177 bytes) plus three extension files (about 11 MB in parallel), so it depends on the speed of the link. The tables are the 14-property slice, so this is not a full-county number.

| Build | Loads (ms) | Link speed | Result |
| --- | --- | --- | --- |
| `015fbf9` (and `5fdac1a`) | 4,200 · 4,285 · 4,237 · 4,123 · 4,607 (median 4,237) | not measured at the time | PASS |
| `2e14516`, clean run | 11,159 to 13,008 | engine file by hand: 6.0 s, 7.2 s, 5.3 s = 1.1 to 1.5 MB/s (14:55) | **FAIL** |
| `2e14516`, latest run | 11,351 · 13,258 · 12,788 · 19,272 · 25,719 | engine file by hand: 0.39 then 0.78 MB/s (16:50) | **FAIL** |
| `2cc58ac` on the GitHub runner (CI run 39835352646) | not recorded in the repo (the step reports pass or fail) | runner connection | **PASS** (within the 8,000 ms limit; Verify, performance and vitals step 13 of 13) |

Waterfall of the SQL panel on `2e14516` (the engine load): engine `wasm.gz` 8.09 MB took 9.3 s, the `icu` extension 1.9 MB 3.1 s, `parquet` 0.74 MB 1.8 s, `json` 0.19 MB 0.9 s (about 11 MB in parallel); everything else was done by about 4 s. After ERR-46 the waterfall holds no request to Google.

**TC-040 failed on the final build `2e14516` on a slow link.** It passed on the same asset on a faster link earlier on the same day. PO decision (2026-10-22, "Record both measurements, keep the 8 s limit (Recommended)"): the limit stays 8 s, there is no code change, and G7 lists TC-040 as "passes at 1.4 MB/s or faster" (about 11 MB in 8 s). The first-load time is re-measured at A-11 with the full county, on a link whose speed is recorded.

## Typo case (TC-039)

The panel returns one error line that says what is wrong and how to fix it, and no stack trace. Typed on the hosted page:

| SQL typed | Error line shown |
| --- | --- |
| `SELEC count(*) FROM v_property` | `Syntax error near "SELEC" · Try: SELECT` |
| `SELECT count(*) FROM v_propety` | `Catalog Error: Table with name v_propety does not exist! · Try: use v_property` |

TC-039 asserts the shape `{message} · Try: {fix}`, that the line is a single line, that the page text looks like no stack trace, and that the SQL box keeps what was typed. (The first form was ERR-30: a mistyped keyword used to get the read-only refusal; fixed in `a285dbe`.)

## Write statements are refused (TC-038)

`DELETE FROM v_property` shows `Read-only: only SELECT, WITH, DESCRIBE and SHOW run here`. TC-038 also tries `CREATE TABLE t AS SELECT 1` and then re-runs the count, which is still 14.

## Screenshots

- `docs/evidence/img/A-13-TC-004-2.png`: Explore · SQL after the progress bar, before the query.
- `docs/evidence/img/A-13-TC-004-7.png`: the result `14` with the engine line.
- `docs/evidence/img/A-13-TC-038-delete.png`, `A-13-TC-038-create.png`, `A-13-TC-038-3.png`: refusals and the unchanged count.
- `docs/evidence/img/A-13-TC-039-2.png`, `A-13-TC-039-3.png`: the two typo error lines.
- `docs/evidence/img/A-13-TC-040-ready.png`: the page when the first load is done.

## Missing data or limitations seen

- The count is 14 because the only published run is a slice (one month of Austin permits joined to 14 TCAD parcels). With the full county from A-11 the same query returns the county count and the first-load time is re-measured (TC-040 switches to its full branch).
- The Filters panel is different: it runs on the server (`explore.search`, engine line "DuckDB on the server · same views"). Only this SQL panel runs in the browser.

## Result

TC-004, TC-038 and TC-039 PASS on `2e14516`; TC-040 FAILED on `2e14516` on a slow link and passed on `015fbf9` (`docs/reports/A-13-test-report.md`).
