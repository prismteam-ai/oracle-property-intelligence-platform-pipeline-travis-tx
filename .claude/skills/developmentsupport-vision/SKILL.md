---
name: developmentsupport-vision
description: Shape an assignment README plus the user's notes into a gate-ready Vision / problem-framing document (docs/01-intent.md, id VIS-A or VIS-B) and run the Gate G0 pre-check. Use when the user wants to write or refine the intent, vision, problem framing or evidence model of a task, or mentions VIS or Gate G0.
---

# Vision / problem framing (Phase 1, Gate G0)

Produce `docs/01-intent.md` from `assessment-guide/templates/intent.md`. That template is the only source of structure; never invent a different layout.

## Inputs

1. `README.md` of the task repo (the assignment, `BN-A` or `BN-B`). Record its commit sha.
2. The task guide: `../assessment-guide/reference/A-oracle.md` (Task A) or `../assessment-guide/reference/B-roofing-crm.md` (Task B), sections 1–2 (draft intent, evaluation points).
3. Anything the user pastes: notes, assessor answers, the `arceus` routing output.

If the README cannot be found, ask for it. Do not fabricate an assignment.

## Steps

1. **Extract**: actors, the end-to-end workflow, data objects, scale signals (real counts only; cite the source of each number), access boundaries, and every README acceptance criterion and demo transcript line.
2. **Frame the problem without a solution.** Sections 2–7 describe *what* and *why*. Technology appears only where the README makes it a constraint.
3. **Evaluation points = success criteria.** Use 3–8 points summing to 40. Each must be observable on the hosted runtime. Map every README acceptance criterion to one point.
4. **Never guess.** Write `[NEEDS CLARIFICATION: question]` for any unknown, and list it again under *Open questions*, worded so it can be sent to the assessor.
5. **Fill the front matter** (`id`, `parent`, `status: Draft`, `version`, `created`).
6. **Run the G0 pre-check** against the template's G0 table. Report each criterion as PASS or FAIL with a finding. Also flag solution language in the problem statement and any unsupported numbers. Write the report into the *AI pre-check report* section and to `docs/gates/G0-VIS-{A|B}-precheck.md`.
7. **Hand over:** reply with the one-sentence intent, the evaluation-point table, the number of open questions and the G0 verdict. Remind the user that they make the G0 decision (Approved / Returned) and that the next step is `developmentsupport-featurelist`.

## Quality bar

- Someone who has not read the README can restate the task from the intent sentence.
- Every number is real and sourced, e.g. "Austin permits, Socrata 3syk-w9eu: 2,380,118 rows (2026-10-15)".
- The access boundaries are explicit, because the evaluator scores them (8 points).
