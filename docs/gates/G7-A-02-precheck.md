---
gate: G7
artifact: stories/A-02-data-contract.md
artifact_version: "run 1; branch 002-data-contract @ 0cd5237 (+ the Phase Z ticks and this report, uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G7 pre-check (run 1): A-02 Freeze the property-intelligence data contract

**Inputs read:**
- `specs/002-data-contract/tasks.md`
- `docs/reports/A-02-unit-test-report.md`
- `docs/reports/A-02-test-report.md`
- `docs/reviews/CR-A-02.md`
- `docs/defects/ERR-9.md` (the only A-02 defect)
- `docs/evidence/A-02.md`
- `docs/traceability.md`
- `docs/kit-usage.md`
- the story front matter
- `git log feature/oracle-pipeline..HEAD` (23 commits)
- `gh run list --branch 002-data-contract`: no runs, because the branch is not pushed and CI for the workspace arrives with A-03
- gitleaks over the branch commits
- `.specify/memory/constitution.md`

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS | 77 of 77 tasks are ticked: T001–T071 and TZ01–TZ06. The Phase 9 Convergence tasks T069–T071 are included. TZ02–TZ04 are ticked as "N/A: Project story, no hosted runtime until A-03", the same way as A-01. `/speckit-converge` run 2 reported converged. |
| C-02 | Unit tests | PASS (justified exception) | The workspace has no CI until A-03 (walkthrough § 1; plan Complexity Tracking, Art. X). The unit-test report has the local runs on `c90632a`: workspace 25 files / **393 passed**, runtime 43 files / **594 passed**, 0 failed, 0 skipped with `PILOT_DIR`. Coverage of new code is above 80 %: `query-core/src` 96.9 / 93.6 / 100 / 98.6 %, `query-core/gazetteer` 88.3 / 82.0 / 94.7 / 90.8 %, `contract/src` 100 %. Typecheck, lint and format are clean, and the TDD failing-first lines are recorded. |
| C-03 | Code review | PASS | `docs/reviews/CR-A-02.md` holds `/code-review` (10 findings) and both `agents.reviewers` scores: **oracle 80/100**, **donphan 76/100**, both ≥ 75. All 29 findings are resolved: fixed in `fa190b0`, accepted with a reason, or deferred with a target story (A-03, A-04, A-06, A-07, A-12; PO decision D-9). **0 open Critical.** |
| C-04 | TC executed on hosted URL | PASS (justified exception) | There is no hosted URL for a Project story (G4 C-04 and G6 C-05/C-09 exceptions, accepted by the PO). `docs/reports/A-02-test-report.md` records all 33 cases against build `f3ddcbe`, run from a terminal at the repo root on `002-data-contract`, plus the TC-004 re-test on `c18f125`: **33/33 PASS**. Nothing claims localhost as hosted evidence. Hosted proof comes in A-13 and A-15. |
| C-05 | Defects closed | PASS | One failing case in run 1: TC-004 → `ERR-9` (Low). It is Closed in `c18f125` with a re-test on 2026-10-21 (6 passed), and the test plan's gap-linked table points to it. |
| C-06 | No open Critical | PASS | There are no Critical defects; ERR-9 was Low and is Closed. |
| C-07 | Evidence | PASS (justified exception) | `docs/evidence/A-02.md` exists with observed counts: 9 verdicts, CLI roots and CIDs, 19,031 candidates, 24/25 review, 20 sample rows, 0 null provenance, and the independent test output. The fields for URL, screenshot and trace ID say "N/A: Project story, no hosted runtime until A-03; no AWS execution". The terminal outputs and pilot step records are the evidence, the same pattern as A-01. |
| C-08 | Traceability | PASS | `docs/traceability.md`: the A-02 cells are filled for AC-5, 13, 22, 23 and 41 and demo lines D-4 and D-12; gate-log rows G4, G5 and G6 are present (G7 row after the decision). `docs/kit-usage.md`: the A-02 row names mew + oracle as designers, oracle as builder, oracle 80 and donphan 76 as reviewers, and Vitest + the sample count as verify. |
| C-09 | Commits | PASS | All 23 commits on the branch start with `A-02: `. gitleaks found 1 false positive, `sorted_keys_sha256` in the AC-3 review sheet (the SHA-256 of the public permit-key list). It is suppressed by fingerprint in `.gitleaksignore` (`0f5f2c0`), and the rescan finds no leaks. The working-tree hits are in gitignored, untracked local files only. |
| C-10 | Story status | PASS | The story is `status: Ready`, G4 is ticked and `qc_testability_signoff: true`. It is ready to be set to `Done` once the PO approves G7. |

## Exceptions (same pattern as A-01)

- **C-02 (CI green).** There is no workspace CI until A-03. The evidence is the local `pnpm vitest` output in the unit-test report.
- **C-04 / C-07 (hosted test run, URL, screenshot, trace ID).** These don't apply to a Project story with no hosted runtime. The evidence is the carrier table, digests and test output.

## Fix list

No open FAILs.

**Decision:** ☑ Approved ☐ Returned · HebaGaber · 2026-10-21 (D-10: "Approve, merge, push (Recommended)")
