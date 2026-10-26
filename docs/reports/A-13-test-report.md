---
id: QC-RPT-A-13
type: test-execution-report
feature: FEAT-A13
story: A-13
test_cases: testplans/A-13-test-cases.md
runtime_url: https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com
build: "dc46a6d259fc0f909485ebaa5a0bfc4c917f4be9 (dc46a6d) on 2026-10-25; earlier: 2e145161d15c1675d628cfdfc120dabd7fcf60c2 (2e14516), read from /build.json on 2026-10-22; earlier runs: 641bc25, a285dbe, d3ae47e, 7f04685, 015fbf9, 32a3d60"
data_snapshot: bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute
owner: HebaGaber             # QC Lead
status: "Final on Run 2: 44 of 73 pass, 29 parked as PO-accepted A-16 gaps, 0 fail (CI run 40185511164, code dc46a6d); awaiting PO sign-off at G7"   # Draft → Complete → Signed Off
gate: G7
created: 2026-10-22
signed_off_date:
---

# QC Test Report: A-13 Build the Explorer UI with its hub, legal, catalog and Coming soon pages

## Final result on the full county (Run 2), 2026-10-25

**CI run 40185511164, preview built from code `dc46a6d` (`/build.json` sha `dc46a6d259fc0f909485ebaa5a0bfc4c917f4be9`), conclusion success. Of the 73 A-13 cases: 44 pass, 29 are parked (skipped with a reason), 0 fail.** The parked cases are not counted as passed. They are the PO-accepted gaps carried to A-16 (`docs/decisions/DEC-A-13-explore-full-county.md`, 2026-10-25): gap 1 Explore search returns HTTP 500 after about 29 s on 441,961 properties (TC-008, 009, 025 to 027, 029 to 037, 041, 043, 062, 065, 073, 074, 086); gap 2 the SQL panel's first query takes about 97 s and fails or hangs on the CI runner (TC-004, 023, 028, 038, 039, 040); gap 3 page speed misses its limits on five pages (TC-058, 081). TC-015 now passes (Runs 1 and 2 exist). The earlier results below were measured on the 14-property slice and are kept as history; where they disagree with this section, this section is the final state.

| Hosted shard (CI run 40185511164) | Passed | Skipped (parked) | Failed |
| --- | --- | --- | --- |
| permits (A-03, Run 2 Permits page) | 9 | 0 | 0 |
| manifest (A-03, every CAR) | 3 | 0 | 0 |
| site (A-03 and A-11 cases) | 17 | 0 | 0 |
| a13-explorer | 12 | 19 | 0 |
| a13-pages | 23 | 3 | 0 |
| a13-scan | 1 | 2 | 0 |
| isolated (perf, verify, vitals, gateway cases) | 17 | 5 | 0 |

Defects found on Run 2 and fixed on the way (all re-tested on CI run 40185511164 or the runs before it): Catalog showed no tables for batched runs; the browser SQL engine bound only `v_roofing_permit`; Explore search ran out of memory in the API (1 GB) and then exceeded the Lambda timeout (15 s, then 29 s), which is gap 1; `<main>` was not keyboard-focusable on `/runs/log`; a timed-out Explore search was retried and kept the page loading for about 59 s; the TC-005, TC-015, TC-018, TC-024, TC-053, TC-073 and TC-081 expectations assumed the one-run slice. The old defect numbers ERR-21 to ERR-26 of this story are now ERR-50 to ERR-55.

Every case in `testplans/A-13-test-cases.md` (73 cases, TC-001 to TC-086) runs against the **hosted** Amplify branch preview `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com`. No case ran on localhost (TC-085 proves the harness refuses it). The production URL `https://countylens.aldarraj.com` serves `feature/oracle-pipeline` until the G7 merge.

**Final result on the GitHub runner (CI run 39835352646, preview built from code `2cc58ac`, 2026-10-22): 72 of 73 cases pass, including TC-040; 1 is skipped (TC-015, waits for A-11). Every A-13 TC except TC-015 has a PASS on the hosted URL on the final build; see "Final verification on the GitHub runner" below.** On the author's slow home link, build `2e14516` gave: 71 of 73 cases pass; 1 is skipped (TC-015, "waits for A-11 (PO D-1/D-2)"); 1 failed on a slow link (TC-040, first load of the in-browser SQL engine, limit 8 s).** By phase: general 59 passed, 1 skipped (2 workers, 16.6 min); verify 8 of 8; vitals 2 of 2 (TC-058, TC-081); perf: TC-040 failed (11.2 to 25.7 s), TC-041 and TC-082 passed when run alone. The first complete suite, 72 of 73 passing (TC-040 passed at 4.1 to 4.6 s), ran on `015fbf9`; run 5 and run 6 below.

**TC-040 in plain words.** The engine's compressed file is 8.09 MB; with the other files the page fetches about 11 MB in parallel. On the faster link of the morning the first load took 4.1 to 4.6 s; on the slower link of the evening, 1.1 to 1.5 MB/s at 14:55 and 0.39 then 0.78 MB/s at 16:50, it took 11.2 to 25.7 s. The page and the files did not change in a way that could account for it (ERR-46 removed Google requests, which the waterfall now confirms). PO decision (2026-10-22, "Record both measurements, keep the 8 s limit (Recommended)"): the limit stays 8 s, no code change, and G7 lists TC-040 as "passes at 1.4 MB/s or faster". TC-040 also passes on the GitHub runner in the final CI run (39835352646, perf phase 13 of 13 passed). Both measurements are in [../evidence/A-13-duckdb.md](../evidence/A-13-duckdb.md).

**The published run is a slice, so every scale number below is provisional.** The only published run, `travis-202609-permits-20261021t103516z`, holds 14 properties and 35 reroof permits (22 open, 13 closed, 0 stalled). TC-040 and TC-041 timings, TC-058 and the Catalog and Coverage cases are therefore measured on that slice and marked "provisional until A-11" in the evidence files the tests write. They do not prove the full-county behaviour.

## Final verification on the GitHub runner (CI run 39835352646)

