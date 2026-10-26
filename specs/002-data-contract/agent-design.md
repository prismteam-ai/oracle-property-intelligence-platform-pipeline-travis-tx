# A-02 agent design (constitution XIV)

Read-only design consults, saved word for word. Both agents got the walkthrough's Stage 3 brief, plus their own questions. Consulted 2026-10-20, branch `002-data-contract`.

---

## mew

# A-02 agent design: mew (lexicon carriers and the `contract/v1` column list)

**Consult:** mew, read-only, 2026-10-20, branch `002-data-contract`. **Skills loaded:** `use-neutral-lexicon` (run by the PO) and `apply-engineering-guidelines`.
**Inputs read:** `specs/002-data-contract/spec.md` (with its Clarifications), `stories/A-02-data-contract.md`, `docs/architecture-constitution.md` (AD-05 to AD-08, AD-24 to AD-26, § 5, § 6, § 12), `.specify/memory/constitution.md`, ADR-0000 (my earlier § 2.3 and § 2.4, R1 to R9).

## 0. Where each name comes from

| Source | Status on 2026-10-20 | What it gave |
|---|---|---|
| **Live kit lexicon tools** (`listPropertiesByClassName("property_improvement")`, `listClassesByDataGroup("Property Improvement")`, `getPropertySchema("property_improvement","improvement_status")`) | **Failed.** All three returned "Internal error". | Nothing |
| **Live legacy tools** (the same three calls, plus `getPropertySchema("fact_sheet", …)`) | **Failed.** All returned "Internal error". | Nothing |
| **Bundled neutral-lexicon reference** (class/relationship catalog with data groups, the paradigm that matches Elephant) | **Worked.** `jq` is not installed, so I ran the skill's own recipes in Node with the same rules (select, project, limit, never a whole file). | Class properties, enums and data-group relationship lists, as cited below as **[B]** |
| **Installed CLI** `~/.local/share/elephant-cli-main/node_modules/@elephant-xyz/cli` (v1.58.1, from commit 44bb182) | **Worked, but it ships no class schemas.** `validate` and `export-tables` fetch them from the Elephant Network into `~/.elephant-cli/schema-cache/`, and that folder does not exist yet. | The table and column layout rules (`dist/services/tables-export.service.js`) and the data-group builders (`dist/commands/transform/*-datagroup.js`), cited below as **[CLI]** |

**What follows from this.** No name below is confirmed live. The pilot's first `validate` run fills `~/.elephant-cli/schema-cache/` with the **live** schemas. Re-check every verdict against that cache and against the pilot Parquet files before G5 (§ C). None of the names below comes from memory.

---

## A. Carrier verdicts

### A.1 What the lexicon has for the permit (`property_improvement`) [B]

- **Data group:** Property Improvement (no required relationships).
- **Properties:** `permit_number` (string|null), `permit_issue_date`, `application_received_date`, `completion_date`, `final_inspection_date` and `permit_close_date` (all string|null, `date`), `fee` (decimal, currency), `permit_required` (boolean), `is_owner_builder`, `is_disaster_recovery`, `private_provider_inspections` and `private_provider_plan_review` (all boolean|null).
- **Enums:**
  - `improvement_status`: Cancelled, Completed, InProgress, OnHold, Permitted, Planned. **There is no Expired.**
  - `improvement_action`: Addition, Alteration, New, Other, Remove, Repair, Replacement.
  - `improvement_type`: includes `Roofing`.
  - `contractor_type`: Builder, DIY, GeneralContractor, HandymanService, PropertyManager, Specialist, Unknown. This is a category, not a name.
- **Missing entirely:** expiry date, raw status text, description, work-class text and contractor name.
- **Relationships in the group:** `property_has_property_improvement`, `parcel_has_property_improvement`, `property_improvement_has_contractor` (→ `company`), `company_has_communication`, `contractor_has_person`, `property_improvement_has_{layout,structure,utility,inspection,file,address}`, `inspection_has_{company,person,file}`.
  - The CLI's Property Improvement builder [CLI] **does not recognise `property_improvement_has_address`**, and it has no `*_has_fact_sheet` link.
  - `property_improvement_has_fact_sheet` appears only in the bundled **County** group [B].
- **`company`** [B]: `name` and `sunbiz_document_number` only. There is no Texas identifier (this confirms R3 and AD-06).
- **`fact_sheet` and BBB** [B]:
  - The class exists but has **no properties at all**.
  - `company_has_fact_sheet` exists only in the **County** and **Property Management** groups, not in Property Improvement.
  - The CLI's county builder [CLI] assembles no fact-sheet relationships.
  - A catalog-wide search found nothing for "rating", "reputation", "bbb", "accredit", "printed", "raw" or "contractor_name". The only "expiration" fields belong to other meanings (`license.license_expiration_date`, `contract.expiration_date`, `insurance.policy_expiration_date`). **Do not borrow them.**
  - **Verdict: no `fact_sheet` carrier exists for BBB.**

### A.2 The nine AC-1 fields

| # | Field | Verdict | Carrier: class.property, data group, type, enum [source] | Fallback |
|---|---|---|---|---|
| 1 | Printed contractor name | **No carrier** | None. `company.name` is reachable only through `property_improvement_has_contractor`, which AD-06 allows only for `resolved`. `contractor_type` is a category. [B] | AD-25: not published; the reason is `no_lexicon_carrier` ("not published · no lexicon carrier") |
| 2 | `status_raw` | **No carrier** | None. `improvement_status` is a closed six-value enum with no Expired. [B] | AD-25, plus the open decision in A.4 |
| 3 | `expiry_date` | **No carrier** | None on `property_improvement`. The kit keeps `expiration_date` only in the private permit record (`use-oracle/runtime/src/permits/contracts.mjs`, `private-db-load.mjs`). [B, kit code] | AD-25 |
| 4 | BBB rating | **No carrier** | `fact_sheet` has no properties, and no rating or reputation class exists. [B] | AD-25: `bbb_status = not_checked`, `bbb_status_reason = no_lexicon_carrier` |
| 5 | BBB profile URL | **No carrier** | The same as #4. `file.original_url` (uri) exists, but a file is a document, not a rating source. Do not use it. [B] | AD-25 |
| 6 | Per-permit contractor state (candidate, ambiguous, conflicting) | **No carrier** | None. [B] | AD-24: per row `contractor_resolution` ∈ {`resolved`, `unresolved`}; the five-state totals come from the manifest `coverage` |
| 7 | `roof_age_basis` | **No carrier** | None on `structure`. The inputs exist: `structure.roof_date` (string|null, pattern `^\d{4}(-MM(-DD)?)?$`) and `structure.roof_age_years` (integer|null, minimum 1). County group, through `property_has_structure`. [B] | AD-25: derived in the view (§ B.5) |
| 8 | `roof_age_confidence` | **No carrier** | The same as #7. | AD-25: derived in the view |
| 9 | Owner sale date | **Carrier (provisional; pilot row pending)** | `sales_history.ownership_transfer_date`, County group, string|null, format `date`, no enum, through `property_has_sales_history`. The owner is linked by `sales_history_has_person` / `sales_history_has_company`. The CLI county builder recognises the `property_sales` files. [B, CLI] | If it is absent in the pilot: `tenure_basis = unknown`, reason `no_dated_sale` |

**Also checked (not among the nine; needed for v_roofing_permit):**

- **Carriers (provisional):** `permit_number`, `permit_issue_date`, `completion_date`, `permit_close_date`, `final_inspection_date`, `improvement_status`, `improvement_type` and `improvement_action` [B].
- **No carrier:** work-class text and description. The views expose only the profile's outcome (`improvement_type` and `improvement_action`).
- **Not carried per row:** the profile version and SHA-256 come from the manifest (AD-26).
- **Not carried per row:** jurisdiction. It is derived from the host in `source_http_request` through a versioned jurisdiction map in the profile.

**Every verdict needs two confirmations at the pilot.** A "carrier" verdict becomes final only when (a) the property is in the cached live schema and (b) it appears as a column with a non-null value in a pilot row. FR-001 asks for the row's `cid` and table. Any "carrier" missing from the export becomes **"no carrier (not emitted by the export)"**.

### A.3 Draft lexicon extension requests (drafted only, not filed; PO decision D-1)

1. **`property_improvement.permit_status_text`**: string|null, no enum.
   - *What it holds:* the issuing authority's status word, verbatim (for example "Expired" or "Pending Permit").
   - *Why:* `improvement_status` is a normalised six-value enum with no expiry state. Without the source word, the view cannot tell a lapsed permit from an active one without inventing a value. A verbatim field keeps normalisation in versioned profiles and makes it auditable. It works for any permit authority in any county.
