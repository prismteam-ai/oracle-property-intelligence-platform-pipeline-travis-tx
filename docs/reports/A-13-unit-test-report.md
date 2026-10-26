---
id: UT-A-13
type: unit-test-report
story: A-13
branch: 013-explorer-and-pages
commit: dc46a6d
code_commit: c800181
ci_run: "GitHub Actions run 39835352646, success, 2026-10-22, commit 2c13e09 (code identical to 2cc58ac): https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39835352646"
created: 2026-10-22
---

# Unit and Integration Test Report: A-13

**History.** First written at `70561ec` (93 files, 1,326 tests, 1,319 passed, 7 skipped); a fresh run at `015fbf9` gave 1,448 passed; refreshed at `2e14516` on 2026-10-22 (16:50): 103 files, 1,492 tests, 1,484 passed, 8 skipped, 0 failed, 15.90 s**; **final local run at `2cc58ac` on 2026-10-22: 103 files (102 passed, 1 skipped), 1,497 tests, 1,489 passed, 8 skipped, 0 failed.** The final CI run (39835352646, commit `2c13e09`, code identical to `2cc58ac`) passed `workspace`, `oracle-runtime`, `gitleaks` and `e2e-hosted`; its coverage gates and bundle gate are in the table. The per-project table and the whole-workspace coverage row below were not re-measured and still describe `70561ec`.

**CI failure history (ERR-49).** The first two runs that reached the `workspace` job on the GitHub runner (39819086782 and 39826467354) failed on timing races in web unit tests: a loaded runner is slower than the author's laptop, so fixed short waits in the Catalog footer, debounce and similar tests expired before the page had rendered. The fix was central, generous async waits in `apps/web/test-setup.ts` and tests that wait for the footer-derived row count (ERR-49, commits `0967d68` and `2cc58ac`), with no change to the tested code; run 39835352646 is the first fully green run.

The numbers below come from local command output on 2026-10-22 (about 00:54 to 01:00 EEST, UTC+3) on branch `013-explorer-and-pages` at commit `70561ec`. The only modified file in the tree during the runs was `specs/013-explorer-and-pages/run-log.md`. These are **local unit tests only**. They do not prove the hosted runtime. The hosted Playwright specs are reported in `docs/reports/A-13-test-report.md` (they also ran on the GitHub runner in CI run 39835352646).

Environment for every command (no credentials read):

```sh
export CDK_DEFAULT_REGION=eu-north-1 CDK_DEFAULT_ACCOUNT=000000000000 OPERATOR_EMAIL=ops@example.invalid
```

| Item | Value |
| --- | --- |
| Command | `pnpm test` (`vitest run --passWithNoTests`, all workspace projects) |
| Files / tests | 103 files / 1,497 tests at `2cc58ac` (103 / 1,492 at `2e14516`; 93 / 1,326 at `70561ec`) |
| Passed / failed / skipped | **1,489 / 0 / 8** at `2cc58ac` (102 files passed, 1 file skipped; local `pnpm test`, 2026-10-22); 1,484 / 0 / 8 at `2e14516`; 1,319 / 0 / 7 at `70561ec` |
| CI run | 39835352646 (commit `2c13e09`, code = `2cc58ac`): `pnpm turbo run typecheck lint test synth` green on the runner (no failed test), so the unit tests pass on a loaded runner as well as locally |
| Duration | 15.90 s at `2e14516` (15.86 s at `70561ec`) |
| Coverage, `packages/query-core` | src: lines 98.58 % · branches 90.39 % · functions 100 % · statements 96.43 %. gazetteer: lines 88.12 % · branches 81.16 % · functions 86.96 % · statements 85.83 %. **PASS** against 80 % on all four metrics in both parts. **CI gate (run 39835352646): PASS ≥ 80 % lines and branches**; the CI table reads all files 96.19 % lines · 88.25 % branches (src 98.11 · 89.72; gazetteer 88.11 · 81.15) |
| Coverage, `packages/contract` | 100 % lines, branches, functions, statements. **PASS** against 80 %. **CI gate (run 39835352646): PASS**, 100 % on all four metrics |
| Coverage, whole workspace include set | lines 92.43 % · branches 81.58 % · functions 91.39 % · statements 90.06 % |
| `pnpm typecheck` | clean (no output, exit 0) |
| `pnpm lint` | clean (no output, exit 0) |
| Bundle size (CI) | run 39835352646, bundle gate: initial JS **220.9 KB gz (226,184 B)** against the 300 KB limit, DuckDB chunks excluded: **PASS**; Hub graph **124.6 KB gz (127,583 B)** against 150 KB: **PASS**; placement OK. Local at `2e14516`: 220.9 KB (226,177 B) and 124.6 KB (127,575 B) |
| Bundle size (local) | at `2e14516`, after a fresh `pnpm --filter @countylens/web build`: initial JS **220.9 KB gz (226,177 B)** against 300 KB limit, DuckDB chunks excluded: **PASS**. Hub graph **124.6 KB gz (127,575 B)** against 150 KB: **PASS**; placement OK. (`70561ec`: 217.2 KB and 123.8 KB) |

