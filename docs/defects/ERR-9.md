---
id: ERR-9
type: defect
feature: FEAT-A02
story: A-02
test_case: A-02-TC-004 (carrier not emitted by the export → "no carrier (not emitted)")
ac_reference: A-02-AC-1 (story edge case 2)
severity: Low
status: Closed
found_by: Claude (Stage 6 test-case run, build f3ddcbe)
found_date: 2026-10-21
fix_branch: 002-data-contract
fix_commit: c18f125
retest_date: 2026-10-21
---

# ERR-9: The "carrier not emitted by the export" rule is applied by hand, not checked

## Brief description

TC-004 expects two things:
- a check that turns a lexicon carrier missing from an exported table into the verdict `no carrier (not emitted by the export)`;
- that field kept out of every view.

The pilot half passes: the only carrier, `sales_history.ownership_transfer_date`, is a column of `county/sales_history`. But no code or test makes that decision. ADR-0002 Decision 3 marks the `address` fields `no_carrier_not_emitted` by hand, and `columns.ts` lists them in `UNCARRIED`. The nearest test (`views.shape.test.ts › fails loudly when an emitted table lacks a column`) throws instead of marking the field.

## Related requirement

- **Story:** A-02 · **AC:** A-02-AC-1 · **Edge case:** "A carrier exists but `export-tables` does not emit it → treated as no carrier for the views until the export includes it" · **Requirement:** FR-001 · **Test case:** A-02-TC-004

## Environment

A terminal at the repository root on `002-data-contract`, build `f3ddcbe`, `PILOT_DIR=pipeline/data/pilot/travis-pilot-20261020`. No hosted runtime (Project story).

## Preconditions and test data

The pilot export of `travis-pilot-20261020`. Its `address` table has only `cid, property_cid, data_group_cid, request_identifier`, because the lexicon `address` class is a top-level `oneOf`.

## Steps to reproduce

1. `pnpm vitest run -t "A-02-TC-004"` → no test matches.
2. `git grep -n no_carrier_not_emitted -- packages` → only the verdict list in `carriers.test.ts`.

## Expected result

A fixture table without the cited property gives `no carrier (not emitted by the export)`, and the field appears in no view. A pilot check confirms that every `carrier` and every view-sourced property is really a column, and that the `not_in_export` list is not stale.

## Actual result

There is no checker and no fixture test. The rule holds today only because the address fields were marked by hand.

## Impact and severity

**Low.** The published contract is correct today. But a later export change, such as A-04 adding a class, could silently leave a "carrier" verdict or a view column pointing at a missing field. The views would then fail to compile instead of saying why.

## Suggested investigation area

`packages/query-core/src` (a pure checker) and `packages/query-core/test` (fixture plus pilot test).

## Evidence

`docs/reports/A-02-test-report.md` row A-02-TC-004.

## Resolution

Closed. `packages/query-core/src/carrier-emission.ts` (`checkCarrierEmission`, pure, no engine import) and `test/carrier-emission.test.ts` › "A-02-TC-004 …" (written first: "Cannot find module"; now 6 passed with PILOT_DIR). Covers ADR carriers, every view column sourced from a `class.property`, a fixture table lacking the property → `no_carrier_not_emitted`, and the `not_in_export` list not stale. Re-test 2026-10-21: PASS.
