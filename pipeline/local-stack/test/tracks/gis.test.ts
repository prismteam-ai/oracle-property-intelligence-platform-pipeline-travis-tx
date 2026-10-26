// A-04 T043 / T044 / T045: the 0201_gis migration (SQL text), the Loader `gis` track (import and
// assemble merges over an in-memory store), Loader idempotency by artifact sha256, and the
// `coordinates` report section. Offline; every artifact and row is SYNTHETIC TEST INPUT.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { runMerge } from "../../services/loader.js";
import {
  mergeGis,
  track,
  type GisStore,
  type GisTrackInput,
} from "../../services/tracks/gis.js";

const SQL = readFileSync(new URL("../../migrations/0201_gis.sql", import.meta.url), "utf8");
const flat = SQL.replace(/--.*$/gm, "").replace(/\s+/g, " ");
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("A-04 T043 0201_gis.sql (data-model.md § 0201)", () => {
  it("creates gis_pages with PK (artifact_run_id, page_key)", () => {
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS gis_pages \(/);
    for (const c of ["job_id text", "page_key text", "artifact_run_id text", "url text", "sha256 text", "captured_at timestamptz", "feature_count int"]) {
      expect(flat).toContain(c);
    }
    expect(flat).toMatch(/PRIMARY KEY \(artifact_run_id, page_key\)/);
  });

  it("creates gis_features keyed by object_id with the closed point_method list", () => {
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS gis_features \(/);
    expect(flat).toMatch(/object_id bigint PRIMARY KEY/);
    for (const c of ["pid_value text", "geoid_value text", "area double precision", "point_lat double precision", "point_lon double precision", "null_geometry bool", "layer_last_edit_date timestamptz"]) {
      expect(flat).toContain(c);
    }
    expect(flat).toMatch(/point_method text CHECK \(point_method IN \('centroid', 'interior_point', 'centroid_outside_polygon'\)\)/);
  });

  it("ALTER TABLE parcels ADDs the ten coordinate columns with their closed lists and the none ⇔ null ⇔ reason rule", () => {
    expect(flat).toMatch(/ALTER TABLE parcels/);
    for (const c of [
      "latitude double precision",
      "longitude double precision",
      "coordinate_source text",
      "coordinate_rule text",
      "coordinate_reason text",
      "coordinate_review_flag text",
      "coordinate_source_url text",
      "coordinate_captured_at timestamptz",
      "coordinate_sha256 text",
      "coordinate_job_id text",
    ]) {
      expect(flat).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
    expect(flat).toContain("coordinate_source IN ('gis_centroid', 'permit_point', 'none')");
    expect(flat).toContain(
      "coordinate_rule IN ('centroid', 'interior_point', 'centroid_outside_polygon', 'largest_area', 'export_point', 'condo_building_point', 'permit_point')",
    );
    expect(flat).toContain(
      "coordinate_reason IN ('no_gis_feature', 'gis_null_geometry', 'no_permit_point', 'non_land_account')",
    );
    expect(flat).toContain("coordinate_review_flag IN ('permit_far_from_gis')");
    expect(flat).toContain("(coordinate_source = 'none') = (latitude IS NULL)");
    expect(flat).toContain("(latitude IS NULL) = (coordinate_reason IS NOT NULL)");
    // migrate.ts owns the transaction
    expect(SQL).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });
});

/** In-memory GisStore: records what the track writes. */
function memoryStore(seed: Partial<Awaited<ReturnType<GisStore["readAssembly"]>>> = {}) {
  const s = {
    runs: [] as Array<Record<string, unknown>>,
    receipts: [] as Array<Record<string, unknown>>,
    pages: [] as Array<Record<string, unknown>>,
    features: [] as Array<Record<string, unknown>>,
    limitations: [] as Array<Record<string, unknown>>,
    coordinates: [] as Array<Record<string, unknown>>,
    flags: [] as Array<Record<string, unknown>>,
  };
  const store: GisStore = {
    upsertRun: async (r) => void s.runs.push(r),
    insertReceipts: async (rows) => (s.receipts.push(...rows), rows.length),
    upsertPages: async (rows) => (s.pages.push(...rows), rows.length),
    upsertFeatures: async (rows) => (s.features.push(...rows), rows.length),
    addLimitation: async (r) => void s.limitations.push(r),
    readAssembly: async () => ({ parcels: [], geoids: [], features: [], permits: [], ...seed }),
    writeCoordinates: async (rows) => (s.coordinates.push(...rows), rows.length),
    flagPermits: async (rows) => (s.flags.push(...rows), rows.length),
    replaceAddressPoints: async (records) => records.length,
  };
  return { store, s };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LAYER = "https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6";
const UA = "oracle-travis-discovery/0.1 (synthetic)";

/** A minimal synthetic runner artifact (two features on one page), complete or blocked. */
function artifact(opts: { complete: boolean }): string {
  const parent = mkdtempSync(join(tmpdir(), "a04-gis-track-"));
  dirs.push(parent);
  const dir = join(parent, "us-runner-777");
  mkdirSync(join(dir, "pages"), { recursive: true });
  const sq = (x: number) => [[[-97.75 + x, 30.25], [-97.75 + x, 30.2501], [-97.7499 + x, 30.2501], [-97.7499 + x, 30.25], [-97.75 + x, 30.25]]];
  const page = JSON.stringify({
    features: [
      { attributes: { OBJECTID: 1, PROP_ID: "91", GEO_ID: "01" }, geometry: { rings: sq(0) } },
      { attributes: { OBJECTID: 2, PROP_ID: "92", GEO_ID: "02" }, geometry: null },
    ],
  });
  const key = sha("page-1");
  writeFileSync(join(dir, "egress.txt"), "loc=US\n");
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ fields: [{ name: "OBJECTID" }, { name: "PROP_ID" }, { name: "GEO_ID" }] }));
  writeFileSync(join(dir, "count.json"), JSON.stringify({ count: 2 }));
  writeFileSync(join(dir, "ids.json"), JSON.stringify({ objectIds: [1, 2] }));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ mode: "full", layerUrl: LAYER, pidField: "PROP_ID", geoidField: "GEO_ID", objectIdField: "OBJECTID", layerLastEditDate: "2026-10-01T00:00:00.000Z" }),
  );
  writeFileSync(join(dir, "pages", `${key}.json`), page);
  const receipt = {
    url: `${LAYER}/query?f=json&outFields=OBJECTID%2CPROP_ID`,
    http_status: 200,
    bytes: page.length,
    sha256: sha(page),
    captured_at: "2026-10-22T03:00:00.000Z",
    outcome: "ok",
    attempts: 1,
    ua: UA,
    page_key: key,
    kind: "page",
  };
  const lines = [receipt];
  if (!opts.complete) {
    lines.push({ ...receipt, url: `${LAYER}/query?f=json&objectIds=3,4`, page_key: sha("page-2"), outcome: "blocked", http_status: 403, blocked_at: "2026-10-22T03:05:00.000Z" } as typeof receipt);
    writeFileSync(join(dir, "blocked.json"), JSON.stringify({ outcome: "blocked", reason: "http_403", http_status: 403, blocked_at: "2026-10-22T03:05:00.000Z" }));
  } else {
    writeFileSync(
      join(dir, "complete.json"),
      JSON.stringify({
        mode: "full", pages: 1, features: 2, started_at: "2026-10-22T02:59:00.000Z", finished_at: "2026-10-22T03:01:00.000Z",
        duration_s: 120, features_per_s: 0.02, snapshot_sha256: sha("snap"), source_count: 2, page_size: 2000, concurrency: 2,
        object_id_field: "OBJECTID", layer_last_edit_date: "2026-10-01T00:00:00.000Z",
      }),
    );
  }
  writeFileSync(join(dir, "receipts.jsonl"), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return dir;
}

