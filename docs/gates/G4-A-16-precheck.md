---
gate: G4
artifact: stories/A-16-cost-and-admin.md
artifact_version: "Draft, run 2 after fixes on branch 016-cost-and-admin (AGENT-MAP alignment, AC-1 window, Closure table, email + password wording)"
run_date: 2026-10-26
tool: Claude
verdict: PASS
---

# G4 pre-check: A-16 Prove zero idle cost and let the operator run the pipeline from the hosted app

Inputs read: the story; `docs/feature-list.md` (FEAT-A16, FEAT-A17); `../assessment-guide/AGENT-MAP.md` § 4 row A-16 (line 360); `docs/progress.md`; `design/prototype/`.
Treated as approved facts (PO, 2026-10-26, not gaps): A-14 in `depends_on`; AC-6 uses Task B's email + password Cognito sign-in; AC-12, AC-13, AC-14 added; AC-1 reads the last full billed days (recorded gate exception, edge case "cost window").

Verdict: PASS, 11 of 11 checks. Run 1 failed C-01, C-06, C-08 and C-11; run 2 left C-11; run 3 (final) confirms the PO sizing exception is recorded.

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | reviewers `[metagross, machamp, audino]` and skills (4 plus `apply-engineering-guidelines`) now match AGENT-MAP row A-16; design, builder, verify match; all other fields filled. |
| C-02 | User story form | PASS | Two As / I want / So that statements and an independent test. |
| C-03 | GWT | PASS | AC-1 to AC-14 are Given / When / Then. |
| C-04 | Observable and real | PASS | Hosted Coverage, Runs, Activity; real billing, 441,961 properties, Run 2 and 3. |
| C-05 | Scale + honesty | PASS | Scale: AC-3, AC-10, AC-13. Missing data / error: AC-5, AC-8, AC-9, AC-14. |
| C-06 | Testable | PASS | AC-1 now reads the last full billed days (at least 3) by service and record type; AC-14 counts rows of the numbered Closure table (A11-n, A13-n, A14-n). |
| C-07 | Edge cases | PASS | Eight edge cases. |
| C-08 | Requirements traced | PASS | No "email code" wording remains in the story; FR-006 and FEAT-A17 say email + password; every FR traces and NFRs have thresholds. |
| C-09 | Prototype | PASS | Boards exist (Coverage, AdminSignIn, RunsAdmin, Activity and states); the "code sent" state is recorded as not applicable. |
| C-10 | Ready | PASS | A-03, A-11, A-13, A-14 are Done and merged; no [NEEDS CLARIFICATION] in the story. |
| C-11 | Slicing | PASS (recorded PO exception) | `size_days: 2` is above 0.5 to 1.5; the PO sizing exception (2026-10-26) is recorded under "### Gate G4 notes" with primary evaluation point A4 and the reason (final Task A story, carried gaps belong here). |

## Fix list

None. Tick the G4 checklist in the story, and add a row to the gate log in `docs/traceability.md`. The pre-check never approves; the PO decision is recorded in the story.
