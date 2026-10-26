---
gate: G6
artifact: testplans/A-11-test-cases.md
artifact_version: 0.1 (2026-10-23 draft)
run_date: 2026-10-23
tool: Claude
verdict: PASS
---

# G6 pre-check: A-11 test cases

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | AC-1…AC-12 each map to ≥1 TC (§2, §7). |
| C-02 | FR coverage | PASS | FR-001…FR-011 all mapped via §2 (1:1 with the AC each FR traces to in spec.md). |
| C-03 | Path coverage | PASS | Happy (TC-001/003/005/006/008/010/011/012/013/016), negative (TC-002/004/007/009/014/015/017), edge (§9) and missing-data (TC-014/015) all present. |
| C-04 | NFR tests | PASS | TC-NF-01/02/03 each have a measurable pass criterion (100% verified, ≥3 runs/3 dates, $0 idle). |
| C-05 | Complete steps starting from hosted URL | **EXCEPTION (recorded, not FAIL)** | `ui: false`; per the walkthrough's own G6 C-05/C-09 gate-exception table, every case starts from a terminal at the repo root on `011-publish-and-runs` instead, recorded explicitly in the file's header note. |
| C-06 | Exact expectations | PASS | Negative cases name exact strings/behaviors (`"no newer export"`, `"blocked · 403"`, exit non-zero, `ALL ARTIFACTS VERIFIED`) — no "should work"/"test passes" language found. |
| C-07 | Real test data | PASS (procedural note) | §5 names real counts (493,246 TCAD, ~2.38M Austin permits, 22,084 contractor ledger rows) and states the manifest CID will be recorded once Run 1 publishes (`docs/evidence/A-11-manifest.md`) — the CID itself can't exist before the story's own first upload, which happens later in Stage 6; this is expected sequencing, not a gap. |
| C-08 | Independence | PASS | Derived from `stories/A-11-publish-and-runs.md`'s ACs and `spec.md`'s FR numbering only; `tasks.md` was not consulted while drafting. |
| C-09 | Automation mapping | **EXCEPTION (recorded, same as C-05)** | No Playwright applies (`ui: false`); the Automation column instead names the exact Vitest file or manual/live evidence step for each P1/P2 case, consistent with the same recorded gate exception. |

## Fix list

None required. Two items (C-05, C-09) are the same walkthrough-anticipated exception as G4's C-04 and plan.md's Constitution Check rows I/VII–IX/X — recorded once here, not re-argued as gaps.

Verdict: **PASS**, with the two recorded exceptions above.