async function importInput(dir: string): Promise<GisTrackInput> {
  const { inspectArtifact } = await import("../../../oracle-runtime/travis/gis/import.js");
  const s = inspectArtifact(dir);
  return { kind: "import", jobId: "travis-a04-coords-202610220500", artifactPath: s.root, artifactSha256: s.artifactSha256, artifactRunId: s.artifactRunId };
}

describe("A-04 T043 Loader gis track: import", () => {
  it("a complete artifact writes pages, features (one point each, null geometry kept), receipts and a complete run", async () => {
    const { store, s } = memoryStore();
    const out = await mergeGis(store, await importInput(artifact({ complete: true })));
    expect(s.pages).toHaveLength(1);
    expect(s.features).toHaveLength(2);
    expect(s.features[0]).toMatchObject({ object_id: 1, pid_value: "91", geoid_value: "01", null_geometry: false, point_method: "centroid", artifact_run_id: "777" });
    expect(s.features[1]).toMatchObject({ object_id: 2, null_geometry: true, point_lat: null });
    expect(s.receipts[0]).toMatchObject({ source_key: "tcad_gis", outcome: "ok", job_id: "travis-a04-coords-202610220500" });
    expect(s.runs[0]).toMatchObject({ job_id: "travis-a04-coords-202610220500", status: "complete", mode: "coords" });
    expect(s.limitations).toEqual([]);
    expect(out.rowsWritten).toBe(1 + 2 + 1);
    expect(out.watermark?.sourceKey).toBe("tcad_gis");
  });

  it("DP-5 every imported feature keeps its page provenance: layer query URL (no ids), page sha256, captured_at, receipt path", async () => {
    const { store, s } = memoryStore();
    const out = await mergeGis(store, await importInput(artifact({ complete: true })));
    for (const f of s.features) {
      const page = s.pages.find((p) => p.page_key === f.page_key);
      expect(page, `page of feature ${String(f.object_id)}`).toBeDefined();
      expect(String(page?.url)).toMatch(/\/MapServer\/6\/query\?/);
      expect(String(page?.url)).not.toMatch(/objectIds=/);
      expect(page?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(page?.captured_at).toBe("2026-10-22T03:00:00.000Z");
    }
    const value = out.watermark?.value as { provenance: { query_url: string; pages: Array<Record<string, unknown>> } };
    expect(value.provenance.query_url).toBe(`${LAYER}/query`);
    expect(value.provenance.pages).toEqual([
      expect.objectContaining({
        object_ids_sha256: s.pages[0]?.page_key,
        receipt_path: "receipts.jsonl",
        artifact_file: `pages/${String(s.pages[0]?.page_key)}.json`,
        feature_count: 2,
      }),
    ]);
  });

  it("A-04-TC-026 import: a blocked artifact is recorded as blocked with the exact limitation text", async () => {
    const { store, s } = memoryStore();
    await mergeGis(store, await importInput(artifact({ complete: false })));
    expect(s.runs[0]).toMatchObject({ status: "blocked" });
    expect(s.limitations).toEqual([
      expect.objectContaining({ source_key: "tcad_gis", code: "gis_blocked", text: "gis: blocked at 2026-10-22T03:05:00.000Z; coverage not complete" }),
    ]);
    expect(s.receipts.find((r) => r.outcome === "blocked")).toMatchObject({ blocked_at: "2026-10-22T03:05:00.000Z" });
  });

  it("an artifact changed after inspection is refused (sha256 mismatch)", async () => {
    const { store } = memoryStore();
    const input = await importInput(artifact({ complete: true }));
    await expect(mergeGis(store, { ...input, artifactSha256: "0".repeat(64) })).rejects.toThrow(/sha256/);
  });

  it("the merge is idempotent by (track, artifact_sha256): a second Loader merge writes 0 rows", async () => {
    const merges = new Set<string>();
    let statements = 0;
    const begin = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
      const pending = new Set<string>();
      const tx = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?").replace(/\s+/g, " ").trim();
        statements += 1;
        if (text.startsWith("SELECT 1 FROM loader_merges")) {
          const k = `${String(values[0])}|${String(values[1])}`;
          return merges.has(k) ? [{ x: 1 }] : [];
        }
        if (text.startsWith("INSERT INTO loader_merges")) pending.add(`${String(values[0])}|${String(values[2])}`);
        return Object.assign([], { count: 0 });
      }) as unknown as postgres.TransactionSql;
      Object.assign(tx, { json: (v: unknown) => v });
      const out = await fn(Object.assign(tx, { unsafe: tx }) as postgres.TransactionSql);
      for (const k of pending) merges.add(k);
      return out;
    };
    const sql = { begin } as unknown as postgres.Sql;
    const input = await importInput(artifact({ complete: true }));
    const first = await runMerge(sql, track, input);
    expect(first.skipped).toBe(false);
    const before = statements;
    const again = await runMerge(sql, track, input);
    expect(again).toMatchObject({ skipped: true, rowsWritten: 0 });
    expect(statements - before).toBe(2); // the lock and the loader_merges lookup only
  });
});

