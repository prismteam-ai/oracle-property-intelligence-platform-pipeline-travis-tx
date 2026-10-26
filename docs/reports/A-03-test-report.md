---
id: QC-RPT-A-03
type: test-execution-report
feature: FEAT-A03
story: A-03
test_cases: testplans/A-03-test-cases.md
runtime_url: https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com
build: "86694ccef1d35f5e18833988cb471dfa6859b589 (run 3: TC-050, TC-NF-04, TC-051, TC-061; run 2: fbdb68b; run 1: 1380ad3)"
data_snapshot: bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i
owner: HebaGaber             # QC Lead
status: "Final, awaiting PO sign-off at G7 (D-11)"   # Draft → Complete → Signed Off
gate: G7
created: 2026-10-21
signed_off_date:
---

# QC Test Report: A-03 Publish one month of Austin roofing permits by CID and show them in the hosted UI

Every case in `testplans/A-03-test-cases.md` (43 cases: TC-001 to TC-061 and TC-NF-01 to NF-06) runs against the **hosted** Amplify branch URL. That URL is the hosted runtime under ASM-8. The custom domain `countylens.aldarraj.com` serves the production branch after the G7 merge.

**Run 1** used build `1380ad3`, as read from `/build.json` in batch 2. It ran as three Playwright batches on 2026-10-21 (EEST): batch 1 at 17:09 (39 cases, `--grep-invert TC-NF-0[1245]`), batch 2 at 17:40 (TC-052, 053, NF-01, 02, 04, 05) and batch 3 at 17:46 (re-run of `permits`, `responsive` and `fallback`). The run-log tally at 17:48 is **23 pass / 13 fail**; per case, with a re-run result replacing the batch-1 result, the logs give 28 pass and 15 fail. Run 1 is kept as the pre-fix baseline.

**Run 2** is the re-test of ERR-10 to ERR-18 and of the test-harness fixes (`660f73c`, `a1fd50a`) on build `fbdb68b3b8d3db93d741dbef96637abb032b699f`, as served at `https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/build.json` (attached to TC-001, 002, 006, 027, 029, 052 and 053). It ran from the operator session on 2026-10-21 (UTC) as five Playwright batches:

| Batch | Start (UTC) | Cases | Result |
| --- | --- | --- | --- |
| b1 | 15:54:13Z | 32 (`--grep-invert` NF-01, 02, 04, 05, TC-051, 052, 053, 061, 032–034), 3 workers | 32 passed |
| b2 | 16:09:02Z | TC-052, 053, NF-01, 02, 04, 05, 1 worker | 5 passed, 1 failed (TC-NF-04) |
| b3 | 16:23:36Z, 16:25:16Z, 16:26:54Z | TC-032, 033, 034, one at a time, about 90 s apart (Filebase per-IP budget, ERR-15) | 3 passed |
| b4 | 16:27:23Z | TC-NF-04 re-run | 1 failed (TC-NF-04) |
| b4 | 16:30:43Z | TC-051, TC-061 (after the evidence draft was written) | 2 passed |

Result: **42 / 43 pass**. The one failure, TC-NF-04 (cold start), was ERR-19.

**Run 3** is the re-test of ERR-19 (fix `9191b3c`, `cdk deploy CountyLensApi`) on build `86694ccef1d35f5e18833988cb471dfa6859b589`, from the operator session on 2026-10-21 at 16:52:18Z (one Playwright batch, 47.7 s): TC-050 and TC-NF-04, **2 passed, 0 failed**. After that batch, `docs/evidence/A-03.md` was updated to the run 3 TC-050 pair (`FmoW9j89Ai0EJQg=` / `1-6ad8edc5-40a028cb6df370d02e8422da`), and TC-051 and TC-061 were re-run against it (run-log 19:56 EEST): **2 passed, 0 failed**. Before that re-run, TC-051 failed only on a test defect: its `idShape` check compared the random base64 characters of the IDs position by position. It now compares the format (base64 length and the X-Ray trace-ID pattern). The test fix and the evidence update are committed in `fe2b26a`.

| Batch | Start (UTC) | Cases | Result |
| --- | --- | --- | --- |
| r3 | 16:52:18Z | TC-050, TC-NF-04 (`@needs-aws`) | 2 passed |
| r3b | 19:56 EEST (run-log time) | TC-051, TC-061 (after the evidence update to the run 3 pair) | 2 passed |

