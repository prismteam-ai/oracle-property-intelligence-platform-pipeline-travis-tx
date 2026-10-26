---
id: ERR-4
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-009
ac_reference: A-01-AC-3
severity: Medium
status: Closed (accepted by the PO)
found_by: Claude (QC run 2026-10-20)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit:
retest_date: 2026-10-20
---

# ERR-4: TCAD roll – certification date not recorded: the public-information page states none

## Brief description

TC-009 step 4 (plan v0.6, PO 2026-10-20) expects `parcel.certification_date` as stated on TCAD's public-information page. The page captured at 2026-10-20T06:19:52Z gives only "(July)" beside the 2026 certified exports, so the catalog records the date as missing with that reason (PO decision 2026-10-20: the export file name's date is not used).

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-3 · **Requirement:** FR-003a (certification date) · **Test case:** A-01-TC-009

## Environment

| Item | Value |
| --- | --- |
| URL | N/A: Project story, no hosted runtime until A-03 |
| Build | `a96d669` + QC fixes (branch `001-discover-sources`) |
| Data snapshot | catalog `pipeline/docs/travis-sources.yaml`; no manifest CID in A-01 |
| Browser / OS / device | terminal, macOS (darwin-arm64), Node 22.23.3, Vitest 5.0.5 |
| Role | operator |

## Preconditions and test data

- Branch `001-discover-sources`, repo root, § 6 shell setup of `testplans/A-01-test-cases.md`; committed catalog and evidence.

## Steps to reproduce

1. Run `catq 'parcel.certification_date'` → `undefined`.
2. Run `catq 'parcel.certification_date_measurement.missing_reason'`.

## Expected result

An ISO date, as stated by an official TCAD source.

## Actual result

`undefined`; `missing_reason`: "the TCAD public-information page captured at 2026-10-20T06:19:52.331Z does not state a certification date; the export file name's date is not used (PO decision 2026-10-20)".

## Impact and severity

- **Impact:** AC-3's certification date is missing; the roll count, key and deed dates are recorded, and the gap is disclosed in the catalog.
- **Severity:** Medium because one AC-3 field is missing, and it is disclosed.

## Suggested investigation area

Needs a PO decision on another official source (for example TCAD's 2026 Certified Totals report) or acceptance of the documented gap.

## Evidence

- [x] Acceptance JSON report of the QC run (`docs/reports/A-01-test-report.md` lists the runs)
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Needs a PO decision on another official source (for example TCAD's 2026 Certified Totals report) or acceptance of the documented gap. |
| Fix | Accepted by the PO (HebaGaber) on 2026-10-20: the date stays missing with its reason; no other source is fetched. TC-009 step 4 now passes on a stated date, or on a missing date with its reason, source and capture time. FR-003a's certification-date part is knowingly unmet and disclosed in the catalog. The test plan's TC-009 step 4 needs the same wording (QC-owned). |
| Re-test | A-01-TC-009 PASS on 2026-10-20 |
| Status | ☒ Closed (accepted) ☐ Reopened |
