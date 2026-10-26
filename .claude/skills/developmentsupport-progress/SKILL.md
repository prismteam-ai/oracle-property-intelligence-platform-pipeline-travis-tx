---
name: developmentsupport-progress
description: Regenerate and summarize the delivery progress board (docs/progress.md) for this repo, a Mermaid git graph of the feature branch with one branch and merge per story, a status pie, gate status per story and mismatches between story status and git. Use when the user asks for progress, status, what is done or next, a visualization of the branches, or after merging a story branch.
---

# Progress board

## Steps

1. Run `bash scripts/progress.sh` from the repo root. It reads:
   - each story's front matter in `stories/*.md` (`id`, `title`, `status`, `branch`, `depends_on`);
   - the git history of the feature branch (`feature/oracle-pipeline` or `feature/roofing-crm`);
   - the gate reports in `docs/gates/`.

   It writes `docs/progress.md`. If the script is missing, copy it from `../assessment-guide/developmentSupport/repo-files/scripts/progress.sh`.
2. Read the generated file and reply with:
   - done / in progress / ready / draft counts;
   - any **mismatch**, such as a story marked Done whose branch is not merged, or a merged branch whose story is not Done. Explain how to fix each one;
   - the **next story** on the critical path whose `depends_on` are all Done, with the command to start it:

     ```bash
     git switch {feature branch} && git pull --ff-only
     # then in Claude Code: /speckit-specify  (creates the NNN-slug branch)
     ```

3. Ask whether to commit the regenerated board on the feature branch, with the message `chore: update progress board`. Never commit it on a story branch or on `main`.

## Merging a finished story (remind the user, after its G7 PASS)

```bash
git switch {feature branch}
git merge --no-ff {NNN-slug} -m "{ID}: merge {title} (G7 PASS)"
bash scripts/progress.sh && git add docs/progress.md && git commit -m "chore: update progress board"
git push origin {feature branch}
```

Set the story's front matter to `status: Done` in the same merge, so the board and git agree.
