---
gate: G6
artifact: testplans/A-03-test-cases.md
artifact_version: v1.0 (run 2)
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G6 pre-check: A-03 test cases (run 2)

History (2026-10-21): run 1 failed C-05 (non-UI cases started in a terminal) and C-09 (17 cases mapped to Vitest, not Playwright). Both fixed in v1.0 before run 2; see the run-1 findings below the table.

Inputs read: `testplans/A-03-test-cases.md` v1.0, `stories/A-03-walking-skeleton.md` (incl. Amendments PO 2026-10-21), `specs/003-walking-skeleton/spec.md`, `.specify/memory/constitution.md`. A-03 has a hosted runtime, so the A-01/A-02 C-05/C-09 exceptions do not apply.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | AC-1…AC-7 each have ≥ 1 TC (§ 2). |
| C-02 | FR coverage | PASS | Spec FR-001…FR-013 each mapped (§ 2). |
| C-03 | Path coverage | PASS | Happy (TC-010/020/040), negative (TC-002/032/033/041/042/060), edge (TC-012/024/034/053/061), missing-data (TC-022/025/030/031). |
| C-04 | NFR tests | PASS | NFR-001 (TC-NF-01/02/05/06), NFR-002 budget (TC-052), NFR-003 (TC-NF-03), NFR-004 (TC-050/052/NF-04), all with numeric thresholds. |
| C-05 | Complete steps | PASS | UI cases open `{RUNTIME_URL}/…` (route stubs for TC-024/032/033/034 are set up immediately before that navigation). Every non-UI case has step 0: `{RUNTIME_URL}/runs` → manifest CID and `runId` (TC-003…005, 040…044, NF-05), or `{RUNTIME_URL}/build.json` → `git checkout {sha}` (TC-001, 002, 027, 052, 053, 060, NF-06); TC-051 starts from TC-050's hosted call. One action per step, exact commands and data. |
| C-06 | Exact expectations | PASS | Exact strings for labels, engine line, fallback, both-down state, localhost guard and allowlist refusal (§ 3). |
| C-07 | Real test data | PASS | Real 2026-10-20 snapshot (42/38/1/0), 2,380,725-row table; snapshot = A-03 run manifest CID, read at run time and recorded in evidence (cannot exist before publish). |
| C-08 | Independence | PASS | Derived from the story ACs, edge cases and PO decisions; no `tasks.md` reference. |
| C-09 | Automation mapping | PASS | All 40 cases name a Playwright spec under `tests/e2e/` with `@scenario:A-03-TC-nnn`; build-time cases run through `tests/e2e/build-checks.spec.ts`, which spawns the named Vitest/CDK suite at the deployed SHA. |

## Run-1 findings (fixed)

- C-05 FAIL: TC-001…005, 027, 040…044, 052, 053, 060, NF-05, NF-06 began "in a terminal at the repository root". Fixed with a hosted step 0.
- C-09 FAIL: 17 P1/P2 cases named Vitest files only. Fixed by mapping them to Playwright specs.

## Fix list

None. 0 FAILs.

## Notes for the plan (not G6 gaps)

- § 3 fixes exact texts the build must emit verbatim (localhost guard, gateway refusal, both-down error) and harness config keys (`CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST`, `PINATA_GATEWAY_HOST`, `READPATH_PRIVATE_PREFIX`).
- `tests/e2e/build-checks.spec.ts` (Playwright wrapper that runs Vitest/CDK at the `/build.json` sha) must exist in the plan/tasks.
- `specs/003-walking-skeleton/agent-design.md` line 82 still has the pre-D-4 verify allowlist (ipfs.io, dweb.link; rejects Filebase). The amended AC-6 and these cases require Pinata + Filebase.

Next: tick G6-8 in the test plan, record the decision and date, and add a row to the gate log in `docs/traceability.md`.

**Decision:** ☑ Approved ☐ Returned · HebaGaber · 2026-10-21 (PO: "Approve (Recommended)", round R5, 11:00)