**Final tally: 43 / 43 cases passed on the hosted runtime across runs 2–3.** 39 cases count from run 2 (build `fbdb68b`), and 4 count from run 3 (build `86694cc`): TC-050, TC-NF-04, TC-051 and TC-061. The "Final" column of the Results table names the run each case counts from. No case ran on localhost.

## Summary

| Item | Value |
| --- | --- |
| Environment | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com · build `fbdb68b` (run 2), `86694cc` (run 3; run 1: `1380ad3`) · 2026-10-21 |
| Total TC executed | 43 in run 1 · 43 in run 2 · 4 in run 3 (TC-050, TC-NF-04; then TC-051, TC-061) |
| Passed / failed / blocked | run 1: 23 / 13 / 0 per the run-log (per-case logs: 28 / 15 / 0) · run 2: **42 / 1 / 0** · run 3: **4 / 0 / 0** · final (runs 2–3): **43 / 0 / 0** |
| Pass rate | run 2: 97.7 % (42 / 43) · run 3: 100 % (4 / 4) · final: **100 % (43 / 43)** across runs 2–3 |
| Open Critical defects | 0. ERR-10 to ERR-18 re-tested PASS in run 2. ERR-19 (TC-NF-04) re-tested PASS in run 3. ERR-10 to ERR-19 are Closed (2026-10-21) |
| Unit test report | `docs/reports/A-03-unit-test-report.md`, regenerated at `fe2b26a` (2026-10-21, 19:56–19:59 EEST): workspace 1,071 passed / 0 failed / 6 skipped in 68 files, runtime 647 / 0 / 0, infra with bundling 84 / 0 / 0; coverage `packages/query-core` lines 96.15 % / branches 90.28 %, `packages/contract` 100 %, both ≥ 80 % |
| Code review log | `docs/reviews/CR-A-03.md` (oracle 84 early, 72 → 88 final; metagross 70 → 81; `/code-review` 0 Critical, 4 Major, all fixed) |
| Playwright run | Run 2: operator-session HTML reports `tests/e2e/playwright-report/run2-b1`, `run2-b2`, `run2-b3-tc032`, `run2-b3-tc033`, `run2-b3-tc034`, `run2-nf04-rerun`, `run2-tc051-061` (local, gitignored); run 3: Playwright JSON report with attachments `tc-050-evidence.json`, `tc-nf-04-evidence.json` (operator session, batch r3), then the TC-051 and TC-061 re-run (operator session, batch r3b). Screenshots: `docs/evidence/img/A-03-TC-*.png` (build `fbdb68b`). CI `ci` e2e-hosted re-run on `fbdb68b` (https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39626119607): 31 passed, 3 failed, all CI configuration (TC-006 runtime npm deps, TC-030 `NO_TCAD_PERMIT_NUMBERS`, TC-061 evidence file; run-log 19:10) |

## Results

"FAIL → PASS (b3)" in run 1 means the case failed in batch 1 and passed when re-run in batch 3. Run 2 evidence is on build `fbdb68b`; screenshots are under `docs/evidence/img/`.

