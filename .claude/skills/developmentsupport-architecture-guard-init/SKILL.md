---
name: developmentsupport-architecture-guard-init
description: Scaffold the repo's architecture constitution (docs/architecture-constitution.md, ARD-A or ARD-B) from the approved plan, the task guide's architecture section and the soofi kit Golden Path, with decision placeholders, boundaries, NFR thresholds, P0 rules and the G3 checklist. Use when the user wants an ARD, architecture decision record, architecture constitution, or is preparing Gate G3.
---

# Architecture constitution (Phase 3, Gate G3)

Fill `assessment-guide/templates/architecture-constitution.md` and save it as `docs/architecture-constitution.md`.

## Inputs

- `docs/plan.md` (G2 approved) and `docs/feature-list.md` (its NFRs).
- `.specify/memory/constitution.md` (project-wide Golden Path rules).
- The task guide: `../assessment-guide/reference/A-oracle.md` § 3, or `../assessment-guide/reference/B-roofing-crm.md` § 3 (architecture and key decisions).
- A kit design review. Ask the kit agent for it, read-only:
  - Task A: `soofi-xyz-team-kit:oracle` for ingestion and publication, `soofi-xyz-team-kit:metagross` for the app.
  - Task B: `soofi-xyz-team-kit:metagross` for the app, `soofi-xyz-team-kit:alakazam` for the index and RAG.
  - Prompt: "Read docs/plan.md and .specify/memory/constitution.md. Load apply-engineering-guidelines and build-frontend-backends. Return components, boundaries, data contracts, integration points with failure handling, NFR thresholds and risks. Do not write code."

## Steps

1. Copy each decision from the task guide's "Key decisions" table into § 3, with the options considered and the rationale. If the guide does not settle a decision, write `[NEEDS CLARIFICATION]`.
2. Write C4 levels 1–3 as Mermaid diagrams.
3. Fill the layer and module boundaries for the Turborepo layout (`apps/web`, `apps/api`, `packages/api-client`, `packages/shared`, plus pipeline packages for Task A).
4. Give each NFR a threshold and a way to verify it on the hosted runtime.
5. List the P0 rules. Always include the task's access boundary:
   - Task A: publish only `elephant-cli export-tables` output, and never expose the Query DB.
   - Task B: no scraping or ingestion; read only Task A's CIDs or MCP.
6. Record the deployment and rollback strategy (Amplify atomic deploy plus CDK; redeploying the previous build is the Blue/Green equivalent).
7. Use only the kit-bundled Elephant skills (`soofi-xyz-team-kit/skills/`). Never reference the deprecated standalone `elephant-xyz/skills` repo.
8. Run the checks from `developmentsupport-g3-precheck` and report the verdict. The user, as Architect and Dev Lead, records the G3 decision.
