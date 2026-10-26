---
id: QC-RPT-A-01
type: test-execution-report
feature: FEAT-A01
story: A-01
test_cases: testplans/A-01-test-cases.md
runtime_url: "N/A: Project story, no hosted runtime until A-03"
build: 9c7579a
data_snapshot: "no manifest CID in A-01; catalog pipeline/docs/travis-sources.yaml at 9c7579a"
owner: HebaGaber
status: Complete
gate: G7
created: 2026-10-20
signed_off_date:
---

# QC Test Report: A-01 Discover Travis County sources and pass readiness preflight

This is the report task TZ06 calls `docs/reports/TR-A-01.md`; it uses the template's name `docs/reports/A-01-test-report.md` (task T064).

Every case in `testplans/A-01-test-cases.md` (v0.6 at execution, updated to v0.7 to match the automation; 30 cases) was run from the repository root on branch `001-discover-sources`, through its automated test: `pipeline/oracle-runtime/test/acceptance/a01.acceptance.test.ts` (one test per CLI case, `npm run test:acceptance`) and the unit tests the plan names for UNIT cases. There is no hosted URL in A-01 (G4 C-04 exception), so every hosted-URL field reads "N/A: Project story, no hosted runtime until A-03".

## Summary

| Item | Value |
| --- | --- |
| Environment | N/A: Project story, no hosted runtime until A-03 · terminal at repo root, macOS (darwin-arm64), Node 22.23.3, Vitest 5.0.5, Python 3.15.0 · build `9c7579a` · 2026-10-20 |
| Total TC in the plan | 30 |
| Executed | 28 (26 automated acceptance tests, of which 2 skipped by design, plus 3 unit-only cases, plus TC-023 timed by the PO) |
| Passed / failed / blocked | **28 / 0 / 0**; 2 not applicable (TC-011, TC-018) |
| Pass rate | **100%** of executed applicable cases (28 of 28) |
| Open Critical defects | **0** (no open defects; ERR-4 closed as accepted by the PO) |
| Unit test report | `docs/reports/A-01-unit-test-report.md` |
| Code review log | `docs/reviews/CR-A-01.md` |
| Playwright run | N/A: Project story, no hosted runtime until A-03 |

## Runs

| Run | Start (UTC) | Commit | Passed / failed / skipped (of 26 automated) | Note |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-20T15:31:25Z | `a96d669` + ERR-1 fix | 11 / 13 / 2 | first end-to-end run of the suite; ERR-2 found |
| 2 | about 15:34Z | + ERR-2 fix | 16 / 8 / 2 | ERR-3 to ERR-7 found |
| 3 | 15:36:34Z | + ERR-3, ERR-5, ERR-6, ERR-7 fixes (uncommitted) | 22 / 2 / 2 | TC-022 failed only on the uncommitted `docs/sources.md` |
| **Final** | **15:38:39Z** | **`9c7579a`** | **23 / 1 / 2** | 24 s; plus TC-008, TC-026, TC-NF-01 unit cases PASS |
| Re-test | after 15:40Z | ERR-4 accepted | TC-009: 1 / 0 / 0 | TC-009 step 4 accepts a documented missing date |

