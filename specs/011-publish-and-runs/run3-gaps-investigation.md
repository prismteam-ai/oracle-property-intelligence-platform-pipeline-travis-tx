# Run 3 gaps investigation (Task B findings: tenure, coordinates, contractors/permits)

Investigation only. No source file, commit, push, Query DB write or published data was touched. Evidence comes from read-only SQL on the local Query DB (`parcels`, `gis_features`, `property_improvements`, `permit_source_rows`, `comptroller_registry`, `contractor_resolution_current`), a streamed read of the local TCAD export zip (`pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip`), and a few read-only GETs of public City of Austin ArcGIS layers. Nothing was fetched from bbb.org.

## Summary

| Gap | Cause lives in | Fixable in Run 3 from reachable public data? | Headline |
| --- | --- | --- | --- |
| 3 Tenure | Our pipeline (we read only `sales[]`, ignore `deeds[]`); source is not the limit | Yes | 60.3% of the 441,961 R accounts have no sale date. The same export carries `deeds[].deedDt` for about 96% of them. Using deeds also corrects wrong "long tenure" answers on accounts that do have an old sale. |
| 4 Coordinates | Mostly source (GIS layer has no polygon for the account); partly our rule (we refuse address-to-point) | Partly: about 80% of the no-point accounts via City of Austin address points, needs a PO rule change | 51,900 = 46,945 `no_gis_feature` + 423 `no_permit_point` + 4,532 `permit_point` (kept internal). 86% are condo or townhome units. |
| 5 Contractors/permits | Source and contract: no identifier on Austin permits, no lexicon carrier for the printed name, no BBB access; other cities are vendor portals | Resolution: no (and by design never "resolved" by name). BBB search link: yes, but needs a contract v1.1 change. Other jurisdictions: no | Name-only exact match gives candidates for 1.1% of roofing permits. |

---

## GAP 3 Tenure (`is_long_tenure` NULL)

### What the data says

- Query DB `parcels`, prop_type R (441,961): 266,554 have `tenure_basis = unknown` (60.3%), 175,407 have a sale date. Of the 266,554, 266,549 have an EMPTY `sales` array in the export (so this is not a parsing loss) and 5 have a sale row with `saleDt` null or a future date.
- `sales[]` is a thin source. Sale dates start in 1988 (4 rows in 1985 to 1987, then 1,691 in 1988), so the array is a conversion-era history, not the full chain. Sale dates also thin out after 2013 (2018: 123 rows, 2019: 389) and from 2022 on the new rows are mostly saleType L with no `deedID` (23,261 rows), not deed-backed sales. Result: unknown-tenure share by year built is 25% for 1990s builds but 56% for 2000s, 84.5% for 2010s, 85.7% for 2020s.
- The same TCAD record has a `deeds[]` array that the pipeline does not read for tenure (the DB `payload_redacted` also drops it; the raw zip has it). Each deed has `deedType`, `deedDt`, `deedRecordedDt`, `buyerLine`, `sellerLine`, `instrumentNum`. `pipeline/docs/travis-county-findings.md` line 65 already says deed dates are present.
- Streamed sample (first 12,000 R records read in pID order, every third record, so it skews to older low-numbered accounts; treat as indicative, not final):
  - Accounts with no `sales` date: 4,643. Of these, 4,453 (95.9%) have a dated deed of a transfer type (WD, SW, QD, GD, ED, TD). 190 (4.1%) stay genuinely undated. Of the 4,453, 2,948 (66%) have a `buyerLine` that matches the current owner name, which is independent confirmation that the deed is the transfer into the current owner.
  - Accounts that DO have a sale date: 7,357. For 5,378 of them (73%) a transfer deed dated more than 90 days AFTER the latest sale exists. For 3,231 (44% of dated accounts) the current rule says long tenure (over 10 years) while the latest transfer deed says 10 years or less. Zero flips in the other direction. So the present column is not only NULL for many rows, it is also overstated as "long tenure" for a large share of rows that have a value. This is the more serious finding for Task B, a CRM that targets long-tenure owners.
