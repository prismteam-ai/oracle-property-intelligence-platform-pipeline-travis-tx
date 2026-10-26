---
id: ERR-64
type: defect
feature: FEAT-A14
story: A-14
test_case: A-14-TC-021
ac_reference: A-14-AC-10
severity: Medium
status: Open (accepted deviation, PO 2026-10-25; see docs/decisions/DEC-A-14-mcp-burst-503.md)
found_by: HebaGaber (hosted MCP run, test written by Claude)
found_date: 2026-10-25
fix_branch: 014-agent-and-mcp
fix_commit:
retest_date:
---

# ERR-64: MCP server – a burst above 5 rps mostly answers 503, not 429

## Brief description

The contract (`specs/014-agent-and-mcp/contracts/mcp-tools.md`, line 15) says the `/mcp` route allows 5 requests per second with a burst of 10 and answers `429` beyond that. The route throttle is configured exactly so (verified on the deployed stage), but API Gateway's throttle is best-effort and let most of a 40-call burst through. The excess then ran into the account's limit of 10 concurrent Lambda executions, and API Gateway reports that as `503`. The client sees `503`, not the documented `429`.

## Related requirement

- **Story:** A-14 · **AC:** A-14-AC-10 · **Requirement:** NFR-003 (route-level throttle) · **Test case:** A-14-TC-021

## Environment

| Item | Value |
| --- | --- |
| URL | `https://s7h96zfam0.execute-api.eu-north-1.amazonaws.com/mcp` (POST) |
| Build | branch `014-agent-and-mcp`, commit `ec9a7e7` deployed |
| Data snapshot | not data-dependent (`get_schema`, no manifest read) |
| Browser / OS / device | Playwright request fixture · macOS |
| Role | anonymous client holding the MCP bearer token |

## Preconditions and test data

- MCP token set in the shell environment only.
- Account Lambda concurrency limit: 10 in total, shared with every other Lambda in the account (`aws lambda get-account-settings`).

## Steps to reproduce

1. `cd tests/e2e` and run `pnpm exec playwright test --project=a14-mcp --workers=1 -g A-14-TC-021` with `MCP_URL`, `RUNTIME_URL` and `MCP_TOKEN` exported.
2. The test sends 40 `tools/call get_schema` requests at once, then one more after 2 s.

## Expected result

Calls beyond the bucket (10 burst, then 5 per second) are answered `429` by API Gateway; at least 5 of the 40 are `429`; none is a 5xx; the call after 2 s answers `200`.

## Actual result

Statuses of the 40 calls: 14 × `200`, 25 × `503`, 1 × `429` (file `docs/evidence/mcp/A-14-TC-021-burst.json`, latency 309 to 1,456 ms). An earlier run with 15 calls gave 13 × `200` and 2 × `503`. The stage's route settings are `POST /mcp: rate 5, burst 10` (read back with `GetStage`).

Second measurement (build `40808ca`, same test, PO run): 23 x `200`, 3 x `429`, 14 x `503`. The 503 share varies between runs because API Gateway's throttle is approximate; it never answered with a clean `429` for the whole excess.

## Impact and severity

- **Impact:** a client that bursts gets a retryable `503` instead of `429`; no data is returned and no cost is incurred beyond the Lambda that did run. The documented error shape is not honoured under burst, and one over-limit client can use up the account's whole Lambda concurrency for about a second, which the agent and the query API share.
- **Severity:** Medium. The server stays safe and the throttle exists; the failure is the status code and the shared capacity.

## Suggested investigation area

Reserved concurrency for the MCP Lambda is not possible while the account total is 10 (AD-11 in the architecture constitution allows reserved concurrency only if the account permits it). Options: raise the account concurrency quota (an AWS support request); or add a second, cheaper guard in front (for example a WAF rate-based rule on the API, which answers `429` itself); or accept `503` as the documented over-limit behaviour and change the contract. The choice is the PO's.

## Evidence

- [ ] Screenshot `docs/evidence/img/ERR-64.png` (not applicable: API response)
- [x] Test output and saved body `docs/evidence/mcp/A-14-TC-021-burst.json`
- [ ] CloudWatch query or X-Ray trace id

## Resolution

| Field | Value |
| --- | --- |
| Root cause | API Gateway HTTP API throttling is approximate; with an account concurrency of 10, the Lambda's own throttling (reported as 503) takes over before the gateway rejects. |
| Fix | open |
| Re-test | open |
| Status | Accepted deviation, not fixed: PO decision "yes document it", 2026-10-25, record `docs/decisions/DEC-A-14-mcp-burst-503.md`. TC-021 stays red on purpose. |
