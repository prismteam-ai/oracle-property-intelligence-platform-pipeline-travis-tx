---
name: developmentsupport-g1-precheck
description: Run the developmentSupport Gate G1 (Feature List Approval) AI completeness pre-check on docs/feature-list.md. Use when the user asks to pre-check, validate or gate-check the feature list, mentions Gate G1, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G1 pre-check: Feature List Approval

You are the AI pre-check for **Gate G1** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** after drafting or editing the feature list, before Claude Design and before writing stories.

## Inputs (read all before judging)

- docs/feature-list.md
- docs/01-intent.md (VIS)
- README.md (the assignment)
- docs/traceability.md

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | ID format | Every row has a unique FEAT ID, sequential, matching its story ID (FEAT-A03 = A-03); no gaps except deliberately merged stories, which are noted |
| C-02 | Description quality | Each description is one sentence of 20 words or fewer, testable, with a concrete subject and action |
| C-03 | MoSCoW and eval point | Every row has Must/Should/Could/Won't and an evaluation point |
| C-04 | Classification | Every row is Feature or Project; Project rows have no direct UI |
| C-05 | No duplicates | No two rows describe the same capability (compare names AND descriptions) |
| C-06 | No vague verbs | No 'manage', 'handle' or 'support' without a concrete object and action |
| C-07 | Vision traceability | Every row has a VIS reference |
| C-08 | Scope alignment | No row contradicts the out-of-scope list or the README's out-of-scope statements |
| C-09 | README coverage | Every README acceptance criterion and demo transcript line is covered by at least one FEAT; list any uncovered line |
| C-10 | NFRs | NFRs are measurable and no Must contradicts them |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G1-{artifact-id}-precheck.md`:

   - front matter: `gate: G1`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
