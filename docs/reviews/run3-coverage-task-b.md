# Run 3 coverage review: what Run 2 lets the Roofing CRM (Task B) do

Date: 2026-10-25. Read-only review, no source edited. Subject: published Run 2 (manifest
`bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute`, runId `travis-full-run2-20261024`,
as_of `2026-10-24T18:20:49Z`) against the Task B README (`../roofing-crm/README.md`).

## How the numbers were produced

- All 225 table parts of the Run 2 manifest exist locally under `pipeline/data/runs/*` and their sha256
  all equal the manifest values (225 OK, 0 differ, 0 missing). The local export is therefore identical to the
  published parts.
- The two views Task B syncs (`v_property`, `v_roofing_permit`) were produced with the repo's own
  `bindManifest()` and `packages/query-core/views.sql` over those parts (in-memory DuckDB, outputs written
  only to the session scratchpad). Row counts: `v_property` 441,961; `v_roofing_permit` 15,025.
- Radius counts use the haversine distance on `v_property.latitude/longitude`, 5 miles, permits joined by
  `property_cid`. Centres: downtown Austin (30.2672, -97.7431) and the Census place centroids in
  `packages/query-core/gazetteer/travis-places@1.0.0/places.json`.
- The Austin source was also read live (public Socrata `3syk-w9eu`, GET only) to check what the
  published rows leave out. BBB was never contacted.
- Working tree note: other agents were editing `packages/query-core` while I ran. Between two binds the
  only difference in `v_property` was the `missing` reason of `owner_area_class` / `owner_is_out_of_area`
  (418,410 rows, `not_in_export` vs `no_owner_record`); every value column was identical. Two binds in a
  row on the same code were bit-identical for both views (EXCEPT = 0 both ways).

## 1. Run 2 facts that drive everything (verified)

| Fact | Value |
| --- | --- |
| Properties (`v_property`) | 441,961 (R accounts only; distinct `property_cid`, `request_identifier`, `parcel_identifier` all 441,961) |
| With coordinates | 390,061 (88.26%); without 51,900 (11.74%). 44,833 of the gap are `Townhouse` (82.0% of all Townhouse), 4,188 `Building`, 1,860 `LandParcel`, 679 `VacantLand`, 277 `MultipleFamily`. Already a PO exception (DEC-A-04-coverage-exception: condo-coded accounts have no GIS polygon). SingleFamily: 49 of 290,604 lack a point |
| Roof age known | 9,510 (2.15%), all `roof_age_basis = permit`, confidence high. `structure.roof_date` is NULL on all 441,961 structure rows (confirmed) |
| Roof age >= 15 y / >= 30 y | 8,227 / 7,585 (only 642 are 15-29 y) |
| Built year present | 389,404 (88.1%). Properties with built year at least 15 y before as_of (the fallback Run 3 is adding): 282,766 |
| Tenure known / NULL | 175,408 (39.7%) / 266,553 (60.3%) |
| Owner name present | 23,556 (5.3%): 22,741 company owners, 815 person owners (Texas confidentiality rule, fails closed) |
| `owner_area_class` known | 0 (always `unknown`). The export has the owner mailing edges (815 person + 22,736 company) but the `address` table has only `cid, property_cid, data_group_cid, request_identifier`: no ZIP, so the in-progress fix cannot work until address text is exported (see P0-4) |
| Roofing permits | 15,025 (all `jurisdiction = austin`, `Roofing` / `Replacement`), on 10,792 properties; 15,002 of them sit on a property with coordinates (23 do not) |
| Contractor / BBB | 0 contractor edges, 0 `company` rows (`contractor_resolution = unresolved` 15,025); `bbb_status = not_checked`, reason `contractor_unresolved`; `contractor_name_raw`, `bbb_rating`, `bbb_url` are listed in `missing` as `no_lexicon_carrier` |
| Manifest parcel count | absent (`coverage.parcels_published` not present; `permits_emitted` = 15,025 is present) |
| Property `source_url` | one URL for all 441,961 rows (the TCAD bulk zip), one `captured_at`. Permit `source_url`: 15,025 distinct per-permit Socrata GET URLs |

