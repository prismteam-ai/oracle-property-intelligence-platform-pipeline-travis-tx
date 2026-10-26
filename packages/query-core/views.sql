-- T060 (A-02, FR-002 / FR-007 / FR-009): the four contract/v1 views.
-- Bound by bindManifest() (src/bind-manifest.ts), which first creates:
--   meta.run, meta.source, meta.group_source, meta.part, meta.jurisdiction_host, meta.zcta_area;
--   county.<table> and property_improvement.<table> over export-tables output (each with _part);
--   travis_austin_status_map (generated from the profile) and the macros in src/derive.ts.
-- Rules: columns, order and types are packages/contract/src/columns.ts; joins go only through
-- relationship tables (from_cid / to_cid); roofing is enum equality on improvement_type and
-- improvement_action; status_class comes only from the generated status map on (jurisdiction,
-- improvement_status); every derivation is a derive.ts macro over meta.run.as_of (the manifest
-- finishedAt); every empty value gets a {field, reason} entry in `missing`. Records are read
-- once per cid and edges once per (from_cid, to_cid), whatever the number of parts.
-- Address fields (v1.2) are read through meta.address_fields, which bindManifest fills from the
-- county.address columns the export carries (export-tables emits them with the oneOf-columns
-- patch from Run 3.1 on; an earlier run's address table has identity columns only, so the fields
-- are NULL and listed in `missing` as not_in_export). TCAD prints the situs as one line, so the
-- situs city and ZIP are source_missing (they are inside unnormalized_address).

-- One row per (permit, property edge) of a published county property, with its jurisdiction
-- (request host → profile jurisdiction map) and its status_class. Shared by v_property (roof
-- anchor) and v_roofing_permit.
CREATE OR REPLACE VIEW meta.permit AS
WITH
pi AS (
  SELECT * FROM property_improvement.property_improvement
  QUALIFY row_number() OVER (PARTITION BY cid ORDER BY _part) = 1
),
edge AS (
  SELECT DISTINCT from_cid, to_cid FROM property_improvement.property_has_property_improvement
)
SELECT
  pi.cid AS permit_cid,
  e.from_cid AS property_cid,
  jh.jurisdiction,
  pi.permit_number,
  pi.request_identifier,
  pi.improvement_type,
  pi.improvement_action,
  pi.improvement_status,
  status_class_of(jh.jurisdiction, pi.improvement_status, pi.permit_issue_date) AS status_class,
  TRY_CAST(pi.permit_issue_date AS DATE) AS issue_date,
  TRY_CAST(pi.completion_date AS DATE) AS final_date,
  TRY_CAST(pi.permit_close_date AS DATE) AS permit_close_date,
  TRY_CAST(pi.final_inspection_date AS DATE) AS final_inspection_date,
  pi.source_http_request,
  pi._part
FROM pi
JOIN edge e ON e.to_cid = pi.cid
JOIN (SELECT DISTINCT cid FROM county.property) cp ON cp.cid = e.from_cid
LEFT JOIN meta.jurisdiction_host jh
  ON jh.host = url_host(json_extract_string(pi.source_http_request, '$.url'));