GitHub Actions run 39835352646, commit `2c13e09` (code identical to `2cc58ac`; the commit differs only in `docs/` and `specs/`), 2026-10-22, conclusion **success**. The `e2e-hosted` job ran three Playwright steps against the Amplify preview `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com` (the Amplify build of the same push).

| Step | Workers | Result |
| --- | --- | --- |
| A-03 cases | 1 | **38 passed** (includes A-03-TC-NF-03, the permits first-viewport rule at 390, and A-03-TC-061) |
| A-13 general (explorer, pages, scan) | 4 | **59 passed, 1 skipped** (TC-015, waits for A-11) |
| A-13 Verify, performance, vitals | 1 | **13 passed** (the 8 Verify cases, TC-040, TC-041, TC-082, TC-058, TC-081) |
| Total A-13 | | **72 passed, 1 skipped** (59 + 13 passed; 73 cases in the plan) |

The other jobs of the run (`gitleaks`, `workspace`, `oracle-runtime`) also succeeded; the `workspace` job holds the unit tests, the coverage gates and the bundle gate (see [A-13-unit-test-report.md](A-13-unit-test-report.md)).

**Every A-13 test case except TC-015 has a PASS on the hosted URL on the final build.** TC-015 stays skipped because the "still resolves" pill needs two published runs (A-11).

**TC-040 has two measurements and now a third.** It failed on the author's slow home link (11 to 26 s at 0.4 to 1.5 MB/s), passed earlier on the same link when it was faster (4.1 to 4.6 s), and passes on the GitHub runner in this run. The PO decision stands (keep the 8 s limit, record both measurements, no code change). Detail: [../evidence/A-13-duckdb.md](../evidence/A-13-duckdb.md) and the Non-functional results table below.

Runs of the same CI job before the final one, for the record:

| CI run | Commit | Outcome |
| --- | --- | --- |
| 39808557005 | `c5c21f3` | `e2e-hosted` failed: token audit (the -16 px margin, ERR-47 attempt 1), permits first viewport 940.8 px on the runner, TC-008 race (ERR-48), A-03-TC-061 |
| 39819086782 | | `workspace` failed on timing races in web unit tests (ERR-49) |
| 39826467354 | | `workspace` failed on timing races in web unit tests (ERR-49) |
| 39828569416 | `2cc58ac` | all jobs green except A-03-TC-061 (a stale SHA in an evidence file; 37 A-03 cases passed, A-13 59 + 1 skipped, 13 of 13) |
| **39835352646** | `2c13e09` (code `2cc58ac`) | **all jobs success** |

## Run history

Six full hosted runs, each on its own preview build, 2026-10-22 (runs 1 to 5 times are UTC; run 6 and the intermediate row use the operator clock, UTC+3, as the run-log does). Start times are the Playwright JSON `startTime` (UTC). Each defect fix was pushed to the fork, Amplify built the branch, `/build.json` was read, and the suite was run again.

| Run | Build | Start (UTC) | General phase (60 cases) | Verify (8) | Perf (3) | Vitals (2) | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `641bc25` | 04:10 | 44 pass, **15 fail**, 1 skipped (TC-002, 003, 008, 009, 012, 014, 016, 039, 042, 071, 072, 073 timed out at 1,800 s, 080, 083, 086) | 6 pass, 1 fail (TC-023), TC-024 skipped behind it | TC-040 pass, TC-041 timed out at 300 s, TC-082 skipped behind it | TC-058 pass, TC-081 fail | Baseline: 18 failing cases (15 + 1 + 1 + 1), recorded as ERR-27 to ERR-37 and ERR-50 to ERR-55 |
| 2 | `a285dbe` | 05:09 | 57 pass, 2 fail (TC-009 checkbox state, TC-073 scan), 1 skipped | **void** | **void** | **void** | Verify, perf and vitals ran while another Playwright process shared `tests/e2e/test-results` (ENOENT on trace files); the results were discarded and the process stopped. General phase counts. ERR-38 (smeargle) to ERR-40 found |
| 3 | `d3ae47e` | 05:36 | 57 pass, 2 fail (TC-072 filter sheet 406 px, TC-073 click on a row after the SQL tab unmounted), 1 skipped | 8 pass | 3 pass | TC-058 pass, TC-081 fail (Data · Catalog median LCP 4,836 ms) | Clean run, nothing else on `tests/e2e`. ERR-41 found |
| 4 | `7f04685` | 06:09 | 58 pass, 1 fail (TC-072, 406 px, second time under 4-worker load), 1 skipped | 8 pass | 3 pass | 2 pass | ERR-42 root cause found by delaying `explore.search` by 4 s |
| 5 | `015fbf9` | 06:38 | 59 pass, 0 fail, 1 skipped (TC-015) | 8 pass | 3 pass | 2 pass | 72 pass / 1 skipped. First complete green run |
| (between) | `32a3d60` | 13:59 to 14:31 | 58 pass, 1 fail (TC-073: screenshot timed out "waiting for fonts to load"), 1 skipped | 8 pass | TC-040 **fail** (12.3 s; 9 to 18 s repeated) | TC-058 pass, TC-081 fail (Catalog 2,656 ms, Coverage 2,572 ms) | ERR-46 found (also: `dfed5b0` failed TC-056, ERR-45; `5fdac1a`, `34c8eaf` ran partial re-checks) |
| 6 (final) | **`2e14516`** | clean run 16:06 to 16:28; general again 16:28 to 16:45 | clean run: 57 pass, 2 fail, 1 skipped (TC-053 columns counted before the progressive Parquet footers arrived; TC-073 explore-wide at 390 waited 15 s for its data state under 4 workers). Both are **test defects**, fixed in the tests (wait for the pending notes; 30 s). General phase re-run with 2 workers: **59 pass, 0 fail, 1 skipped** | **8 pass** | TC-040 **fail** (11.2 to 13.0 s; latest 11.4 to 25.7 s); TC-041 and TC-082 skipped behind it, then run alone: **pass** | **2 pass** | **71 pass, 1 skipped, 1 fail (TC-040, slow link).** Evidence build |

