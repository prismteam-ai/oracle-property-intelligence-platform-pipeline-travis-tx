// A-11 Run 3: the merged views must still bind the real Run 2 export (written before Run 3, so
// it has no person_has_property / company_has_property edges, no address points, no deed rows and
// no contractor company rows). The new columns exist and are null where the data is not
// re-written yet. Reads the local export only; skipped when it is not on this machine.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindManifest } from "../src/bind-manifest.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MANIFEST = join(ROOT, "runs/travis-full-run2-20261024/manifest.json");
const bytes = existsSync(MANIFEST) ? readFileSync(MANIFEST) : null;
const firstPart = bytes
  ? (JSON.parse(bytes.toString("utf8")).artifacts as { kind: string; name: string }[]).find(
      (a) => a.kind === "table",
    )?.name
  : undefined;
const present = firstPart !== undefined && existsSync(join(ROOT, firstPart));

describe.skipIf(!present)("Run 2 export binds through the merged views", () => {
  let db: DuckDbEngine;
  beforeAll(async () => {
    db = await openDuckDb();
    await bindManifest(bytes as Uint8Array, join(ROOT, "tables"), db, {
      partUrl: ({ name }) => join(ROOT, name),
    });
  }, 600_000);
  afterAll(() => db?.close());

  it("v_property keeps its 441,961 rows and v_roofing_permit its 15,025", async () => {
    const [p] = await db.all("SELECT count(*)::INTEGER AS n FROM v_property");
    const [r] = await db.all("SELECT count(*)::INTEGER AS n FROM v_roofing_permit");
    expect(p?.n).toBe(441_961);
    expect(r?.n).toBe(15_025);
  }, 600_000);

  it("the Run 3 columns are present; owners still read through the sale edges, the new sources are null", async () => {
    const rows = await db.all(
      `SELECT count(*) FILTER (WHERE owner_name IS NOT NULL)::INTEGER AS owners,
              count(*) FILTER (WHERE coordinate_source = 'address_point')::INTEGER AS address_points,
              count(*) FILTER (WHERE tenure_basis = 'deed_date')::INTEGER AS deed_tenure
       FROM v_property`,
    );
    expect(rows[0]?.owners).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ address_points: 0, deed_tenure: 0 });
  }, 600_000);
});
