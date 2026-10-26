// Shared fixture for the run-manifest and publish-run tests: a throwaway "repo root" holding
// batched county/permits outputs (real CAR and dag-json bytes), the two source receipts, and a
// base ("Run 1") manifest built by the real buildManifest().
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CarWriter } from "@ipld/car/writer";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { cidOfBytes } from "../../src/cid.js";
import { buildManifest, manifestGroupInputsFromBatches } from "../../src/manifest.js";
import { PART_SIZE_BYTES } from "../../src/sequence.js";

export function put(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

async function writeCar(path: string, value: unknown): Promise<CID> {
  const bytes = dagJson.encode(value);
  const root = CID.create(1, dagJson.code, await sha256.digest(bytes));
  const { writer, out } = CarWriter.create([root]);
  const chunks: Uint8Array[] = [];
  const done = (async () => {
    for await (const c of out) chunks.push(c);
  })();
  await writer.put({ cid: root, bytes });
  await writer.close();
  await done;
  put(path, Buffer.concat(chunks));
  return root;
}

/** Writes `<dir>/cars/<prefix>-bNN.car` and `<dir>/tables/bNN/` + `bNN-export.json` per batch. */
export async function makeBatches(options: {
  dir: string;
  group: "county" | "property_improvement";
  prefix: string;
  table: string;
  rows: readonly number[];
  /** Changes every CID (a rebuilt group). */
  salt: string;
  /** More tables per batch: table name -> rows per batch (same length as `rows`). */
  extraTables?: Readonly<Record<string, readonly number[]>>;
}): Promise<void> {
  for (const [i, rows] of options.rows.entries()) {
    const b = String(i + 1).padStart(2, "0");
    const tableRows: Record<string, number> = { [options.table]: rows };
    for (const [name, perBatch] of Object.entries(options.extraTables ?? {})) {
      const n = perBatch[i];
      if (n === undefined) throw new Error(`extraTables.${name} has no rows for batch ${b}`);
      tableRows[name] = n;
    }
    const carRoot = await writeCar(join(options.dir, "cars", `${options.prefix}-b${b}.car`), {
      label: "CountyIndex",
      group: options.group,
      batch: b,
      salt: options.salt,
    });
    const tablesDir = join(options.dir, "tables", `b${b}`);
    const carTables: Record<string, unknown> = {};
    const summaryTables: Record<string, { rows: number; parts: number }> = {};
    for (const [name, n] of Object.entries(tableRows)) {
      const suffix = name === options.table ? "" : ` ${name}`;
      const bytes = new TextEncoder().encode(`PAR1 ${options.group} ${b} ${options.salt}${suffix}`);
      put(join(tablesDir, name, "part-00000.parquet"), bytes);
      carTables[name] = {
        rows: n,
        parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: n, bytes: bytes.length }],
      };
      summaryTables[name] = { rows: n, parts: 1 };
    }
    const tablesRoot = await writeCar(join(tablesDir, "tables.car"), {
      label: "CountyTables",
      version: 1,
      county_root: carRoot,
      part_size_bytes: PART_SIZE_BYTES,
      codec: "zstd",
      tables: carTables,
    });
    put(
      join(options.dir, "tables", `b${b}-export.json`),
      JSON.stringify({
        output: tablesDir,
        car: join(tablesDir, "tables.car"),
        root: tablesRoot.toString(),
        countyRoot: carRoot.toString(),
        partSizeBytes: PART_SIZE_BYTES,
        codec: "zstd",
        tables: summaryTables,
        parts: Object.keys(summaryTables).length,
        exportedAt: "2026-10-23T15:00:00.000Z",
      }),
    );
  }
}

/** The fixture's county ownership and coordinates rows per batch (b01, b02). */
export const COUNTY_EXTRA_TABLES = {
  sales_history: [9, 12],
  person: [4, 5],
  company: [1, 2],
  geometry: [5, 5],
} as const;

export const SHA = "c".repeat(64);
export const BASE_RUN_ID = "travis-full-run1-20261023";
export const NOT_YET_PUBLISHED = (): string => "";