Numbers come from the Playwright JSON reports of each run (`stats.expected`, `stats.unexpected`, `stats.skipped`). Run 1 counts 15 failed in its general phase; the run-log first recorded 13 at the 07:40 (EEST) triage, while 3 long scan cases were still running, and the two late ones are TC-083 and TC-073. The run-log wording for run 3 ("general 57 pass / 2 fail") and run 4 ("58 / 1") matches the JSON.

## Summary

| Item | Value |
| --- | --- |
| Environment | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com · build `2e14516` (`2e145161d15c1675d628cfdfc120dabd7fcf60c2`) · 2026-10-22 |
| Total TC executed | 73 in the plan; 72 executed and 1 skipped in the final run |
| Passed / failed / blocked | **72 / 0 / 0**, plus 1 skipped (TC-015, waits for A-11), on the GitHub runner (CI run 39835352646). On the author's slow link on `2e14516`: 71 / 1 / 0 (TC-040 failed, PO decision recorded) |
| Pass rate | 100 % of executed cases (72 / 72); 98.6 % of the plan (72 / 73) |
| Open Critical defects | 0. ERR-27 to ERR-46 and ERR-50 to ERR-55 are 8 High, 12 Medium, 6 Low; none Critical; all re-tested PASS (ERR-27 to ERR-42 and ERR-50 to ERR-55 on `015fbf9`, ERR-43 to ERR-46 on `2e14516`) |
| Unit test report | `docs/reports/A-13-unit-test-report.md` (written at `70561ec`: 1,319 passed). A fresh local `pnpm test` at `2cc58ac` on 2026-10-22: 102 files passed, 1 skipped; **1,489 passed, 8 skipped, 0 failed**; the same tests, coverage gates and bundle gate pass in CI run 39835352646 |
| Code review log | `docs/reviews/CR-A-13.md` (metagross 77, audino 82, `/code-review` medium, 0 open Critical) |
| CI run | GitHub Actions 39835352646 (success, commit `2c13e09`, code `2cc58ac`): https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39835352646 |
| Playwright run (operator) | Operator session, JSON reports `hosted-general.json`, `hosted-verify.json`, `hosted-perf.json`, `hosted-vitals.json` (session scratchpad, not in the repo) with line output; run command `playwright test -g A-13` per phase with `RUNTIME_URL` set to the preview. No GitHub Actions run exists for `2e14516` (pushed with `[skip ci]`); the final verification is CI run 39835352646 |
| Evidence | `docs/evidence/A-13.md`, `A-13-duckdb.md`, `A-13-roof-age.md`, `A-13-open-permits.md`, `A-13-pages.md`, `A-13-smeargle.md`, `A-13-TC-040-timings.json`, `A-13-TC-041-timings.json`; screenshots `docs/evidence/img/A-13-TC-*.png` |

## Results

Result columns: "Result on 2e14516" is the final run (every case marked PASS also passed on `015fbf9` in run 5; TC-040 is the exception, marked below). "Earlier runs" lists the result in runs 1 to 4 in order (`void` = discarded run 2 phases, see the history). "waits A-11" marks the 11 cases the plan tags that way; the next section says what each checked today. Cases are grouped by the Playwright file that holds them. Every row is one `@scenario:A-13-TC-nnn` test.

### A-13-explorer.spec.ts (Part 1: demo lines, runs, coverage, manifest, filters, SQL): 31 cases

