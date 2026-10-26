---
id: ERR-68
type: defect
feature: FEAT-A11
story: A-11
test_case: Task B validation of published Run 2 (roof age); unit pins in oracle-runtime test/travis/a04/county-roof-date.test.ts and query-core test/roof-date-built-year.test.ts
ac_reference: A-11
severity: High
status: Closed 2026-10-25: re-tested on Run 3 (manifest bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm): roof age known for 389,528 of 441,961 properties (88.1%, Run 2: 9,510); specs/011-publish-and-runs/run3/run3-evidence.json
found_by: Task B validation of published Run 2, for HebaGaber
found_date: 2026-10-25
fix_branch: 011-publish-and-runs
fix_commit: pending (the lead commits after CI)
retest_date: pending
closed_date: pending
---

# ERR-68: County group writes structure.roof_date null for every property

## Brief description

In the published Run 2, `structure.roof_date` is null for all 441,961 structures, although `property_structure_built_year` is set for 399,940 of 452,753 properties. So `v_property.roof_age_years` is null for about 98% of properties and the roof-age views show "unknown" almost everywhere.

## Related requirement

- **Story:** A-11 · **Rule:** oracle F1 (the built year is the only TCAD-sourced roof date; a permit date comes from the permit join)

## Impact and severity

- **Severity:** High. Roof age is a headline column of the Properties view; the published County CARs carry the wrong (empty) value.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `planCountyGroup()` (pipeline/oracle-runtime/travis/tcad/write-group.ts) called `transformTcadCounty({ ..., roofAge: null })` for every record. The transform only writes `structure.roof_date` from a ledger entry with anchor `property_built_year`, so it always wrote null (and the warning `no_roof_age_ledger_row`, which nobody read). The ledger rows already existed in the Query DB table `roof_age_estimates`. |
| Fix | `GroupInput.roofAge` carries the ledger entry into the planner. `writeGroupWith()` (pipeline/local-stack/services/workflows/tcad-backbone.ts) reads `roof_age_estimates` once per 1,000-property batch (`roofAgeLedgerFor`), maps each row with the pure `roofAgeEntryOf()`: basis `built_year` gives `roof_date` = built year as "YYYY" (as-of year minus the estimated age) with anchor `property_built_year`; basis `permit`, `new_construction` and `unknown` give no TCAD date (a permit date is never stamped on a TCAD request). A missing row keeps the warning and null. `writeGroup` now reports a `roof_age` tally (built_year, no_tcad_date, missing_ledger_row, ledger_table_missing). |
| How it escaped | Transform tests passed `roofAge` fixtures directly, and the query-core fixture hand-wrote `roof_date: "1985"`. No test ran the planner or the write path with a ledger, and the full path passed null, so each layer was green while the end-to-end value was empty. |
| Tests that pin it | oracle-runtime `test/travis/a04/county-roof-date.test.ts` (planner: built_year gives "1987", permit/unknown give null, missing row gives null, pID mismatch throws); `test/transforms/tcad-county.test.ts` (missing row warns, anchor-less row does not); local-stack `test/write-group-pids.test.ts` (one ledger query per batch, tallies, missing-table handling); query-core `test/roof-date-built-year.test.ts` (roof_date 1987, no permit gives built_year / low / as-of year minus 1987). |
| Re-test | Pending: needs a full County re-write, new CARs and a Run 3 manifest (PO approval for the publish). |
| Status | Closed in Run 3: roof age known for 389,528 of 441,961 (88.1%). |
