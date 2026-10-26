---
id: ERR-63
type: defect
feature: FEAT-A14
story: A-14
test_case: G5, G2, budget check (golden)
ac_reference: A-14 AC-5 (budgets observable), contract missing[] field names
severity: Medium
status: Closed
found_by: golden run (tests/agent/golden.test.ts) on the deployed agent
found_date: 2026-10-25
fix_branch: 014-agent-and-mcp
fix_commit: c741363, 830c4c5, 313d628 (014-agent-and-mcp)
retest_date: 2026-10-25
---

# ERR-63: Agent – missing[] field names and answer wording differ from the contract; budget figures not exposed

## Brief description

(a) On G5 the permit exists and its BBB rating is genuinely unavailable, but `missing[]` names `bbb_rating`/`contractor_name_raw` where the contract and golden use `bbb_status` and `contractor.name_as_printed`, and the answer says "a BBB rating isn't available" / "Not checked", not the contract's "not available"; (b) the response carries no `modelCalls`, `outputTokens`, `durationMs` or trace id, so the 3-call and 1,500-token ceilings (AC-5) cannot be checked from the hosted endpoint, only the tool-step count.

## Related requirement

- **Story:** A-14 · **AC:** A-14 AC-5 (budgets observable), contract missing[] field names · **Test case:** G5, G2, budget check (golden) (golden query, checks.md § 7.1)

## Environment

| Item | Value |
| --- | --- |
| URL | https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api/agent/ask (POST) |
| Build | branch 014-agent-and-mcp, HEAD a74fd89 (deployed preview) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` (small run, pinned via `manifest_cid`) |
| Browser / OS / device | Vitest (Node fetch) · macOS |
| Role | anonymous |

## Preconditions and test data

- G5 permit number resolved from the bound run: `2026-116568 BP` (first permit of the run).

## Steps to reproduce

1. POST `"What's the BBB rating of the contractor on permit 2026-116568 BP?"` with `manifest_cid` above.
2. Compare `missing[]` and `answer` with the golden: `must_flag_missing: ["bbb_status"]`, `must_mention: "BBB.*not available|rating.*not available|missing"`.
3. Inspect the response keys.

## Expected result

`missing[]` includes `bbb_status` (the Match carries `bbb_status` and `bbb_status_reason`) and the answer states that BBB status is not available; the response (or a header) exposes model calls, output tokens and duration, as `AgentAskResponse` in `tests/agent/grader.ts` and checks.md § 7.2 budget expect.

## Actual result

`missing` = status_raw, expiry_date, final_date, permit_close_date, final_inspection_date, contractor_company_cid, contractor_name_raw, bbb_rating, bbb_url, description, work_class_raw; no `bbb_status`. Answer: "a BBB rating isn't available for it ... BBB status: Not checked, specifically because the contractor is unresolved [1]". Response keys: answer, how, steps, matches, query, missing, outcome. G5 correctness/recall/groundedness pass (2 CIDs exist in the run); honesty fails on the regex and the missing flag.

## Impact and severity

- **Impact:** the answer is substantively honest (BBB unavailable, with the reason) but the structured `missing[]` does not carry the contract name, and the budget ceilings are unverifiable.
- **Severity:** Medium because the user-facing content is correct; the contract/observability gap affects the grader and AC-5 evidence, not the user.

## Suggested investigation area

`apps/api/src/agent/ask.ts` `composeStructuredParts` (missing[] built from `match.missing`; add `bbb_status` from the Match's `bbb_status`/`bbb_status_reason`), the response type, and `defaultRunModelLoop` result (add `modelCalls`, `outputTokens`, `durationMs`; log trace id). Alternatively correct the golden/contract field names if `bbb_rating` is the intended name (decision for the PO).

## Evidence

- [x] `docs/evidence/A-14-agent.md` and `docs/evidence/A-14-golden-results.json` (verbatim response)
- [x] Vitest log: `AGENT_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api GOLDEN_CID_HOST=https://gateway.pinata.cloud npx vitest run` in `tests/agent`

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `missing[]` used internal field names and the response carried no budget figures. |
| Fix | c741363 and 830c4c5 (contract names `bbb_status`, `contractor.name_as_printed`; `modelCalls`, `outputTokens`, `durationMs`, `traceId` added as optional fields) on `014-agent-and-mcp` |
| Re-test | G5 and the budget check pass on the hosted agent, build `313d628`, 2026-10-25 |
| Status | ☐ Closed ☐ Reopened, reason: |