## 2. "Open roofing permit" among the 15,025

`status_class` comes from the profile status map; `improvement_status` is NULL for stalled (the lexicon enum has no
`Expired`).

| status_class | improvement_status | permits | open_days set | > 5 y | > 10 y | > 15 y |
| --- | --- | --- | --- | --- | --- | --- |
| open | Permitted 77, Planned 2, OnHold 1 | 80 | 80 | 3 | 3 | 3 |
| stalled | NULL (source "Expired") | 1,674 | 1,674 | 1,500 | 1,308 | 1,109 |
| closed | Completed | 13,271 | 0 | - | - | - |
| open + stalled | | 1,754 on 1,463 properties | 1,754 | 1,503 | 1,311 | 1,112 |

Issue years of the 1,754: 685 were issued from 2010 on; 1,069 earlier. The permit set itself is heavily 1980s
(8,137 of 15,025 issued 1980-1989), which matches the live Austin source (about 10,000 of the 19,049 re-roof BP rows
are pre-1990); modern re-roofs are rarely permitted in Austin, so permit-derived roof age is thin after 1995.

### Does the permit row show "open duration" correctly?

- Arithmetic: yes. `open_days` equals as_of date minus `issue_date` on all 1,754 open/stalled rows (0 mismatches);
  `issue_date` is present on 15,025 of 15,025. It is measured at the manifest as_of (2026-10-24), not today, and the
  permit capture was 2026-10-21. The UI should show "N days at 2026-10-24" or add `now - as_of`, or recompute from
  `issue_date`.
- Meaning: NOT reliable for 952 of the 1,674 stalled permits and 7 of the 80 open ones. They carry a
  `completion_date` (published as `final_date`), so the work was finished and the status "Expired" is an
  administrative lapse. Checked live: permit `1984-025453 BP` has `status_current = Expired`, `expiresdate =
  2007-08-29`, `completed_date = 1985-03-11`; Run 2 reports it stalled with `open_days = 15,382`. 941 of the 952 have a
  completion date within one year of issue. All 3 of the "open > 5 y" permits also have a completion date.
- Honest long-open counts (open or stalled, no `final_date`): > 5 y = 548 (all stalled; 434 issued 2010 or later,
  114 earlier); > 10 y = 356 (all stalled); open with no completion date older than 5 y = 0.
- Smaller defects: 4 open/stalled rows have `final_date` before `issue_date`; `expiresdate` and the raw status are not
  carried (`status_raw`, `expiry_date` = `no_lexicon_carrier`), so "expired on" cannot be shown.

## 3. Sample: 5-mile radius (verified)

Roof >= 15 y here uses Run 2's permit-basis `roof_age_years`. "Built-year proxy" is `property_structure_built_year <= 2011`
(what the in-progress built-year fallback would qualify, low confidence). "Open/stalled >= 5 y (clean)" excludes
permits that have a `final_date`.

| Centre | Props with coords | Roof >= 15 y (Run 2) | Built-year proxy >= 15 y | Roofing permits | Open | Stalled | Open or stalled >= 5 y | ...clean (no final_date) | Props with clean long-open | Props roof >= 15 y AND open/stalled permit | Contractor name | BBB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Downtown Austin | 72,341 | 5,229 | 59,555 | 8,429 | 19 | 968 | 865 | 294 | 228 | 110 | 0 | 0 |
| Austin (Census centroid) | 78,233 | 6,024 | 65,510 | 9,560 | 31 | 943 | 854 | 298 | 237 | 109 | 0 | 0 |
| Pflugerville | 47,282 | 0 | 27,455 | 50 | 0 | 5 | 4 | 4 | 4 | 0 | 0 | 0 |
| Manor | 26,983 | 2 | 6,370 | 3 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| Lakeway | 28,361 | 1 | 14,899 | 6 | 0 | 4 | 4 | 2 | 2 | 0 | 0 | 0 |
| Round Rock | 10,129 | 0 | 7,844 | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Bee Cave | 21,814 | 2 | 11,857 | 7 | 0 | 4 | 4 | 2 | 2 | 0 | 0 | 0 |
| Manchaca | 34,669 | 193 | 26,989 | 433 | 12 | 66 | 59 | 15 | 12 | 2 | 0 | 0 |