| TC ID | Requirement | Type | Case | Result on 2e14516 | Earlier runs (641bc25 → a285dbe → d3ae47e → 7f04685) | Defect | Evidence (docs/evidence/img) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-002 | AC-1, FR-001, FR-016 | demo | D-2 Runs: latest completed run summary | **PASS** | FAIL → pass → pass → pass | ERR-50 | `A-13-TC-002-1.png`, `A-13-TC-002-3.png`, `A-13-TC-002-6.png` |
| A-13-TC-003 | AC-2, FR-002 | demo | D-3 Coverage: counts, denominators, time, derivation, table | **PASS** | FAIL → pass → pass → pass | ERR-52 | `A-13-TC-003-1.png`, `A-13-TC-003-3.png`, `A-13-TC-003-4.png` |
| A-13-TC-004 | AC-6, FR-006 | demo | D-4 SQL count in the browser, engine line | **PASS** | pass | — | `A-13-TC-004-2.png`, `A-13-TC-004-7.png` |
| A-13-TC-005 | AC-3, FR-003d, FR-016 | demo | D-5 Manifest: every artifact, run chain | **PASS** | pass | — | `A-13-TC-005-2.png`, `A-13-TC-005-4.png`, `A-13-TC-005-6.png` |
| A-13-TC-007 | AC-1, FR-001a | demo · waits A-11 | D-7 Compare latest vs previous run | **PASS** | pass | — | `A-13-TC-007-today.png` |
| A-13-TC-008 | AC-4, FR-004 | demo · waits A-11 | D-8 Pflugerville 5 mi, roof ≥ 15 yrs | **PASS** | FAIL → pass → pass → pass | ERR-53 | `A-13-TC-008-2.png`, `A-13-TC-008-6.png`, `A-13-TC-008-8.png` |
| A-13-TC-009 | AC-5, FR-005 | demo · waits A-11 | D-9 Open or stalled ≥ 5 yrs, longest first | **PASS** | FAIL → FAIL → pass → pass | ERR-54, ERR-39 | `A-13-TC-009-3.png`, `A-13-TC-009-6.png` |
| A-13-TC-010 | AC-1, FR-001c | edge | Per-source deltas; first run says so | **PASS** | pass | — | `A-13-TC-010-3.png` |
| A-13-TC-011 | AC-1, FR-001 | missing-data | Limitations and "Next sync" line | **PASS** | pass | — | `A-13-TC-011-3.png` |
| A-13-TC-012 | AC-1, FR-021 | negative error | Run index unreadable → explicit error | **PASS** | FAIL → pass → pass → pass | ERR-55 | `A-13-TC-012-abort-hub.png`, `A-13-TC-012-abort-runs.png`, `A-13-TC-012-invalid-json-hub.png`, `A-13-TC-012-invalid-json-runs.png` |
| A-13-TC-013 | AC-1, FR-021 | negative error | Manifest unreadable → explicit error naming the CID | **PASS** | pass | — | `A-13-TC-013-coverage.png`, `A-13-TC-013-runs.png` |
| A-13-TC-014 | AC-1, FR-001b | edge missing-data | Single published run → Compare explains why | **PASS** | FAIL → pass → pass → pass | ERR-27 | `A-13-TC-014-3.png`, `A-13-TC-014-4.png` |
| A-13-TC-015 | AC-1, FR-001a | negative · waits A-11 | "Still resolves" pill only after both gateways answer | **SKIPPED** | skipped in all runs | — |  |
| A-13-TC-016 | AC-2, FR-002, FR-024 | integration | Coverage counts equal the manifest, with labels and table CID | **PASS** | FAIL → pass → pass → pass | ERR-28 | `A-13-TC-016-3.png`, `A-13-TC-016-5.png` |
| A-13-TC-017 | AC-2, FR-002, FR-007 | missing-data | Coverage kinds or denominators missing → reason in words | **PASS** | pass | — | `A-13-TC-017-3.png` |
| A-13-TC-025 | AC-4, FR-004 | integration | Place search resolves Pflugerville through the gazetteer | **PASS** | pass | — | `A-13-TC-025-3.png`, `A-13-TC-025-5.png` |
| A-13-TC-026 | AC-4, FR-004, FR-022, NFR-003 | integration | Every row has its fields and provenance (100%) | **PASS** | pass | — | `A-13-TC-026-3.png` |
| A-13-TC-027 | AC-4, FR-004 | edge | Radius 5 → 3 mi updates the count live | **PASS** | pass | — | `A-13-TC-027-2.png`, `A-13-TC-027-4.png` |
| A-13-TC-028 | Edge 1, FR-015 | edge missing-data | Zero results → Close matches with miles outside | **PASS** | pass | — | `A-13-TC-028-3.png` |
| A-13-TC-029 | AC-4, FR-004a, FR-025 | integration | URL state restores filters; `view=map` → List | **PASS** | pass | — | `A-13-TC-029-2.png`, `A-13-TC-029-4.png` |
| A-13-TC-030 | AC-4, FR-004b | integration | Row opens the Property drawer with provenance | **PASS** | pass | — | `A-13-TC-030-3.png`, `A-13-TC-030-4.png` |
| A-13-TC-031 | AC-5, FR-005 | integration · waits A-11 | Stalled / open chips, sorted by open longest | **PASS** | pass | — | `A-13-TC-031-today.png` |
| A-13-TC-032 | AC-5, FR-005, FR-022 | missing-data | Contractor "as printed on permit" + badge; BBB rating or reason | **PASS** | pass | — | `A-13-TC-032-4.png` |
| A-13-TC-033 | AC-7, FR-007 | missing-data | MissingReason for roof basis, contractor, BBB, tenure | **PASS** | pass | — | `A-13-TC-033-4.png` |
| A-13-TC-034 | AC-5, FR-005 | missing-data | No-carrier fields → "not published · no lexicon carrier" | **PASS** | pass | — | `A-13-TC-034-3.png` |
| A-13-TC-035 | AC-5, FR-005 | negative missing-data | Empty open list → exact message | **PASS** | pass | — | `A-13-TC-035-3.png` |
| A-13-TC-036 | AC-8, FR-008 | integration | Tenure > 10 + `ooa78753`: fields and definitions | **PASS** | pass | — | `A-13-TC-036-3.png`, `A-13-TC-036-4.png` |
| A-13-TC-037 | AC-8, FR-008 | missing-data | Unknown tenure excluded and counted | **PASS** | pass | — | `A-13-TC-037-2.png`, `A-13-TC-037-3.png` |
| A-13-TC-038 | AC-6, FR-006 | negative security | SQL write statement refused (read-only) | **PASS** | pass | — | `A-13-TC-038-3.png`, `A-13-TC-038-create.png`, `A-13-TC-038-delete.png` |
| A-13-TC-039 | Edge 3, FR-017 | negative error | SQL typo → one error line with fix, no stack trace | **PASS** | FAIL → pass → pass → pass | ERR-30 | `A-13-TC-039-2.png`, `A-13-TC-039-3.png` |
| A-13-TC-043 | AC-4, AC-6, FR-006a | integration | Filters run on the server with "DuckDB on the server · same views" | **PASS** | pass | — | `A-13-TC-043-3.png`, `A-13-TC-043-4.png` |

### A-13-verify.spec.ts (Verify lanes, serial): 8 cases

| TC ID | Requirement | Type | Case | Result on 2e14516 | Earlier runs (641bc25 → a285dbe → d3ae47e → 7f04685) | Defect | Evidence (docs/evidence/img) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-006 | AC-3, FR-003 | demo | D-6 Verify: two ✓ lanes, Pinata + Filebase, digest match | **PASS** | pass → void → pass → pass | — | `A-13-TC-006-2.png`, `A-13-TC-006-5.png` |
| A-13-TC-018 | AC-3, FR-003c | edge | Directory artifact → "Verify via CAR" | **PASS** | pass → void → pass → pass | — | `A-13-TC-018-3.png` |
| A-13-TC-019 | AC-3, FR-003c | edge · waits A-11 | File artifact > 50 MB → "Verify via CAR" | **PASS** | pass → void → pass → pass | — | `A-13-TC-019-3.png` |
| A-13-TC-020 | AC-7, FR-003b | negative error | 429 during Verify → "rate-limited, retrying", no false ✓ | **PASS** | pass → void → pass → pass | — | `A-13-TC-020-3.png`, `A-13-TC-020-5.png`, `A-13-TC-020-6.png`, `A-13-TC-020-7.png` |
| A-13-TC-021 | AC-3, FR-003 | negative | Gateway bytes differ → mismatch, no ✓ | **PASS** | pass → void → pass → pass | — | `A-13-TC-021-3.png` |
| A-13-TC-022 | AC-3, FR-003a, AM-01 | security | Verify hosts only Pinata + Filebase, plain GET | **PASS** | pass → void → pass → pass | — | `A-13-TC-022-2.png` |
| A-13-TC-023 | Edge 2, FR-016 | negative error | CID copy down → Filebase "fallback"; Verify unaffected | **PASS** | FAIL → void → pass → pass | ERR-35 | `A-13-TC-023-3.png`, `A-13-TC-023-4.png`, `A-13-TC-023-5.png` |
| A-13-TC-024 | AC-3, FR-003d | integration | Run chain Verify and Copy CID | **PASS** | skipped → void → pass → pass | — | `A-13-TC-024-3.png`, `A-13-TC-024-4.png` |

