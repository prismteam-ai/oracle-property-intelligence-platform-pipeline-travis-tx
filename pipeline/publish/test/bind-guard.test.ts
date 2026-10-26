// CR-A-03 F-1 (defence): the bind guard binds a built manifest against the LOCAL tables with the
// real query-core bindManifest over a node DuckDB (scripts/local-bind.ts), then runs
// listRoofingPermitsSql() and runSummarySql(); the permit rows must equal
// coverage.permits_emitted. The tables are a tiny export written here with DuckDB (no network,
// no elephant-cli): county.property and property_improvement.{property_improvement,
// property_has_property_improvement}. The manifest is the committed pilot manifest with its
// table artifacts replaced by these parts.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUIRED_TABLES } from "../../../packages/query-core/src/bind-manifest.js";
import { openDuckDb } from "../../../packages/query-core/scripts/duckdb-engine.js";
import { localBind } from "../scripts/local-bind.js";
import { BindGuardError, assertBindable } from "../src/bind-guard.js";
import { cidOfBytes } from "../src/cid.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const RUN_ID = "travis-202609-permits-20261021t160000z";
const AUSTIN = "https://data.austintexas.gov/resource/3syk-w9eu.json";

type Value = string | number | null;
type Row = Record<string, Value>;

const columnsOf = (group: string, table: string): [string, string][] => {
  const r = REQUIRED_TABLES.find((t) => t.group === group && t.table === table);
  if (r === undefined) throw new Error(`no required table ${group}.${table}`);
  return Object.entries(r.columns);
};

const literal = (v: Value | undefined, type: string): string =>
  v === null || v === undefined
    ? `NULL::${type}`
    : typeof v === "string"
      ? `'${v.replace(/'/g, "''")}'::${type}`
      : `${String(v)}::${type}`;

const permit = (cid: string, n: string): Row => ({
  cid,
  property_cid: "prop1",
  request_identifier: cid,
  permit_number: n,
  improvement_type: "Roofing",
  improvement_action: "Replacement",
  improvement_status: "Permitted",
  permit_issue_date: "2026-09-02",
  source_http_request: JSON.stringify({
    method: "GET",
    url: AUSTIN,
    multiValueQueryString: { permit_number: [n] },
  }),
});

const TABLES: Record<string, Record<string, Row[]>> = {
  county: {
    property: [
      {
        cid: "prop1",
        request_identifier: "100008",
        parcel_identifier: "0100030105",
        property_type: "SingleFamily",
        property_usage_type: "Residential",
        property_structure_built_year: 1985,
      },
    ],
  },
  property_improvement: {
    property_improvement: [permit("pa", "2026-100001 BP"), permit("pb", "2026-100005 BP")],
    property_has_property_improvement: [
      { from_cid: "prop1", to_cid: "pa" },
      { from_cid: "prop1", to_cid: "pb" },
    ],
  },
};

type Manifest = {
  runId: string;
  artifacts: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  coverage: Record<string, { count: number; derivation: string; note?: string }>;
  limitations: string[];
  [k: string]: unknown;
};

let runDir: string;
let parts: Record<string, unknown>[];

beforeAll(async () => {
  runDir = mkdtempSync(join(tmpdir(), "bind-guard-"));
  const db = await openDuckDb();
  parts = [];
  try {
    for (const [group, byTable] of Object.entries(TABLES)) {
      for (const [table, rows] of Object.entries(byTable)) {
        const cols = columnsOf(group, table);
        const dir = join(runDir, "tables", group, table);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, "part-00000.parquet");
        const selects = rows.map(
          (r) => `SELECT ${cols.map(([c, t]) => `${literal(r[c], t)} AS "${c}"`).join(", ")}`,
        );
        await db.run(`COPY (${selects.join(" UNION ALL ")}) TO '${file}' (FORMAT parquet)`);
        const bytes = readFileSync(file);
        parts.push({
          cid: await cidOfBytes(bytes),
          codec: "raw",
          kind: "table",
          name: `tables/${group}/${table}/part-00000.parquet`,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        });
      }
    }
  } finally {
    db.close();
  }
});

afterAll(() => rmSync(runDir, { recursive: true, force: true }));

/** The pilot manifest over this run's parts; `mutate` changes it before it is encoded. */
async function built(mutate: (m: Manifest) => void = () => undefined) {
  const m = JSON.parse(
    readFileSync(join(ROOT, "contract/v1/pilot-manifest.json"), "utf8"),
  ) as Manifest;
  m.runId = RUN_ID;
  m.limitations = m.limitations.filter((l) => !l.startsWith("pilot:"));
  m.artifacts = [...m.artifacts.filter((a) => a.kind !== "table"), ...parts];
  m.coverage.permits_emitted = { count: 2, derivation: "published_rows" };
  mutate(m);
  const bytes = new TextEncoder().encode(JSON.stringify(m));
  return { bytes, cid: await cidOfBytes(bytes), manifest: m };
}

describe("the bind guard over the real query-core bindManifest and a local DuckDB", () => {
  it("binds a manifest with travis-austin, the roof profile and travis-places: 2 rows = permits_emitted", async () => {
    const b = await built();
    const bound = await assertBindable(b, runDir, localBind);
    expect(bound).toMatchObject({
      runId: RUN_ID,
      manifestCid: b.cid,
      permitRows: 2,
      roofingPermitRows: 2,
    });
    expect(bound.tables).toBeGreaterThan(3);
  });

  it("binds a manifest without the travis-places profile (A-07 Track C out of scope, e.g. Run 1): same row counts, graceful degrade not BindGuardError", async () => {
    const b = await built((m) => {
      m.profiles = m.profiles.filter((p) => p.name !== "travis-places");
    });
    const bound = await assertBindable(b, runDir, localBind);
    expect(bound).toMatchObject({
      runId: RUN_ID,
      manifestCid: b.cid,
      permitRows: 2,
      roofingPermitRows: 2,
    });
    expect(bound.tables).toBeGreaterThan(3);
  });

  it("refuses a bound row count that is not coverage.permits_emitted", async () => {
    const b = await built((m) => {
      m.coverage.permits_emitted = { count: 3, derivation: "published_rows" };
    });
    const error = await assertBindable(b, runDir, localBind).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BindGuardError);
    expect((error as Error).message).toMatch(/2 roofing permit rows.*permits_emitted 3/);
  });
});
