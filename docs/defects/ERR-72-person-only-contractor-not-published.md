---
id: ERR-72
type: defect
feature: FEAT-A11
story: A-11
test_case: pipeline/oracle-runtime test/travis/permits/write-group.test.ts ("publishes a person-only contractor as company.name as printed", "keeps the printed company when both a company and a person are printed")
ac_reference: A-11
severity: Medium
status: Closed - published in Run 3.1 (travis-full-run3-1-20261025)
found_by: Task B (Roofing CRM) Run 3 data-gap questions, question 3, for HebaGaber
found_date: 2026-10-25
fix_branch: 011e-run3-1-permit-contractors
fix_commit: pending
retest_date: 2026-10-26
closed_date: 2026-10-26 (Run 3.1 published)
---

# ERR-72: A permit that prints only a contractor person publishes no contractor

## Brief description

In Run 3, 4,139 of the 15,025 published roofing permits name a contractor. Task B asked whether the other 10,886 lack a name in the Austin source or lose it in the join. Counted from the Query DB on 2026-10-26: 10,470 print no contractor at all (10,436 of them were issued before 2000; Austin's legacy records list none), and **416 print a contractor person (`contractor_full_name`) but no company**. ERR-66 published only `contractor_company_name`, so those 416 showed "contractor not published".

## Decision

PO (HebaGaber), 2026-10-26: publish the person-only name "as printed". The lexicon links a permit's contractor to a **company** only (`property_improvement_has_contractor` → `property_improvement_to_company`), so the name goes into `company.name`, with the permit's own request as provenance and no `sunbiz_document_number`, exactly like a printed company. This overrides the ERR-66 rule "a person-only contractor is not published". A printed company always wins over the person name. `company.name` can therefore hold an individual's name.

## Fix

`pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts`: the published name is `publishedContractorName(contractor_company_name) ?? publishedContractorName(contractor_full_name)` (placeholders such as N/A or OWNER count as no name). New count `contractor_persons_printed`. No person record, phone or address is written. Contract text: `contract/v1/README.md` § v1.1 (no column change).

## Result (Run 3.1 rebuild, 2026-10-26)

Compared with Run 3's group file by file: 413 new `company_N.json` and 413 new `relationship_property_improvement_has_contractor_N.json`, 327 changed data-group root files (their relationship lists), and every other file byte-identical (all 15,025 permit records and every shared file). 416 − 413 = 3 person-only entries were placeholders. Published permits naming a contractor: 4,139 → 4,552.