### A-13-perf.spec.ts (serial): 3 cases

| TC ID | Requirement | Type | Case | Result on 2e14516 | Earlier runs (641bc25 → a285dbe → d3ae47e → 7f04685) | Defect | Evidence (docs/evidence/img) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-040 | AC-6, FR-006, NFR-001 | perf · waits A-11 | First DuckDB load ≤ 8 s with a progress bar | **FAIL on a slow link** (11.2 to 25.7 s; passed 4.1 to 4.6 s on `015fbf9` and `5fdac1a`; PO decision: keep 8 s, G7 lists it as "passes at 1.4 MB/s or faster") | pass → void → pass → pass | — | `A-13-TC-040-ready.png`, `A-13-TC-040-timings.json` |
| A-13-TC-041 | AC-6, NFR-001 | perf · waits A-11 | 20 timed runs per search, p95 < 3 s | **PASS** | TIMEOUT → void → pass → pass | ERR-36 | `A-13-TC-041-open-permit.png`, `A-13-TC-041-radius-roof.png`, `A-13-TC-041-timings.json` |
| A-13-TC-082 | NFR-002 | perf | Initial JS ≤ 300 KB gzipped excluding DuckDB | **PASS** | skipped → void → pass → pass | ERR-38 | `A-13-TC-082-explore.png`, `A-13-TC-082-hub.png` |

### A-13-pages.spec.ts (Hub, Catalog, Legal, Runs log, Coming soon, cross-cutting): 23 cases

| TC ID | Requirement | Type | Case | Result on 2e14516 | Earlier runs (641bc25 → a285dbe → d3ae47e → 7f04685) | Defect | Evidence (docs/evidence/img) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-001 | AC-9, FR-009 | smoke demo | D-1 Hub: CountyLens card, CRM Coming soon, run chip | **PASS** | pass | — | `A-13-TC-001-1.png`, `A-13-TC-001-4.png`, `A-13-TC-001-5.png` |
| A-13-TC-042 | FR-023 | integration | Help · MCP: tools, setup, no sample response | **PASS** | FAIL → pass → pass → pass | ERR-51 | `A-13-TC-042-1.png`, `A-13-TC-042-3.png` |
| A-13-TC-050 | AC-9, Edge 6, FR-020 | edge | CRM card switches to a live URL through config | **PASS** | pass | — | `A-13-TC-050-5.png`, `A-13-TC-050-6.png` |
| A-13-TC-051 | AC-9, FR-009 | edge | Watch demo and PR links hidden until configured | **PASS** | pass | — | `A-13-TC-051-2.png`, `A-13-TC-051-3.png` |
| A-13-TC-052 | AC-9, NFR-002 | perf | Hub never loads the query engine | **PASS** | pass | — | `A-13-TC-052-1.png` |
| A-13-TC-053 | AC-10, FR-010, FR-024 | integration · waits A-11 | Catalog: one row per table, columns, rows, CID, size | **PASS** | pass | — | `A-13-TC-053-1.png`, `A-13-TC-053-4.png`, `A-13-TC-053-5.png` |
| A-13-TC-054 | AC-10, Edge 5, FR-019 | negative error | Table list unreachable → "Catalog unavailable · {reason}" | **PASS** | pass | — | `A-13-TC-054-2.png` |
| A-13-TC-055 | AC-11, FR-011 | content | Legal · Data: seven sources, terms links, access rules | **PASS** | pass | — | `A-13-TC-055-1.png`, `A-13-TC-055-3.png` |
| A-13-TC-056 | AC-11, FR-011 | content | Legal · Privacy and Terms render static text | **PASS** | pass | — | `A-13-TC-056-1.png`, `A-13-TC-056-2.png` |
| A-13-TC-057 | AC-12, FR-012 | integration · waits A-11 | Runs · Log: every event in time order with run ID | **PASS** | pass | — | `A-13-TC-057-1.png`, `A-13-TC-057-3.png` |
| A-13-TC-060 | AC-13, FR-013 | coming-soon | Coming soon · Builder mode | **PASS** | pass | — | `A-13-TC-060-entry.png`, `A-13-TC-060-route.png` |
| A-13-TC-061 | AC-13, FR-013 | coming-soon | Coming soon · Other counties and states | **PASS** | pass | — | `A-13-TC-061-entry.png`, `A-13-TC-061-route.png` |
| A-13-TC-062 | AC-13, FR-013 | coming-soon | Coming soon · Street View | **PASS** | pass | — | `A-13-TC-062-entry.png`, `A-13-TC-062-route.png` |
| A-13-TC-063 | AC-13, FR-013 | coming-soon | Coming soon · AI-user sign-in (not linked) | **PASS** | pass | — | `A-13-TC-063-1.png` |
| A-13-TC-064 | AC-13, FR-013 | coming-soon | Coming soon · Saved searches | **PASS** | pass | — | `A-13-TC-064-entry.png`, `A-13-TC-064-route.png` |
| A-13-TC-065 | AC-13, FR-013 | coming-soon | Coming soon · Similar properties | **PASS** | pass | — | `A-13-TC-065-entry.png`, `A-13-TC-065-route.png` |
| A-13-TC-066 | AC-13, FR-013 | coming-soon | Coming soon · SQL checks | **PASS** | pass | — | `A-13-TC-066-entry.png`, `A-13-TC-066-route.png` |
| A-13-TC-067 | AC-13, FR-013 | coming-soon | Coming soon · Pipeline diagram and Gantt | **PASS** | pass | — | `A-13-TC-067-entry.png`, `A-13-TC-067-route.png` |
| A-13-TC-068 | AC-13, FR-013 | coming-soon | Coming soon · Area matrix | **PASS** | pass | — | `A-13-TC-068-entry.png`, `A-13-TC-068-route.png` |
| A-13-TC-069 | AC-13, FR-013 | coming-soon | Coming soon · Run timeline scrubber (unless approved at D-7) | **PASS** | pass | — | `A-13-TC-069-entry.png`, `A-13-TC-069-route.png` |
| A-13-TC-070 | AC-13, FR-013 | coming-soon | Coming soon · Gateway race (unless approved at D-7) | **PASS** | pass | — | `A-13-TC-070-entry.png`, `A-13-TC-070-route.png` |
| A-13-TC-071 | AC-13, FR-013 | negative edge | Another county (picker or URL) → "CountyLens has data for Travis County, TX only" | **PASS** | TIMEOUT → pass → pass → pass | ERR-29 | `A-13-TC-071-2.png`, `A-13-TC-071-3.png` |
| A-13-TC-072 | AC-13, Edge 4, FR-018 | responsive edge | 390: filter sheet, Coming soon in the More sheet, 48 px | **PASS** | FAIL → pass → FAIL → FAIL | ERR-32, ERR-42 | `A-13-TC-072-2.png`, `A-13-TC-072-3.png` |

