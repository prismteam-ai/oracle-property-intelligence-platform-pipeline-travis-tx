// A-04: the tracks against a REAL Postgres in a throwaway database. The unit tests use a fake sql
// and could not see the jsonb double-encoding bug (JSON text bound to a jsonb parameter landed as a
// jsonb string). Runs only when QDB_ADMIN_URL (a server URL with CREATEDB rights, e.g.
// postgres://user:***@localhost:5432/postgres) is set; skipped otherwise. It creates
// `a04_test_<random>`, applies every migration through services/migrate.ts, merges synthetic TCAD
// parcels, permits and a GIS assembly through the Loader, and drops the database in `finally`.
// It never touches any other database. Synthetic test input only.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { writeChunkFile, type ChunkFile } from "../../oracle-runtime/travis/tcad/process.js";
import { buildLinkIndex, permitSignature } from "../../oracle-runtime/travis/permits/link.js";
import { inputDigest } from "../../oracle-runtime/travis/permits/merge-input.js";
import { runMerge } from "../services/loader.js";
import { MIGRATIONS_DIR, migrate, postgresMigrationStore, readMigrations } from "../services/migrate.js";
import { track as gisTrack } from "../services/tracks/gis.js";
import { situsOf, track as permitsTrack } from "../services/tracks/permits.js";
import { track as tcadTrack } from "../services/tracks/tcad.js";

const ADMIN = process.env.QDB_ADMIN_URL;
const TCAD_JOB = "travis-a04-itest-pilot-202610220100";
const PERMITS_JOB = "travis-a04-itest-permits-202610220300";
const LINK_JOB = "travis-a04-itest-link-202610220400";
const GIS_JOB = "travis-a04-itest-coords-202610220500";
const EXPORT = "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346";
const situs = (num: string, name: string) => ({ street_number: num, street_name: name, street_suffix: "ST", zip: "78701", state: "TX" });
/** pID → [geoID, situs]. 9003 and 9004 share one geoID (condo-style); each prints its own street number. */
const PARCELS: Record<string, [string, ReturnType<typeof situs>]> = {
  "9001": ["09001", situs("100", "ALPHA")],
  "9002": ["09002", situs("200", "BETA")],
  "9003": ["0SHARED", situs("300", "GAMMA")],
  "9004": ["0SHARED", situs("302", "GAMMA")],
};

function parcel(id: string): Record<string, unknown> {
  const [geo, addr] = PARCELS[id] as [string, ReturnType<typeof situs>];
  return {
    request_identifier: id, job_id: TCAD_JOB, geo_id: geo, prop_type: "R", state_cd: "A1",
    property_type: "SingleFamily", property_usage_type: "Residential", property_type_missing_reason: null,
    property_type_rule: "state_code_table", property_type_note: null, property_type_rules_version: "property_type_rules@2026-10-22",
    situs_address: addr, owner_name: "SYNTHETIC OWNER LLC",
    owner_kind: "company", owner_missing_reason: null, owner_redacted: false, owner_redaction_rule: null,
    owner_mailing_postal_code: "78701", owner_mailing_country: null, owner_area_class: "in_county",
    owner_is_out_of_area: false, owner_area_evidence: "travis_zcta", area_list_sha256: "0".repeat(64),
    property_structure_built_year: 1990, year_built_rule: "profile_main", year_built_missing_reason: null,
    roof_age_basis: null, roof_age_reason: null, last_ownership_transfer_date: "2015-07-07",
    tenure_years: 11.3, tenure_basis: "sale_date", tenure_missing_reason: null, is_long_tenure: true,
    export_point_lat: 30.25, export_point_lon: -97.76, export_point_kind: "real", county_emit: true,
    source_url: "https://traviscad.org/x.zip", captured_at: "2026-10-19T21:33:41.241Z", export_sha256: EXPORT,
    record_ordinal: Number(id), record_sha256: "b".repeat(64), payload_redacted: { pID: Number(id), note: "synthetic" },
  };
}

function chunkFile(dir: string): { path: string; sha: string } {
  const ids = Object.keys(PARCELS);
  const c: ChunkFile = {
    rows: ids.map((id) => ({
      parcel: parcel(id) as never,
      geoids: [{ geo_id: (PARCELS[id] as [string])[0], request_identifier: id, prop_type: "R" }],
      structures: [{ request_identifier: id, ordinal: 0, imprv_type: "01", is_main_residential: true, living_area: 1200, actual_year_built: 1990, effective_year_built: 1995 }],
    })),
    reconciliation: ids.map((id) => ({ job_id: TCAD_JOB, record_ordinal: Number(id), request_identifier: id, geo_id: (PARCELS[id] as [string])[0], class: "loaded" as const, detail: null })),
  };
  const path = join(dir, "c0.ndjson.gz");
  return { path, sha: writeChunkFile(path, c) };
}

