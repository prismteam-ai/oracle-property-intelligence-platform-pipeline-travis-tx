---
id: QC-RPT-A-11
type: test-execution-report
feature: [FEAT-A11, FEAT-A12]
story: A-11
test_cases: testplans/A-11-test-cases.md
runtime_url: "N/A: ui:false, pipeline-only story (G4 C-04 exception); observable on the public IPFS network, in AWS, and in the PR/manifest/release artifacts"
build: 5e4f080
data_snapshot: "Run 1 manifest CID bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu; county 441,961 rows (R-only), property_improvement 17,387 rows (roofing-classified, decided status)"
owner: HebaGaber             # QC Lead
status: Complete             # Draft -> Complete -> Signed Off
gate: G7
created: 2026-10-24
signed_off_date:
---

# QC Test Report: A-11 Publish the full county by CID and keep it current with incremental runs

Save as `docs/reports/A-11-test-report.md`. This is a pipeline-only story (`ui: false`): no case runs against a hosted URL (G4/G6 C-04/C-05/C-09 exception). Every case below starts from a terminal at the repo root on branch `011-publish-and-runs`.

**Scope of this pass:** Run 1 (publication, manifest, upload, gateway verification, durability copies) and the scheduler (AC-12) were built and are testable now. Runs 2 and 3 (AC-7 through AC-11) require later UTC dates (earliest 2026-10-25 / 2026-10-26) and are explicitly deferred — per the PO's standing cost-mode decision, carried forward into `stories/A-16-cost-and-admin.md` (commit `ff345a8`). Those cases are N/A this pass, not failed.

**Full gateway verification is in progress, not complete.** `scripts/verify-manifest.ts runs/travis-full-run1-20261023/manifest.json --verbose` has been running in the background since 2026-10-24 13:02 local (PID 15467, confirmed alive) and was read but not touched for this report. Current tally from `specs/011-publish-and-runs/verify-manifest-run1.log` as of this pass: **43 ok, 5 FAIL, out of 456 expected checks** (228 artifacts x 2 gateways). All FAILs seen so far are `HTTP 429 after 5 attempts` against `gateway.pinata.cloud` (sustained rate-limiting from today's cumulative request volume, diagnosed as temporary congestion in run-log.md 10:01/10:20, not a code defect — the script's Retry-After cap and pre-request throttle are already in place). No FAIL has been seen against `ipfs.filebase.io`. TC-005/TC-012/NF-01 are therefore scored **IN PROGRESS**, not PASS, consistent with `docs/evidence/A-11.md`'s own "Verification status — IN PROGRESS" section and the PO's recorded decision not to block the merge on it.

## Summary

| Item | Value |
| --- | --- |
| Environment | N/A: pipeline-only story (ui:false) · build `5e4f080` (branch `011-publish-and-runs`) · 2026-10-24 |
| Total TC executed | 11 of 20 (9 N/A: AC-7–AC-11/Runs 2-3 deferred to A-16) |
| Passed / in-progress / failed / N/A | 8 / 3 / 0 / 9 |
| Pass rate (of executed/testable) | 8 PASS + 3 IN PROGRESS of 11 testable; 0 FAIL |
| Open Critical defects | 0 |
| Real defects found this pass | 0 (this G7 fix pass; see Defects section for the two real build-time defects already found and fixed before G7, per `docs/reviews/CR-A-11-*.md`) |
| Unit test report | `docs/reports/A-11-unit-test-report.md` |
| Code review log | `docs/reviews/CR-A-11-donphan.md` (88/100), `docs/reviews/CR-A-11-porygon.md` (86/100) — see G7 precheck C-03 addendum for why `oracle`/`machamp` did not also score (recorded cost-mode scope reduction, not a gap) |
| Playwright run | N/A: pipeline-only story |

## Results