| TC ID | AC | Type | Run 1 | Run 2 | Final | Defect | Evidence (run 2) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-03-TC-001 | AC-1 | Happy path (build-time) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `publish-order.test.ts` at the deployed SHA (`build.json` sha `fbdb68b…`) |
| A-03-TC-002 | AC-1 | Negative (build-time) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `publish-order.test.ts` at the deployed SHA |
| A-03-TC-003 | AC-1 | Happy path | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | manifest by CID (`docs/evidence/A-03.md` § AC-1) |
| A-03-TC-004 | AC-1 | Happy path | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | 4 `carCid` values |
| A-03-TC-005 | AC-1, AC-4 | Happy path | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | every part ≤ 50,331,648 B (48m) |
| A-03-TC-006 | AC-1 | Negative / security (build-time) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `socrata-adapter.test.ts` |
| A-03-TC-010 | AC-2 | Happy path (demo D-2) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `A-03-TC-010-*.png` |
| A-03-TC-011 | AC-2 | Happy path | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `A-03-TC-011-*.png` (Austin first, manifest order) |
| A-03-TC-012 | AC-2 | Edge | FAIL (batch 1, not re-run) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10, ERR-12 (re-tested) | `A-03-TC-012-*.png` (35 = `permits_emitted`) |
| A-03-TC-013 | AC-2 | Integration | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `A-03-TC-013-data-groups.png` |
| A-03-TC-014 | AC-2 | Negative / error | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `A-03-TC-014-*.png` (404, not JSON, empty, schema mismatch) |
| A-03-TC-020 | AC-3 | Happy path (demo D-1/D-4) | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10, ERR-11 (re-tested) | `A-03-TC-020-*.png` |
| A-03-TC-021 | AC-3 | Happy path | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10 (re-tested) | `A-03-TC-021-*.png` |
| A-03-TC-022 | AC-3, AC-5 | Missing data | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10 (re-tested) | `A-03-TC-022-2-5-missing-reason-labels.png` |
| A-03-TC-023 | AC-3 | Happy path | FAIL | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-14 (re-tested) | `A-03-TC-023-*.png` (engine line, no database server) |
| A-03-TC-024 | AC-4 | Edge | FAIL | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-16 (re-tested) | `A-03-TC-024-*.png` |
| A-03-TC-025 | AC-3 | Missing data | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10 (re-tested) | `A-03-TC-025-2-5-contractor-resolution.png` |
| A-03-TC-026 | AC-3, AC-4 | Performance | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10 (re-tested) | `A-03-TC-026-rows-from-range-reads.png` |
| A-03-TC-027 | AC-3 | Missing data (unit) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `missing-labels.test.ts` |
| A-03-TC-028 | AC-4 | Performance | FAIL | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-14 (re-tested) | `duckdb-eh-*.wasm.gz` 200, 8,090,760 B; `A-03-TC-028-rows-after-compressed-wasm.png` |
| A-03-TC-029 | FR-008, FR-009 | Edge (unit) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `permits-state.test.ts` |
| A-03-TC-030 | AC-5 | Missing data | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-10 (re-tested) | `2026-122340 BP` not listed; `A-03-TC-030-no-tcad-permits-absent.png` |
| A-03-TC-031 | AC-5 | Missing data | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `A-03-TC-031-*.png` (`permits_no_tcad_geoid` = 1 with label) |
| A-03-TC-032 | AC-5 | Error | FAIL (b1, b3) | PASS (b3, 16:23:36Z) | PASS (run 2, `fbdb68b`) | ERR-15 (re-tested) | `A-03-TC-032-*.png` |
| A-03-TC-033 | AC-5 | Error | FAIL (b1, b3) | PASS (b3, 16:25:16Z) | PASS (run 2, `fbdb68b`) | ERR-15 (re-tested) | `A-03-TC-033-expected-rows-labelled-no-500.png` |
| A-03-TC-034 | AC-5 | Edge | FAIL (b1, b3) | PASS (b3, 16:26:54Z) | PASS (run 2, `fbdb68b`) | ERR-15 (re-tested) | gateway request after 4,001 ms; `A-03-TC-034-expected-rows-labelled-after-timeout.png` |
| A-03-TC-040 | AC-6 | Happy path | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `ALL ARTIFACTS VERIFIED` (Pinata + Filebase) |
| A-03-TC-041 | AC-6 | Negative | FAIL | PASS (b1) | PASS (run 2, `fbdb68b`) | test defect fixed in `a1fd50a` | tampered size / SHA-256 → `VERIFICATION FAILED: 4 of 56 checks failed` |
| A-03-TC-042 | AC-6 | Negative | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | refuses CloudFront, ipfs.io, dweb.link, w3s.link |
| A-03-TC-043 | AC-6 | Happy path | FAIL | PASS (b1) | PASS (run 2, `fbdb68b`) | test defect fixed in `a1fd50a` | corrupted CAR → `VERIFICATION FAILED: 4 of 56 checks failed` |
| A-03-TC-044 | AC-1 | Security | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | readback and overwrite attempts on the CID copy |
| A-03-TC-050 | AC-7 | Observability | FAIL | PASS (b1); **run 3: PASS** | PASS (run 3, `86694cc`) | test defect fixed in `a1fd50a` | run 2: correlation `Fmf20heHgi0EJRA=`, trace `1-6ad8e02b-0c1240f93a969a680f1320f2`, 6 datapoints per metric. Run 3: correlation `FmoW9j89Ai0EJQg=`, trace `1-6ad8edc5-40a028cb6df370d02e8422da`, `duckdb.query` 21 ms, `## index.handler` 23 ms, 40 datapoints each for `QueryDurationMs`, `ItemsProcessed`, `ItemsFailed` |
| A-03-TC-051 | AC-7 | Observability | FAIL (evidence file not yet written) | PASS (b4, 16:30:43Z); **run 3: PASS** (r3b, on the run 3 pair) | PASS (run 3, `86694cc`) | test defect (ID compared by position) fixed in `fe2b26a` | `docs/evidence/A-03.md` § Observability evidence (format of `tests/e2e/README.md`); passed in run 2 against run 1's recorded pair; the evidence now records the run 3 pair |
| A-03-TC-052 | AC-7 | Infrastructure | FAIL → PASS (b2) | PASS (b2) | PASS (run 2, `fbdb68b`) | — | `infra/test/stacks.test.ts` at `fbdb68b` |
| A-03-TC-053 | AC-7 | Infrastructure / edge | not run (b1) → PASS (b2) | PASS (b2) | PASS (run 2, `fbdb68b`) | — | `infra/test/api.test.ts` at `fbdb68b` |
| A-03-TC-060 | FR-010 | Negative (harness) | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | localhost, 127.0.0.1, [::1] and unset refused |
| A-03-TC-061 | FR-010 | Edge | FAIL (evidence file not yet written) | PASS (b4, 16:30:43Z); **run 3: PASS** (r3b) | PASS (run 3, `86694cc`) | — | evidence names the hosted URL and SHA `fbdb68b` (run 2); run 3: the evidence names build `86694cc` |
| A-03-TC-NF-01 | AC-4 | Performance | FAIL | PASS (b2) | PASS (run 2, `fbdb68b`) | ERR-17 (re-tested) | see Non-functional; `A-03-TC-NF-01-load-1-first-row.png` |
| A-03-TC-NF-02 | AC-4 | Performance | PASS | PASS (b2) | PASS (run 2, `fbdb68b`) | — | see Non-functional; `A-03-TC-NF-02-after-20-reloads-listing.png` |
| A-03-TC-NF-03 | AC-2, AC-3 | Responsive | FAIL → PASS (b3) | PASS (b1) | PASS (run 2, `fbdb68b`) | ERR-12, ERR-13 (re-tested) | `A-03-TC-NF-03-*.png`, `A-03-smeargle-*.png` |
| A-03-TC-NF-04 | AC-7 | Performance / observability | FAIL | FAIL (b2, b4 re-run); **run 3: PASS** | PASS (run 3, `86694cc`) | ERR-19 (re-tested) | see Non-functional |
| A-03-TC-NF-05 | AC-4 | Performance / security | FAIL | PASS (b2) | PASS (run 2, `fbdb68b`) | ERR-18 (re-tested) | see Non-functional |
| A-03-TC-NF-06 | AC-4 | Performance / docs | PASS | PASS (b1) | PASS (run 2, `fbdb68b`) | — | `docs/decisions/0001-read-path.md` at `fbdb68b` |

