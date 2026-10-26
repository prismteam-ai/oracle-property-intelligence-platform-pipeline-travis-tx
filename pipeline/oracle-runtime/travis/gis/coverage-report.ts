// A-04 T045 (AC-8, FR-008, FR-024; TC-023 step 5): coordinate coverage of R accounts both ways.
//
// - Public: the frozen `v_property` view (packages/query-core views.sql) bound by query-core
//   `bindManifest({ partUrl })` to the LOCAL export-tables parts of the County group
//   (R accounts only), run through the DuckDB CLI over a scratch database file. The binding
//   manifest is built in memory from the local parts (raw-codec CIDv1 of each part's bytes),
//   never written and never sent anywhere: A-04 publishes nothing.
// - Query DB: `coordinates.coverage_r` and `coordinates.by_source.permit_point` from the
//   read-only BackboneReport (its SQL is QDB_COVERAGE_SQL for the job), through the Restate
//   ingress; oracle-runtime never opens the Query DB.
// Gate (DP-3): count(*) and count(DISTINCT property_cid) of v_property and the Query DB R-account
// count (the report's `denominator_r`, i.e. the run's own reconciliation, never a literal) must
// agree, or differ by exactly the stated explained difference; the two shares must agree within
// SHARE_TOLERANCE after removing the permit_point accounts (D-9: a permit point is never public
// geometry). Any failure is listed and the command exits non-zero.
// Last line: `coverage_public=<p> coverage_qdb=<q> permit_point=<n>` (4 decimals).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { RestateIngressClient } from "../backbone/restate-client.js";

export const PUBLIC_COVERAGE_SQL = "SELECT avg((latitude IS NOT NULL)::int) FROM v_property";
export const PUBLIC_COUNTS_SQL =
  "SELECT count(*)::BIGINT AS n, count(DISTINCT property_cid)::BIGINT AS d FROM v_property";
/** Absolute tolerance between the Query DB share (less permit points) and the v_property share. */
export const SHARE_TOLERANCE = 0.0005;
export const QDB_COVERAGE_SQL =
  "SELECT avg((latitude IS NOT NULL)::int) FROM parcels WHERE prop_type = 'R'";

const TCAD_SOURCE = "tcad-2026-certified-json";
const REPO = new URL("../../../../", import.meta.url);

export type Row = Record<string, unknown>;
export interface QueryEngine {
  run(sql: string): Promise<void>;
  all(sql: string): Promise<Row[]>;
}

export const coverageLine = (p: number, q: number, n: number): string =>
  `coverage_public=${p.toFixed(4)} coverage_qdb=${q.toFixed(4)} permit_point=${n}`;

export function jobIdFromTables(tablesDir: string): string | null {
  return /(travis-a04-[a-z0-9-]+)/.exec(tablesDir)?.[1] ?? null;
}

/** A QueryEngine over the DuckDB CLI: one process per call, state kept in `dbPath`. */
export function duckdbCliEngine(dbPath: string, bin = "duckdb"): QueryEngine {
  const exec = (args: string[], sql: string): string => {
    const r = spawnSync(bin, [...args, dbPath], {
      input: `SET TimeZone = 'UTC';\n${sql};\n`,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (r.error !== undefined) throw new Error(`duckdb CLI: ${r.error.message}`);
    if (r.status !== 0)
      throw new Error(`duckdb CLI exited ${r.status}: ${(r.stderr ?? "").slice(0, 500)}`);
    return r.stdout ?? "";
  };
  return {
    async run(sql) {
      exec(["-bail"], sql);
    },
    async all(sql) {
      const text = exec(["-json", "-bail"], sql).trim();
      // the SET statement prints nothing; the query prints one JSON array
      const start = text.lastIndexOf("[{");
      return start < 0 ? [] : (JSON.parse(text.slice(start)) as Row[]);
    },
  };
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Streams a file: its sha256 and the raw-codec CIDv1 of those bytes (one block, sha2-256). */
async function digestFile(path: string): Promise<{ sha256: string; cid: string; size: number }> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  const digest = hash.digest();
  const cid = `b${base32(Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]))}`;
  return { sha256: digest.toString("hex"), cid, size: statSync(path).size };
}

interface QueryCore {
  bindManifest(
    manifestBytes: Uint8Array,
    tablesDir: string,
    engine: QueryEngine,
    options: {
      partUrl?: (a: { name: string; cid: string }) => string;
      groupSources?: Record<string, string>;
      views?: readonly string[];
    },
  ): Promise<unknown>;
  gazetteer: { GAZETTEER: { version: string; sha256: string } };
}
interface ProfilePkg {
  PROFILE: { name: string; version: string; sha256: string };
}

const SourceReceipt = z.object({ url: z.string().url(), captured_at: z.string() }).loose();

/** The certified-export receipt from pipeline/docs/travis-sources.yaml (the County group's source). */
function tcadReceipt(): { url: string; captured_at: string } {
  const doc = parse(readFileSync(new URL("pipeline/docs/travis-sources.yaml", REPO), "utf8")) as {
    parcel?: { export_receipt?: unknown };
  };
  return SourceReceipt.parse(doc.parcel?.export_receipt);
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: new URL(".", REPO),
      encoding: "utf8",
    }).trim();
  } catch {
    return "0000000";
  }
}

