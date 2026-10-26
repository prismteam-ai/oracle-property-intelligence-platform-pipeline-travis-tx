---
id: ADR-0002
type: decision
parent: ARD-A
story: A-02
title: "Lexicon carriers for the nine AC-1 fields"
status: Accepted
date: 2026-10-21
---

# Lexicon carriers for the nine AC-1 fields (A-02, FR-001 / AC-1)

## Context

The views in `contract/v1` may only freeze a column name once the field has a verdict: either a lexicon `class.property` that carries it **and** a real pilot row where the export emits it, or "no carrier" with a fallback and a drafted lexicon extension request (FR-001). mew drafted the nine verdicts on 2026-10-20 from the bundled neutral-lexicon reference, because the live lexicon MCP tools failed (`agent-design.md`, mew § A.2). This ADR re-checks each verdict against the live schemas that the pilot's `elephant-cli validate` runs pulled into `~/.elephant-cli/schema-cache/`, and against `DESCRIBE` of the pilot Parquet tables.

## Sources

| Source                                                                                                              | State on 2026-10-20/21                                                                                                          | Used for                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Live lexicon MCP tools (`listClassesByDataGroup`, `listPropertiesByClassName`, `getPropertySchema`, kit and legacy) | **Failed** on 2026-10-20 ("Internal error"; mew § 0, oracle F9). Not used.                                                      | Nothing                             |
| Live lexicon manifest `https://lexicon.elephant.xyz/api/manifest`                                                   | **Live**: HTTP 200, 18,499 bytes, sha256 `7084b9334e66eb525d729e2d399f7216960abf30900081aaed194210be760640` (2026-10-20T22:04Z) | Class and data-group schema CIDs    |
| `~/.elephant-cli/schema-cache/`                                                                                     | **Live**: filled by `elephant-cli validate` (1.58.1, GitHub main `44bb182`) during the pilot; 159 schemas                       | Every property, type and enum below |
| Pilot export `pipeline/data/pilot/travis-pilot-20261020/tables/` (local, unpublished)                               | `export-tables` of both pilot CARs; read with DuckDB v1.5.6 (`DESCRIBE`, `SELECT`)                                              | Column presence and the cited row   |
| Pilot manifest `contract/v1/pilot-manifest.json`                                                                    | CID `bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka` (D-9 re-run from the saved captures)                          | The run the row belongs to          |

Class schemas used (copied byte for byte to `packages/query-core/test/fixtures/schemas/`, with `index.json`):

| Class                  | Schema CID                                                    |
| ---------------------- | ------------------------------------------------------------- |
| `property`             | `bafkreidmp2ndoc2efglfjezsr3jhzuk25ihunuagwqcpt6dtf2sf36cjau` |
| `address`              | `bafkreiebzvyy6prnwf3dcippii7yysrjesnbxpvcpyqmbs2b67hm2taf2a` |
| `parcel`               | `bafkreih3cczzb2m4bkh5kody6wscmwjwlmpea3q6y5hvsokuqb5vg7qt3a` |
| `geometry`             | `bafkreibwkj4mvtrrsbrunzx37p3vwumnx2pu3ugh5b664wbz6puyushw2y` |
| `structure`            | `bafkreidmellpslg6wc4xchnmtobt6g3xjs3sdx2m6crcfzsomsaakrwtim` |
| `sales_history`        | `bafkreifxchneb27o64d2bokhpkqiompw3lyoctqeooe5vq5m6dsyvyxgku` |
| `company`              | `bafkreifpgr7nbrcmdrjocuys34yjgdtttynt3pwrkpv47mlheklykmopjy` |
| `person`               | `bafkreig5vowakcuc6ropc4wfs5mgq5n3zbplegqqnsznwlogdjlat5z3nq` |
| `property_improvement` | `bafkreid5jnt3qgp4qmb4iea6klbdpprd6evpgrpc3gofseol4s3kdljeam` |
| `fact_sheet`           | `bafkreifn5fzcitm4i4p4psgdyrpltnw3riusffrkmlvz4qb3euclsdj4ri` |

Data groups: Seed `bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu`, County `bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq`, Property Improvement `bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu`.

## Verdicts

Verdict values: `carrier`, `no_carrier`, `no_carrier_not_emitted` (a carrier in the schema that the export does not emit). Fallbacks: AD-24 (contractor state: `resolved` / `unresolved` per row, five-state totals in the manifest `coverage`) and AD-25 (field not published; the view shows the reason).