2. **`property_improvement.permit_expiration_date`**: string|null, format `date`.
   - *What it holds:* the date the permit lapses or lapsed if no final inspection happens.
   - *Why:* it sits alongside `permit_issue_date` and `permit_close_date`. Expiry is a standard fact of permit lifecycles across US jurisdictions, and it is the evidence behind the `stalled` signal.
   - *Alternative, if a new field is refused:* add `Expired` to the `improvement_status` enum.
3. **`property_improvement.contractor_printed_name`**: string|null.
   - *What it holds:* the contractor name exactly as it appears on the permit record.
   - *Why:* a permit authority's printed name is evidence, not identity. Many authorities, Texas among them, print names without registry identifiers. So `property_improvement_has_contractor` cannot be asserted, and today the listed contractor cannot be published at all. A plain-text field states the source's claim without creating a `company`.
4. **`property_improvement.contractor_identity_status`**: string|null, enum `Resolved`, `Candidate`, `Ambiguous`, `Conflicting`, `Unresolved`.
   - *What it holds:* how far the contractor's identity was resolved against an official registry.
   - *Why:* consumers need to tell "nearly sure" from "no idea" per permit. Today only the presence or absence of `property_improvement_has_contractor` can be read, so four states collapse into one.
   - *Depends on:* oracle and the PO confirming that per-permit publication is acceptable under AD-04. That is why it stays draft.
