// Parcel-gap reconciliation from the certified export (offline, no network). Every record,
// file and catalog value here is synthetic (test-only); a temporary repository root holds
// the catalog and the export, and the validator is an injected stand-in.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "../travis/discovery/catalog.schema.js";
import { CatalogSchema } from "../travis/discovery/catalog.schema.js";
import { reconcileGap } from "../travis/discovery/parcel-gap.js";
import type { AccountBreakdown } from "../travis/discovery/probes/tcad.js";
import { isGeometryPoint, scanExport } from "../travis/discovery/probes/tcad.js";
import { reconcileParcelGap } from "../travis/discovery/reconcile-parcel-gap.js";
import { renderSourcesMd } from "../travis/discovery/render-sources-md.js";
import { emitCatalogYaml, readCatalog, writeCatalog } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { buildZip } from "./fixtures/synthetic-zip.js";
import { must } from "./helpers.js";

const CATALOG_REL = "pipeline/docs/travis-sources.yaml";
const EXPORT_REL = "pipeline/data/raw/tcad/synthetic-export.zip";
const EXPORT_URL = "https://example.test/export.zip";
const CAPTURED = "2026-01-01T00:00:00.000Z";

type Rec = Record<string, unknown>;

/** One synthetic protax-shaped record. */
function rec(
  pID: number,
  propType: string,
  o: { geo?: string; point?: boolean; stateCd?: string; condoUnit?: string; inactive?: number },
): Rec {
  return {
    pID,
    propType,
    inactive: o.inactive ?? 0,
    // the real export prints a missing point as "[null, null]"; null is covered too
    geometry: o.point ? "[30.1, -97.7]" : pID % 2 === 0 ? "[null, null]" : null,
    ...(o.geo === undefined ? {} : { propertyIdentification: [{ geoID: o.geo, pID }] }),
    propertyCharacteristics: [{ condoUnit: o.condoUnit ?? null, pID }],
    propertyProfile: o.stateCd === undefined ? [] : [{ stateCd: o.stateCd, pID }],
  };
}

/** 12 records: R 8 (2 with a point; A4 x2, F4, O1, C1 and one with no code or geoID), P 2, MH, MN. */
const MIXED: Rec[] = [
  rec(1, "R", { geo: "G1", point: true, stateCd: "A1" }),
  rec(2, "R", { geo: "G2", point: true, stateCd: "A1" }),
  rec(3, "R", { geo: "G3", stateCd: "A4", condoUnit: "101" }),
  rec(4, "R", { geo: "G3", stateCd: "A4", condoUnit: "102" }),
  rec(5, "R", { geo: "G5", stateCd: "F4", condoUnit: "1" }),
  rec(6, "R", { geo: "G6", stateCd: "O1" }),
  rec(7, "R", { geo: "G7", stateCd: "C1" }),
  rec(8, "R", {}),
  rec(9, "P", { stateCd: "L1" }),
  rec(10, "P", { stateCd: "L1", inactive: 1 }),
  rec(11, "MH", { stateCd: "M1" }),
  rec(12, "MN", { stateCd: "G1" }),
];

/** No condominium codes: 4 records, R 3 (one with a point), P 1. */
const NO_CONDOS: Rec[] = [
  rec(1, "R", { geo: "G1", point: true, stateCd: "A1" }),
  rec(2, "R", { geo: "G2", stateCd: "O1" }),
  rec(3, "R", { geo: "G3", stateCd: "C1" }),
  rec(4, "P", { stateCd: "L1" }),
];

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  catalogPath: string;
  exportPath: string;
}

function fixture(
  opts: { records?: Rec[]; gis?: number; receiptSha?: string; count?: number } = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "reconcile-gap-"));
  tmpDirs.push(root);
  const records = opts.records ?? MIXED;
  const bytes = buildZip([
    { name: "Synthetic-protaxExport.json", data: Buffer.from(JSON.stringify(records)) },
  ]);
  const exportPath = join(root, EXPORT_REL);
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, bytes);

  const cat = syntheticCatalog();
  const count = opts.count ?? records.length;
  const gis = opts.gis ?? 3;
  const base = must(cat.parcel, "parcel");
  const { separately_assessed_without_geometry: _s, ...parcel } = base;
  cat.parcel = {
    ...parcel,
    assessed_parcel_count: count,
    assessed_parcel_count_measurement: {
      value: count,
      source_url: EXPORT_URL,
      captured_at: CAPTURED,
      method: "streaming count",
    },
    gis_feature_count: gis,
    gis_feature_count_measurement: {
      ...base.gis_feature_count_measurement,
      value: gis,
      captured_via: "synthetic US runner",
    },
    gap_pct: Math.round((Math.abs(count - gis) / count) * 10000) / 100,
    gap_reason: "synthetic: gap not yet explained",
    discrepancy_explanation: "synthetic: gap not yet explained",
    export_receipt: {
      url: EXPORT_URL,
      method: "GET",
      status: 200,
      bytes: bytes.length,
      sha256: opts.receiptSha ?? createHash("sha256").update(bytes).digest("hex"),
      captured_at: CAPTURED,
      user_agent: "synthetic-agent",
      attempts: 1,
      outcome: "ok",
      file_path: EXPORT_REL,
      seconds: 1,
      megabytes_per_minute: 1,
      roll_year: 2026,
    },
  };
  const catalogPath = join(root, CATALOG_REL);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeCatalog(cat, catalogPath);
  return { root, catalogPath, exportPath };
}

