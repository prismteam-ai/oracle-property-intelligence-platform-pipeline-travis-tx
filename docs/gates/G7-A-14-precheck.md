---
gate: G7
artifact: A-14 (branch 014-agent-and-mcp)
artifact_version: "story head 1377fe9 (hosted results on 40808ca, golden run 5 and MCP rerun on it); CI run 40227521852 success on 9e98772; not yet merged"
run_date: 2026-10-25
tool: Claude
verdict: PASS
verdict_detail: "PASS with PO exceptions E1 to E4. The strict pre-check on 2026-10-25 was FAIL on C-01, C-04 and C-10; the PO accepted the exceptions the same day (see Decision)"
decision: "Approved with PO exceptions E1 to E4 by HebaGaber on 2026-10-25 (answer: Approve with exceptions (Recommended))"
---

# G7 pre-check: A-14 Answer roofing-lead questions through a source-backed agent and an MCP server

Inputs read: `specs/014-agent-and-mcp/tasks.md`; `docs/reports/A-14-unit-test-report.md`, `A-14-test-report.md`; `docs/reviews/CR-A-14.md` and `CR-A-14-final-{alakazam,ash,oracle,donphan}.md`; `docs/defects/ERR-61.md` to `ERR-64.md`; `docs/evidence/A-14.md`, `A-14-agent.md`, `A-14-mcp.md`, `A-14-smeargle.md`; `docs/decisions/DEC-A-14-*.md`; `git log feature/oracle-pipeline..014-agent-and-mcp` (53 commits); `gh run list --branch 014-agent-and-mcp`.

**Final verdict after the PO decision: PASS with PO exceptions E1 to E4 (front matter `verdict: PASS`). The strict pre-check below was FAIL (3 FAILs: C-01, C-04, C-10) and is kept as found.**

**Pre-check verdict: FAIL on the strict rule (3 FAILs: C-01, C-04, C-10).** Two of them rest on exceptions the PO has already accepted; one (C-04) also contains three not-run cases that no decision covers yet; C-10 can only pass after the approval. If the PO accepts exceptions E1 to E4 below at D-13 and records the decision, the verdict reads **PASS with PO exceptions**, the same convention as the A-13 report (`G7-A-13-precheck.md`). The gate is not approved by this report; the PO decision is recorded at the end of this file.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | **FAIL** (PO exception E2) | `tasks.md`: 10 of the Phase 6 convergence tasks are open: T038, T039, T040, T042, T043, T044, T046, T047, T049, T050. The PO chose "Focused subset (Recommended)" on 2026-10-25; the file says so under Phase 6 and `stories/A-16-cost-and-admin.md` lists them under "Carried forward from A-14" (items 6 to 8). Every task of Phases 1 to 5 and Phase Z, and T035, T036, T037, T041, T045, T048, T051, are ticked. |
| C-02 | Unit tests | PASS | CI run `40227521852` (head `9e98772`): `workspace` (typecheck, lint, tests, synth, both coverage gates), `gitleaks`, `oracle-runtime` and seven hosted e2e jobs, all success. Local at `1377fe9`: 142 files, 2,041 tests passed, 9 skipped. `docs/reports/A-14-unit-test-report.md` refreshed on 2026-10-25. Coverage (v8): `packages/query-core` 93.11 % statements, 94.84 % lines; `apps/api` 90.98 % statements, 92.16 % lines; `src/mcp` 95.47 %, `src/agent` 91.00 %, `src/routers` 93.44 %. **Caveats, stated:** `apps/api` branch coverage is 79.91 % (0.09 points under 80 %; `src/agent` branches 77.41 %); the entry points `handlers/agent.ts`, `handlers/mcp.ts` and `agent/router.ts` are at 0 % (hosted tests cover them); `pnpm check` run locally in parallel needed up to four attempts because existing 5 s test timeouts in other packages fail under load (each passes alone; CI passes). |
| C-03 | Code review | PASS | `CR-A-14.md`: first round (alakazam 85, ash 88, oracle 82, donphan 83, after fixes) and a final round on `3be4ff9`: **alakazam 80, ash 84, oracle 80, donphan 80**, plus `/code-review medium` (9 findings). All scores at least 75; 0 open Critical. Findings fixed in `40808ca` (spend accounting, invalid `nearest` sort, unbounded `turns` and `overrides`, run echo, gazetteer in `how`) or listed in A-16. **Caveat:** the fixes in `40808ca` were verified on the hosted site and by CI, but were not re-scored by the reviewers. |
| C-04 | TC executed on hosted URL | **FAIL** (PO exceptions E1, E3, E4) | Every executed case ran against the hosted URLs with a recorded build, none on localhost (`docs/reports/A-14-test-report.md`): UI 9 passed; MCP 12 passed, 1 failed; golden G1 to G6 pass (small run); responsive 33 of 33. **Not executed:** TC-003, TC-005, TC-008, TC-009 (UI cases that need an answered answer on the full county, E1); TC-011 (provider switch to the gateway, a deployment comparison, not run); TC-017 (skipped: the small run has no stalled permit); TC-028 (SSM fail-fast ops case, not run). TC-029 (donphan) was run by hand and passed. G1 to G4 and G6 pass on zero matching rows (vacuous), TC-002 passes only on an honest timeout, TC-015 is vacuous; all labelled in the report. |
| C-05 | Defects closed | PASS | ERR-61, ERR-62, ERR-63 are Closed with root cause, fix commits and a hosted re-test (golden run on `313d628`, run 5 on `40808ca`). The one failing executed TC, TC-021, is linked to **ERR-64**, which is Open as an accepted deviation (`DEC-A-14-mcp-burst-503.md`, PO "yes document it"); a documented gap-linked case. |
| C-06 | No open Critical | PASS | No Critical defect or review finding is open. ERR-64 is Medium. |
| C-07 | Evidence | PASS | `docs/evidence/A-14.md`: preview, MCP and agent URLs, builds, golden counts and trace ids, 33 responsive screenshots, Inspector screenshots (`img/A-14-inspector*.png`), the `donphan` transcript (`A-14-mcp.md`), CI run `40227521852`, CloudWatch lines for the MCP and query-API Lambdas, token-leak counts (0 in logs, bundle and repository). **Not captured, stated in place:** an X-Ray trace id for a successful MCP or query-API invocation (the platform report carries one only for failures); a verified X-Ray trace exists for the agent Lambda (`1-6ade5935-…`, 8.16 s). |
| C-08 | Traceability | PASS | `docs/traceability.md`: the A-14 rows (AC-23, AC-24, AC-41, AC-43, D-10, D-11, D-12, FEAT-A14 and FEAT-A15 chains) are present and corrected; `docs/kit-usage.md` has the A-14 row. The G7 gate-log row is added after your decision. |
| C-09 | Commits | PASS | All 53 commits on the story branch start with `A-14:` (0 do not). `gitleaks` is green in CI; the PO-run token counts are 0 in the CloudWatch logs, the hosted bundle and every commit. |
| C-10 | Story status | **FAIL until approval** | `stories/A-14-agent-and-mcp.md` front matter reads `status: Ready`, `gate: G4`. It is set to `Done` (with G5 to G7 recorded) only after the PO decision, in the approval commit. |