5. **New class `business_rating`**, linked by `company_has_business_rating` (Property Improvement and County groups).
   - *Properties:* `rating_source` (enum `BBB`, extendable), `rating_grade` (enum `A+`, `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `C-`, `D+`, `D`, `D-`, `F`, `NR`), `profile_url` (uri), `is_accredited` (boolean|null), `observed_date` (date).
   - *Why:* third-party business ratings are a reusable fact about any company in any industry. `fact_sheet` carries no fields, so a rating cannot be published today.
   - *Note:* the grade members are those BBB publishes; confirm them against a captured BBB page before filing.
6. **`structure.roof_date_basis`** (enum `Permit`, `NewConstruction`, `BuiltYear`, `Unknown`) **and `structure.roof_date_confidence`** (enum `High`, `Medium`, `Low`, `None`).
   - *Why:* a `roof_date` without its evidence basis cannot be weighed by consumers. Today the basis has to be re-derived in each reader.
   - *Priority:* low. AD-25's view derivation already covers it.

### A.4 Open decision (material; for the PO with oracle)

**Expired has no lawful published home.** The profile must turn the raw status into a real `improvement_status` member, and no member truthfully means "expired".

- Mapping it to Completed or Cancelled is forbidden (AD-08).
- Mapping it to Permitted would show stalled permits as open.
- Leaving it null and treating null as "stalled" is a hidden convention, and P0-11 forbids those.

**My recommendation:**

- Publish Expired and Expired - License with `improvement_status = null`.
- In the view, show `status_class = null` with the reason `no_lexicon_carrier` (field `status_raw`).
- Keep `stalled` in the frozen `status_class` enum, so the column's meaning never changes when request 1 or 2 lands. That later change is additive, not `v2`.

**The consequence:** AC-4's "Expired is `stalled`" and AC-8's "at least one stalled reroof" **cannot be met from published data** unless the PO files request 1 or 2 and the lexicon accepts it before the pilot. The PO must choose before G5: file the request now (revisiting D-1), or amend AC-4 and AC-8 to "stalled where carried, otherwise the reason is shown". The stalled count can still appear in the manifest `coverage` as a count (AD-04).

---

## B. AD-07 column list for the four views

**Rules for every view:**

- **`as_of`** = manifest `finishedAt` (TIMESTAMPTZ), never `now()`.
- **Types are DuckDB types.** Lexicon dates arrive as STRING [CLI `kind()`], and the views apply `TRY_CAST(... AS DATE)`. `roof_date` stays VARCHAR because it can be a partial date.
- **A no-carrier field gets no column in v1.** Adding a column later is additive. Each row's `missing` array (§ B.6) names it, so nothing is blank.

### B.1 Provenance columns (on every row of every view)

| Column | Type | Meaning and derivation | Missing reason |
|---|---|---|---|
| `cid` | VARCHAR | The record's CID (an export extra column) | Never null |
| `source_url` | VARCHAR | Built from the record's `source_http_request` (a JSON string: method, URL, query) | `not_in_export` |
| `captured_at` | TIMESTAMPTZ | The capture time of that source, taken from the manifest `sources[].captured_at`. There is no per-row carrier, so this is an additive `RunManifestV1` field to add now. | Never null in v1 |
| `table` | VARCHAR | The export table name the row's main record came from (for example `property_improvement`). It must be quoted in SQL. | Never null |
| `table_cid` | VARCHAR | The CIDv1 of the Parquet part that holds the row. The file name is mapped to the part CID listed in the `tables.car` `CountyTables` block, and from there in manifest `artifacts[]`. | Never null |
| `run_id` | VARCHAR | Manifest `runId` (`travis-pilot-20261020` for the pilot) | Never null |
| `manifest_cid` | VARCHAR | The manifest's CIDv1 (computed locally for the pilot) | Never null |
| `as_of` | TIMESTAMPTZ | Manifest `finishedAt` | Never null |
| `missing` | LIST(STRUCT(field VARCHAR, reason VARCHAR)) | One entry for every null or uncarried field in the row | Empty list |

### B.2 `v_property` (one row per `property`, from the county export)

| Column | Type | Source class.property or derivation | Missing reason |
|---|---|---|---|
| `property_cid` | VARCHAR | `property.property_cid` (export extra); must equal `property.cid` (test it) | Never null |
| `request_identifier` | VARCHAR | `property.request_identifier`: the TCAD identifier exactly as printed (P0-5) | Never null |
| `parcel_identifier` | VARCHAR | `property.parcel_identifier` | `source_missing` |
| `property_type` | VARCHAR | `property.property_type` (lexicon enum) | `source_missing` |
| `property_usage_type` | VARCHAR | `property.property_usage_type` (lexicon enum) | `source_missing` |
| `property_structure_built_year` | INTEGER | `property.property_structure_built_year` | `source_missing` |
| `unnormalized_address` | VARCHAR | `address.unnormalized_address`, through `property_has_address` | `source_missing` |
| `city_name`, `postal_code` | VARCHAR | `address.*`, through `property_has_address` | `source_missing` |
| `latitude`, `longitude` | DOUBLE | `geometry.latitude/longitude` through `property_has_parcel` → `parcel_has_geometry`; otherwise `address.latitude/longitude` of the permit address | `no_coordinates` |
| `coordinate_source` | VARCHAR | Enum `gis_centroid` (geometry), `permit_point` (permit address), `none` | `none` + `no_coordinates` |
| `roof_date` | VARCHAR | `structure.roof_date`, through `property_has_structure` (written by the kit estimator only) | `no_roof_date` |
| `roof_age_years` | INTEGER | Derived: whole years from `roof_date` to `as_of`; a year-only date uses year subtraction; 0 is allowed. **Never the stored `structure.roof_age_years`** (which has minimum 1). | `no_roof_date` |
| `roof_age_basis` | VARCHAR | Enum `permit`, `new_construction`, `built_year`, `unknown` (§ B.5) | `unknown` + `no_roof_date` or `basis_unmatched` |
| `roof_age_confidence` | VARCHAR | Enum `high`, `medium`, `low`, `none` (§ B.5) | `none` |
| `last_ownership_transfer_date` | DATE | Max `sales_history.ownership_transfer_date`, through `property_has_sales_history` (replaces the earlier draft name `last_sale_date`) | `no_dated_sale` |
| `tenure_years` | INTEGER | Derived: whole calendar years from `last_ownership_transfer_date` to `as_of` | `no_dated_sale` |
| `tenure_basis` | VARCHAR | Enum `sale_date`, `unknown` | `unknown` + `no_dated_sale` |
| `is_long_tenure` | BOOLEAN | `tenure_years > 10`; null when the basis is unknown (never "long tenure" without a date) | `no_dated_sale` |
| `owner_kind` | VARCHAR | Enum `person`, `company`, `unknown`, from `sales_history_has_person` / `_company` on the latest sale | `no_owner_record` |
| `owner_name` | VARCHAR | Derived for display: `person.first_name` + `last_name`, or `company.name` | `no_owner_record` |
| `owner_mailing_postal_code`, `owner_mailing_state_code` | VARCHAR | `address.postal_code` and `address.state_code`, through `person_has_mailing_address` / `company_has_mailing_address` | `no_mailing_address` |
| `owner_area_class` | VARCHAR | Enum `in_county`, `regional`, `out_of_area`, `unknown`. The mailing postal code is checked against the versioned Travis ZIP list and regional-county list (AD-26). | `unknown` + `no_mailing_address` |
| `owner_is_out_of_area` | BOOLEAN | True for `regional` or `out_of_area` ("not on the Travis list", FR-002); false for `in_county`; null for `unknown` | `no_mailing_address` |
| `area_list_sha256` | VARCHAR | The digest of the ZIP and regional lists, from the manifest | Never null |
| + provenance (B.1) | | | |

**Never use the deprecated `person_has_property` / `company_has_property`.** They are still listed in the bundled County group [B].

### B.3 `v_roofing_permit` (one row per `property_improvement` with `improvement_type = 'Roofing'` and `improvement_action = 'Replacement'`; enum equality only, no LIKE; `Cancelled` rows are left out)

| Column | Type | Source or derivation | Missing reason |
|---|---|---|---|
| `permit_cid` | VARCHAR | `property_improvement.cid` | Never null |
| `property_cid` | VARCHAR | `from_cid` of `property_has_property_improvement`; must equal the export extra `property_cid` (test it) | Never null (unmatched permits are not published) |
| `jurisdiction` | VARCHAR | Derived from the `source_http_request` host through the profile's jurisdiction map (`austin`) | `needs_review` |
| `permit_number` | VARCHAR | `property_improvement.permit_number` | `source_missing` |
| `improvement_type`, `improvement_action` | VARCHAR | The lexicon enums, set only by the profile | Never null in this view |
| `improvement_status` | VARCHAR | Lexicon enum (Permitted, InProgress, OnHold, Planned, Completed) | `no_lexicon_carrier` (Expired; see A.4) |
| `status_class` | VARCHAR | Enum `open`, `stalled`, `closed`. Derived: Permitted, InProgress, OnHold or Planned → `open`; Completed → `closed`; `stalled` only once a status or expiry carrier exists | `no_lexicon_carrier` |
| `is_open` | BOOLEAN | `status_class = 'open'` | Null when `status_class` is null |
| `issue_date` | DATE | Alias of `property_improvement.permit_issue_date` (an AD-07 frozen alias) | `source_missing` |
| `final_date` | DATE | Alias of `property_improvement.completion_date` (an AD-07 frozen alias; confirm oracle's Austin adapter fills this field, § C) | `not_closed` / `source_missing` |
| `permit_close_date`, `final_inspection_date` | DATE | The lexicon properties as they are | `source_missing` |
| `open_days` | INTEGER | `as_of − issue_date` when `status_class ∈ {open, stalled}`, otherwise null | `not_open` |
| `contractor_resolution` | VARCHAR | Enum `resolved` (a `property_improvement_has_contractor` edge exists), `unresolved` | Never null |
| `contractor_company_cid` | VARCHAR | `to_cid` of `property_improvement_has_contractor` | `contractor_unresolved` |
| `bbb_status` | VARCHAR | Enum `rated`, `not_found`, `blocked`, `not_checked`; always `not_checked` in v1 | Never null |
| `bbb_status_reason` | VARCHAR | `contractor_unresolved` if unresolved, otherwise `no_lexicon_carrier` | Null only when `bbb_status = rated` |
| `profile_version`, `profile_sha256` | VARCHAR | `travis-austin@semver` and its digest, from the manifest (AD-26) | Never null |
| + provenance (B.1) | | | |

**Not columns in v1** (they appear in `missing` instead): `status_raw`, `expiry_date`, `contractor_name_raw`, `bbb_rating`, `bbb_url`, `description` and `work_class_raw`, all with reason `no_lexicon_carrier`.

### B.4 `v_contractor` (one row per `company` reached through `property_improvement_has_contractor`, so resolved companies only; expect 0 to few rows, R4)

| Column | Type | Source or derivation | Missing reason |
|---|---|---|---|
| `contractor_company_cid` | VARCHAR | `company.cid` | Never null |
| `name` | VARCHAR | `company.name` | `source_missing` |
| `contractor_resolution` | VARCHAR | Always `resolved` | Never null |
| `identity_source` | VARCHAR | Derived from the `company.source_http_request` host (`comptroller`) | `needs_review` |
| `bbb_status`, `bbb_status_reason` | VARCHAR | As in B.3 | As in B.3 |
| `permit_count` | INTEGER | Count of `property_improvement_has_contractor` rows for the company | 0, never null |
| `roofing_permit_count` | INTEGER | The same count, limited to `v_roofing_permit` | 0 |
| + provenance (B.1) | | | |

Unresolved printed names get **no rows**, because there is no carrier. The UI shows the manifest's five-state totals instead (AD-24).

### B.5 Roof basis and confidence (AD-25; no regex)

| Basis | Confidence | Rule |
|---|---|---|
| `permit` | `high` | `roof_date` equals, at its own precision, the `completion_date` or `permit_close_date` of a linked permit with `improvement_type = Roofing` and `improvement_action = Replacement` (linked through `property_has_property_improvement`) |
| `new_construction` | `medium` | The same match with `improvement_action = New` |
| `built_year` | `low` | `roof_date` is a four-digit year equal to `property_structure_built_year` |
| `unknown` | `none` | Anything else, or `roof_date` is null |

An open replacement permit never changes `roof_date` (P0-8). The view only reads it.

### B.6 `v_run` (one row per manifest, through `read_json` of the manifest and `runs/index.json`; outside the lexicon)

| Column | Type | Source |
|---|---|---|
| `run_id` | VARCHAR | `runId` |
| `county_fips` | VARCHAR | Manifest FIPS (`48453`) |
| `started_at`, `finished_at` | TIMESTAMPTZ | `startedAt`, `finishedAt` (`finished_at` = `as_of`) |
| `manifest_cid` | VARCHAR | The CIDv1 of the manifest |
| `previous_manifest_cid` | VARCHAR | `previousManifestCid`; missing reason `first_run` |
| `tables_root_cids` | LIST(STRUCT(data_group, cid)) | The `export-tables` roots, from `artifacts[]` |
| `sources` | LIST(STRUCT(name, watermark, captured_at, records, added, changed, removed, limitations)) | `sources[]` |
| `coverage` | JSON | `coverage`: the five contractor-state totals, `parcel_match` totals, the needs_review count and the redacted count (AD-04) |
| `profile_version`, `profile_sha256`, `area_list_sha256` | VARCHAR | The profile section |

### B.7 Values for the Provenance `missing.reason` enum

`no_lexicon_carrier` · `not_in_export` · `source_missing` · `no_coordinates` · `no_roof_date` · `basis_unmatched` · `no_dated_sale` · `no_owner_record` · `no_mailing_address` · `not_open` · `not_closed` · `contractor_unresolved` · `bbb_blocked` · `bbb_not_found` · `needs_review` · `first_run` · `out_of_scope` (gazetteer only).

Closed list: adding a member is additive. Renaming one or changing what it means needs `contract/v2`.

---

## C. How the names must appear in code

**Patterns that must be visible:**

1. **Lexicon fields keep their exact lexicon names** (`permit_number`, `improvement_status`, `parcel_identifier`, `ownership_transfer_date` tails, and so on).
2. **The only aliases** are the AD-07 frozen ones (`issue_date`, `final_date`). Each one is declared once in a single `ALIASES` map with its source property, and a test asserts the map.
3. **Role-prefixed names** use `role_` + the exact lexicon tail (`owner_mailing_postal_code`, `last_ownership_transfer_date`).
4. **Every derived column** has one derivation function in `query-core`, unit-tested, and named in the README.
5. **CID columns** end in `_cid` and hold CIDv1 strings only: `cid`, `property_cid`, `permit_cid`, `contractor_company_cid`, `table_cid`, `manifest_cid`, `previous_manifest_cid`. No gateway URLs.
6. **Joins go only through the relationship tables** (`from_cid` / `to_cid`). There are no copied foreign IDs.
7. **One column list** (`contract/v1/columns.ts`) produces the Zod row schemas, the README table and the view-shape test.
8. **No `LIKE`, `ILIKE`, `regexp_*` or `ROOF` literal** in `views.sql`. The test greps for them.
9. **`v_roofing_permit` filters by enum equality only.**

**Export layout facts [CLI]:**

- There is one table per class, named after the class schema `title` in snake case, and one table per relationship key.
- Entity tables have the class schema properties plus `cid`, `property_cid`, `data_group_cid` and `request_identifier`.
- Relationship tables have `relationship_cid`, `from_cid`, `to_cid`, `property_cid` and `data_group_cid`.
- The `properties` table has `property_cid` plus **one column per data-group schema CID** (not per label).
- Nested values are JSON strings. Integer → INT64, number → DOUBLE, boolean → BOOLEAN, and everything else (dates included) → STRING.
- An entity is written **only if it sits at the end of a relationship**.
- The `tables-export.json` summary lists **row and part counts only, with no columns**.

**Provisional until checked against the pilot:**

1. **The cached live schemas** (`~/.elephant-cli/schema-cache/*`) for `property_improvement`, `structure`, `sales_history`, `company`, `fact_sheet`, `address` and `geometry`.
   - Re-run every A.2 verdict against them.
   - Check whether `source_http_request` is a schema property, which is what `source_url` depends on.
2. **Table names in each export** (`county`: `property`, `address`, `parcel`, `geometry`, `structure`, `sales_history`, `person`, `company`, `property_has_*`, `sales_history_has_*`, `*_has_mailing_address`; `property_improvement`: `property_improvement`, `property_has_property_improvement`, `property_improvement_has_contractor`).
   - Read them from the summary `tables` keys.
3. **Column names and types.** The summary does not have them, so confirm them with `DESCRIBE SELECT * FROM read_parquet(part)` for each table.
4. **Both exports emit their own `property` table**, because the property is the `from` end of `property_has_property_improvement`.
   - The views must read each data group's export under its own path and dedupe by `cid`.
   - They must never read a table without its group.
5. **Whether `property_improvement_has_address` and any `*_has_fact_sheet` exist** in the live group schema and the export (they decide `permit_point` and any future BBB carrier).
6. **Which permit date field oracle's Austin adapter fills** for "final" (`completion_date` or `permit_close_date`). This decides `final_date`.
7. **Whether `property.cid` equals `property_cid`.**
8. **The table-part CIDs in `tables.car`**, cross-checked with `ipfs add --cid-version 1 --raw-leaves` (the `table_cid` rule).

---

## D. Risks and how to verify

| ID | Risk | Severity | Mitigation | Verification (test) |
|---|---|---|---|---|
| M1 | Expired has no carrier (A.4), so the `stalled` signal, AC-4 and the AC-8 sample cannot be met | **High (blocks G5)** | PO decision: file request 1 or 2, or amend AC-4 and AC-8 | Carrier-record test: `status_raw` = no carrier with a drafted request; view test: an Expired pilot row has `status_class` null and `missing` contains `status_raw/no_lexicon_carrier`; never Completed or Cancelled |
| M2 | Live lexicon still down, so verdicts rest on bundled precedent | High | Use the pilot's schema cache as the live check before freezing | Script lists the properties of each cached class schema and diffs them with the A.2 table; it fails on any change |
| M3 | Printed contractor name and BBB are unpublishable, so D-9 and D-11 show reasons only | High (accepted by AD-24 and AD-25) | Reasons + manifest five-state totals | Every v_roofing_permit row has `bbb_status = not_checked` with a reason; `contractor_company_cid` is non-null if and only if `contractor_resolution = resolved` |
| M4 | Duplicate `property` tables across the two exports | Medium | Paths per group; dedupe by `cid` | View test: count of `v_property` = count of distinct `cid` in the county `property` table |
| M5 | `captured_at` and `table_cid` have no per-row source | Medium | Additive `RunManifestV1.sources[].captured_at`; map part file → CID | Zod refinement + sample test: 0 nulls across 6 provenance columns × 20 rows; `table_cid` matches a recomputed raw-leaves CID |
| M6 | `source_http_request` not emitted, leaving `source_url` with no carrier | Medium | Confirm in the cache; otherwise use the manifest per-source URL with reason `not_in_export` | DESCRIBE test on the pilot tables |
| M7 | `permit_point` coordinates impossible if `property_improvement_has_address` is not emitted | Low | `coordinate_source = none` + reason | Enum test; share of rows with coordinates per reason |
| M8 | `table` is a SQL reserved word | Low | Always quoted; frozen by FR-008 | The view compiles in DuckDB node and WASM |
| M9 | Stored `structure.roof_age_years` confused with the derived one | Low | The view never selects the stored field | Grep test: `structure.roof_age_years` is not referenced in `views.sql` |

**Further tests:**

- **Exact column lists.** `DESCRIBE` each view and compare it with `contract/v1/columns.ts` (exact names, order and types). Zod row schemas parse 100% of pilot rows.
- **Roof-age derivation.** Table-driven cases for each basis row in B.5, plus 25 properties against the estimator output (25/25).
- **Tenure.** A missing date gives `tenure_basis = unknown` and `is_long_tenure` null; an 11-year date gives true.
- **Area class.** In-county, regional, out-of-area and missing ZIP cases.
- **Open days.** `open_days` is null with reason `not_open` for closed permits; always ≥ 0.
- **No blanks.** For every row and every nullable column, the value is non-null or `missing` contains that field (SC-007).
- **No text matching.** Grep `views.sql` for `LIKE|ILIKE|regexp|ROOF` and expect 0 hits.

**Relevant files:**

- `/Users/hebagaber/.claude/plugins/cache/soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-neutral-lexicon/reference/query-examples.md`
- `/Users/hebagaber/.local/share/elephant-cli-main/node_modules/@elephant-xyz/cli/dist/services/tables-export.service.js`
- `/Users/hebagaber/.local/share/elephant-cli-main/node_modules/@elephant-xyz/cli/dist/commands/transform/property-improvement-datagroup.js`
- `/Users/hebagaber/.local/share/elephant-cli-main/node_modules/@elephant-xyz/cli/dist/commands/transform/county-datagroup.js`
- `/Users/hebagaber/.claude/plugins/cache/soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-oracle/runtime/src/permits/contracts.mjs`
- `~/.elephant-cli/schema-cache/` (created by the pilot's first `validate`; the live-schema check)

---

## oracle

# A-02 design consult: oracle (read-only)

**Story:** A-02 Freeze the property-intelligence data contract · **Branch:** `002-data-contract` · **Consulted:** 2026-10-20 · **Agent:** `oracle` (design, read-only)

**Inputs read:** spec.md with its Clarifications, the story, the ARD (AD-01/07/08/24/25/26, § 5–§ 9, § 12), `reference/A-oracle.md` § 5, `pipeline/docs/travis-sources.yaml`, `docs/evidence/A-01.md`, `pipeline/oracle-runtime`, and kit 0.99.1 `use-oracle`, `build-county-transform`, `car-publication.md` and `runtime/src/roof-age`.

**Live checks (read-only):**
- `elephant-cli` 1.58.1 (GitHub main 44bb182) `--help` and its `dist/` source.
- `https://lexicon.elephant.xyz/api/manifest` (HTTP 200), with class schemas fetched from `ipfs.filebase.io`.
- Small SoQL counts on Austin `3syk-w9eu`.
- The first 150 MB of the TCAD JSON entry, streamed.

Nothing was written, uploaded or ingested.

---

## 0. Facts found today that change the design

| # | Fact (evidence) | Consequence |
|---|---|---|
| F1 | The live `property_improvement` class has `additionalProperties: false`. Its only fields are `application_received_date, completion_date, contractor_type, fee, final_inspection_date, improvement_action, improvement_status, improvement_type, is_disaster_recovery, is_owner_builder, permit_close_date, permit_issue_date, permit_number, permit_required, private_provider_*, request_identifier, source_http_request`. There is **no `description`, no `work_class`, no `status_raw`, no `expiry_date`** and no `source_payload`. | Classification **cannot** be computed at query time from the published description, because the description is not publishable. See § D. |
| F2 | `improvement_status` ∈ {Completed, InProgress, Planned, Permitted, OnHold, Cancelled, null}. There is no Expired. `improvement_type` includes `Roofing` and `Solar`. `improvement_action` includes `Replacement`. | The classification is published only as lexicon enum values. Expired cannot be written as an enum value (AD-08, P0-9). |
| F3 | `company` = {name, request_identifier, source_http_request, sunbiz_document_number}. `fact_sheet` = {full_generation_command, ipfs_url}. | There is no lexicon home for a BBB rating or URL, or for a printed contractor name on a non-resolved permit. These are likely "no carrier" for mew's AC-1. |
| F4 | `sales_history.ownership_transfer_date` (County group, `property_has_sales_history`). `structure.roof_date` (pattern `YYYY[-MM[-DD]]`). `property.property_structure_built_year`. | Owner sale date, roof date and built year do have carriers. `roof_age_basis` and `roof_age_confidence` have none, so they are derived in the view (AD-25). |
| F5 | Data-group schema CIDs in today's manifest: Seed `bafkreibhurphpj…`, County `bafkreia6tjziby…`, Property Improvement `bafkreicyzywzwh…`. The PI group's relationships include `property_has_property_improvement` and `property_improvement_has_contractor`. | Root files are named from the live manifest at run time, never hardcoded. |
| F6 | Austin `tcad_id` is a **10-digit string** (e.g. `0315310317`). TCAD `pID` is 6–7 digits (`100008`). The TCAD record carries `propertyIdentification[].geoID` = `"0100030105"`, which has the same form as `tcad_id`. | The join is **Austin `tcad_id` = TCAD `geoID` exactly as printed → `pID`**. The property key stays `pID` (P0-5). `geoID → pID` can be 1:n, so it needs a rule (§ A.4). |
| F7 | The TCAD entry `Travis-protaxExport-20260719.json` is **29,855,337,435 bytes uncompressed**: one pretty-printed top-level array, about 60 KB per record. Each record has `owners[]` with `confidentialCode` ("Q" on some), `deeds[]`, `sales[]`, `situses[]`, `permits[]`, and `geometry: "[lat, lon]"`. | Stream it and prefilter, never load it (§ A.4). The confidentiality flag exists and is applied before `validate` (§ 7, P0-15). |
| F8 | `export-tables --output-json` returns `{output, car, root, countyRoot, partSizeBytes, codec:"zstd", tables:{name:{rows,parts}}, parts, exportedAt}`. It has **no part CIDs, sizes or sha256**. Part CIDs are in the `CountyTables` block of `tables.car` (UnixFS, `cidVersion 1, rawLeaves true`). Each class table has one column per schema property plus `cid, property_cid, data_group_cid, request_identifier`. Nested values, including `source_http_request`, are JSON strings. | The manifest reads part CIDs from `tables.car` and computes sha256 and size locally (§ C). `source_url` comes from `json_extract_string(source_http_request,'$.url')`. |
| F9 | `ipfs.io` and `dweb.link` now answer **HTTP 429 "switching to a service worker gateway only"**. The CLI's schema gateways default to `ipfs.filebase.io, gateway.pinata.cloud, trustless-gateway.link`, which answer 200. The lexicon MCP tools (`listClassesByDataGroup`, `listPropertiesByClassName`) still return "Internal error". | A-02 is not affected if `ELEPHANT_IPFS_GATEWAYS` stays unset. AC-1 uses the live manifest plus schema fetches, not the MCP. **P0-14 (Verify via ipfs.io/dweb.link only) is now at risk for A-03** (risk R8). |
| F10 | Austin `permit_number` already carries the type suffix (`2025-063927 EP`, `2026-034767 BP`). The dataset updates daily (`rowsUpdatedAt` 2026-10-20T12:36:38Z). Total rows are **2,380,939 today**, against 2,380,725 on 2026-10-19. | `permit_number` as printed is the `request_identifier`. Every count carries its `captured_at`. |

---

## A. Smallest local pilot

### A.1 Who produces lexicon records

Nothing in `pipeline/oracle-runtime` writes lexicon records today. It holds only A-01 discovery code and the vendored readiness validator. The kit runtime's transforms are Florida-only (Duval, Pinellas, Broward), and its permit code writes internal query tables, not the Property Improvement group. So both transforms are **new TypeScript custom transforms**, written by following **`build-county-transform`** (custom-code mode, `reference/output-contract.md`), with **`county-seed-data`** for the seed and **`county-permit-adapter`**'s source and throughput rules for the Socrata capture.

The kit's own pieces run unmodified:
- `elephant-cli` (all four steps).
- The kit **roof-age estimator**. Vendor `skills/use-oracle/runtime/src/roof-age/estimator.ts` unmodified into `pipeline/oracle-runtime/kit/use-oracle/runtime/src/roof-age/`, and add its SHA-256 to `VENDORED.md`, the same way as the readiness script.

| Step | New code (TS), proposed path | Reads | Writes (gitignored, under `pipeline/data/pilot/travis-pilot-20261020/`) |
|---|---|---|---|
| 1 Capture permits | `pipeline/oracle-runtime/travis/pilot/capture-austin.ts` | SoQL slice (§ B), then **one GET per permit** `…/3syk-w9eu.json?permit_number=<n>`, at most 1 request/s, stop on 403 | `capture/austin/<permit>.json` plus `capture/austin/receipts.jsonl` (url, method, multiValueQueryString, status, bytes, sha256, captured_at) |
| 2 Capture parcels | `…/pilot/capture-tcad-subset.ts` | the TCAD ZIP via the existing `travis/lib/zip-entry.ts` (streaming inflate) | `capture/tcad/subset.jsonl` plus `receipt.json` (zip sha256 `6f7a7585…2346` from the catalog, entry name, record ordinal, per-record sha256) |
| 3 Seed | `…/pilot/build-seed.ts` (county-seed-data contract) | the subset | `seed/travis.csv` (`parcel_id` = `pID` as printed, plus `geo_id` as an extra column) |
| 4 Classify | `profiles/travis-austin@1.0.0` (§ D) | the permit captures | `ledger/classification.jsonl` (internal; each row stamped with profile and sha256) |
| 5 Roof age | the vendored estimator, plus a Travis roof-age profile mapping `status_current` words and the profile-emitted term `travis_roof_class` | permits plus `yrBuilt` | `ledger/roof-age.jsonl` (anchor, confidence, as_of = run `finishedAt`) |
| 6a County transform | `…/travis/transforms/tcad-county.ts` | subset, seed, roof-age ledger | `groups/county/<pID>/data/*.json` |
| 6b PI transform | `…/travis/transforms/austin-property-improvement.ts` | permit captures, classification ledger, seed | `groups/property_improvement/<pID>/data/*.json` |
| 7 CLI ×2 | `pipeline/publish/src/sequence.ts` (spawns the CLI in fixed order; A-03 adds upload) | groups | `car/`, `hashed/`, `tables/`, `reports/` |
| 8 Manifest | `pipeline/publish/src/manifest.ts` | CLI outputs and receipts only | `manifest/manifest.json` plus its CID (§ C) |

### A.2 Input layout that `validate` and `hash` expect

`<group-dir>` holds one subdirectory (or `.zip`) per property. Names starting with `.` or `__` are skipped, and duplicate names abort the run. `pickPropertyDir` unwraps a single inner folder, so this layout is accepted:

```text
groups/county/<pID>/data/
  property_seed.json  unnormalized_address.json  address_has_parcel.json  <Seed schema CID>.json
  property.json  address.json  geometry.json  structure.json  sales_history_1.json
  person_1.json | company_1.json  mailing_address_1.json
  relationship_*.json …  <County schema CID>.json
groups/property_improvement/<pID>/data/
  (same four seed files, byte-identical)
  property.json   ← byte-identical to the County one (same builder function)
  property_improvement_<n>.json  relationship_property_has_property_improvement_<n>.json
  <Property Improvement schema CID>.json
```

Rules:
- Every entity carries `source_http_request` (headers: `content-type` only) and `request_identifier`.
  - Permits: the actual per-permit GET, with `request_identifier` = `permit_number`.
  - TCAD entities: the bulk export GET, with `request_identifier` = `pID`.
- Relationships are only `{from, to}`, written as relative links.
- Every entity must be linked, or validation fails with "Unused data JSON file".
- Lexicon-gap source fields are simply not written, because these classes have no `source_payload`. They are listed in the findings doc.
- `property_has_property_improvement` follows the kit's Pinellas pattern. A test asserts that the property CID is equal in both CARs. Mew confirms the edge choice.

### A.3 The exact commands (no upload, no `--atlas-page`)

```bash
CLI=~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli   # 1.58.1 @ 44bb182; never Homebrew
P=pipeline/data/pilot/travis-pilot-20261020                            # ELEPHANT_IPFS_GATEWAYS left unset (F9)

# county group
$CLI validate $P/groups/county --output-csv $P/reports/county-errors.csv
$CLI hash $P/groups/county --output-zip $P/hashed/county --output-csv $P/reports/county-hash.csv --output-car $P/car/travis-county.car
$CLI validate $P/car/travis-county.car --output-csv $P/reports/county-car-errors.csv
$CLI export-tables $P/car/travis-county.car --output $P/tables/county --part-size 1g --output-json $P/reports/county-tables-export.json

# property_improvement group
$CLI validate $P/groups/property_improvement --output-csv $P/reports/property_improvement-errors.csv
$CLI hash $P/groups/property_improvement --output-zip $P/hashed/property_improvement --output-csv $P/reports/property_improvement-hash.csv --output-car $P/car/travis-property_improvement.car
$CLI validate $P/car/travis-property_improvement.car --output-csv $P/reports/property_improvement-car-errors.csv
$CLI export-tables $P/car/travis-property_improvement.car --output $P/tables/property_improvement --part-size 1g --output-json $P/reports/property_improvement-tables-export.json
```

The runner records, for each step: argv, exit code, stdout (`CAR written: … (<blocks> blocks, root <cid>)` and `Tables written: … root <cid>`), the `dataGroupCid` from `hash.csv`, and the sha256 of every output. Any non-zero exit stops the sequence; the transform is fixed and validation is never skipped.

### A.4 Finding the pilot parcels without loading the roll

1. From the permit captures, collect the distinct `tcad_id` set: 19 for September plus the 5 Expired, so at most 24.
2. Stream the ZIP entry with `zip-entry.ts`. Split records on depth-1 delimiters: the file is pretty-printed, so records are bounded by lines `" {"` and `" },"`.
3. Before parsing, keep only records whose raw text contains `"geoID": "<id>"` for an id in the set. JSON.parse only those, then verify `propertyIdentification[].geoID === tcad_id` **as a string, without digit normalization**.
4. Resolution rule:
   - exactly one `pID` with `propType` R → matched;
   - zero matches, or more than one → the permit is kept **unmatched**, with a reason (`no_tcad_geoid` / `ambiguous_geoid`) and counted, never guessed. One September permit (`2026-122340 BP`) has a null `tcad_id` and exercises this path.
5. Decompression is the bottleneck, so the whole pass should take minutes, not a full parse of 29.9 GB. Record the scan in the receipt.

*Alternative noted, not used:* TCAD records carry their own `permits[]`. It could cross-check the join later (A-07).

---

## B. Pilot slice: confirmed, with one correction

Live SoQL on 2026-10-20, include terms = REROOF, RE-ROOF or ROOF REPLACE in `description`:

| Slice | Count | Detail |
|---|---|---|
| Issued 2026-09-01 … 09-30 | **42** ✔ | Active 29 · Final 13 (13 have `completed_date`). BP/Remodel 30, BP/Repair 8, **EP 2, MP 1, PP 1**. All `AUSTIN FULL PURPOSE`. **19 distinct `tcad_id`** (one parcel has 14 permits, one has 8) plus **1 null**. |
| Older Expired reroofs | **5** | Rule: `status_current='Expired' AND permittype='BP' AND tcad_id IS NOT NULL ORDER BY issue_date DESC, permit_number LIMIT 5` → `2026-034767 BP`, `2026-029405 BP`, `2026-022834 BP`, `2026-022879 BP`, `2026-024100 BP` (issued March 2026, expired Aug–Sep 2026) |
| Parcels | at most 24 | the TCAD `pID`s from the `geoID` match |

**Correction.** The 4 EP/MP/PP rows are trade sub-permits of a larger project ("…new electrical new A/C drain line re-roof"; a PARD remodel "including roof replacement"). Keep them in the pilot: they exercise the profile's trade-permit rule. They are published as `property_improvement` with `improvement_type` Electrical, MechanicalHVAC or Plumbing, never Roofing. That leaves about 38 BP reroofs plus 5 stalled, less any unmatched, which is more than enough for 20 sample rows.

**What gives a property a roof age.** The 13 September Final reroofs have `completed_date`, so the estimator gets `completionDate: confirmed_present` with a `primary_roof_replacement` work class. That produces anchor `permit_terminal_date`, confidence **high**, written as `structure.roof_date` (YYYY-MM-DD) in the County group. The view computes `roof_age_years` = whole years from `roof_date` to `as_of`, which is **0** for these. Every other matched property with a TCAD `yrBuilt` gets `built_year`/low from `property_structure_built_year`. Open (Active) replacements never reset roof age (P0-8). The sample needs only "≥ 1 property with roof age", and both bases satisfy it. If the demo wants a non-zero permit-based age, add 2–3 older Final BP reroofs on the same rule; that is a PO choice.

---

## C. Local pilot manifest (D-2)

`manifest/manifest.json` follows `RunManifestV1`:
- `runId: "travis-pilot-20261020"`, `county/state/fips` = travis/TX/48453.
- `startedAt` and `finishedAt`; `finishedAt` is the run's `as_of`.
- `previousManifestCid: null`.
- `sources[]` from the capture receipts. Austin: watermark = max `:updated_at` of the captured rows, records = 47, `captured_at` window. TCAD: export receipt, records = matched count.
- `limitations[]`, including "pilot: local, unpublished; CIDs are real content addresses of local files, replaced in A-03".
- `coverage` with `derivation` labels (AD-28).
- **Proposed addition while the contract is being frozen:** `profiles[] {name, version, sha256, path, gitCommit}` for travis-austin, travis-places and the roof-age profile. It is cleaner than packing digests into limitation strings (AD-26).
- No IPNS field.

`artifacts[]` comes only from CLI outputs:

| kind | name | cid (source) | codec | size / sha256 |
|---|---|---|---|---|
| `car` | `travis-county.car`, `travis-property_improvement.car` | archive root printed by `hash` (`CountyIndex`, dag-json `baguqeera…`) | `dag-json` | size and sha256 of the `.car` file bytes |
| `table` | `tables/<group>/<table>/part-NNNNN.parquet` (one per part) | the part link read from the `CountyTables` block in `tables.car`, decoded locally | from the CID itself (`raw` or `dag-pb`) | size and sha256 of the local part. The builder **re-derives the UnixFS CID** (`ipfs-unixfs-importer`, cidVersion 1, rawLeaves true) and fails on a mismatch. |
| `directory` | `tables/<group>` | tables root printed by `export-tables` (`CountyTables`, dag-json) | `dag-json` | `carCid` = UnixFS file CID of `tables.car`, plus its size and sha256 |

The `tables-export.json` and `hash.csv` sha256 values go into `docs/evidence/A-02.md`. They are not artifacts, because they are never published. Compare CIDs by multihash digest when codecs differ.

**Manifest CID:**
1. Serialize the manifest canonically: RFC 8785 JCS (sorted keys, no insignificant whitespace, UTF-8).
2. Hash those exact bytes with `ipfs-unixfs-importer` (cidVersion 1, rawLeaves true, default 256 KiB chunker). Below 256 KiB that is CIDv1 `raw` + sha2-256 (`bafkrei…`), the same CID a later `ipfs add --cid-version 1` of the same bytes would give.

`multiformats` and `ipfs-unixfs-importer` are already dependencies of the CLI; add them to `pipeline/publish`. Commit the manifest bytes as `contract/v1/pilot-manifest.json` so Task B can recompute `manifest_cid`. It is never uploaded and never put in `runs/index.json`. The sample rows' `run_id`, `manifest_cid` and `table_cid` (the part CID) come from it.

---

## D. Profiles and gazetteer as versioned code (AD-26)

### D.1 `profiles/travis-austin@1.0.0/`

A workspace package, imported by `oracle-runtime` (transform) and `query-core` (generated status mapping, agent and MCP labels).

```text
profiles/travis-austin@1.0.0/
  rules.json          # the ONLY place terms live (digested)
  expectations.json   # measured counts + dates + rules_sha256 they were measured with (not digested)
  DIGEST              # sha256 hex of rules.json canonical form
  index.ts            # Zod schema, classifyPermit(), classifyStatus(), digest(), toSoqlInclude(), toSqlStatusMap()
  CHANGELOG.md
```

`rules.json` holds:
- `roofing.include`: substring, case-insensitive, on `description`: REROOF, RE-ROOF, ROOF REPLACE. This matches SoQL `upper(x) like '%T%'` exactly (§ E).
- `roofing.exclude`, **token-aware**, with reason ids:
  - `work_class = 'Auxiliary Power'`;
  - `\bSOLAR\b | \bPV\b | PHOTOVOLTAIC`;
  - `\bRTUS?\b`;
  - `ROOF-MOUNTED`;
  - roof deck only as a rooftop deck, not "ROOF DECKING" (R4).
- `trade_permit`: `permittype ≠ BP` → not Roofing (R5).
- Precedence: exclude beats include.
- `needs_review`: `work_class='Roof'` with no include term (52 rows), plus any unmapped status word.
- `status_map`: the AD-08 lists, with `Cancelled*` as a prefix rule.
- `published_encoding`: class → lexicon enum.
  - `closed` → `Completed`.
  - `open` → `Permitted` (Active), `Planned` (Pending, Pending Permit, Re Review) or `OnHold` (On Hold, Suspended, Inactive Pending Revision).
  - `stalled` → `null`.
  - `exclude` and `needs_review` → **not emitted** into the published group; counted in manifest coverage instead.
  - Roofing → `improvement_type: Roofing`, `improvement_action: Replacement`.

**Digest.** Mirror the kit's `permitProfileDigest` exactly: Zod-parse, recursively sort keys, `JSON.stringify(...) + "\n"`, then SHA-256 hex. `DIGEST` is committed. A test recomputes it and fails on drift, and the version must change whenever `rules.json` changes. Expectations sit outside the digest, so re-measuring counts does not change the profile's identity.

### D.2 `packages/query-core/gazetteer/travis-places@1.0.0/`

```text
sources.json   # per file: url, Last-Modified, retrieved_at, bytes, sha256
               #  2024_Gaz_place_national.zip (1,221,402 B, LM 2024-08-30) · 2024_Gaz_zcta_national.zip (1,013,803 B, LM 2024-08-30)
               #  rel2020/zcta520/tab20_zcta520_county20_natl.txt (6,821,287 B, LM 2021-12-09; use AREALAND_PART > 0)
               #  codes2020/place_by_cou/st48_tx_place_by_county2020.txt (already used by A-01; there is no rel2020 place file, 404)
places.json    # {geoid, name, name_lsad, lat, lon, counties[], partial_in_travis, source_file}
zctas.json     # {zcta, lat, lon, counties[], partial_in_travis, source_file}
owner-area.json# travis_zctas[], regional_county_fips [48491 Williamson, 48209 Hays, 48021 Bastrop, 48055 Caldwell, 48053 Burnet, 48031 Blanco], regional_zctas[], all_us_zctas_digest
DIGEST         # sha256 of the JCS form of {version, places, zctas, owner-area, sources}
index.ts       # lookup(name|zip) → {status:'found', point, kind, partial_in_travis, source:{url,file_date,sha256}, gazetteer:{version,sha256}} | {status:'out_of_scope'}
```

It is built once by `packages/query-core/scripts/build-gazetteer.ts`. Raw downloads go to `pipeline/data/raw/census/` (gitignored); only the filtered JSON is committed. Name lookup strips the LSAD suffix ("city", "town", "village", "CDP") and is case-insensitive. Out of county → `out_of_scope`, never a point.

### D.3 Where classification runs, and how the views read it

Classification runs **in the profile, at transform time**, in the pipeline. Its result is written **into the published record as lexicon enum values** (option B below).

**Option A** (compute at query time from the published description and work class) is **not possible**: by F1 neither field has a carrier, so neither can be published (A2/AD-25).

**Option C** (publish raw words through a `file` or `fact_sheet` side object) breaks AD-25's "no side files".

The views then only *read* published enums:
- `v_roofing_permit` filters `improvement_type = 'Roofing'`. This is an equality on a lexicon value, not a pattern.
- `status_class` comes from `toSqlStatusMap()`: a `VALUES` table generated from `rules.json.published_encoding`, committed as `packages/query-core/generated/travis-austin@1.0.0.status-map.sql` with a digest header. A test asserts the file equals the generator's output.
- `stalled` = `improvement_status IS NULL` with `permit_issue_date` present. This is unambiguous only because needs_review and excluded permits are never emitted (R2).
- `status_raw` and `expiry_date` = NULL with reason `no_lexicon_carrier` (unless mew finds a carrier). The row's `source_url` links to the Socrata record that shows "Expired".

**Stamping (AD-26).** The published lexicon has no field for a profile digest, so the stamp lives in:
1. the internal classification ledger (every row);
2. manifest `profiles[]`;
3. every view row's `classification_profile` and `classification_profile_sha256`, which `bindManifest` injects from the manifest;
4. agent and MCP answers.

The roof-age profile and the gazetteer are stamped the same way.

**Allowed under A2/AD-25/AD-26:** yes. The terms live only in the versioned profile, the views contain no `LIKE`/`ILIKE`/regex, and the published values are CLI output. The A-02 Vitest gate should fail on `LIKE`, `ILIKE`, `regexp_*` or `~` in `views.sql`, *and* on any profile term literal (REROOF, SOLAR…) found anywhere outside `profiles/`.

**PO/mew decision needed:** encoding Expired as `improvement_status = null` (not relabelled) and holding back excluded and needs_review permits.

---

## E. AC-5 scale run and AC-3 sample

### E.1 AC-5, without ingesting

Measured today for scale:

| Count | Value |
|---|---|
| Total | 2,380,939 |
| Include (description) | **22,084** |
| Include ∧ Auxiliary Power | 3 |
| Include ∧ solar/PV (naive) | 35 |
| Include ∧ `%RTU%` (naive) | 43, mostly "OPPORTUNITY", so false |
| Include ∧ `%ROOF DECK%` (naive) | 25, mostly "roof decking" inside real reroofs |
| Include ∧ roof-mounted | 0 |
| Include ∧ non-BP | 3,035 |
| ROOF ∧ Auxiliary Power | 10,322 |

The run, `profiles/travis-austin@1.0.0/scripts/measure.ts`, in one run:
1. Run `count(*)` with the include predicate generated by `toSoqlInclude()`, plus `count(*)` of the whole dataset.
2. Key-page the **include set only** (about 22k rows; `$select=permit_number, permittype, work_class, status_current, description`; `$order=permit_number`; at most 50,000 rows per page; receipt with sha256). This is classification input, not ingestion.
3. Assert fetched rows = count. On a mismatch, re-measure once, else stop with the reason.
4. Apply `classifyPermit()` locally. That yields candidates, excludes by reason id, trade permits and needs_review.
5. Cross-check the SoQL-expressible exclude: the 3 Auxiliary Power permit numbers must equal the classifier's `aux_power` set. Candidates ∩ Auxiliary Power = 0, and the full 10,322 is recorded.
6. Write `expectations.json`: `{measured_at, dataset_rows, include_matches, excluded{…}, needs_review, candidates, rules_sha256, query_urls}`. Assert candidates = include − excluded − needs_review.

Token-aware excludes cannot be expressed in SoQL. That is why include is pushed down to SoQL and the excludes are applied in TS on the fetched include set.

### E.2 AC-3 sample

- **Population:** `upper(description) like '%ROOF%' OR upper(work_class) like '%ROOF%'` = **65,437** today. The sampler generates this from the profile's `sample_population`; it is pipeline tooling, not a view.
- **Draw:**
  1. Fetch the population keys (`permit_number`, 2 pages), sorted.
  2. Rank by `sha256(seed + "\n" + permit_number)` and take the 25 smallest. This does not depend on page order or PRNG state.
  3. Record the seed (for example `travis-austin@1.0.0/AC-3/2026-10-20`), the population count, `captured_at` and the sha256 of the sorted key list.
- **Output:** `docs/evidence/A-02-classifier-review.md`, with columns permit, work_class, status, description, verdict, reason and the PO's ✔/✘. Commit only the 25 permit numbers. Expect about 1 in 6 to be Auxiliary Power, so the excludes really get exercised.

---

## F. Patterns, risks, verification

### F.1 Oracle patterns that must show in the code

| Pattern | How it appears |
|---|---|
| Validate → hash → validate CAR → export-tables, fixed order | `pipeline/publish/src/sequence.ts`, with a test asserting step order; non-zero exit stops the run |
| One CAR per group, seed root in every archive, Seed never its own group | two group dirs, each property carrying the seed files byte-identically |
| Tables only from `export-tables` | views read `tables/<group>/**` only; nothing built from the hashed ZIPs or the Query DB |
| Provenance captured, never reconstructed | per-permit GET receipts; `source_http_request` copied from the receipt |
| Key exactly as printed | `pID` for property; `tcad_id` ↔ `geoID` compared as strings; ambiguous matches stay unlinked |
| Fail closed and stop on 403 | capture scripts abort on 403 or challenge with a `blocked` receipt |
| Data-group root names from the live manifest | read from `lexicon.elephant.xyz/api/manifest` at run time |
| CID comparison by digest | the manifest builder compares multihash digests across raw, dag-pb and dag-json |
| Missing data says why | `Provenance.missing {field, reason}`; reasons such as `no_lexicon_carrier`, `not_open`, `no_deed_date`, `zip_not_zcta`, `not_emitted_by_export` |
| `captured_at` per row | not in the lexicon, so it comes from manifest `sources[]` per source via `bindManifest` (document it in the README) |

### F.2 Risks

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | No carrier on `property_improvement` for description, work class, status_raw, expiry, printed contractor or BBB (F1, F3), so D-9 and D-11 show "not published · reason" | **High** | AC-1 verdicts from the live schema; extension requests drafted (D-1); UI shows the reason plus a `source_url` link |
| R2 | Stalled = null status is ambiguous if any needs_review or excluded permit is ever emitted | **High** | Transform asserts every emitted permit's class ∈ {open, stalled, closed}; test; PO/mew approval of the encoding |
| R3 | Join assumes `tcad_id` = `geoID`; `geoID → pID` may be 1:n | **High** | The pilot measures the match rate; unmatched and ambiguous permits are kept and counted |
| R4 | Naive excludes drop real reroofs ("OPPORTUNITY" matches RTU; "roof decking") | Med | Token-aware patterns; the AC-3 review; unit cases taken from these real descriptions |
| R5 | 3,035 non-BP include matches are trade sub-permits of the same project, which inflates the candidate count | Med | `trade_permit` rule (BP only) as a **PO decision**; recorded in the AC-5 breakdown |
| R6 | Daily drift (+214 rows in a day) breaks "same run" equality | Med | Count and fetch in one run, re-count, `captured_at` on everything, sampling by key digest |
| R7 | P0-17 bans Parquet in git, but FR-008 commits `contract/v1/sample.parquet` | Med | Add an accepted deviation to ARD § 13 before G7 (PO) |
| R8 | ipfs.io and dweb.link now return 429 (service-worker only), which breaks the P0-14 Verify path in A-03+ | Med (A-03) | Raise now; candidate fix is trustless verification over `trustless-gateway.link` or `?format=car` with local hashing; needs a new ADR row |
| R9 | Lexicon MCP tools still return errors | Med | AC-1 uses the live manifest plus schema fetches via Filebase or Pinata (verified 200) and the real export; never memory |
| R10 | View over a table the export did not emit (no `company` table in the pilot) fails to compile | Med | `bindManifest` creates empty typed relations from the live class schema; the verdict becomes "no carrier (not emitted by the export)" |
| R11 | `property.json` written twice (County and PI) must be byte-identical | Low | Shared builder plus a test comparing the property CID across both CARs; views take property only from the County tables |
| R12 | ZCTA ≠ USPS ZIP (PO-box ZIPs such as Austin's), so owners are wrongly flagged out of area | Med | `owner_area_class = unknown`, reason `zip_not_zcta`, using the national ZCTA list |
| R13 | Census vintage gap (2020 place-by-county vs the 2024 Gazetteer) | Low | Record both vintages in `sources.json`; places with no relationship row → excluded with a reason |
| R14 | Confidential owners (`confidentialCode`) published | **High** (P0-15) | Suppress owner name and mailing before `validate`; redacted count goes to manifest limitations; test |
| R15 | `structure` has 45 required (nullable) fields; the pilot transform could drift from A-04's full transform | Low | A-04 extends the same transform module; the coverage proof (build-county-transform step 5) belongs to A-04 |
| R16 | build-county-transform step 8 (PR to `Counties-trasform-scripts`) is outside the fork | Low | Record as a human action in `kit-usage.md`; keep the README and findings doc in the repo |

### F.3 How to verify

| Part | Check |
|---|---|
| Pilot | All 8 commands exit 0; error CSVs have only a header; both `tables-export.json` files list `property`, `structure`, `sales_history` and `property_improvement` tables with the expected rows; the `countyRoot` in each export = the root `hash` printed |
| Join | Matched, unmatched and ambiguous counts, from the TCAD scan receipt; one matched `pID` checked by hand against TCAD |
| Manifest | Zod `RunManifestV1` parse; recomputing the CID from the committed bytes gives the same CID; every part CID re-derived from its file equals the `tables.car` link; no gateway URLs; CIDv1 only |
| Profile | DIGEST test; unit cases (all 9 status words seen; an unseen word → needs_review; Expired → stalled with source word kept; real false-positive descriptions); AC-5 equality and 0 Auxiliary Power candidates; AC-3 PO review ≥ 24/25 |
| Views | Vitest with `@duckdb/node-api` (test-only dependency, not in `query-core/src`) over the real pilot tables (env-gated; skipped with an explicit message when absent) plus fixture tests on the frozen column list; exact column-list snapshot; grep gate; ≥ 80% coverage |
| Gazetteer | Pflugerville 4857176 at 30.447765, −97.602116; Manor; Lakeway; 78753 → found with the source sha256; 99999 → `out_of_scope`; Round Rock → `partial_in_travis`; DIGEST test |
| Sample | `duckdb -c "SELECT count(*) …"` = 20; 0 nulls in the 6 provenance columns; ≥ 1 `stalled`; ≥ 1 non-null `roof_age_years`; README lists every column and every no-carrier gap |

**Decisions needed (PO/mew), all before `/speckit-plan`:**
1. The R2 encoding: Expired → `improvement_status = null`, and excluded/needs_review permits not emitted.
2. R5: whether only BP permits count as reroofs.
3. R7: the sample.parquet deviation.
4. R8: raising the Verify-gateway problem for A-03.
5. Mew to confirm `property_has_property_improvement` and the AC-1 verdicts from F1–F4.

---

## Disagreements

Rule (walkthrough D-4): mew wins on names (constitution XIII, AD-07); oracle wins on pipeline mechanics. Decisions are recorded in `run-log.md` (D-3, D-4).

| Topic | mew says | oracle says | Recommendation |
|---|---|---|---|
| How an Expired permit appears (AC-4, AC-8) | Publish `improvement_status = null`; the view shows `status_class = null` with reason `no_lexicon_carrier`. Treating null as "stalled" is a hidden convention (P0-11). So AC-4/AC-8 "stalled" can't be met unless the lexicon gains a carrier, or the ACs are amended. | Publish `improvement_status = null`; the view derives `stalled` from `improvement_status IS NULL` + issue date present. This is safe because excluded and needs_review permits are never emitted (a transform assertion guards it). The rule is in the versioned profile's generated status map. | **PO decision (D-4a).** Lean towards oracle: the rule is explicit, versioned and digested (AD-26), not hidden. It keeps AC-4/AC-8 and demo D-11 intact. Add mew's guard: the README and status map document it, and a test fails if any emitted permit is outside {open, stalled, closed}. |
| Excluded and needs_review permits | Publish Cancelled rows; leave them out of the view | Don't emit them at all; count them in manifest `coverage` | Oracle (pipeline mechanics); needed by the row above |
| Property sale-date column | `last_ownership_transfer_date` (lexicon tail) | — (§ 5 draft said `last_sale_date`) | mew (AD-07) |
| Coordinates and owner-mailing columns | `latitude`, `longitude`; `owner_mailing_postal_code`, `owner_mailing_state_code` | — (§ 5 draft said `lat`, `lon`, `owner_mailing_zip`, `owner_mailing_state`) | mew (AD-07) |
| Profile stamp columns | `profile_version`, `profile_sha256` | `classification_profile`, `classification_profile_sha256` | mew (names) |
| Missing-reason values | `no_dated_sale`, `not_in_export`; closed list B.7 | `no_deed_date`, `not_emitted_by_export`, plus `zip_not_zcta` | mew's names; add oracle's `zip_not_zcta` (R12) as a new member |
| Profile digests in the manifest | a "profile section" | `profiles[] {name, version, sha256, path, gitCommit}` | oracle's shape (pipeline mechanics); mew's columns read from it |
| `captured_at` per row | additive `RunManifestV1.sources[].captured_at` | from manifest `sources[]` via `bindManifest` | Agreed |
| Reroofs from trade sub-permits (non-BP) | — | Only BP permits count as Roofing; EP/MP/PP are not (3,035 include matches) | **PO decision (D-4b)**; lean towards BP only |
| `sample.parquet` in git vs P0-17 ("no Parquet in git") | — | Needs an accepted ARD deviation | **PO decision (D-4c)**; ARD § 15 already requires the file in git, so record deviation D-07 |
| ipfs.io / dweb.link answer 429 | — | Breaks P0-14 Verify from A-03 on | Not A-02's scope: record as a risk for A-03 (new ADR row then) |
