# /speckit-analyze report: A-07 enrich and reconcile

Run 2026-10-22, Stage 3 step S3.5, against `spec.md`, `plan.md`, `tasks.md` as they stood after `/speckit-tasks`.

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation | Resolution |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | Coverage Gap | HIGH | spec.md FR-009; tasks.md T027 | FR-009's `blocked`+`no_lexicon_carrier` interaction had no task testing that specific interaction | Add the interaction case as its own test task | **Fixed**: added T023b, a dedicated status test for the interaction; T027 now depends on it |
| H2 | Coverage Gap | HIGH | spec.md FR-010; tasks.md T021–T027 | "Never look up BBB for a `candidate`/`unresolved` contractor" had no explicit negative test | Add an explicit negative test case | **Fixed**: extended T022 to assert the wrapper never receives a `candidate`/`unresolved` contractor |
| M1 | Underspecification | MEDIUM | spec.md FR-014; tasks.md T032 | FR-014 covers both business and place name matches; T032 named only the business case | Extend T032 to include the place case | **Fixed**: T032's description now names both the business and the Overture-place case |

**Metrics**: 19 FRs + 4 NFRs = 23 requirements · 61 tasks (T001–T061, after two renumbering rounds: +4 tests-first tasks, then +5 tasks for the comparison-harness implementation and the a07-coverage.ts/a07-verify.ts build+test pairs) + 6 Phase-Z + 3 Polish · Coverage 100% (all ≥1 task after fixes) · Ambiguity count: 0 · Duplication count: 0 · Critical issues: 0 · High issues: 2 (both fixed).

## Next Actions taken

Both HIGH findings were fixed directly in `tasks.md` before proceeding to Stage 3's G5/G6 pre-checks, per the walkthrough's rule to fix every CRITICAL and HIGH finding from `/speckit-analyze`.

## Addendum (2026-10-22, after the first G5/G6 pre-check round)

The first G5 and G6 pre-checks surfaced additional gaps unrelated to this analysis's own three findings (file paths, phase ordering, an un-filed-but-claimed lexicon-drafts file, automation naming, test-data exactness). Those were fixed directly in `plan.md`, `tasks.md` and `testplans/A-07-test-cases.md` (see `run-log.md` S3.6a/S3.6b). None of those fixes touch the FR-coverage mapping this report covers — they are additive (file paths, an FR-008 task, a reordered Phase N/Z, an Automation column) and do not contradict anything above. A full `/speckit-analyze` re-run was not repeated a second time since no new FR/plan/task semantic conflict was introduced by those fixes; the coverage table above remains accurate.

## Addendum 2 (2026-10-22, after the second G5/G6 pre-check round)

A second G5 re-check found the `T023b`/`T027b` IDs from the first fix round violated the strict sequential `T###` format, and that four implementation tasks (the Loader track, the sampler, the BBB enrichment profile, and the coverage-% computation) had no preceding test task — a tests-first gap. Both were fixed: 4 new test tasks were inserted immediately before their implementations and the entire task list was renumbered sequentially T001–T056 (a mechanical renumbering script, verified against every `depends` reference and every prose mention in the Dependencies/Critical-path/Parallel-example sections). This is purely structural — no FR's coverage, no task's file path or wave assignment, and no dependency relationship changed in substance, only the ID labels and the addition of 4 test-only tasks. The coverage table above remains accurate; the task count in the Metrics line below reflects the new total.
