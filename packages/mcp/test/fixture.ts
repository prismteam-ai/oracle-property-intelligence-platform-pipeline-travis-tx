import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

export async function createFixtureSnapshot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "oracle-snap-"));
  await mkdir(path.join(dir, "tables"), { recursive: true });
  const inst = await DuckDBInstance.create(":memory:");
  const c = await inst.connect();
  const out = (t: string) => `'${path.join(dir, "tables", `${t}.parquet`)}'`;
  await c.run(`COPY (SELECT * FROM (VALUES
      ('P1','0100000001','100 MAIN ST','78701',30.2700,-97.7400,'ALICE','1 ELSEWHERE, DENVER, CO','out_of_state','A1',300000.0,2001,25,'final_new_construction_permit','medium',DATE '2001-05-01','2001-000001 BP',1,1,4000,'2009-000009 BP','2009-000009 BP',DATE '2009-01-01',NULL::DATE,'txgio_stratmap_parcels','https://example/parcels.zip',TIMESTAMP '2026-10-14 00:00:00','run-1','run-1'),
      ('P2','0100000002','200 MAIN ST','78701',30.2710,-97.7410,'BOB','200 MAIN ST, AUSTIN, TX','local','A1',250000.0,2020,6,'final_roof_replacement_permit','high',DATE '2020-03-01','2020-000002 BP',0,NULL,NULL,NULL,'2020-000002 BP',DATE '2020-02-01',NULL::DATE,'txgio_stratmap_parcels','https://example/parcels.zip',TIMESTAMP '2026-10-14 00:00:00','run-1','run-1'),
      ('P3','0100000003','9 FAR RD','78660',30.4400,-97.6200,'CAROL','9 FAR RD, PFLUGERVILLE, TX','local','A1',200000.0,NULL,NULL,'no_evidence','none',NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL::DATE,'txgio_stratmap_parcels','https://example/parcels.zip',TIMESTAMP '2026-10-14 00:00:00','run-1','run-1')
    ) t(prop_id, geo_id, situs_address, situs_zip, latitude, longitude, owner_name, mail_address, owner_location_class,
        land_use_state_code, market_value, roof_year, roof_age_years, roof_age_basis, roof_age_confidence, roof_evidence_date,
        roof_evidence_permit_number, open_roofing_permit_count, oldest_open_roofing_permit_days, oldest_open_roofing_permit_number,
        last_roofing_permit_number, last_roofing_permit_number_dup, last_roofing_permit_date, last_deed_date,
        parcel_source_id, parcel_source_url, parcel_collected_at, first_seen_run, last_changed_run)
  ) TO ${out("property_leads")} (FORMAT parquet)`);
  await c.run(`COPY (SELECT * FROM (VALUES
      ('2009-000009 BP','P1','Active',true,false,'roof_replacement','Re-roof residence with shingles',DATE '2009-01-01',DATE '2009-01-02',DATE '2009-01-02',NULL::DATE,NULL::DATE,4000,'100 MAIN ST','78701',30.2700,-97.7400,'ctr_a','ACME ROOFING','Acme Roofing LLC',NULL,'555','32000000001',NULL,NULL,NULL,9000.0,'https://example/permit/1','austin_issued_construction_permits','https://example/permits.csv',TIMESTAMP '2026-10-14 00:00:00',DATE '2009-01-02')
    ) t(permit_number, prop_id, status, is_open, expired_without_final, roofing_match, description, applied_date, issued_date,
        status_date, expires_date, completed_date, open_days, address, zip, latitude, longitude, contractor_id, contractor_name,
        contractor_company_name, contractor_full_name, contractor_phone, contractor_taxpayer_number, contractor_bbb_id,
        contractor_bbb_rating, contractor_bbb_accredited, total_job_valuation, permit_link, source_id, source_url, collected_at, first_seen)
  ) TO ${out("roofing_permits")} (FORMAT parquet)`);
  await c.run(
    `COPY (SELECT 'ctr_a' AS contractor_id, 'ACME ROOFING' AS display_name, 1 AS roofing_permit_count, '32000000001' AS taxpayer_number, NULL::VARCHAR AS bbb_id) TO ${out("contractors")} (FORMAT parquet)`,
  );
  await c.run(
    `COPY (SELECT NULL::VARCHAR AS bbb_id, NULL::VARCHAR AS name, NULL::VARCHAR AS rating WHERE false) TO ${out("bbb_profiles")} (FORMAT parquet)`,
  );
  await c.run(`COPY (SELECT * FROM (VALUES ('4805000','Austin city','Austin','incorporated_place',30.2711,-97.7437),
      ('4857176','Pflugerville city','Pflugerville','incorporated_place',30.4520,-97.6022))
      t(geoid, name, basename, place_kind, latitude, longitude)) TO ${out("geo_places")} (FORMAT parquet)`);
  await c.run(`COPY (SELECT '2009-000009 BP' AS permit_number, 'P1' AS prop_id, 'Building Permit' AS permit_type_desc, 'Repair' AS work_class,
      'Re-roof' AS description, 'Active' AS status, DATE '2009-01-02' AS issued_date, NULL::DATE AS completed_date,
      'Acme Roofing LLC' AS contractor_company_name, 'https://example/permit/1' AS permit_link, 'https://example/permits.csv' AS source_url)
      TO ${out("permits")} (FORMAT parquet)`);
  for (const t of ["parcels", "businesses", "places", "contractor_ambiguous_links"]) {
    await c.run(`COPY (SELECT 1 AS placeholder) TO ${out(t)} (FORMAT parquet)`);
  }
  c.closeSync();
  inst.closeSync();
  await writeFile(
    path.join(dir, "run.json"),
    JSON.stringify({
      asOf: "2026-10-14",
      run: { run_id: "run-20261014T000000Z", status: "succeeded" },
      sources: [],
      derived: {},
      runHistory: [],
    }),
  );
  await writeFile(path.join(dir, "coverage.json"), JSON.stringify({ properties: 3 }));
  await writeFile(
    path.join(dir, "schema.json"),
    JSON.stringify({ property_leads: { description: "fixture", columns: [] } }),
  );
  return dir;
}
