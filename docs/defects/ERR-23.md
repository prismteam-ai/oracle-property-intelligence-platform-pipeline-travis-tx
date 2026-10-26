---
id: ERR-23
type: defect
feature: FEAT-A04
story: A-04
test_case: A-04-TC-004
ac_reference: A-04-AC-1
severity: Medium
status: Closed
found_by: QC test runner (Claude), for HebaGaber
found_date: 2026-10-22
fix_branch: 004-property-backbone
fix_commit: be805f8, 79e21d0
retest_date: 2026-10-22
closed_date: 2026-10-22
---

# ERR-23: backbone CLI – `ingest --join-proof` gives up after about 5 minutes ("fetch failed") and never prints the `join_proof=` line

## Brief description

`ingest --join-proof` reads the 30 GB export and needs about 10 minutes. The CLI makes one long HTTP call to Restate and the client side times out at about 5 minutes, so the CLI prints `backbone: ingest failed: fetch failed` and exits non-zero, although the workflow keeps running and completes with `pass: true`. The case's expected last line (`join_proof=pass matched=<n> disagreements=0`) is never printed; the result can only be read from the Restate journal. The run-log already notes the same symptom for `write-group` ("poll instead of one long HTTP call").

## Related requirement

- **Story:** A-04 · **AC:** A-04-AC-1 · **Requirement:** FR-001, P0-5 · **Test case:** A-04-TC-004 (step 3)

## Environment

| Item          | Value                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| URL           | not applicable (pipeline-only story; local terminal, Restate on :8080/:9080) |
| Build         | branch `004-property-backbone`, 2026-10-22                                  |
| Data snapshot | job `travis-a04-20261022052658`, TCAD export SHA-256 `6f7a7585...2346`      |
| Role          | n/a                                                                         |

## Preconditions and test data

- Full-county job complete; local stack up; machine memory-constrained (join proof took 9 min 39 s).

## Steps to reproduce

1. `git rev-parse --abbrev-ref HEAD` -> `004-property-backbone`.
2. `npm --prefix pipeline/oracle-runtime run backbone -- ingest --join-proof --job travis-a04-20261022052658 --seed 2026`
3. After the CLI exits, `restate sql "SELECT status, completion_result FROM sys_invocation WHERE target_service_key = 'travis-a04-20261022052658' AND target_handler_name = 'joinProof'"`.

## Expected result

Last line `join_proof=pass matched=<m> disagreements=0`, exit 0 (plan TC-004 step 3).

## Actual result

- CLI stderr: `backbone: ingest failed: fetch failed` after about 5 minutes, exit 1, no `join_proof=` line.
- Restate: invocation `inv_1eeWoWwOOvDp0v41Yud8lfe5M4KZHXor7j` (`TcadBackbone/travis-a04-20261022052658/joinProof`) `completed with success` at 12:17:12Z (running time 9 min 39 s). Output from its journal: `{"seed":2026,"sampled":1000,"matched":906,"no_tcad_geoid":93,"ambiguous_geoid":1,"disagreements":0,"reverse_checked":1000,"reverse_disagreements":0,"pass":true}`.

## Impact and severity

- **Impact:** the product result is correct (pass, 0 disagreements both ways) but the operator sees a failure and no result line; any script that relies on the exit code or the last line fails. Same cause affects `write-group` and any other long handler.
- **Severity:** Medium: the work succeeds, the report to the operator is wrong.

## Suggested investigation area

`pipeline/oracle-runtime/travis/backbone/restate-client.ts`: send the workflow with the async `/send` form (or an idempotency key) and poll `attach`/status with the existing `timeoutMs` loop instead of one awaited fetch; print the `join_proof=` line from the polled output.

## Evidence

- [ ] Screenshot: not applicable
- [x] Command output above (2026-10-22), Restate journal of the invocation

## Resolution

| Field      | Value                                       |
| ---------- | ------------------------------------------- |
| Root cause | The CLI made one awaited HTTP call to Restate for a workflow that runs about 10 minutes; the client side gave up at about 5 minutes ("fetch failed") while the server kept running |
| Fix        | Commit `be805f8`: `callLong` sends the workflow with the async `/send` form and an idempotency key and polls for the result (used by `--join-proof` and `write-group`); `report --json` now prints `job_id` on stderr. First version polled the wrong path; commit `79e21d0` ("callLong polls /restate/invocation/<svc>/<key>/<handler>/<idem>/output", verified live) corrects it |
| Re-test    | A-04-TC-004, 2026-10-22: live CLI join proof on the rebuilt tables, seed 2026, job `travis-a04-20261022052658`, 12:34:48-12:50:44Z: `join_proof=pass matched=906 disagreements=0 no_tcad_geoid=93 ambiguous_geoid=1 reverse_checked=1000 reverse_disagreements=0` |
| Status     | Closed (2026-10-22) after the passing re-test |
