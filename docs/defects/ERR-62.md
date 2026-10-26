---
id: ERR-62
type: defect
feature: FEAT-A14
story: A-14
test_case: G4 (golden)
ac_reference: A-14 honesty rule: "unknown is never none found"; missing data says why
severity: High
status: Closed
found_by: golden run (tests/agent/golden.test.ts) on the deployed agent
found_date: 2026-10-25
fix_branch: 014-agent-and-mcp
fix_commit: c741363, 830c4c5, 313d628 (014-agent-and-mcp)
retest_date: 2026-10-25
---

# ERR-62: Agent – out-of-area-owner question silently widens the radius and claims good coverage

## Brief description

On G4 ("Which homes near Lakeway haven't changed owners in 10+ years and have owners outside the area?") the agent re-ran the search at 10 miles instead of the 5-mile assumption, then told the user "the dataset had good coverage" because 0 rows were unknown-excluded. The answer never says that the owner-location comparison (`owner_is_out_of_area`) depends on a field that is not in the published export, and `missing[]` does not list it. In this run the real reason for the empty result is that the run holds no property near Lakeway at all.

## Related requirement

- **Story:** A-14 · **AC:** A-14 honesty rule: "unknown is never none found"; missing data says why · **Test case:** G4 (golden) (golden query, checks.md § 7.1)

## Environment

| Item | Value |
| --- | --- |
| URL | https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api/agent/ask (POST) |
| Build | branch 014-agent-and-mcp, HEAD a74fd89 (deployed preview) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` (small run, pinned via `manifest_cid`) |
| Browser / OS / device | Vitest (Node fetch) · macOS |
| Role | anonymous |

## Preconditions and test data

- Run pinned to the manifest above (small permits run; no property near Lakeway).

## Steps to reproduce

1. POST the G4 prompt with `manifest_cid` above.
2. Read `answer`, `steps`, `query`, `missing`.

## Expected result

Radius 5 mi stated as an assumption (golden `radius_mi_assumption`); `missing[]` contains `owner_is_out_of_area` with reason `not_in_export`/`field_not_published`; the answer says it cannot tell who lives outside the area from the published data, using the words "outside the area" and "not in the published export". No claim of coverage that the tool did not report.

## Actual result

Two `searchProperties` calls (radius 5, then 10); `query.radius_mi` = 10 while the user never asked for it. `missing` = `[{field: result, reason: no_match}]`. Answer says "0 properties were excluded due to unknown tenure or unknown owner location - meaning the dataset had good coverage, and this combination genuinely yielded no matches in that area" and suggests the filters could be relaxed. Grader: missingMentions = ["outside the area", "not_in_export|not in the published export"], missingFlags = ["owner_is_out_of_area"], empty_reason mismatch (oracle `no_match`, golden `field_not_published`).

## Impact and severity

- **Impact:** a user is told "genuinely no matches / good coverage" when the data cannot answer the question; this is the "unknown is not none found" rule.
- **Severity:** High because it states an unsupported fact about data coverage on a demo line. (Part of the mismatch is the golden expectation `field_not_published` versus an empty small run, where the tool returns `no_match` first; the unsupported "good coverage" claim and the silent radius change are product behaviour either way.)

## Suggested investigation area

System prompt in `apps/api/src/agent/ask.ts` `buildSystemPrompt` (nothing forbids widening the radius or asserting coverage); the tool envelope's `unknown_excluded` is read as proof of coverage. Consider surfacing `owner_is_out_of_area` availability in `missing[]` from the tool, and a rule that the agent must not change a user-stated or default radius without saying so in `how`.

## Evidence

- [x] `docs/evidence/A-14-agent.md` and `docs/evidence/A-14-golden-results.json` (verbatim response)
- [x] Vitest log: `AGENT_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api GOLDEN_CID_HOST=https://gateway.pinata.cloud npx vitest run` in `tests/agent`

## Resolution

| Field | Value |
| --- | --- |
| Root cause | The model dropped the out-of-area-owner filter, widened the radius, and claimed good coverage; the owner mailing location is not in the published export, which nothing said. |
| Fix | c741363 and 830c4c5 (filter changes disclosed; `owner_is_out_of_area` flagged in `missing[]` with a fixed sentence when the question asks about owners outside the area) on `014-agent-and-mcp` |
| Re-test | G4 passes on the hosted agent, build `313d628`, 2026-10-25 (the empty_reason part is recorded as inconclusive on the small run) |
| Status | ☐ Closed ☐ Reopened, reason: |