## Exceptions the PO is asked to accept at D-13

| # | Exception | Already decided? | Record |
| --- | --- | --- | --- |
| E1 | The agent, the AI tab and the MCP data tools are proven only on the small run `travis-202609-permits-20261021t103516z`; Run 1 and Run 2 time out on the Lambda. TC-003, TC-005, TC-008, TC-009 are not run; TC-002 passes on an honest timeout only. | Yes, "Close like A-13 (Recommended)" | `DEC-A-14-agent-mcp-full-county.md`; A-16 item 1 |
| E2 | Ten convergence tasks are not built in A-14. | Yes, "Focused subset (Recommended)" | `tasks.md` Phase 6; A-16 items 6 to 8 |
| E3 | A burst above 5 rps on `/mcp` mostly answers 503, not 429; TC-021 stays red. | Yes, "yes document it" | `DEC-A-14-mcp-burst-503.md`; `ERR-64.md`; A-16 item 2 |
| E4 | TC-011 (gateway provider), TC-017 (no stalled permit on the small run) and TC-028 (SSM fail-fast on a staging stack) were not executed. | **No: needs your decision** | `docs/reports/A-14-test-report.md` |

## Fix list (by impact on the assessment score)

1. **Record your D-13 decision on E1 to E4.** E4 is the only one without a prior decision. Nothing in the code needs to change for C-01 or C-04.
2. **After approval:** write "Approved" and the date in this file, set `status: Done` in the story (C-10), add the G7 row to the gate log in `docs/traceability.md`, then merge with `--no-ff`.
3. **Optional, raises confidence, not required by the checks:** ask the four reviewers to re-score `40808ca`, and raise the default test timeout in the existing tests that flake under parallel load (`pipeline/publish`, `tests/e2e/lib`), both listed for A-16.
4. **Not fixable in A-14:** the full-county proof (A-16, the per-run Explore index) and the 429-versus-503 behaviour (A-16, WAF rule or more Lambda concurrency).

## Gate checklist (the PO ticks after the decision)

- [x] G7-1 Tasks done or deferrals accepted (E2)
- [x] G7-2 Unit tests green in CI; coverage stated
- [x] G7-3 Review scores at least 75; 0 Critical
- [x] G7-4 Test cases executed on the hosted URL; exceptions accepted (E1, E3, E4)
- [x] G7-5 Defects closed or gap-linked
- [x] G7-6 Evidence complete
- [x] G7-7 Traceability complete
- [x] G7-8 Commits clean
- [x] G7-9 Story status set to Done
- [x] Decision: ☑ Approved (with PO exceptions E1 to E4) ☐ Returned · HebaGaber · 2026-10-25

## Decision

Approved with exceptions E1 to E4 by the PO (HebaGaber) on 2026-10-25, answering the D-13 question "approve the G7 gate for A-14 with exceptions E1 to E4, then merge ... and push to your fork" with "Approve with exceptions (Recommended)". E4 (TC-011, TC-017, TC-028 not executed) is accepted by this answer; E1 to E3 were accepted earlier (see the table above). The story is set to `Done` and merged into `feature/oracle-pipeline` with `--no-ff`.
