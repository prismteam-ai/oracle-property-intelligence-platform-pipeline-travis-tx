// TEST FIXTURE (test-only): a synthetic export-tables output with chosen rows, bound through
// bindManifest(). Table columns come from the committed class-schema snapshot
// (test/fixtures/schemas/, written by T053); a table given as several row lists is written as
// several parts (to test duplicate part rows). The manifest is the committed pilot manifest with
// its table artifacts replaced by the fixture's parts.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindManifest, type BindOptions, type BoundRun } from "../../src/bind-manifest.js";
import { rawCid } from "../../src/raw-cid.js";
import { openDuckDb, type DuckDbEngine } from "../../scripts/duckdb-engine.js";
import { GAZETTEER } from "../../gazetteer/travis-places@1.0.0/index.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SCHEMAS = fileURLToPath(new URL("../fixtures/schemas/", import.meta.url));
export const MANIFEST_PATH = join(ROOT, "contract/v1/pilot-manifest.json");

type JsonType = string | string[] | undefined;
const duckType = (t: JsonType): string => {
  const types = Array.isArray(t) ? t : [t];
  if (types.includes("integer")) return "BIGINT";
  if (types.includes("number")) return "DOUBLE";
  if (types.includes("boolean")) return "BOOLEAN";
  return "VARCHAR";
};

/** The export-tables columns of a lexicon class: its properties plus the export extras. */
export function classColumns(cls: string): [string, string][] {
  const schema = JSON.parse(readFileSync(join(SCHEMAS, `${cls}.json`), "utf8")) as {
    properties?: Record<string, { type?: JsonType }>;
  };
  const props = Object.entries(schema.properties ?? {}).map(([name, p]): [string, string] => [
    name,
    duckType(p.type),
  ]);
  const extras: [string, string][] = [
    ["cid", "VARCHAR"],
    ["property_cid", "VARCHAR"],
    ["data_group_cid", "VARCHAR"],
  ];
  // address is a top-level oneOf: the export emits only the extras plus request_identifier.
  if (props.length === 0) extras.push(["request_identifier", "VARCHAR"]);
  return [...props, ...extras];
}

export const RELATIONSHIP: [string, string][] = [
  ["relationship_cid", "VARCHAR"],
  ["from_cid", "VARCHAR"],
  ["to_cid", "VARCHAR"],
  ["property_cid", "VARCHAR"],
  ["data_group_cid", "VARCHAR"],
];

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
/** One part (Row[]) or several parts (Row[][]). */
export type TableRows = Row[] | Row[][];
export type FixtureTables = Partial<
  Record<"county" | "property_improvement", Record<string, TableRows>>
>;

export const columnsOf = (table: string): [string, string][] =>
  table.includes("_has_") ? RELATIONSHIP : classColumns(table);

export const literal = (v: Value | undefined, type: string): string =>
  v === null || v === undefined
    ? `NULL::${type}`
    : typeof v === "string"
      ? `'${v.replace(/'/g, "''")}'::${type}`
      : `${String(v)}::${type}`;

export const AUSTIN_URL = "https://data.austintexas.gov/resource/3syk-w9eu.json";
export const TCAD_URL =
  "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip";

/** source_http_request JSON for an Austin per-permit GET, or the TCAD export GET. */
export const austinRequest = (permit: string, url = AUSTIN_URL): string =>
  JSON.stringify({ method: "GET", url, multiValueQueryString: { permit_number: [permit] } });
export const tcadRequest = (): string => JSON.stringify({ method: "GET", url: TCAD_URL });

export interface Fixture {
  db: DuckDbEngine;
  bound: BoundRun;
  rows: (sql: string) => Promise<Record<string, unknown>[]>;
  close: () => void;
}

export type ManifestJson = {
  artifacts: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  coverage: Record<string, { count: number; derivation: string; note?: string }>;
  [k: string]: unknown;
};

/** The committed pilot manifest with a travis-places profile (added if the file lacks one). */
export function baseManifest(): ManifestJson {
  const m = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ManifestJson;
  if (!m.profiles.some((p) => p.name === "travis-places")) {
    m.profiles.push({
      name: "travis-places",
      version: GAZETTEER.version,
      sha256: GAZETTEER.sha256,
      path: "packages/query-core/gazetteer/travis-places@1.0.0",
      gitCommit: "0000000",
    });
  }
  return m;
}

export async function bindFixture(
  tables: FixtureTables,
  mutate: (m: ManifestJson) => void = () => undefined,
  /** Bind on this engine instead of a fresh one (a warm engine rebinding to another manifest);
   *  close() then removes the fixture's files but leaves the engine open. */
  engine?: DuckDbEngine,
  /** bindManifest options, given the fixture's tables directory (ERR-19 subset binds). */
  options?: (dir: string) => BindOptions,
): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "views-fixture-"));
  const db = engine ?? (await openDuckDb());
  const closeDb = (): void => {
    if (engine === undefined) db.close();
  };
  const manifest = baseManifest();
  const parts: Record<string, unknown>[] = [];
  for (const [group, byTable] of Object.entries(tables)) {
    for (const [table, given] of Object.entries(byTable ?? {})) {
      const partRows: Row[][] =
        given.length > 0 && Array.isArray(given[0]) ? (given as Row[][]) : [given as Row[]];
      // address is a top-level oneOf, so the real export has no postal_code; a fixture can add that
      // column (a later export that emits oneOf properties) by giving any address row a value.
      const cols = [
        ...columnsOf(table),
        ...(table === "address"
          ? (["postal_code", "state_code", "unnormalized_address"]
              .filter((c) => partRows.some((p) => p.some((r) => c in r)))
              .map((c) => [c, "VARCHAR"]) as [string, string][])
          : []),
      ];
      for (const [i, rows] of partRows.entries()) {
        for (const r of rows)
          for (const k of Object.keys(r))
            if (!cols.some(([c]) => c === k)) throw new Error(`${table} has no column ${k}`);
        const part = `part-${String(i).padStart(5, "0")}.parquet`;
        mkdirSync(join(dir, group, table), { recursive: true });
        const file = join(dir, group, table, part);
        const selects =
          rows.length === 0
            ? [`SELECT ${cols.map(([c, t]) => `NULL::${t} AS "${c}"`).join(", ")} WHERE false`]
            : rows.map(
                (r) => `SELECT ${cols.map(([c, t]) => `${literal(r[c], t)} AS "${c}"`).join(", ")}`,
              );
        await db.run(`COPY (${selects.join(" UNION ALL ")}) TO '${file}' (FORMAT parquet)`);
        const bytes = readFileSync(file);
        parts.push({
          cid: await rawCid(bytes),
          codec: "raw",
          kind: "table",
          name: `tables/${group}/${table}/${part}`,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        });
      }
    }
  }
  manifest.artifacts = [...manifest.artifacts.filter((a) => a.kind !== "table"), ...parts];
  mutate(manifest);
  try {
    const bound = await bindManifest(
      new TextEncoder().encode(JSON.stringify(manifest)),
      dir,
      db,
      options?.(dir),
    );
    return {
      db,
      bound,
      rows: (sql) => db.all(sql),
      close: () => {
        closeDb();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** A minimal published property in both groups, with a geometry, a structure and one dated sale. */
export const P1 = "baguqeeraprop1";
export function propertyRows(cid = P1, builtYear: number | null = 1985): Row {
  return {
    cid,
    request_identifier: cid.slice(-5),
    parcel_identifier: "0100000001",
    property_type: "SingleFamily",
    property_usage_type: "Residential",
    property_structure_built_year: builtYear,
    source_http_request: tcadRequest(),
  };
}
