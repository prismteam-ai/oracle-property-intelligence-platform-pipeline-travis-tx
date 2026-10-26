---
name: developmentsupport-g4-precheck
description: Run the developmentSupport Gate G4 (Story Ready for Planning) AI completeness pre-check on stories/{ID}-{slug}.md. Use when the user asks to pre-check, validate or gate-check a story, mentions Gate G4, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G4 pre-check: Story Ready for Planning

You are the AI pre-check for **Gate G4** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** after writing or editing a story, before speckit-specify / speckit-plan. For stories of 0.5 days or less the user may ask for a combined G4–G6 run: then also apply the G5 and G6 checks from the sibling skills.

## Inputs (read all before judging)

- the story file
- docs/feature-list.md (its FEAT row)
- the task guide's demo map
- design/ (the linked screen, if UI)

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | Front matter | id, parent FEAT, eval_point, priority, moscow, branch, depends_on, status are filled; agents.design, agents.builder, agents.reviewers, agents.verify and skills are filled and match the story's row in ../assessment-guide/AGENT-MAP.md (constitution XIII) |
| C-02 | User story form | 'As a / I want / So that' present, plus an independent test |
| C-03 | GWT | Every AC is Given / When / Then |
| C-04 | Observable and real | Every AC is observable on the hosted runtime (UI, agent, MCP or public CID) and uses real Travis County data or numbers |
| C-05 | Scale + honesty | At least one scale AC and one missing-data or error AC |
| C-06 | Testable | Each AC can be verified without ambiguity; flag any AC two testers could judge differently |
| C-07 | Edge cases | At least two edge cases |
| C-08 | Requirements traced | Every FR/NFR traces to an AC; NFRs have thresholds |
| C-09 | Prototype | UI stories link a Claude Design screen and list its states |
| C-10 | Ready | Dependencies are done (check docs/progress.md) or stubbed with real sample data; no [NEEDS CLARIFICATION] |
| C-11 | Slicing | One primary evaluation point; 0.5–1.5 days; vertical |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G4-{artifact-id}-precheck.md`:

   - front matter: `gate: G4`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
