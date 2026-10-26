---
gate: G5
artifact: specs/007-enrich-reconcile (spec.md, plan.md, tasks.md)
artifact_version: "2026-10-22, run 4 (after 3 rounds of fixes; uncommitted on 007-enrich-reconcile)"
run_date: 2026-10-22
tool: Claude
verdict: PASS-with-exceptions
---

# G5 pre-check (run 4): A-07 enrich and reconcile

Inputs read: `specs/007-enrich-reconcile/spec.md`, `plan.md`, `tasks.md`, `agent-design.md`, `research.md`, `data-model.md`, `contracts/{cli,resolver,report,estimator}.md`, `quickstart.md`, `run-log.md`, `analyze-report.md`; `stories/A-07-enrich-reconcile.md` (status Ready, G4 approved, D-1); `docs/architecture-constitution.md`; `.specify/memory/constitution.md`.

**Run history (summary; full detail in run-log.md S3.6a/c/e):**

- **Run 1: FAIL (6 of 10).** C-02 (phase/track ordering unflagged), C-03 (11 tasks missing file paths), C-05 (no exact `agents.verify` script named, Phase N after Z), C-07 (views.sql roof-age extension unflagged as a deviation), C-09 (FR-008 uncovered, 15/19 FRs never cited by ID), C-10 (`/speckit-analyze` output not recorded in run-log.md).
- **Run 2: FAIL (5 of 10).** C-02 (track-order phases flagged again — recorded as an accepted, justified deviation per the walkthrough's "four task groups, one per track" instruction, not reordered), C-03 (T037/T039 missing file paths), C-07 (the hosted-URL exception existed only in the G4 table, not plan.md's Complexity Tracking), C-08 (builder row omitted `use-neutral-lexicon`, in the story's skills list), C-10 (analyze-report.md predated the plan/tasks fix edits). Also discovered independently: `mew`'s agent-design.md handback claimed it wrote `lexicon-extension-drafts.md` but the file never landed on disk — recovered from the agent's own reported content.
- **Run 3: FAIL (3 of 10).** C-03 (`T023b`/`T027b` were not strict sequential `T###` IDs; `T037`/`T039` — pre-renumber — still lacked exact file paths in one case), C-04 (tests-first violated for the Loader track, the 25-row sampler, the BBB enrichment profile, and the coverage-% computation — each had an implementation task with no preceding test), C-10 (analyze-report.md cited IDs that no longer existed). Fixed: 4 new test tasks inserted before their implementations; the entire task list mechanically renumbered T001–T056 (every `depends` and prose reference verified); a Complexity Tracking row added documenting the no-hosted-URL constitution exception.
- **Run 4: FAIL (4 of 10), fixed.** C-03 (`T030` and `T038` were both `[P]` while `T038` shared a file with `T035`), C-07 (wording tightened), C-09 (`runs/a07-coverage.ts`, `runs/a07-verify.ts`, and the view-derivation comparison harness implementation had no build task), C-10 (stale metrics line). Fixed: `T038` moved to its own file (`identity-stability.test.ts`); `[P]` removed from `T030`; 5 new tasks added (the comparison-harness implementation, plus `a07-coverage.ts` and `a07-verify.ts` each with a preceding test); task list renumbered again to T001–T061 (verified).

**Accepted exceptions (recorded once, Complexity Tracking):**
1. Phase Z TZ02–TZ04 are N/A: "pipeline-only story (`ui: false`), deploys nothing; shown on the hosted Coverage/Explore/Property pages only after A-11/A-13 publish" — same pattern as every prior pipeline-only story (A-01–A-04).
2. No hosted-URL evidence this story (departs from the general P0 rule that only the hosted runtime counts): documented in a new Complexity Tracking row citing the G4 gate report's C-04 exception.
3. Four task-group phases are ordered by track letter (A, B, C, D — matching spec.md's own user-story order and the light-lane "one builder per track" rule), not resorted into a strict P1/P1/P2/P3 priority stack. Documented in tasks.md's Organization section as an intentional, justified structural choice.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | PASS | 0 `[NEEDS CLARIFICATION]` in spec.md; the one deferred clarify question (as-of date) resolved at D-9, round R2. |
| C-02 | Phase structure | PASS (with accepted exception 3) | Setup → Foundational (blocks US1/US3) → US1(A)/US2(B)/US3(C)/US4(D) → Polish → Phase Z, in that order; track-letter ordering is intentional, not a priority-stack omission. |
| C-03 | Task format | PASS (run 4) | 61 sequential `T###` IDs (T001–T061) plus TZ01–TZ06 and TN01–TN03; every task has exact file path(s); no `[P]` pair shares a file; every `depends` reference resolves to a real task. |
| C-04 | Tests first | PASS (run 3 fix) | Every implementation task in Phases 3–6 is preceded by a dedicated test task (including the 4 added in run 3: Loader track, sampler, BBB profile, coverage-%, and the 2 added in run 4: `a07-coverage.ts`, `a07-verify.ts`). |
| C-05 | Live verification last | PASS | Phase N (Polish) precedes Phase Z (always last, per the template); TZ05 names the exact script (`runs/a07-verify.ts`, built by T055) rather than a generic description. |
| C-06 | LLD complete | PASS | plan.md: Technical Context, Project Structure (real `pipeline/oracle-runtime/travis/` paths), data flow, integration points, test approach; research.md, data-model.md (7 entity shapes), contracts/{cli,resolver,report,estimator}.md, quickstart.md all present. |
| C-07 | Architecture conformance | PASS (run 4 wording fix) | Constitution Check table all ✅ (with exceptions recorded); the `packages/query-core/views.sql` roof-age extension is explicitly flagged as a pre-existing, independent check (ADR-0002 #7), never the production source, in both the Project Structure row and a dedicated "Architecture conformance note". |
| C-08 | Kit usage | PASS (run 2 fix) | `agent-design.md` holds both `oracle`'s and `mew`'s answers plus a Disagreements table; plan.md's Kit Agent Ownership table cites it and lists the builder's full skill set including `use-neutral-lexicon`. |
| C-09 | Coverage | PASS (run 1 + run 4 fixes) | FR-001–FR-019 and NFR-001–NFR-004 each map to ≥1 task, with explicit `(FR-xxx)` tags on every task description; FR-008's coverage-% computation has its own task (T029 test + T053 impl, post-renumber); `runs/a07-coverage.ts` and `runs/a07-verify.ts` each have a dedicated test+implementation pair. |
| C-10 | Analyze | PASS (run 2–4 addenda) | `/speckit-analyze` ran at S3.5 (2 HIGH found and fixed before this gate); `specs/007-enrich-reconcile/analyze-report.md` records the findings, fixes, and two addenda explaining why the subsequent renumbering rounds are additive, non-conflicting, and reflect the current T001–T061 count. |

## Fix list

No open FAILs after run 4. The three items above (TZ02–TZ04 N/A, no hosted-URL evidence, track-letter phase ordering) are accepted, documented exceptions, not defects.

## Next steps (PO)

- Tick the G5 checklist entries and record the decision and date.
- `/speckit-implement` may start only after G5 and G6 are both approved (constitution XVIII).

**Decision:** ☑ Approved · Round R3, D-12, 2026-10-22 ("Approve (recommended)" — conditions met: run 4 verdict PASS with only the three accepted, pre-documented exceptions).
