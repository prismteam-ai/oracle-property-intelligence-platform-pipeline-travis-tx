---
name: developmentsupport-g7-precheck
description: Run the developmentSupport Gate G7 (Validated Build) AI completeness pre-check on the story branch, its reports and evidence. Use when the user asks to pre-check, validate or gate-check a story branch before merging it, mentions Gate G7, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G7 pre-check: Validated Build

You are the AI pre-check for **Gate G7** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** after the story is deployed and tested on the hosted URL, before merging the story branch into the feature branch.

## Inputs (read all before judging)

- specs/{NNN-slug}/tasks.md
- docs/reports/{ID}-unit-test-report.md
- docs/reports/{ID}-test-report.md
- docs/reviews/CR-{ID}.md
- docs/defects/ (ERR files for this story)
- docs/evidence/{ID}.md
- git log of the story branch
- the latest CI run (gh run list --branch {branch})

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | Tasks done | Every task in tasks.md is checked |
| C-02 | Unit tests | Unit test report attached, all green in CI; coverage of new code is 80% or more |
| C-03 | Code review | CR log exists with /code-review findings and a 0–100 score from every agents.reviewers agent; every score is 75 or more, or the gap is justified; zero open Critical findings (constitution XVI) |
| C-04 | TC executed on hosted URL | Every TC has a result recorded against the hosted URL and a build sha; none ran on localhost |
| C-05 | Defects closed | Every failing TC has an ERR record that is Closed with a re-test, or is a documented gap-linked case |
| C-06 | No open Critical | No Critical defect is open |
| C-07 | Evidence | docs/evidence/{ID}.md exists with URL, observed counts, screenshot and trace id |
| C-08 | Traceability | The story's rows in docs/traceability.md and docs/kit-usage.md are complete |
| C-09 | Commits | Every commit on the story branch starts with the story ID; no secrets in the diff |
| C-10 | Story status | Story front matter is ready to be set to Done |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G7-{artifact-id}-precheck.md`:

   - front matter: `gate: G7`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