CREATE OR REPLACE VIEW v_property AS
WITH
prop AS (
  SELECT * FROM county.property
  QUALIFY row_number() OVER (PARTITION BY cid ORDER BY _part) = 1
),
-- Both coordinates from one geometry row: the lowest-cid geometry that has both. geometry_url is the
-- GET stamped on that row: the City of Austin address-point layer for an address_point (ADR 0004).
geo AS (
  SELECT pp.from_cid AS property_cid, g.latitude, g.longitude,
         source_url(g.source_http_request) AS geometry_url
  FROM (SELECT DISTINCT from_cid, to_cid FROM county.property_has_parcel) pp
  JOIN (SELECT DISTINCT from_cid, to_cid FROM county.parcel_has_geometry) pg
    ON pg.from_cid = pp.to_cid
  JOIN county.geometry g ON g.cid = pg.to_cid
  WHERE g.latitude IS NOT NULL AND g.longitude IS NOT NULL
  QUALIFY row_number() OVER (PARTITION BY pp.from_cid ORDER BY g.cid) = 1
),
-- structure.roof_date carries only a TCAD-sourced value (the built year); the transform never
-- stamps the TCAD request on a permit-derived date (oracle F1).
structure_roof AS (
  SELECT ps.from_cid AS property_cid,
         arg_min(s.roof_date, s.cid) FILTER (WHERE s.roof_date IS NOT NULL) AS roof_date
  FROM (SELECT DISTINCT from_cid, to_cid FROM county.property_has_structure) ps
  JOIN county.structure s ON s.cid = ps.to_cid
  GROUP BY ps.from_cid
),
-- mew B.5 and the kit estimator: the latest accepted terminal date (completion_date or
-- permit_close_date, not after as_of, not before the issue date) of a closed Roofing permit.
-- Open and stalled replacements never reset the roof age (P0-8).
terminal AS (
  SELECT pm.property_cid, pm.improvement_action, t.d
  FROM meta.permit pm
  CROSS JOIN meta.run run
  CROSS JOIN LATERAL (SELECT unnest([pm.final_date, pm.permit_close_date]) AS d) t
  WHERE pm.improvement_type = 'Roofing' AND pm.status_class = 'closed'
    AND terminal_date_accepted(t.d, pm.issue_date, run.as_of)
),
roof_anchor AS (
  SELECT property_cid,
         max(d) FILTER (WHERE improvement_action = 'Replacement') AS replacement_date,
         max(d) FILTER (WHERE improvement_action = 'New') AS new_date
  FROM terminal
  GROUP BY property_cid
),
latest_sale AS (
  SELECT psh.from_cid AS property_cid, sh.cid AS sale_cid,
         TRY_CAST(sh.ownership_transfer_date AS DATE) AS transfer_date,
         -- ERR-71: a row built from a TCAD transfer deed carries transfer_source = deed in its
         -- source_http_request.multiValueQueryString (the lexicon has no other carrier).
         CASE WHEN json_extract_string(sh.source_http_request,
                '$.multiValueQueryString.transfer_source[0]') = 'deed'
              THEN 'deed' ELSE 'sale' END AS transfer_source
  FROM (SELECT DISTINCT from_cid, to_cid FROM county.property_has_sales_history) psh
  JOIN county.sales_history sh ON sh.cid = psh.to_cid
  WHERE TRY_CAST(sh.ownership_transfer_date AS DATE) IS NOT NULL
  QUALIFY row_number() OVER (
    PARTITION BY psh.from_cid
    ORDER BY TRY_CAST(sh.ownership_transfer_date AS DATE) DESC, sh.cid) = 1
),
-- Current owners per property (ERR-69): a person or company is an owner of a property when the
-- export links them to it (person_has_property / company_has_property), whether or not the
-- property has a dated sale. A run written before Run 3 has no such edge; its owners are the
-- people and companies of the latest dated sale (sales_history_has_person / _company), so the
-- same rows keep reading. Persons and companies are aggregated separately (no cross join), each
-- record once.
person_link AS (
  SELECT from_cid AS person_cid, to_cid AS property_cid FROM county.person_has_property
  UNION
  SELECT shp.to_cid, ls.property_cid
  FROM latest_sale ls
  JOIN county.sales_history_has_person shp ON shp.from_cid = ls.sale_cid
),
company_link AS (
  SELECT from_cid AS company_cid, to_cid AS property_cid FROM county.company_has_property
  UNION
  SELECT shc.to_cid, ls.property_cid
  FROM latest_sale ls
  JOIN county.sales_history_has_company shc ON shc.from_cid = ls.sale_cid
),
owner_person AS (
  SELECT pl.property_cid, count(*) AS n,
         string_agg(pe.first_name || ' ' || pe.last_name, '; '
           ORDER BY pe.last_name, pe.first_name, pe.cid) AS names
  FROM person_link pl
  JOIN (SELECT * FROM county.person
        QUALIFY row_number() OVER (PARTITION BY cid ORDER BY _part) = 1) pe
    ON pe.cid = pl.person_cid
  GROUP BY pl.property_cid
),
owner_company AS (
  SELECT cl.property_cid, count(*) AS n,
         string_agg(co.name, '; ' ORDER BY co.name, co.cid) AS names
  FROM company_link cl
  JOIN (SELECT * FROM county.company
        QUALIFY row_number() OVER (PARTITION BY cid ORDER BY _part) = 1) co
    ON co.cid = cl.company_cid
  GROUP BY cl.property_cid
),
-- Why a property has no owner: the export cannot tell, so the run's capture-receipt counts
-- decide (derive.ts ownerGapReason).
owner_gap AS (
  SELECT owner_gap_reason(
    TRY_CAST(json_extract(coverage, '$.owner_unparsed.count') AS INTEGER),
    TRY_CAST(json_extract(coverage, '$.owner_confidential.count') AS INTEGER),
    TRY_CAST(json_extract(coverage, '$.owner_no_record.count') AS INTEGER)) AS reason
  FROM meta.run
),
-- Mailing addresses of the current owners (persons and companies linked to the property), one
-- row per (property, address). Edges only; the address text is not needed here.
owner_mailing AS (
  SELECT pl.property_cid, e.to_cid AS address_cid
  FROM person_link pl
  JOIN (SELECT DISTINCT from_cid, to_cid FROM county.person_has_mailing_address) e
    ON e.from_cid = pl.person_cid
  UNION
  SELECT cl.property_cid, e.to_cid
  FROM company_link cl
  JOIN (SELECT DISTINCT from_cid, to_cid FROM county.company_has_mailing_address) e
    ON e.from_cid = cl.company_cid
),
-- The owner mailing area per property: each address's ZIP (first 5 digits) against meta.zcta_area.
-- Co-owners can mail from different areas; the property takes the most local class among them
-- (in_county, else regional, else out_of_area), so a local co-owner means not absentee. NULL when
-- no address resolves to a known ZCTA.
mailing AS (
  SELECT om.property_cid,
    CAST(count(DISTINCT om.address_cid) AS INTEGER) AS n_mailing,
    CAST(count(DISTINCT af.postal_code) AS INTEGER) AS n_zip,
    nullif(array_to_string(list_sort(list_distinct(list(left(af.postal_code, 5)))), '; '), '')
      AS mailing_zips,
    nullif(array_to_string(list_sort(list_distinct(list(af.state_code))), '; '), '')
      AS mailing_states,
    CASE WHEN bool_or(za.area_class = 'in_county') THEN 'in_county'
         WHEN bool_or(za.area_class = 'regional') THEN 'regional'
         WHEN bool_or(za.area_class = 'out_of_area') THEN 'out_of_area' END AS area_class
  FROM owner_mailing om
  LEFT JOIN meta.address_fields af ON af.cid = om.address_cid
  LEFT JOIN meta.zcta_area za ON za.zcta = left(af.postal_code, 5)
  GROUP BY om.property_cid
),
-- The situs address text of each property (v1.2), one per property (the smallest address cid
-- when an export ever links two).
situs AS (
  SELECT pa.from_cid AS property_cid,
         arg_min(af.unnormalized_address, af.cid) AS unnormalized_address
  FROM (SELECT DISTINCT from_cid, to_cid FROM county.property_has_address) pa
  JOIN meta.address_fields af ON af.cid = pa.to_cid
  WHERE af.unnormalized_address IS NOT NULL
  GROUP BY pa.from_cid
),
-- Whether this run's export carries any mailing ZIP / situs text at all, and whether the run
-- named an area list.
area_env AS (
  SELECT (SELECT count(postal_code) FROM meta.address_zip) > 0 AS zips_emitted,
         (SELECT count(unnormalized_address) FROM meta.address_fields) > 0 AS address_text_emitted,
         (SELECT count(state_code) FROM meta.address_fields) > 0 AS states_emitted,
         (SELECT count(*) FROM meta.zcta_area) > 0 AS lookup_loaded
),
county_source AS (
  SELECT s.url, s.captured_at FROM meta.source s
  JOIN meta.group_source g ON g.source_name = s.name AND g.data_group = 'county'
),
base AS (
  SELECT
    p.cid AS property_cid,
    p.request_identifier,
    p.parcel_identifier,
    p.property_type,
    p.property_usage_type,
    CAST(p.property_structure_built_year AS INTEGER) AS property_structure_built_year,
    geo.latitude,
    geo.longitude,
    coordinate_source(geo.latitude, geo.longitude, NULL::DOUBLE, NULL::DOUBLE, geo.geometry_url) AS coordinate_source,
    coalesce(CAST(ra.replacement_date AS VARCHAR), CAST(ra.new_date AS VARCHAR),
      sr.roof_date) AS roof_date,
    ra.replacement_date IS NOT NULL AS replacement_match,
    ra.replacement_date IS NULL AND ra.new_date IS NOT NULL AS new_match,
    ls.transfer_date AS last_ownership_transfer_date,
    ls.transfer_source AS last_transfer_source,
    owner_kind_of(coalesce(op.n, 0), coalesce(oc.n, 0)) AS owner_kind,
    nullif(concat_ws('; ', op.names, oc.names), '') AS owner_name,
    og.reason AS owner_reason,
    owner_area_class(m.area_class) AS owner_area_class,
    st.unnormalized_address,
    m.mailing_zips AS owner_mailing_postal_code,
    m.mailing_states AS owner_mailing_state_code,
    env.address_text_emitted,
    env.states_emitted,
    m.n_mailing,
    m.n_zip,
    env.zips_emitted,
    env.lookup_loaded,
    run.area_list_sha256,
    p.cid,
    source_url(p.source_http_request) AS record_url,
    src.captured_at AS record_captured_at,
    cs.url AS group_source_url,
    cs.captured_at AS group_captured_at,
    part.table_cid,
    run.run_id,
    run.manifest_cid,
    run.as_of
  FROM prop p
  CROSS JOIN meta.run run
  CROSS JOIN county_source cs
  CROSS JOIN owner_gap og
  CROSS JOIN area_env env
  LEFT JOIN geo ON geo.property_cid = p.cid
  LEFT JOIN structure_roof sr ON sr.property_cid = p.cid
  LEFT JOIN roof_anchor ra ON ra.property_cid = p.cid
  LEFT JOIN latest_sale ls ON ls.property_cid = p.cid
  LEFT JOIN owner_person op ON op.property_cid = p.cid
  LEFT JOIN owner_company oc ON oc.property_cid = p.cid
  LEFT JOIN mailing m ON m.property_cid = p.cid
  LEFT JOIN situs st ON st.property_cid = p.cid
  LEFT JOIN meta.source src ON src.url = json_extract_string(p.source_http_request, '$.url')
  LEFT JOIN meta.part part ON part.name = p._part
),
derived AS (
  SELECT *,
    roof_age_years(roof_date, as_of) AS roof_age_years,
    roof_age_basis(roof_date, replacement_match, new_match,
      property_structure_built_year) AS roof_age_basis,
    tenure_years(last_ownership_transfer_date, as_of) AS tenure_years,
    tenure_basis(last_ownership_transfer_date, last_transfer_source) AS tenure_basis,
    coalesce(record_url, group_source_url) AS source_url
  FROM base
)
SELECT
  property_cid,
  request_identifier,
  parcel_identifier,
  property_type,
  property_usage_type,
  property_structure_built_year,
  latitude,
  longitude,
  coordinate_source,
  roof_date,
  roof_age_years,
  roof_age_basis,
  roof_age_confidence(roof_age_basis) AS roof_age_confidence,
  last_ownership_transfer_date,
  tenure_years,
  tenure_basis,
  is_long_tenure(tenure_years) AS is_long_tenure,
  owner_kind,
  owner_name,
  owner_area_class,
  owner_is_out_of_area(owner_area_class) AS owner_is_out_of_area,
  area_list_sha256,
  unnormalized_address,
  owner_mailing_postal_code,
  owner_mailing_state_code,
  cid,
  source_url,
  coalesce(record_captured_at, group_captured_at) AS captured_at,
  'property' AS "table",
  table_cid,
  run_id,
  manifest_cid,
  as_of,
  list_filter([
    CASE WHEN parcel_identifier IS NULL THEN miss('parcel_identifier', 'source_missing') END,
    CASE WHEN property_type IS NULL THEN miss('property_type', 'source_missing') END,
    CASE WHEN property_usage_type IS NULL THEN miss('property_usage_type', 'source_missing') END,
    CASE WHEN property_structure_built_year IS NULL
      THEN miss('property_structure_built_year', 'source_missing') END,
    CASE WHEN unnormalized_address IS NULL THEN miss('unnormalized_address',
      CASE WHEN address_text_emitted THEN 'source_missing' ELSE 'not_in_export' END) END,
    miss('city_name', CASE WHEN address_text_emitted THEN 'source_missing' ELSE 'not_in_export' END),
    miss('postal_code', CASE WHEN address_text_emitted THEN 'source_missing' ELSE 'not_in_export' END),
    CASE WHEN latitude IS NULL THEN miss('latitude', 'no_coordinates') END,
    CASE WHEN longitude IS NULL THEN miss('longitude', 'no_coordinates') END,
    CASE WHEN coordinate_source = 'none' THEN miss('coordinate_source', 'no_coordinates') END,
    CASE WHEN roof_date IS NULL THEN miss('roof_date', 'no_roof_date') END,
    CASE WHEN roof_age_years IS NULL THEN miss('roof_age_years', 'no_roof_date') END,
    CASE WHEN roof_age_basis = 'unknown'
      THEN miss('roof_age_basis', roof_basis_reason(roof_date)) END,
    CASE WHEN roof_age_basis = 'unknown'
      THEN miss('roof_age_confidence', roof_basis_reason(roof_date)) END,
    CASE WHEN last_ownership_transfer_date IS NULL
      THEN miss('last_ownership_transfer_date', 'no_dated_sale') END,
    CASE WHEN tenure_years IS NULL THEN miss('tenure_years', 'no_dated_sale') END,
    CASE WHEN tenure_basis = 'unknown' THEN miss('tenure_basis', 'no_dated_sale') END,
    CASE WHEN tenure_years IS NULL THEN miss('is_long_tenure', 'no_dated_sale') END,
    CASE WHEN owner_kind = 'unknown' THEN miss('owner_kind', owner_reason) END,
    CASE WHEN owner_name IS NULL THEN miss('owner_name', owner_reason) END,
    CASE WHEN owner_mailing_postal_code IS NULL THEN miss('owner_mailing_postal_code',
      owner_mailing_reason(owner_kind, owner_reason, n_mailing, zips_emitted)) END,
    CASE WHEN owner_mailing_state_code IS NULL THEN miss('owner_mailing_state_code',
      owner_mailing_reason(owner_kind, owner_reason, n_mailing, states_emitted)) END,
    CASE WHEN owner_area_class = 'unknown' THEN miss('owner_area_class',
      owner_area_reason(owner_kind, owner_reason, n_mailing, n_zip, zips_emitted, lookup_loaded)) END,
    CASE WHEN owner_is_out_of_area(owner_area_class) IS NULL THEN miss('owner_is_out_of_area',
      owner_area_reason(owner_kind, owner_reason, n_mailing, n_zip, zips_emitted, lookup_loaded)) END,
    CASE WHEN source_url IS NULL THEN miss('source_url', 'not_in_export') END
  ], lambda e: e IS NOT NULL) AS missing
