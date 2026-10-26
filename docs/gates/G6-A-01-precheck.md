---
gate: G6
artifact: testplans/A-01-test-cases.md
artifact_version: "0.4 (Draft, 2026-10-19, uncommitted; reviewed_code 7311edd)"
run_date: 2026-10-19
tool: Claude
verdict: PASS
---

# G6 pre-check (run 4): A-01 test cases

Inputs read: `testplans/A-01-test-cases.md` v0.4 (30 cases: TC-001 … TC-027, TC-NF-01 … TC-NF-03); `stories/A-01-discover-sources.md` (rev 3, AC-1 … AC-7); `specs/001-discover-sources/spec.md` (FR-001 … FR-007b, NFR-001, SC-001 … SC-006); `.specify/memory/constitution.md` (I, XI, XII, XXII, XXIII). `tasks.md` was not read.

History (2026-10-19): run 1 (v0.1) failed C-05 and C-06; run 2 (v0.2) passed; run 3 (v0.3, after spec additions FR-006e, FR-006f, FR-007b) failed C-06 on TC-026 step 3. v0.4 makes that step one exact assertion and adds TC-NF-03 for the now-measurable SC-006.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | All 7 ACs map to TCs (§ 2); AC-6 → TC-011, -018, -019, -020, -021, -026, -027. |
| C-02 | FR coverage | PASS | All 27 FR/NFR items are covered, including FR-006e → TC-026, FR-006f → TC-027, FR-007b → TC-022 step 6, FR-003 download limits → TC-026. |
| C-03 | Path coverage | PASS | Happy, negative, edge, missing data, error handling, integration and recovery (TC-027) are all present. |
| C-04 | NFR tests | PASS | TC-NF-01 (≤ 2 in flight; backoff 1 s → 60 s; ≤ 5 attempts; one UA; 0 bypasses), TC-NF-02 (≤ 150,000 Austin rows), TC-NF-03 (run ≤ 8 h excluding `waiting_human_hours`, SC-006), and TC-026's `timeout_ms` limits (≥ 600,000 / ≥ 7,200,000). |
| C-05 | Complete steps | PASS (justified exception) | One command per step throughout, including TC-026 step 3 and TC-NF-03 step 2. Terminal start instead of a hosted URL: G4 C-04 exception (Project story, no hosted runtime until A-03). |
| C-06 | Exact expectations | PASS | TC-026 step 3 now expects exactly `true` from a single assertion (also `true` when nothing was throttled). Negative cases stay exact: TC-004 (`exit=1`, permit `BLOCKED`), TC-015 (`FAIL rule 6: …`, `exit=1`), TC-017 (`FAIL rule 3: …`, `exit=1`), TC-019 (`[1]`), TC-024 (no lines, `exit=1`), TC-027 step 2 (`exit=1`). No "should work" / "test passes". |
| C-07 | Real test data | PASS (justified exception) | Real records (`3syk-w9eu` 2,380,725 and 63,019; `9cir-efmm` 342,334; Lakeway 6,825; Bee Cave 4,822; Pflugerville 1,117 + 592; 18 named jurisdictions; TCAD 403 and GIS timeout dates). Snapshot = `snapshot_time` + catalog SHA-256 (no CID in A-01). |
| C-08 | Independence | PASS | All cases derive from story ACs, spec FRs, SCs and edge cases. |
| C-09 | Automation mapping | PASS (justified exception) | Every P1/P2 case names its Vitest test by TC ID (`a01.acceptance.test.ts`, `source-client.test.ts`, `workflow.blocked.test.ts`); TC-023 is manual and timed. Playwright N/A until A-03. |

## Fix list (ordered by impact on the assessment score)

No gaps. Record the decision, including PO acceptance of the C-05, C-07 and C-09 exceptions (same basis as G4 C-04 and G5 C-05).

## Decision

**Approved (HebaGaber, QC Lead), 2026-10-19.** C-05, C-07 and C-09 accepted as justified exceptions (Project story, no hosted runtime until A-03; same basis as G4 C-04 and G5 C-05).