- Extrapolation (low confidence until a full pass runs): NULL share falls from 60.3% to about 3 to 7% of R accounts. The honest remaining NULLs are new construction never conveyed in the export, and accounts whose only deed is a non-transfer instrument type.

### Texas non-disclosure

Texas non-disclosure hides sale PRICE, not the existence or date of a recorded deed. The deed index is public at the county clerk and TCAD copies it into `deeds[]`. So "no dated sale" is the honest answer for the `sales[]` source alone, but not for the record as a whole. `no_dated_sale` is accurate to its name today, the issue is that the rule only looks in one array.

### Other reachable sources

- Comptroller (the 342,333-row registry) has no property or deed data. Not applicable.
- Austin permits carry no transfer date. Not applicable (and a permit is not a conveyance).
- County Clerk deed search is account-based or paid per page; out of scope under the PO rule (no records requests).
- Conclusion: the fix is inside data we already hold.

### Exact change

1. `pipeline/oracle-runtime/travis/transforms/tcad-county.ts` (sales_history assembly around lines 300 to 380): build the dated list from `sales[]` plus `deeds[]` filtered to a transfer allow-list (start with WD, SW, QD, GD, ED, TD; confirm each code against the legacy layout PDF/xlsx in `pipeline/data/raw/tcad/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip`, one hour of that estimate), using `deedDt` (fall back to `deedRecordedDt`), ignore dates after `as_of` and before 1900. De-duplicate with a `sales[]` row on the same date. The lexicon carrier already exists: `sales_history.ownership_transfer_date` (ADR 0002 item 9), so no schema request is needed.
2. `pipeline/oracle-runtime/travis/tcad/tenure.ts` `tenureOf`: accept the merged list; add `tenure_basis` value `deed_date` (and keep `sale_date`), keep `unknown` + `no_dated_sale` for the remainder.
3. `pipeline/oracle-runtime/travis/tcad/write-group.ts` and the loader `parcels` columns: carry the new basis. The `parcels_check3` constraint only constrains `unknown`, so no migration is needed beyond the enum text if one exists.
4. `packages/query-core/views.sql` lines 95 to 101 and 233 to 255: the view already reads `sales_history.ownership_transfer_date`, so tenure follows automatically. Only add the new `tenure_basis` label ('deed_date') to `tenure_basis()` and to `contract/v1/columns.json` / `packages/contract/src/columns.ts` (additive enum value, contract v1.1 note).
5. Owner link: ADR 0002 assumes the latest dated sale is the current owner. With deeds, link the owner to the latest transfer deed (buyer-name agreement already 66% in the sample, and the existing linking rule stays unchanged otherwise).
6. Run 3 impact: the `county` group is re-exported, so county CIDs change for rows whose `sales_history` changes. This is expected under Run 3 and the manifest delta must say so.

Effort: 8 to 12 hours (code 4, layout code-table check 1, full-pass validation of rates plus buyer-name agreement over the 30 GB zip about 2 hours of wall time, tests 2, re-export and gate 2). Risk: medium. The allow-list is a judgement call, and a changed county group moves CIDs for hundreds of thousands of rows.

Do not do: infer "no sale since 1988 means long tenure". That is invented data.

---

## GAP 4 Coordinates (51,900 of 441,961 R accounts without latitude/longitude)

### Where the 51,900 come from (local `parcels`, county_emit)

| Bucket | Accounts | Meaning |
| --- | --- | --- |
| `no_gis_feature` | 46,945 | no GIS polygon found for the account; export point is a placeholder |
| `no_permit_point` | 423 | no polygon and linked permits have no point |
| `permit_point` (internal) | 4,532 | has a permit point but `write-group.ts` correctly never writes a permit point as geometry |
| Total without published point | 51,900 | matches the Task B figure |

Published points: 363,675 centroid + 14,055 export point + 9,600 condo building point + 1,814 interior point + 917 largest area = 390,061.

### Why (sample and population)