FROM derived;

CREATE OR REPLACE VIEW v_roofing_permit AS
WITH
-- Contractor edges per permit: exactly one → that company; several → none is picked.
contractor AS (
  SELECT from_cid AS permit_cid, CAST(count(DISTINCT to_cid) AS INTEGER) AS edges,
         min(to_cid) AS min_cid
  FROM property_improvement.property_improvement_has_contractor
  GROUP BY from_cid
),
-- The contractor company the permit PRINTS (ERR-66): company.name is "as printed, unverified"
-- and, with no registry id, never makes the permit resolved. Runs before Run 3 bind an empty table.
contractor_company AS (
  SELECT cid, any_value(name) AS name, any_value(sunbiz_document_number) AS registry_id
  FROM property_improvement.company GROUP BY cid
),
permit_source AS (
  SELECT s.url, s.captured_at FROM meta.source s
  JOIN meta.group_source g ON g.source_name = s.name AND g.data_group = 'property_improvement'
),
base AS (
  SELECT
    pm.permit_cid,
    pm.property_cid,
    pm.jurisdiction,
    pm.permit_number,
    pm.request_identifier,
    pm.improvement_type,
    pm.improvement_action,
    pm.improvement_status,
    pm.status_class,
    pm.issue_date,
    pm.final_date,
    pm.permit_close_date,
    pm.final_inspection_date,
    coalesce(c.edges, 0) AS contractor_edges,
    sole_contractor(coalesce(c.edges, 0), c.min_cid) AS contractor_company_cid,
    run.profile_version,
    run.profile_sha256,
    pm.permit_cid AS cid,
    coalesce(source_url(pm.source_http_request), ps.url) AS source_url,
    coalesce(src.captured_at, ps.captured_at) AS captured_at,
    part.table_cid,
    run.run_id,
    run.manifest_cid,
    run.as_of,
    co.name AS contractor_name_as_printed,
    co.registry_id AS contractor_registry_id
  FROM meta.permit pm
  CROSS JOIN meta.run run
  CROSS JOIN permit_source ps
  LEFT JOIN contractor c ON c.permit_cid = pm.permit_cid
  LEFT JOIN contractor_company co ON co.cid = sole_contractor(coalesce(c.edges, 0), c.min_cid)
  LEFT JOIN meta.source src ON src.url = json_extract_string(pm.source_http_request, '$.url')
  LEFT JOIN meta.part part ON part.name = pm._part
  WHERE pm.improvement_type = 'Roofing' AND pm.improvement_action = 'Replacement'
),
-- The latest issue date among the property's finished roofing permits (an accepted completion
-- date), then the two corrections of the date-based class (derive.ts status_class_final).
finished AS (
  SELECT *,
    max(CASE WHEN terminal_date_accepted(final_date, issue_date, as_of) THEN issue_date END)
      OVER (PARTITION BY property_cid) AS last_finished_issue
  FROM base
),
classed AS (
  SELECT * REPLACE (
      status_class_final(status_class, improvement_status, issue_date, final_date, as_of,
        last_finished_issue) AS status_class),
    status_class AS status_class_guess,
    superseded_by_later_permit(status_class, improvement_status, issue_date, final_date, as_of,
      last_finished_issue) AS superseded
  FROM finished
),
derived AS (
  SELECT *,
    contractor_resolution(contractor_registry_id) AS contractor_resolution,
    open_days(status_class, issue_date, as_of, final_date) AS open_days
  FROM classed
)
SELECT
  permit_cid,
  property_cid,
  jurisdiction,
  permit_number,
  request_identifier,
  improvement_type,
  improvement_action,
  improvement_status,
  status_class,
  is_open(status_class) AS is_open,
  issue_date,
  final_date,
  permit_close_date,
  final_inspection_date,
  open_days,
  contractor_resolution,
  contractor_company_cid,
  contractor_name_as_printed,
  bbb_status(contractor_name_as_printed) AS bbb_status,
  bbb_status_reason(contractor_name_as_printed) AS bbb_status_reason,
  CAST(NULL AS VARCHAR) AS bbb_rating,
  bbb_search_url(contractor_name_as_printed) AS bbb_url,
  profile_version,
  profile_sha256,
  cid,
  source_url,
  captured_at,
  'property_improvement' AS "table",
  table_cid,
  run_id,
  manifest_cid,
  as_of,
  list_filter([
    CASE WHEN jurisdiction IS NULL THEN miss('jurisdiction', 'needs_review') END,
    CASE WHEN permit_number IS NULL THEN miss('permit_number', 'source_missing') END,
    CASE WHEN request_identifier IS NULL THEN miss('request_identifier', 'source_missing') END,
    CASE WHEN improvement_status IS NULL
      THEN miss('improvement_status', status_missing_reason(status_class_guess)) END,
    CASE WHEN status_class IS NULL THEN miss('status_class', 'needs_review') END,
    miss('status_raw', 'no_lexicon_carrier'),
    miss('expiry_date', 'no_lexicon_carrier'),
    CASE WHEN issue_date IS NULL THEN miss('issue_date', 'source_missing') END,
    CASE WHEN final_date IS NULL
      THEN miss('final_date', final_date_reason(status_class, superseded)) END,
    CASE WHEN permit_close_date IS NULL THEN miss('permit_close_date', 'source_missing') END,
    CASE WHEN final_inspection_date IS NULL
      THEN miss('final_inspection_date', 'source_missing') END,
    CASE WHEN open_days IS NULL
      THEN miss('open_days', open_days_reason(status_class, issue_date, as_of, final_date)) END,
    CASE WHEN contractor_company_cid IS NULL
      THEN miss('contractor_company_cid', contractor_missing_reason(contractor_edges)) END,
    CASE WHEN contractor_name_as_printed IS NULL
      THEN miss('contractor_name_as_printed', contractor_missing_reason(contractor_edges)) END,
    miss('bbb_rating', CASE WHEN contractor_name_as_printed IS NULL
      THEN 'contractor_unresolved' ELSE 'bbb_blocked' END),
    CASE WHEN contractor_name_as_printed IS NULL THEN miss('bbb_url', 'source_missing') END,
    miss('description', 'no_lexicon_carrier'),
    miss('work_class_raw', 'no_lexicon_carrier'),
    CASE WHEN source_url IS NULL THEN miss('source_url', 'not_in_export') END
  ], lambda e: e IS NOT NULL) AS missing
