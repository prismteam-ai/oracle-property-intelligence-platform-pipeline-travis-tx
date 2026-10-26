---
id: UT-A-01
type: unit-test-report
story: A-01
branch: 001-discover-sources
commit: 56e1426 (CI run); e5f5d77 (first local run)
ci_run: https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39490116172
created: 2026-10-20
---

# Unit and Integration Test Report: A-01

## CI status

**CI run (the numbers the template asks for):** [`pipeline-ci` run 39490116172](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39490116172) on commit `56e1426`, branch `001-discover-sources`, 2026-10-20, conclusion **success** on both attempts (attempt 2 rerun to confirm the ERR-8 fix). Earlier: run 39488773733 on `2200636` green; run 39489669571 on `de1b54e` and run 39489908500 on `024d9c0` red, 1 of 502 (ERR-8, a timing-sensitive download test, fixed). Its steps: `npm ci`, typecheck, lint, format check, unit tests, the validator self-test, `check-catalog` rules 1–11, and the validator on the committed catalog equal to `docs/evidence/A-01-readiness.json`, all passing.

| Item | CI value |
| --- | --- |
| Command | `npm test` (Vitest 5.0.5, `pipeline/oracle-runtime`) in `pipeline-ci` |
| Suites / tests | 35 files / 502 tests |
| Passed / failed / skipped | 502 / 0 / 0 |
| Duration | 13.45 s (attempt 2) |

The project-wide Turborepo CI arrives in A-03; `pipeline-ci` (task T052) is the interim workflow for A-01. CI does not run coverage; coverage below comes from the local run.

### First local run (before CI existed on the branch)

Local run: 2026-10-20T14:03:34Z, macOS (darwin-arm64), Node 22.23.3, Vitest 5.0.5, Python 3.15.0 with PyYAML 6.0.3, commit `e5f5d77`, in `pipeline/oracle-runtime/`.

| Item | Value |
| --- | --- |
| Command | `npx vitest run --coverage.enabled --coverage.provider=v8 --coverage.include='travis/**'` (same test set as `npm test`) |
| Suites / tests | 129 suites in 33 files / 422 tests |
| Passed / failed / skipped | 422 / 0 / 0 |
| Coverage of new and changed code | **92.6% lines** (2,556 / 2,760); statements 89.73%, functions 87.72%, branches 77.64%. All 36 source files under `travis/` are new on this branch, so whole-folder coverage is new-code coverage (target 80% or more: met on lines, statements and functions; branches are below it). |
| Duration | 5.45 s with coverage (3.35 s without) |

Coverage re-measured on the current code after the review fixes and T056: lines 92.85% (3,156 / 3,399), statements 89.87%, functions 86.63%, branches 77.51%.

Coverage needed the dev dependency `@vitest/coverage-v8` (`^5.0.5`, matching Vitest), added for this report.

Other checks on the same commit:

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Format | `npm run format:check` | "All matched files use Prettier code style!" |
| Validator self-test | `python3 kit/use-oracle/scripts/validate-county-readiness.py --self-test` (vendored kit validator, unmodified, SHA-256 `5c5b8515…abb3d`) | "readiness self-test passed", exit 0 |

Not part of this report: the acceptance suite (`npm run test:acceptance`, T055), which reads the live catalog and evidence, and the readiness run on the real catalog (exit 0, overall PASS; see `docs/evidence/A-01.md`).

### Lowest line coverage

| File | Lines covered |
| --- | --- |
| `travis/discovery/run-validator.ts` | 69.56% of 46 |
| `travis/lib/zip-entry.ts` | 73.80% of 84 |
| `travis/lib/command.ts` | 75.00% of 8 |
| `travis/lib/log.ts` | 82.75% of 29 |
| `travis/discovery/resolve.ts` | 83.33% of 36 |

## Tests written first (TDD)

`specs/001-discover-sources/tasks.md` lists each phase's test tasks before its build tasks. Git history cannot confirm that each test failed before its code existed: in every phase the tests and the code arrived in the same commit (for example `36d567e`, Phase 2). The "Failed first?" column says so instead of claiming it.