## Coverage method and a caveat

The `@vitest/coverage-v8` provider is configured in the root `vitest.config.ts`. I ran `pnpm vitest run --coverage --coverage.reportOnFailure=true --coverage.reporter=json-summary` once over the whole workspace and summed covered and total counts per package from `coverage-summary.json` (the include set is in the root config). I did not use the `--filter` form: the project is one root Vitest workspace, so one run covers both packages.

**The coverage run is not fully green.** With `--coverage` on, 2 tests fail (1,322 passed, 2 failed, 7 skipped, 1,331 tests, run twice with the same result). Both are in `apps/web/test/app-shell.test.tsx`, ERR-12: `.toggle` and `.tab` report an empty CSS rule body (`.toggle {}`, `.tab {}`), so the "declares font: inherit" check fails. The same two tests pass in the plain `pnpm test` run. I did not investigate the cause: it looks like the coverage run reads the CSS Module differently, but that is a guess, not a finding. It does not touch the `packages/query-core` or `packages/contract` numbers above. Open item: find out why, or run coverage so the two runs agree, before G7.

## Per project (plain `pnpm test`, 93 files)

Coverage columns are from the coverage run (lines / branches). `n/a` means the project is not in the coverage include set.

| Project | Files | Passed | Skipped | Failed | Lines / branches |
| --- | --- | --- | --- | --- | --- |
| packages/query-core | 19 | 271 | 6 | 0 | src 98.58 / 90.39 · gazetteer 88.12 / 81.16 |
| packages/contract | 3 | 58 | 0 | 0 | 100 / 100 |
| packages/shared | 3 | 40 | 0 | 0 | 100 / 92.00 |
| packages/api-client | 1 | 4 | 0 | 0 | 83.33 / 71.43 |
| packages/eslint-config | 1 | 18 | 0 | 0 | n/a |
| apps/api | 8 | 164 | 0 | 0 | 93.68 / 80.87 |
| apps/web | 30 | 326 | 0 | 0 | 90.66 / 81.15 |
| infra | 7 | 93 | 1 | 0 | n/a |
| scripts | 3 | 73 | 0 | 0 | n/a |
| profiles/travis-austin@1.0.0 | 6 | 79 | 0 | 0 | 90.83 / 85.54 |
| pipeline/publish | 12 | 193 | 0 | 0 | 91.42 / 77.73 |
| **Total** | **93 (incl. 1 skipped file)** | **1,319** | **7** | **0** | 92.43 / 81.58 |

Per-project file counts add to 93 (the one all-skipped file is counted in its package). The 80 % requirement (NFR-09) covers only `packages/query-core` and `packages/contract`, and both pass. Below 80 % on one metric, not a story gate: `packages/api-client` (branches 71.43, functions 75.00) and `pipeline/publish` (branches 77.73). `pipeline/oracle-runtime` is its own npm project and was **not run** for this report.

## Skipped tests (8 at `2e14516`; the table lists the 7 of `70561ec`), each an explicit skip with a stated reason

| Test | Why it is skipped |
| --- | --- |
| `packages/query-core/test/explore.test.ts` › exploreSearchSql over the published run | `PUBLISHED_TABLES_DIR is not set`. It needs a local copy of the latest run's `tables/` fetched by CID. This is the only A-13 skip; it was not run in this report |
| `packages/query-core/test/carrier-emission.test.ts` › A-02-TC-004 | `PILOT_DIR is not set` |
| `packages/query-core/test/carriers.test.ts` › each carrier's pilot row exists | needs `PILOT_DIR` |
| `packages/query-core/test/sample.test.ts` › contract/v1 sample row-for-row | `PILOT_DIR is not set` |
| `packages/query-core/test/views.pilot.test.ts` › views over the pilot export (T058) | `PILOT_DIR is not set` |
| `packages/query-core/test/acceptance/a02.acceptance.test.ts` › A-02 pilot cases | `PILOT_DIR is not set` |
| `infra/test/api.test.ts` › `COUNTYLENS_BUNDLE=1` real asset holds the linux-arm64 DuckDB binary and httpfs | runs only with `COUNTYLENS_BUNDLE=1`; not run here |
| `apps/web/test/html-hints.test.ts` › built `dist/index.html` preconnects to the configured CID copy host (added since `70561ec`) | skipped unless `VITE_CID_COPY_HOST` is set for the test run (8th skip at `2e14516`) |

