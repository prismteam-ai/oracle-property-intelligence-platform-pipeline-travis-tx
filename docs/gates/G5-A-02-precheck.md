---
gate: G5
artifact: specs/002-data-contract (spec.md, plan.md, tasks.md)
artifact_version: "2026-10-21, run 2 (after the analyze fixes and the phase reorder; uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G5 pre-check (run 2): A-02 Freeze the property-intelligence data contract

Inputs read: `specs/002-data-contract/spec.md`, `plan.md`, `tasks.md`, `agent-design.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `run-log.md`; `stories/A-02-data-contract.md`; `docs/architecture-constitution.md` v0.2.1; `.specify/memory/constitution.md` v3.0.3.

**Run 1 (2026-10-21): FAIL (2).**
- **C-02:** the phases were in track order, so US4 (P2) came before US1 and US2 (P1).
- **C-05:** Phase N (Polish) came after Phase Z.

Both were fixed by reordering whole sections, with no change to task content: Phase 3 US3 · 4 US1 · 5 US2 · 6 US4 · 7 US5 · 8 Polish · Z. A data-flow diagram was also added to plan.md (C-06).

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | `/speckit-clarify` done 2026-10-20 (4 Q/A in spec § Clarifications, 1 from the PO at D-2); 0 `[NEEDS CLARIFICATION]` in spec.md |
| C-02 | Phase structure | PASS (run 2) | Setup → Foundational → US3, US1, US2 (P1) → US4, US5 (P2) → Polish → Z. The tracks still run in parallel, as the Dependencies section explains. |
| C-03 | Task format | PASS | T001–T068 and TZ01–TZ06 all have IDs. [P] marks parallel tasks; story labels are on every story-phase task (Setup, Foundational, Polish and Z carry none, by the template rule); every task names a file path or a recorded output (run-log.md). Implementation tasks are marked `[oracle]`. |
| C-04 | Tests first | PASS | Each phase lists its "Tests (write first, must fail)" block before implementation. T052 (carrier test) is written before T053; T063 before T064/T065. |
| C-05 | Live verification last | PASS (justified exception) | tasks.md ends with TZ01–TZ06. TZ02 (deploy), TZ03 (Playwright) and TZ04 (smeargle) are "N/A: Project story, no hosted runtime until A-03". These are the G4 C-04 and G6 C-05/C-09 exceptions, accepted by the PO; the hosted proof is in A-13 and A-15. TZ05 is the story's independent test. |
| C-06 | LLD complete | PASS | plan.md: components (Project Structure), data flow (diagram), integration points (Austin SoQL, TCAD ZIP, lexicon manifest, Census files, elephant-cli), test approach (Technical Context, Testing); data-model.md; contracts/ ×4 |
| C-07 | Architecture conformance | PASS (justified) | Deviations are flagged in Complexity Tracking: Art. IV (no Turborepo until A-03), Art. I/X (no hosted runtime or CI), P0-17 (sample.parquet = ARD deviation D-07, PO D-4c), and the pilot CIDs being unpublished (PO D-2). No P0 broken: no upload, no Query DB, no `LIKE` in views, CIDv1 only, stop on 403. |
| C-08 | Kit usage | PASS | `agent-design.md` holds mew and oracle word for word, with a Disagreements table. plan.md has Kit Agent Ownership citing it, the builder skills (`use-oracle`, `build-county-transform`, `county-seed-data`, `county-permit-adapter`, `apply-engineering-guidelines`) and 16 code patterns mapped to paths. |
| C-09 | Coverage | PASS | FR-001…FR-011 and NFR-001/002 each map to ≥ 1 task (analyze coverage 100%) |
| C-10 | Analyze | PASS | `/speckit-analyze`: 0 CRITICAL; 3 HIGH (F1–F3) fixed in spec.md and tasks.md; MEDIUM F4 fixed; F5/F6 accepted |

## Exceptions

- **C-05, TZ02–TZ04 N/A.** A-02 is a Project story (FEAT-A02, `ui: false`). The hosted site arrives with A-03; the evidence is the carrier record, Vitest output and the sample count (G4 C-04, accepted by the PO 2026-10-20).

## Fix list

No open FAILs.

**Decision:** ☑ Approved ☐ Returned · HebaGaber · 2026-10-21 (D-5: "Approve (Recommended)")
