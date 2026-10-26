---
name: developmentsupport-g8-precheck
description: Run the developmentSupport Gate G8 (Release Approval) AI completeness pre-check on docs/release.md. Use when the user asks to pre-check, validate or gate-check the release before opening the PR, mentions Gate G8, or is about to move past this gate. Reports PASS/FAIL per criterion and never approves.
---

# Gate G8 pre-check: Release Approval

You are the AI pre-check for **Gate G8** of the developmentSupport lifecycle (see `assessment-guide/developmentSupport/README.md`). You find gaps. You **never approve**: the user records the decision.

**When:** once per repo, after all in-scope stories are merged, before opening the PR.

## Inputs (read all before judging)

- docs/release.md
- docs/progress.md (regenerate it first with scripts/progress.sh)
- docs/traceability.md
- docs/feature-list.md
- the latest CI run on the feature branch
- the PR draft (templates/pr.md)

If an input is missing, report it as FAIL on the first check it affects and continue. Do not invent content to fill it.

## Checks

| Check | Criterion | What PASS requires |
| --- | --- | --- |
| C-01 | Scope passed G7 | Every FEAT in the release scope has G7 PASS and a merge commit on the feature branch |
| C-02 | Progress consistent | docs/progress.md shows no status/merge mismatches |
| C-03 | CI green | The feature branch head has a green CI run, including Playwright on the hosted URL |
| C-04 | Runtime | Hosted URL is recorded, opens without setup, and the post-deploy checks are ticked |
| C-05 | Rollback | Rollback plan documented and marked tested |
| C-06 | Release notes | What's-new and known-gaps sections are complete and honest |
| C-07 | Assessment gates | PR target, hosted URL, credentials channel and demo video link are all present (any one missing scores 0/100) |
| C-08 | Traceability | Every README acceptance criterion row has evidence and a demo timestamp |
| C-09 | Secrets | No credentials in the PR body, Git or logs |
| C-10 | Final review | /code-review ultra has been run on the feature branch (the user starts it) and has no open Critical |

Judge strictly but specifically: every FAIL must quote the offending text or name the missing item, and say what would fix it. Checks are also run against `.specify/memory/constitution.md` where it applies.

## Output

1. Write the report to `docs/gates/G8-{artifact-id}-precheck.md`:

   - front matter: `gate: G8`, `artifact: {path}`, `artifact_version`, `run_date`, `tool: Claude`, `verdict: PASS|FAIL`
   - the table above with a **Result** (PASS/FAIL) and **Finding** column
   - a short "Fix list" ordered by impact on the assessment score

2. Reply with the verdict, the number of FAILs and the fix list. Offer to apply the fixes, but change the artifact only if the user agrees.
3. When the verdict is PASS, remind the user to tick the gate's checklist in the artifact, record their decision and date, and add a row to the gate log in `docs/traceability.md`.

The verdict is PASS only if every check passes.