/** [permit number, tcad_id, original_address1]: one row per linking scenario. */
const PERMITS: Array<[string, string | null, string]> = [
  ["2026-000001 BP", null, "100 ALPHA ST"], // no tcad_id, unique address → address_hash
  ["2026-000002 BP", "0SHARED", "302 GAMMA ST"], // shared geoID, one address → geoid_plus_address
  ["2026-000003 BP", "0999999999", "200 BETA ST"], // retired tcad_id, unique address → address fallback
  ["2026-000004 BP", null, "ALPHA ST"], // no street number → unmatched
  ["2026-000005 BP", "0888888888", "9 NOWHERE ST"], // retired tcad_id, no address match → no_tcad_geoid
  ["2026-000006 BP", "09002", "100 ALPHA ST"], // resolving tcad_id is never overridden by the address
];

function permitPage(dir: string) {
  const rows = PERMITS.map(([number, tcad, address], i) => ({
    ":id": `row-${i + 1}`, ":updated_at": "2026-10-01T00:00:00.000Z", permit_number: number, permittype: "BP",
    work_class: "Remodel", description: "SYNTHETIC TEST INPUT", status_current: "Active",
    issue_date: "2026-09-01T00:00:00.000", jurisdiction: "AUSTIN FULL PURPOSE",
    original_address1: address, original_zip: "78701", original_state: "TX", latitude: "30.1", longitude: "-97.7",
    ...(tcad === null ? {} : { tcad_id: tcad }),
  }));
  const body = Buffer.from(JSON.stringify(rows));
  const sha = createHash("sha256").update(body).digest("hex");
  mkdirSync(join(dir, "raw", "pages"), { recursive: true });
  const path = join(dir, "raw", "pages", "page-000001.json.gz");
  writeFileSync(path, gzipSync(body));
  const receipt = {
    source: "austin-3syk-w9eu", kind: "page", page_index: 1,
    url: "https://data.austintexas.gov/resource/3syk-w9eu.json?%24select=*", method: "GET", http_status: 200,
    bytes: body.length, sha256: sha, captured_at: "2026-10-22T03:00:01.000Z", outcome: "ok", blocked_reason: null,
    blocked_at: null, attempts: 1, ua: "oracle-travis-discovery/0.1", app_token_used: false, rows: rows.length,
    last_id: `row-${rows.length}`, file: "raw/pages/page-000001.json.gz",
  };
  const receiptsPath = join(dir, "receipts.jsonl");
  writeFileSync(receiptsPath, `${JSON.stringify(receipt)}\n`);
  return { path, sha, receiptsPath, rows: rows.length };
}

function urlFor(admin: string, database: string): string {
  const u = new URL(admin);
  u.pathname = `/${database}`;
  return u.toString();
}

