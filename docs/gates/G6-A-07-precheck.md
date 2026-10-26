---
gate: G6
artifact: testplans/A-07-test-cases.md
artifact_version: "2026-10-22, run 4 (after 3 rounds of fixes; uncommitted on 007-enrich-reconcile)"
run_date: 2026-10-22
tool: Claude
verdict: PASS-with-exceptions
---

# G6 pre-check (run 4): A-07 enrich and reconcile

Inputs read: `testplans/A-07-test-cases.md`, `stories/A-07-enrich-reconcile.md`, `specs/007-enrich-reconcile/spec.md`.

**Run history (summary; full detail in run-log.md S3.6b/d/f):**

- **Run 1: FAIL (4 of 9).** C-05 (`{DATE}` left as an unresolved placeholder), C-06 (TC-003 and TC-043 had vague expected results), C-07 (no manifest-CID exception recorded for this pre-publication story), C-09 (no Automation column in § 7; only ~3 of 44 cases named an invocable test).
- **Run 2: FAIL (4 of 9).** C-05/C-06 still had under-specified fixture steps (TC-010, TC-026, TC-029, TC-032, TC-036), C-07's exception existed in the body of § 3.1 but not its heading, C-09 still had 12 generic "`qdb_ro` checks" cells with no named handle. Fixed: exact fixture values/paths added to all five cases; § 3.1's heading widened to cover C-07; all 12 generic cells replaced with a named per-case Vitest handle backed by a new shared integration test file.
- **Run 3: FAIL (1 of 9: C-05).** `{JOB_ID}` was used throughout but never captured by any step; TC-026 called a command name (`EN identity:load-registry`) that didn't match § 3.3's actual command (`EN registry --load`); TC-006 offered two alternative actions instead of one; TC-038's expected basis was "`built_year` or another anchor, or `unknown`". Fixed: the registry-load command's output line now documents printing `job_id=<JOB_ID>`; TC-026 corrected to the real command name; TC-006 reduced to one exact command; TC-038 now seeds a property with no competing `Final` permit so the basis is pinned to exactly `built_year`.
- **Run 4: FAIL (1 of 9: C-05), fixed.** TC-002's crosswalk-found branch was stale (D-10 already confirmed no crosswalk exists, so the "if found" conditional never applies this run); TC-021 referenced "TC-015's enrichment" instead of giving its own exact command; TC-027 step 2 had no expected output; TC-034 offered two targeting approaches in one step. Fixed: TC-002 now pins to the fixture-only path as the actual flow, with the crosswalk-field path moved to a documented "if a future run finds one" note; TC-021 gives the exact `EN bbb --probe` command and a precondition block; TC-027 names the exact expected per-category rows; TC-034 now uses the estimator's single-property fixture mode (`--tcad-id 0223120506`) instead of an either/or phrasing.

**Accepted exceptions (§ 3.1, recorded once):**
1. **C-05 (hosted URL):** A-07 has no UI and publishes nothing this run; every case instead starts from a terminal at the repo root on branch `007-enrich-reconcile` (step 0: `git rev-parse --abbrev-ref HEAD`).
2. **C-07 (manifest CID):** this is a pre-publication story (A-11 publishes; A-07 never uploads, D-3/D-4) — every case's real-data claim traces to the registry-load watermark + snapshot digest instead of a manifest CID.
3. **C-09 (Playwright mapping):** each case maps to a named Vitest test, an `EN`/`RA`/`qdb_ro` command sequence, or a read-only SQL/`grep` check — documented per case in § 7's Automation column, including a shared integration test file (`test/travis/a07/integration/qdb-checks.test.ts`) for read-only `qdb_ro`-only cases.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | AC-1 through AC-19 all mapped in § 2 and § 7. |
| C-02 | FR coverage | PASS | FR-001 through FR-019 and NFR-001 through NFR-004 all mapped. |
| C-03 | Path coverage | PASS | Happy, negative, edge and missing-data cases all present for all four tracks. |
| C-04 | NFR tests | PASS | TC-012 (25-row sample, 0/25 or vacuous), TC-024 (single UA, request count), TC-033/TC-041 (exact equality, `rowsWritten: 0`) all have measurable pass criteria. |
| C-05 | Complete steps | PASS (run 4 fix) | Every case gives one exact command per step; `{JOB_ID}` is now captured from the registry-load command's own printed output; TC-002/TC-006/TC-021/TC-026/TC-034 no longer offer alternative or conditional actions. |
| C-06 | Exact expectations | PASS (run 1–3 fixes) | TC-003, TC-006, TC-027, TC-038, TC-043 all state the exact message, object, exit code, or value rather than a description. |
| C-07 | Real test data | PASS (run 1–2 fixes) | § 5 names the real Travis snapshot (342,334 Comptroller rows, 22,084 reroof candidates, etc.) re-measured at run time; synthetic fixtures are explicitly labelled `"TEST FIXTURE, not real"`; the manifest-CID exception is recorded and applied. |
| C-08 | Independence | PASS | Cases derive from the story's ACs, not from `tasks.md`; the header note on this has been corrected to reflect that `tasks.md` now exists and was cross-checked, not "does not exist yet". |
| C-09 | Automation mapping | PASS (run 1–2 fixes) | Every row of § 7 names an exact automation handle (a Vitest `-t` name, an `EN`/`RA` command, or the shared integration test file), per the recorded C-09 exception. |

## Fix list

No open FAILs after run 4. The three items above (no hosted URL, no manifest CID, no Playwright mapping) are accepted, documented exceptions, not defects.

## Next steps (PO)

- Tick the G6 checklist entries and record the decision and date.
- `/speckit-implement` may start only after G5 and G6 are both approved (constitution XVIII).

**Decision:** ☑ Approved · Round R3, D-13, 2026-10-22 ("Approve (recommended)" — conditions met: run 4 verdict PASS with only the three accepted, pre-documented exceptions).
