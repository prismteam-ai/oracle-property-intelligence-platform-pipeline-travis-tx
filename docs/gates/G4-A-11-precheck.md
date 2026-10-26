---
gate: G4
artifact: stories/A-11-publish-and-runs.md
artifact_version: merged 2026-10-21 (parts A-11, A-12)
run_date: 2026-10-23
tool: Claude
verdict: PASS
---

# G4 pre-check: A-11 Publish the full county by CID and keep it current with incremental runs

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | FAIL | `depends_on: [A-07]` only. AC-1/AC-4/AC-7/AC-11 need A-04 (data groups, digests, TCAD supplemental), AC-2 needs A-02 (`RunManifestV1`), AC-6/AC-12 need A-03 (publish code, infra). All three are merged and `status: Done` (verified in Stage 0), so this is a declaration gap, not a readiness gap. Fix: add `A-02, A-03, A-04` to `depends_on`. agents.design/builder/reviewers/verify/skills all match AGENT-MAP.md § 4 row for A-11 exactly — PASS on that part. |
| C-02 | User story form | PASS | "As an independent retriever and the Oracle operator, I want … so that …" present; independent test given (two numbered items under "Independent test"). |
| C-03 | GWT | PASS | AC-1…AC-12 are all Given/When/Then. The `☐ testable` boxes are unticked by design — they get ticked at G4 approval (S1.6), not at pre-check time. |
| C-04 | Observable and real | EXCEPTION (recorded, not FAIL) | `ui: false`; this story has no hosted-UI surface. Per the walkthrough's own gate-exception table: observable instead on the public IPFS network (two public gateways), in AWS (`aws scheduler get-schedule` showing `DISABLED`), and in the PR (manifests, release URLs); the CountyLens Manifest/Verify/Runs pages show it only after A-13 merges. Data is real: AC-4's `capture_receipt` figures trace to the real Austin/Comptroller/TCAD receipts already captured in A-01/A-04. |
| C-05 | Scale + honesty | PASS | Scale: AC-3, AC-9. Missing-data/error: AC-5, AC-11. |
| C-06 | Testable | PASS (one soft note) | AC-6's "the second pin" names no provider yet — intentional, deferred to the Stage 3 design decision (D-3), not a story defect. Each AC is otherwise verifiable without ambiguity (file/script names, exit codes, exact field names given). |
| C-07 | Edge cases | PASS | 4 edge cases from A-11, 4 from A-12 (≥ 2 required). |
| C-08 | Requirements traced | PASS | FR-001…FR-011 and NFR-001…NFR-003 all trace to an AC; NFRs carry numeric thresholds (100%, ≥3 runs/≥3 dates, ≤7 days, $0). |
| C-09 | Prototype | N/A (PASS) | `ui: false`; the related prototype screens (Manifest, Verify, Runs, Compare) are named for traceability but belong to A-13, not this story. |
| C-10 | Ready | PASS (with the C-01 gap noted) | A-07 (declared) and A-02/A-03/A-04 (implicit, see C-01) are all merged into `feature/oracle-pipeline` with `status: Done` — confirmed directly in Stage 0 (commit `A-07: merge`, `A-04: merge`, `A-03: merge`, `A-02: merge`, all present in `git log --first-parent feature/oracle-pipeline`). No stub data needed; everything is real. |
| C-11 | Slicing | FAIL (recommend recording as exception, not re-slicing) | `size_days: 2.5` exceeds the 0.5–1.5 day band. The excess is calendar wait, not work: AC-9 requires ≥ 3 runs on ≥ 3 distinct UTC dates, which cannot be compressed without breaking the AC. The PO's 2026-10-22 scope note already narrows Release scope to Run 1 + scheduler for G7, with Runs 2/3 continuing after the PR opens — re-slicing into separate stories would break the single run-chain (`previousManifestCid`) this story's ACs depend on. One primary eval point (A4) holds; A1/A3 are secondary, not a second primary. |
| G4-9 | No `[NEEDS CLARIFICATION]` | PASS | None found in the file. |

## Fix list (ordered by impact)

1. **C-01 / G4-8 (real FAIL, fixable now):** add `A-02`, `A-03`, `A-04` to `depends_on` in the front matter. These are implicit dependencies the ACs actually rely on; all three are merged and Done, so this is a wording fix, not a scope change.
2. **C-11 (recommend recording, not fixing):** record the 2.5-day size as an accepted exception (calendar waits, not work scope) rather than re-slicing the story — splitting would break AC-9's run-chain requirement.
3. **C-04 (recommend recording):** record the "observable on hosted runtime" exception once, per the walkthrough's own gate-exception table, since `ui: false` and the real evidence is public-IPFS + AWS + PR instead.

Both C-11 and C-04 are walkthrough-anticipated exceptions, not gaps to argue away silently — they should be written into the gate decision line, not just filed here.

## Update 2026-10-25 (before the A-11 merge)

- **C-01 fixed:** `depends_on` is now `[A-02, A-03, A-04, A-07]`.
- **C-04 exception accepted by the PO (HebaGaber, 2026-10-25):** `ui: false`; observable on the public IPFS network, in AWS and in the PR, per the walkthrough's gate-exception table.
- **C-11 exception accepted by the PO (2026-10-25):** `size_days: 2.5` is calendar waiting between UTC dates, not work; re-slicing would break AC-9's run chain.
