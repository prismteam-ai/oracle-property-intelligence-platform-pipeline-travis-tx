---
name: developmentsupport-g2-precheck
description: Run the developmentSupport Gate G2 (Plan Approval) AI completeness pre-check on docs/plan.md. Use when the user asks to pre-check, validate or gate-check the high-level plan, mentions Gate G2, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G2 pre-check: Plan Approval

You are the AI pre-check for **Gate G2** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** after drafting the high-level plan, before writing stories.

## Inputs (read all before judging)

- docs/plan.md
- docs/feature-list.md
- docs/01-intent.md

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | Artifact type | A plan (PROJ) exists because both apps are Project-classified |
| C-02 | Scope | In-scope and out-of-scope tables are populated and consistent with the feature list |
| C-03 | Dependencies | Inter-phase, external and organisational dependencies are all present |
| C-04 | Constraints | Technical, budget, timeline, resourcing and access constraints are documented |
| C-05 | Risks mitigated | Every risk row has at least one concrete mitigation and an owner |
| C-06 | Success criteria traced | Every SC is measurable and quotes a VIS evaluation point |
| C-07 | Coverage | Every Must feature is assigned to exactly one phase and one story branch |
| C-08 | Walking skeleton first | Phase 0 ships a real data slice to the hosted URL before feature work |
| C-09 | No placeholders | No {placeholders} or undocumented TBDs remain; open items are in the open-questions table |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G2-{artifact-id}-precheck.md`:

   - front matter: `gate: G2`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
