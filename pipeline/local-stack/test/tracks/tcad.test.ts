// A-04 T025/T028: the Loader `tcad` track and its Query DB tables (0101_tcad.sql), plus the
// report sections `roll` and `confidentiality`. A fake transaction (synthetic test input) models
// the parcels upsert so a re-load of the same chunk writes 0 rows; the real-Postgres case runs
// only when QDB_TEST_URL is set, in a throwaway schema.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { track, PARCEL_COLUMNS } from "../../services/tracks/tcad.js";
import { section as rollSection, confidentialitySection } from "../../services/report-sections/tcad.js";
import { writeChunkFile, type ChunkFile } from "../../../oracle-runtime/travis/tcad/process.js";

const MIGRATION = readFileSync(new URL("../../migrations/0101_tcad.sql", import.meta.url), "utf8");
const norm = MIGRATION.replace(/\s+/g, " ");
const MIGRATION_0102 = readFileSync(new URL("../../migrations/0102_tcad_type_rule.sql", import.meta.url), "utf8");
const norm0102 = MIGRATION_0102.replace(/\s+/g, " ");
const norm0103 = readFileSync(new URL("../../migrations/0103_parcel_type_rules_version.sql", import.meta.url), "utf8").replace(/\s+/g, " ");
const JOB = "travis-a04-pilot-202610220100";
const EXPORT = "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346";

function parcel(id: string, sha = "b".repeat(64), over: Record<string, unknown> = {}) {
  return {
    request_identifier: id, job_id: JOB, geo_id: `0${id}`, prop_type: "R", state_cd: "A1",
    property_type: "SingleFamily", property_usage_type: "Residential", property_type_missing_reason: null,
    property_type_rule: "state_code_table", property_type_note: null, property_type_rules_version: "property_type_rules@2026-10-22",
    situs_address: { text: "1 SYNTHETIC ST, AUSTIN, TX 78701" }, owner_name: "SYNTHETIC OWNER LLC",
    owner_kind: "company", owner_missing_reason: null, owner_redacted: false, owner_redaction_rule: null,
    owner_mailing_postal_code: "78701", owner_mailing_country: null, owner_area_class: "in_county",
    owner_is_out_of_area: false, owner_area_evidence: "travis_zcta", area_list_sha256: "0".repeat(64),
    property_structure_built_year: 1990, year_built_rule: "profile_main", year_built_missing_reason: null,
    roof_age_basis: null, roof_age_reason: null, last_ownership_transfer_date: "2015-07-07",
    tenure_years: 11.3, tenure_basis: "sale_date", tenure_missing_reason: null, is_long_tenure: true,
    export_point_lat: 30.25, export_point_lon: -97.76, export_point_kind: "real", county_emit: true,
    source_url: "https://traviscad.org/x.zip", captured_at: "2026-10-19T21:33:41.241Z", export_sha256: EXPORT,
    record_ordinal: Number(id), record_sha256: sha, payload_redacted: { pID: Number(id) }, ...over,
  };
}

function chunk(ids: string[], sha?: string): ChunkFile {
  return {
    rows: ids.map((id) => ({
      parcel: parcel(id, sha) as never,
      geoids: [{ geo_id: `0${id}`, request_identifier: id, prop_type: "R" }],
      structures: [{ request_identifier: id, ordinal: 0, imprv_type: "01", is_main_residential: true, living_area: 1200, actual_year_built: 1990, effective_year_built: 1995 }],
    })),
    reconciliation: ids.map((id) => ({ job_id: JOB, record_ordinal: Number(id), request_identifier: id, geo_id: `0${id}`, class: "loaded" as const, detail: null })),
  };
}

/** In-memory parcels / reconciliation / watermark model behind tx.unsafe (synthetic). */
function fakeTx() {
  const parcels = new Map<string, Record<string, unknown>>();
  const recon = new Map<string, unknown>();
  const statements: string[] = [];
  let watermark: { value: unknown; job_id: string } | null = null;
  const unsafe = async (text: string, params: unknown[] = []) => {
    statements.push(text);
    const cols = /^INSERT INTO (\w+) \(([^)]+)\)/.exec(text);
    if (cols && cols[1] === "parcels") {
      const names = (cols[2] as string).split(", ");
      const out: Array<{ request_identifier: string }> = [];
      for (let i = 0; i < params.length; i += names.length) {
        const row = Object.fromEntries(names.map((n, j) => [n, params[i + j]]));
        const prior = parcels.get(row.request_identifier as string);
        if (!prior || prior.record_sha256 !== row.record_sha256 || prior.job_id !== row.job_id) {
          parcels.set(row.request_identifier as string, row);
          out.push({ request_identifier: row.request_identifier as string });
        }
      }
      return out;
    }
    if (cols && cols[1] === "roll_reconciliation") {
      const names = (cols[2] as string).split(", ");
      const out = [];
      for (let i = 0; i < params.length; i += names.length) {
        const key = `${params[i]}|${params[i + 1]}`;
        if (!recon.has(key)) {
          recon.set(key, true);
          out.push({});
        }
      }
      return out;
    }
    if (text.startsWith("SELECT value, job_id FROM watermarks")) return watermark ? [watermark] : [];
    return [];
  };
  const tx = { unsafe, json: (v: unknown) => v } as unknown as postgres.TransactionSql;
  return { tx, parcels, recon, statements, setWatermark: (w: typeof watermark) => (watermark = w) };
}

