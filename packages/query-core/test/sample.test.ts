// T063 (A-02, FR-008 / AC-8): contract/v1/sample.parquet, columns.json and README.md for Task B.
// The sample is committed, so these checks run without PILOT_DIR; the row-for-row comparison
// with the bound pilot views runs only when PILOT_DIR is set.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_COLUMNS, SampleRow, UNCARRIED, VIEWS } from "@countylens/contract";
import { rawCid } from "../src/raw-cid.js";
import { SAMPLE_RULE, sampleSql } from "../src/sample.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import { renderColumnsJson } from "../scripts/contract-docs.js";
import {
  PILOT_DIR,
  PILOT_MANIFEST,
  PILOT_MANIFEST_CID,
  ROOT,
  SKIP_MESSAGE,
  bindPilot,
} from "./helpers/pilot.js";

const SAMPLE = join(ROOT, "contract/v1/sample.parquet");
const README = join(ROOT, "contract/v1/README.md");
const COLUMNS_JSON = join(ROOT, "contract/v1/columns.json");
const PROVENANCE = ["source_url", "captured_at", "table", "table_cid", "run_id", "manifest_cid"];

let db: DuckDbEngine;
let rows: Record<string, unknown>[] = [];
beforeAll(async () => {
  db = await openDuckDb();
  if (existsSync(SAMPLE)) rows = await db.all(`SELECT * FROM '${SAMPLE}'`);
});
afterAll(() => db.close());

describe("contract/v1 sample (T063)", () => {
  it("has exactly 20 rows, each a permit row plus its property's columns (columns.ts order and types)", async () => {
    expect(rows.length).toBe(20);
    const described = await db.all(`DESCRIBE SELECT * FROM '${SAMPLE}'`);
    expect(described.map((r) => [r.column_name, r.column_type])).toEqual(
      SAMPLE_COLUMNS.map((c) => [c.name, c.type]),
    );
    for (const row of rows) {
      const parsed = SampleRow.safeParse(row);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it("0 nulls in source_url, captured_at, table, table_cid, run_id, manifest_cid (both records)", () => {
    for (const row of rows) {
      for (const c of PROVENANCE) expect(row[c], c).not.toBeNull();
      for (const c of ["source_url", "captured_at", "table", "table_cid"])
        expect(row[`property_${c}`], `property_${c}`).not.toBeNull();
    }
  });

  it("has ≥ 1 stalled row and ≥ 1 row with a roof age, one run", () => {
    expect(rows.filter((r) => r.status_class === "stalled").length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((r) => r.roof_age_years !== null).length).toBeGreaterThanOrEqual(1);
    expect(new Set(rows.map((r) => r.run_id))).toEqual(new Set(["travis-pilot-20261020"]));
  });

  it("manifest_cid = the CID recomputed from contract/v1/pilot-manifest.json bytes", async () => {
    const cid = await rawCid(readFileSync(PILOT_MANIFEST));
    expect(cid).toBe(PILOT_MANIFEST_CID);
    for (const row of rows) expect(row.manifest_cid).toBe(cid);
  });

  it("columns.json is generated from columns.ts", () => {
    expect(readFileSync(COLUMNS_JSON, "utf8")).toBe(renderColumnsJson());
  });

  it("README documents every column and every no-carrier field with its reason", () => {
    const readme = readFileSync(README, "utf8");
    const all = [...SAMPLE_COLUMNS, ...Object.values(VIEWS).flat()];
    for (const c of all) {
      expect(readme, c.name).toContain(`| \`${c.name}\` | \`${c.type}\` |`);
    }
    for (const u of Object.values(UNCARRIED).flat()) {
      expect(readme, u.field).toContain(`| \`${u.field}\` | \`${u.reason}\` |`);
    }
    expect(readme).toContain(SAMPLE_RULE);
  });

  it("README states the location path, source-level provenance, owner assumption, pilot skew and status rules (D-9)", () => {
    const readme = readFileSync(README, "utf8");
    for (const text of [
      "property_has_parcel → parcel_has_geometry → geometry",
      "no `address_has_geometry`",
      "no `property_has_tax`",
      "gazetteer point",
      "bounding box",
      "Market value is absent",
      "`captured_at` is source-level",
      "falls back to the source-level URL",
      "person_has_property",
      "a schema contract, not a distribution",
      "skewed to open permits",
      "For raw-table consumers",
      "`enum_lacks_value`",
      "only for the profile's jurisdictions",
      "never resets the roof age",
      "five-state totals",
    ])
      expect(readme, text).toContain(text);
  });

  if (!PILOT_DIR) {
    it.skip(`row-for-row comparison with the pilot views: ${SKIP_MESSAGE}`, () => undefined);
  } else {
    it("equals the bound pilot views cut by the recorded rule", async () => {
      const pilot = await bindPilot();
      try {
        expect(await pilot.db.all(sampleSql())).toEqual(rows);
      } finally {
        pilot.db.close();
      }
    });
  }
});
