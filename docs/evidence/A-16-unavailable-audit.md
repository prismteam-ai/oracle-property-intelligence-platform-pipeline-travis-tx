# A-16 audit: every "unavailable / not published / unknown" claim vs Run 3

PO request 2026-10-26 05:50. Read-only. Run 3 `travis-full-run3-20261025`, manifest
`bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm`, as_of 2026-10-25T12:44:21Z.
Branch `016-cost-and-admin` @ 8b2cf28.

## Evidence used (and its limits)

- `specs/011-publish-and-runs/run3/run3-evidence.json` (v_property 441,961: roof_age 389,528, tenure 420,411
  [deed 372,455 / sale 47,956 / unknown 21,550], coords 434,016 [gis 390,061 / address_point 43,955 / none 7,945],
  owner_named 409,389; v_roofing_permit 15,025: contractor_printed 4,139, open_days 795).
- Explore index `index.json` (`ownerArea.knownRows = 0, published = false`; v_contractor 4,139 rows) and the
  column names in the index Parquet footers (v_property carries `owner_name`, `property_structure_built_year`,
  `last_ownership_transfer_date`; v_roofing_permit carries `contractor_name_as_printed`, `bbb_url`, `final_date`,
  `permit_close_date`, `open_days`). So the **index is complete**; every gap below is in the query/row mapping.
- Run 3 `address` export part footer: columns `cid, property_cid, data_group_cid, request_identifier` only (no
  address text) → situs and mailing ZIP really are not published.
- Run 3 manifest coverage keys: contractor_*, parcels_published, permits_* only (no owner_*, coordinates_*, bbb_*).
- **Not measured:** non-null counts of `property_structure_built_year`, `roof_age_basis = built_year`,
  `final_date`, `permit_close_date`, `final_inspection_date`. This agent is restricted to the Elephant MCP and
  did not run DuckDB; Travis TX is not in Atlas (`listAtlasCounties` lists only FL/jackson, indexCid
  `bafkreifw24tns43is25hexizxkeqo6u2e4ayvjuo4yrwxtwly4q7ixlgqu`). SQL to fill them is at the end.

Derived counts: owner_name null = 32,572; v_contractor rows = printed names = 4,139 → `bbb_url` non-null 4,139
(built from the name); `bbb_rating` non-null 0; `contractor_resolution = resolved` 0 (manifest
`contractor_resolved` 0, no registry); `owner_area_class <> unknown` 0.

## Table