| #   | Field                       | Verdict    | Carrier                               | Schema cache                                                                                  | Pilot row                                                                                  | Fallback                                                                                                      | Drafted request |
| --- | --------------------------- | ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | printed contractor name     | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreid5jnt3qgp4qmb4iea6klbdpprd6evpgrpc3gofseol4s3kdljeam.json | —                                                                                          | AD-25: not published; reason `no_lexicon_carrier`                                                             | R3              |
| 2   | status_raw                  | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreid5jnt3qgp4qmb4iea6klbdpprd6evpgrpc3gofseol4s3kdljeam.json | —                                                                                          | AD-25: Expired published as `improvement_status` null (D-4a); reason `no_lexicon_carrier`                     | R1              |
| 3   | expiry_date                 | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreid5jnt3qgp4qmb4iea6klbdpprd6evpgrpc3gofseol4s3kdljeam.json | —                                                                                          | AD-25: not published; reason `no_lexicon_carrier`                                                             | R2              |
| 4   | BBB rating                  | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreifn5fzcitm4i4p4psgdyrpltnw3riusffrkmlvz4qb3euclsdj4ri.json | —                                                                                          | AD-25: `bbb_status = not_checked`, reason `no_lexicon_carrier`                                                | R5              |
| 5   | BBB profile URL             | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreifn5fzcitm4i4p4psgdyrpltnw3riusffrkmlvz4qb3euclsdj4ri.json | —                                                                                          | AD-25: not published; reason `no_lexicon_carrier`                                                             | R5              |
| 6   | per-permit contractor state | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreid5jnt3qgp4qmb4iea6klbdpprd6evpgrpc3gofseol4s3kdljeam.json | —                                                                                          | AD-24: `contractor_resolution` ∈ {resolved, unresolved} per row; five-state totals in the manifest `coverage` | R4              |
| 7   | roof_age_basis              | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreidmellpslg6wc4xchnmtobt6g3xjs3sdx2m6crcfzsomsaakrwtim.json | —                                                                                          | AD-25: derived in the view from `structure.roof_date` (§ B.5), never stored                                   | R6              |
| 8   | roof_age_confidence         | no_carrier | —                                     | ~/.elephant-cli/schema-cache/bafkreidmellpslg6wc4xchnmtobt6g3xjs3sdx2m6crcfzsomsaakrwtim.json | —                                                                                          | AD-25: derived in the view (§ B.5), never stored                                                              | R6              |
| 9   | owner sale date             | carrier    | sales_history.ownership_transfer_date | ~/.elephant-cli/schema-cache/bafkreifxchneb27o64d2bokhpkqiompw3lyoctqeooe5vq5m6dsyvyxgku.json | {table: sales_history, cid: baguqeeratr5ggalftrozpuaqp4iye3ynt4v3fj4syfbhbrhbjqr7cbxljh7a} | if a property has no dated sale: `tenure_basis = unknown`, reason `no_dated_sale`                             | —               |

### Re-check of each of mew's verdicts

All nine of mew's verdicts (8 no carrier, 1 carrier provisional) **hold** against the live schemas. The one provisional carrier is now final.

1. **Printed contractor name: no carrier (confirmed).** The live `property_improvement` class has `additionalProperties: false` and exactly these properties: `application_received_date, completion_date, contractor_type, fee, final_inspection_date, improvement_action, improvement_status, improvement_type, is_disaster_recovery, is_owner_builder, permit_close_date, permit_issue_date, permit_number, permit_required, private_provider_inspections, private_provider_plan_review, request_identifier, source_http_request`. `DESCRIBE property_improvement` (pilot) shows the same columns plus `cid, property_cid, data_group_cid`. `company.name` exists (`name, request_identifier, source_http_request, sunbiz_document_number`), but only through `property_improvement_has_contractor`, which AD-06 allows for `resolved` contractors only. The pilot wrote no such edge: there is no `property_improvement_has_contractor` table. `contractor_type` is a category enum (`GeneralContractor, Specialist, DIY, PropertyManager, Builder, HandymanService, Unknown`, null) and is written null.
2. **`status_raw`: no carrier (confirmed).** `improvement_status` enum is `Completed, InProgress, Planned, Permitted, OnHold, Cancelled`, null. There is no Expired and no verbatim status property. Pilot: 3 emitted Expired permits have `improvement_status` NULL (`SELECT improvement_status, count(*)` gives Completed 16, Permitted 24, NULL 3).
3. **`expiry_date`: no carrier (confirmed).** No `property_improvement` property matches expir*, and no date property means "lapses". The Austin `expiresdate` is not written.
4. **BBB rating: no carrier (confirmed).** The live `fact_sheet` class has only `full_generation_command` and `ipfs_url`. A text search of all 159 cached schemas for rating, bbb and reputation finds only `school` (`grade_rating`, `overall_district_rating`, `rating_score`) and `utility` (`hvac_seer_rating`); no business-rating class. The Property Improvement group has no `company_has_fact_sheet`.
5. **BBB profile URL: no carrier (confirmed).** Same evidence as #4. `fact_sheet.ipfs_url` is the fact sheet's own address, and `file.original_url` describes a document; neither may be borrowed.
6. **Per-permit contractor state: no carrier (confirmed).** No property or enum on `property_improvement`, `company` or the group expresses candidate, ambiguous or conflicting.
7. **`roof_age_basis`: no carrier (confirmed).** `structure` has `roof_date` (string or null, pattern `^\d{4}(-MM(-DD)?)?$`) and `roof_age_years` (integer or null, minimum 1) but no basis property. Pilot (D-9 re-run): `structure` 22 rows, 12 non-null `roof_date`, all the TCAD built year. The 10 permit-anchored roof dates are no longer written on `structure` (that record carries the TCAD request, oracle F1); the view derives them from the published Austin permit rows (closed Roofing + Replacement, latest `completion_date` / `permit_close_date` not after `as_of` and not before the issue date), and agrees with the estimator ledger on all 22 properties.
8. **`roof_age_confidence`: no carrier (confirmed).** Same as #7.
9. **Owner sale date: carrier (now final).** `sales_history.ownership_transfer_date` (string or null, format `date`, minLength 1) is in the cached County-group class, linked by `property_has_sales_history`. It is emitted: `DESCRIBE county/sales_history` gives `ownership_transfer_date VARCHAR`, and the cited row (`property_cid` of TCAD pID `138273`, `request_identifier` `138273`) has `ownership_transfer_date = 1993-12-17`. The owner is linked by `sales_history_has_company` (6 rows) or `sales_history_has_person` (0 rows in the pilot). **Assumption (oracle F3): the latest dated sale is the current owner.** The transform links TCAD's current `owners[]` to the latest dated `sales_history`; a property whose owners have no dated sale gets no owner (reason `no_dated_sale`, counted as `owner_no_dated_sale`; linking without a sale is deferred to A-04). Owner gaps are counted from the capture receipts (`owner_no_dated_sale` 12, `owner_unparsed` 4, `owner_confidential` 0, `owner_no_record` 0 in the pilot).