### A-13-scan.spec.ts (no-sample-data scan, axe, responsive, localhost refusal, deep links): 6 cases

| TC ID | Requirement | Type | Case | Result on 2e14516 | Earlier runs (641bc25 → a285dbe → d3ae47e → 7f04685) | Defect | Evidence (docs/evidence/img) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-073 | AC-14, FR-014, FR-024 | scan security | No-sample-data scan over every route | **PASS** | TIMEOUT → FAIL → FAIL → pass | ERR-34, ERR-40 | `A-13-TC-073-*.png` (27 files), `A-13-pages.md` |
| A-13-TC-074 | AC-14, FR-014 | scan | No "not wired" toast and no ProtoBar on any control | **PASS** | pass | — | `A-13-TC-074-*.png` (25 files) |
| A-13-TC-080 | NFR-002, FR-018 | responsive | Every page at 390 / 768 / 1440, Atlas tokens only (smeargle) | **PASS** | FAIL → pass → pass → pass | ERR-32 | `A-13-TC-080-*.png` (75 files) |
| A-13-TC-083 | NFR-002 | a11y | WCAG 2.2 AA (axe) on every route | **PASS** | FAIL → pass → pass → pass | ERR-33 | `A-13-TC-083-*.png` (25 files), `A-13-pages.md` |
| A-13-TC-085 | Harness rule | harness negative | Harness refuses localhost | **PASS** | pass | — |  |
| A-13-TC-086 | FR-025 | smoke | Every route loads directly, on refresh and as a deep link | **PASS** | FAIL → pass → pass → pass | ERR-31 | `A-13-TC-086-1.png` |

### A-13-vitals.spec.ts (serial): 2 cases

| TC ID | Requirement | Type | Case | Result on 2e14516 | Earlier runs (641bc25 → a285dbe → d3ae47e → 7f04685) | Defect | Evidence (docs/evidence/img) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-058 | AC-12, NFR-002 | perf · waits A-11 | Runs · Log LCP < 2.5 s on mobile 4G | **PASS** | pass → void → pass → pass | — | `A-13-pages.md` |
| A-13-TC-081 | NFR-002 | perf | LCP < 2.5 s, CLS < 0.1, INP < 200 ms on mobile 4G | **PASS** | FAIL → void → FAIL → pass | ERR-37, ERR-41 | `A-13-pages.md` |

## Cases that wait for A-11

Eleven cases carry the plan's "Waits for A-11 (PO D-1/D-2, 2026-10-21)" label. A-11 has not published runs 2 and 3, the full county, `tables-export.json` or run events. Each case ran its "today" branch on the single published run and reported that branch in the test annotations (`a11-branch`). 10 of the 11 pass today (TC-040 included on the GitHub runner, CI run 39835352646; it failed on the author's slow link on `2e14516`, see its row); their full assertions switch on automatically once `runs/index.json` holds at least 3 runs. TC-015 is skipped (the only A-13 case without a PASS).

