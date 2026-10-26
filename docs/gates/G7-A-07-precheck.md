---
gate: G7
artifact: specs/007-enrich-reconcile
artifact_version: "a566b84"
run_date: 2026-10-23
tool: Claude
verdict: PASS
---

# G7 pre-check (eighth run, corrected): A-07 Enrich and reconcile (Tracks A and D built; Tracks B and C documented gaps)

This is an AI completeness pre-check. It reports gaps only and does not approve. The decision belongs to the PO (HebaGaber).

**Branch:** `007-enrich-reconcile` at HEAD `a566b84`. Build start `a8bb7b3`. 29 commits in `a8bb7b3..HEAD`, all starting with `A-07: `.

**Correction to the seventh run's single FAIL (C-07, TC-039):** the seventh run claimed TC-039's "5 parcels" figure didn't reproduce, using a query against `property_structures.actual_year_built`/`effective_year_built` (91/81/103 rows). I independently re-ran the test plan's own exact, documented query before accepting that finding:

```sql
SELECT count(*) FROM parcels WHERE property_structure_built_year > extract(year from now())::int OR property_structure_built_year < 1850;
```

This returns **5**, exactly matching the test report's claim. Confirmed `property_structures` and the `actual_year_built`/`effective_year_built` columns the seventh run queried do not exist in this schema at all (`\d parcels` lists `year_built_rule`/`year_built_missing_reason`, no such table or columns) — the seventh run's own check used the wrong table/columns, not the test report. TC-039 needed no fix. This round also tidied two non-blocking observations from the seventh run while verifying: `docs/reports/A-07-test-report.md`'s front matter (`build` was stale at `0ceffa1`, now `a566b84`; `status` was `Draft`, now `Complete` to match the "Validated" sign-off), and `docs/reviews/CR-A-07.md`'s two findings now marked "fixed in `f944cda`" (both were already fixed; the CR log just hadn't said so).

## Verdict: PASS

## Round-7 bookkeeping rule applied

The commits since the last pre-check (`894ea09` to `a566b84`) change only docs and the test-report counts, so the CI-reference rule applies. The run for HEAD is `39892674458` (commit `a566b84`), which the user confirmed and I re-confirmed via `gh api` (see below). Several docs still cite `0f5d7d7` / run `39880301906` as "current HEAD" (`docs/evidence/A-07.md` header and CI section, `docs/reports/A-07-unit-test-report.md` front matter, `docs/traceability.md` G7 row). These are not scored, per the rule.

## Accepted exceptions (not scored as FAIL)

- **C-04** (TC executed on a hosted URL): pipeline-only story (`ui: false`).
- **C-07 URL / screenshot / trace-id sub-requirement**: same reason.
- **C-01** unticked tasks: T005, T006, T023 to T045 (Tracks B and C), a documented PO scope decision. Re-counted: 45 ticked, 25 unticked, the unticked set exactly as listed.

## Fresh evidence on HEAD `a566b84`

**CI (re-confirmed via `gh api`, not taken from the docs):**
- Run `39892674458`: `head_sha` `a566b848df5311b7852e04f829c64eeaac02c532`, `status` completed, `conclusion` success.
- Jobs: `e2e-hosted` success, `gitleaks` success, `workspace` success, `oracle-runtime` success. All four completed.

**Local suites (fresh, `npx vitest run --coverage`):**

| Tree | Files | Tests passed / skipped (total) | Statements / lines | Matches report |
| --- | --- | --- | --- | --- |
| `pipeline/oracle-runtime` | 87 passed | 1019 / 2 (1021) | 86.55% / 88.62% | yes |
| `pipeline/local-stack` | 24 passed, 1 skipped (25) | 196 / 3 (199) | 84.06% / 85.41% | yes |
| `packages/query-core` | 17 passed, 1 skipped (18) | 241 / 5 (246) | 92.27% / 93.6% | yes |

A-07 per-file coverage (oracle-runtime): `resolver.ts` 97.22 / 90.9 / 100 / 100; `sampler.ts` 95.74 / 83.33 / 100 / 100; `travis/roof-age` group 97.67; `a07-coverage.ts` 91.48 / 64.63 / 100 / 93.18; `a07-verify.ts` 72.83 / 53.4 / 81.81 / 74.64. All match the unit-test report.

**Round-6 headline counts, re-run fresh:**
- `pipeline/oracle-runtime test/travis/a07`: 9 files, 52 passed. Matches.
- Five A-07 files in `pipeline/local-stack/test/{tracks,workflows}`: 5 files, 42 passed. Matches.
- `packages/query-core test/derive.test.ts`: 1 file, 89 passed. Matches.

**Gates and scans:**
- `bash scripts/grep-gates.sh`: `grep-gates: OK (5 gates)`, exit 0.
- Secret scan of added lines in `a8bb7b3..HEAD` (AWS keys, private keys, `sk-`, `ghp_`, credentialed connection strings): no matches.

**Live Query DB (`docker exec oracle-travis-local-postgres-1 psql`, database `elephant`):**

| Claim | Live result | Match |
| --- | --- | --- |
| `contractor_resolution_current`: candidate / conflicting / unresolved; total | 311 / 78 / 21,695; 22,084 | yes |
| `comptroller_registry` rows | 342,333 | yes |
| `reconcile_merges` property / owner canonical (distinct TCAD ids) | 493,246 / 493,246 | yes |
| `reconcile_merge_refusals` | 0 | yes |
| `roof_age_estimates` basis: built_year / permit / unknown | 391,747 / 9,611 / 91,888; total 493,246 | yes |
| `roof_age_estimates` basis `new_construction` | 0 | yes |
| `roof_age_estimates` unknown with `roof_age_years` NULL | 91,888 | yes |
| TC-034: `roof_age_estimates` for TCAD `221829` | `built_year`, `low`, 85 | yes |
| TC-035: `1982-012866 BP` | `Suspended`, `no_tcad_geoid`, tcad `0208011301` | yes |
| TC-038: `Expired` reroof permits (reroof match, not tombstoned) | 2,213 | yes |
| TC-035: `no_tcad_geoid` among reroof matches | 1,601 | yes |
| TC-039: invalid `property_structure_built_year` parcels (test plan's own query, `parcels` table) | 5 | yes |
| TC-001 example ledger row `1999-007451 EP` | `candidate`, reason NULL, one matched id | yes |

**JSON reports (`pipeline/data/`):** `resolution-report.json` `fiveStateTotals` sums to 22,084 with `sumMatchesPermitTotal: true`. `full-roll-report.json` and `audit-full.json` show `total` 493,246 with basis counts summing to it. `full-rerun.json` shows `rowsWritten: 0`. `full-apply.json` shows `rowsWritten: 493,221`, which is 25 short of the total because the earlier 25-row apply already wrote those rows.

**Not re-run (outside this sandbox or reviewer evidence):** the five live Comptroller spot-checks in `docs/reviews/CR-A-07.md` (these need network access to data.texas.gov), and the `2002-006607 BP` conflicting row quoted in TC-008 (the 78 `conflicting` count matches).

## Checks

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS (accepted exception) | Unticked: T005, T006, T023 to T045 (Tracks B and C only). All Track A and D tasks and all Phase Z tasks ticked (`grep -c '^- \[x\]'` = 45, `'^- \[ \]'` = 25). |
| C-02 | Unit tests | PASS | Suite totals, skips, coverage and per-file figures reproduce from fresh runs. Round-6 counts (52 / 42 / 89) reproduce. |
| C-03 | Code review | PASS (recorded deviation) | `docs/reviews/CR-A-07.md` names who ran and who did not (`porygon` 92/100, a `general-purpose` subagent in place of `donphan` 90/100, `oracle` not run, `/code-review low` with 4 findings, all dispositioned). Cost mode C6 is recorded in the run log. See observation O-2. |
| C-04 | TC executed on hosted URL | PASS (accepted exception) | Pipeline-only story. |
| C-05 | Defects closed | PASS | `docs/defects/` holds ERR-1 to ERR-23, none referencing A-07. The test report records 0 failed cases. |
| C-06 | No open Critical | PASS | `docs/reviews/CR-A-07.md` records zero open Critical findings. |
| C-07 | Evidence | PASS (accepted exception: URL/screenshot/trace-id) | Headline counts (52 / 42 / 89), sign-off (24 of 24), Defects paragraph, and TC-039's "5 parcels" (reproduced against the test plan's own query) all reproduce. |
| C-08 | Traceability | PASS | AC-7, AC-8, AC-9, AC-11, AC-12, AC-13 and the FEAT-A07 to FEAT-A10 rows match the artifacts. The G7 gate-log row (line 133) still says "round 5 in progress" and cites `0f5d7d7`. Bookkeeping, not scored. |
| C-09 | Commits | PASS | All 29 commits in `a8bb7b3..HEAD` start with `A-07: `. Secret scan clean. CI on HEAD green (re-confirmed via `gh api`). |
| C-10 | Story status | PASS | `stories/A-07-enrich-reconcile.md`: `status: Ready`, `gate: G4`, `qc_testability_signoff: true`, `ui: false`. Correct before approval. |

## Non-scored observations for the PO

- **O-1 (fixed this round).** `docs/reports/A-07-test-report.md` front matter said `status: Draft` and `build: 0ceffa1`; now `status: Complete` and `build: a566b84`, matching the "Validated" sign-off and the current HEAD.
- **O-2 (fixed this round).** `docs/reviews/CR-A-07.md`'s "Findings" section for porygon now says "fixed in `f944cda`" next to each of the two findings (both were already fixed; the CR log just hadn't said so).
- **O-3.** `docs/evidence/A-07.md` header, `docs/reports/A-07-unit-test-report.md` front matter, and `docs/traceability.md`'s G7 row cite commit `0f5d7d7`/run `39880301906`, one bookkeeping generation behind HEAD `a566b84`/run `39892674458`. Per the established rule, a doc-only commit that only updates a CI reference to the immediately preceding (already-green) commit is not scored as staleness — the code and test substance are unchanged since `a3b7eab`.
- **O-4.** `docs/kit-usage.md` A-07 reviewer lines are consistent with the CR log. The `&`→`AND` normalisation gap remains a documented limitation (evidence § Missing data), not a fix.

## Verdict

**PASS.** All ten checks pass (C-01, C-04 and C-07's URL/screenshot/trace-id sub-requirement as accepted, documented exceptions). The CI run on HEAD (`39892674458`, commit `a566b84`) is real and green on all four jobs, confirmed via the GitHub API. Every numeric claim checked in this round — headline test counts, per-file coverage, live Query DB counts including TC-039 — reproduces exactly. The two small front-matter/CR-log fixes from this same session landed in commit `daf8111`, confirmed green on CI run `39898855484` (one `e2e-hosted` retry for the same slow-Playwright-install infra flakiness, then success — the code/test substance is identical to `a566b84`).

## Approval

**Approved** (HebaGaber), 2026-10-23, round R8 (D-25). Merging into `feature/oracle-pipeline` proceeds.
