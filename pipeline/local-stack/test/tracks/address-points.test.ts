// A-11 Run 3 (ADR 0004): the 0202_address_points migration (SQL text) and the Loader `gis` track's
// `address_points` kind, plus the assembly reading the loaded layer. Offline; every row is
// SYNTHETIC TEST INPUT.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADDRESS_LAYER_URL,
  buildAddressPointSet,
  type AddressPointRecord,
} from "../../../oracle-runtime/travis/gis/address-points.js";
import { mergeGis, type GisStore } from "../../services/tracks/gis.js";

const SQL = readFileSync(new URL("../../migrations/0202_address_points.sql", import.meta.url), "utf8");
const flat = SQL.replace(/--.*$/gm, "").replace(/\s+/g, " ");

describe("0202_address_points.sql", () => {
  it("creates the lookup table and the one-row layer receipt", () => {
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS address_points \(/);
    expect(flat).toMatch(/object_id bigint PRIMARY KEY/);
    for (const c of ["address integer", "full_street_name text", "address_type integer", "lat double precision NOT NULL", "lon double precision NOT NULL"]) {
      expect(flat).toContain(c);
    }
    expect(flat).toMatch(/CREATE TABLE IF NOT EXISTS address_point_layer \(/);
    expect(flat).toContain("id boolean PRIMARY KEY DEFAULT true CHECK (id)");
    expect(flat).toContain("sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$')");
  });

  it("widens the three closed lists of 0201 under the same constraint names", () => {
    for (const name of ["source", "rule", "reason"]) {
      expect(flat).toContain(`DROP CONSTRAINT IF EXISTS parcels_coordinate_${name}_check`);
      expect(flat).toContain(`ADD CONSTRAINT parcels_coordinate_${name}_check`);
    }
    expect(flat).toContain("coordinate_source IN ('gis_centroid', 'address_point', 'permit_point', 'none')");
    expect(flat).toMatch(/coordinate_rule IN \([^)]*'condo_building_point', 'address_point', 'permit_point'\)/);
    expect(flat).toMatch(
      /coordinate_reason IN \([^)]*'non_land_account', 'address_point_ambiguous', 'address_point_outside_county'\)/,
    );
    // it must not loosen the none <=> null <=> reason rule or touch other tables
    expect(flat).not.toContain("parcels_coordinate_none_rule");
    expect(SQL).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const RECORDS: AddressPointRecord[] = [
  { object_id: 1, place_id: 11, address: 1405, full_street_name: "1405 BRIDGEWAY DR", address_fraction: null, address_suffix: null, address_type: 1, lat: 30.31, lon: -97.71 },
  { object_id: 2, place_id: 12, address: 610, full_street_name: "610 DAVIS ST", address_fraction: null, address_suffix: null, address_type: 1, lat: 30.2, lon: -97.6 },
];

function cache(over: { sha?: string } = {}): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "a11-address-cache-"));
  dirs.push(dir);
  const body = `${RECORDS.map((r) => JSON.stringify(r)).join("\n")}\n`;
  const sha = createHash("sha256").update(body).digest("hex");
  writeFileSync(join(dir, "address-points.ndjson"), body);
  writeFileSync(
    join(dir, "receipt.json"),
    JSON.stringify({
      layer_url: ADDRESS_LAYER_URL,
      retrieved_at: "2026-10-25T00:49:51.937Z",
      record_count: RECORDS.length,
      source_count: RECORDS.length,
      sha256: over.sha ?? sha,
      layer_last_edit_date: "2026-10-24T04:31:08.027Z",
      pages: 1,
      page_size: 2000,
      user_agent: "x",
      requests: [],
    }),
  );
  return { dir, sha };
}

function store(extra: Partial<GisStore> = {}) {
  const loaded: Array<{ records: AddressPointRecord[]; sha: string }> = [];
  const s: GisStore = {
    upsertRun: async () => undefined,
    insertReceipts: async () => 0,
    upsertPages: async () => 0,
    upsertFeatures: async () => 0,
    addLimitation: async () => undefined,
    readAssembly: async () => ({ parcels: [], geoids: [], features: [], permits: [] }),
    writeCoordinates: async (rows) => rows.length,
    flagPermits: async () => 0,
    replaceAddressPoints: async (records, receipt) => {
      loaded.push({ records, sha: receipt.sha256 });
      return records.length;
    },
    ...extra,
  };
  return { s, loaded };
}

describe("Loader gis track: kind address_points", () => {
  it("loads the cache into the store and records the capture in the watermark", async () => {
    const { dir, sha } = cache();
    const { s, loaded } = store();
    const out = await mergeGis(s, {
      kind: "address_points",
      jobId: "travis-a04-address-points-20261025",
      artifactPath: dir,
      artifactSha256: sha,
    });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.records).toHaveLength(2);
    expect(out.rowsWritten).toBe(2);
    expect(out.watermark).toMatchObject({
      sourceKey: "address_points",
      value: { layer_url: ADDRESS_LAYER_URL, record_count: 2, sha256: sha },
    });
  });

  it("refuses a cache whose sha256 is not the one the caller inspected", async () => {
    const { dir } = cache();
    const { s, loaded } = store();
    await expect(
      mergeGis(s, {
        kind: "address_points",
        jobId: "travis-a04-address-points-20261025",
        artifactPath: dir,
        artifactSha256: "f".repeat(64),
      }),
    ).rejects.toThrow(/sha256/);
    expect(loaded).toHaveLength(0);
  });

  it("refuses a cache whose file does not match its receipt", async () => {
    const { dir } = cache({ sha: "0".repeat(64) });
    const { s } = store();
    await expect(
      mergeGis(s, {
        kind: "address_points",
        jobId: "travis-a04-address-points-20261025",
        artifactPath: dir,
        artifactSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/receipt/);
  });
});

describe("Loader gis track: assemble reads the loaded layer", () => {
  it("a parcel with no GIS feature gets its address point; the stats reach the watermark", async () => {
    const set = buildAddressPointSet(RECORDS, {
      layerUrl: ADDRESS_LAYER_URL,
      retrievedAt: "2026-10-25T00:49:51.937Z",
      sha256: "d".repeat(64),
    });
    const { s } = store({
      readAssembly: async () => ({
        parcels: [
          {
            request_identifier: "900001",
            geo_id: "G1",
            prop_type: "R",
            export_point_lat: null,
            export_point_lon: null,
            export_point_kind: "placeholder",
            source_url: "https://traviscad.org/x.zip",
            captured_at: "2026-10-19T21:33:41Z",
            export_sha256: "e".repeat(64),
            situs: { street_number: "1405", street_name: "BRIDGEWAY", street_suffix: "DR", street_secondary: "2", zip: "78701" },
          },
        ],
        geoids: [],
        features: [],
        permits: [],
        addressPoints: set,
      }),
    });
    const written: unknown[] = [];
    s.writeCoordinates = async (rows) => (written.push(...rows), rows.length);
    const out = await mergeGis(s, {
      kind: "assemble",
      jobId: "travis-a04-coords-20261025",
      artifactPath: "assemble:x",
      artifactSha256: "a".repeat(64),
      tcadJobId: null,
    });
    expect(written[0]).toMatchObject({
      request_identifier: "900001",
      coordinate_source: "address_point",
      coordinate_rule: "address_point",
      latitude: 30.31,
      coordinate_sha256: "d".repeat(64),
    });
    const stats = (out.watermark?.value as { stats: { address_point: Record<string, number> } }).stats;
    expect(stats.address_point).toMatchObject({ matched: 1, unit_ignored: 1 });
  });
});
