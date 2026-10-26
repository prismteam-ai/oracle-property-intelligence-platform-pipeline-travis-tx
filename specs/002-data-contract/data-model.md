# Data model: A-02 data contract

The view columns are frozen by mew ([agent-design.md](agent-design.md) mew § B). They are copied here for the plan and are **provisional until the pilot check** (mew § C "Provisional until checked"). Any difference found in the pilot export is recorded in `docs/decisions/0002-lexicon-carriers.md` before `views.sql` is frozen.

## Carrier verdict (`docs/decisions/0002-lexicon-carriers.md`)

| Field | Type | Rule |
|---|---|---|
| `field` | one of the 9 AC-1 fields | exactly one verdict each |
| `verdict` | `carrier` · `no_carrier` · `no_carrier_not_emitted` | `carrier` needs a schema-cache entry **and** a non-null pilot value |
| `class_property` | e.g. `sales_history.ownership_transfer_date` | required when `carrier` |
| `pilot_row` | `{table, cid}` | required when `carrier` |
| `fallback` | `AD-24` · `AD-25` | required when `no_carrier*` |
| `extension_request` | drafted text (mew § A.3) | required when `no_carrier*`; status `drafted` (D-1) |

Expected (mew § A.2): owner sale date → `carrier`; the other 8 → `no_carrier`.

## Provenance (on every view row; `packages/contract/src/provenance.ts`)

`cid` · `source_url` · `captured_at` (from manifest `sources[].captured_at`) · `table` · `table_cid` (part CID) · `run_id` · `manifest_cid` · `as_of` (= manifest `finishedAt`) · `missing: [{field, reason}]`.

**Missing-reason enum (closed list, mew B.7 plus oracle's `zip_not_zcta`, D-4c; additive D-9 members last):** `no_lexicon_carrier`, `not_in_export`, `source_missing`, `no_coordinates`, `no_roof_date`, `basis_unmatched`, `no_dated_sale`, `no_owner_record`, `no_mailing_address`, `zip_not_zcta`, `not_open`, `not_closed`, `contractor_unresolved`, `bbb_blocked`, `bbb_not_found`, `needs_review`, `first_run`, `out_of_scope`, `enum_lacks_value` (the carrier exists but its enum has no value for the source word, e.g. an Expired permit's `improvement_status`), `owner_unparsed`, `owner_confidential`.

## Views

The column lists are mew § B.2 to B.6, with these PO-decided adjustments:

- **`v_roofing_permit.status_class`** ∈ {`open`, `stalled`, `closed`}:
  - `open` = Permitted, Planned or OnHold;
  - `closed` = Completed;
  - `stalled` = `improvement_status IS NULL` and `issue_date` present (D-4a), only for the profile's jurisdictions (`austin`); the generated status map is keyed on (jurisdiction, improvement_status).
  - Null with `missing {status_class, needs_review}` when it cannot be derived (other jurisdiction, unmapped lexicon value such as InProgress, null status without issue date). D-9: never silently empty.
- **`v_roofing_permit`** filters `improvement_type = 'Roofing' AND improvement_action = 'Replacement'`. Trade sub-permits never qualify (D-4b).
- **Profile stamp columns** use mew's names `profile_version`, `profile_sha256` (D-4c).
- **No v1 columns** for `status_raw`, `expiry_date`, `contractor_name_raw`, `bbb_rating`, `bbb_url`, `description` or `work_class_raw`. Each one appears in `missing` with `no_lexicon_carrier`.

| View | One row per | Key | Joins (relationship tables only) |
|---|---|---|---|
| `v_property` | `property` (county export) | `property_cid` | `property_has_address`, `property_has_parcel` → `parcel_has_geometry`, `property_has_structure`, `property_has_sales_history` → `sales_history_has_person/_company` → `*_has_mailing_address` |
| `v_roofing_permit` | `property_improvement` with Roofing + Replacement | `permit_cid` | `property_has_property_improvement` (property from the **county** export), `property_improvement_has_contractor` |
| `v_contractor` | `company` reached by `property_improvement_has_contractor` | `contractor_company_cid` | 0 rows expected in the pilot (no resolved contractor) |
| `v_run` | manifest | `run_id` | `read_json` of the manifest(s) |