describe("A-04 T044 Loader gis track: assemble", () => {
  it("writes one coordinate row per parcel and the far-permit flags; stats kept in the watermark", async () => {
    const { store, s } = memoryStore({
      parcels: [
        { request_identifier: "221829", geo_id: "0223120506", prop_type: "R", export_point_lat: null, export_point_lon: null, export_point_kind: "placeholder", source_url: "https://traviscad.org/x.zip", captured_at: "2026-10-19T21:33:41Z", export_sha256: "e".repeat(64) },
        { request_identifier: "9", geo_id: null, prop_type: "P", export_point_lat: null, export_point_lon: null, export_point_kind: "placeholder", source_url: "https://traviscad.org/x.zip", captured_at: "2026-10-19T21:33:41Z", export_sha256: "e".repeat(64) },
      ],
      features: [
        { object_id: 1, pid_value: "221829", geoid_value: null, area: 1e-6, point_lat: 30.25, point_lon: -97.75, point_method: "centroid", null_geometry: false, page_url: `${LAYER}/query?f=json`, page_captured_at: "2026-10-22T03:00:00Z", page_sha256: "a".repeat(64) },
      ],
      permits: [
        { permit_number: "F", issuing_jurisdiction: "austin", request_identifier: "221829", latitude: 30.27, longitude: -97.75, issue_date: "2020-01-01", source_url: "https://data.austintexas.gov/resource/3syk-w9eu.json", captured_at: "2026-10-22T04:00:00Z", payload_sha256: "p".repeat(64) },
      ],
    });
    const out = await mergeGis(store, {
      kind: "assemble",
      jobId: "travis-a04-coords-202610220600",
      artifactPath: "assemble:travis-a04-coords-202610220600",
      artifactSha256: sha("assemble:travis-a04-coords-202610220600"),
      tcadJobId: null,
    });
    expect(s.coordinates).toHaveLength(2);
    expect(s.coordinates[0]).toMatchObject({ request_identifier: "221829", coordinate_source: "gis_centroid", coordinate_review_flag: "permit_far_from_gis" });
    expect(s.coordinates[1]).toMatchObject({ coordinate_reason: "non_land_account" });
    expect(s.flags).toEqual([{ permit_number: "F", issuing_jurisdiction: "austin", coordinate_review_flag: "permit_far_from_gis" }]);
    expect(out.watermark).toMatchObject({ sourceKey: "coords_assembly" });
    expect((out.watermark?.value as { stats: { by_source: Record<string, number> } }).stats.by_source).toEqual({ gis_centroid: 1, address_point: 0, permit_point: 0, none: 1 });
    expect(s.runs[0]).toMatchObject({ job_id: "travis-a04-coords-202610220600", status: "complete" });
  });
});