describe.skipIf(ADMIN === undefined || ADMIN === "")("A-04 tracks against a real Postgres (QDB_ADMIN_URL, throwaway database)", () => {
  it("writes jsonb OBJECTS, links an address-only permit, and 0104 repairs string-typed values", async () => {
    const adminUrl = ADMIN ?? "";
    const database = `a04_test_${randomBytes(6).toString("hex")}`;
    const dir = mkdtempSync(join(tmpdir(), "a04-real-pg-"));
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    let sql: postgres.Sql | null = null;
    try {
      await admin.unsafe(`CREATE DATABASE ${database}`);
      sql = postgres(urlFor(adminUrl, database), { max: 2, onnotice: () => {} });
      const db = sql;
      const migrated = await migrate(postgresMigrationStore(db), readMigrations(MIGRATIONS_DIR));
      expect(migrated.applied).toContain("0104_fix_double_encoded_json.sql");

      // TCAD: parcels, the run, a watermark
      const chunk = chunkFile(dir);
      await runMerge(db, tcadTrack, { jobId: TCAD_JOB, artifactPath: chunk.path, artifactSha256: chunk.sha, op: { kind: "chunk" } });
      await runMerge(db, tcadTrack, {
        jobId: TCAD_JOB, artifactPath: `run:${TCAD_JOB}:complete`, artifactSha256: inputDigest({ TCAD_JOB, s: "complete" }),
        op: { kind: "run", track: "appraisal", mode: "pilot", status: "complete", as_of: "2026-10-22" },
      });
      const parcelTypes = await db`
        SELECT jsonb_typeof(situs_address) AS situs, jsonb_typeof(payload_redacted) AS payload,
               situs_address->>'street_number' AS num, payload_redacted->>'note' AS note
        FROM parcels WHERE request_identifier = '9001'`;
      expect(parcelTypes[0]).toEqual({ situs: "object", payload: "object", num: "100", note: "synthetic" });

      // permits: a page without a tcad_id, then the link (address fallback only)
      const page = permitPage(dir);
      await runMerge(db, permitsTrack, {
        kind: "run_start", jobId: PERMITS_JOB, mode: "backfill", artifactPath: `run:${PERMITS_JOB}:start`,
        artifactSha256: inputDigest({ PERMITS_JOB, s: "start" }), startedAt: "2026-10-22T03:00:00.000Z", profileSha256: "c".repeat(64),
      });
      await runMerge(db, permitsTrack, {
        kind: "page", jobId: PERMITS_JOB, mode: "backfill", artifactPath: page.path, artifactSha256: page.sha,
        pageIndex: 1, rows: page.rows, receiptsPath: page.receiptsPath,
      });
      const payloadType = await db`SELECT jsonb_typeof(payload) AS t FROM permit_source_rows`;
      expect(payloadType.map((r) => r.t)).toEqual(PERMITS.map(() => "object"));

      await runMerge(db, permitsTrack, {
        kind: "link", jobId: LINK_JOB, mode: "link", artifactPath: `run:${LINK_JOB}:link`,
        artifactSha256: inputDigest({ LINK_JOB, l: 1 }), asOf: "2026-10-22",
      });
      const linked = await db`
        SELECT permit_number, request_identifier, link_method, link_rule, unmatched_reason, stale_tcad_id
        FROM property_improvements ORDER BY permit_number`;
      const byPermit = Object.fromEntries(linked.map((r) => [r.permit_number as string, r]));
      try {
        expect(byPermit["2026-000001 BP"]).toMatchObject({ request_identifier: "9001", link_method: "address_hash", link_rule: "address_sig_v1", stale_tcad_id: false });
        expect(byPermit["2026-000002 BP"]).toMatchObject({ request_identifier: "9004", link_method: "tcad_id", link_rule: "geoid_plus_address", stale_tcad_id: false });
        expect(byPermit["2026-000003 BP"]).toMatchObject({ request_identifier: "9002", link_method: "address_hash", link_rule: "address_sig_v1", stale_tcad_id: true });
        expect(byPermit["2026-000004 BP"]).toMatchObject({ request_identifier: null, link_method: null });
        expect(byPermit["2026-000004 BP"]?.unmatched_reason).not.toBeNull();
        expect(byPermit["2026-000005 BP"]).toMatchObject({ request_identifier: null, unmatched_reason: "no_tcad_geoid", stale_tcad_id: false });
        expect(byPermit["2026-000006 BP"]).toMatchObject({ request_identifier: "9002", link_method: "tcad_id", link_rule: "geoid_unique_r", stale_tcad_id: false });
      } catch (error) {
        const index = buildLinkIndex(
          (await db`SELECT request_identifier, geo_id, prop_type, situs_address FROM parcels`).map((p) => ({
            requestIdentifier: p.request_identifier as string, geoId: p.geo_id as string | null, propType: p.prop_type as string, situs: situsOf(p.situs_address),
          })),
        );
        const detail = {
          parcelIndexGeoIds: index.byGeoId.size,
          parcelSignatures: [...index.bySignature].map(([sig, ids]) => `${sig.slice(0, 12)}=${ids.join("|")}`),
          permitSignatures: PERMITS.map(([n, , a]) => `${n}=${(permitSignature({ tcadId: null, address1: a, zip: "78701", state: "TX" }) ?? "null").slice(0, 12)}`),
          linked,
        };
        process.stderr.write(`link diagnostics: ${JSON.stringify(detail)}\n`);
        throw error;
      }

      // GIS assembly (its watermark and coordinate writes use tx.json)
      await runMerge(db, gisTrack, {
        kind: "assemble", jobId: GIS_JOB, artifactPath: `run:${GIS_JOB}:assemble`,
        artifactSha256: inputDigest({ GIS_JOB, a: 1 }), tcadJobId: TCAD_JOB,
      });

      // every watermark value is a jsonb object
      const marks = await db`SELECT track, jsonb_typeof(value) AS t FROM watermarks`;
      expect(marks.length).toBeGreaterThan(0);
      expect(marks.every((m) => m.t === "object")).toBe(true);

      // 0104: string-typed values (the old shape) become objects; invalid inner text is left alone
      await db`
        UPDATE parcels SET situs_address = to_jsonb(situs_address::text), payload_redacted = to_jsonb(payload_redacted::text)
        WHERE request_identifier = '9001'`;
      await db`UPDATE parcels SET situs_address = to_jsonb('not json'::text) WHERE request_identifier = '9002'`;
      const fix = readFileSync(join(MIGRATIONS_DIR, "0104_fix_double_encoded_json.sql"), "utf8");
      await db.unsafe(fix);
      await db.unsafe(fix); // idempotent
      const after = await db`
        SELECT request_identifier, jsonb_typeof(situs_address) AS situs, jsonb_typeof(payload_redacted) AS payload
        FROM parcels ORDER BY request_identifier`;
      expect(after).toEqual([
        { request_identifier: "9001", situs: "object", payload: "object" },
        { request_identifier: "9002", situs: "string", payload: "object" },
        { request_identifier: "9003", situs: "object", payload: "object" },
        { request_identifier: "9004", situs: "object", payload: "object" },
      ]);
    } finally {
      if (sql !== null) await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
