---
name: developmentsupport-featurelist
description: Turn an approved Vision (docs/01-intent.md) and the task guide's story backlog into a Gate-G1-ready Initial Feature List (docs/feature-list.md) with FEAT IDs, MoSCoW, Feature/Project classification, evaluation points, NFRs and dependencies, then self-check it. Use when the user wants a feature list, wants to decompose the vision into features, or mentions FEAT IDs, MoSCoW or Gate G1.
---

# Initial feature list (Phase 2, Gate G1)

Fill `assessment-guide/templates/feature-list.md` and save it as `docs/feature-list.md`. The template defines the structure.

## Inputs

- `docs/01-intent.md` (VIS). If its G0 decision is not "Approved", say so and ask whether to continue.
- `README.md`, plus the task guide's story backlog: `../assessment-guide/reference/A-oracle.md` § 6 or `../assessment-guide/reference/B-roofing-crm.md` § 5, plus the agents per story in `../assessment-guide/AGENT-MAP.md`.
- `docs/traceability.md`, if it exists.

## Steps

1. **One FEAT per backlog story.** `FEAT-A03` corresponds to story `A-03`. Adjust the backlog only when the vision or the README requires it, and explain each change in a short note under the table.
2. **Group the rows into modules** (`### 4.x`), for example: sources and ingestion; reconciliation; publication; explorer UI; agent and MCP. For Task B: platform; map search; leads; agent; hardening.
3. **Classify each row.** `Feature` means it is visible and testable on the runtime. `Project` means an enabler with no UI (data contract, CI, index build).
4. **Describe each row** in one sentence of 20 words or fewer, with a concrete subject and action.
5. **Prioritize.** Use the evaluation-point weight and the critical path. Anything the README demo transcript needs is a Must. Record deferred scope as `Won't`.
6. **NFRs, assumptions, constraints, dependencies.** Take them from the constitution (Golden Path, zero idle cost, data honesty) and the task guide. Add the Task A → Task B dependency (A-02 contract, A-03 CIDs).
7. **Coverage.** Every README acceptance criterion and demo line must map to a FEAT. Fill the FEAT column of `docs/traceability.md`, and list any uncovered line as a FAIL.
8. **Self-check** using the checks in `developmentsupport-g1-precheck`. Fix and re-run until all of them pass. Record the report in the template's pre-check section.
9. **Hand over:** reply with the feature count, the MoSCoW split, the Feature/Project split and the G1 verdict. The next steps are Claude Design (with the design system) and `developmentsupport-hlplan`.

## Example row

| FEAT-A11 | A-11 | Feature | Verifiable CID publication | Publishes each data group as CARs and tables with a manifest verifiable from two gateways. | Must | A4 | ALL | VIS-A |