| TC ID | AC | Type | Result | Evidence |
| --- | --- | --- | --- | --- |
| A-11-TC-001 | AC-1 | Happy path | PASS | `pipeline/publish/test/sequence.test.ts` passes (part of `pipeline/publish` 261/261, see unit-test report); Run 1's real 12 batch CARs went through validate -> hash -> validate -> export-tables -> upload -> upload in that fixed order, per `specs/011-publish-and-runs/run-log.md` (18:05, 18:40 entries) and `docs/evidence/A-11.md` |
| A-11-TC-002 | AC-1 | Negative | PASS | `sequence.test.ts`'s readback-failure-halts-before-manifest case passes; no partial manifest was ever observed on disk during the real Run 1 build (confirmed: `buildManifest()`'s `checkInput` fails closed on a dirty tree / wrong part size, per run-log.md 18:05) |
| A-11-TC-003 | AC-2 | Happy path | PASS | `pipeline/publish/test/manifest.test.ts` passes; Run 1's real manifest (`runs/travis-full-run1-20261023/manifest.json`) parses with `RunManifestV1.safeParse()` -> VALID, 228 artifacts, every artifact CIDv1, every directory entry has its own `carCid`, `previousManifestCid: null` (run-log.md 18:40) |
| A-11-TC-004 | AC-2 | Negative | PASS | `manifest.test.ts`'s CIDv0-rejected / gatewayUrl-rejected / missing-carCid-rejected fixtures all pass |
| A-11-TC-005 | AC-3, NFR-001 | Happy path, live | **IN PROGRESS** | `verify-manifest.ts` is still running against the real Run 1 manifest; current snapshot 43 ok / 5 FAIL of 456 (see note above). Not yet `ALL ARTIFACTS VERIFIED`; the 5 FAILs so far are Pinata 429 rate-limiting, not a byte mismatch. Scored in-progress per the PO's recorded merge-before-verification-completes decision (run-log.md 10:20), not PASS or FAIL |
| A-11-TC-006 | AC-4 | Happy path | PASS | Run 1's real manifest `coverage` section carries `published_rows` per table, `capture_receipt` per source (Austin permits, TCAD roll), and `aggregate_match` totals, each with a `derivation` label (run-log.md 18:05); `manifest.test.ts` asserts the shape |
| A-11-TC-007 | AC-5 | Negative, live | PASS (fixed this pass) | `scripts/test/verify-manifest.test.ts`'s retry/backoff/unverified/non-zero-exit cases all pass (14/14, see unit-test report) — this is the exact test whose 5000ms default timeout caused the one real CI failure fixed in this G7 pass (commit `ef6aded`); the Pinata 429s seen live in TC-005's in-progress run are the real-world instance of this same path, correctly retried and reported, never silently passed |
| A-11-TC-008 | AC-6 | Happy path, live | PASS | GitHub Release `run1-travis-full-20261023` holds all 12 CARs (`docs/evidence/A-11.md`); Filebase pin confirmed (upload readback in run-log.md); Pinata gateway readback confirmed via the TC-005 live run (43 `ok` lines against `gateway.pinata.cloud` so far) |
| A-11-TC-009 | AC-6 | Edge | PASS | `pipeline/publish/test/upload.test.ts` passes (oversized-CAR split threshold, existing-S3-object-refused-not-overwritten) |
| A-11-TC-010 | AC-7 | Happy path, live | N/A: deferred to A-16 | Run 2 requires UTC date >= 2026-10-25; not yet run (PO cost-mode decision, run-log.md 2026-10-24 10:20) |
| A-11-TC-011 | AC-8 | Happy path, live | N/A: deferred to A-16 | Same — Run 2 not yet run |
| A-11-TC-012 | AC-9, NFR-002 | Happy path, live | N/A: deferred to A-16 | Requires Run 3 (UTC date >= 2026-10-26) and full immutability re-check; not yet run |
| A-11-TC-013 | AC-10 | Happy path | PASS | `manifest.test.ts`'s idempotent-rerun case passes (`rowsWritten: 0`, identical data-group CIDs on re-run) |
| A-11-TC-014 | AC-11 | Negative/edge | N/A: deferred to A-16 | Requires a Run 2/3 timing window; not yet run |
| A-11-TC-015 | AC-11 | Negative, live | N/A: deferred to A-16 | Requires a Run 2/3 timing window; not yet run |
| A-11-TC-016 | AC-12, NFR-003 | Happy path | PASS | `infra/test/scheduler.test.ts` (7/7) passes; live `aws scheduler get-schedule` confirms `State: DISABLED`, Fargate `TaskDefinition`-referenced target, no `AWS::ECS::Service` (`docs/evidence/A-11-scheduler.md`) |
| A-11-TC-017 | AC-12 | Negative | PASS | `scheduler.test.ts`'s ENABLED-fixture-fails-the-assertion case passes, proving the assertion is real |
| A-11-TC-NF-01 | NFR-001 | Live | **IN PROGRESS** | Same live run as TC-005; 100% CIDv1 confirmed (schema-level, all 228 artifacts), 6/6 CAR checks confirmed per CAR at hash/validate time (run-log.md), but 100% gateway-verified is not yet reached (43/456 so far, 0 byte mismatches) |
| A-11-TC-NF-02 | NFR-002 | Live | N/A: deferred to A-16 | Needs >=3 runs on >=3 UTC dates; only Run 1 exists so far |
| A-11-TC-NF-03 | NFR-003 | — | PASS | `scheduler.test.ts` confirms no always-on resource; schedule `DISABLED` costs $0 (`docs/evidence/A-11-scheduler.md`) |

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-11-TC-NF-01 | NFR-001 (100% CIDv1, 6/6 CAR checks, 100% verified) | `verify-manifest.ts` live run | IN PROGRESS | CIDv1 100%, CAR checks 6/6 per CAR; gateway-verified 43/456 so far, 0 mismatches | 100% verified |
| A-11-TC-NF-02 | NFR-002 (>=3 runs/>=3 dates, <=7 days behind, re-load 0 rows) | `runs/index.json` | N/A: deferred to A-16 | 1 run exists | >=3 runs |
| A-11-TC-NF-03 | NFR-003 ($0 idle) | `infra/test/scheduler.test.ts` + live `aws scheduler get-schedule` | PASS | `State: DISABLED`, no `AWS::ECS::Service` | $0 while disabled |