// ---- T045: the `coordinates` report section (contracts/report.md), counts only ----
import { findForbiddenKey } from "../../services/report.js";
import {
  ANCHOR_GEO_IDS,
  buildCoordinatesSection,
  buildGisSection,
  section,
  sections,
  type CoordinateReads,
} from "../../services/report-sections/gis.js";

const reads = (over: Partial<CoordinateReads> = {}): CoordinateReads => ({
  coverage: { denominator_r: 441961, with_point_r: 437600, coverage_r: 437600 / 441961, non_land_account: 51285, roll_count: 493246 },
  bySource: { gis_centroid: 436000, permit_point: 1600, none: 55646 },
  byRule: { centroid: 360000, interior_point: 5000, largest_area: 900, export_point: 20000, condo_building_point: 50100, permit_point: 1600 },
  gapByReason: { no_gis_feature: 4000, gis_null_geometry: 61, no_permit_point: 300, non_land_account: 51285 },
  anchors: [
    { geo_id: "0223120506", request_identifier: "221829", on_roll: true, coordinate_source: "gis_centroid" },
    { geo_id: "0208011301", request_identifier: null, on_roll: false, coordinate_source: null },
  ],
  assembly: {
    job_id: "travis-a04-coords-202610220600",
    stats: {
      multi_feature: { pids: 12, extra_features: 15, rule: "largest_area" },
      condo_building_point: { accounts: 50100, buildings: 1100, rule: "condo_building_point" },
      gis_features_without_roll_account: 42,
      permit_far_from_gis: 7,
      interior_point: 5000,
    },
  },
  gis: {
    job_id: "travis-a04-coords-202610220500",
    artifact_run_id: "39400000000",
    status: "complete",
    pages: 187,
    source_count: 373683,
    duration_s: 1500,
    features_per_s: 249.12,
    started_at: "2026-10-22T03:00:00Z",
    finished_at: "2026-10-22T03:25:00Z",
    concurrency: 2,
    layer_last_edit_date: "2026-10-01T00:00:00.000Z",
    blocked_at: null,
  },
  ...over,
});

