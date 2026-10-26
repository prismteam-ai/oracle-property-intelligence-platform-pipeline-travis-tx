---
gate: G6
artifact: testplans/A-02-test-cases.md
artifact_version: "0.2 (2026-10-21, run-1 fixes applied)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G6 pre-check (run 2): A-02 test cases

Inputs read: `testplans/A-02-test-cases.md` v0.1, `stories/A-02-data-contract.md` (Ready), `specs/002-data-contract/spec.md`, `.specify/memory/constitution.md` (articles XXI–XXIII).

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | AC-1 → TC-001–005; AC-2 → TC-008–010; AC-3 → TC-012–015; AC-4 → TC-016–018; AC-5 → TC-019, NF-03; AC-6 → TC-020–023; AC-7 → TC-024; AC-8 → TC-025–027 |
| C-02 | FR coverage | PASS | FR-001…FR-011 each map to ≥ 1 TC (§ 2); FR-009 → TC-011, FR-010 → TC-028, FR-011 → TC-006, 007, 029 |
| C-03 | Path coverage | PASS | Happy (TC-001, 008, 020, 025), negative (TC-010, 011, 013, 014, 017, 021, 028, 030), edge (TC-004, 005, 015, 022), missing data (TC-003, 018, 024, 026), error (TC-029). The walkthrough's required negatives are all present: ZIP 99999 (TC-021), Auxiliary Power (TC-013), unknown status (TC-017), no-carrier reason (TC-003/024), Expired never relabelled (TC-018). |
| C-04 | NFR tests | PASS | NFR-001 → TC-012/NF-01 (≥ 24/25, ≤ 1 needs_review, 0 solar/PV/RTU); NFR-002 → NF-02 (≥ 80% per package, four metrics) |
| C-05 | Complete steps | PASS (justified exception) | There is no hosted URL until A-03 (G4 C-04, PO-accepted). Every case starts with "step 0" (terminal at the repo root, branch check) and names exact commands and data. |
| C-06 | Exact expectations | PASS (run 2) | Run 1 FAIL, fixed: **(a) TC-028:** only the CIDv0 rejection names its error path (`artifacts.0.cid`). "rejects any `https://…/ipfs/…` gateway URL value", "rejects a `directory` artifact without `carCid`" and "rejects an `ipns` field" give no exact rejection state. **(b) TC-022:** "'Pflugerville' → `partial_in_travis` per the Census county file (recorded value)" has no expected value. |
| C-07 | Real test data | PASS | Real permits (`2026-034767 BP` and 4 more Expired, `2026-122340 BP`), the TCAD certified export, Census GEOID 4857176. The snapshot is named (`contract/v1/pilot-manifest.json`); its CID is recorded in the execution log once the pilot runs (it cannot exist before). |
| C-08 | Independence | PASS | Cases come from the story ACs, edge cases and spec FRs; the commands are the story's independent test and the spec-level quickstart; `tasks.md` was not used |
| C-09 | Automation mapping | PASS (justified exception) | Each P1/P2 case names its Vitest test (`-t "A-02-TC-0nn"`) instead of Playwright (G6 C-09 exception: no hosted runtime) |

## Exceptions

- **C-05 and C-09.** This is a Project story with no hosted runtime until A-03. Cases start from a terminal at the repo root on `002-data-contract`, and Vitest replaces Playwright. Same pattern as A-01 G6.

## Fix list (ordered by impact)

1. **TC-028:** state the exact rejection for each case: the Zod issue path and message prefix. Gateway URL → issue at the field's path, message "gateway URLs are derived, never stored". Directory without `carCid` → issue at `artifacts.<n>.carCid`. `ipns` field → unrecognized key `ipns` at the root.
2. **TC-022:** drop the Pflugerville clause, or give its expected value. The story names only Round Rock, Cedar Park and Leander.

## Run 2 (2026-10-21)

PO/QC decision at D-6: "Fix, approve if PASS (Recommended)". Both fixes are applied to v0.2: TC-028 gives exact issue paths and messages, and the TC-022 Pflugerville clause is removed. Re-check: C-06 PASS; the other checks are unchanged. **Verdict: PASS, 0 FAILs** (C-05 and C-09 are justified exceptions).

**Decision:** ☑ Approved ☐ Returned · HebaGaber (QC Lead) · 2026-10-21
