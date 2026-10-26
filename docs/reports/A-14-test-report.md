---
id: QC-RPT-A-14
type: test-execution-report
feature: FEAT-A14
story: A-14
test_cases: testplans/A-14-test-cases.md
runtime_url: https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com
build: "Final build 40808ca (deployed backend and preview): UI project a14-agent, golden run 5, MCP project a14-mcp (PO re-run with the token) and responsive project a14-responsive all re-run on it; earlier runs on 313d628, ec9a7e7 and 21e1ebf are described per case"
data_snapshot: bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i
owner: HebaGaber             # QC Lead
status: "Draft: 21 of 22 executed Playwright tests pass, 1 fails (TC-021, accepted deviation ERR-64); several passes are honest timeouts or empty answers, not full-county answers (TC-002 now passes only because the follow-up also ends in an honest timeout); awaiting PO sign-off at G7"
gate: G7
created: 2026-10-25
signed_off_date:
---

# QC Test Report: A-14 Answer roofing-lead questions through a source-backed agent and an MCP server

## Read this first: what "pass" means here

Every number below was measured on the **hosted** site, never on localhost. Two facts limit what a pass proves, and both are stated per case in the table:

1. **Small run, not the full county.** The agent and the MCP data tools answer only on the small published run `travis-202609-permits-20261021t103516z` (manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`; 14 properties, 35 reroof permits: 22 open, 13 closed, 0 stalled, per `testplans/A-14-test-cases.md` § 5). On the latest full-county run (Run 2) any call that reads property data ends in the Lambda timeout. This is the PO-approved exception `docs/decisions/DEC-A-14-agent-mcp-full-county.md` (closes like A-13; the gap moves to A-16). Cases affected are marked **full-county gap**.
2. **Many answers on the small run are "no match".** G1 to G4 (Pflugerville, Manor, Lakeway) return zero rows, so their precision, recall and groundedness checks are vacuously 100 %. They prove the agent calls the right tool with the right arguments and invents nothing. They do not prove ranking, recall or citation quality over real rows. Details: `docs/evidence/A-14-agent.md`.

The UI Playwright project cannot pin a manifest, so it runs against the **latest (full-county) run**. There, a real ask about roof age honestly ends in an error state ("Took too long"), and the UI cases `TC-001`, `TC-006` and `TC-007` are written to pass on **any honest terminal state**. Their pass means "the page showed a truthful terminal state and no invented answer", **not** "the agent answered". The answered versions of the same questions are the golden queries on the small run (section "Golden queries" below). Since the 23 s abort (T036) these asks no longer die at the 25 s Lambda limit: the agent answers HTTP 200 with outcome `timed_out` at about 23.5 s, naming the run it searched.

## Summary

| Item | Value |
| --- | --- |
| Environment | UI: `https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com` (Amplify branch preview, `/api/agent/ask` rewritten to the agent API `https://z9f9fmrmr5.execute-api.eu-north-1.amazonaws.com`) · MCP: `https://s7h96zfam0.execute-api.eu-north-1.amazonaws.com/mcp` · 2026-10-25 |
| Builds | `313d628` (UI and golden, final) · `ec9a7e7` then test fixes `0a73aec` (MCP) · `21e1ebf` (responsive) |
| Playwright tests executed | 22 (UI 9 + MCP 13); 4 UI tests not run, 3 skipped. Total tests written for A-14 in the two spec files: 29 (UI 14, MCP 15) |
| Passed / failed / blocked | 21 / 1 / 0 (the 4 not-run and 3 skipped tests are listed per case, none is counted as a pass) |
| Pass rate | 21 of 22 executed = 95 %; 21 of 29 written = 72 %. Neither figure is a full-county result |
| Responsive (smeargle pattern) | 33 of 33 pass at 390, 768, 1440 px on build `21e1ebf` (first run 10 failed, 23 passed; see `docs/evidence/A-14-smeargle.md`). These are stubbed-response states, not extra TCs |
| Golden queries G1 to G6 (API level, small run) | 6 of 6 pass on build `313d628`, with vacuous or inconclusive parts (see below) |
| Open Critical defects | 0 (ERR-61, ERR-62, ERR-63 closed; ERR-64 is Medium and open as an accepted deviation) |
| Unit test report | `docs/reports/A-14-unit-test-report.md` (written at `9715212`, 2026-10-22; the report itself is not updated). Re-run for this report: see "Unit tests" below |
| Code review log | `docs/reviews/CR-A-14.md` (0 open Critical) |
| Playwright run | Run by hand against the hosted URLs (UI by Claude, MCP by the PO with the token). CI run URL for A-14: not measured |

## Results

Result codes: **PASS**, **FAIL**, **NOT RUN** (depends on a failed case, or an opt-in extra), **SKIPPED** (not a browser case, or no data). The AC column uses the story's numbering (AC-1 to AC-12). The Playwright title is `@scenario:A-14-TC-nnn <title>`.

### UI cases (project `a14-agent`, file `tests/e2e/A-14.spec.ts`, hosted preview, latest full-county run, build `313d628`)

Run result (final build `40808ca`): 9 passed, 0 failed, 4 not run (TC-003, TC-005, TC-008, TC-009), 1 skipped (TC-011).

| TC ID | AC | Type | Playwright test (title after the tag) | Result | Reason and what the pass proves | Defect | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-14-TC-001 | AC-1 | Happy path | `G1 roof age + radius (D-10, real ask)` | PASS, honest timeout | On the latest run G1 itself ends as HTTP 200 `timed_out` after 23,485 ms (the page shows its "took too long" text and the run searched), and the test accepts any honest terminal state. It checks the page text and that no answer card is shown; it does **not** show an answered G1. **Full-county gap** (`DEC-A-14-agent-mcp-full-county`). The answered G1 is in the golden run (G1: answered, honest "no match", on the small run) | none new | `img/A-14-TC-001-ai-tab-open.png`, `img/A-14-TC-001-working.png`, `img/A-14-TC-001-terminal-state.png` |
| A-14-TC-002 | AC-2 | Happy path | `G2 follow-up "that area", open permits + contractor (D-11, real ask)` | PASS (weak), honest timeout | On the final build the follow-up also ends as HTTP 200 `timed_out` (24,222 ms), so the test's guard accepts it: **it does not show that "that area" resolves on the full county**. It failed on the earlier build `313d628`, where the agent asked which area; that behaviour is no longer reproduced only because the request now times out first. **Full-county gap.** On the small run the follow-up resolves (golden G2: second turn searched Pflugerville, `how` shows `status_class: "open"`, `open_years_min: 5`) | none (gap DEC) | `img/A-14-TC-002-working.png`, `img/A-14-TC-002-terminal-state.png` |
| A-14-TC-003 | AC-3 | Missing data | `no open roofing permits: stalled offered, honestly labelled` | NOT RUN | Skipped by its own guard: it reads the G2 answer on screen and G2 did not answer (depends on TC-002). Full-county gap | none | not run |
| A-14-TC-004 | AC-3 | Negative | `G6 out-of-scope ZIP 99999 (real ask)` | PASS | State `no_results`, HTTP 200, outcome `answered`, 2 steps, 0 matches, 3,393 ms (`docs/evidence/A-14-agent-timings.json`). The page shows zero rows and says ZIP 99999 is not in Travis County | none | `img/A-14-TC-004-working.png`, `img/A-14-TC-004-terminal-state.png`, `img/A-14-TC-004-zero-results-out-of-scope.png` |
| A-14-TC-005 | AC-4 | Happy path | `G3 open roofing permits older than 5 yrs near Manor (real ask)` | NOT RUN | Opt-in extra (`A14_EXTRA_ASKS=1`) so the file stays inside the shared Bedrock budget of 10 requests a minute. G3 ran at API level in the golden run (answered, "no match", vacuous) | none | not run |
| A-14-TC-006 | AC-4 | Happy path | `G4 Lakeway tenure 10+, owners outside the area (real ask)` | PASS, honest timeout | State `timed_out` after 23,999 ms, HTTP 200, outcome `timed_out` (final build; on `313d628` the client stop at 25 s fired with no HTTP status): the page showed its "took too long" text and no answer card. **Full-county gap.** The answered G4 (with "owner location is not in the published export") is in the golden run | none new | `img/A-14-TC-006-working.png`, `img/A-14-TC-006-terminal-state.png` |
| A-14-TC-007 | AC-4 | Happy path | `G5 BBB rating for permit 1982-012866 BP (real ask)` | PASS, honest timeout | State `timed_out` after 23,575 ms, HTTP 200, outcome `timed_out` (same reason as TC-006). **Full-county gap.** The answered G5 is in the golden run, which uses permit `2026-116568 BP` taken from the small run (the plan's `1982-012866 BP` is not in that run) | none new | `img/A-14-TC-007-working.png`, `img/A-14-TC-007-terminal-state.png` |
| A-14-TC-008 | AC-1, AC-2 | Edge | `Round Rock partly outside Travis, centre stated (real ask)` | NOT RUN | Opt-in extra (same budget reason as TC-005). Not asked at API level either: Round Rock is not one of the six golden queries | none | not run |
| A-14-TC-009 | FR-012 | Edge | `edit "How I read this" chip 5 to 3 re-runs and updates citations (real ask)` | NOT RUN | Needs an answered G2 (depends on TC-002). Full-county gap | none | not run |
| A-14-TC-010 | FR-004 | Edge | `[stubbed-response] session reaches 10 answered questions` | PASS | Stubbed: `agent.ask` is answered by `page.route()` in the browser only. Proves the client rule: only `answered` counts, at 10 the Ask control is disabled and nothing more is sent. The real server never sees these calls | none | `img/A-14-TC-010-nine-used.png`, `img/A-14-TC-010-throttled-not-counted.png`, `img/A-14-TC-010-limit-reached.png`, `img/A-14-TC-010-eleventh-blocked.png` |
| A-14-TC-011 | NFR-002 | Edge / config | `AI_PROVIDER=gateway same answers, no code change` | SKIPPED | A configuration comparison between two deployments, not a browser case. The provider switch is covered by the unit tests (`apps/api/test/agent-model.test.ts`) and the forbidden-SDK check. A hosted gateway run: not measured (the gateway needs a paid top-up, `CLAUDE.md`) | none | not run |
| A-14-TC-013 | AC-6 | Negative / NFR | `[stubbed-response] throttled, paused and timed-out outcomes, never a 5xx` | PASS | Stubbed: the three states cannot be provoked on demand. Proves the page shows its fixed text and actions for each state and no partial answer. The stubs reply HTTP 200 with the documented outcome, so this test does not observe a real 5xx. Real throttling, spend-cap and 23 s timeout paths: unit tests (`agent-ask.test.ts`, the log lines in the unit run) | none | `img/A-14-TC-013-throttled.png`, `img/A-14-TC-013-paused.png`, `img/A-14-TC-013-timed-out.png` |
| A-14-TC-027b | FR-009, NFR-004 | Security / UI | `Help MCP try-a-tool works through the proxy, no token in the browser` | PASS | The Help · MCP "Try a tool" result is live through the server-side proxy, the proxy request carries no `Authorization` header and no "bearer" in its body. The check that the real token string is absent from the request body and page HTML runs only when `MCP_TOKEN` is set in the UI run's environment; whether it was set: not measured | none | `img/A-14-TC-027B-help-mcp-open.png`, `img/A-14-TC-027B-live-result.png`, `img/A-14-TC-027B-no-token-client-side.png` |
| A-14-TC-NF-01 | AC-5 | Performance | `agent scale budget from the real asks of this file` | PASS (partial) | Over the five asks recorded in `docs/evidence/A-14-agent-timings.json` (TC-001, 002, 004, 006, 007): each ended in a known terminal state, none with HTTP 5xx, steps at most 6, matches at most 1,000. Four ended as `timed_out` at 23.5 to 24.2 s; the only answer is TC-004 (5,371 ms), so the p95 of answers is a single value, not a meaningful p95. The check now classifies an ask by the server's outcome (it flaked once when it used the displayed state). The model-call, token and wall-clock ceilings are measured in the golden run below | none | `docs/evidence/A-14-agent-timings.json` |

### MCP cases (project `a14-mcp`, file `tests/e2e/A-14-mcp.spec.ts`, hosted `/mcp`, token run by the PO)

Run history: first run on build `ec9a7e7`: 11 passed, 2 failed (TC-015, TC-021), 2 skipped. After test fixes in `0a73aec` (TC-015 reads the agent's G1 rows from the golden results; the TC-021 burst became 40 calls) the PO re-ran those two: TC-015 passed, TC-021 failed. **Final: 12 passed, 1 failed, 2 skipped.** All MCP data calls were pinned to the small run with `manifest_cid` (the full-county gap, see the DEC).

| TC ID | AC | Type | Playwright test (title after the tag) | Result | Reason and what the pass proves | Defect | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-14-TC-014 | AC-7 | Happy path | `tools/list returns exactly six tools in under 500 ms` | PASS | 6 tools (`search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema`) in 171 ms | none | `docs/evidence/mcp/A-14-TC-014-tools-list.json` |
| A-14-TC-015 | AC-8 | Happy path | `agent, search_properties and Explore agree on property_cid (AC-8)` | PASS, **vacuous** | `search_properties` G1 returned 0 rows (`empty_reason: no_match`, 791 ms) and the agent's G1 also returned 0 matches, so the two sets are equal because both are empty. The test records a `vacuous` annotation. The Explore leg is not compared by the test (by hand only). The three-way comparison over real rows needs the full county (A-16) | none | `docs/evidence/mcp/A-14-TC-015-search-properties-g1.json`, `docs/evidence/A-14-golden-results.json` (G1) |
| A-14-TC-016 | AC-9 | Happy path | `list_permits open and stalled reroofs sorted by open duration` | PASS | Austin, 25 mi, `open_or_stalled`: 22 rows, 22 returned, not truncated, 710 ms. The small run holds 0 stalled permits, so these are open ones; the descending `open_days` order was checked on the rows that carry a numeric `open_days`, and each row was checked for permit number, status class, table CID, run id and manifest CID | none | `docs/evidence/mcp/A-14-TC-016-open-or-stalled.json` |
| A-14-TC-017 | AC-9 | Missing data | `stalled permit without a status_raw carrier shows stalled alone` | SKIPPED | No stalled rows on the small run (`status_class: stalled` returns 0, `empty_reason: no_match`), so there is no row to inspect. Needs stalled data (full county, A-16) | none | `docs/evidence/mcp/A-14-TC-017-stalled.json` |
| A-14-TC-018 | AC-9 | Happy path | `get_coverage equals the manifest coverage section` | PASS | The tool's `coverage` object equals the manifest's coverage section for the pinned manifest (288 ms) | none | `docs/evidence/mcp/A-14-TC-018-get-coverage.json` |
| A-14-TC-019 | AC-10 | Scale | `row cap: at most 1000 rows, truncated and total are honest` | PASS, invariant only | Only the invariants were checked: rows at most 1,000, `truncated` equals `total > rows`. The small run has 0 stalled rows (`total: 0`, `truncated: false`), so the `truncated: true` case (2,213 county-wide stalled permits on 2026-10-19, a dated figure) is **not reproduced**. The test records a `not-reproducible` annotation. Full-county gap | none | `docs/evidence/mcp/A-14-TC-019-cap.json` |
| A-14-TC-021 | AC-10 | NFR / edge | `burst above the limit answers 429, then recovers` | **FAIL** (accepted deviation) | 40 simultaneous `get_schema` calls: 14 x 200, 1 x 429, 25 x 503. The contract says beyond 5 rps / burst 10 the answer is 429; most excess calls get a retryable 503 because the account's limit of 10 concurrent Lambda executions is hit first. No data is returned on a 503. The test stays red on purpose | ERR-64 · `docs/decisions/DEC-A-14-mcp-burst-503.md` | `docs/evidence/mcp/A-14-TC-021-burst.json` |
| A-14-TC-022 | AC-11 | Security negative | `no bearer token returns 401, nothing runs` | PASS | 401 `unauthorized` (376 ms) | none | `docs/evidence/mcp/A-14-TC-022-no-token.json` |
| A-14-TC-023 | AC-11 | Security negative | `wrong bearer token returns 401, nothing runs` | PASS | 401 `unauthorized` (280 ms) | none | `docs/evidence/mcp/A-14-TC-023-wrong-token.json` |
| A-14-TC-024 | AC-11 | Negative | `unknown permit number returns not_found, no fabricated row` | PASS | Permit `0000-000000 XX`: 0 rows, `empty_reason: not_found` (389 ms) | none | `docs/evidence/mcp/A-14-TC-024-unknown-permit.json` |
| A-14-TC-025 | AC-11 | Negative | `non-Travis ZIP 99999 returns out_of_scope` | PASS | `search_properties` area `99999`: 0 rows, `empty_reason: out_of_scope` (396 ms) | none | `docs/evidence/mcp/A-14-TC-025-zip-99999.json` |
| A-14-TC-026 | AC-11 | Security negative | `free-form SQL argument is rejected and no SQL tool exists` | PASS | A `sql` argument is rejected by input validation (`Unrecognized key: "sql"`, `isError: true`); the tool list has no SQL tool | none | `docs/evidence/mcp/A-14-TC-026-sql-argument.json` |
| A-14-TC-027 | FR-009, NFR-004 | Security | `disallowed browser Origin is rejected` | PASS | A request with a browser `Origin` gets 403 `origin_not_allowed` (509 ms). Its UI half is TC-027b above | none | `docs/evidence/mcp/A-14-TC-027-disallowed-origin.json` |
| A-14-TC-028 | FR-009, NFR-004 | Ops (manual) | none (CloudWatch log check on a disposable stack) | NOT RUN | A manual ops case that needs a staging stack where the SSM token parameter can be removed. It was not performed against the production endpoint and no staging stack exists. Unit test `apps/api/test/mcp-auth.test.ts` covers the fail-fast code path; hosted check: not measured | none | not run |
| A-14-TC-029 | AC-12 | Agent | `donphan answers a Lakeway ownership question through MCP only` | PASS (run by hand, not a Playwright test) | A kit-agent case: `soofi-xyz-team-kit:donphan` answered through the registered `countylens` MCP server alone, on the pinned small run. The answer is honest (0 rows, no property_cid invented, scope, limit and gaps stated) and is **empty**, so it proves the path, not an owner answer. Transcript word for word in `docs/evidence/A-14-mcp.md` | `docs/evidence/A-14-mcp.md` | done |
| A-14-TC-NF-02 | AC-10, NFR-003 | Performance | `tools/call p95 under 3 s over 20 calls` | PASS | 20 calls (alternating `get_schema` and `search_properties`), all 200: p50 313 ms, p95 415 ms, max 417 ms against a 3,000 ms limit. The "sustains 5 rps burst 10" half is TC-021 (fails) | none | `docs/evidence/mcp/A-14-TC-NF-02-timings.json` |

TC-012 and TC-020 are folded into TC-008 and TC-029 in the test plan and have no test of their own.

## Golden queries G1 to G6 (API level, build `313d628`, pinned small run)

The golden file is `tests/agent/golden.json` (word for word from `checks.md` § 7.1). The run is `tests/agent/golden.test.ts` against `POST .../api/agent/ask`, sequential, with `manifest_cid` pinned. These are the answered versions of the UI cases TC-001, 002, 004, 005, 006 and 007. Full detail, verbatim answers and the three-run history are in `docs/evidence/A-14-agent.md`; raw data in `docs/evidence/A-14-golden-results.json`.

| Golden (run 5, final build `40808ca`) | UI TC | Outcome | Wall clock | Model calls | Output tokens | Rows (oracle) | Vacuous or inconclusive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | TC-001 | answered | 8,712 ms | 2 | 381 | 0 | vacuous (0 rows) |
| G2 | TC-002 | answered | 7,287 ms | 2 | 601 | 0 | vacuous; passes partly through a deterministic server-side sentence (ERR-61..63 follow-ups) |
| G3 | TC-005 | answered | 4,975 ms | 2 | 315 | 0 | vacuous (0 rows) |
| G4 | TC-006 | answered | 6,441 ms | 2 | 452 | 0 | vacuous; empty-reason check inconclusive; passes partly through a deterministic sentence |
| G5 | TC-007 | answered | 4,549 ms | 2 | 254 | 1 | not vacuous (1 permit, 2 CIDs checked, both grounded); passes partly through a deterministic sentence |
| G6 | TC-004 | answered | 3,133 ms | 2 | 136 | not applicable | empty-reason check inconclusive; out-of-scope check passed |

Budget ceilings (AC-5), all met on this run: at most 3 model calls (observed 2), at most 1,500 output tokens (observed at most 514), wall clock under 20 s (observed at most 8,043 ms), tool steps at most 6 (observed 2). These hold on the small run only.

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-14-TC-NF-01 | Performance / budget (AC-5) | Playwright timings + golden run | PASS on the small run; not measurable on the full county | UI asks on the latest run: 5,371 ms (one answer), four honest timeouts at 23.5 to 24.2 s. Golden run 5: wall clock 3,133 to 8,712 ms, 2 model calls each, 136 to 601 output tokens | p95 under 20 s, at most 6 tool steps, at most 3 model calls, at most 1,500 output tokens, at most 1,000 rows per tool call |
| A-14-TC-NF-02 | Performance (AC-10) | Playwright request fixture | PASS | p50 313 ms, p95 415 ms, max 417 ms over 20 calls | p95 under 3 s |
| A-14-TC-021 | Rate limit (AC-10, NFR-003) | Playwright request fixture | FAIL (accepted) | 40 calls: 14 x 200, 1 x 429, 25 x 503 | excess calls answer 429, no 5xx |
| Responsive | NFR (design system) | Playwright, smeargle pattern, Atlas token audit | PASS | 33 of 33 (11 states x 390, 768, 1440 px) on build `21e1ebf` | no horizontal scroll, 16 px gutter at 390 px, targets 48 px, Atlas tokens only |

Not measured: the 99th percentile or any load test; the MCP burst at the WAF level; a full-county agent run (times out, see the DEC).

## Unit tests

The report `docs/reports/A-14-unit-test-report.md` was written at commit `9715212` on 2026-10-22 and is cited unchanged. For this report the root suite was re-run on the story worktree (HEAD `836d2cc`, 2026-10-25, `pnpm test` with `CDK_DEFAULT_REGION=eu-north-1 AWS_REGION=eu-north-1 OPERATOR_EMAIL=ops@example.com`): **139 test files passed, 1 skipped; 1,947 tests passed, 9 skipped, 0 failed** (57 s). This is the whole monorepo at that commit, not only A-14, and it was run locally, not in CI.

## Defects

| ERR | TC | Severity | Status | Fix commit |
| --- | --- | --- | --- | --- |
| ERR-61 | G2 (golden), TC-002 | High | Closed and re-tested on the hosted golden run | `c741363`, `830c4c5`, `313d628` |
| ERR-62 | G4 (golden), TC-006 | High | Closed and re-tested on the hosted golden run | `c741363`, `830c4c5`, `313d628` |
| ERR-63 | G5, G2, budget check (golden) | Medium | Closed and re-tested on the hosted golden run | `c741363`, `830c4c5`, `313d628` |
| ERR-64 | A-14-TC-021 | Medium | Open, accepted deviation (PO, 2026-10-25, `docs/decisions/DEC-A-14-mcp-burst-503.md`) | none; closes in A-16 |
| (no ERR number) | MCP data tools, TC-014 onward | High | Fixed: a shared MCP server answered 500 on every call after the first; one server and transport per request | `ec9a7e7` |
| (no ERR number) | agent and MCP on Run 1 and Run 2 | High | Not fixed in A-14: Lambda timeout on any property read at full-county scale. PO exception `docs/decisions/DEC-A-14-agent-mcp-full-county.md`; closes in A-16 | n/a |

The six deploy-time fixes found by the first hosted calls are listed in `docs/evidence/A-14.md`.

## Gaps carried to A-16

- Full-county agent and MCP data calls (per-run Explore index). When it exists, re-run G1 to G6, the AC-8 three-way comparison, TC-017 and TC-019 (`truncated: true`), and turn the cases marked **full-county gap** green.
- TC-021: 503 versus 429 under burst (WAF rate rule, a Lambda concurrency quota raise, or a contract amendment).
- TC-028 ops check (not run), TC-011 hosted gateway comparison (not measured). TC-029 (donphan) was run by hand and passed; it is not one of the Playwright counts above.

## Sign-off

**Decision:** ☐ Validated (counts toward G7) ☐ Returned, reason: {…} · {date}

Open items before the PO can sign: CI run URL and status. The token-leak counts are in (all 0, `docs/evidence/A-14.md`).