| TC | Result | What it checked today (single run, 14 properties, 35 permits) | What A-11 adds |
| --- | --- | --- | --- |
| TC-007 D-7 Compare | PASS | `/runs/compare` says "first run · nothing to compare against"; the single manifest CID resolves with HTTP 200 on Pinata and on Filebase (`A-13-TC-007-today.png`) | Run 3 vs Run 2: distinct CIDs, `previousManifestCid` link, resolve pill, CAR links |
| TC-008 D-8 roof age | PASS | Pflugerville 5 mi, roof ≥ 15: header, engine line "DuckDB on the server · same views", the server total equals the list and the browser SQL count of the same filter; Pflugerville holds 0 properties, so the zero-results line shows (see `A-13-roof-age.md` for the Austin demo area, 3 properties) | Full county, n > 0, rows sorted nearest |
| TC-009 D-9 open permits | PASS | No permit is open ≥ 5 years (longest open 47 days): 0 rows and the exact line "no open roofing permits in this radius on the current run" (`A-13-open-permits.md`) | Oldest open or stalled reroofs of the full county, from 2004 |
| TC-015 resolve pill | **SKIPPED** | Skipped with the reason "1 run published": the pill needs two runs | Pill only after both gateways answer for the old CID |
| TC-019 file > 50 MB | PASS | No artifact in this run exceeds 50 MB (recorded); every file ≤ 50 MB shows "Verify" | Every file > 50 MB shows "Verify via CAR" |
| TC-031 chips and sort | PASS | `permits_emitted_stalled` is 0 and no permit is open ≥ 5 years: the list is empty with the exact message (`A-13-TC-031-today.png`) | Stalled and open chips sorted by open longest |
| TC-040 first DuckDB load | **FAIL on `2e14516` (slow link)**; PASS on `015fbf9` and on the runner (CI run 39835352646) | `2e14516`: 11,159 to 25,719 ms (limit 8,000 ms), progress bar shown; `015fbf9`: 4,123 to 4,607 ms; **provisional** (slice; the time is the engine download) | Same test on full-county tables, on a link whose speed is recorded |
| TC-041 search p95 | PASS | 20 distinct radii per series: radius + roof p50 1,320 ms, p95 1,837 ms; open-permit p50 812 ms, p95 1,313 ms (limit 3,000 ms); **provisional** (slice) | Same test on full-county tables |
| TC-053 Catalog | PASS | 23 table rows from the manifest (16 `tables/county/*`, 7 `tables/property_improvement/*`), columns from each Parquet footer, notice "table export not in this run's manifest" | Columns from `tables-export.json` |
| TC-057 Runs · Log | PASS | The 4 events of the single run (start, two source captures, finish with 3 limitations) in time order with the run ID | All events of at least 3 runs |
| TC-058 Runs · Log LCP | PASS | Median LCP 2,452 ms, CLS 0.000 on the Lighthouse mobile profile (150 ms RTT, 1.6 Mbps, 4x CPU, 390 px, median of 5); **provisional** (1 run) | Same test with at least 3 runs |

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-13-TC-040 | NFR-001 first load | Playwright timing, 5 loads | **FAIL on `2e14516` (slow link)**; PASS on `015fbf9` and **PASS on the GitHub runner in CI run 39835352646** (provisional) | `2e14516`: 11,351 · 13,258 · 12,788 · 19,272 · 25,719 ms (latest run; the clean run gave 11,159 to 13,008). `015fbf9`: 4,200 · 4,285 · 4,237 · 4,123 · 4,607 ms (median 4,237). Engine file 8,090,177 B measured at 1.1 to 1.5 MB/s (14:55) and 0.39 to 0.78 MB/s (16:50). 14-property slice | ≤ 8,000 ms; PO decision: keep, G7 "passes at 1.4 MB/s or faster" |
| A-13-TC-041 | NFR-001 search p95 | Playwright timing, 20 runs per series | PASS (provisional) | radius + roof: p50 1,320 / p95 1,837 / max 5,348 ms; open permit: p50 812 / p95 1,313 / max 1,322 ms. The server `queryDurationMs` of the same runs was 203 to 245 ms | p95 < 3,000 ms |
| A-13-TC-058 | NFR-002 Runs · Log LCP | Lighthouse mobile profile in Playwright, median of 5 | PASS (provisional) | LCP runs 2,452 · 2,296 · 2,208 · 2,728 · 4,592 ms, median 2,452 ms; CLS 0.000 | LCP < 2,500 ms |
| A-13-TC-081 | NFR-002 LCP, CLS, INP | same profile, median of 5, 8 pages | PASS | median LCP 1,572 to 2,408 ms (data pages 2,284 to 2,408: `/runs/log` 2,408, `/tx/travis/coverage` 2,400, `/runs` 2,284; Hub 1,736); median CLS ≤ 0.037; median INP ≤ 40 ms (single click at most 56 ms); INP "n/a" on `/runs/log` and `/legal/data` (no link, button or tab in main) | LCP < 2,500 ms, CLS < 0.1, INP < 200 ms |
| A-13-TC-082 | NFR-002 bundle | Playwright network bytes | PASS | JS loaded (measured on `015fbf9`): `/` 117,831 B; `/tx/travis/explore` 181,814 B (both exclude the DuckDB chunks). Build gate on a fresh `pnpm --filter @countylens/web build` at `2e14516`: 220.9 KB gzipped of 300 KB; Hub graph 124.6 KB of 150 KB | ≤ 300 KB gzipped excluding DuckDB |
| A-13-TC-052 | NFR-002 Hub never loads the engine | Playwright network | PASS | no DuckDB or `.wasm` request on `/` | none |
| A-13-TC-080 | NFR-002 responsive, 48 px | Playwright, 25 routes × 390 / 768 / 1440 | PASS | 75 screenshots; `documentElement.scrollWidth` ≤ viewport on every route and width, targets ≥ 48 px at 390. **Gap closed:** smeargle run 3 on `015fbf9` found `/help/mcp` at 390 px scrolling sideways inside `main` (scrollWidth 693 vs 390; N3 in `A-13-smeargle.md`), which this document-level check cannot see. N3 is ERR-43 (Medium, product); fixed in `34c8eaf` and re-measured on the hosted build (`main` 390 / 688 / 1360 = viewport) | per `testplans/A-13-test-cases.md` |
| A-13-TC-083 | NFR-002 WCAG 2.2 AA | axe-core 4.10.2 on 25 routes | PASS | 0 violations, 0 serious or critical, 0 tab stops without a focus ring on every route (`A-13-pages.md`) | 0 serious or critical |
| A-13-TC-073, 074 | FR-014 no sample data | scan of 27 routes × 2 widths (1440, 390) and every control | PASS | 0 denylist phrases, 0 prototype CIDs, 0 CIDs outside a manifest, 0 ProtoBar selectors, 0 "not wired" toasts | 0 hits |

## Defects

All 26 defects were found in the hosted runs of 2026-10-22 on branch `013-explorer-and-pages`. "Fix commit" is the first push that carried the fix. "Re-test" is the final run: `015fbf9` for ERR-27 to ERR-42 and ERR-50 to ERR-55, `2e14516` for ERR-43 to ERR-46; a TC listed under ERR-n passed there. None is Critical.