## New and changed A-13 test files (git diff of `74d7235^..HEAD`)

Grouping by task group is by file name and content; the authoritative task-to-test map is `specs/013-explorer-and-pages/tasks.md` and `testplans/A-13-test-cases.md`.

**G1 data and query layer (new):** `packages/query-core/test/explore.test.ts`, `packages/query-core/test/places.test.ts`, `apps/api/test/explore.test.ts`, `apps/web/test/data-modules.test.ts`, `packages/shared/test/a13-labels.test.ts`. Changed: `infra/test/web.test.ts`, `infra/test/amplify-build.test.ts`; new `infra/test/web-stack.test.ts`.

**G2 Explorer (new, `apps/web/test/`):** `explore-filters.test.tsx`, `explore-owner.test.tsx`, `explore-permits.test.tsx`, `explore-sql.test.tsx`, `property.test.tsx`, `compare.test.tsx`, `county-select.test.tsx`, `error-banner.test.tsx`. Changed: `app-shell.test.tsx`.

**G3 content pages (new, `apps/web/test/`):** `hub.test.tsx`, `catalog.test.tsx`, `coverage.test.tsx`, `manifest.test.tsx`, `verify.test.tsx`, `runs-log.test.tsx`, `help-mcp.test.tsx`, `legal.test.tsx`, `coming-soon.test.tsx`, `coming-soon-entries.test.tsx`. Changed: `runs.test.tsx`.

**G4 e2e support (Vitest, local) and hosted specs:**
- Vitest unit tests for the e2e helpers (they run in `pnpm test`): `tests/e2e/lib/a13.test.ts`, `a13-routes.test.ts`, `a13-ui.test.ts`, `a13-vitals.test.ts`, `evidence-target.test.ts`; also `scripts/test/bundle-graph.test.ts`.
- Hosted Playwright specs, **written, not run on a hosted URL**: `tests/e2e/A-13-explorer.spec.ts`, `A-13-pages.spec.ts`, `A-13-perf.spec.ts`, `A-13-scan.spec.ts`, `A-13-verify.spec.ts`, `A-13-vitals.spec.ts` (73 specs per the task brief; I did not independently re-count them because `playwright test --list` needs the hosted-URL config). Changed: `tests/e2e/runs.spec.ts`.
- Test cases: `testplans/A-13-test-cases.md`.

## Tests written first (TDD)

Not re-verified for this report. The red-then-green order is recorded in the commits (`64733c9` wave 1, `0ac0d03` wave 2, `70561ec` wave 3) and `specs/013-explorer-and-pages/run-log.md`; I did not replay a failing-first run per task.

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| `app-shell.test.tsx` ERR-12 `.toggle` and `.tab` (coverage run only) | CSS Module rule body reads empty under `--coverage`; passes without it. Cause not investigated | open, see caveat above |

## Not measured

- Hosted Playwright specs (73): not part of `pnpm test`; their hosted results are in `docs/reports/A-13-test-report.md` (72 passed incl. TC-040, 1 skipped on the runner in CI run 39835352646; 71 passed, 1 skipped, 1 failed on `2e14516` on the author's slow link).
- `exploreSearchSql` over the published run in Vitest: skipped (`PUBLISHED_TABLES_DIR` unset). A separate measurement over the published run is in the demo-area note, not in this test run.
- `pipeline/oracle-runtime` tests, CDK bundled-asset test (`COUNTYLENS_BUNDLE=1`), pilot-export tests (`PILOT_DIR`).
- The bundle numbers in the table were taken after a fresh build at `2e14516`; the `70561ec` run had read an existing `dist`.
- Smeargle/Lighthouse, Web Vitals, a11y scans: Stage 6 on the hosted URL.

## Update 2026-10-25 (merge with A-04, A-07, A-11 and the Run 2 fixes)

CI run 40185511164 on `dc46a6d`: job `workspace` (typecheck, lint, unit tests, synth) and `oracle-runtime` succeeded. Local counts on the same code: web  506 passed | 1 skipped (507), e2e harness 92, infra 104, publish 345, query-core 284, api 166, contract 58, profile 79, shared 40. New or changed unit tests: Catalog table grouping across export batches, the run chain and run events on the committed Runs 1 and 2, the e2e harness serving every committed manifest, `publishedTexts`/`withoutPublished`, and the infra check for the 29 s API timeout.
