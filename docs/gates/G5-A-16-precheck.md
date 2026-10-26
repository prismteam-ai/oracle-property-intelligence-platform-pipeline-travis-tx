---
gate: G5
artifact: specs/016-cost-and-admin
artifact_version: spec.md + plan.md + tasks.md + agent-design.md + analyze-report.md as of commit ec9d7db (2026-10-26)
run_date: 2026-10-26
tool: Claude
verdict: FAIL
---

# Gate G5 pre-check: A-16 tasks + low-level design (re-run)

G4 exceptions (sizing, AC-1 billed-days window, AC-6 email+password) are accepted by the PO and not counted. G6 test cases exist (PASS). This replaces the first run, which failed 7 of 10.

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | `spec.md` Status "Clarified"; Clarifications section (2026-10-26) present; no `[NEEDS CLARIFICATION]`. |
| C-02 | Phase structure | PASS | Wave 1 frozen interfaces → Wave 2 groups → batches/deploy/proof (TZ). |
| C-03 | Task format | PASS | IDs, `[P]`, group tags and file paths now on the tasks checked (T041, T043, T044, T046, T050, T016). Group tags stand in for `[US#]`, as in A-14. |
| C-04 | Tests first | PASS | T039 precedes G2a UI tasks; T013-T015, T032, T045, T051, T052 now read "Tests then ...". |
| C-05 | Live verification last | PASS | `tasks.md` ends TZ01-TZ06: batches, hosted Playwright, smeargle, independent test (TZ05 = `agents.verify`), fixes/converge/evidence with kit-usage. |
| C-06 | LLD complete | PASS | `plan.md` now has Data flow, Integration points, Test approach and defers file ownership to `tasks.md`. |
| C-07 | Architecture conformance | PASS | Deviations in Complexity Tracking with reasons; T005 amends ADR-0001 and the architecture constitution. |
| C-08 | Kit usage | PASS | `agent-design.md` verbatim answers; plan cites it, names skills and patterns. Nit: plan line 35 still says `pipeline/index/` (tasks use `pipeline/publish/src/explore-index.ts`). |
| C-09 | Coverage | PASS | All FRs mapped; FR-001/003 by T070, closure rows by T025/T026/T036/T072/T073. |
| C-10 | Analyze | FAIL | `analyze-report.md`: 0 CRITICAL; H2-H6 fixed. H1 (five builder groups vs the 4-group light-lane rule) is still HIGH and open until the PO records the exception. |

## Fix list

1. C-10: record the PO's decision on H1 (exception for five groups, or merge groups) in `analyze-report.md` and the gate log.
2. Nit: change `pipeline/index/` in plan.md line 35 to `pipeline/publish/src/explore-index.ts`.

## Verdict

**FAIL (one open item).** 9 of 10 criteria pass. C-10 turns PASS once the PO decides H1.
