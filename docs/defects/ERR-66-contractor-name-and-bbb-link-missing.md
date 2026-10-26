---
id: ERR-66
type: defect
feature: FEAT-A11
story: A-11
test_case: pipeline/oracle-runtime test/travis/permits (bbb-search-url, write-group), test/transforms/austin-property-improvement; packages/query-core test/derive and views.fixture; packages/contract test/columns
ac_reference: A-11
severity: High
status: Closed 2026-10-26: contractor name as printed published in Run 3 (manifest bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm) for 4,139 permits; BBB link checked by hand by the PO: with find_type=Category BBB listed only category ads, without it the exact business was found, so find_type was removed (view macro and helper)
found_by: Task B validation of published Run 2 (contractor and BBB columns), for HebaGaber
found_date: 2026-10-25
fix_branch: 011b-run3-corrections
fix_commit: pending (the lead commits after CI)
retest_date: pending
closed_date: pending
---

# ERR-66: Printed contractor name and BBB search link are not published

## Brief description

In the published Run 2 no permit carries a contractor name or a BBB link: `v_roofing_permit.contractor_name_raw`, `bbb_rating` and `bbb_url` were only listed in each row's `missing` with `no_lexicon_carrier`. The Roofing CRM (Task B) therefore shows "Contractor not published" on all 15,025 permits, although the permit prints a company name on 4,139 of them (27.5%).

## Related requirement

- **Story:** A-11 · **Requirement:** FR-012 (new) · **Follow-up:** FU-A-01-contract-address-contractor · **PO decisions (2026-10-25):** (A) publish the printed contractor name "as printed, unverified"; (B) where BBB blocks, publish a BBB search link built from the printed name, rating missing, `bbb_status = blocked`, reason `bbb_blocked`; and, after the correction below, use the lexicon's own contractor model.

## Impact and severity

- **Severity:** High. README demo line "review contractor details and BBB rating" cannot be shown with data.

## Correction of the first investigation (the "no carrier" claim was wrong)

The first version of this document said no legal carrier exists. That was wrong. The Property Improvement data group allows `property_improvement_has_contractor` (relationship schema `property_improvement_to_company`, `bafkreigw3tiixduj5zu4wnxyinsaod6sqyoe73mkhel7pvj3xm4cn7awx4`), `contractor_has_person`, `company_has_communication` and `inspection_has_company`. A contractor is a `company` record (`name`, `request_identifier`, `source_http_request`, `sunbiz_document_number`) linked from the `property_improvement`.

Why the first investigation missed it: it searched for a place to put a *string field* (a property on `property_improvement`, then any class with a name or URL string) and treated the company edge as closed, because ADR-0002 verdict 1 and the Oracle rule ("do not persist a contractor copied from the permit") say the edge is only for a `resolved` contractor. It stopped at that policy reading and never asked whether the PO could accept an unresolved company labelled "as printed, unverified". It also read the data-group relationship list for `file`/`fact_sheet` links but not the `property_improvement_has_contractor` entry it already knew about. The PO decision on 2026-10-25 settles the policy question: the edge may carry an unverified company, because the view labels it so.

## Resolution

| Field | Value |
| --- | --- |
| Carrier | `company.name` linked by `property_improvement_has_contractor` (`export-tables` emits both tables). `request_identifier` = the permit number and `source_http_request` = the permit's per-permit GET of the Austin dataset (the existing provenance). `sunbiz_document_number` is null: a name is evidence, not identity, and no registry id is ever set from a name match. No person, phone or address is written; a permit that prints only a person name publishes no contractor. |
| Policy mitigation | The view calls it `contractor_name_as_printed`; `contractor_resolution` is `resolved` only when the company carries a registry id (never for a printed name), so it stays `unresolved`. The contract text (`contract/v1/README.md`, section v1.1) says "as printed, unverified". |
| Transform | `transformAustinPropertyImprovement` (pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts) writes, per emitted permit with a company name, `company_N.json` and `relationship_property_improvement_has_contractor_N.json`, and adds `property_improvement_has_contractor` to the group root. The name goes through `publishedContractorName()` (travis/permits/bbb-search-url.ts): trimmed, whitespace collapsed, clerk markers such as `**MAIN**` and `***DO NOT USE***` removed, placeholders (N/A, OWNER, SELF, HOMEOWNER, empty) skipped. `PropertyImprovementCounts.contractor_companies_printed` counts them. The write path (permits/write-group.ts) needed no change: it passes the stored payload through. |
| Views (contract v1.1, additive) | `v_roofing_permit` gains `contractor_name_as_printed`, `bbb_rating` (always null, missing reason `bbb_blocked`, or `contractor_unresolved` without a name) and `bbb_url`, a BBB search link built in the view by the macro `bbb_search_url` from the name and the city `Austin` (null with `source_missing` when there is no name; never fetched). `bbb_status` is `blocked` with reason `bbb_blocked` when a name exists, else `not_checked` with `contractor_unresolved`. `contractor_name_raw` is replaced by `contractor_name_as_printed`. Every v1 column keeps its name and type. `v_contractor` derives `contractor_resolution` and the BBB status the same way. A run published before Run 3 has no `property_improvement.company` rows; `bindManifest` binds an empty table, so the new columns are null with a reason and nothing fails. The Permits page now also reads the `company` table parts (one more small part per permits batch). |
| Labels | `packages/shared/src/labels.ts`: `BBB_SEARCH_LINK_LABEL` "Search BBB for this contractor", `BBB_RATING_NOT_PUBLISHED_LABEL` "BBB rating not published (BBB blocked the lookup)"; the reasons `bbb_blocked` and `contractor_unresolved` were already in the closed list. |
| CLI proof | Pinned `elephant-cli` 1.58.1 (`44bb182`) on 7 real parcels (8 emitted permits, 6 with a printed company): `validate` 7/7, `hash` CAR of 72 blocks, `validate <car>` passes every check, `export-tables` emits 9 tables including `company` (6 rows: `name`, `request_identifier` = permit number, `source_http_request`, `sunbiz_document_number` null) and `property_improvement_has_contractor` (6 rows). Nothing was uploaded. |
| Link shape caveat | `https://www.bbb.org/search?find_country=USA&find_text=<name>&find_loc=Austin%2C%20TX&find_type=Category` is UNVERIFIED. No bbb.org request was made (A-01: HTTP 403 challenge). A human must click one example before it ships. The city is always Austin because the company record has no city, so a search for an out-of-town contractor may miss. |
| Still not published | `status_raw` and `expiry_date` (no lexicon property; ADR-0002 verdicts 2 and 3), the contractor city, and any person contractor. |
| Tests that pin it | oracle-runtime: `test/travis/permits/bbb-search-url.test.ts`, `test/travis/permits/write-group.test.ts` ("printed contractor company"), `test/transforms/austin-property-improvement.test.ts`. query-core: `test/derive.test.ts` (resolution, BBB state, SQL macro equals the TypeScript builder over ampersands, quotes, unicode, long and emoji names), `test/views.fixture.test.ts` (DuckDB: printed company unresolved with link, registry id resolved, no name no link), `test/view-plan.test.ts`, `test/permits-views-batched.test.ts`, `test/sample.test.ts`. contract: `test/columns.test.ts`. web: `test/permits-bind-subset.test.ts`. |
| Re-test | Pending: needs a full Property Improvement re-write, new CARs and a Run 3 manifest (PO approval for the publish). |
| Status | Closed 2026-10-26: names in Run 3 (4,139 permits); BBB link checked by hand by the PO and corrected (find_type removed). |
