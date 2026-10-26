// A-11 regression: Run 1 (specs/011-publish-and-runs) is the first manifest with more than one
// batch per data group (AD-0001 full-county batching — 10 county CARs, 2 property_improvement
// CARs). Its table artifacts are not named `tables/<group>/<table>/<part>` (A-03's pilot
// assumption, the old `partOf`) but `<run-dir>/…/<group-batched>/tables/<bNN>/<table>/<part>`,
// where nothing in the path or the manifest schema names the data group directly. This fixture
// reproduces that shape at a tiny scale: two county batches and one property_improvement batch,
// the property_improvement batch also carrying an unused "property" table (the same name Run 1's
// permits batches really do export, unused) to prove a single colliding table name never
// mis-groups a whole batch's real rows into the other group's relation.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindManifest, type BoundRun } from "../src/bind-manifest.js";
import { rawCid } from "../src/raw-cid.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import {
  baseManifest,
  columnsOf,
  literal,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

let dir: string;
let db: DuckDbEngine;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bind-batches-"));
  db = await openDuckDb();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Writes one table part under `<dir>/<name>` (name is the artifact's manifest name, exactly as
 *  a batched export's elephant-cli run would record it) and returns its ManifestArtifact. */
async function writeTablePart(
  table: string,
  name: string,
  rows: Row[],
): Promise<Record<string, unknown>> {
  const cols = columnsOf(table);
  const file = join(dir, name);
  mkdirSync(join(file, ".."), { recursive: true });
  const selects = rows.map(
    (r) => `SELECT ${cols.map(([c, t]) => `${literal(r[c], t)} AS "${c}"`).join(", ")}`,
  );
  await db.run(`COPY (${selects.join(" UNION ALL ")}) TO '${file}' (FORMAT parquet)`);
  const bytes = readFileSync(file);
  return {
    cid: await rawCid(bytes),
    codec: "raw",
    kind: "table",
    name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}

/** The real Run 1 shape: `<run-dir>/…/<group>-batched/tables/<bNN>/<table>/part-00000.parquet`. */
const countyBatch = (b: string, table: string): string =>
  `pipeline/data/runs/travis-a04/publish-dry-run/county-batched/tables/${b}/${table}/part-00000.parquet`;
const permitsBatch = (b: string, table: string): string =>
  `pipeline/data/runs/travis-a11/publish-dry-run/permits-batched/tables/${b}/${table}/part-00000.parquet`;

async function bind(manifest: ManifestJson): Promise<BoundRun> {
  return bindManifest(new TextEncoder().encode(JSON.stringify(manifest)), dir, db, {
    partUrl: ({ name }) => join(dir, name),
  });
}

describe("bindManifest: N batches per data group (A-11 bug 1, AD-0001)", () => {
  it("unions every batch's rows into the one group relation, by table identity, not by path position", async () => {
    const manifest = baseManifest();
    const parts = await Promise.all([
      writeTablePart("property", countyBatch("b01", "property"), [
        { cid: "cp1", request_identifier: "r1", parcel_identifier: "p1" },
      ]),
      writeTablePart("structure", countyBatch("b01", "structure"), [
        { cid: "cs1", request_identifier: "r1", roof_date: "2020-01-01" },
      ]),
      writeTablePart("property", countyBatch("b02", "property"), [
        { cid: "cp2", request_identifier: "r2", parcel_identifier: "p2" },
      ]),
      writeTablePart("structure", countyBatch("b02", "structure"), [
        { cid: "cs2", request_identifier: "r2", roof_date: "2021-01-01" },
      ]),
      writeTablePart("property_improvement", permitsBatch("b01", "property_improvement"), [
        { cid: "pi1", request_identifier: "r3", permit_number: "PN-1" },
      ]),
      // Unused in REQUIRED_TABLES for property_improvement, but really exported alongside it
      // (Run 1): its only REQUIRED_TABLES owner is the *county* group's "property" table. A
      // batch-by-batch resolver that trusted any single name could merge this into county.
      writeTablePart("property", permitsBatch("b01", "property"), [
        { cid: "junk1", request_identifier: "junk", parcel_identifier: "should-not-leak" },
      ]),
    ]);
    manifest.artifacts = [...manifest.artifacts.filter((a) => a.kind !== "table"), ...parts];

    const bound = await bind(manifest);

    const countyProperty = await db.all("SELECT cid FROM county.property ORDER BY cid");
    expect(countyProperty.map((r) => r["cid"])).toEqual(["cp1", "cp2"]);

    const countyStructure = await db.all("SELECT cid FROM county.structure ORDER BY cid");
    expect(countyStructure.map((r) => r["cid"])).toEqual(["cs1", "cs2"]);

    const permits = await db.all("SELECT cid FROM property_improvement.property_improvement");
    expect(permits.map((r) => r["cid"])).toEqual(["pi1"]);

    // The junk "property" table is grouped under property_improvement (its own batch), not
    // merged into county.property (which stays exactly the two real county rows above).
    const junkGroup = bound.tables.find(
      (t) => t.table === "property" && t.group === "property_improvement",
    );
    expect(junkGroup?.emitted).toBe(true);
    const junkRows = await db.all("SELECT cid FROM property_improvement.property ORDER BY cid");
    expect(junkRows.map((r) => r["cid"])).toEqual(["junk1"]);
  });
});