FROM derived;

CREATE OR REPLACE VIEW v_contractor AS
WITH
edges AS (
  SELECT DISTINCT from_cid, to_cid
  FROM property_improvement.property_improvement_has_contractor
),
counts AS (
  SELECT e.to_cid AS company_cid,
         CAST(count(DISTINCT e.from_cid) AS INTEGER) AS permit_count,
         CAST(count(DISTINCT r.permit_cid) AS INTEGER) AS roofing_permit_count
  FROM edges e
  LEFT JOIN v_roofing_permit r ON r.permit_cid = e.from_cid
  GROUP BY e.to_cid
),
permit_source AS (
  SELECT s.url, s.captured_at FROM meta.source s
  JOIN meta.group_source g ON g.source_name = s.name AND g.data_group = 'property_improvement'
),
base AS (
  SELECT
    co.cid AS contractor_company_cid,
    co.name,
    co.sunbiz_document_number AS registry_id,
    url_host(json_extract_string(co.source_http_request, '$.url')) AS identity_source,
    n.permit_count,
    n.roofing_permit_count,
    co.cid,
    coalesce(source_url(co.source_http_request), ps.url) AS source_url,
    coalesce(src.captured_at, ps.captured_at) AS captured_at,
    part.table_cid,
    run.run_id,
    run.manifest_cid,
    run.as_of
  FROM property_improvement.company co
  JOIN counts n ON n.company_cid = co.cid
  CROSS JOIN meta.run run
  CROSS JOIN permit_source ps
  LEFT JOIN meta.source src ON src.url = json_extract_string(co.source_http_request, '$.url')
  LEFT JOIN meta.part part ON part.name = co._part
  QUALIFY row_number() OVER (PARTITION BY co.cid ORDER BY co._part) = 1
)
SELECT
  contractor_company_cid,
  name,
  contractor_resolution(registry_id) AS contractor_resolution,
  identity_source,
  bbb_status(name) AS bbb_status,
  bbb_status_reason(name) AS bbb_status_reason,
  permit_count,
  roofing_permit_count,
  cid,
  source_url,
  captured_at,
  'company' AS "table",
  table_cid,
  run_id,
  manifest_cid,
  as_of,
  list_filter([
    CASE WHEN name IS NULL THEN miss('name', 'source_missing') END,
    CASE WHEN identity_source IS NULL THEN miss('identity_source', 'needs_review') END,
    miss('bbb_rating', 'no_lexicon_carrier'),
    miss('bbb_url', 'no_lexicon_carrier'),
    CASE WHEN source_url IS NULL THEN miss('source_url', 'not_in_export') END
  ], lambda e: e IS NOT NULL) AS missing
FROM base;

CREATE OR REPLACE VIEW v_run AS
SELECT
  run_id,
  county_fips,
  started_at,
  finished_at,
  manifest_cid,
  previous_manifest_cid,
  from_json(tables_root_cids, '[{"data_group":"VARCHAR","cid":"VARCHAR"}]') AS tables_root_cids,
  from_json(sources, '[{"name":"VARCHAR","watermark":"VARCHAR","captured_at":"VARCHAR","records":"BIGINT","added":"BIGINT","changed":"BIGINT","removed":"BIGINT","limitations":["VARCHAR"]}]') AS sources,
  coverage,
  profile_version,
  profile_sha256,
  area_list_sha256,
  from_json(limitations, '["VARCHAR"]') AS limitations,
  -- Every other v_run column is never null (manifest fields the schema requires).
  list_filter([
    CASE WHEN previous_manifest_cid IS NULL THEN miss('previous_manifest_cid', 'first_run') END
  ], lambda e: e IS NOT NULL) AS missing
FROM meta.run;