/** The County group folder of an export-tables output: `<tables>/county` or `<tables>` itself. */
function countyDir(tablesDir: string): string {
  const nested = join(tablesDir, "county");
  return existsSync(nested) && statSync(nested).isDirectory() ? nested : tablesDir;
}

export interface PublicStats {
  share: number;
  rows: number;
  distinct: number;
}

/** Binds v_property to the local parts and returns its public coordinate share and row counts. */
export async function localPublicCoverage(
  tablesDir: string,
  dbPath?: string,
  engineFor: (path: string) => QueryEngine = (p) => duckdbCliEngine(p),
): Promise<PublicStats> {
  const qcUrl: string = new URL("packages/query-core/src/index.ts", REPO).href;
  const profileUrl: string = new URL("profiles/travis-austin@1.0.0/index.ts", REPO).href;
  const qc = (await import(qcUrl)) as QueryCore;
  const profile = (await import(profileUrl)) as ProfilePkg;
  const group = countyDir(tablesDir);
  const artifacts: Array<Record<string, unknown>> = [];
  const files = new Map<string, string>();
  for (const table of readdirSync(group).sort()) {
    const dir = join(group, table);
    if (!statSync(dir).isDirectory()) continue;
    for (const part of readdirSync(dir)
      .filter((f) => f.endsWith(".parquet"))
      .sort()) {
      const name = `tables/county/${table}/${part}`;
      const d = await digestFile(join(dir, part));
      files.set(name, join(dir, part));
      artifacts.push({
        name,
        cid: d.cid,
        codec: "raw",
        size: d.size,
        sha256: d.sha256,
        kind: "table",
      });
    }
  }
  if (artifacts.length === 0) throw new Error(`coverage: no parquet parts under ${group}`);
  const receipt = tcadReceipt();
  const now = new Date().toISOString();
  const commit = gitCommit();
  const manifest = {
    schema: "oracle-travis-run-manifest.v1",
    runId: "a04-local-coverage-binding",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: now,
    finishedAt: now,
    previousManifestCid: null,
    sources: [
      {
        name: TCAD_SOURCE,
        url: receipt.url,
        watermark: null,
        captured_at: receipt.captured_at,
        records: 0,
        added: 0,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts,
    profiles: [
      { ...profile.PROFILE, path: "profiles/travis-austin@1.0.0/rules.json", gitCommit: commit },
      {
        name: "travis-places",
        version: qc.gazetteer.GAZETTEER.version,
        sha256: qc.gazetteer.GAZETTEER.sha256,
        path: "packages/query-core/gazetteer/travis-places@1.0.0/owner-area.json",
        gitCommit: commit,
      },
    ],
    coverage: {},
    limitations: ["A-04 local coverage binding: in memory only, never written or published"],
  };
  const scratch = dbPath === undefined ? mkdtempSync(join(tmpdir(), "a04-coverage-")) : null;
  const engine = engineFor(dbPath ?? join(scratch ?? "", "coverage.duckdb"));
  try {
    await qc.bindManifest(new TextEncoder().encode(JSON.stringify(manifest)), group, engine, {
      partUrl: ({ name }) => files.get(name) ?? name,
      groupSources: { county: TCAD_SOURCE },
      views: ["v_property"],
    });
    const [row] = await engine.all(PUBLIC_COVERAGE_SQL);
    const value = row === undefined ? null : Object.values(row)[0];
    if (typeof value !== "number") throw new Error("coverage: v_property is empty");
    const [counts] = await engine.all(PUBLIC_COUNTS_SQL);
    const rows = Number(counts?.n);
    const distinct = Number(counts?.d);
    if (!Number.isFinite(rows) || !Number.isFinite(distinct))
      throw new Error("coverage: v_property counts are unreadable");
    return { share: value, rows, distinct };
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }
}

const CoordinatesSection = z
  .object({
    coverage_r: z.number(),
    denominator_r: z.number().int().nonnegative(),
    by_source: z.object({ permit_point: z.number().int().nonnegative() }).loose(),
  })
  .loose();
const Report = z.object({ coordinates: CoordinatesSection }).loose();

export interface CoverageDeps {
  tablesDir: string;
  jobId: string | null;
  ingress: RestateIngressClient;
  /** Public share and counts; default binds v_property to the local parts (localPublicCoverage). */
  publicCoverage?: (tablesDir: string) => Promise<PublicStats>;
  dbPath?: string;
  /** Public rows minus Query DB R accounts that the run explains (default 0). */
  explainedDifference?: number | undefined;
  shareTolerance?: number;
}

export interface CoverageResult {
  line: string;
  lines: string[];
  jobId: string;
  coverage_public: number;
  coverage_qdb: number;
  permit_point: number;
  publicCounts: { rows: number; distinct: number };
  qdbRAccounts: number;
  ok: boolean;
  failures: string[];
}

export async function runCoverage(deps: CoverageDeps): Promise<CoverageResult> {
  const jobId = deps.jobId ?? jobIdFromTables(deps.tablesDir);
  if (jobId === null) throw new Error("coverage: give --job <jobId> (the tables path names none)");
  const report = Report.parse(await deps.ingress.call("BackboneReport", "get", { jobId }));
  const pub = await (deps.publicCoverage ?? ((d) => localPublicCoverage(d, deps.dbPath)))(
    deps.tablesDir,
  );
  const q = report.coordinates.coverage_r;
  const n = report.coordinates.by_source.permit_point;
  const qdbR = report.coordinates.denominator_r;
  const explained = deps.explainedDifference ?? 0;
  const tol = deps.shareTolerance ?? SHARE_TOLERANCE;
  const failures: string[] = [];
  if (pub.rows !== pub.distinct)
    failures.push(
      `duplicate property_cid in v_property: count(*)=${pub.rows} count(DISTINCT property_cid)=${pub.distinct}`,
    );
  for (const [label, value] of [
    ["count(*)", pub.rows],
    ["count(DISTINCT property_cid)", pub.distinct],
  ] as const) {
    if (value - qdbR !== explained)
      failures.push(
        `${label} of v_property is ${value}, Query DB R accounts are ${qdbR} (explained difference ${explained})`,
      );
  }
  const expectedPublic = qdbR > 0 ? q - n / qdbR : q;
  if (Math.abs(pub.share - expectedPublic) > tol)
    failures.push(
      `coordinate share differs: v_property ${pub.share.toFixed(4)} vs Query DB ${q.toFixed(4)} less permit points ${expectedPublic.toFixed(4)} (tolerance ${tol})`,
    );
  const line = coverageLine(pub.share, q, n);
  const lines = [
    `v_property rows=${pub.rows} distinct_property_cid=${pub.distinct} qdb_r_accounts=${qdbR} explained_difference=${explained}`,
    ...failures.map((f) => `coverage_gate=FAIL: ${f}`),
    ...(failures.length === 0 ? ["coverage_gate=PASS"] : []),
    line,
  ];
  return {
    line,
    lines,
    jobId,
    coverage_public: pub.share,
    coverage_qdb: q,
    permit_point: n,
    publicCounts: { rows: pub.rows, distinct: pub.distinct },
    qdbRAccounts: qdbR,
    ok: failures.length === 0,
    failures,
  };
}