- Join-key mismatch is NOT the cause. For all 47,368 no-polygon accounts (`no_gis_feature` + `no_permit_point`), only 15 have any GIS feature by geoID and none by pID; the pID/geoID formats join cleanly for the 363k that match.
- The TCAD export `geometry` field is `[null, null]` for these accounts (export_point_kind = placeholder for all 47,368), so there is no export-point fallback either. This is the source: TCAD never gives them a point.
- Population shape: 40,487 (85.5%) are state code A4, 2,163 F4, 3,393 O1 (inventory), i.e. condominium or townhome units; 91% of the 47,368 have a unit in the situs (`street_secondary`), and 47,026 (99.3%) hold a geoID that no other emitted R account shares. They are condo units that the county GIS layer does not give a polygon of their own. The existing `condo_building_point` rule (assemble-coordinates.ts rank 3) only fires when the geoID is shared; here each unit has its own geoID, so it cannot. The geoID-sharing rule was designed for a different pattern.
- Newer accounts are over-represented: by pID block, 700000+ has about 27% missing (11,085 of 40,855), 900000+ 28%, versus about 1 to 7% below 500000. This agrees with the A-01 note that the county GIS layer (`CIPStoryMap/Main_Location_Map2/MapServer/6`, 373,683 features) lags the certified roll.
- Sample of 30 random affected accounts: all 30 are A4/O1/C1 with placeholder export point, none has a polygon by pID or geoID; 29 have a full street number and name (the thirtieth is a street without a number). Example condo-style addresses: "1405 BRIDGEWAY DR 2", "610 DAVIS ST 3104", "4619 KIND WAY 270".
- Not a geometry assembly bug: `geometryFor` in `tcad/write-group.ts` correctly maps `gis_centroid` to a point and `none` to null; the rules table shows no inconsistency (`parcels_coordinate_none_rule` holds).

### Can the 11.7% shrink from data we hold?

- TCAD export lat/long: no, already used and null for these.
- Another polygon layer: the City of Austin ArcGIS copy of TCAD parcels (`EXTERNAL_tcad_parcel` FeatureServer, 386,682 features, edited 2026-10-04) does NOT contain them either: 0 of a 300-account random sample (stratified by md5) found by `PROP_ID`, 0 by `PID_10`. It is the same TCAD source, so no gain. (It is reachable from the operator network, unlike gis.traviscountytx.gov.)
- City of Austin address points (`LOCATION_address_points` FeatureServer, 466,149 points, edited 2026-10-24, public ArcGIS org `services.arcgis.com/0L95CJ0VTaxqcmED`): a plain exact match on street number + full street name found a point for 239 of 300 sampled no-polygon accounts (79.7%), and every match was a single unique point (0 multi-point). Matches fell in Austin, Pflugerville, Manor, Leander, Lakeway, Round Rock-adjacent and other Travis ZIPs (78641, 78645, 78652, 78653, 78660, 78669, 78734 and others).
- Accuracy check on the same rule: for 126 matched accounts that already have a GIS centroid and are condo (A4 with unit) units, the address-point distance to the published centroid was median 24 m, 75th percentile 49 m, 90th percentile 89 m, maximum 216 m. That is a building-level point, comparable to the existing `condo_building_point` precision.
- Projected: about 0.80 x 47,368 = about 37,800 accounts gain a point; coverage of R accounts rises from 88.3% to about 96.9% (residual about 14,000, 3.2%, which includes the no-number addresses, addresses outside the Austin point set, and the 4,532 internal-only permit-point accounts if the PO keeps them off the map). Based on 300 random accounts, so about plus or minus 4 points of margin.
- Conflict with an existing rule: `assemble-coordinates.ts` line 4 says "No address is ever turned into a point" (A-04 design). This proposal is an exact string join to an official address-point dataset, not geocoding, but it is still an address-to-point step, so it needs an explicit PO decision before building. Provenance would be the ArcGIS layer URL, request time and response hash, and the rule name `address_point` (new `coordinate_rule`; public `coordinate_source` should not read `gis_centroid`, so the public geometry file must be stamped with the source URL of the address layer, not the TCAD GIS page).
- The permit points (4,532): keep off the map; Austin permit latitude/longitude is the permit site, usually the parcel. Overlap with the address-point result is likely high, so adding the address-point rule makes the permit-point exception mostly moot.

### Proposed change (do not apply in this branch; another agent owns these files)