async function run(f: Fixture, validatorCode = 1) {
  const lines: string[] = [];
  let validatorCalls = 0;
  const code = await reconcileParcelGap({
    repoRoot: f.root,
    catalogPath: f.catalogPath,
    validate: async () => {
      validatorCalls += 1;
      return validatorCode;
    },
    out: (l) => lines.push(l),
  });
  return { code, lines, validatorCalls };
}

const CHANGED = [
  "gap_reason",
  "discrepancy_explanation",
  "separately_assessed_without_geometry",
  "account_breakdown",
  "gap_reconciliation",
] as const;

const isChanged = (k: string): boolean => (CHANGED as readonly string[]).includes(k);

function untouched(c: Catalog): Rec {
  return Object.fromEntries(
    Object.entries(must(c.parcel, "parcel")).filter(([k]) => !isChanged(k)),
  );
}

describe("scanExport account breakdown", () => {
  it("counts propType, real-estate geoIDs and geometry, and no-geometry rows by stateCd", async () => {
    const f = fixture();
    const scan = await scanExport(f.exportPath);
    const b = must(scan.account_breakdown, "account_breakdown");
    expect(b.records).toBe(12);
    expect(b.inactive_flagged).toBe(1);
    expect(b.by_prop_type).toEqual([
      { prop_type: "R", count: 8 },
      { prop_type: "P", count: 2 },
      { prop_type: "MH", count: 1 },
      { prop_type: "MN", count: 1 },
    ]);
    expect(b.real_estate).toEqual({
      accounts: 8,
      distinct_geo_ids: 6,
      accounts_sharing_a_geo_id: 2,
      accounts_without_geo_id: 1,
      with_geometry_point: 2,
      without_geometry_point: 6,
      without_geometry_by_state_cd: [
        { state_cd: "A4", count: 2, with_condo_unit: 2 },
        { state_cd: "C1", count: 1, with_condo_unit: 0 },
        { state_cd: "F4", count: 1, with_condo_unit: 1 },
        { state_cd: "O1", count: 1, with_condo_unit: 0 },
        { state_cd: "none", count: 1, with_condo_unit: 0 },
      ],
    });
    // the key detection is unchanged by the extra counts
    expect(scan.identifier_name).toBe("pID");
    expect(scan.identifier_proven).toBe(true);
  });
});

describe("isGeometryPoint", () => {
  it("accepts two finite numbers and rejects the export's null placeholder", () => {
    expect(isGeometryPoint("[30.2545186553, -97.7620645363]")).toBe(true);
    expect(isGeometryPoint("[null, null]")).toBe(false);
    expect(isGeometryPoint("[30.1, null]")).toBe(false);
    expect(isGeometryPoint("")).toBe(false);
    expect(isGeometryPoint(null)).toBe(false);
    expect(isGeometryPoint("[1, 2, 3]")).toBe(false);
  });
});

