---
gate: G6
artifact: testplans/A-16-test-cases.md
artifact_version: 0.1, 2026-10-26
run_date: 2026-10-26
tool: Claude
verdict: PASS
---

# Gate G6 pre-check: A-16 test case approval

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | AC coverage | PASS | Section 2 maps AC-1 to AC-14, each to at least one TC (AC-12 has 11, one per page family; AC-13 has 5; AC-14 has 3). |
| C-02 | FR coverage | PASS | FR-001 to FR-013 each map to at least one TC (FR-011 to TC-023..033, FR-012 to TC-034..038, FR-013 to TC-038..040). |
| C-03 | Path coverage | PASS | Happy (TC-001, 010, 013, 034), negative (TC-004, 006, 011, 012, 014, 016, 017, 018), edge (TC-002, 014, 015), missing-data (TC-008, 009, 018, 021). |
| C-04 | NFR tests | PASS | NFR-001 to TC-NF-01 ($0.00 fixed, one $10 budget); NFR-002 to TC-NF-02 (no horizontal scroll, 0 token violations); NFR-003 to TC-NF-03 and TC-034 (pickup at most 60 s, p95 under 3 s); NFR-004 to TC-NF-04 (0 token matches, 0 serious axe violations). |
| C-05 | Complete steps | PASS | Hosted-URL cases open `{RUNTIME_URL}` first; admin cases sign in. Declared exceptions: CDK cases TC-003, 004, 022 (run in `cdk synth`) and TC-018 (starts with "the bridge is stopped"). Minor: TC-017 step 1 is only the sign-in page open, then a direct API call with the expired token. |
| C-06 | Exact expectations | PASS | Exact texts: "$0.00 fixed per month", "Filebase usage: not available · {reason}", "A run is already running", "Bridge offline · command expired at {time}", "Sign-in is not available right now, try later", HTTP 403/401. Open point: the wrong-password message (TC-012 step 2) has no fixed wording in the story; the plan must fix it. |
| C-07 | Real test data | PASS | Real sources and figures (TCAD 403 on 2026-10-17/19, 2,380,725 Socrata rows, 441,961 properties); snapshot is the latest published run's manifest CID recorded at run time, with Run 3 `bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm` as the candidate. |
| C-08 | Independence | PASS | Derived from the story ACs, edge cases and Closure table; no `tasks.md` reference and no T-number. |
| C-09 | Automation mapping | PASS | Every P1/P2 case names a Playwright test (`tests/e2e/A-16-*.spec.ts`) or a CDK test (`infra/test/*.test.ts`). |

## Fix list

1. Fix the wrong-password message wording in the plan or UX copy, then update TC-012 step 2.
2. Replace the candidate manifest CID in section 5 with the run actually live at test time and log it in section 11.
3. Fill `docs/evidence/A-16-prototype-parity.md`; TC-023 to 033 depend on it and the file does not exist yet.
4. Add the TC-017 first step as a real sign-in if the expired token is produced by time-shifting.

Not approved here: the QC Lead ticks the gate checklist, records the decision and date, and adds a row to the gate log in `docs/traceability.md`.