| Task | Test file | Tests | Failed first? | Now |
| --- | --- | --- | --- | --- |
| T005 | `test/source-client.test.ts` | 23 | not verifiable (same commit as code) | PASS |
| T006 | `test/catalog.schema.test.ts` | 16 | not verifiable | PASS |
| T007 | `test/status-map.test.ts` | 11 | not verifiable | PASS |
| T008 | `test/write-catalog.test.ts` | 14 | not verifiable | PASS |
| T015 | `test/measure.test.ts` | 21 | not verifiable | PASS |
| T016 | `test/probes/socrata.test.ts` | 8 | not verifiable | PASS |
| T017 | `test/probes/tcad.test.ts` | 24 | not verifiable | PASS |
| T018 | `test/probes/arcgis.test.ts` | 8 | not verifiable | PASS |
| T019 | `test/check-catalog.sources.test.ts` | 32 | not verifiable | PASS |
| T027 | `test/probes/census.test.ts` | 10 | not verifiable | PASS |
| T028 | `test/profiles/jurisdictions.test.ts` | 18 | not verifiable | PASS |
| T029 | `test/check-catalog.permits.test.ts` | 25 | not verifiable | PASS |
| T034 | `test/workflow.blocked.test.ts` | 24 | not verifiable | PASS |
| T035 | `test/blocked-evidence.test.ts` | 7 | not verifiable | PASS |
| T040 | `test/destination-proof.test.ts` | 8 | not verifiable | PASS |
| T041 | `test/run-validator.test.ts` | 8 | not verifiable | PASS |
| T042 | `test/render-sources-md.test.ts` | 11 | not verifiable | PASS |
| T043 | `test/check-catalog.hygiene.test.ts` | 21 | not verifiable | PASS |

Tests added after the task list, with the fix or command they cover (same commit as the code):

| Commit | Test file | Tests | Now |
| --- | --- | --- | --- |
| `bbcbd2d` (live-run fixes) | `test/run1-bugfix.test.ts` | 14 | PASS |
| `acabc74` (resumable download) | `test/source-client.resume.test.ts` | 12 | PASS |
| `0f5922a` (TCAD certification date) | `test/refresh-tcad-landing.test.ts` | 7 | PASS |
| `fdf16d8` (US-runner GIS count) | `test/record-gis-runner.test.ts` | 16 | PASS |
| `9ae3f5f` (jurisdiction re-probe) | `test/reprobe-jurisdictions.test.ts`, `test/jurisdiction-explanation.test.ts` | 9 + 10 | PASS |
| `14b88ee` (parcel-gap reconciliation) | `test/reconcile-parcel-gap.test.ts` | 12 | PASS |

The remaining files (`catalog-text`, `discover`, `log`, `probes/evidence`, `rescan-tcad`, `workflow.shell`, `workflow.us1`, `workflow.us2`) cover the workflow shell, commands and helpers: 53 tests, all PASS (289 + 80 + 53 = 422).

## Failures and flakes

One flaky test, fixed: ERR-8 (`source-client.resume.test.ts`, the download total-limit test; red on two CI runs, green on the fix commit, twice).

Defects found on real data, each fixed with a test:

| Test | Cause | Action |
| --- | --- | --- |
| `reconcile-parcel-gap` geometry form | The export writes a missing point as the string `"[null, null]"`, not `null`; the first real run counted every real-estate account as having a point | fixed in `14b88ee` (a point is a string holding two finite numbers) |
| `check-catalog.hygiene` rule 9 | The home-path detector fired on a URL path segment (`…/publicportal/home/newrequest`, Manor) | fixed in `9ae3f5f` (http(s) URLs are skipped; Windows home paths now caught) |
| `run1-bugfix` | Live run 1: broken-download next step, challenge false positives, network error vs timeout, BBB anti-bot text | fixed in `bbcbd2d` |