describe("reconcileGap arithmetic", () => {
  it("subtracts non-land, condo and inventory counts from roll minus GIS", () => {
    // Category totals of the shape the coordinator measured (input to the arithmetic only).
    const b: AccountBreakdown = {
      records: 493246,
      inactive_flagged: 0,
      by_prop_type: [
        { prop_type: "R", count: 441961 },
        { prop_type: "P", count: 39536 },
        { prop_type: "MH", count: 11744 },
        { prop_type: "MN", count: 5 },
      ],
      real_estate: {
        accounts: 441961,
        distinct_geo_ids: 431536,
        accounts_sharing_a_geo_id: 11589,
        accounts_without_geo_id: 0,
        with_geometry_point: 380461,
        without_geometry_point: 61500,
        without_geometry_by_state_cd: [
          { state_cd: "A4", count: 53324, with_condo_unit: 0 },
          { state_cd: "O1", count: 3534, with_condo_unit: 0 },
          { state_cd: "F4", count: 2815, with_condo_unit: 0 },
          { state_cd: "C1", count: 696, with_condo_unit: 0 },
          { state_cd: "X", count: 1131, with_condo_unit: 0 },
        ],
      },
    };
    const r = reconcileGap(b, 493246, 373683);
    expect(r.gap).toBe(119563);
    expect(r.components.map((c) => [c.component, c.count])).toEqual([
      ["non_land_accounts", 51285],
      ["condo_accounts_without_export_point", 56139],
      ["inventory_accounts_without_export_point", 3534],
    ]);
    // OR-m1: every subcode reading is labelled unverified; never "no own GIS polygon"
    for (const c of r.components.slice(1)) {
      expect(c.reason).toMatch(/state-code reading, unverified/);
      expect(c.reason).toMatch(/no export geometry point/);
      expect(c.reason).not.toMatch(/own geometry|own GIS polygon/);
    }
    expect(r.components[2]?.reason).toMatch(
      /inventory; mostly condo inventory by the condoUnit field/,
    );
    expect(r.explained).toBe(110958);
    expect(r.residual).toBe(8605);
    expect(r.residual_pct_of_roll).toBe(1.74);
  });

  it("refuses when GIS is not below the roll", () => {
    const b: AccountBreakdown = {
      records: 1,
      inactive_flagged: 0,
      by_prop_type: [{ prop_type: "R", count: 1 }],
      real_estate: {
        accounts: 1,
        distinct_geo_ids: 1,
        accounts_sharing_a_geo_id: 0,
        accounts_without_geo_id: 0,
        with_geometry_point: 1,
        without_geometry_point: 0,
        without_geometry_by_state_cd: [],
      },
    };
    expect(() => reconcileGap(b, 10, 10)).toThrow(/not below the roll/);
  });
});

