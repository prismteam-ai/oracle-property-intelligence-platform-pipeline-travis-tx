---
name: developmentsupport-hlplan
description: Generate a Gate-G2-ready high-level, phase-based implementation plan (docs/plan.md, PROJ-A or PROJ-B) from the approved feature list and vision, mapping each feature to a delivery phase and a Spec Kit story branch, with scope, dependencies, constraints, a mitigated risk register and traced success criteria. Use when the user wants a project plan, phase plan, delivery sequence, or mentions PROJ IDs or Gate G2.
---

# High-level plan (Phase 2, Gate G2)

Fill `assessment-guide/templates/plan.md` and save it as `docs/plan.md`.

## Inputs

- `docs/feature-list.md` (G1 approved) and `docs/01-intent.md`.
- The task guide's architecture section, critical path and timeline (`../assessment-guide/reference/A-oracle.md` § 6 or `B-roofing-crm.md` § 5, and the timeline in the task playbook `../assessment-guide/PLAYBOOK-A-oracle.md` or `PLAYBOOK-B-roofing-crm.md`).

If the feature list is missing, ask for it. Do not invent features.

## Steps

1. **Confirm the classification.** Both assessment apps are `Project`-sized, so a plan, not a single feature spec, is the right artifact. If the user is planning a single small feature instead, suggest a story file.
2. **Sequence the phases.**
   - Phase 0 is the foundation plus the **walking skeleton live on the hosted URL** (A-01 to A-03, or B-01).
   - Then follow the critical path from the task guide, Must before Should/Could, respecting dependencies.
   - Every phase produces a deployable increment and has exit criteria that can be tested on the hosted URL.
3. **Assign each FEAT a Spec Kit branch name** (`NNN-slug`, where NNN is the story number) and fill the coverage matrix (§ 8.x). Each feature appears in exactly one phase.
4. **Ask about gaps before finalizing.** List the open scope, dependencies (AWS account, BBB key, Filebase plan, Atlas access, assessor answers), constraints, risks and success-criteria measurement. Ask the user to resolve them. Do not invent answers. Anything still unresolved goes to § 13.
5. **Risk register.** Every risk gets at least one concrete mitigation and an owner. Seed it from the task guide, for example gateway rate limits, Filebase limits, source 403s, OpenSearch availability on the AWS Free plan, and Task A delays blocking Task B.
6. **Success criteria.** Each one is measurable and quotes a VIS evaluation point.
7. **Self-check** with the checks in `developmentsupport-g2-precheck`, and record the report.
8. **Hand over:** reply with the number of phases, the features covered, the risks (all mitigated), the open items and the G2 verdict. Remind the user to set the feature branch (`feature/oracle-pipeline` or `feature/roofing-crm`) as the base for every story branch.
