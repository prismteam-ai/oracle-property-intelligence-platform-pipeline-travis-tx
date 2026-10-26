---
id: FND-A-01
parent: A-01
type: county-findings
county: Travis
state: TX
fips: "48453"
created: 2026-10-20
source_catalog: pipeline/docs/travis-sources.yaml
kit_skill: county-discovery (soofi-xyz-team-kit 0.99.1)
---

# Travis County, TX: county-discovery findings

Findings profile from the A-01 live discovery runs (run `travis` on 2026-10-19 and run `travis-2`, completed 2026-10-20T05:43:09Z) and the offline TCAD rescan of 2026-10-20. Every number below is taken from `pipeline/docs/travis-sources.yaml`, where each one carries its source URL and UTC capture time; `docs/sources.md` renders them. This file names fields, types and counts only. It holds no owner names, addresses or other record values (Texas Tax Code § 25.025).

## Appraiser portal

- **Office:** Travis Central Appraisal District (TCAD), public-information page `https://traviscad.org/publicinformation`.
- **Data offered:** downloadable exports only. No property search was scraped. The page links the "2026 Certified Appraisal Export (July)" (legacy fixed-width layout), the "2026 Certified Special Export (JSON) (July)", the "Export Layouts" ZIP, two 2026 supplemental exports, and the Certified Totals Reports.
- **Anti-bot posture:** none seen. The landing page, the layouts file and the 3.55 GB export answered HTTP 200 to the identified project User-Agent with no challenge or rate limit. The export is served through Cloudflare (`cf-cache-status: HIT`) and advertises `Accept-Ranges: bytes`.
- **Certification date:** the public-information page (captured 2026-10-20T06:19:52Z, one identified request) says only "(July)" beside the 2026 certified exports and gives no certification date. The catalog records `parcel.certification_date` as missing with that reason. The date in the export file name is not used (PO decision 2026-10-20).

## Parcel identifier

- **Key as printed:** `pID` (top-level integer on every record of the 2026 JSON export).
- **Layout name:** `prop_id` ("Property ID", File #2 Property of the Legacy 8.0.33 Appraisal Export Layout). The catalog records both: `identifier_name: pID`, `identifier_layout_name: prop_id`.
- **Uniqueness proof:** {{ID_PROOF}}
- **Other key candidate:** the geographic id is printed as `propertyIdentification[].geoID` (a one-element array per record; layout name `geo_id`, "Geographic ID"). {{GEO_PROOF}}
- The layout's programmer note says prop ids have been unique since 2005 (one record per property and owner in the legacy property file). The JSON export nests owners in an array, so a `pID` is one record.

## Permit portals

There is no countywide permit system. The catalog classifies 23 jurisdictions: 22 Census-listed incorporated places with land in Travis County plus Travis County unincorporated. Census 2020 place-by-county file, `census_reference.place_count: 22`.

| Group | Jurisdictions | Systems seen |
| --- | --- | --- |
| Open data, bulk API | Austin | Socrata `3syk-w9eu` (Issued Construction Permits). Measured as its own source. The jurisdiction's evidence page failed at the live run (network error), so the row stays `records request` until a person reviews it. |
| Account-based application portals (`manual-only`) | Travis County unincorporated, Elgin, Jonestown, Lago Vista, Lakeway, Manor, Pflugerville, Round Rock | MyGovernmentOnline (MGO) / MyPermitNow, Civic Self Service, GovWell, PublicAccess, Round Rock Permit Portal |
| Evidence page unreachable or 404 (`blocked`) | Bee Cave, Cedar Park, Creedmoor, Leander, Rollingwood, San Leanna, Sunset Valley | MGO, MGO Connect, Development Hub, GovBuilt; evidence in `docs/evidence/blocked/jurisdiction-*.md` |
| No online system; custodian only | Briarcliff, Mustang Ridge, Point Venture, The Hills, Volente, Webberville, West Lake Hills | none |

Every non-Austin jurisdiction is `records request` with a complete request route (recipient office, scope, route). None is assumed to have unified countywide history (`assumes_unified_countywide_history: false`). Austin-issued permits located in other jurisdictions are counted per jurisdiction, from the Austin dataset's `jurisdiction` column.

## Bulk sources

| Source | Kind | Size / count (catalog) | Rate | Decision |
| --- | --- | --- | --- | --- |
| TCAD 2026 Certified Special Export (JSON) | one ZIP, one JSON entry (`Travis-protaxExport-20260719.json`, about 29.9 GB uncompressed) | 3,554,021,795 bytes; 493,246 accounts | 328.2 MB/min (10.8 min, 1 Range resume) | bulk download (A-04) |
| TCAD supplemental exports | 2 ZIPs listed, not downloaded | n/a | n/a | bulk download, incremental feed (A-12) |
| Austin issued permits, Socrata `3syk-w9eu` | paged API | 2,380,725 rows; 63,019 with null `tcad_id` | median 120,043 rows/min, no app token | ingest; full backfill projected 0.33 h |
| Texas Comptroller franchise-tax holders, Socrata `9cir-efmm` | paged API | 342,334 Travis-coded (county code 227); 3,487,662 statewide | median 327,439 rows/min | ingest; projected 0.02 h |
| TCAD GIS parcels (ArcGIS MapServer layer 6) | count-only probe | not counted: network error before any HTTP response on every attempt | n/a | ingest (coordinates in A-05) |
| Overture places | bulk files | not measured (optional; licence gate in A-09) | n/a | bulk download |

## Use codes

Code fields are named here. Their values and frequencies are not tabulated in A-01; A-04 profiles them.

- JSON special export: `propType` (top level); `propertyCharacteristics[].useCd`; `propertyProfile[].stateCd`, `imprvStateCd`, `landStateCd`, `bppStateCd`, `mineralStateCd` (Texas PTD state codes); `propertyProfile[].imprvType`, `imprvClass`, `landClass`; improvement `stateCd`, `imprvType` and `class` under `valuations[].details`.
- Legacy fixed-width layout: `prop_type_cd`, `state_cd`, `ptd_state_cd` (+ `ptd_state_cd_description`), `imprv_state_cd`, `land_state_cd`, `imprv_type_cd`.

## Additional sources

- **Deed and sale dates:** present in the JSON export (`deeds[].deedDt`, `sales[].saleDt`; catalog `deed_or_sale_dates_present: true`). The legacy layout has `deed_dt`, `deed_book_id`, `deed_book_page` and `deed_num`.
- **TCAD-held permits:** the JSON export has a `permits[]` array per property (issuer, permit type, number, issue and completion dates, builder). It is a cross-check lead for A-06 only. Municipal permit systems stay the source of record.
- **Geometry:** the JSON export has a top-level `geometry` field (string). It is a lead for A-05 while the county GIS service is unreachable. It is not measured here and it does not replace GIS in the parcel gate.
- **Contractor identity:** Texas has no statewide roofing licence (TDLR licensing programs page and HB 3344 bill history, both HTTP 200). Contractor identity comes from the Comptroller records (A-07).
- **BBB:** a challenge-protected listing (HTTP 403, `cf-mitigated: challenge`). The next step is the official BBB API (developer.bbb.org), or a bounded `bbb-harvest` that stops on 403 (A-08). The challenge is never solved.

## Export layouts

TCAD publishes two layouts of the same certified roll:

1. **Special Export (JSON):** "2026 Certified Special Export (JSON) (July)". One nested record per property (`pID`), with arrays `propertyIdentification`, `propertyCharacteristics`, `propertyProfile`, `situses`, `deeds`, `sales`, `owners`, `taxingunits`, `valuations`, `permits` and others. This is the file A-01 downloaded and measured.
2. **Legacy fixed-width layout:** "2026 Certified Appraisal Export (July)", described by the "Export Layouts" download (`Legacy8.0.33-AppraisalExportLayout`, PDF and XLSX). Its record files are numbered #1 to #20 (`APPRAISAL_INFO.TXT` property, `APPRAISAL_IMPROVEMENT_INFO.TXT`, `APPRAISAL_LAND_DETAIL.TXT`, ...), keyed by `prop_id`. It was not downloaded in A-01.

Fields present in only one layout (by name):

- The legacy layout has explicit confidentiality flags (`py_confidential_flag`, `appr_confidential_flag`, `jan1_confidential_flag` and their `*_confidential_name` fields). The first JSON record's field list shows no owner-level confidentiality flag; it has `sales[].confidentialSale` and `owners[].agents[].authorityConfidential`. Whether a confidentiality marker exists anywhere in the JSON export is unverified (only one record's field names were listed).
- The JSON export has `permits[]`, `geometry`, `sales[]` and `inspections[]`, which the legacy property file does not have in this form.