describe("reconcileParcelGap", () => {
  it("writes the breakdown, the reconciliation, acknowledged and the two texts; runs the validator", async () => {
    const f = fixture();
    const before = readCatalog(f.catalogPath);
    const { code, validatorCalls, lines } = await run(f);
    expect(code).toBe(1);
    expect(validatorCalls).toBe(1);
    const p = must(readCatalog(f.catalogPath).parcel, "parcel");
    const b = must(p.account_breakdown, "account_breakdown");
    expect(b.source_url).toBe(EXPORT_URL);
    expect(b.captured_at).toBe(CAPTURED);
    expect(b.method).toBe("streaming count of the certified export");
    expect(b.export_sha256).toBe(must(p.export_receipt).sha256);
    expect(b.zip_entry).toBe("Synthetic-protaxExport.json");
    expect(b.by_prop_type.find((r) => r.prop_type === "MH")?.meaning).toBe("mobile home");
    const codes = must(b.real_estate.without_geometry_by_state_cd);
    expect(codes.find((r) => r.state_cd === "A4")?.meaning).toBe(
      "residential condominium (state-code reading, unverified)",
    );
    expect(codes.find((r) => r.state_cd === "F4")?.meaning).toBe(
      "commercial condominium (state-code reading, unverified)",
    );
    expect(codes.find((r) => r.state_cd === "O1")?.meaning).toMatch(/inventory/);
    expect(codes.find((r) => r.state_cd === "C1")?.meaning).toMatch(/vacant/);
    expect(codes.find((r) => r.state_cd === "none")?.meaning).toBeUndefined();

    const g = must(p.gap_reconciliation, "gap_reconciliation");
    expect(g.gap).toBe(9);
    expect(g.components.map((c) => c.count)).toEqual([4, 3, 1]);
    expect(g.explained).toBe(8);
    expect(g.residual).toBe(1);
    expect(g.residual_pct_of_roll).toBe(8.33);
    expect(g.residual_note).toMatch(/likely cause, not verified/);
    expect(g.components[1]?.reason).toMatch(/condoUnit filled on 3 of 3/);
    expect(g.components[2]?.reason).toMatch(/condoUnit filled on 0 of 1/);

    expect(p.separately_assessed_without_geometry).toBe("acknowledged");
    // the raw gap, the roll and GIS counts stay as recorded
    expect(p.gap_pct).toBe(must(before.parcel).gap_pct);
    expect(p.assessed_parcel_count).toBe(12);
    expect(p.gis_feature_count).toBe(3);
    expect(p.gap_reason).toMatch(/GIS 3 features vs certified roll 12 \(9 fewer, 75\.00% below/);
    expect(p.gap_reason).toMatch(/= 8 of the 9; the residual 1 \(8\.33% of the roll\)/);
    expect(p.discrepancy_explanation).toMatch(/above the 2% threshold, so GIS-only seeding/);
    expect(p.discrepancy_explanation).toMatch(/GIS is never substituted/);
    expect(lines.join("\n")).toMatch(/sha256 matches the export receipt/);
    expect(lines.join("\n")).not.toMatch(/G3|"101"/);
  });

  it("leaves every untouched section byte-identical", async () => {
    const f = fixture();
    const beforeText = readFileSync(f.catalogPath, "utf8");
    const before = readCatalog(f.catalogPath);
    await run(f);
    const afterText = readFileSync(f.catalogPath, "utf8");
    const after = readCatalog(f.catalogPath);
    const head = (t: string) => t.slice(0, t.indexOf("\nparcel:"));
    // the tail up to the appended amendments[] (OR-M5) stays byte-identical
    const tail = (t: string) => {
      const end = t.indexOf("\namendments:");
      return t.slice(t.indexOf("\npermits:"), end < 0 ? undefined : end + 1);
    };
    expect(head(afterText)).toBe(head(beforeText));
    expect(tail(afterText)).toBe(tail(beforeText));
    expect(must(after.amendments?.at(-1)).command).toBe("reconcile-parcel-gap");
    expect(untouched(after)).toEqual(untouched(before));
    // Reverting only the changed parcel keys gives back the original file, byte for byte.
    const original: Rec = must(before.parcel, "parcel");
    const reverted: Rec = Object.fromEntries(
      Object.entries(must(after.parcel, "parcel"))
        .filter(([k]) => !isChanged(k) || k in original)
        .map(([k, v]) => [k, isChanged(k) ? original[k] : v]),
    );
    const { amendments: _a, ...withoutAmendments } = after;
    expect(emitCatalogYaml({ ...withoutAmendments, parcel: reverted as Catalog["parcel"] })).toBe(
      beforeText,
    );
  });

  it("sets acknowledged only when condo units without geometry are measured", async () => {
    const f = fixture({ records: NO_CONDOS, gis: 1 });
    const { code } = await run(f);
    expect(code).toBe(1);
    const p = must(readCatalog(f.catalogPath).parcel, "parcel");
    expect(p.separately_assessed_without_geometry).toBeUndefined();
    const g = must(p.gap_reconciliation);
    expect(
      g.components.find((c) => c.component === "condo_accounts_without_export_point")?.count,
    ).toBe(0);
    expect(g.explained).toBe(2); // P 1 + O1 1
    expect(g.residual).toBe(1); // the C1 lot
  });

  it("refuses on a SHA-256 mismatch: nothing written, no validator", async () => {
    const f = fixture({ receiptSha: "0".repeat(64) });
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, validatorCalls, lines } = await run(f);
    expect(code).toBe(2);
    expect(validatorCalls).toBe(0);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(lines.join("\n")).toMatch(/SHA-256.*does not match.*fresh discovery run/i);
  });

  it("refuses when the scan count disagrees with the recorded roll count", async () => {
    const f = fixture({ count: 13 });
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, lines } = await run(f);
    expect(code).toBe(2);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(lines.join("\n")).toMatch(/count 12 != recorded assessed_parcel_count 13/);
  });

  it("refuses when GIS is not below the roll", async () => {
    const f = fixture({ gis: 12 });
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, lines } = await run(f);
    expect(code).toBe(2);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(lines.join("\n")).toMatch(/not below the roll/);
  });

  it("renders breakdown and reconciliation rows with a source URL and UTC time (FR-007a)", async () => {
    const f = fixture();
    await run(f);
    const md = renderSourcesMd(readCatalog(f.catalogPath));
    expect(md).toContain("Gap reconciliation:");
    const numeric = md
      .split("\n")
      .filter((l) => l.startsWith("|") && /\| *[0-9][0-9,]* *\|/.test(l));
    const bare = numeric.filter((l) => !/https?:\/\/.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z/.test(l));
    expect(bare).toEqual([]);
    expect(md).toMatch(/Residual \(unexplained\) \| 1 \(8\.33 % of the roll\)/);
  });

  it("schema rejects an inconsistent reconciliation", async () => {
    const f = fixture();
    await run(f);
    const cat = readCatalog(f.catalogPath);
    const g = must(must(cat.parcel).gap_reconciliation);
    g.residual += 1;
    expect(CatalogSchema.safeParse(cat).success).toBe(false);
  });
});
