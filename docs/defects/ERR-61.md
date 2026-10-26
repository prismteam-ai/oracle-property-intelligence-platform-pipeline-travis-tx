---
id: ERR-61
type: defect
feature: FEAT-A14
story: A-14
test_case: G2 (golden)
ac_reference: A-14 AC-5 (budget), contract "never a partial answer returned as answered"
severity: High
status: Closed
found_by: golden run (tests/agent/golden.test.ts) on the deployed agent
found_date: 2026-10-25
fix_branch: 014-agent-and-mcp
fix_commit: c741363, 830c4c5, 313d628 (014-agent-and-mcp)
retest_date: 2026-10-25
---

# ERR-61: Agent – follow-up question returns an unfinished sentence as the answer with outcome "answered"

## Brief description

On G2 (turn 2: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?") the model used its whole tool budget on three `searchRoofingPermits` calls with progressively weaker filters (`open_years_min` 3, 1, then none) and its last text was a plan for a fourth call. That text was returned verbatim as `answer` with `outcome: "answered"`. The user gets no result, no disclosure of the weakened filters, no contractor or BBB statement.

## Related requirement

- **Story:** A-14 · **AC:** A-14 AC-5 (budget), contract "never a partial answer returned as answered" · **Test case:** G2 (golden) (golden query, checks.md § 7.1)

## Environment

| Item | Value |
| --- | --- |
| URL | https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api/agent/ask (POST) |
| Build | branch 014-agent-and-mcp, HEAD a74fd89 (deployed preview) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` (small run, pinned via `manifest_cid`) |
| Browser / OS / device | Vitest (Node fetch) · macOS |
| Role | anonymous |

## Preconditions and test data

- Turn 1 of G2 is the G1 question; turn 2 is sent with `turns: [{prompt: <G1>, outcome: "answered"}]`.
- Run pinned to the manifest above; the run has no open or stalled permit near Pflugerville.

## Steps to reproduce

1. POST the G1 prompt with `manifest_cid` above; note outcome `answered`.
2. POST the G2 prompt with `turns` = `[{"prompt":"Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?","outcome":"answered"}]` and the same `manifest_cid`.
3. Read `answer` and `steps`.

## Expected result

A complete answer: either the matches, or an honest empty-result sentence ("no open or stalled roofing permits within 5 miles of Pflugerville in this run"), stating which filters were applied (the `how` shows the final loosened ones), that the contractor name is not printed in the source (`contractor.name_as_printed`) and that BBB status is not available; or `outcome` other than `answered` if the loop cannot finish. The G2 golden expects the application of `status_class: open` with `open_years_min: 5`.

## Actual result

`answer` = "Let me also try without the open_years_min filter to see all open/stalled permits near Pflugerville." (verbatim, entire answer). `steps` = 3 `searchRoofingPermits` calls: `status_class: "open_or_stalled"` with `open_years_min` 3, 1, then omitted. `how` reports `open_years_min: 1`, i.e. not even the last call that ran. `missing` = `[{field: result, reason: no_match}]`. `matches` = []. The agent also changed the requested `open` to `open_or_stalled` and the threshold 5 to 3 without telling the user.

## Impact and severity

- **Impact:** demo line for the follow-up ("that area" + open permits + contractor) shows a dangling sentence; a user cannot tell no permits exist.
- **Severity:** High because it is a user-visible wrong shape on a demo line and violates the contract rule that a partial answer is never `answered`.

## Suggested investigation area

`apps/api/src/agent/ask.ts` `defaultRunModelLoop` / `maxSteps: Math.min(maxModelCalls, maxToolSteps)` = 3: the AI SDK stops after 3 steps even when the last step is a tool call plus text. Check for the finish reason; reserve the final step for a text-only answer (e.g. `toolChoice: none` on the last step) or return a deterministic server-built empty-result sentence from the tool envelope. Also `how` is taken from the first/other envelope than the last call.

## Evidence

- [x] `docs/evidence/A-14-agent.md` and `docs/evidence/A-14-golden-results.json` (verbatim response)
- [x] Vitest log: `AGENT_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api GOLDEN_CID_HOST=https://gateway.pinata.cloud npx vitest run` in `tests/agent`

## Resolution

| Field | Value |
| --- | --- |
| Root cause | The model loop spent its whole tool budget loosening filters and its last text was a plan for another call; ask.ts returned that text as the answer with outcome `answered`. |
| Fix | c741363 (last step forced text-only; an incomplete loop returns `failed` with what was tried; filter changes are stated) on `014-agent-and-mcp` |
| Re-test | G2 passes on the hosted agent, build `313d628`, 2026-10-25 (`docs/evidence/A-14-agent.md`) |
| Status | ☐ Closed ☐ Reopened, reason: |
