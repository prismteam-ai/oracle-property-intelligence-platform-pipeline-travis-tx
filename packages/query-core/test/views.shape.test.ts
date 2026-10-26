// T057 (A-02, FR-002 / AC-2): the four views compile over empty typed tables built from the
// committed class-schema snapshot (test/fixtures/schemas/, written by T053), and DESCRIBE of each
// view equals @countylens/contract columns.ts (names, order, types). Tables the export did not
// emit get empty typed relations from bindManifest() (oracle R10).
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_COLUMNS, VIEWS, type ViewName } from "@countylens/contract";
import { bindManifest, REQUIRED_TABLES, type BoundRun } from "../src/bind-manifest.js";
import { rawCid } from "../src/raw-cid.js";
import { sampleSql } from "../src/sample.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import { RELATIONSHIP, classColumns } from "./helpers/fixture-export.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MANIFEST = join(ROOT, "contract/v1/pilot-manifest.json");

/** What this synthetic export emits. person, sales_history_has_person, person_has_property, the contractor edge and the
 *  permit-group company are left out on purpose, as in the pilot. */
const EMITTED: Record<string, Record<string, [string, string][]>> = {
  county: {
    property: classColumns("property"),
    address: classColumns("address"),
    parcel: classColumns("parcel"),
    geometry: classColumns("geometry"),
    structure: classColumns("structure"),
    sales_history: classColumns("sales_history"),
    company: classColumns("company"),
    property_has_address: RELATIONSHIP,
    property_has_parcel: RELATIONSHIP,
    parcel_has_geometry: RELATIONSHIP,
    property_has_structure: RELATIONSHIP,
    property_has_sales_history: RELATIONSHIP,
    sales_history_has_company: RELATIONSHIP,
  },
  property_improvement: {
    property: classColumns("property"),
    property_improvement: classColumns("property_improvement"),
    property_has_property_improvement: RELATIONSHIP,
  },
};

let dir: string;
let db: DuckDbEngine;
let bound: BoundRun;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "views-shape-"));
  db = await openDuckDb();
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    artifacts: { kind: string; name: string }[];
  };
  const parts = [];
  for (const [group, tables] of Object.entries(EMITTED)) {
    for (const [table, cols] of Object.entries(tables)) {
      const name = `tables/${group}/${table}/part-00000.parquet`;
      const file = join(dir, group, table, "part-00000.parquet");
      mkdirSync(join(dir, group, table), { recursive: true });
      const select = cols.map(([c, t]) => `NULL::${t} AS "${c}"`).join(", ");
      await db.run(`COPY (SELECT ${select} WHERE false) TO '${file}' (FORMAT parquet)`);
      const bytes = readFileSync(file);
      parts.push({
        cid: await rawCid(bytes),
        codec: "raw",
        kind: "table",
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
      });
    }
  }
  manifest.artifacts = [...manifest.artifacts.filter((a) => a.kind !== "table"), ...parts];
  bound = await bindManifest(new TextEncoder().encode(JSON.stringify(manifest)), dir, db);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("views shape (T057)", () => {
  for (const view of Object.keys(VIEWS) as ViewName[]) {
    it(`${view} compiles and DESCRIBE equals columns.ts (names, order, types)`, async () => {
      const described = await db.all(`DESCRIBE SELECT * FROM ${view}`);
      expect(described.map((r) => [r.column_name, r.column_type])).toEqual(
        VIEWS[view].map((c) => [c.name, c.type]),
      );
    });
  }

  it("bindManifest() creates empty typed relations for the tables the export did not emit", async () => {
    const absent = bound.tables.filter((t) => !t.emitted).map((t) => `${t.group}.${t.table}`);
    expect(absent).toEqual(
      expect.arrayContaining([
        "county.person",
        "county.person_has_property",
        "county.sales_history_has_person",
        "property_improvement.property_improvement_has_contractor",
        "property_improvement.company",
      ]),
    );
    for (const t of REQUIRED_TABLES) {
      const rows = await db.all(`SELECT count(*)::INTEGER AS n FROM ${t.group}.${t.table}`);
      expect(rows[0]?.n, `${t.group}.${t.table}`).toBe(0);
    }
  });

  it("the empty views return no rows, and v_run returns the one manifest row", async () => {
    for (const view of ["v_property", "v_roofing_permit", "v_contractor"]) {
      expect(await db.all(`SELECT * FROM ${view}`)).toEqual([]);
    }
    const run = await db.all("SELECT run_id, manifest_cid FROM v_run");
    expect(run).toEqual([{ run_id: "travis-pilot-20261020", manifest_cid: bound.manifestCid }]);
  });

  it("the sample SELECT compiles and has the sample columns (names, order, types)", async () => {
    const described = await db.all(`DESCRIBE ${sampleSql()}`);
    expect(described.map((r) => [r.column_name, r.column_type])).toEqual(
      SAMPLE_COLUMNS.map((c) => [c.name, c.type]),
    );
  });

  it("rawCid refuses input larger than one UnixFS chunk", async () => {
    await expect(rawCid(new Uint8Array(262_145))).rejects.toThrow(/256 KiB/);
  });

  it("fails loudly when an emitted table lacks a column the views read", async () => {
    const other = await openDuckDb();
    const broken = mkdtempSync(join(tmpdir(), "views-broken-"));
    try {
      mkdirSync(join(broken, "county", "structure"), { recursive: true });
      const file = join(broken, "county", "structure", "part-00000.parquet");
      await other.run(
        `COPY (SELECT NULL::VARCHAR AS cid WHERE false) TO '${file}' (FORMAT parquet)`,
      );
      const bytes = readFileSync(file);
      const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
        artifacts: Record<string, unknown>[];
      };
      manifest.artifacts = [
        ...manifest.artifacts.filter((a) => a.kind !== "table"),
        {
          cid: await rawCid(bytes),
          codec: "raw",
          kind: "table",
          name: "tables/county/structure/part-00000.parquet",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        },
      ];
      await expect(
        bindManifest(new TextEncoder().encode(JSON.stringify(manifest)), broken, other),
      ).rejects.toThrow(/county\.structure.*roof_date/);
    } finally {
      other.close();
      rmSync(broken, { recursive: true, force: true });
    }
  });
});