| ERR | Kind | TC | Severity | Fix commit | Status |
| --- | --- | --- | --- | --- | --- |
| ERR-50 | product (Runs source lines omit the watermark) | TC-002 | High | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-51 | product (Help · MCP `search_properties` has no `[data-schema]`) | TC-042 | Medium | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-52 | test (textContent fuses blocks) | TC-003 | Low | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-53 | test (zero-results text built with NaN) | TC-008 | Low | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-54 | product (D-9 zero results lacked "no open roofing permits"; a regression from a review fix) | TC-009 | High | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-55 | test ("no article" too broad) | TC-012 | Low | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-27 | product (single-run Compare had no manifest link and counted one card as a compared run) | TC-014 | Medium | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-28 | test (demanded a table chip on a kind with no table) | TC-016 | Low | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-29 | test (County option label does not exist) | TC-071 | Low | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-30 | product (SQL typo got the read-only refusal, not "message · Try: fix") | TC-039 | Medium | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-31 | product (`/permits` had no level-2 heading while loading or on error) | TC-086 | Medium | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-32 | product (touch targets under 48 px, UA font on controls) | TC-072, TC-080 | High | `a285dbe` | Fixed, re-test PASS on 015fbf9 (TC-072 and TC-080); see also ERR-38 and ERR-42 |
| ERR-33 | product (Catalog definition lists held bare divs, axe `definition-list` on 23 nodes) | TC-083 | High | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-34 | test (TC-073 exceeded 30 minutes without naming the stuck step) | TC-073 | High | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-35 | test (fallback test counted copy-host requests across three page loads) | TC-023 | Low | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-36 | test (TC-041 waited on a network call the page caches) | TC-041 | Medium | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-37 | test (INP control table; `/runs/log` has no control in main) | TC-081 | Medium | `a285dbe` | Fixed, re-test PASS on 015fbf9 |
| ERR-38 | product (`.link` 14 px high on `/runs` and `/runs/compare`, found by smeargle run 2) | TC-080 (the defect file names TC-082, which is the bundle test; the touch-target proof is TC-080) | Medium | `d3ae47e` | Fixed, re-test PASS on 015fbf9 (TC-080); smeargle final pass: see `A-13-smeargle.md` |
| ERR-39 | product (controlled checkbox/select flicker until the URL commits) | TC-009 | High | `d3ae47e` | Fixed, re-test PASS on 015fbf9 |
| ERR-40 | test (scan allowlist too narrow; clicks on a moving page) | TC-073 | High | `d3ae47e` | Fixed, re-test PASS on 015fbf9 |
| ERR-41 | product (Data · Catalog median LCP 4,836 ms) | TC-081 | Medium | `7f04685` | Fixed, re-test PASS on 015fbf9 (Catalog median LCP 2,456 ms) |
| ERR-42 | product (bottom-nav icon showed its glyph name until the font loaded, widening 390 px to 406 px) | TC-072 | Medium | `015fbf9` | Fixed, re-test PASS on 015fbf9 |
| ERR-43 | product (Help · MCP snippet wrapper had no `min-width: 0`; `main` scrolled sideways at 390 px; found by smeargle, no Playwright case) | smeargle N3 | Medium | `34c8eaf` | Closed, re-measured on the hosted build: `main` 390 / 688 / 1360 = viewport |
| ERR-44 | product, performance (median LCP 2,508 ms on Coverage, 2.38 to 2.48 s on the other data pages; cross-origin CID-copy handshake started after the run index returned) | TC-081 | Medium | `dfed5b0` | Closed, re-test PASS on `2e14516` (TC-081: data pages 2.28 to 2.41 s) |
| ERR-45 | product, regression from the ERR-44 fix (the `/runs/index.json` preload also fired on the static Legal pages) | TC-056 | Medium | `32a3d60` | Closed, re-test PASS on `2e14516` (TC-056: Legal pages make no data request) |
| ERR-46 | product, performance (render-blocking Google Fonts requests: Catalog 2,656 ms, Coverage 2,572 ms; TC-040 9 to 18 s; TC-073 screenshot waited for fonts) | TC-081, TC-040, TC-073 | High | `2e14516` | Closed, re-test PASS on `2e14516` for TC-081 and TC-073; TC-040's waterfall no longer includes Google (TC-040 itself still fails on the slow link: see the summary) |

Counts: 16 product defects (ERR-50, 51, 54, 27, 30, 31, 32, 33, 38, 39, 41, 42, 43, 44, 45, 46) and 10 test defects (ERR-52, 53, 55, 28, 29, 34, 35, 36, 37, 40). Severity as written in the defect files: 8 High (ERR-50, 25, 32, 33, 34, 39, 40, 46), 12 Medium (ERR-51, 27, 30, 31, 36, 37, 38, 41, 42, 43, 44, 45), 6 Low (ERR-52, 53, 55, 28, 29, 35). Two further test-side failures in the clean run on `2e14516` (TC-053 and TC-073, see run 6) were fixed in the tests and did not get ERR numbers.

No open finding outside the 73 cases: smeargle N3 (`/help/mcp`, 390 px, `main` scrolls sideways) is ERR-43, fixed in `34c8eaf` and re-measured on the hosted build. TC-080 measures the document, not `main`, so it could not have caught it; the smeargle cell did.

Notes: (1) The `docs/defects/ERR-27.md` to `ERR-42.md and ERR-50 to ERR-55` files still read "Fixed, re-test pending (hosted)" with empty `fix_commit` and `retest_date`; the table above is the re-test record until they are closed at G7. ERR-43 to ERR-48 are closed in their files (ERR-47 and ERR-48 re-tested PASS in CI run 39835352646). (2) Product fixes of ERR-27 to ERR-32 and ERR-50 to ERR-55 were written with their tests, not seen red first, as the run-log records. (3) TC-072 failed once at 406 px under 4-worker load in runs 3 and 4 and could not be reproduced in 6 clean single runs on `d3ae47e`; it was reproduced only by delaying `explore.search` (ERR-42) and passes on `015fbf9`.

## Sign-off

**Decision:** ☐ Validated (counts toward G7) ☐ Returned, reason: {…} · to be completed by the PO (HebaGaber) at G7