## Non-functional results

The run 1 values were measured before the fixes and are kept as the baseline.

| TC ID | NFR | Tool | Run 1 actual (pre-fix) | Run 2 result | Run 2 actual | Threshold |
| --- | --- | --- | --- | --- | --- | --- |
| A-03-TC-NF-01 | NFR-001 first load | Playwright User Timing, 20 cold loads | FAIL: p50 9,520 / p95 11,425 ms (DuckDB init p95 3,996 ms) | PASS | p50 3,822 / p95 4,170 / max 4,319 ms; DuckDB init p50 3,101 / p95 3,545 ms | ≤ 8,000 ms |
| A-03-TC-NF-02 | NFR-001 browser COUNT / list | Playwright User Timing, 20 runs | PASS: COUNT p95 68 ms · list p95 44 ms (35 rows) | PASS | COUNT p50 56.8 / p95 59.7 ms · list p50 30.7 / p95 33.7 ms (35 rows each run) | < 3,000 ms |
| A-03-TC-NF-03 | NFR-003 responsive, Atlas tokens | Playwright + `smeargle` 390/768/1440 | FAIL → PASS (b3): Copy CID button Arial 13.33 px (ERR-12); Tab order (ERR-13) | PASS | no horizontal overflow, 0 token violations at all six page × width pairs; `smeargle` re-check 6/6 PASS (35 rows, 0 contrast issues; advisory: the table scrolls inside its box at 768) | Atlas tokens only |
| A-03-TC-NF-04 | NFR-004 API warm / cold | Playwright + X-Ray (`@needs-aws`) | FAIL (test defect): warm p95 518 ms (30 calls); cold not measured | **FAIL** (run 2) → **PASS** (run 3) | warm: response p50 221 / p95 269 ms over 30 calls (re-run p95 308 ms), `QueryDurationMs` p95 29.5 ms (re-run 28.0 ms), all 200. Cold: the test looks for an `Invocation` subsegment, but the live trace has `## index.handler` 5,637 ms + `Init` 693 ms (trace `1-6ad8e594-2137ace954e063076e0737a0`; re-run 4,701 + 563 ms, trace `1-6ad8e7f2-60f46d7d7eb6dcbf6b6779e4`), so the real cold start is about 5.3–6.3 s. ERR-19. **Run 3 (build `86694cc`): PASS.** Cold start **2,525 ms** (`Init` 593 + `## index.handler` 1,932 ms, trace `1-6ad8eddd-11c91b3a6ff67e456052d4ea`, X-Ray); warm response p50 212 / p95 243 / max 367 ms over 30 calls, all 200; `QueryDurationMs` p50 18.7 / p95 21.8 ms | warm < 1,000 ms · cold incl. DuckDB init < 3,000 ms |
| A-03-TC-NF-05 | NFR-001 Lambda fallback | `scripts/bench-lambda.ts`, 20 direct invokes, private full-size copy (40 parts, 2,380,939 rows) (`@needs-aws`) | FAIL: TC_NF_05 count 2,843 / radius 6,194 / roofAge 4,988 ms p95; ADR_0001 radius 6,493 / roofAge 4,871 ms p95 (Lambda 1,769 MB) | PASS | Lambda 3,008 MB, threads 4, p50 / p95 (first query in a fresh sandbox): TC_NF_05 count 3 / 5 (6), radius 189 / 200 (2,818), roofAge 85 / 95 (82) ms; ADR_0001 radius 191 / 200 (186), roofAge 85 / 93 (80) ms. Bench copy refused publicly (CloudFront 403, API 400 / 404); prefix emptied (40 keys HEAD 404 at 16:17:14Z); Lambda env restored | < 3,000 ms p95 |
| A-03-TC-NF-06 | NFR-001 spike record | Playwright reads `0001-read-path.md` | PASS: spike table present | PASS | record parsed at `fbdb68b` | record holds the full-size p50/p95 |

