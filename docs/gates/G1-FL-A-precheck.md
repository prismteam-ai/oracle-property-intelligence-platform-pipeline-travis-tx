---
gate: G1
artifact: docs/feature-list.md
artifact_version: 0.2
run_date: 2026-10-19
tool: Claude
verdict: PASS
---

# G1 pre-check: FL-A (Feature List Approval), re-run for amendment 0.2

Inputs read: `docs/feature-list.md` v0.2 (adds FEAT-A17 and FEAT-A18), `docs/01-intent.md` (VIS-A), `README.md` at `e778d6f`, `docs/traceability.md`, `.specify/memory/constitution.md` 3.0.3 and `docs/architecture-constitution.md` (ARD-A v0.2, binding since G3). The product owner records the G1 decision; this check never approves. The 2026-10-17 run on v0.1 (PASS) is in git history.

**Run history (2026-10-19):** the first run on amendment 0.2 returned FAIL with 3 FAILs (C-02 FEAT-A07 contradicted AD-05 and FEAT-A18 lacked an action verb; C-03 notes still said "16 rows" and "100% Must"; C-10 "Features affected" missed A17/A18). The PO approved the fix list; all fixes were applied, and this re-run is the result.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | ID format | PASS | 18 unique IDs, FEAT-A01 to FEAT-A18, sequential, each matching story A-01 to A-18. No gaps, no merged stories. |
| C-02 | Description quality | PASS | Every description is one sentence of 20 words or fewer with a concrete subject and action. FEAT-A07 now reads "…reporting all five identity states" (matches AD-05). FEAT-A17 (18 words) and FEAT-A18 "Shows hub, legal, catalog and run-log pages from real files and marks planned features Coming soon without sample data." (19 words) are testable. |
| C-03 | MoSCoW and eval point | PASS | All 18 rows have MoSCoW and an evaluation point. The notes now say 16 backlog rows plus 2 PO additions, and MoSCoW health reads "16 Must, 2 Should (89% Must)". |
| C-04 | Classification | PASS | FEAT-A01 and A02 are Project with no direct UI; the other 16, including A17 and A18, are Feature with hosted UI or hosted proof. |
| C-05 | No duplicates | PASS | FEAT-A17 (operator run commands) differs from FEAT-A12 (incremental runs, disabled schedule); FEAT-A18 (hub, legal, catalog, run log, Coming soon) does not overlap FEAT-A13's demo screens. |
| C-06 | No vague verbs | PASS | No "manage", "handle" or "support" in any name or description. |
| C-07 | Vision traceability | PASS | All 18 rows cite VIS-A. |
| C-08 | Scope alignment | PASS | Other counties (OS-03) and the CRM (OS-01) appear only as Coming soon skeletons with no data; nothing out of scope is built. |
| C-09 | README coverage | PASS | 46 of 47 acceptance criteria and 12 of 12 demo lines have at least one FEAT; AC-30 (IPNS) is N/A by AD-03. Every FEAT is now referenced in the FEAT column (FEAT-A17 on AC-14; FEAT-A18 on AC-25 and D-1). |
| C-10 | NFRs | PASS | NFR-01 to NFR-09 are measurable. "Features affected" now includes A17 and A18 (NFR-02 `A03, A12–A18`; NFR-03 `A03, A12–A15, A17`; NFR-05 adds `A18`; NFR-08 `A03, A13, A14, A16–A18`). No Must contradicts an NFR. |

## Fix list

None.

## Notes (not failures)

1. Two Should rows make the priority tiers visible, which answers the 2026-10-17 note about a flat 100% Must.
2. FEAT-A17 implements the Accepted decision AD-12, so it adds no new architecture; FEAT-A18 is bound by P0-12 (no sample data), and the PO chose skeleton-only Coming soon previews.
3. The feature list is `status: In Review` until you re-approve it.