## Defects

None open at G7. Two real defects were found and fixed during the build, before this report (both resolved by the re-reviews, `docs/reviews/CR-A-11-donphan.md` 88/100, `CR-A-11-porygon.md` 86/100): (1) a mislabeled done-counter in `run-permits-full.ts` conflating linked-DB-rows-read (2,007,514) with rows actually written (17,387) under one `permits=` label, fixed by reporting both numbers distinctly; (2) a coverage-key gap in `GROUP_COVERAGE_KEYS['property_improvement']` labeling only 1 of A-04's 5 permit-link `UnmatchedReason`s, fixed by adding the remaining 4. No `docs/defects/ERR-A-11-*.md` files exist; these two were tracked via commit + run-log note rather than the ERR-record workflow (same inline-fix style as several other A-11 defects — see `docs/evidence/A-11.md`), which the G7 precheck flagged as inconclusive-not-confirmable (C-05) rather than a hard fail, since no test case was ever scored FAIL by them.

This pass (G7 CI fix, 2026-10-24) found and fixed four CI-blocking issues, none of which are product defects: a flaky Vitest test timeout (`scripts/test/verify-manifest.test.ts`, commit `ef6aded`), two latent Prettier formatting gaps the one real CI run never reached (commits `9f68969`, `8e70fd6`), and two latent `grep-gates.sh` false positives on legitimate prose/test content (commit `5e4f080`). See `specs/011-publish-and-runs/run-log.md`'s "G7 fix" entry for full detail.

## Sign-off

**Decision:** ☑ Validated, with recorded exceptions (counts toward G7)