1. New pure rank in `pipeline/oracle-runtime/travis/gis/assemble-coordinates.ts` between rank 3 and rank 4: `address_point`. Input: a new Query DB table `address_points(place_id, address_number, full_street_name, lat, lon, source_url, captured_at, sha256)` loaded by a new Loader track from the Austin layer (466,149 points; page at 2,000 per request, same pattern as `travis/gis/runner-fetch.ts`). Match exactly: `address_number = situs.street_number` and `full_street_name = street_number || ' ' || prefix name suffix` uppercased; accept only when exactly one distinct point (7-decimal key) exists, otherwise leave none (never a neighbour's).
2. `pipeline/oracle-runtime/travis/tcad/write-group.ts` `geometryFor`: treat `coordinate.rule = address_point` as publishable and add `geometry_rule: "address_point"` to `GeometryRule`; keep `permit_point` unpublished.
3. `parcels` CHECK constraints (`parcels_coordinate_rule_check`, `parcels_coordinate_source_check`) and migration under `pipeline/local-stack/migrations`: add `address_point` as rule and (recommended) as a new source value; update `contract/v1` `coordinate_*` labels.
4. Optionally also fix the pre-existing gap: add the unit-without-shared-geoID case to the condo rule (match unit situs number/street to the unique building address point) so one rule covers both.

Effort: 16 to 24 hours (table and loader 6, rule and tests 6, constraint and contract label changes 2, Run 3 re-export of `county` geometry files and gate 4, validation sample with a distance audit 2, PO decision write-up 1). Risk: medium to high. Requires a PO decision (rule reversal), adds one more upstream dependency (Austin ArcGIS layer), and changes county CIDs. Quick fallback with no policy change: zero, the 11.7% stays.

Do not do: a free-text geocoder (Census or others) on unmatched addresses; accuracy is unknown and it contradicts the same A-04 rule.

---

## GAP 5 Contractors and permits

### Was it scoped out on purpose, and by whom?

Yes, with a paper trail:
- ADR 0002 (`docs/decisions/0002-lexicon-carriers.md`, verdicts 1, 4, 6): the printed contractor name, the BBB rating and the per-permit contractor state have no lexicon carrier. `property_improvement` has `additionalProperties: false` and no contractor name property. The only company path is `property_improvement_has_contractor`, which AD-06 allows for `resolved` contractors only.
- A-07 (`docs/evidence/A-07.md`, accepted by the PO with "Pass as-is" on the 25-row review): five-state ledger over 22,084 Austin reroof permits: resolved 0, candidate 311, ambiguous 0, conflicting 78, unresolved 21,695. BBB Track B was not built (decision D-2 option a: no new bbb.org request, citing the A-01 403/Cloudflare challenge receipts). The BBB rating carrier extension request is drafted, not filed (D-11).
- A-11 write path (`pipeline/oracle-runtime/travis/permits/write-group.ts` header): contractor identity left at the transform default (no registry wired), no contractor, person or license written; contractor coverage is a run summary rollup only.
- FU-A-01 (`docs/decisions/FU-A-01-contract-address-contractor.md`, PO decision 2026-10-21): publish situs address and contractor name as printed in `contract/v1.1`, and "if ADR-0002 still rules out a lexicon carrier ... record how it is carried instead, for example a published side table with provenance". That follow-up is still open; it is the right vehicle for the BBB link too.

### Registry data we hold

- `comptroller_registry`: 342,333 rows (342,334 in the earlier note; the DB count is one lower), from the data.texas.gov Comptroller dataset `9cir-efmm`, watermark 2026-10-17. Fields: taxpayer number, legal name, SOS status, SOS file number, mailing address. No license numbers, no addresses of work, no phone. Texas has no statewide roofing license (sources yaml `contractor_licensing`), so there is no second authority to cross-check. The Florida skills (Sunbiz, DBPR) do not apply.
- The ledger already runs the conservative rule `normalize-name-v1`. By design (resolver.ts header) a name match alone is at most `candidate`; only an identifier crosswalk match would be `resolved`, and Austin permits print no identifier. So "0 resolved" is the correct and intended answer, not a wiring failure.

### Measured on real Austin roofing permits (Query DB, 16,816 linked roofing/Replacement BP permits)

- Contractor company name printed: 4,648 permits (27.6%), 1,060 distinct names. Person name only: 477 more. No name at all: 11,691 (69.5%). (The Run 2 published set is 15,025 permits; the same ratios give about 4,100 to 4,600 with a company name.)
- Existing ledger states on those 16,816 permits: candidate 125, conflicting 54, resolved 0, unresolved 16,637.
- Independent check, exact match after uppercase, punctuation removal and CO to COMPANY: of 1,060 distinct printed company names, 81 (7.6%) match exactly one registry legal name (0 match two or more); 172 permits (3.7% of permits with a company name, 1.0% of all 16,816). Counting only registry rows whose status is active: 118 permits.
- A looser rule (also drop LLC, INC, CORP, LTD, LP, THE, "&" as space) matches 140 of 1,043 names (13.4%) covering 405 permits (8.7% of named permits), still with 0 ambiguous. This is a useful recall number but a higher false-merge risk (for example "Argosy Roofing" versus "Argosy Roofing LLC" can be two entities), so it should stay `candidate`, never `resolved`.
- Why so low: the Comptroller franchise-tax file lists legal entities with a taxpayer account. A sample of 25 printed names shows sole proprietors ("Manuel Rios", "Barbara Kraemer"), DBA or trade names ("Done Right Roofing", "Reliance roofing", "KIDD ROOFING") and joint entries ("Johnson/Stanczak"). They have no registry legal name to match, which is also why A-07's reviewers recorded DBA-vs-legal-name cases.

Expected resolved rate for Run 3 from reachable data under the repo rule: 0%. Expected candidate rate: about 1% of roofing permits (exact), up to about 2.4% with the looser rule. Nothing reachable (public, no records request, no scraped portal) would raise that, because the missing ingredient is an identifier, not more names.

### Where each piece plugs in

| Item | Where |
| --- | --- |
| State per permit | Ledger `contractor_resolution_current` (Query DB, internal); published view column `contractor_resolution` is the two-state `resolved`/`unresolved` (AD-24); five-state totals go in the manifest `coverage` |
| Candidate counts for Run 3 | Add `contractor_candidate`, `contractor_conflicting` coverage keys in the run summary (`travis/runs/run-month.ts` and `pipeline/publish`), no schema change |
| Printed name | Not publishable until a carrier exists: lexicon request R3 (`contractor_printed_name`) or the FU-A-01 side table |
| Per-permit write path | `pipeline/oracle-runtime/travis/permits/write-group.ts` (currently `NO_REGISTRY`) |
| Views | `packages/query-core/views.sql` lines about 404 and 472 (`miss('bbb_url', 'no_lexicon_carrier')`) and the matching `contract/v1/columns.json`, `packages/contract/src/columns.ts` |

### BBB search link (PO addition)

Facts first:
- `bbb_url` and `bbb_rating` are NOT columns in contract v1. They appear only in each view's `missing` list with reason `no_lexicon_carrier` (`packages/contract/src/columns.ts` lines 730 to 765, `views.sql` lines 404 and 472, `contract/v1/README.md` lines 171 to 176). ADR 0000 listed them for an earlier plan, then 002-data-contract demoted them. So a link needs an additive contract v1.1 column, not just a value in an existing column.
- The raw contractor name has the same status (`contractor_name_raw` is also `no_lexicon_carrier`), so the view has no published name to build a link from. The link must therefore be built where the name is known (the permit write path, from the stored `permit_source_rows.payload.contractor_company_name`) and published through the FU-A-01 side table, not derived inside the view.
- URL shape: A-01's only recorded BBB URL is the category page `https://www.bbb.org/us/tx/austin/category/roofing-contractors` (receipt `docs/evidence/blocked/bbb-20261020T072323Z.md`, HTTP 403, `cf-mitigated: challenge`). The search page shape from BBB's public site is `https://www.bbb.org/search?find_country=USA&find_text=<percent-encoded name>&find_loc=<City>%2C%20TX&find_type=Category`. It was NOT verified from here (no bbb.org fetch is allowed); a human must click one example before it ships. If the shape changes, only the builder function changes.
- A link is not a lookup: building and storing it makes no request to bbb.org.

Recommendation:
1. Build the URL in a pure function in the permits write path (new `pipeline/oracle-runtime/travis/permits/bbb-search-url.ts`, called from `write-group.ts` next to the contractor name), using the printed company name (fall back to the printed person name) and `contractor_city` (fall back to "Austin"), encoded with `encodeURIComponent`. Missing name gives no link.
2. Publish through the FU-A-01 side table (name, link, source permit URL, capture time) in contract v1.1; add `bbb_url` as a nullable VARCHAR (kind `uri`) to `v_roofing_permit` and `v_contractor` in `contract/v1/columns.json` and `packages/contract/src/columns.ts`, and read it in `views.sql`. Do not build it in the view from raw text.
3. Rating and status: `bbb_rating` stays absent from the data (missing). `bbb_status = 'blocked'` (the enum already has it) and `bbb_status_reason = 'bbb_blocked'` (present in the closed list `packages/contract/src/provenance.ts` lines 21 to 22 and labelled "BBB blocked the lookup" in `packages/shared/src/labels.ts` line 30). Do not use `bbb_not_found` (nothing was looked up) and not `contractor_unresolved` (which hides that a link exists). Rows with no printed name keep `bbb_status = 'not_checked'` with `contractor_unresolved`.
4. Display: Task B and the Atlas UI should show a link labelled "Search BBB for this contractor (opens bbb.org)" with helper text "BBB blocks automated lookups, so we do not publish a rating. This is a plain search link; the result is not verified." The `labels.ts` entry already carries the reason text. Never show a rating or "not rated" wording.
5. Rows that get a link: 4,648 of 16,816 BP roofing permits in the Query DB have a printed company name (4,482 with company and contractor city, 5,125 if a person name is accepted as fallback). For the 15,025 published Run 2 permits that is about 4,100 to 4,650 (exact figure from the Run 3 emit set).

Effort for the link: 6 to 10 hours (builder and tests 2, contract v1.1 columns and README 2, side table plus views 3, UI strings 1, gate 1). Risk: medium, mostly because the side-table design and the v1.1 contract change are new and Task B must sync the new manifest. Blocker if rejected: none; the fallback is today's "Contractor not published" with a reason.

### Other jurisdictions' permits (Pflugerville, Manor, Lakeway)

- Query DB: all roofing permits come from the Austin Socrata dataset `3syk-w9eu` (18,704 of 19,031 roofing rows are `AUSTIN FULL PURPOSE`; West Lake Hills 5, Sunset Valley 1). For the three suburbs the Austin dataset holds permits located there (Lakeway 6,827 full purpose + 1,559 ETJ; Pflugerville 1,115 + 592 ETJ) but 0 roofing permits, because they are Austin-issued utility or trade rows, not the cities' own building permits. This is exactly what Task B saw.
- County discovery (`pipeline/docs/travis-sources.yaml`): every other jurisdiction is `records request` / `manual-only` or `blocked` and uses a vendor portal: Manor GovWell, Pflugerville PublicAccess, Lakeway Civic Self Service, Round Rock its own portal, Cedar Park MGO Connect (blocked), Leander Development Hub (blocked), Bee Cave / Elgin / Jonestown / Rollingwood MGO, Lago Vista MGO, Sunset Valley GovBuilt, Travis County MGO/MyPermitNow. None publishes per-permit open data.
- A fresh probe of public catalogs found only aggregates for the three suburbs (Pflugerville "Building Dept Monthly Report" and "Building Permits & Inspections By Month" ArcGIS items; nothing for Manor or Lakeway). Monthly counts are not permit rows and cannot be linked to a property.
- Within the repo rules (no records requests, no CAPTCHA bypass, no account-based portals, BBB 403 stop): not addable in Run 3. Report as blocked, reason "vendor portal needs an account or a records request; no open per-permit feed". Honest next steps are an upstream data-partner decision or a PO-approved records request, both outside the current rules.

### Contractor-related notes from owner data (for the owner-fields agent)

- 502 emitted R accounts have an owner name containing roofing, construction, contractor, remodeling or builder words (trade-named owners). Zero of them have a roofing permit on the same account when the name contains ROOFING/ROOFERS, so no direct owner-is-roofer overlap.
- 20 roofing permits have a printed contractor name identical to the property's owner name after punctuation normalization. This is likely owner-builder or developer-owned lots; do not treat it as contractor identity, and do not publish it as a "contractor is also owner" claim without the permit's owner-builder field.
- Person-named printed contractors ("Manuel Rios") only compare to owner names written in the TCAD "LAST FIRST" order after reordering; the straight comparison found 1 match, so this undercounts.
- No mailing-address field of owners was joined to contractor addresses (the owner mailing address is only partly published). Any such join would be a candidate signal, not identity.

---

## Table

| Gap | Fixable in Run 3? | Change | Owner files | Hours | Risk |
| --- | --- | --- | --- | --- | --- |
| 3 Tenure | Yes | Merge `deeds[]` transfer deeds (WD, SW, QD, GD, ED, TD; confirm codes in layout) into `sales_history.ownership_transfer_date`; new `tenure_basis` value `deed_date`; keep `no_dated_sale` for the rest. Expected NULL 60% down to about 3 to 7%; fixes about 44% of dated accounts that read as long tenure but are not | `travis/transforms/tcad-county.ts`, `travis/tcad/tenure.ts`, `travis/tcad/write-group.ts`, `packages/query-core/views.sql`, `contract/v1/columns.json`, `packages/contract/src/columns.ts` | 8 to 12 | Medium (allow-list judgement; county CIDs change) |
| 4 Coordinates | Partly (needs PO rule change) | Add rank `address_point`: exact street number + name match to City of Austin address points, unique-point only; about 80% of the 47,368 no-polygon accounts, median 24 m from the GIS centroid; coverage 88.3% to about 96.9%. Do not geocode free text. Keep permit points unpublished | `travis/gis/assemble-coordinates.ts`, `travis/gis/` new address-point loader, `travis/tcad/write-group.ts` (`geometryFor`, `GeometryRule`), `pipeline/local-stack/migrations` (rule/source CHECKs), `contract/v1` labels | 16 to 24 | Medium to high (policy reversal, new upstream, county CIDs change) |
| 5a Contractor resolution | No (not to `resolved`) | Name-only match can only be `candidate` by design; measured 1.0% of roofing permits exact, up to 2.4% looser. Add candidate and conflicting counts to manifest coverage only. Fix the "&" normalization gap noted in A-07 | `travis/identity/resolver.ts` (v2 rule, optional), `travis/runs/run-month.ts`, `pipeline/publish` coverage keys | 3 to 5 | Low |
| 5b BBB search link | Yes, with contract v1.1 | Build the search URL in the permits write path; publish via the FU-A-01 side table; add `bbb_url` column; `bbb_status = blocked`, reason `bbb_blocked`; rating stays missing. About 4,100 to 4,650 of 15,025 permits get a link | `travis/permits/write-group.ts` (+ new `bbb-search-url.ts`), `packages/query-core/views.sql`, `packages/contract/src/columns.ts`, `contract/v1/columns.json`, `packages/shared/src/labels.ts` (text only) | 6 to 10 | Medium (new contract version; URL shape unverified until a human clicks one) |
| 5c Permits for Pflugerville, Manor, Lakeway | No | Blocked: vendor portals (GovWell, PublicAccess, Civic Self Service) with accounts or records-first; no open feed found. Report as blocked with that reason | none | 0 | n/a |
| BBB rating | No | Blocked by the 403 challenge; no bypass | none | 0 | n/a |

## Open questions for the PO

1. Gap 4: allow an exact address-to-address-point join against the City of Austin layer, reversing the A-04 rule "no address is ever turned into a point"? (Recommended: yes, with the new `address_point` rule name and the layer URL as provenance.)
2. Gap 3: accept deed dates (transfer-type deeds) as the tenure source, labelled `deed_date`? (Recommended: yes.)
3. Gap 5: approve contract v1.1 with the contractor-name side table and the `bbb_url` column from FU-A-01 as Run 3 scope?