## Defects

| ERR | TC | Severity | Status | Fix commit | Re-test |
| --- | --- | --- | --- | --- | --- |
| ERR-10 | TC-020 (also 021, 022, 025, NF-02) | High | Closed (2026-10-21) | `660f73c` | PASS, run 2, 2026-10-21 |
| ERR-11 | TC-020 (error path) | Medium | Closed (2026-10-21) | `660f73c` | PASS, run 2, 2026-10-21 |
| ERR-12 | TC-NF-03 | Medium | Closed (2026-10-21) | `660f73c` | PASS, run 2, 2026-10-21 |
| ERR-13 | TC-NF-03 | Low | Closed (2026-10-21) | `660f73c` | PASS, run 2, 2026-10-21 |
| ERR-14 | TC-023, TC-028 | High | Closed (2026-10-21) | `a1fd50a` | PASS, run 2, 2026-10-21 |
| ERR-15 | TC-032, TC-033, TC-034 | High | Closed (2026-10-21) | `a1fd50a` | PASS, run 2, 2026-10-21 |
| ERR-16 | TC-024 | Medium | Closed (2026-10-21) | `a1fd50a` | PASS, run 2, 2026-10-21 |
| ERR-17 | TC-NF-01 | High | Closed (2026-10-21) | `a1fd50a` | PASS, run 2, 2026-10-21 |
| ERR-18 | TC-NF-05 | High | Closed (2026-10-21) | `a1fd50a` | PASS, run 2, 2026-10-21 |
| ERR-19 | TC-NF-04 | High | Closed (2026-10-21) | `9191b3c` | PASS, run 3, 2026-10-21 (cold start 2,525 ms) |

Test-harness defects without an ERR number (the product was not at fault) were fixed in `a1fd50a` and pass in run 2: TC-041 and TC-043 (JCS tamper fixtures) and TC-050 (`aws:*` annotations ignored). TC-051's ID comparison (by position instead of by format) was fixed in `fe2b26a` and passes in run 3. TC-NF-04's X-Ray reading is part of ERR-19.

Note: `docs/evidence/A-03.md` now records run 3's TC-050 pair (`FmoW9j89Ai0EJQg=` / `1-6ad8edc5-40a028cb6df370d02e8422da`) in the same format, with the run 1 and run 2 pairs kept as history. TC-051 passed in run 2 against run 1's recorded pair, and passed again in run 3 (r3b) against the run 3 pair.

## Sign-off

**Decision:** ☐ Validated (counts toward G7) ☐ Returned, reason: {…} · completed by the PO (HebaGaber) at G7 (D-11)
