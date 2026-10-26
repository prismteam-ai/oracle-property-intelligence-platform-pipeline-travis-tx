---
id: DEC-A-14-mcp-burst-503
type: decision
story: A-14
title: "Accept that a burst above 5 rps on /mcp mostly answers 503, not 429, and document it (PO deviation from AC-10 / TC-021)"
status: Approved by the PO (HebaGaber) on 2026-10-25 ("yes document it")
created: 2026-10-25
---

# MCP burst answers 503 (A-14 deviation)

## Decision

The deviation recorded in `docs/defects/ERR-64.md` is accepted and documented, not fixed in A-14. The `/mcp` route keeps its configured throttle (5 requests per second, burst 10, read back from the deployed stage). Above it, API Gateway's best-effort throttle lets most requests through and the account's limit of 10 concurrent Lambda executions rejects the rest, which API Gateway reports as `503` (retryable, no data returned). The contract wording "beyond it, 429" holds only in part: some requests get `429`, most get `503`.

## Measurements (hosted, 2026-10-25, build `ec9a7e7`)

| Run | 200 | 429 | 503 |
| --- | --- | --- | --- |
| 15 simultaneous `get_schema` calls | 13 | 0 | 2 |
| 40 simultaneous `get_schema` calls | 14 | 1 | 25 |
| 40 simultaneous `get_schema` calls, rerun on build `40808ca` | 23 | 3 | 14 |

Evidence: `docs/evidence/mcp/A-14-TC-021-burst.json`. Stage settings: `POST /mcp` rate 5, burst 10.

## What stays true

- No request is served beyond capacity, no data is returned on a `503`, and nothing is billed beyond the Lambda that ran.
- The bearer-token (`401`), origin (`403`) and the other contract checks are unaffected.
- A single well-behaved client under 5 requests per second never sees `429` or `503` (functional tests and the 20-call p95 test pass).

## Test status

`A-14-TC-021` stays red on purpose; it is the proof of the deviation and should turn green when it is closed.

## How to close it (carried to A-16 with the other cost and capacity items)

Choose one: a WAF rate-based rule on the MCP API (answers `429` itself, adds a small monthly cost); a request to raise the account's Lambda concurrency quota (the agent, MCP and query API share the current 10); or amend the contract to name `503` as the over-limit answer. Any of them needs one more CDK deploy and the PO's go.

## What the evaluator will see

The MCP server answers `401` without a token, `200` with one, and under a deliberate burst some `429` and many retryable `503`. The test report lists TC-021 as failed with this record as the reason.