## Derivation rules (`packages/query-core/src/derive.ts`; one function each, unit-tested)

| Column | Rule |
|---|---|
| `roof_age_years` | whole years from `structure.roof_date` to `as_of`; a year-only date uses year subtraction; never the stored `structure.roof_age_years` |
| `roof_date` | latest accepted terminal date (`completion_date` / `permit_close_date`, ≤ `as_of`, ≥ issue date) of a closed Roofing permit (Replacement, else New); else `structure.roof_date` (TCAD built year only). Open/stalled replacements never reset it (P0-8). Agrees with the kit estimator ledger (D-9, oracle F1) |
| `roof_age_basis` / `roof_age_confidence` | mew B.5: `permit`/high · `new_construction`/medium · `built_year`/low · `unknown`/none |
| `tenure_years`, `tenure_basis`, `is_long_tenure` | from the max `ownership_transfer_date`; `> 10` years means long; no date → `unknown`, null, reason `no_dated_sale` |
| `owner_area_class` | `in_county` (ZCTA on the Travis list) · `regional` (a regional-county ZCTA) · `out_of_area` · `unknown` (no mailing address, or `zip_not_zcta`) |
| `owner_is_out_of_area` | true for `regional` or `out_of_area`; false for `in_county`; null for `unknown` |
| `coordinate_source` | `gis_centroid` · `permit_point` · `none` |
| `open_days` | `as_of − issue_date` for `open`/`stalled`; otherwise null with reason `not_open` |
| `contractor_resolution` | `resolved` if exactly one `property_improvement_has_contractor` edge exists; several edges → `unresolved` with `needs_review` (no company picked); none → `unresolved`. Five-state totals in the manifest `coverage` (AD-24) |
| `owner_kind` / `owner_name` | latest dated sale (assumed current owner); `company` when any company, else `person`, else `unknown`; names persons then companies, each once. Missing: `no_dated_sale`, else `owner_unparsed` / `owner_confidential` / `no_owner_record` from the coverage counts (`needs_review` when ambiguous) |
| `bbb_status` | `not_checked` in v1; reason `contractor_unresolved` or `no_lexicon_carrier` |

## Roofing and status profile (`profiles/travis-austin@1.0.0/rules.json`)

`roofing.include[]` · `roofing.exclude[] {id, field, pattern}` · `trade_permit` (BP only) · `needs_review` rules · `status_map {open[], stalled[], closed[], exclude[] (Cancelled* prefix)}` · `published_encoding {class → improvement_status}` · `sample_population`. Precedence: exclude > trade_permit > include. Unknown status word → `needs_review` (never emitted). Digest: SHA-256 of the canonical form.

`expectations.json` (outside the digest): `measured_at`, `dataset_rows`, `include_matches`, `excluded {by id}`, `trade_permits`, `needs_review`, `candidates`, `rules_sha256`, `query_urls`.

## Gazetteer entry (`packages/query-core/gazetteer/travis-places@1.0.0`)

`lookup(q)` returns either `{status:'found', kind:'place'|'zcta', geoid|zcta, name, point:{lat,lon}, partial_in_travis, source:{url, file_date, sha256}, gazetteer:{version, sha256}}` or `{status:'out_of_scope', query}`.

## RunManifestV1 additions (additive, frozen now)

- `sources[].captured_at` (mew M5).
- `profiles[] {name, version, sha256, path, gitCommit}` (oracle § C; D-4c).
- `limitations[]` gets the line "pilot: local, unpublished; CIDs are real content addresses of local files, replaced in A-03".

## Pilot manifest

A `RunManifestV1` for `travis-pilot-20261020`, FIPS 48453, `previousManifestCid: null`. Its `artifacts[]` holds 2 `car`, n `table` parts and 2 `directory` entries (with `carCid`). The CID is computed per research R-06.
