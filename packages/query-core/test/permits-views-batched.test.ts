// The hosted Permits page bound every table part of a full run (10 county batches x 19 tables +
// permits batches, ~225 parts) to answer a COUNT and one listing that read only v_roofing_permit
// (A-11 run 1: ~1,200 requests, ~90 s). bindManifest({ views }) binds the tables those views read,
// and boundPartNames names exactly the parts it will read, so a caller can prefetch just those.
// This fixture has the real batched shape (AD-0001: `<run-dir>/…/tables/<bNN>/<table>/<part>`)
// with unread tables in every batch, and proves, on real DuckDB: the part subset (as data and as
// the `partUrl` calls), and identical COUNT and listing rows against a full bind.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindManifest, boundPartNames } from "../src/bind-manifest.js";
import { listRoofingPermitsSql } from "../src/builders.js";
import { rawCid } from "../src/raw-cid.js";
import { viewsReadBy } from "../src/view-plan.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import {
  AUSTIN_URL,
  austinRequest,
  baseManifest,
  columnsOf,
  literal,
  propertyRows,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

const COUNT_SQL = "SELECT count(*)::INTEGER AS n FROM v_roofing_permit";
const VIEWS = viewsReadBy(`${COUNT_SQL} ${listRoofingPermitsSql()}`);

const COUNTY_BATCHES = ["b01", "b02", "b03"];
const PERMIT_BATCHES = ["b01", "b02"];
const COUNTY_TABLES = ["property", "structure", "sales_history", "geometry"];
const PERMIT_TABLES = [
  "property_improvement",
  "property_has_property_improvement",
  "property_improvement_has_contractor",
  "company",
  "property", // exported alongside, unused (Run 1's permits batches really do)
];

const countyName = (b: string, table: string): string =>
  `pipeline/data/runs/t/county-batched/tables/${b}/${table}/part-00000.parquet`;
const permitsName = (b: string, table: string): string =>
  `pipeline/data/runs/t/permits-batched/tables/${b}/${table}/part-00000.parquet`;

const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });
const permit = (cid: string, permitNumber: string): Row => ({
  cid,
  request_identifier: cid,
  permit_number: permitNumber,
  improvement_type: "Roofing",
  improvement_action: "Replacement",
  improvement_status: "Completed",
  permit_issue_date: "2026-04-01",
  completion_date: "2026-05-01",
  source_http_request: austinRequest(permitNumber, AUSTIN_URL),
});

let dir: string;
let db: DuckDbEngine;
let manifest: ManifestJson;
let manifestBytes: Uint8Array;
const countyPropertyCid = (b: string): string => `baguqeeraprop-${b}`;
const permitCid = (b: string): string => `baguqeeraimpr-${b}`;

async function writePart(
  table: string,
  name: string,
  rows: Row[],
): Promise<Record<string, unknown>> {
  const cols = columnsOf(table);
  const file = join(dir, name);
  mkdirSync(join(file, ".."), { recursive: true });
  const selects =
    rows.length === 0
      ? [`SELECT ${cols.map(([c, t]) => `NULL::${t} AS "${c}"`).join(", ")} WHERE false`]
      : rows.map(
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

const rowsFor = (kind: "county" | "permits", b: string, table: string): Row[] => {
  if (kind === "county") {
    if (table === "property") return [propertyRows(countyPropertyCid(b), 1990)];
    if (table === "structure") return [{ cid: `s-${b}`, roof_date: "1990" }];
    if (table === "sales_history")
      return [{ cid: `sh-${b}`, ownership_transfer_date: "2001-01-01" }];
    return [{ cid: `g-${b}`, latitude: 30.27, longitude: -97.74 }];
  }
  if (table === "property_improvement") return [permit(permitCid(b), `2026-0001${b.slice(1)} BP`)];
  if (table === "property_has_property_improvement")
    return [edge(countyPropertyCid(b), permitCid(b))];
  if (table === "property_improvement_has_contractor") return [edge(permitCid(b), `co-${b}`)];
  if (table === "company") return [{ cid: `co-${b}`, request_identifier: `co-${b}`, name: "Acme" }];
  return [{ cid: `junk-${b}`, request_identifier: "junk", parcel_identifier: "junk" }];
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "permits-views-"));
  db = await openDuckDb();
  const parts = await Promise.all([
    ...COUNTY_BATCHES.flatMap((b) =>
      COUNTY_TABLES.map((t) => writePart(t, countyName(b, t), rowsFor("county", b, t))),
    ),
    ...PERMIT_BATCHES.flatMap((b) =>
      PERMIT_TABLES.map((t) => writePart(t, permitsName(b, t), rowsFor("permits", b, t))),
    ),
  ]);
  manifest = baseManifest();
  manifest.artifacts = [...manifest.artifacts.filter((a) => a.kind !== "table"), ...parts];
  manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const artifactsOf = (): { kind: string; name: string }[] =>
  manifest.artifacts as { kind: string; name: string }[];

const bind = async (views?: typeof VIEWS): Promise<string[]> => {
  const asked: string[] = [];
  await bindManifest(manifestBytes, dir, db, {
    ...(views === undefined ? {} : { views }),
    partUrl: ({ name }) => {
      asked.push(name);
      return join(dir, name);
    },
  });
  return asked;
};

describe("Permits page bind over a multi-batch run (v_roofing_permit only)", () => {
  const tableParts = (): string[] =>
    manifest.artifacts.filter((a) => a.kind === "table").map((a) => String(a["name"]));

  it("the page reads v_roofing_permit and nothing else", () => {
    expect(VIEWS).toEqual(["v_roofing_permit"]);
  });

  it("boundPartNames lists the county property part of every batch and the five permits tables of every permits batch, not the rest", () => {
    const expected = [
      ...COUNTY_BATCHES.map((b) => countyName(b, "property")),
      ...PERMIT_BATCHES.flatMap((b) => [
        permitsName(b, "property_improvement"),
        permitsName(b, "property_has_property_improvement"),
        permitsName(b, "property_improvement_has_contractor"),
        permitsName(b, "company"),
      ]),
    ];
    expect(boundPartNames(artifactsOf(), VIEWS).sort()).toEqual(expected.sort());
    // 11 of 22 here; the unused tables of every batch (and the permits batches' junk "property",
    // which must not be mistaken for county.property) stay out.
    expect(tableParts()).toHaveLength(22);
    expect(boundPartNames(artifactsOf(), VIEWS)).not.toContain(permitsName("b01", "property"));
  });

  it("without views, boundPartNames is every emitted part (unchanged default)", () => {
    expect(boundPartNames(artifactsOf()).sort()).toEqual(tableParts().sort());
  });

  it("the subset bind asks partUrl for exactly those parts; the full bind asks for all 22", async () => {
    const subset = await bind(VIEWS);
    expect(subset.sort()).toEqual(boundPartNames(artifactsOf(), VIEWS).sort());
    expect(subset).toHaveLength(11);
    const everything = await bind();
    expect(everything.sort()).toEqual(tableParts().sort());
  });

  it("COUNT and the listing return identical rows over the subset bind and the full bind", async () => {
    await bind();
    const fullCount = await db.all(COUNT_SQL);
    const fullRows = await db.all(listRoofingPermitsSql());
    expect(fullRows).toHaveLength(PERMIT_BATCHES.length);
    await bind(VIEWS);
    expect(await db.all(COUNT_SQL)).toEqual(fullCount);
    expect(fullCount).toEqual([{ n: PERMIT_BATCHES.length }]);
    expect(await db.all(listRoofingPermitsSql())).toEqual(fullRows);
  });
});