function chunkInput(c: ChunkFile) {
  const dir = mkdtempSync(join(tmpdir(), "a04-track-"));
  const path = join(dir, "c0.ndjson.gz");
  const sha = writeChunkFile(path, c);
  return { jobId: JOB, artifactPath: path, artifactSha256: sha, op: { kind: "chunk" as const } };
}

describe("T025 0101_tcad.sql", () => {
  it("creates parcels, parcel_geoids, property_structures and roll_reconciliation", () => {
    for (const t of ["parcels", "parcel_geoids", "property_structures", "roll_reconciliation"]) {
      expect(norm).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
  });

  it("parcels holds every data-model column", () => {
    for (const c of PARCEL_COLUMNS) expect(`${norm} ${norm0102} ${norm0103}`).toMatch(new RegExp(`\\b${c} [a-z]`));
  });

  it("closed lists and the redaction rule are CHECK constraints", () => {
    expect(norm).toContain("CHECK (class IN ('loaded', 'dead', 'invalid', 'transform_failure'))");
    expect(norm).toContain("CHECK (prop_type IN ('R', 'P', 'MH', 'MN'))");
    expect(norm).toContain("CHECK (owner_redaction_rule IN ('sales_confidential_code'))");
    expect(norm).toContain("CHECK (year_built_rule IN ('profile_main', 'largest_main_improvement', 'none'))");
    expect(norm).toContain("CHECK (export_point_kind IN ('real', 'placeholder', 'duplicate', 'outside_county'))");
    expect(norm).toMatch(/CHECK \(NOT owner_redacted OR \(owner_name IS NULL .*owner_missing_reason = 'owner_confidential'/);
    expect(norm).not.toMatch(/'confidential'\)/);
  });
});

describe("0102_tcad_type_rule.sql (property_type evidence)", () => {
  it("adds property_type_rule and property_type_note as a new migration, closed rule list", () => {
    expect(norm0102).toContain("ALTER TABLE parcels");
    expect(norm0102).toMatch(/ADD COLUMN IF NOT EXISTS property_type_rule text/);
    expect(norm0102).toMatch(/ADD COLUMN IF NOT EXISTS property_type_note text/);
    expect(norm0102).toContain("CHECK (property_type_rule IN ('state_code_table', 'improvement_fallback'))");
    expect(PARCEL_COLUMNS).toContain("property_type_rule");
    expect(PARCEL_COLUMNS).toContain("property_type_note");
  });
});

describe("T025 Loader track tcad", () => {
  it("merges with ON CONFLICT (request_identifier) … IS DISTINCT FROM: a re-load writes 0 rows", async () => {
    const db = fakeTx();
    const input = track.input.parse(chunkInput(chunk(["101", "102"])));
    const first = await track.merge(db.tx, input);
    expect(first.rowsWritten).toBe(2);
    const second = await track.merge(db.tx, input);
    expect(second.rowsWritten).toBe(0);
    const upsert = db.statements.find((s) => s.startsWith("INSERT INTO parcels")) ?? "";
    expect(upsert).toContain("ON CONFLICT (request_identifier) DO UPDATE");
    expect(upsert).toContain("WHERE (parcels.record_sha256, parcels.job_id) IS DISTINCT FROM (excluded.record_sha256, excluded.job_id)");
    const changed = await track.merge(db.tx, track.input.parse(chunkInput(chunk(["101"], "c".repeat(64)))));
    expect(changed.rowsWritten).toBe(1);
  });

  it("stores payload_redacted + record_sha256, never a payload column", async () => {
    const db = fakeTx();
    await track.merge(db.tx, track.input.parse(chunkInput(chunk(["103"]))));
    const row = db.parcels.get("103") as Record<string, unknown>;
    expect(row.record_sha256).toBe("b".repeat(64));
    // The jsonb parameter is JSON text bound as text and cast server-side (`$n::text::jsonb`); a
    // JSON string bound straight to a jsonb parameter is encoded a second time by the driver and
    // lands as a jsonb string (the live double-encoding bug).
    expect(JSON.parse(row.payload_redacted as string)).toEqual({ pID: 103 });
    expect(JSON.parse(row.situs_address as string)).toEqual({ text: "1 SYNTHETIC ST, AUSTIN, TX 78701" });
    const insert = db.statements.find((s) => s.startsWith("INSERT INTO parcels")) ?? "";
    expect(insert).toMatch(/\$\d+::text::jsonb/);
    expect(insert).not.toMatch(/\$\d+::jsonb/);
    expect(Object.keys(row)).not.toContain("payload");
    expect(PARCEL_COLUMNS).not.toContain("payload");
  });

  it("watermark {prefix, mergedCount, lastMergedAt, hashIndex} counts loaded records of the job", async () => {
    const db = fakeTx();
    const a = track.input.parse(chunkInput(chunk(["201", "202"])));
    const out = await track.merge(db.tx, a);
    expect(out.watermark?.sourceKey).toBe("tcad-certified");
    expect(out.watermark?.value).toMatchObject({ prefix: `runs/${JOB}/chunks/`, mergedCount: 2 });
    db.setWatermark({ value: out.watermark?.value, job_id: JOB });
    const out2 = await track.merge(db.tx, track.input.parse(chunkInput(chunk(["203"]))));
    const v = out2.watermark?.value as { mergedCount: number; hashIndex: unknown[]; lastMergedAt: string };
    expect(v.mergedCount).toBe(3);
    expect(v.hashIndex).toHaveLength(2);
    expect(Date.parse(v.lastMergedAt)).not.toBeNaN();
  });

  it("refuses a chunk whose bytes do not match artifactSha256", async () => {
    const db = fakeTx();
    const input = chunkInput(chunk(["301"]));
    await expect(track.merge(db.tx, track.input.parse({ ...input, artifactSha256: "d".repeat(64) }))).rejects.toThrow(/sha256/);
  });

  it("run, receipt and limitation ops write bookkeeping rows only", async () => {
    const db = fakeTx();
    const op = { kind: "run" as const, track: "appraisal" as const, mode: "pilot" as const, status: "waiting_human" as const };
    const sha = createHash("sha256").update(JSON.stringify(op)).digest("hex");
    const out = await track.merge(db.tx, track.input.parse({ jobId: JOB, artifactPath: "op:run", artifactSha256: sha, op }));
    expect(out.rowsWritten).toBe(1);
    expect(db.statements.some((s) => s.startsWith("INSERT INTO backbone_runs"))).toBe(true);
    expect(db.parcels.size).toBe(0);
  });
});

describe("T028 report sections roll and confidentiality", () => {
  const fakeSql = (rows: Record<string, unknown[]>) =>
    (async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      for (const [k, v] of Object.entries(rows)) if (text.includes(k)) return v;
      return [];
    }) as unknown as postgres.Sql;

  it("roll: n, by_prop_type, classes, difference and unexplained (counts only)", async () => {
    const sql = fakeSql({
      "GROUP BY class": [{ class: "loaded", n: 4 }, { class: "dead", n: 1 }],
      "GROUP BY prop_type": [{ prop_type: "R", n: 3 }, { prop_type: "P", n: 1 }],
      "FROM backbone_runs": [{ export_sha256: EXPORT }],
      "FROM watermarks": [{ value: { keyInventorySha256: "e".repeat(64) } }],
    });
    expect(rollSection.key).toBe("roll");
    const r = await rollSection.build(sql, JOB);
    expect(r).toEqual({
      n: 5, by_prop_type: { R: 3, P: 1 }, loaded: 4, dead: 1, invalid: 0, transform_failure: 0,
      difference: 1, difference_pct: 20, unexplained: 0, export_sha256: EXPORT, key_inventory_sha256: "e".repeat(64),
    });
  });

  it("confidentiality: redacted count and rule", async () => {
    const sql = fakeSql({ "owner_redacted": [{ n: 2 }] });
    expect(confidentialitySection.key).toBe("confidentiality");
    expect(await confidentialitySection.build(sql, JOB)).toEqual({ redacted: 2, rule: "sales_confidential_code" });
  });
});

const QDB = process.env.QDB_TEST_URL;
describe.skipIf(!QDB)("T025 tcad track against the Query DB (QDB_TEST_URL, throwaway schema)", () => {
  it("applies 0000 + 0101 and re-loads a chunk writing 0 rows", async () => {
    const schema = `a04_tcad_${Date.now().toString(36)}`;
    const admin = postgres(QDB ?? "", { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const sql = postgres(QDB ?? "", { max: 1, onnotice: () => {}, connection: { search_path: schema } });
    try {
      await sql.unsafe(readFileSync(new URL("../../migrations/0000_core.sql", import.meta.url), "utf8"));
      await sql.unsafe(MIGRATION);
      const input = track.input.parse(chunkInput(chunk(["401", "402"])));
      expect((await sql.begin((tx) => track.merge(tx, input))).rowsWritten).toBe(2);
      expect((await sql.begin((tx) => track.merge(tx, input))).rowsWritten).toBe(0);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
