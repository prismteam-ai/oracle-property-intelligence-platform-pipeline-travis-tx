import type { Db } from "../core/db.js";
import { sqlString } from "../core/db.js";
import { log } from "../core/log.js";
import { nameKeySql } from "./names.js";
import {
  AUSTIN_PERMITS_ID,
  OPEN_STATUSES,
  roofingClassifierSql,
} from "../sources/austin-permits.js";

export const NEW_PRIMARY_STRUCTURE_CLASS = "^[RC]-\\s*(10[1-5]|21[34]|31[89]|32[0-8])\\b";

export type DeriveStats = Record<string, number>;

export async function derive(db: Db, opts: { fips: string; asOf: string }): Promise<DeriveStats> {
  const fips = sqlString(opts.fips);
  const asOf = `${sqlString(opts.asOf)}::DATE`;

  const roof = roofingClassifierSql("description", "permit_type", "work_class");
  await db.exec(`UPDATE permits SET roofing_match = ${roof.match}, is_roofing = ${roof.isRoofing},
    is_open = status IN (${OPEN_STATUSES.map(sqlString).join(", ")})
    WHERE source_id = ${sqlString(AUSTIN_PERMITS_ID)}`);

  await db.exec(`CREATE OR REPLACE TABLE permit_parcel_links AS
    WITH g AS (
      SELECT geo_id, min(prop_id) AS prop_id FROM parcels WHERE NOT is_deleted AND geo_id IS NOT NULL GROUP BY geo_id
    ),
    direct AS (
      SELECT p.permit_number, g.prop_id, 'tcad_geo_id' AS match_method
      FROM permits p JOIN g ON g.geo_id = p.tcad_id WHERE NOT p.is_deleted
    ),
    pending AS (
      SELECT permit_number, ST_Point(longitude, latitude) AS pt FROM permits
      WHERE NOT is_deleted AND latitude BETWEEN 25 AND 37 AND longitude BETWEEN -107 AND -93
        AND permit_number NOT IN (SELECT permit_number FROM direct)
    ),
    spatial AS (
      SELECT q.permit_number, pg.prop_id, 'point_in_parcel' AS match_method
      FROM pending q JOIN parcel_geometries pg ON ST_Contains(pg.geom, q.pt)
      QUALIFY row_number() OVER (PARTITION BY q.permit_number ORDER BY ST_Area(pg.geom)) = 1
    )
    SELECT * FROM direct UNION ALL SELECT * FROM spatial`);

  const boundaryHex = await db.one<{ hex: string | null }>(
    `SELECT hex(ST_AsWKB(geom)) AS hex FROM county_boundary WHERE geoid = ${fips} AND NOT is_deleted`,
  );
  const countyGeom = boundaryHex?.hex ? `ST_GeomFromHEXWKB('${boundaryHex.hex}')` : null;
  await db.exec(`CREATE OR REPLACE TABLE permit_scope AS
    SELECT p.permit_number, l.prop_id, l.match_method,
      CASE WHEN l.prop_id IS NOT NULL THEN true ELSE NULL::BOOLEAN END AS in_county
    FROM permits p LEFT JOIN permit_parcel_links l USING (permit_number)
    WHERE NOT p.is_deleted`);
  if (countyGeom) {
    await db.exec(`CREATE OR REPLACE TEMP TABLE _scope_check AS
      WITH g AS (SELECT ${countyGeom} AS geom),
      b AS (SELECT ST_XMin(geom) AS x0, ST_XMax(geom) AS x1, ST_YMin(geom) AS y0, ST_YMax(geom) AS y1 FROM g)
      SELECT p.permit_number,
        p.longitude BETWEEN b.x0 AND b.x1 AND p.latitude BETWEEN b.y0 AND b.y1
          AND ST_Within(ST_Point(p.longitude, p.latitude), (SELECT geom FROM g)) AS inside
      FROM permits p JOIN permit_scope s USING (permit_number), b
      WHERE s.prop_id IS NULL AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL`);
    await db.exec(`UPDATE permit_scope SET in_county = c.inside FROM _scope_check c
      WHERE permit_scope.permit_number = c.permit_number`);
    await db.exec(`DROP TABLE IF EXISTS _scope_check`);
  }

  await db.exec(`CREATE OR REPLACE TABLE contractor_permits AS
    SELECT p.permit_number,
      coalesce(p.contractor_company_name, p.contractor_full_name) AS raw_name,
      ${nameKeySql("coalesce(p.contractor_company_name, p.contractor_full_name)")} AS name_key,
      p.contractor_phone, p.contractor_address, p.contractor_city, p.contractor_zip, p.contractor_trade,
      p.issued_date, p.is_roofing, p.is_open
    FROM permits p WHERE NOT p.is_deleted
      AND coalesce(p.contractor_company_name, p.contractor_full_name) IS NOT NULL`);
  await db.exec(`DELETE FROM contractor_permits WHERE name_key IS NULL OR length(name_key) < 2`);

  await db.exec(`CREATE OR REPLACE TABLE contractors AS
    SELECT 'ctr_' || substr(md5(name_key), 1, 16) AS contractor_id,
      name_key,
      mode(raw_name) AS display_name,
      list_distinct(list(raw_name)) AS name_variants,
      list_distinct(list(contractor_phone) FILTER (WHERE contractor_phone IS NOT NULL)) AS phones,
      mode(contractor_address) AS address,
      mode(contractor_city) AS city,
      mode(contractor_zip) AS zip,
      list_distinct(list(contractor_trade) FILTER (WHERE contractor_trade IS NOT NULL)) AS trades,
      count(*)::INTEGER AS permit_count,
      count(*) FILTER (WHERE is_roofing)::INTEGER AS roofing_permit_count,
      count(*) FILTER (WHERE is_roofing AND is_open)::INTEGER AS open_roofing_permit_count,
      min(issued_date) AS first_permit_issued,
      max(issued_date) AS last_permit_issued
    FROM contractor_permits GROUP BY name_key`);

  await db.exec(`CREATE OR REPLACE TABLE contractor_business_links AS
    WITH cand AS (
      SELECT c.contractor_id, b.taxpayer_number, b.zip, c.zip AS c_zip,
        count(*) OVER (PARTITION BY c.contractor_id) AS n
      FROM contractors c JOIN businesses b ON b.name_key = c.name_key AND NOT b.is_deleted
    ),
    zipped AS (
      SELECT *, count(*) FILTER (WHERE left(zip, 5) = left(c_zip, 5)) OVER (PARTITION BY contractor_id) AS nz FROM cand
    )
    SELECT contractor_id, taxpayer_number,
      CASE WHEN n = 1 THEN 'exact_name_key' ELSE 'exact_name_key+zip' END AS match_method, n AS candidate_count
    FROM zipped WHERE n = 1 OR (nz = 1 AND left(zip, 5) = left(c_zip, 5))`);

  await db.exec(`CREATE OR REPLACE TABLE contractor_ambiguous_links AS
    SELECT c.contractor_id, list(b.taxpayer_number) AS candidate_taxpayers
    FROM contractors c JOIN businesses b ON b.name_key = c.name_key AND NOT b.is_deleted
    WHERE c.contractor_id NOT IN (SELECT contractor_id FROM contractor_business_links)
    GROUP BY c.contractor_id`);

  await db.exec(`CREATE OR REPLACE TABLE contractor_place_links AS
    WITH cand AS (
      SELECT c.contractor_id, p.place_id,
        list_contains(p.taxonomy_hierarchy, 'roofing') OR p.taxonomy_primary ILIKE '%roof%' AS roofing_place,
        count(*) OVER (PARTITION BY c.contractor_id) AS n
      FROM contractors c JOIN places p ON p.name_key = c.name_key AND NOT p.is_deleted
    )
    SELECT contractor_id, place_id, roofing_place, n AS candidate_count FROM cand
    WHERE n = 1 OR roofing_place
    QUALIFY row_number() OVER (PARTITION BY contractor_id ORDER BY roofing_place DESC, place_id) = 1`);

  await db.exec(`CREATE OR REPLACE TABLE contractor_bbb_links AS
    SELECT c.contractor_id, any_value(b.bbb_id) AS bbb_id, count(*)::INTEGER AS candidate_count
    FROM contractors c JOIN bbb_profiles b ON b.name_key = c.name_key AND NOT b.is_deleted
    GROUP BY c.contractor_id HAVING count(*) = 1`);

  await db.exec(`CREATE OR REPLACE TABLE roof_evidence AS
    SELECT s.prop_id, p.permit_number,
      CASE WHEN p.roofing_match IN ('roof_replacement', 'work_class_roof') THEN 'final_roof_replacement_permit'
           ELSE 'final_new_construction_permit' END AS evidence_kind,
      coalesce(p.completed_date, p.status_date) AS evidence_date,
      p.permit_class, p.description
    FROM permits p JOIN permit_scope s USING (permit_number)
    WHERE NOT p.is_deleted AND s.prop_id IS NOT NULL AND p.status = 'Final'
      AND coalesce(p.completed_date, p.status_date) IS NOT NULL
      AND (p.roofing_match IN ('roof_replacement', 'work_class_roof')
           OR (p.permit_type = 'BP' AND p.work_class = 'New'
               AND regexp_matches(coalesce(p.permit_class, ''), '${NEW_PRIMARY_STRUCTURE_CLASS}')))`);

  await db.exec(`CREATE OR REPLACE TABLE property_roof AS
    WITH best AS (
      SELECT prop_id, arg_max(evidence_kind, evidence_date) AS kind, max(evidence_date) AS evidence_date,
        arg_max(permit_number, evidence_date) AS evidence_permit_number, count(*)::INTEGER AS evidence_count
      FROM roof_evidence GROUP BY prop_id
    )
    SELECT pa.prop_id,
      (CASE WHEN b.evidence_date IS NOT NULL THEN year(b.evidence_date) ELSE coalesce(t.year_built, pa.year_built) END)::INTEGER AS roof_year,
      CASE WHEN b.evidence_date IS NOT NULL THEN b.kind WHEN coalesce(t.year_built, pa.year_built) IS NOT NULL THEN 'tcad_year_built' ELSE 'no_evidence' END AS roof_age_basis,
      CASE WHEN b.kind = 'final_roof_replacement_permit' THEN 'high'
           WHEN b.kind = 'final_new_construction_permit' THEN 'medium'
           WHEN coalesce(t.year_built, pa.year_built) IS NOT NULL THEN 'low' ELSE 'none' END AS roof_age_confidence,
      b.evidence_date AS roof_evidence_date,
      b.evidence_permit_number AS roof_evidence_permit_number,
      coalesce(b.evidence_count, 0) AS roof_evidence_count
    FROM parcels pa LEFT JOIN best b USING (prop_id)
      LEFT JOIN tcad_properties t ON t.prop_id = pa.prop_id AND NOT t.is_deleted
    WHERE NOT pa.is_deleted`);

  await db.exec(`CREATE OR REPLACE TABLE county_zips AS
    SELECT DISTINCT left(situs_zip, 5) AS zip FROM parcels WHERE NOT is_deleted AND regexp_full_match(left(situs_zip, 5), '[0-9]{5}')`);

  await db.exec(`CREATE OR REPLACE TABLE roofing_permits AS
    SELECT p.permit_number, s.prop_id, s.match_method AS parcel_match_method, s.in_county,
      p.permit_type, p.permit_class, p.work_class, p.description, p.roofing_match, p.status, p.is_open,
      p.applied_date, p.issued_date, p.status_date, p.expires_date, p.completed_date,
      CASE WHEN p.is_open THEN date_diff('day', coalesce(p.issued_date, p.applied_date), ${asOf})::INTEGER END AS open_days,
      p.status = 'Expired' AND p.completed_date IS NULL AS expired_without_final,
      p.address, p.city, p.zip, p.jurisdiction, p.latitude, p.longitude,
      p.contractor_company_name, p.contractor_full_name, p.contractor_phone, p.contractor_trade,
      c.contractor_id, c.display_name AS contractor_name,
      bl.taxpayer_number AS contractor_taxpayer_number,
      bb.bbb_id AS contractor_bbb_id, bbp.rating AS contractor_bbb_rating, bbp.accredited AS contractor_bbb_accredited,
      p.total_job_valuation, p.permit_link,
      p.source_id, p.source_url, p.raw_sha256, p.collected_at, p.first_seen_run, p.last_changed_run
    FROM permits p
    JOIN permit_scope s USING (permit_number)
    LEFT JOIN contractors c ON c.name_key = ${nameKeySql("coalesce(p.contractor_company_name, p.contractor_full_name)")}
    LEFT JOIN contractor_business_links bl ON bl.contractor_id = c.contractor_id
    LEFT JOIN contractor_bbb_links bb ON bb.contractor_id = c.contractor_id
    LEFT JOIN bbb_profiles bbp ON bbp.bbb_id = bb.bbb_id
    WHERE NOT p.is_deleted AND p.is_roofing AND coalesce(s.in_county, false)`);

  await db.exec(`CREATE OR REPLACE TABLE property_leads AS
    WITH rp AS (
      SELECT prop_id,
        count(*)::INTEGER AS roofing_permit_count,
        count(*) FILTER (WHERE is_open)::INTEGER AS open_roofing_permit_count,
        max(open_days) AS oldest_open_roofing_permit_days,
        arg_max(permit_number, open_days) FILTER (WHERE is_open) AS oldest_open_roofing_permit_number,
        count(*) FILTER (WHERE expired_without_final)::INTEGER AS expired_unfinaled_roofing_permit_count,
        arg_max(permit_number, coalesce(issued_date, applied_date)) AS last_roofing_permit_number,
        max(coalesce(issued_date, applied_date)) AS last_roofing_permit_date
      FROM roofing_permits WHERE prop_id IS NOT NULL GROUP BY prop_id
    ),
    ap AS (SELECT prop_id, count(*)::INTEGER AS permit_count FROM permit_scope WHERE prop_id IS NOT NULL GROUP BY prop_id)
    SELECT pa.prop_id, pa.geo_id,
      pa.situs_address, pa.situs_number, pa.situs_street, pa.situs_city, left(pa.situs_zip, 5) AS situs_zip,
      pa.latitude, pa.longitude,
      pa.owner_name, pa.owner_care_of, pa.mail_address, pa.mail_city, pa.mail_state, left(pa.mail_zip, 5) AS mail_zip,
      CASE WHEN pa.mail_state IS NULL THEN 'unknown'
           WHEN pa.mail_state <> 'TX' THEN 'out_of_state'
           WHEN left(pa.mail_zip, 5) IN (SELECT zip FROM county_zips) THEN 'local'
           ELSE 'regional_texas' END AS owner_location_class,
      pa.mail_address IS NOT NULL AND pa.situs_number IS NOT NULL
        AND NOT starts_with(upper(coalesce(pa.mail_address, '')), upper(pa.situs_number || ' ')) AS absentee_owner_signal,
      pa.land_use_state_code, pa.land_use_local_code,
      pa.land_value, pa.improvement_value, pa.market_value, pa.gis_area, pa.gis_area_unit, pa.tax_year, coalesce(t.year_built, pa.year_built) AS year_built,
      r.roof_year,
      CASE WHEN r.roof_year IS NOT NULL THEN (year(${asOf}) - r.roof_year)::INTEGER END AS roof_age_years,
      r.roof_age_basis, r.roof_age_confidence, r.roof_evidence_date, r.roof_evidence_permit_number, r.roof_evidence_count,
      coalesce(rp.roofing_permit_count, 0) AS roofing_permit_count,
      coalesce(rp.open_roofing_permit_count, 0) AS open_roofing_permit_count,
      rp.oldest_open_roofing_permit_days, rp.oldest_open_roofing_permit_number,
      coalesce(rp.expired_unfinaled_roofing_permit_count, 0) AS expired_unfinaled_roofing_permit_count,
      rp.last_roofing_permit_number, rp.last_roofing_permit_date,
      coalesce(ap.permit_count, 0) AS permit_count,
      t.deed_date AS last_deed_date,
      CASE WHEN t.deed_date IS NOT NULL THEN 'tcad_deed_date' WHEN t.prop_id IS NOT NULL THEN 'tcad_no_deed_date'
           WHEN (SELECT count(*) FROM tcad_properties WHERE NOT is_deleted) > 0 THEN 'not_in_tcad_roll' ELSE 'tcad_appraisal_roll_pending' END AS ownership_tenure_basis,
      CASE WHEN t.deed_date IS NOT NULL THEN date_diff('year', t.deed_date, ${asOf}) END AS years_since_deed,
      t.roof_attributes AS tcad_roof_attributes,
      pa.source_id AS parcel_source_id, pa.source_url AS parcel_source_url, pa.raw_sha256 AS parcel_raw_sha256,
      pa.collected_at AS parcel_collected_at, pa.first_seen_run, pa.last_changed_run,
      ${asOf} AS as_of_date
    FROM parcels pa
    LEFT JOIN property_roof r USING (prop_id)
    LEFT JOIN rp USING (prop_id)
    LEFT JOIN ap USING (prop_id)
    LEFT JOIN tcad_properties t ON t.prop_id = pa.prop_id AND NOT t.is_deleted
    WHERE NOT pa.is_deleted`);

  const stats = await db.one<Record<string, string>>(`SELECT
    (SELECT count(*) FROM permit_parcel_links WHERE match_method = 'tcad_geo_id') AS permits_linked_by_tcad_id,
    (SELECT count(*) FROM permit_parcel_links WHERE match_method = 'point_in_parcel') AS permits_linked_by_point,
    (SELECT count(*) FROM permit_scope WHERE in_county) AS permits_in_county,
    (SELECT count(*) FROM permit_scope WHERE NOT coalesce(in_county, false)) AS permits_out_of_county,
    (SELECT count(*) FROM contractors) AS contractors,
    (SELECT sum(len(name_variants) - 1) FROM contractors) AS contractor_name_variants_merged,
    (SELECT count(*) FROM contractor_business_links) AS contractors_linked_to_business,
    (SELECT count(*) FROM contractor_ambiguous_links) AS contractors_ambiguous_business,
    (SELECT count(*) FROM contractor_place_links) AS contractors_linked_to_place,
    (SELECT count(*) FROM contractor_bbb_links) AS contractors_linked_to_bbb,
    (SELECT count(*) FROM roofing_permits) AS roofing_permits_in_county,
    (SELECT count(*) FROM roofing_permits WHERE is_open) AS open_roofing_permits,
    (SELECT count(*) FROM property_roof WHERE roof_year IS NOT NULL) AS properties_with_roof_age,
    (SELECT count(*) FROM property_leads) AS properties`);
  const out: DeriveStats = {};
  for (const [k, v] of Object.entries(stats ?? {})) out[k] = Number(v ?? 0);
  log.info("derive_done", out);
  return out;
}