## Other findings from the live schemas and the pilot

- **`address` fields are not emitted by `export-tables`.** The live `address` class is a top-level `oneOf` (unnormalized or structured) with no top-level `properties`, and the pilot `address` table has only `cid, property_cid, data_group_cid, request_identifier`. `unnormalized_address`, the postal fields and the (deprecated) `latitude` / `longitude` are therefore **not emitted** for the 22 seed addresses or the 6 owner mailing addresses. Any view column taken from `address` is `no_carrier_not_emitted` until the CLI exports `oneOf` classes. The situs point is available from `geometry` (`parcel_has_geometry`).
- **No "Travis" in `address.county_name`.** The enum lists 140 counties and not Travis, so the first `validate` failed on every seed address. `county_name` is optional, so it is not written; the seed CSV keeps the county. A lexicon request to add Travis is part of R7.
- **Mailing addresses are `address` records.** There is no `mailing_address` class; `person_has_mailing_address` and `company_has_mailing_address` point at `address` (relationship schemas `person_to_address`, `company_to_address`).
- **`property_type` values in use are deprecated.** The live enum keeps `SingleFamily`, `MultipleFamily` and the other form values only as `deprecated_enum_values`; the non-deprecated set is `LandParcel, Building, Unit, ManufacturedHome`. They still validate. One parcel (pID 105471, TCAD state code `E1`) has no mapping; `property_type` is required and non-null, so that parcel is left out of both groups and counted (`parcels_unmapped_property_type` = 1 in the manifest), never guessed.
- **`property_improvement_has_address` exists** in the live Property Improvement group schema (single link, string or null). **No `*_has_fact_sheet` relationship exists in the Property Improvement group.** `property_improvement_has_fact_sheet` and `company_has_fact_sheet` exist only in the County group.
- **Austin has no close or final-inspection date column.** The 50 captured Austin 3syk-w9eu rows carry `completed_date` (16 rows), `issue_date`, `applieddate`, `statusdate` and `expiresdate`, and **no** close-date or final-inspection-date field. `permit_close_date` and `final_inspection_date` are therefore not mapped because the source has no such column (reason `source_missing`), not because a carrier is missing; `statusdate` (the date of the current status word) is not a close date and is not written.
- **`confidentialCode` (decided by the PO 2026-10-21).** In the TCAD 2026 certified export the Track A part 1 inspection (run log, 2026-10-21 00:47) saw the flag (value `Q`) only on `sales[]`, never on `owners[]`. The transform fails closed: when either `owners[]` or `sales[]` carries a `confidentialCode`, no owner name and no mailing address is written, and the suppression is counted. In the 23 matched pilot records no `owners[]` or `sales[]` entry carries the flag, so the pilot count is 0. **PO decision (2026-10-21):** "Yes, hide owner (Recommended)": a sale-level code suppresses the whole owner (fail closed, P0-15). **D-9 (oracle F2):** a truthy or non-zero `sales[].confidentialSale` also suppresses the whole owner, and any other `confid*` key the transform does not model suppresses it too (fail closed, counted, the key recorded as `unmodeled:<path>`). In the 23 matched pilot records `confidentialSale` is `0` on all 17 sales and no other `confid*` key appears, so `owner_confidential` is 0.
- Sale prices are never written (Texas is a non-disclosure state; `purchase_price_amount` stays null).

