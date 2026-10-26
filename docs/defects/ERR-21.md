---
id: ERR-21
type: defect
feature: FEAT-A06
story: A-04
test_case: A-04-TC-NF-03
ac_reference: A-04-AC-7
severity: Low
status: Closed
found_by: QC test runner (Claude), for HebaGaber
found_date: 2026-10-22
fix_branch: 004-property-backbone
fix_commit:
retest_date: 2026-10-22
closed_date: 2026-10-22
---

# ERR-21: Test plan TC-NF-03 – expected output does not match the artifact and the code (steps 2 and 3)

## Brief description

Running the exact commands of A-04-TC-NF-03 gives two outputs that differ from the plan's expected result, although the behaviour the case protects (no GIS request leaves the laptop) holds. Step 2 prints two lines instead of exactly `loc=US`, and step 3 counts one file that is neither the runner fetch nor the A-01 discovery probe.

## Related requirement

- **Story:** A-04 · **AC:** AC-7 · **Requirement:** FR-007, ARD § 8 · **Test case:** A-04-TC-NF-03

## Environment

| Item          | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| URL           | not applicable (pipeline-only story; local terminal)                                 |
| Build         | `40fa2e2`, branch `004-property-backbone`                                            |
| Data snapshot | GIS runner artifact `pipeline/data/raw/gis/us-runner-39684063596/` (run 39684063596) |
| Role          | n/a                                                                                  |

## Preconditions and test data

- Repo root, branch `004-property-backbone`, no Docker or network needed.
- Runner artifacts present under `pipeline/data/raw/gis/us-runner-*`.

## Steps to reproduce

1. `git rev-parse --abbrev-ref HEAD` -> `004-property-backbone`.
2. `grep -r -l "gis.traviscountytx.gov" pipeline/data/artifacts pipeline/data/runs 2>/dev/null | wc -l`
3. `cat pipeline/data/raw/gis/us-runner-*/egress.txt | sort -u`
4. `grep -r -l "gis.traviscountytx.gov" pipeline/oracle-runtime/travis --include='*.ts' | grep -v -E "travis/(gis/runner-fetch|discovery/probes/arcgis)\.ts$" | wc -l`

## Expected result

Step 2 prints `0`; step 3 prints exactly `loc=US`; step 4 prints `0`.

## Actual result

- Step 2: `0` (matches).
- Step 3: two lines, `colo=MSP` and `loc=US` (the runner's egress file records the Cloudflare colo as well as the country). Every `egress.txt` present agrees; none says a country other than US.
- Step 4: `1`. The file is `pipeline/oracle-runtime/travis/lib/source-client.ts`, line 83: `"gis.traviscountytx.gov": policy(2),`, a per-host concurrency policy (etiquette limit 2), not a request. No request is made from it by `coords`, which reads only the artifact.

## Impact and severity

- **Impact:** a literal run of TC-NF-03 reports FAIL although no GIS request left the laptop; the evaluator could read the case as failing.
- **Severity:** Low because the protected rule holds (step 2 of the artifact says `loc=US`, no laptop receipt names the GIS host, the only code holding the host besides the runner and probe is a policy table).

## Suggested investigation area

Fix the test plan, not the code: step 3 expected `colo=<code>` plus `loc=US` (or `grep loc= ... | sort -u` -> `loc=US`), and step 4 exclusion regex extended with `travis/lib/source-client\.ts` (or expect `1`, naming that file). Alternatively keep the plan and move the policy host key into a constant outside `travis/`. The G6 plan is approved, so the PO decides which.

## Evidence

- [ ] Screenshot: not applicable
- [x] Command output above (run 2026-10-22 on `40fa2e2`)
- [ ] CloudWatch: not applicable

## Resolution

| Field      | Value                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Root cause | Test-plan wording written before `source-client.ts` gained its policy table and before the runner logged `colo=` |
| Fix        |                                                                                                                  |
| Re-test    | A-04-TC-NF-03                                                                                                    |
| Status     | ☒ Closed (2026-10-22) ☐ Reopened |