describe("A-04 T045 report section coordinates / gis (report-sections/gis.ts)", () => {
  it("DP-5 carries the PROP_ID join proof (null before any assembly)", () => {
    const proof = { features: 10, pid_matched: 7, pid_not_r_account: 1, pid_unmatched: 1, geoid_fallback_matched: 1, geoid_fallback_unmatched: 0 };
    const r = reads();
    const withProof = buildCoordinatesSection({
      ...r,
      assembly: { ...(r.assembly as NonNullable<typeof r.assembly>), stats: { ...(r.assembly as NonNullable<typeof r.assembly>).stats, join_proof: proof } },
    });
    expect(withProof.join_proof).toEqual(proof);
    expect(buildCoordinatesSection(reads({ assembly: null })).join_proof).toBeNull();
  });

  it("is the `coordinates` section and carries the contract fields, anchors and counted rules", () => {
    expect(section.key).toBe("coordinates");
    expect(sections.map((s) => s.key)).toEqual(["coordinates", "gis"]);
    const c = buildCoordinatesSection(reads());
    expect(c).toMatchObject({
      denominator_r: 441961,
      with_point_r: 437600,
      non_land_account: 51285,
      by_source: { gis_centroid: 436000, permit_point: 1600, none: 55646 },
      condo_building_point: { accounts: 50100, buildings: 1100, rule: "condo_building_point" },
      multi_feature: { pids: 12, extra_features: 15, rule: "largest_area" },
      gis_features_without_roll_account: 42,
      permit_far_from_gis: 7,
      interior_point: 5000,
      gis_feature_count: 373683,
      roll_count: 493246,
      gis_minus_roll: -119563,
      gap_pct: 24.24,
      source_jobs: ["travis-a04-coords-202610220500", "travis-a04-coords-202610220600"],
    });
    expect(c.coverage_r).toBeCloseTo(0.990133, 5);
    expect(c.anchors).toEqual([
      { geo_id: "0223120506", request_identifier: "221829", on_roll: true, coordinate_source: "gis_centroid" },
      { geo_id: "0208011301", request_identifier: null, on_roll: false, coordinate_source: null },
    ]);
    expect(ANCHOR_GEO_IDS).toEqual(["0223120506", "0208011301"]);
    expect(findForbiddenKey(c)).toBeNull();
  });

  it("the gis summary: run id, pages, duration, rate, freshness, complete flag and the source-limits row", () => {
    const g = buildGisSection(reads().gis);
    expect(g).toMatchObject({ artifact_run_id: "39400000000", pages: 187, duration_s: 1500, complete: true, layer_last_edit_date: "2026-10-01T00:00:00.000Z", limitation: null });
    expect(g.throughput?.markdown).toMatch(/^\| travis-county-gis \| 187 \| 373683 \| 1500 \|/);
    const blocked = buildGisSection({ ...reads().gis, status: "blocked", blocked_at: "2026-10-22T03:05:00Z" } as CoordinateReads["gis"]);
    expect(blocked).toMatchObject({ complete: false, limitation: "gis: blocked at 2026-10-22T03:05:00Z; coverage not complete", throughput: null });
    // no GIS import yet: unknown, never complete
    expect(buildGisSection(null)).toMatchObject({ complete: false, artifact_run_id: null });
    const c = buildCoordinatesSection(reads({ gis: null }));
    expect(c).toMatchObject({ gis_feature_count: null, gis_minus_roll: null, gap_pct: "unknown" });
  });

  it("the Query DB coverage SQL is avg((latitude IS NOT NULL)::int) over parcels WHERE prop_type = 'R', read-only", () => {
    const src = readFileSync(new URL("../../services/report-sections/gis.ts", import.meta.url), "utf8");
    expect(src).toMatch(/QDB_COVERAGE_SQL/);
    expect(src).not.toMatch(/\.begin\s*\(|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
});