**A-04 uses the 2026 Certified Special Export (JSON)** because it is already downloaded with a matching SHA-256 receipt, its `pID` key is proven present and unique on every record, and it carries deed and sale dates. Before `validate`, A-04 must run a full field scan of the JSON for confidentiality markers. If there are none, A-04 applies § 25.025 suppression from the legacy layout's `*_confidential_flag` fields, joined on `prop_id` = `pID`, or stops for a records request.

## Feasibility

- **Bulk ingest is feasible for the property backbone.** One certified export holds the whole roll: 10.8 min download, offline streaming scan, bounded memory.
- **Austin permits and the Comptroller are feasible as API ingest,** well within 48 h: projected 0.33 h and 0.02 h at the medians above, without an app token.
- **Permits outside Austin are not feasible as bulk ingest.** Every other jurisdiction needs a records request or a manual portal. Runtime retrieval is the decision for the jurisdiction group.
- **Parcel gate:** PASS on the certified roll. The GIS gap is `unknown` because GIS was not reached, and GIS is never substituted for the roll.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| County GIS service unreachable (network error, no HTTP response) on every attempt in both runs | No GIS-vs-roll gap; no coordinates for A-05 from this endpoint | Blocked evidence kept; recheck from a different network only with a human decision (no identity change); `geometry` in the JSON export is a lead |
| No certification date on the TCAD page | `parcel.certification_date` missing (TC-009 step 4) | Recorded with the reason; a PO decision is needed on another official source (for example the 2026 Certified Totals Report) |
| JSON export may lack owner confidentiality flags (§ 25.025) | Confidential owners could be exposed downstream | A-04 field scan; legacy-layout flags or a records request before `validate` |
| 7 jurisdiction evidence pages unreachable or 404 | Classification rests on profile notes, not live pages | `records request` with complete routes; recheck in A-06 |
| BBB challenge (Cloudflare) | No BBB ratings by scraping | Official API application; bounded harvest stops on 403 |
| Large TCAD download over an unstable link (one drop at 1.29 GB in run 2) | Partial file | HTTP Range resume (at most 5) under the same identity; final size must equal the advertised length |
| Source counts drift daily | Recounts differ from the catalog | Capture-bounded recounts (`:created_at <= captured_at`) in the acceptance suite |