"Open >= 5 y" counting only `status_class = open` (not stalled): downtown 2, every other centre 0 (and the downtown 2 both
have a completion date).

Reading: downtown is rich; outside Austin the permits are almost absent (not because the roofs are newer but because the only
permit source is the City of Austin: all 15,025 rows are `austin`, and the live Austin dataset lists 11,800 of ~12,000
re-roof rows (description "REROOF") as "AUSTIN FULL PURPOSE", with only a handful of ETJ / Lago Vista / Round Rock rows). A rep centred on
Pflugerville, Manor or Lakeway gets roof-age leads only, and those need the built-year fallback to appear at all
(0 / 2 / 1 with Run 2 vs 27,455 / 6,370 / 14,899 proxy).

## 4. README item by item

Legend: yes / partial / no = supported by Run 2 data. "Feasible" = reachable public data and PO rules (no official
records requests, no API applications, BBB 403 = stop, no CAPTCHA bypass, no invented data).

| # | README item | Supported | Columns used | Real result (Run 2) | Gap | Smallest Run 3 fix | Feasible under PO rules |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Default map on a county | yes | `v_run.county_fips` (48453), `latitude`, `longitude` | Points span lat 29.833-30.629, lon -98.178 to -97.372 | None | None | yes |
| 2 | Centre on GPS or pin | partial | `latitude`, `longitude`, `coordinate_source` | 390,061 of 441,961 mappable (88.26%) | 51,900 invisible; 86% of them Townhouse/condo units (PO exception) | Publish permit-derived points already held in the Query DB (+4,532 R accounts, DEC-A-04) and label `permit_point`; low value for roofing, 6 h. Otherwise Task B shows "N properties have no coordinates" | yes for the +4,532 (own data); no further source |
| 3 | Configurable radius | yes | same | Table in section 3 | None | None | yes |
| 4 | Roofs older than N years (default 15) | partial | `roof_age_years`, `roof_age_basis`, `roof_age_confidence`, `roof_date`, `property_structure_built_year` | 8,227 properties county-wide (1.9%); downtown 5,229; Pflugerville 0. With built-year fallback: 282,766 county-wide, downtown 59,555, Pflugerville 27,455 | `structure.roof_date` NULL everywhere; permit-derived age exists only where a closed re-roof permit exists | Fallback in progress (basis `built_year`, confidence low). Task B must show basis and confidence, and the default filter should not mix high and low silently. Verify after publish: `roof_age_basis` shows `built_year` for about 389k rows | yes (TCAD built year already in the roll) |
| 5 | Open roofing permits, emphasis on long-open | partial | `status_class`, `is_open`, `open_days`, `issue_date`, `final_date` | 80 open + 1,674 stalled; 1,503 older than 5 y but only 548 have no completion date (356 older than 10 y). Downtown clean long-open 294 permits on 228 properties | `open_days` is wrong for permits that carry `final_date` (952 stalled, 7 open); "open" is almost all "Expired" | Task B: treat `status_class in (open, stalled) AND final_date IS NULL` as long-open and show the rest as "expired after completion" (1-2 h, no Task A change). Task A v1.1: do not set `open_days` when `final_date` is present, or add an `open_basis` column (3 h). Say in the UI that stalled = expired, not an active job | yes |
| 6a | Permit status | partial | `improvement_status`, `status_class` | stalled rows have NULL `improvement_status`; raw "Expired" and the expiry date are not published | `status_raw`, `expiry_date` = `no_lexicon_carrier` | Task B shows `status_class` text ("Expired / stalled"). Optional side field `status_raw` and `expiresdate` (4 h, same side table as 6c) | yes (public Austin source holds both) |
| 6b | Age / open duration | yes (with the caveat in 5) | `open_days`, `issue_date`, `as_of` | Correct vs issue date on 1,754 of 1,754 | Measured at as_of, not today | Task B adds `now - as_of`, or recomputes from `issue_date` | yes |
| 6c | Contractor name | no | `contractor_company_cid`, `contractor_resolution`; `contractor_name_raw` is in `missing` | 0 of 15,025; `v_contractor` has no rows | Transform publishes 9 permit fields and drops the printed contractor; Comptroller registry baseline not loaded | Emit `contractor_name_raw` (as printed) plus contractor city and phone-free provenance, from the saved captures, no new crawl (about 12 h with 6d). The live source prints a contractor company on about 93% of permits issued from 2010 (4,040 of 4,333 re-roof BP rows, live count over all statuses) and on 2 of 12,818 issued before 2000. For our set: 3,593 permits issued 2010+, 434 of the clean long-open ones, so expect names on most of the best leads and almost none on 1980s rows. A Comptroller match (data.texas.gov `9cir-efmm`, reachable) is only a candidate, never legal identity | yes (public Austin data). Policy conflict for the PO: FU-A-01 (2026-10-21) allows the printed name as a side field; the Oracle rule "do not persist a contractor copied from the permit" says otherwise for company/person/license records. Publish as "as printed, unverified", not as a `company` |
| 6d | BBB rating | no | `bbb_status`, `bbb_status_reason`; `bbb_rating`, `bbb_url` in `missing` | 0 | No carrier (ADR-0002, lexicon request R5); BBB blocked | PO decision: `bbb_url` = plain search URL from contractor name + city (never fetched), `bbb_rating` NULL with an explicit reason (about 3 h on top of 6c; needs a reason Task B's vendored `MISSING_REASONS` accepts, so check `no_lexicon_carrier` vs a new `source_blocked` first). URL pattern I would use, unverified: `https://www.bbb.org/search?find_country=USA&find_text=<name>&find_loc=<city>%2C%20TX` (city = printed contractor city, else "Austin, TX") | yes (no BBB request is made) |
| 7 | Browsable lead-candidate list | yes (derived by Task B) | all of the above | Downtown: 110 properties have roof >= 15 y AND an open/stalled permit; 228 have a clean long-open permit | Count is Austin-only; list of 110 uses permit-basis ages only | None beyond 4, 5 | yes |
| 8 | Create and manage leads from properties and permits | yes (CRM-owned) | `property_cid`, `request_identifier`, `permit_cid`, `permit_number`, `source_url`, `captured_at`, `manifest_cid`, `run_id`, `table_cid`, `cid` | Identity table in section 5 | `v_roofing_permit` has no `request_identifier` column (it equals `permit_number` on 15,025 of 15,025); property `source_url` is the shared TCAD zip, not a record link | Add `request_identifier` to `v_roofing_permit` (1 h). Key leads on `fips:tcad:request_identifier` (already Task B's rule) and permits on `jurisdiction + permit_number` | yes |
| 9 | RAG agent, e.g. "open roofing permits older than five years within five miles of [city]" | partial | `latitude`, `longitude`, `status_class`, `open_days`, `issue_date`, `final_date`, `roof_age_years/basis/confidence`, `property_type`, `property_usage_type`, `contractor_*`, plus a place gazetteer | "Open > 5 y within 5 mi": Downtown 865 as published (294 clean), Pflugerville 4 (all stalled), Manor 1, Lakeway 4 (2 clean) | City names resolve only through the Census gazetteer centroid (31 places); `city_name`, `postal_code`, address text are `not_in_export`, so "in Pflugerville" (city limits) cannot be answered, only "near" | Glossary for the agent: open = open or stalled, long-open needs `final_date IS NULL`. Address/city export (P0-4) for "in city" questions | yes |
| 10 | Filters: roof age, permit status / open duration, radius | yes | as 4, 5 | n/a | as 4, 5 | none | yes |
| 11 | Disabled placeholder sections | yes | none | n/a | none | none | yes |

## 5. Identity stability across runs (verified except where marked)

| Check | Result |
| --- | --- |
| Run 1 vs Run 2 property rows | 441,961 of 441,961: same `property_cid`, same `request_identifier`, same latitude/longitude. The county batches were reused unchanged |
| Run 1 vs Run 2 roofing permits (raw `property_improvement` tables) | The 15,025 Run 2 permits are all in Run 1 with the same `cid` and `request_identifier` (= `permit_number`) |
| Run 1 `v_roofing_permit` | 0 rows: its permit edges pointed at property CIDs that were not county properties (the defect Run 2 fixed). Run 1 also held 2,362 trade sub-permits (940 Electrical, 615 MechanicalHVAC, 807 Plumbing) that Run 2 dropped. So no Task B lead could have been created from a Run 1 permit through the views. Run 1's own manifest says "DRAFT ... not uploaded" |
| Row sets deterministic | `v_property` and `v_roofing_permit`: two binds of Run 2 identical. `v_contractor` (empty) and `v_run`: not tested. Pilot manifest `bafkreiasycms...` vs Run 2: not compared (the pilot artifact paths do not resolve locally) |
| Permit keys | `permit_number` unique 15,025; `permit_cid` unique 15,025; one `(property, permit)` edge per permit |
| Property keys | `request_identifier` = `parcel_identifier` = TCAD account id, unique 441,961 |

Rule that keeps Task B leads alive in Run 3: `property_cid` and `permit_cid` are content hashes. They stayed equal Run 1 to Run 2
only because the records were reused. Any Run 3 change to the content of `property.json` (adding area, units, subdivision,
zoning) re-hashes all 441,961 property CIDs; additions in separate classes (`address`, `structure.roof_date`, a contractor side
table) do not. Task B already keys leads on `request_identifier`, so a re-hash is survivable, but keep the Run 3 change in
separate classes where possible and add a gate: every Run 2 `property_cid` / `permit_cid` must exist in Run 3, or Run 3 ships a
`old_cid -> new_cid` map.

## 6. Fields Task B would need that no run carries yet

Verified empty in the Run 2 export: `property.total_area`, `livable_floor_area`, `area_under_air`, `number_of_units`, `subdivision`,
`zoning`, `ownership_estate_type`, `structure_form`, `property_effective_built_year`, `hoa_cid` (all 0 of 441,961);
`structure.roof_date`, `roof_material_type`, `roof_condition`, `number_of_stories` (all 0); `sales_history.purchase_price_amount` (0 of 266,317);
`property_improvement.fee`, `contractor_type`, `application_received_date`, `is_owner_builder`, `permit_required` (all 0 of 15,025);
`geometry.polygon` (0 of 390,061, so no parcel acreage can be derived from the published tables).

| Needed by Task B | State | Fix and feasibility |
| --- | --- | --- |
| Situs address, city, ZIP | In the CAR address records (`unnormalized_address`, 400 of 400 sampled; 373 carry "TX #####") but not in the tables: `export-tables` does not emit properties of the `address` oneOf class (ADR-0002, request R7) | Needs a PO choice: CLI change (ask the CLI team), or a published side table with provenance (FU-A-01 allows it; the oracle rule "tables only from export-tables" has to be waived). 12-16 h. Public data, feasible |
| Owner name for outreach | 815 persons + 22,741 companies only; Task B itself forbids `ownerName` (ADR-03) | Companies usable as "owner is an LLC / company". No fix; person owners are mostly confidential/unparsed |
| Owner mailing address | Edges exist (815 + 22,736), address text not exported | Same fix as situs address (+4 h); also the only way `owner_area_class` can ever become known |
| Parcel acreage / square footage | Fields exist in the lexicon, empty in the export. Whether the TCAD roll carries them: not verified | Verify against the TCAD JSON, then emit (6-8 h); this edits `property.json` and re-hashes property CIDs (see section 5) |
| Last sale date | Partly: 175,408 properties have `last_ownership_transfer_date`; no price (Texas non-disclosure) | Nothing more reachable without clerk-record requests (not allowed) |
| Contractor name, city, trade; BBB URL | Not published | Item 6c/6d |
| Permit description / work class / valuation / expiry date / human-readable permit page | Dropped by the transform (live source has `description`, `total_valuation_remodel`, `expiresdate`, `link`) | Side-table fields, 2-4 h each once the side table exists |
| Parcel count in manifest | Absent | Add `coverage.parcels_published` = 441,961 (1 h) |
| Permits outside Austin | None | A catalog search of Socrata (api.us.socrata.com) found no open-data permit feed for Pflugerville, Manor, Lakeway, Cedar Park or Travis County; portal scraping per city is unverified and may meet CAPTCHA (stop rule). Not a Run 3 item; show "no permit source for this jurisdiction" |

## 7. Prioritised punch list for Run 3 (hours are my estimates, not measured)

| Pri | Item | Why Task B needs it | Hours | Depends on |
| --- | --- | --- | --- | --- |
| P0-1 | Roof-age built-year fallback published (in progress elsewhere): QA that Run 3 shows about 389k `roof_age_basis = built_year`, confidence low, and Run 2's 9,510 permit-basis rows unchanged | Without it only 1.9% of properties qualify and Pflugerville/Manor/Lakeway return nothing | 2 (QA only) | owner of the fix |
| P0-2 | Contractor name as printed + contractor city (+ `status_raw`, `expiresdate`, `description`) from the saved Austin captures, as a provenance-stamped side table or carrier; republish the 5 permit CARs; `v_roofing_permit.contractor_name_raw` | README item 6 "contractor name"; 0 of 15,025 today | 12 | PO decision on the printed-name policy conflict (1 h) |
| P0-3 | `bbb_url` search link per contractor (name + city), `bbb_rating` NULL with explicit reason | README "BBB where available", PO decision | 3 | P0-2 |
| P0-4 | Situs address, city, ZIP (and owner mailing ZIP, which also unblocks `owner_area_class`) in the published tables | Lead list rows need an address; agent "in city"; owner area filter | 12-16 | PO choice between CLI change and side table |
| P0-5 | Long-open correctness: Task B filter on `final_date IS NULL` now; Task A v1.1 does not compute `open_days` when `final_date` is set (or adds `open_basis`) | 952 + 7 permits would be false "long-open" leads (65% of the 1,503 older than 5 y) | 1 (Task B) + 3 (Task A) | none |
| P0-6 | Identity gate: every Run 2 `property_cid` / `permit_cid` present in Run 3 (else `old -> new` map); add `request_identifier` to `v_roofing_permit` | Leads must keep identity when Run 3 replaces Run 2 | 4 | Run 3 export |
| P1-1 | `coverage.parcels_published` = 441,961 in the manifest | Task B's reconcile check today reads "not_published_by_task_a" | 1 | none |
| P1-2 | Publish permit-derived coordinates as `permit_point` (+4,532 accounts) | Marginal map coverage | 6 | contract v1.1 |
| P1-3 | Acreage / living area / units from the TCAD roll, if the roll carries them | Roof size and lead value ranking | 6-8 (+ verify 2) | property CID re-hash decision |
| P2 | Other jurisdictions' permits | Non-Austin demo centres | not estimated (unverified feasibility) | per-city discovery |

Total P0 about 37-41 h, P1 about 15-19 h.

## 8. Not verified

- Live gateway read of the parts: I used the local export, whose 225 table sha256 equal the manifest. CloudFront / Filebase availability not re-tested.
- BBB search URL format (no request is allowed or made); BBB coverage of any contractor.
- Whether TCAD's roll carries acreage, living area and value fields (not inspected).
- Pilot-manifest vs Run 2 identity; `v_contractor` / `v_run` determinism.
- Contractor-name coverage of exactly our 15,025 permits (I measured the live source for all re-roof BP rows, not the Run 2 subset).
- Feasibility of any permit portal other than the City of Austin dataset.
- Why Austin's pre-1995 re-roof volume is so high (source property; the extraction matches the live per-year shape).