export interface RunFixture {
  root: string;
  baseCid: string;
  baseBytes: Uint8Array;
  countyDir: string;
  /** The permits batches Run 1 had (the ones that did not join). */
  permitsV1: string;
  /** The rebuilt permits batches (same row counts, new CIDs). */
  permitsV2: string;
}

/** A repo root with a published base run (runs/<BASE_RUN_ID>/manifest.json) and a rebuilt permits group. */
export async function runFixture(permitRows: readonly number[] = [3, 4]): Promise<RunFixture> {
  const root = mkdtempSync(join(tmpdir(), "run2-"));
  const countyDir = join(root, "data/county-batched");
  const permitsV1 = join(root, "data/permits-v1-batched");
  const permitsV2 = join(root, "data/permits-v2-batched");
  await makeBatches({
    dir: countyDir,
    group: "county",
    prefix: "travis-county",
    table: "property",
    rows: [5, 6],
    salt: "c",
    extraTables: COUNTY_EXTRA_TABLES,
  });
  await makeBatches({
    dir: permitsV1,
    group: "property_improvement",
    prefix: "travis-permits",
    table: "property_improvement",
    rows: permitRows,
    salt: "v1",
  });
  await makeBatches({
    dir: permitsV2,
    group: "property_improvement",
    prefix: "travis-permits",
    table: "property_improvement",
    rows: permitRows,
    salt: "v2",
  });
  put(
    join(root, "specs/011-publish-and-runs/receipts/austin-run1.json"),
    JSON.stringify({ captured_at: "2026-10-21T22:32:55.000Z", records: 2381226 }),
  );
  put(
    join(root, "specs/011-publish-and-runs/receipts/tcad-run1.json"),
    JSON.stringify({ captured_at: "2026-10-22T05:48:41.000Z", records: 493246 }),
  );
  const emitted = permitRows.reduce((a, b) => a + b, 0);
  const built = await buildManifest({
    runId: BASE_RUN_ID,
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-23T10:27:00.000Z",
    finishedAt: "2026-10-23T15:41:00.000Z",
    previousManifestCid: null,
    runDir: root,
    groups: [
      ...manifestGroupInputsFromBatches({
        group: "county",
        dir: countyDir,
        carPrefix: "travis-county",
        batches: [1, 2],
      }),
      ...manifestGroupInputsFromBatches({
        group: "property_improvement",
        dir: permitsV1,
        carPrefix: "travis-permits",
        batches: [1, 2],
      }),
    ],
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-21T14:42:23.154Z",
        receipts: join(root, "specs/011-publish-and-runs/receipts/austin-run1.json"),
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: "entry@sha256:" + "6".repeat(64),
        receipts: join(root, "specs/011-publish-and-runs/receipts/tcad-run1.json"),
        limitations: [],
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: SHA,
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "0421ac2",
      },
    ],
    coverage: {
      permits_emitted: {
        count: emitted,
        derivation: "published_rows",
        note: `b01 ${permitRows[0]} + b02 ${permitRows[1]}, roofing-classified decided-status permits only (PO 2026-10-23)`,
      },
      permits_no_tcad_geoid: { count: 100, derivation: "aggregate_match" },
      permits_no_tcad_id: { count: 20, derivation: "aggregate_match" },
      permits_ambiguous_geoid: { count: 30, derivation: "aggregate_match" },
      permits_address_unmatched: { count: 40, derivation: "aggregate_match" },
      permits_ambiguous_address: { count: 5, derivation: "aggregate_match" },
      contractor_resolved: { count: 0, derivation: "aggregate_match" },
      contractor_candidate: { count: 0, derivation: "aggregate_match" },
      contractor_unresolved: { count: emitted, derivation: "aggregate_match" },
    },
    ownersRedacted: 15410,
    limitations: [
      "DRAFT for Stage 6 S6a.2 pre-publish review -- not uploaded, not the final publish manifest",
      "county published_rows is R-only",
    ],
    repoRoot: root,
    workTreeStatus: NOT_YET_PUBLISHED,
  });
  put(join(root, "runs", BASE_RUN_ID, "manifest.json"), built.bytes);
  return { root, baseCid: built.cid, baseBytes: built.bytes, countyDir, permitsV1, permitsV2 };
}