Live requests made by the suite (open-data sources only, each with the project's identified User-Agent after ERR-1): Comptroller `data.texas.gov` (TC-005), Austin `data.austintexas.gov` (TC-006, TC-014), GitHub API (TC-020, `gh run list`). No blocked source was contacted. While diagnosing ERR-3, three manual count queries went to Austin's open-data API; one of them carried a truncated form of the project User-Agent.

## Results

| TC ID | AC | Type | Result | Defect | Evidence (observed output) |
| --- | --- | --- | --- | --- | --- |
| A-01-TC-001 | AC-1 | Happy path | PASS | — | validator exit 0, `overall: PASS`, `seed_allowed: true`, `ingest_allowed: true`; gates catalog_metadata, parcel, permit, destination, enrichment PASS |
| A-01-TC-002 | AC-1 | Happy path | PASS | — | 9 source rows: tcad_certified, tcad_supplemental, tcad_gis, austin_permits, other_jurisdictions, tx_comptroller, overture, contractor_licensing available; bbb blocked |
| A-01-TC-003 | AC-1 | Happy path | PASS | ERR-6 | `destination.proven: true`; 3 distinct identity sources (≥ 2) |
| A-01-TC-004 | AC-1 | Negative | PASS | — | scratch copy with an incomplete `records_request` makes the validator BLOCK |
| A-01-TC-005 | AC-1 | Happy path | PASS | ERR-1, ERR-2 | Travis-coded rows 342,334 = denominator; statewide 3,487,662; live recount within 0.5% |
| A-01-TC-006 | AC-2 | Happy path, scale | PASS | ERR-1, ERR-3 | recorded 2,380,725 rows; live 2,380,939 (+0.009%); null `tcad_id` 63,019 recorded, 63,019 live |
| A-01-TC-007 | AC-2 | Happy path | PASS | ERR-2 | median 120,043 rows/min over 3 pages of 50,000; decision `ingest` |
| A-01-TC-008 | AC-2 | Edge, error | PASS | ERR-7 | unit `A-01-TC-008 429 backoff`: 5 tests pass (full jitter, 1 s base, 60 s cap, Retry-After) |
| A-01-TC-009 | AC-3 | Happy path, scale | PASS (after ERR-4 accepted) | ERR-4 | roll 493,246; key `pID` (layout `prop_id`), proven; deed or sale dates present; `certification_date` missing with its reason (the TCAD page states none), source and capture time; failed in the final run, passed on re-test after the PO accepted the gap |
| A-01-TC-010 | AC-3 | Validation | PASS | ERR-2 | GIS 373,683; gap 24.24% = formula; `separately_assessed_without_geometry: acknowledged`; PO exception bound |
| A-01-TC-011 | AC-3, AC-6 | Missing data | N/A (skipped by design) | — | applies only while GIS has no count; GIS was counted from the US runner (D-2) |
| A-01-TC-012 | AC-3 edge | Edge | PASS | — | Export Layouts recorded beside the JSON export |
| A-01-TC-013 | AC-4 | Happy path, scale | PASS | ERR-2 | 23 rows = Census 22 places + 1; Austin supported, 22 records request |
| A-01-TC-014 | AC-4 | Integration | PASS | ERR-1 | Austin-issued counts in Lakeway, Bee Cave and Pflugerville recorded under Austin; live recount within 0.5% |
| A-01-TC-015 | AC-4 | Negative | PASS | — | scratch copies with a spec label in `status` or a missing place are rejected |
| A-01-TC-016 | AC-4 | Edge | PASS | — | partial-history, delegated and intake-only rows classified as specified |
| A-01-TC-017 | AC-5 | Validation | PASS | — | every source projected above 48 h carries a decision and its measurement |
| A-01-TC-018 | AC-6 | Error, missing data | N/A (skipped by design) | — | outcome B only; TCAD was captured (outcome A) |
| A-01-TC-019 | AC-6 | Security, negative | PASS | ERR-7 | unit `A-01-TC-019 no evasion`: 4 tests pass (403, challenge, timeout: exactly 1 attempt); one constant User-Agent in all evidence |
| A-01-TC-020 | AC-6 | Security | PASS | ERR-6 | suspected geo signal on GIS (operator side); exactly 1 run of `a01-us-gis-probe.yml`; HTTP 200 recorded in `A-01-us-gis-runner.md` |
| A-01-TC-021 | AC-6 | Error | PASS | — | BBB `blocked`, decision `runtime retrieval`; no bypass; advertised count not used |
| A-01-TC-022 | AC-7 | Happy path | PASS | ERR-5 | catalog, `docs/sources.md` and report committed; re-render gives no diff; 0 numeric rows without URL and UTC time |
| A-01-TC-023 | AC-7 | Usability (timed) | PASS | — | run by the PO (HebaGaber), 2026-10-20: a number in `docs/sources.md` traced to its source URL and UTC capture time in about 1 minute (threshold under 2 minutes) |
| A-01-TC-024 | AC-1 | Security, negative | PASS | — | no secrets, connection strings or absolute home paths in evidence |
| A-01-TC-025 | AC-1 | Integration | PASS | — | vendored validator SHA-256 `5c5b8515…abb3d` matches; parser parity |
| A-01-TC-026 | AC-6 | Error, missing data | PASS | — | unit `A-01-TC-026`: 3 tests pass (throttled after 5 attempts → null with reason; download limits → blocked) |
| A-01-TC-027 | AC-6 | Recovery | PASS | ERR-6 | `resolve` refuses (exit 2, nothing sent); unit `A-01-TC-027`: 6 tests pass |

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-01-TC-NF-01 | Source etiquette (NFR-001) | Vitest unit (`A-01-TC-NF-01 etiquette`) | PASS | 6 tests: ≤ 2 in flight per host, constant identified User-Agent, no proxy or rotation | concurrency ≤ 2; 0 bypasses |
| A-01-TC-NF-02 | Measurement stays a measurement | acceptance | PASS | 3 pages × 50,000 = 150,000 rows read; raw data holds only the TCAD export and the 16-byte US-runner count | ≤ 150,000 rows; no bulk download beyond TCAD |
| A-01-TC-NF-03 | Discovery within 8 h (SC-006) | acceptance | PASS | run `travis-2` discovery time within 8 h after subtracting 7.72 h waiting for a human | ≤ 8 h |

## Defects

| ERR | TC | Severity | Status | Fix commit |
| --- | --- | --- | --- | --- |
| ERR-1 | TC-005, TC-006, TC-014 | Medium | Fixed + re-tested ✅ (found before the run) | `9c7579a` |
| ERR-2 | TC-005, 007, 010, 013, NF-02, NF-03 | High | Fixed + re-tested ✅ | `9c7579a` |
| ERR-3 | TC-006 | Medium | Fixed + re-tested ✅ | `9c7579a` |
| ERR-4 | TC-009 | Medium | Closed: accepted by the PO 2026-10-20 (documented gap); TC-009 re-tested PASS | this commit |
| ERR-5 | TC-022 | High | Fixed + re-tested ✅ | `9c7579a` |
| ERR-6 | TC-003, 020, 027, NF-02 | Low | Fixed + re-tested ✅ | `9c7579a` |
| ERR-7 | TC-019 (also 008, NF-01) | Medium | Fixed + re-tested ✅ | `9c7579a` |
| ERR-8 | TC-026 (unit, download total limit) | Medium | Fixed + re-tested in CI ✅ (found at G7: flaky on the CI runner) | `024d9c0`, `56e1426` |

ERR-1, ERR-2, ERR-3, ERR-6 and ERR-7 were defects in the tests, not the product; ERR-5 was a product defect (a deliverable); ERR-4 is a missing value in the data, accepted by the PO as a documented gap. The test plan (QC-owned, approved at G6) still carries the old wording for ERR-1, ERR-2, ERR-3, ERR-4 and ERR-6; its § 6 shell setup and those cases should be updated to match the automation.

## Sign-off

**Decision:** ☐ Validated (counts toward G7) ☐ Returned, reason: {…} · {date}

All cases are executed. The certification date (ERR-4) is a documented, PO-accepted gap.
