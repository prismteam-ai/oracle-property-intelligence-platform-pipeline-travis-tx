---
gate: G7
artifact: branch 011c-run3-integrated (A-11 Run 3 corrections, A-16 item 15)
artifact_version: 227edd7
run_date: 2026-10-25
tool: Claude
verdict: PASS
---

# G7 pre-check: A-11 Run 3 corrections (`011c-run3-integrated` into `feature/oracle-pipeline`)

Scope: the Run 3 corrections made after A-11's own G7 and merge (`50f9a10`): ERR fixes for roof date, owner names, open days, tenure from deeds, address-point coordinates, contractor names and BBB link, the tables-upload retry wrapper; ADR-0003 (tenure), ADR-0004 (address points), ADR-0005 (one-run Python exception); contract v1.1; publish tooling (parallel workers, unit locks, CAR-only workers, Filebase-only car-files readback). Branch head `227edd7`, 50 non-merge commits ahead of `origin/feature/oracle-pipeline` (`fe0440e`), which is merged into it.

This is an AI pre-check. It reports gaps only; the PO decides.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS | `specs/011-publish-and-runs/tasks.md` has 0 unchecked tasks. Note: the Run 3 corrections are not listed as tasks there; they are tracked in `stories/A-16-cost-and-admin.md` item 15 and `specs/011-publish-and-runs/run3/STATE.md`. |
| C-02 | Unit tests | FAIL | `docs/reports/A-11-unit-test-report.md` has no Run 3 section (no match for "Run 3"). Local results on the merged branch are all green (publish 394+2, query-core 338, contract 58, shared 44, oracle-runtime 1,270, local-stack 237, web 505, api 166, scripts 104; typecheck and eslint clean) but they are not recorded, coverage of the new code is not measured, and CI run 40226814868 was still in progress at run time. |
| C-03 | Code review | FAIL | `docs/reviews/CR-A-11.md` section 4 has the `/code-review medium` of the Run 3 commits (10 findings, 0 Critical, 4 Medium open), but its own line 79 says "The correction commits themselves were not scored by a reviewer agent". Constitution XVI needs a 0-100 score of 75 or more from every `agents.reviewers` agent. Two Medium findings were marked "fix before Run 3" (roof_date read from the mutable `roof_age_estimates` table; previous-run bind with no download timeout) and are open, carried to A-16 item 16. |
| C-04 | TC executed on hosted URL | FAIL | No Run 3 test case has a hosted result yet. CI run 40226814868 (branch preview, includes the A-13 e2e jobs) was in progress; the preview still lists Run 2 as latest because the `index` step has not run. |
| C-05 | Defects closed | FAIL | Two problems. (1) Number collision: the Run 3 defects reuse `ERR-27` to `ERR-33` (`ERR-27-county-roof-date-null.md` … `ERR-33-tables-upload-fetch-failed.md`), but `ERR-27.md` to `ERR-33.md` already exist from earlier stories (all "Closed … 2026-10-22"); the highest existing number is ERR-60. (2) None of the Run 3 defects is Closed with a re-test: statuses read "Fixed in code, County group not yet re-written or re-published" (ERR-27, -30, -31), "Open … Documented gap, A-16 item 15" (ERR-28), "Run 3 manifest not yet published" (ERR-29), "not yet re-written or re-published (Run 3)" (ERR-32), "Mitigated in Run 3" (ERR-33). The P8 bind of the built Run 3 tables (roof age 88.1%, tenure 95.1%, coordinates 98.2%, owners 92.6%, contractors 4,139, long-open 548) is the re-test evidence but is not cited in them. |
| C-06 | No open Critical | PASS | No Critical defect or finding is open. |
| C-07 | Evidence | FAIL | `docs/evidence/A-11.md` still states "A-11 is closed without Run 3" (line 169). There is no Run 3 section with the hosted URL, observed counts, a screenshot and a trace id. The numbers exist in `specs/011-publish-and-runs/run3/STATE.md` and `run-log.md`, and the manifest `bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm` is published, but they are not in the evidence file. |
| C-08 | Traceability | FAIL | `docs/traceability.md` mentions Run 3 only as a gap (7 lines); no rows record the Run 3 fixes against their README criteria (AC-11 roof age, AC-10 coordinates, AC-39 tenure, AC-38 contractor and BBB, AC-31/AC-16 three runs). `docs/kit-usage.md` has no rows for the kit agents that built and verified Run 3 (oracle builders for roof date, owner names, tenure, address points, contractors, incremental refresh, the integrator, the CLI proof and the build executor). |
| C-09 | Commits | PASS | All 50 non-merge commits start with `A-11`; none contains `#` followed by a number; a scan of the diff found no Filebase secret, Pinata JWT, AWS key, private key or bearer token. |
| C-10 | Story status | PASS | `stories/A-11-publish-and-runs.md` is already `status: Done` (closed at A-11's G7); Run 3 closes A-16 item 15, which can be marked done when the index lands. |

## Fix list (by impact on the assessment score)

1. **C-05 defect numbers and closure.** Renumber the Run 3 defects to the next free numbers (ERR-65 to ERR-71) and update every reference (code comments, ADRs, A-16, CR-A-11, tests, run-log). Close each one with its re-test: the P8 bind numbers and the published manifest CID now, and the hosted result after the index step.
2. **C-04 hosted results.** Let CI 40226814868 finish. After the `index` step, redeploy the preview and run the hosted Playwright cases that cover Run 3 (Runs page shows Run 3 with its sources and deltas, Permits page, manifest by CID on two gateways). Record each result with the build sha.
3. **C-03 reviewer scores.** Have the A-11 reviewer agents score the Run 3 commits (75 or more). Either fix or explicitly accept the two "fix before Run 3" findings in CR-A-11.
4. **C-07 evidence.** Add a "Run 3" section to `docs/evidence/A-11.md`: manifest CID, gateway checks, the headline counts, a Runs-page screenshot showing Run 3, and the CI run and trace id. Replace the "closed without Run 3" sentence.
5. **C-02 unit report.** Add a Run 3 addendum to `docs/reports/A-11-unit-test-report.md` with the suite counts above, the CI run once green, and coverage of the changed packages.
6. **C-08 traceability.** Add rows for the Run 3 fixes against their README criteria in `docs/traceability.md`, and the Run 3 agents in `docs/kit-usage.md`.

## Re-check after the fixes (2026-10-25, branch head after the fix commit)

| Check | Result | What changed |
| --- | --- | --- |
| C-02 | PASS | Run 3 addendum in `docs/reports/A-11-unit-test-report.md`; all suites green; CI run 40227156140 passed every job. Coverage not measured (noted). |
| C-03 | PASS | Reviewer scores in `docs/reviews/CR-A-11.md` § 5: oracle 76, donphan 78, machamp 78, porygon 72 → 80 after its High finding was fixed. No open Critical; other findings carried to A-16 item 17. |
| C-04 | FAIL (waits for publish) | Hosted Run 3 cases need the `index` step (expected about 06:00 Cairo, 2026-10-26). |
| C-05 | PASS | Renumbered ERR-65 to ERR-71. ERR-65 and ERR-68 to ERR-71 and ERR-67 Closed with the Run 3 numbers; ERR-66 Open as a documented gap (BBB link needs one manual check; A-16 item 17). |
| C-07 | FAIL (waits for publish) | Run 3 section in `docs/evidence/A-11.md` with manifest CID, gate result and counts; the Runs-page screenshot showing Run 3 needs the `index` step. Trace id: same documented exception as A-11. |
| C-08 | PASS | Run 3 rows in `docs/traceability.md` (AC-31, Run 3 correction table, gate log) and `docs/kit-usage.md`. |

Verdict now: FAIL (2), both waiting on the publish index step. The PO decides whether to merge now with these two recorded as open.

## Re-check after the publish (2026-10-26)

| Check | Result | What changed |
| --- | --- | --- |
| C-04 | PASS | Hosted on the feature branch (build `cf40e00`): CI run 40246843539 green on every job; the Runs page lists Run 3. Five cases are parked on A-16 items 18 and 19 (Run 3 size), reported as skipped. |
| C-05 | PASS | ERR-66 closed 2026-10-26 after the PO checked the BBB link (`find_type` removed). Run 3 defects are ERR-65 to ERR-71 after the merge with A-14. |
| C-07 | PASS | `docs/evidence/A-11.md` § Run 3: publish table (8 steps), hosted proof and screenshot `docs/evidence/img/A-11-run3-runs-page.png`; trace id under the A-11 exception. |

Verdict now: PASS (all ten checks). The PO approved the merge on 2026-10-25 ("if ci is green merge"); merged as `cb0a4d2`.