| # | Surface | Field | Shown reason | Code location | Data source read | Run 3 non-null | Verdict | Exact fix |
|---|---|---|---|---|---|---|---|---|
| 1 | Explore row/card + drawer, Permit section | Contractor as printed | "Name not published · no lexicon carrier" (`EXPLORE_TEXTS.noCarrier`, reason `no_lexicon_carrier`) | `apps/web/src/components/ResultRow.tsx:229-237` | nothing: hard-coded pill | 4,139 / 15,025 | **Hard-coded stale claim** | Render `row.contractor.name_as_printed` ("as printed, unverified"); when null, use the row's `permit.contractor_name_as_printed` missing entry |
| 2 | query-core Explore row (feeds 1, the drawer's Missing data, `explore.search`) | `contractor.name_as_printed` | `{field:"contractor.name_as_printed", reason:"no_lexicon_carrier"}` pushed on every permit row; value forced `null` | `packages/query-core/src/explore.ts:217, 311, 340` (and `perm` CTE `121-133`, `base` `153-156` omit the column) | hard-coded; `perm` never selects `contractor_name_as_printed` | 4,139 | **Hard-coded stale claim + query gap** | Add `contractor_name_as_printed, bbb_url` to `perm` and `base`; map `name_as_printed: str(row.contractor_name_as_printed)`; delete the line-311 push (the view's `permit_missing` already carries the real entry); type `name_as_printed: string \| null` |
| 3 | Agent `listPermits`, `getProperty` (permits), MCP `list_permits`, `get_property` | `contractor.name_as_printed` | `null` in the nested `contractor` object while the flat row has the value | `packages/query-core/src/tools/functions.ts:373-374` | hard-coded `null` | 4,139 | **Hard-coded stale claim** | `name_as_printed: row.contractor_name_as_printed ?? null` |
| 4 | Agent model-facing permit projection | contractor name, BBB link | not passed to the model at all (system prompt `ask.ts:673-676` tells it to report the name) | `apps/api/src/agent/tools.ts:93-108` | projection omits `contractor_name_as_printed`, `bbb_url` | 4,139 | **Index gap (projection)** | Add `contractor_name_as_printed: row.contractor_name_as_printed, bbb_url: row.bbb_url` to `projectPermit` |
| 5 | Agent `missing[]`, `declareUnpublished`, answer sentence | BBB | `bbb_status: no_lexicon_carrier`; "BBB status is not available in the published data." | `apps/api/src/agent/citations.ts:254-257`; `ask.ts:427-432` (maps `bbb_rating`→`bbb_status`), `ask.ts:1031-1036`; `tools.ts:223-238` | hard-coded list | `bbb_status` 15,025 non-null (blocked 4,139 / not_checked 10,886); `bbb_rating` 0 | **Hard-coded stale claim** (status is published; only the rating is not, and the reason is `bbb_blocked`) | `UNPUBLISHED_FIELDS = { owner_is_out_of_area: "not_in_export", bbb_rating: "bbb_blocked" }`; drop the `bbb_rating→bbb_status` alias; sentence → "BBB ratings are not published (BBB blocked the lookup); a BBB search link is given where a contractor is printed." |
| 6 | Coverage page, every kind card (Property, Ownership, Permit, Coordinates) | table + CIDs | "no published table for this kind in this run" | `apps/web/src/routes/Coverage.tsx:255-257` (prefix `tables/${table}/`) | manifest `artifacts[].name` | 255 table parts exist; names are `…/county-batched/tables/bNN/<table>/part-*.parquet` and `…/permits-batched/tables/bNN/…` | **Wrong source** (pilot path shape; batched run names never start with `tables/`) | Resolve parts the way `apps/web/src/data/parquet-meta.ts:135` / `data-groups.ts` do (group from the batch dir, match `/tables/(?:b\d+/)?<table>/`); update `tests/e2e/A-13-explorer.spec.ts:160` |
| 7 | Coverage page, Contractor kind | table | "no published table for this kind in this run" | `apps/web/src/routes/Coverage.kinds.ts:53` (`table: null`) | hard-coded | `property_improvement_has_contractor` + permit-group `company` parts published (4,139 companies) | **Hard-coded stale claim** | `table: "property_improvement/property_improvement_has_contractor"` (with fix 6) |
| 8 | Contract views `missing` → Permits page pills, Explore `permit.*` missing, agent/MCP rows | `contractor_name_as_printed`, `contractor_company_cid`, `bbb_rating`, `bbb_status_reason` when no contractor printed | `contractor_unresolved` → "Contractor not matched to a company" / Permits "Contractor name: not matched" | `packages/query-core/src/derive.ts:392-396` (`contractor_missing_reason`, `bbb_status_reason`); `sql.generated.ts:440-445, 411` | view (edges = 0) | 10,886 rows have no printed contractor | **Wrong reason** (value correctly null; the permit printed no contractor, nothing failed to match) | edges = 0 → `source_missing` (labels already map it to "Contractor not printed on permit", `labels.ts:65,144`); keep `contractor_unresolved` only for resolution. Views change → new viewsSha + Explore index rebuild |
| 9 | Explore row/card + drawer | BBB | "BBB blocked · 403 challenge, not harvested" (no link) | `ResultRow.tsx:242-256`; `explore.ts:121-125` | `bbb_status`, `bbb_status_reason` | blocked 4,139 | Correct status; **Index gap** for the link | Carry `bbb_url` (fix 2) and render `BBB_SEARCH_LINK_LABEL` (`labels.ts:68`) beside the pill |
| 10 | MCP `get_schema` uncarried list; v_contractor `missing` | `bbb_rating`, `bbb_url` on v_contractor | `no_lexicon_carrier` | `packages/contract/src/columns.ts:775-788`; `sql.generated.ts:514-515` | hard-coded | v_contractor footer has `bbb_url`/`bbb_rating` stats; v_roofing_permit publishes `bbb_url` 4,139 | **Hard-coded stale claim** (v1.1 made rating `bbb_blocked` and the link derived on permits) | v_contractor: `miss('bbb_rating','bbb_blocked')` when `name` not null; publish `bbb_search_url(name) AS bbb_url` (additive v1.2) or reason `bbb_blocked`; update `UNCARRIED.v_contractor` |
| 11 | Agent empty-result sentence | any filtered field | "a field this search filters on is not published in this run" (`field_not_published`) | `packages/query-core/src/tools/functions.ts:323-345`; `apps/api/src/agent/citations.ts:242-243` | relax-null test per row | roof_age 389,528, tenure 420,411 (published; only some rows null); owner_is_out_of_area 0 | **Hard-coded stale claim** for roof/tenure (true only for owner area) | Return `field_not_published` only when the field has 0 non-null rows in the run (`ownerAreaPublished`-style check); else a new `field_unknown` outcome: "{field} is unknown for N rows in the area" |
| 12 | Missing-reason labels (Explore drawer Missing data, Permits, MissingReason pill) | `owner_name`, `owner_kind` | `no_owner_record` → "No owner on the latest sale" | `packages/shared/src/labels.ts:25` | view `owner_gap` (run-level, `sql.generated.ts:156-163`) | owner_name 409,389; null 32,572 | **Hard-coded stale label** (owners come from `person_has_property`/`company_has_property` since ERR-69, not the sale) | "No owner record on the TCAD account" |
| 13 | Same labels | `last_ownership_transfer_date`, `tenure_*`, `is_long_tenure` | `no_dated_sale` → "No dated sale to read the owner from" | `packages/shared/src/labels.ts:24` | view | tenure 420,411; unknown 21,550 | **Hard-coded stale label** (it is about tenure; deeds count too) | "No dated sale or deed on record" |
| 14 | Contract view `owner_gap` reason | `owner_name` (32,572 rows) | one run-level reason for every row (`owner_gap_reason` of coverage `owner_unparsed/owner_confidential/owner_no_record`) | `sql.generated.ts:156-163`; `derive.ts:383-388` | manifest coverage, not the row | Run 3 coverage has none of those keys → all 32,572 get `no_owner_record` | **Wrong source** (reason is not per row; unparsed/confidential rows cannot be told apart) | Emit per-account gap counts in the manifest (owner_unparsed / owner_confidential / owner_no_record) or a per-row flag; until then label it "Owner not published for this account" |
| 15 | Explore card + drawer | Basis = built year | "Year built (no reroof permit found)" with no year ("the index carries no year number") | `ResultRow.tsx:197-199`; `explore.ts:222-243, 317-361` | row mapping drops `property_structure_built_year` (`SELECT b.*` returns it) | not measured (column present in index) | **Index gap (row mapping)** | Add `year_built: num(row.property_structure_built_year)` to `ExploreRow`; show "Year built {y}" |
| 16 | Explore Owner section + drawer | owner name, last transfer date | not shown at all (no field) | `PropertyDrawer.tsx:211`; `explore.ts:222-243` | — | owner_name 409,389; transfer 420,411 | **Index gap (row mapping)** | Add `owner_name`, `owner_kind`, `last_ownership_transfer_date` to `ExploreRow` and the Owner section, with the view's missing reason when null |
| 17 | Permits page | close/final date, open days, contractor name, BBB link | only missing pills; present values never shown | `packages/query-core/src/builders.ts:19-25` (`PERMIT_COLUMNS`); `apps/web/src/engine/permit-list.ts:13-56` | list SQL omits the columns | contractor 4,139; open_days 795; dates not measured | Pills Correct; **Index gap** for values | Add `contractor_name_as_printed, bbb_url, final_date, permit_close_date, open_days` to `PERMIT_COLUMNS`, the `pick`, and a column/card line |
| 18 | Explore drawer title + Location "Address" | address | "Address: not published · no lexicon carrier" | `PropertyDrawer.tsx:93-97`; `ResultRow.tsx:177-187` | hard-coded; `explore.ts:305` pushes `not_in_export` | 0 (address table has no text) | Value **Correct**, text wrong (carrier exists; export omits it) | Use `missingLabel("address","not_in_export")` → "Not included in the published tables" |
| 19 | Search box | address search | "Street addresses are not published in this run…" | `apps/web/src/components/searchSuggest.ts:26-27` | hard-coded | 0 | **Correct** | — |
| 20 | v_property `missing` / `UNCARRIED` | `unnormalized_address`, `city_name`, `postal_code` | `not_in_export` | `sql.generated.ts:300-302`; `columns.ts:717-735` | hard-coded | 0 (FU-A-01 situs half still open) | **Correct** | — (FU-A-01 still open) |
| 21 | v_property `missing`, Explore Owner area, drawer chip, agent prompt `ask.ts:669-672`, `OWNER_AREA_NOTICE` (`tools.ts:37-42`, `mcp/tools.ts:81-84`, `routers/explore.ts:52-56`) | `owner_area_class`, `owner_is_out_of_area`, `owner_mailing_*` | "owner area unknown · mailing address not in the published export" / `not_in_export` / `owner_area_not_published` | `ResultRow.tsx:274-279`; `texts.ts:87`; `sql.generated.ts:319-324`; `engine/duckdb-node.ts:244-261` | view + index header `ownerArea.published` | 0 (index `knownRows 0`) | **Correct** | — |
| 22 | Explore card/drawer, permit chip, Explore/agent missing | `status_raw` | "Status not published · no lexicon carrier" / "source status not published" | `ResultRow.tsx:220-228`; `PermitChip.tsx:23-28`; `explore.ts:310`; `functions.ts:371` | UNCARRIED | 0 (no carrier) | **Correct** | — |
| 23 | v_roofing_permit `missing` | `expiry_date`, `description`, `work_class_raw` | `no_lexicon_carrier` | `sql.generated.ts:432, 447-448` | UNCARRIED | 0 | **Correct** | — |
| 24 | Explore card/drawer chip | roof age, basis, confidence | "roof age unknown · no permit, new-construction or built-year record" | `ResultRow.tsx:72-86, 188-208`; `PropertyDrawer.tsx:113-114, 162-164` | `roof_age_years`, `roof_age_basis`, view missing | 389,528 (52,433 null) | **Correct** | — |
| 25 | Explore Tenure | tenure years / basis | "tenure unknown · no dated sale on record" | `ResultRow.tsx:258-273` | `tenure_years`, `tenure_basis` | 420,411 (21,550 unknown) | **Correct** (label in #13) | — |
| 26 | Explore box filter / v_property missing | coordinates | rows without lat/lon excluded; `no_coordinates` | `explore.ts:148`; `sql.generated.ts:303-305` | `latitude`, `longitude` | 434,016 (7,945 none) | **Correct** | — |
| 27 | Explore/Permits/agent | contractor resolution | "Contractor unresolved" | `ContractorBadge.tsx:14-25`; `Permits.page.tsx:187` | `contractor_resolution` | resolved 0 (no registry) | **Correct** | — |
| 28 | Permits page pills, Explore `permit.*` | `final_date`, `permit_close_date`, `final_inspection_date`, `open_days`, `issue_date`, `improvement_status`, `status_class` | `not_closed`/`source_missing`/`needs_review`, `not_open`, `enum_lacks_value` | `sql.generated.ts:425-439`; `derive.ts:367-378`; `Permits.page.tsx:120-146` | view per row | open_days 795; dates not measured | **Correct** (per-row view logic) | — |
| 29 | v_roofing_permit `bbb_rating` | BBB rating | `bbb_blocked` ("BBB blocked the lookup") | `sql.generated.ts:412, 444-445` | always NULL | 0 | **Correct** (when a name is printed; see #8 otherwise) | — |
| 30 | Coverage page tiles | Ownership/BBB/Business/Places/Coordinates counts | "not in this run's coverage section" | `Coverage.tsx:292`; `Coverage.kinds.ts:10` | manifest coverage keys | keys absent in Run 3 | **Correct** as read (manifest omits owner_* and coordinates_* though the data has them; add the keys in the next run) | — |
| 31 | Coverage page "Areas with permit data" | per-area counts | "Not available · the manifest has no per-area counts" | `Coverage.tsx:237-240` | hard-coded | manifest has none | **Correct** | — |
| 32 | Provenance line | `source_url` | `not_in_export` | `Provenance.tsx:75-76`; `ResultRow.tsx:372-378` | row | per row | **Correct** | — |

## Counts per verdict

- Correct: 14 (#19-#32)
- Hard-coded stale claim: 9 (#1, #2, #3, #5, #7, #10, #11, #12, #13)
- Wrong source: 2 (#6, #14)
- Wrong reason code (value right): 2 (#8, #18)
- Index gap (query/row mapping/projection; the index itself carries the column): 5 (#4, #9, #15, #16, #17)

## SQL to fill the unmeasured counts (run by a caller allowed to use DuckDB on the index copy)

```sql
SELECT count(property_structure_built_year) AS built_year,
       count(*) FILTER (WHERE roof_age_basis = 'built_year') AS basis_built_year,
       count(owner_name) AS owner_name, count(last_ownership_transfer_date) AS last_transfer
FROM 'v_property.parquet';
SELECT count(final_date), count(permit_close_date), count(final_inspection_date), count(open_days),
       count(contractor_name_as_printed), count(bbb_url), count(*) FILTER (WHERE bbb_status = 'blocked')
FROM 'v_roofing_permit.parquet';
```
