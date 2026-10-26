---
id: ERR-71
type: defect
feature: FEAT-A11
story: A-11
test_case: Task B validation of published Run 2 (tenure); unit pins in oracle-runtime test/travis/a04/tenure-deeds.test.ts and test/transforms/tcad-county-deeds.test.ts; query-core test/tenure-deed-date.test.ts
ac_reference: A-11
severity: High
status: Closed 2026-10-25: re-tested on Run 3 (manifest bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm): tenure known for 420,411 of 441,961 (95.1%; 372,455 from deeds, 47,956 from sales; Run 2: 175,408); specs/011-publish-and-runs/run3/run3-evidence.json
found_by: Task B validation of published Run 2, for HebaGaber
found_date: 2026-10-25
fix_branch: 011b-run3-corrections
fix_commit: pending (the lead merges the branches)
retest_date: pending
closed_date: pending
---

# ERR-71: Tenure ignores TCAD transfer deeds (60.3% unknown, long tenure overstated)

## Brief description

`tenure_years`, `tenure_basis` and `is_long_tenure` read only `sales[].saleDt`. 266,554 of 441,961 R accounts (60.3%) have no dated sale, so their tenure is unknown, and for accounts with a sale the latest sale is often older than the latest transfer deed, so long tenure is overstated (a CRM that targets long-tenure owners is misled).

## Related requirement

- **Story:** A-11 · **Spec:** A-04 FR-004 · **ADR:** 0003-tenure-from-transfer-deeds (PO decision 2026-10-25)

## Resolution

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root cause        | The County transform and the parcel mapper built the dated list from `sales[]` only. The same TCAD record's `deeds[]` (`deedType`, `deedDt`, `deedRecordedDt`) was never read.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Fix               | `tcad/tenure.ts` `transferEventsOf` merges sales and allow-listed transfer deeds (WD, SW, QD, GD, ED, TD): real dates from 1900 to as_of, one per day (sale beats deed), stable order. The County transform writes one `sales_history_N.json` per transfer; a deed row carries `source_http_request.multiValueQueryString.transfer_source = ["deed"]`. `v_property.tenure_basis` is `deed_date` for such a latest row. `is_long_tenure` stays > 10 years; no dated transfer stays `unknown` / `no_dated_sale`. Contract enum, `columns.json`, migration 0410 and the A-04 spec and test plan text updated. |
| How it escaped    | The tenure rule was tested only against `sales[]`; the export sample used for A-04 had sale dates, and nobody compared the sale dates with the deeds.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tests that pin it | `tenure-deeds.test.ts`, `tcad-county-deeds.test.ts`, query-core `tenure-deed-date.test.ts` and `derive.test.ts` (deed_date basis, exactly 10 years not long), `columns.test.ts` (enum).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Re-test           | Pending: needs a County re-write, new CARs and a Run 3 manifest. County CIDs change for most R accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Evidence: full pass over the real export (read-only, streamed, as_of 2026-10-25, 441,961 R accounts)

| Measure                          | Before (sales only) | After (sales + allow-listed deeds)  |
| -------------------------------- | ------------------- | ----------------------------------- |
| R accounts with a dated transfer | 175,406 (39.69%)    | 420,411 (95.12%)                    |
| Still unknown                    | 266,555 (60.31%)    | 21,550 (4.88%)                      |
| Basis                            | sale_date 175,406   | sale_date 47,956, deed_date 372,455 |
| is_long_tenure true              | 151,508 (34.28%)    | 174,308 (39.44%)                    |

- Of the 266,555 accounts with no dated sale, 245,005 (91.92%) gain a dated transfer; 91,325 of them read long, 153,680 not long.
- Flips from long to not long: 68,525 accounts (45.23% of the long-before group; 39.07% of dated accounts). Flips from not long to long: 0. Of the dated accounts, 127,450 have a deed later than their latest sale.
- Rows added to `sales_history`: 1,436,221 (deed rows); latest-transfer deed types: WD 265,828, SW 99,138, QD 4,431, ED 2,492, TD 487, GD 79. All deed rows written: WD 1,049,776, SW 345,900, QD 21,478, TD 11,092, ED 7,450, GD 525.
- Caveat: 24,075 accounts (5.45%) have a deed of an excluded type dated after their final allowed transfer (MS 4,927, DW 3,690, DC 3,341, CD 2,834, DV 1,906, AH 1,896, GF 1,587, AD 1,155, others fewer). Their tenure is still the older allowed date or unknown; see ADR 0003 for why those codes stay out. One future-dated sale (after as_of) is now ignored.
- Earlier 12,000-record sample estimate (95.9% of no-sale accounts gain a date, 44% of dated accounts overstated) is consistent with the full pass (91.9%, 39.1%).

### 30 random real examples (deed-based latest transfer, seeded sample; pID is the public TCAD account number)

| pID    | Old latest sale | New latest transfer | Deed type | Long before | Long after |
| ------ | --------------- | ------------------- | --------- | ----------- | ---------- |
| 120912 | none            | 2024-08-28          | WD        | unknown     | false      |
| 122345 | 2002-12-16      | 2008-09-30          | WD        | true        | true       |
| 166080 | none            | 2024-01-10          | SW        | unknown     | false      |
| 187908 | 1995-05-19      | 1998-09-25          | WD        | true        | true       |
| 188672 | none            | 2026-02-13          | SW        | unknown     | false      |
| 198380 | none            | 2024-02-27          | SW        | unknown     | false      |
| 244874 | none            | 2015-12-04          | WD        | unknown     | true       |
| 260725 | 2011-11-01      | 2014-08-07          | SW        | true        | true       |
| 273832 | 1998-04-27      | 2016-05-25          | WD        | true        | true       |
| 290252 | 1993-03-26      | 1998-11-04          | WD        | true        | true       |
| 293993 | none            | 2015-08-28          | WD        | unknown     | true       |
| 352382 | none            | 1975-01-18          | WD        | unknown     | true       |
| 378542 | none            | 2021-05-21          | WD        | unknown     | false      |
| 423706 | 2004-07-16      | 2020-02-11          | WD        | true        | false      |
| 438429 | 2003-04-25      | 2017-06-16          | WD        | true        | false      |
| 474538 | 2003-08-13      | 2014-11-14          | WD        | true        | true       |
| 477496 | none            | 2018-06-27          | QD        | unknown     | false      |
| 486076 | none            | 2016-01-22          | WD        | unknown     | true       |
| 486871 | none            | 2001-01-29          | SW        | unknown     | true       |
| 550473 | 2004-06-21      | 2014-03-17          | WD        | true        | true       |
| 563702 | 2005-10-06      | 2024-05-23          | WD        | true        | false      |
| 586751 | none            | 2005-12-22          | SW        | unknown     | true       |
| 727646 | none            | 2011-05-06          | WD        | unknown     | true       |
| 737903 | none            | 2008-09-25          | WD        | unknown     | true       |
| 823146 | none            | 2012-12-10          | WD        | unknown     | true       |
| 823791 | none            | 2015-10-20          | WD        | unknown     | true       |
| 843971 | none            | 2019-08-22          | SW        | unknown     | false      |
| 937958 | none            | 2023-12-16          | WD        | unknown     | false      |
| 959917 | 2025-07-30      | 2025-08-06          | SW        | false       | false      |
| 992942 | none            | 2026-04-22          | SW        | unknown     | false      |
