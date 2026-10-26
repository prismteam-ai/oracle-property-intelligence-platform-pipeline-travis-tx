---
gate: G7
artifact: stories/A-01-discover-sources.md
artifact_version: "run 2; branch 001-discover-sources @ f3e4ceb + fixes (story rev 3 + AC-6 amendment 2026-10-20)"
run_date: 2026-10-20
tool: Claude
verdict: PASS
---

# G7 pre-check (run 2): A-01 Discover Travis County sources and pass readiness preflight

Inputs read: `specs/001-discover-sources/tasks.md`; `docs/reports/A-01-unit-test-report.md`; `docs/reports/A-01-test-report.md`; `docs/reviews/CR-A-01.md`; `docs/defects/ERR-1.md` to `ERR-8.md`; `docs/evidence/A-01.md`; `docs/traceability.md`; `docs/kit-usage.md`; the story front matter; `git log feature/oracle-pipeline..HEAD` (43 commits); `gh run list --branch 001-discover-sources`; `.specify/memory/constitution.md`.

Found and fixed during this pre-check (before judging): the latest CI run was red (run 39489669571, 1 of 502: a timing-sensitive download test). Recorded as ERR-8 and fixed in the test (`024d9c0`) and in the client (`56e1426`: `timeout_ms` is taken when the limit fires). CI run 39490116172 is green on both attempts.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS | 72 of 72 tasks ticked, including Phase 7 and Phase 8 Convergence (T056–T066). TZ02–TZ04 are ticked as "N/A: Project story, no hosted runtime until A-03". |
| C-02 | Unit tests | PASS | [`pipeline-ci` run 39490116172](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39490116172) on `56e1426`: success on attempt 1 and rerun attempt 2, 502/502. Coverage of new code (all 36 `travis/` files are new): lines 92.85% (≥ 80%). Branches 77.51% are below 80%, which the check does not name; noted in the report. |
| C-03 | Code review | PASS | `docs/reviews/CR-A-01.md`: `/code-review` 3 runs; `oracle` (the only `agents.reviewers` agent) 72 → **83/100** (≥ 75). 0 open Critical. Deferred items each name an owning story (A-04, A-05, A-06, A-12) and reason, by PO decision 2026-10-20. |
| C-04 | TC executed on hosted URL | PASS (justified exception) | No hosted URL exists for a Project story (G4 C-04 exception, accepted by the PO 2026-10-19; plan Complexity Tracking). Every TC has a result and build sha in `docs/reports/A-01-test-report.md` (`9c7579a`; TC-009 re-test; TC-023 at `8a1145a`), run from a terminal against the committed catalog and evidence, not against a localhost server. Hosted proof of these counts comes in A-11 AC-4 and A-13 AC-1/AC-2. |
| C-05 | Defects closed | PASS | ERR-1 to ERR-8 all Closed: 7 fixed with a re-test, ERR-4 accepted by the PO (documented gap, FR-003a amendment) with TC-009 re-tested PASS. |
| C-06 | No open Critical | PASS | No Critical defect; no open defect. |
| C-07 | Evidence | PASS (justified exception) | `docs/evidence/A-01.md` from the template: validator command, full output and `exit=0`; catalog SHA-256; one row per source; every jurisdiction; TCAD decision; SC outcomes; quickstart results. URL, screenshot and trace id are "N/A: Project story, no hosted runtime until A-03" (same exception as C-04); the local Restate run journal and blocked-evidence files stand in for the trace. |
| C-08 | Traceability | PASS | `docs/traceability.md` AC-1, AC-18 and the FEAT-A01 chain row are complete (merge commit "pending (G7)", as expected before the merge). `docs/kit-usage.md` has the A-01 line, but its "Reviewer scores before submission" table still holds the template placeholder `\| {oracle} \| {n} \| {…} \|` (line 60) instead of the oracle score. **Run 2:** replaced with the oracle row (83/100, main deviations fixed). |
| C-09 | Commits | PASS | 43 of 43 commits on the branch start with `A-01`; gitleaks on git history: no leaks (one public Application Insights key suppressed by exact fingerprint, explained in `.gitleaksignore`). |
| C-10 | Story status | PASS | Front matter reads `status: Ready`, `gate: G4` and **`qc_testability_signoff: false`**, while the test plan records `qc_signoff: true` (G6 approved by the QC Lead, 2026-10-19). The story is not ready to be set to Done until the sign-off field matches G6. **Run 2:** `qc_testability_signoff: true`; the story is ready to be set to Done. |

## Fix list (ordered by impact on the assessment score)

Run 1 (same day) failed C-08 and C-10; both fixes below are applied, and run 2 has no failing check.


1. **C-10:** set `qc_testability_signoff: true` in `stories/A-01-discover-sources.md` (it records the G6 approval already given). After your G7 decision, set `status: Done` and `gate: G7`.
2. **C-08:** replace the placeholder row in `docs/kit-usage.md` "Reviewer scores before submission" with `| oracle (A-01) | 83 | stale-run guard, honest deviation record (D-1, D-3), WAF detection, bound parcel exception, download robustness (CR-A-01) |`.

Both are one-line edits; with them every check passes.

## Notes (not failures)

- Branch coverage is 77.51%; the check asks for 80% of new code, met on lines (92.85%).
- SC-005 (0 retries from a changed network) is recorded as not met in `docs/evidence/A-01.md` with the deviations (DEC-A-01-source-access D-1, D-3) and the guards added since (egress check, WAF detection, T056).
- The test plan was updated to v0.7 after its G6 approval of v0.6 to match the automation; re-approval is the PO's call.
