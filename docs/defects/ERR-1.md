---
id: ERR-1
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-005, A-01-TC-006, A-01-TC-014
ac_reference: A-01-AC-2, A-01-AC-4
severity: Medium
status: Closed
found_by: Claude (QC run, before execution)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 9c7579a
retest_date: 2026-10-20
---

# ERR-1: Acceptance steps – live recount requests sent without the project's identified User-Agent

## Brief description

The approved test plan (`testplans/A-01-test-cases.md` v0.6) and its automation (`pipeline/oracle-runtime/test/acceptance/a01.steps.ts`) recount Austin permits and Comptroller rows with plain `curl`, which sends curl's default User-Agent (`curl/8.x`). NFR-001 requires every request to a source to carry the project's identified User-Agent. The pipeline's own client does this; the test steps did not. Found by reading the steps before the run, so no unidentified request was sent.

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-2, A-01-AC-4 · **Requirement:** NFR-001 (identified user agent) · **Test cases:** A-01-TC-005 (Comptroller recount), A-01-TC-006 (Austin counts), A-01-TC-014 (Austin-issued recount)

## Environment

| Item | Value |
| --- | --- |
| URL | N/A: Project story, no hosted runtime until A-03 |
| Build | `a96d669` (branch `001-discover-sources`) |
| Data snapshot | catalog `pipeline/docs/travis-sources.yaml`; no manifest CID in A-01 |
| Browser / OS / device | terminal, macOS (darwin-arm64), bash, curl 8.7.1 |
| Role | operator |

## Preconditions and test data

- Sources: Austin Socrata `3syk-w9eu` (data.austintexas.gov) and Texas Comptroller `9cir-efmm` (data.texas.gov). Both are reachable open-data APIs, not blocked sources.

## Steps to reproduce

1. Read `pipeline/oracle-runtime/test/acceptance/a01.steps.ts`: `SOCRATA_COUNT`, the TC-005 step 4 and the TC-014 step 3 commands.
2. Note that each is `curl -s…` with no `-A`.
3. Running them would send `User-Agent: curl/8.7.1`.

## Expected result

Every source request sends `User-Agent: oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; +https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)` (NFR-001, the same constant as `travis/lib/source-client.ts` `USER_AGENT`).

## Actual result

The steps would send curl's default User-Agent.

## Impact and severity

- **Impact:** about six unidentified requests to two open-data APIs per QC run; source etiquette (NFR-001) not met by the tests themselves.
- **Severity:** Medium, because it breaks an etiquette rule without contacting any blocked source, and does not change any test verdict.

## Suggested investigation area

The § 6 shell setup in the test plan and `SETUP` in `a01.steps.ts`.

## Evidence

- [x] Code read before execution; the fix diff below.
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | The test plan's commands were written as plain `curl`; the automation copied the plan verbatim. |
| Fix | `a01.steps.ts`: the shell setup defines `curl() { command curl -A "$ORACLE_UA" "$@"; }`, and `sh()` passes `ORACLE_UA` from `USER_AGENT` in `travis/lib/source-client.ts`. The test plan's § 6 setup should carry the same line (QC-owned plan; noted in the test report). |
| Re-test | A-01-TC-005, TC-006 and TC-014 run with the fix (see `docs/reports/A-01-test-report.md`) |
| Status | ☒ Closed ☐ Reopened |