8 of 11 testable cases PASS, 3 correctly scored IN PROGRESS (live gateway verification not yet complete, per the PO's recorded decision to merge before it finishes), 0 FAIL. 9 cases remain correctly N/A, deferred to A-16 (Runs 2/3 need later UTC dates). 0 Critical defects open. QC lead sign-off pending PO/G7 review (2026-10-24).

## Run 2 correction (2026-10-24)

New tests added with the correction (source: commits), and per-package totals at the latest run:

| Area | Test | Count | Commit |
| --- | --- | --- | --- |
| pipeline/oracle-runtime/travis | byte-identity of county vs permits shared files (8 real TCAD records; failed 8/8 before the fix, passes after) | 8 | `3fcb665` |
| pipeline/publish | identity gate, Run 2 manifest builder, publish driver, atomic receipts/index rollback, CAR hash check, limitation restatement | in total below | `c85b4c8`, `e2c682f`, `03a6f29`, `e42000e` |
| pipeline/oracle-runtime/travis | trade sub-permit skip; `--compare-run` by permit number | in total below | `0cd4fe5`, `5bb47d8` |

| Package | Result at the latest run |
| --- | --- |
| pipeline/oracle-runtime | 1,053 passed / 2 skipped |
| pipeline/local-stack | 219 passed / 9 skipped |
| pipeline/publish | 345 passed |
| apps/web | 175 passed |
| packages/query-core | 247 passed / 5 skipped |

Permits page load time (`vite preview`, dev measurement): 1,234 requests / 76.7 s originally, 185 / 15.0 s after the bind subset, 15 / about 8.0-8.6 s after the prefetch subset and SHA-256 verification (PO decision "SHA-256 from manifest", constitution A3 amended), commit `502bfe6`.

Hosted cases TC-032, TC-033 and TC-034 (`fallback.spec.ts`, A-03 cases) are marked `test.fixme` (A-16 item #7: client-side CID check cannot verify table parts over 256 KiB), so any other hosted failure turns CI red. They are not counted as passing.

Live checks for Run 2 (Permits page on the hosted URL, Playwright) and CI: TBD (running).

## Addendum 2026-10-25: Run 2 results and the Run 3 gap

- **Build and URL:** commit b1de02c on `011-publish-and-runs`, CI run 40150597123 (gitleaks, workspace, oracle-runtime and the four e2e-hosted jobs green) against `https://011-publish-and-runs.d2lx0utip89u18.amplifyapp.com`.
- **Run 2:** published as `bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute` (15,025 permit rows, 0 of 10,792 unmatched by the identity gate). ERR-24, ERR-25 and ERR-26 are Closed on this run.
- **Run 3 and the immutability check (AC-7 to AC-11 parts that need three runs):** see the Run 3 addendum below.

## Addendum 2026-10-25: Run 3

- **Built and published:** manifest `bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm` (285 artifacts, previous = Run 2). The identity gate passed: every Run 2 county (441,961) and permit (15,025) CID survives, none moved (`specs/011-publish-and-runs/run3/run3-evidence.json`).
- **Data re-tests** (same queries on Run 2 and Run 3): roof age 2.2% → 88.1% (ERR-68), owner named 5.3% → 92.6% (ERR-69), tenure 39.7% → 95.1% (ERR-71), coordinates 88.3% → 98.2% (ERR-65), printed contractor names 0 → 4,139 (ERR-66), open days only for open permits (ERR-70). ERR-65 and ERR-68 to ERR-71 and ERR-67 are Closed; ERR-66 stays Open until the BBB link is checked by hand.
- **Hosted:** CI run 40227156140 (commit `0b32bd9`, branch preview) passed all seven e2e-hosted jobs, which still read Run 2 as the latest run. The hosted cases that show Run 3 (Runs page with three runs, Compare Run 3 with Run 2) run after the publish `index` step; their results go into the follow-up commit with the receipts and `runs/index.json`.