## Drafted extension requests

Status: **drafted, not filed (PO decision D-1)**. Taken from mew § A.3; R7 is new from the pilot. **PO decision D-8 (2026-10-21):** "Draft only, don't file (Recommended)". Not filed; revisit at release.

- **R1** `property_improvement.permit_status_text`: string or null, no enum. The issuing authority's status word, verbatim (for example "Expired" or "Pending Permit"). `improvement_status` is a normalised six-value enum with no expiry state; without the source word a lapsed permit cannot be told from an active one without inventing a value. It works for any permit authority.
- **R2** `property_improvement.permit_expiration_date`: string or null, format `date`. The date the permit lapses or lapsed if no final inspection happens; it sits alongside `permit_issue_date` and `permit_close_date` and is the evidence behind the `stalled` signal. Alternative if a new field is refused: add `Expired` to the `improvement_status` enum.
- **R3** `property_improvement.contractor_printed_name`: string or null. The contractor name exactly as printed on the permit record. A printed name is evidence, not identity; Texas prints names without registry identifiers, so `property_improvement_has_contractor` cannot be asserted and the listed contractor cannot be published today.
- **R4** `property_improvement.contractor_identity_status`: string or null, enum `Resolved`, `Candidate`, `Ambiguous`, `Conflicting`, `Unresolved`. How far the contractor's identity was resolved against an official registry. Depends on oracle and the PO confirming per-permit publication under AD-04.
- **R5** New class `business_rating`, linked by `company_has_business_rating` (Property Improvement and County groups): `rating_source` (enum `BBB`, extendable), `rating_grade` (enum `A+` … `F`, `NR`), `profile_url` (uri), `is_accredited` (boolean or null), `observed_date` (date). `fact_sheet` carries no fields, so a rating cannot be published today. Confirm the grade members against a captured BBB page before filing.
- **R6** `structure.roof_date_basis` (enum `Permit`, `NewConstruction`, `BuiltYear`, `Unknown`) and `structure.roof_date_confidence` (enum `High`, `Medium`, `Low`, `None`). A `roof_date` without its basis cannot be weighed by consumers. Low priority: the AD-25 view derivation covers it.
- **R7** (new) `address.county_name`: add `Travis` (and the other Texas counties) to the enum; and ask the CLI team to emit the `address` properties in `export-tables` for `oneOf` classes. Without them the situs text and owner mailing area cannot be read from the published tables.

## Decision

1. Freeze only `sales_history.ownership_transfer_date` as a carrier for the nine AC-1 fields.
2. The other eight fields use their fallback (AD-24 for #6, AD-25 for the rest); every view row shows the reason instead of a blank (AC-7).
3. Every `address`-sourced view column is treated as `no_carrier_not_emitted` until the export emits it.

## Consequences

- AC-4's "Expired is `stalled`" and AC-8's "at least one stalled reroof" are met only through D-4a's convention (`improvement_status` null on an emitted permit means stalled, generated from the profile), not a carried source word.
- When R1 or R2 lands, the change is additive (`stalled` stays in the frozen `status_class` enum).
- The schema snapshots in `packages/query-core/test/fixtures/schemas/` pin the shapes the views are tested against (T057); a schema CID change in the live manifest is a signal to re-run this check.

## Update 2026-10-26: address fields from Run 3.1 (ERR-74)

The finding "`address` fields are not emitted by `export-tables`" and decision 3 (address-sourced view columns are `no_carrier_not_emitted`) hold for the pilot and Runs 1 to 3 only. The carrier verdict is unchanged: `address` is still the class, reached by `property_has_address` and `*_has_mailing_address`. A re-check of the live lexicon (manifest unchanged) found no other carrier: `unnormalized_address` (Seed group, `property_seed`) requires a `county_jurisdiction` enum with no Travis (as R7 notes). PO decision 2026-10-26: from Run 3.1, `export-tables` runs with the oneOf-columns patch (`pipeline/publish/patches/elephant-cli-export-oneof.patch`) on the unchanged CARs, and contract v1.2 adds `unnormalized_address`, `owner_mailing_postal_code` and `owner_mailing_state_code` to `v_property`. The CLI half of R7 ("emit the `address` properties for `oneOf` classes") is what the patch does; the request stays drafted, not filed (D-8). Details: `docs/defects/ERR-74-address-not-in-tables.md`.
