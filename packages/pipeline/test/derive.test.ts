import { describe, expect, it } from "vitest";
import { Db } from "../src/core/db.js";
import { migrate } from "../src/core/schema.js";
import { derive } from "../src/model/derive.js";

const prov = (id: string) => `'src', '${id}', NULL, NULL, now(), 'h', 'r1', 'r1', 'r1', false`;

describe("derive", () => {
  it("links permits to parcels and scopes unlinked permits to the county polygon", async () => {
    const db = await Db.open(":memory:", { extensions: ["spatial"] });
    await migrate(db);
    await db.exec(
      `INSERT INTO county_boundary VALUES ('48453', 'Travis', ST_GeomFromText('POLYGON((-98 30, -97 30, -97 31, -98 31, -98 30))'), ${prov("48453")})`,
    );
    await db.exec(`INSERT INTO parcels (prop_id, geo_id, situs_number, mail_state, mail_zip, situs_zip, latitude, longitude,
        source_id, source_record_id, source_url, raw_sha256, collected_at, record_hash, first_seen_run, last_seen_run, last_changed_run, is_deleted)
      VALUES ('1', '0000000001', '10', 'CA', '90001', '78701', 30.5, -97.5, ${prov("1")}),
             ('2', '0000000002', '20', 'TX', '78701', '78701', 30.6, -97.6, ${prov("2")})`);
    await db.exec(`INSERT INTO parcel_geometries VALUES
      ('1', ST_GeomFromText('POLYGON((-97.51 30.49, -97.49 30.49, -97.49 30.51, -97.51 30.51, -97.51 30.49))'), 'g1'),
      ('2', ST_GeomFromText('POLYGON((-97.61 30.59, -97.59 30.59, -97.59 30.61, -97.61 30.61, -97.61 30.59))'), 'g2')`);
    const permit = (
      n: string,
      tcad: string | null,
      lat: number,
      lon: number,
      desc: string,
      status: string,
      roof: boolean,
      work = "Repair",
      completed: string | null = null,
    ) =>
      `INSERT INTO permits (permit_number, permit_type, work_class, description, status, issued_date, completed_date, status_date, tcad_id, latitude, longitude,
         contractor_company_name, is_roofing, roofing_match, is_open, source_id, source_record_id, source_url, raw_sha256, collected_at, record_hash,
         first_seen_run, last_seen_run, last_changed_run, is_deleted)
       VALUES ('${n}', 'BP', '${work}', '${desc}', '${status}', DATE '2010-01-01', ${completed ? `DATE '${completed}'` : "NULL"}, DATE '2010-01-02',
         ${tcad ? `'${tcad}'` : "NULL"}, ${lat}, ${lon}, 'Acme Roofing LLC', ${roof}, ${roof ? "'roof_replacement'" : "NULL"},
         ${status === "Active"}, ${prov(n)})`;
    await db.exec(
      permit("A", "0000000001", 30.5, -97.5, "Reroof", "Final", true, "Repair", "2005-06-01"),
    );
    await db.exec(permit("B", null, 30.6, -97.6, "Reroof", "Active", true));
    await db.exec(permit("C", null, 30.8, -97.2, "Reroof", "Active", true));
    await db.exec(permit("D", null, 32.0, -95.0, "Reroof", "Active", true));
    const stats = await derive(db, { fips: "48453", asOf: "2026-10-14" });
    const scope = await db.all(
      `SELECT permit_number, prop_id, match_method, in_county FROM permit_scope ORDER BY permit_number`,
    );
    expect(scope).toEqual([
      { permit_number: "A", prop_id: "1", match_method: "tcad_geo_id", in_county: true },
      { permit_number: "B", prop_id: "2", match_method: "point_in_parcel", in_county: true },
      { permit_number: "C", prop_id: null, match_method: null, in_county: true },
      { permit_number: "D", prop_id: null, match_method: null, in_county: false },
    ]);
    expect(stats.roofing_permits_in_county).toBe(3);
    const lead = await db.one(
      `SELECT roof_year, roof_age_basis, roof_age_years, owner_location_class FROM property_leads WHERE prop_id = '1'`,
    );
    expect(lead).toEqual({
      roof_year: 2005,
      roof_age_basis: "final_roof_replacement_permit",
      roof_age_years: 21,
      owner_location_class: "out_of_state",
    });
    db.close();
  });
});
