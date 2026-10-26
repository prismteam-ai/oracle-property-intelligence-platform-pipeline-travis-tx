---
name: developmentsupport-g5-precheck
description: Run the developmentSupport Gate G5 (Tasks + Low-Level Design) AI completeness pre-check on specs/{NNN-slug}/plan.md and tasks.md. Use when the user asks to pre-check, validate or gate-check a story's Spec Kit plan and tasks, mentions Gate G5, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G5 pre-check: Tasks + Low-Level Design

You are the AI pre-check for **Gate G5** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** after speckit-plan and speckit-tasks, before speckit-implement.

## Inputs (read all before judging)

- specs/{NNN-slug}/spec.md, plan.md, tasks.md
- the story file
- docs/architecture-constitution.md
- .specify/memory/constitution.md

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | Clarified | speckit-clarify done; no [NEEDS CLARIFICATION] in spec.md |
| C-02 | Phase structure | tasks.md runs Setup → Foundational → story phases (P1 → P2 → P3) → Polish |
| C-03 | Task format | Every task has a T### ID, [P] where parallel, a story link, and an exact file path |
| C-04 | Tests first | Unit/contract test tasks precede the implementation tasks they cover |
| C-05 | Live verification last | tasks.md ends with the Phase Z tasks TZ01–TZ06: reviewer agents, deploy, Playwright against RUNTIME_URL (not localhost), smeargle for UI stories, the agents.verify check, evidence + traceability + kit-usage |
| C-06 | LLD complete | plan.md documents components, data flow, integration points and test approach |
| C-07 | Architecture conformance | No deviation from the architecture constitution, or each deviation is justified and flagged |
| C-08 | Kit usage | specs/{NNN-slug}/agent-design.md exists with one verbatim answer per agents.design agent; plan.md has a filled Kit Agent Ownership section citing it, names the builder's skills and lists the builder patterns that must appear in code (constitution XIV–XV) |
| C-09 | Coverage | Every FR in spec.md is implemented by at least one task |
| C-10 | Analyze | speckit-analyze reports no CRITICAL or HIGH findings |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G5-{artifact-id}-precheck.md`:

   - front matter: `gate: G5`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
