// A-11 (production fix): resumable, parallel, reusable re-export of the Property Improvement
// (permits) data group after the shared-files fix (75a0eaf).
//
// It runs twice -- a pilot on a small pID list, then the full list -- into the SAME output
// directory (`pipeline/data/runs/<job>/groups/property_improvement`), so the full run reuses the
// pilot's folders. Reuse and resume use one mechanism: a per-pID fingerprint stored OUTSIDE the
// group directory (everything inside it is hashed into the published CAR), at
// `pipeline/data/runs/<job>/reexport-state/<pID>.json`.
//
//   fingerprint = sha256(code hash | lexicon data-group CIDs | the pID's DB inputs digest)
//
// A pID is skipped only when its stored fingerprint equals the new one AND its final folder (or
// the recorded "empty") is in place; anything else is redone. Each chunk is written to a temp dir
// (`reexport-tmp/`, also outside the group dir) and each pID folder is renamed into place, so a
// half-written folder is never visible. The state file is written after the rename; a crash in
// between leaves a stale/missing state and the pID is simply redone.
//
// Usage (from pipeline/local-stack):
//   npx tsx scripts/reexport-permits.ts --pids <file> [--job <id>] [--chunk 500] [--concurrency 4]
//   npx tsx scripts/reexport-permits.ts --pids <file> --compare-run <run1 group dir> [--job <id>]
//
// `--compare-run <dir>` is read-only: it compares this job's folders with Run 1's `<dir>/<pID>/data/`
// by permit content (key `permit_number`), not by file number: trade sub-permits are no longer
// published, so `property_improvement_N.json` renumbers and some folders disappear.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type postgres from "postgres";
import { acquireRunLock } from "./run-lock.js";

export const DEFAULT_JOB = "travis-a11-permits-fix-20261024";
const PID_RE = /^[1-9][0-9]*$/;

const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- pIDs / paths

export function parsePids(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const p = raw.trim();
    if (p === "") continue;
    if (!PID_RE.test(p)) throw new Error(`invalid pID in list: ${JSON.stringify(p.slice(0, 40))}`);
    out.add(p);
  }
  return [...out].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

export interface Layout {
  groupDir: string;
  stateDir: string;
  tmpRoot: string;
}

export function layoutFor(runDir: string): Layout {
  return {
    groupDir: join(runDir, "groups", "property_improvement"),
    stateDir: join(runDir, "reexport-state"),
    tmpRoot: join(runDir, "reexport-tmp"),
  };
}

// ---------------------------------------------------------------- fingerprints

/** Source files whose contents shape the group's output (relative to the repo root). */
export const CODE_FILES = [
  "pipeline/oracle-runtime/travis/transforms/shared-seed.ts",
  "pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts",
  "pipeline/oracle-runtime/travis/permits/write-group.ts",
  "pipeline/oracle-runtime/travis/tcad/write-group.ts",
  "pipeline/oracle-runtime/travis/pilot/build-seed.ts",
  "pipeline/oracle-runtime/travis/tcad/year-built.ts",
  "pipeline/oracle-runtime/travis/pilot/profile-api.ts",
  "pipeline/oracle-runtime/travis/identity/resolver.ts",
  "pipeline/oracle-runtime/travis/identity/crosswalk.ts",
  "pipeline/oracle-runtime/travis/transforms/lexicon-manifest.ts",
  "pipeline/local-stack/services/workflows/permits-backbone.ts",
];
export const PROFILE_DIR = "profiles/travis-austin@1.0.0";

export function codeHashOf(repoRoot: string): string {
  const h = createHash("sha256");
  const files = [...CODE_FILES];
  const profileAbs = join(repoRoot, PROFILE_DIR);
  for (const name of readdirSync(profileAbs).sort()) {
    if (statSync(join(profileAbs, name)).isFile()) files.push(`${PROFILE_DIR}/${name}`);
  }
  for (const rel of files) {
    h.update(rel)
      .update("\0")
      .update(readFileSync(join(repoRoot, rel)))
      .update("\0");
  }
  return h.digest("hex");
}

export function fingerprintOf(codeHash: string, cidsKey: string, dbDigest: string): string {
  return sha256(`${codeHash}|${cidsKey}|${dbDigest}`);
}

/**
 * Per-pID digests of what the writer reads from the Query DB (read-only): the parcel columns
 * `parcelsFor` selects (payload as text) and the pID's permit rows (`content_sha256`, plus
 * `captured_at`, which feeds the receipt), sorted by permit number then hash.
 */
export async function dbDigests(
  sql: postgres.Sql,
  pids: readonly string[],
): Promise<Map<string, string>> {
  const list = pids as string[];
  const [parcels, permits] = await Promise.all([
    sql<Array<Record<string, unknown> & { request_identifier: string }>>`
      SELECT request_identifier, geo_id, payload_redacted::text AS payload_redacted,
             property_structure_built_year, export_point_lat, export_point_lon, export_point_kind,
             latitude, longitude, coordinate_source, coordinate_source_url
      FROM parcels
      WHERE request_identifier IN ${sql(list)}`,
    sql<
      Array<{
        request_identifier: string;
        permit_number: string;
        content_sha256: string;
        captured_at: string;
      }>
    >`
      SELECT pi.request_identifier AS request_identifier, pi.permit_number AS permit_number,
             psr.content_sha256 AS content_sha256, psr.captured_at::text AS captured_at
      FROM property_improvements pi
      JOIN permit_source_rows psr ON psr.source = pi.source AND psr.row_id = pi.source_row_id
      WHERE pi.tombstoned = false
        AND pi.request_identifier IS NOT NULL
        AND pi.request_identifier IN ${sql(list)}`,
  ]);
  const parcelBy = new Map(parcels.map((r) => [r.request_identifier, r]));
  const permitsBy = new Map<string, Array<[string, string, string]>>();
  for (const r of permits) {
    const a = permitsBy.get(r.request_identifier) ?? [];
    a.push([r.permit_number, r.content_sha256, r.captured_at]);
    permitsBy.set(r.request_identifier, a);
  }
  const out = new Map<string, string>();
  for (const pid of pids) {
    const rows = (permitsBy.get(pid) ?? []).sort(
      (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]),
    );
    out.set(pid, sha256(JSON.stringify({ parcel: parcelBy.get(pid) ?? null, permits: rows })));
  }
  return out;
}

// ---------------------------------------------------------------- the resumable run

export interface ReexportDeps {
  /** Per-pID digest of the DB inputs (read-only). */
  dbDigests(pids: readonly string[]): Promise<Map<string, string>>;
  /** Writes `<out>/<pID>/data/...` for each pID that emits; pIDs that emit nothing get no folder. */
  writeChunk(pids: readonly string[], out: string): Promise<void>;
  codeHash: string;
  cidsKey: string;
  log?(line: string): void;
}

export interface ReexportOptions extends Layout {
  pids: readonly string[];
  chunk: number;
  concurrency: number;
}

export interface ReexportSummary {
  total: number;
  /** Written for the first time (no earlier state). */
  done: number;
  /** Skipped: matching fingerprint and folder (or recorded empty) already in place. */
  reused: number;
  /** Rewritten because the fingerprint changed or the folder/state was missing. */
  redone: number;
  /** Emitted nothing (all permits skipped); counted among done/redone/reused too, shown separately. */
  empty: number;
  foldersWritten: number;
  permitFiles: number;
  failed: string | null;
}

interface PidState {
  fp: string;
  empty: boolean;
}

const statePath = (l: Layout, pid: string) => join(l.stateDir, `${pid}.json`);

function readState(l: Layout, pid: string): PidState | null {
  try {
    const s = JSON.parse(readFileSync(statePath(l, pid), "utf8")) as PidState;
    return typeof s.fp === "string" ? s : null;
  } catch {
    return null;
  }
}

function writeStateAtomic(l: Layout, pid: string, s: PidState): void {
  const p = statePath(l, pid);
  writeFileSync(`${p}.tmp`, JSON.stringify(s));
  renameSync(`${p}.tmp`, p);
}

export async function runReexport(
  opts: ReexportOptions,
  deps: ReexportDeps,
): Promise<ReexportSummary> {
  const log = deps.log ?? (() => {});
  // One run per job: the start wipes tmpRoot and state temp files are fixed names. The lock sits
  // next to the state dir, never inside the (hashed) group dir.
  mkdirSync(dirname(opts.stateDir), { recursive: true });
  const release = acquireRunLock(`${opts.stateDir}.lock`);
  try {
    return await runLocked(opts, deps, log);
  } finally {
    release();
  }
}

async function runLocked(
  opts: ReexportOptions,
  deps: ReexportDeps,
  log: (line: string) => void,
): Promise<ReexportSummary> {
  mkdirSync(opts.groupDir, { recursive: true });
  mkdirSync(opts.stateDir, { recursive: true });
  // Leftovers of a killed run: temp dirs are never trusted.
  rmSync(opts.tmpRoot, { recursive: true, force: true });
  mkdirSync(opts.tmpRoot, { recursive: true });

  const chunks: string[][] = [];
  for (let i = 0; i < opts.pids.length; i += opts.chunk)
    chunks.push(opts.pids.slice(i, i + opts.chunk));

  const sum: ReexportSummary = {
    total: opts.pids.length,
    done: 0,
    reused: 0,
    redone: 0,
    empty: 0,
    foldersWritten: 0,
    permitFiles: 0,
    failed: null,
  };
  let finished = 0;
  let next = 0;

  const doChunk = async (idx: number, pids: string[]) => {
    const digests = await deps.dbDigests(pids);
    const todo: Array<{ pid: string; fp: string; hadState: boolean }> = [];
    let reused = 0;
    let reusedEmpty = 0;
    for (const pid of pids) {
      const fp = fingerprintOf(deps.codeHash, deps.cidsKey, digests.get(pid) ?? "");
      const st = readState(opts, pid);
      const folderOk = existsSync(join(opts.groupDir, pid, "data"));
      if (st !== null && st.fp === fp && (st.empty ? !folderOk : folderOk)) {
        reused += 1;
        if (st.empty) reusedEmpty += 1;
      } else {
        todo.push({ pid, fp, hadState: st !== null || folderOk });
      }
    }
    let written = 0;
    let empty = 0;
    let done = 0;
    let redone = 0;
    if (todo.length > 0) {
      const tmp = join(opts.tmpRoot, `chunk-${idx}`);
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      await deps.writeChunk(
        todo.map((t) => t.pid),
        tmp,
      );
      for (const t of todo) {
        const src = join(tmp, t.pid);
        const dst = join(opts.groupDir, t.pid);
        const has = existsSync(join(src, "data"));
        rmSync(dst, { recursive: true, force: true });
        if (has) {
          renameSync(src, dst);
          written += 1;
        } else {
          empty += 1;
        }
        writeStateAtomic(opts, t.pid, { fp: t.fp, empty: !has });
        if (t.hadState) redone += 1;
        else done += 1;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
    sum.reused += reused;
    sum.done += done;
    sum.redone += redone;
    sum.empty += empty + reusedEmpty;
    sum.foldersWritten += written;
    finished += 1;
    log(
      `[reexport] chunk ${finished}/${chunks.length} pids=${pids.length} written=${written} reused=${reused} redone=${redone} empty=${empty + reusedEmpty}`,
    );
  };

  const worker = async () => {
    while (sum.failed === null) {
      const idx = next++;
      const pids = chunks[idx];
      if (pids === undefined) return;
      try {
        await doChunk(idx, pids);
      } catch (e) {
        sum.failed ??= `chunk ${idx} (pIDs ${pids[0]}..${pids[pids.length - 1]}): ${(e as Error).message}`;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));

  rmSync(opts.tmpRoot, { recursive: true, force: true });
  sum.permitFiles = countPermitFiles(opts.groupDir, opts.pids);
  return sum;
}

function countPermitFiles(groupDir: string, pids: readonly string[]): number {
  let n = 0;
  for (const pid of pids) {
    const d = join(groupDir, pid, "data");
    if (!existsSync(d)) continue;
    n += readdirSync(d).filter((f) => /^property_improvement_\d+\.json$/.test(f)).length;
  }
  return n;
}

// ---------------------------------------------------------------- --compare-run

export interface CompareResult {
  /** pIDs whose folder exists on both sides. */
  pidsCompared: number;
  /** Permits (by `permit_number`) found in this job's folders / in Run 1's, over the compared list. */
  permitsHere: number;
  permitsRun1: number;
  /** Permits present on both sides with byte-identical JSON content. */
  permitsIdentical: number;
  /** Violation: same permit_number on both sides, different JSON bytes. */
  permitContentDiffs: string[];
  /** Violation: a permit here that Run 1 did not publish. */
  permitsNotInRun1: string[];
  /** Run 1 permits absent here, by their `improvement_type` ("(none)" when missing). */
  droppedByType: Record<string, number>;
  /** Violation: a dropped Run 1 permit whose type is Roofing. */
  roofingLost: string[];
  /** pIDs with a folder in Run 1 and none here (allowed only when Run 1 had no Roofing permit). */
  pidsDropped: number;
  /** Violation: a dropped pID that had a Roofing permit in Run 1. */
  pidsDroppedWithRoofing: string[];
  /** Violation: a pID with a folder here and none in Run 1. */
  pidsNotInRun1: string[];
  /** Violation: unreadable permit file or a permit_number printed twice in one folder. */
  unreadable: string[];
  /** Shared files (informational; the shared-files fix makes them differ). */
  sharedDiffs: string[];
  sharedSame: number;
  ok: boolean;
}

const SHARED_NAMES = new Set([
  "address.json",
  "parcel.json",
  "address_has_parcel.json",
  "property.json",
]);
const PERMIT_FILE_RE = /^property_improvement_\d+\.json$/;

/** `permit_number -> { raw bytes, improvement_type }` of one `<pID>/data` folder. */
function readPermits(
  dir: string,
  label: string,
  unreadable: string[],
): Map<string, { raw: Buffer; type: string }> {
  const out = new Map<string, { raw: Buffer; type: string }>();
  for (const f of readdirSync(dir).filter((n) => PERMIT_FILE_RE.test(n))) {
    const raw = readFileSync(join(dir, f));
    try {
      const j = JSON.parse(raw.toString("utf8")) as {
        permit_number?: unknown;
        improvement_type?: unknown;
      };
      if (typeof j.permit_number !== "string" || j.permit_number === "")
        throw new Error("no permit_number");
      if (out.has(j.permit_number)) throw new Error(`permit_number ${j.permit_number} twice`);
      out.set(j.permit_number, {
        raw,
        type: typeof j.improvement_type === "string" ? j.improvement_type : "(none)",
      });
    } catch (e) {
      unreadable.push(`${label}/${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Compares this job's folders with Run 1's by permit content (not by file number): since
 * the PO decision to publish roofing only, trade sub-permits are gone and
 * `property_improvement_N.json` renumbers. Holds when every permit here exists in Run 1 with
 * byte-identical JSON, every Run 1 permit missing here is non-Roofing, and a pID dropped
 * entirely had no Roofing permit. Shared files are reported, never judged.
 */
export function compareRun(
  groupDir: string,
  run1Dir: string,
  pids: readonly string[],
  cids: { seed: string; propertyImprovement: string },
): CompareResult {
  const isShared = (f: string) => SHARED_NAMES.has(f) || f === `${cids.seed}.json`;
  const r: CompareResult = {
    pidsCompared: 0,
    permitsHere: 0,
    permitsRun1: 0,
    permitsIdentical: 0,
    permitContentDiffs: [],
    permitsNotInRun1: [],
    droppedByType: {},
    roofingLost: [],
    pidsDropped: 0,
    pidsDroppedWithRoofing: [],
    pidsNotInRun1: [],
    unreadable: [],
    sharedDiffs: [],
    sharedSame: 0,
    ok: true,
  };
  for (const pid of pids) {
    const a = join(groupDir, pid, "data");
    const b = join(run1Dir, pid, "data");
    const ea = existsSync(a);
    const eb = existsSync(b);
    if (!ea && !eb) continue;
    const here = ea ? readPermits(a, pid, r.unreadable) : new Map();
    const run1 = eb ? readPermits(b, pid, r.unreadable) : new Map();
    r.permitsHere += here.size;
    r.permitsRun1 += run1.size;
    if (ea && !eb) r.pidsNotInRun1.push(pid);
    if (eb && !ea) {
      r.pidsDropped += 1;
      if ([...run1.values()].some((p) => p.type === "Roofing")) r.pidsDroppedWithRoofing.push(pid);
    }
    if (ea && eb) {
      r.pidsCompared += 1;
      for (const f of new Set([...readdirSync(a), ...readdirSync(b)])) {
        if (!isShared(f)) continue;
        const same =
          existsSync(join(a, f)) &&
          existsSync(join(b, f)) &&
          readFileSync(join(a, f)).equals(readFileSync(join(b, f)));
        if (same) r.sharedSame += 1;
        else r.sharedDiffs.push(`${pid}/${f}`);
      }
    }
    for (const [num, p] of here) {
      const old = run1.get(num);
      if (old === undefined) r.permitsNotInRun1.push(`${pid}: ${num}`);
      else if (old.raw.equals(p.raw)) r.permitsIdentical += 1;
      else r.permitContentDiffs.push(`${pid}: ${num}`);
    }
    for (const [num, old] of run1) {
      if (here.has(num)) continue;
      r.droppedByType[old.type] = (r.droppedByType[old.type] ?? 0) + 1;
      if (old.type === "Roofing") r.roofingLost.push(`${pid}: ${num}`);
    }
  }
  r.ok =
    r.permitContentDiffs.length === 0 &&
    r.permitsNotInRun1.length === 0 &&
    r.roofingLost.length === 0 &&
    r.pidsDroppedWithRoofing.length === 0 &&
    r.pidsNotInRun1.length === 0 &&
    r.unreadable.length === 0;
  return r;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === undefined || !k.startsWith("--") || v === undefined)
      throw new Error(`bad arguments near ${k ?? ""}`);
    a[k.slice(2)] = v;
  }
  const num = (k: string, d: number) => {
    const n = a[k] === undefined ? d : Number(a[k]);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${k} must be a positive integer`);
    return n;
  };
  if (a["pids"] === undefined) throw new Error("--pids <file> is required");
  return {
    job: a["job"] ?? DEFAULT_JOB,
    pidsFile: a["pids"],
    chunk: Math.min(num("chunk", 500), 500),
    concurrency: num("concurrency", 4),
    compareRun: a["compare-run"],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const pids = parsePids(readFileSync(args.pidsFile, "utf8"));
  const layout = layoutFor(join(repoRoot, "pipeline/data/runs", args.job));
  if (layout.groupDir.includes("travis-a11-permits-full-20261023114303")) {
    throw new Error("refusing to write into Run 1's directory");
  }
  const { fetchDataGroupCids } =
    await import("../../oracle-runtime/travis/transforms/lexicon-manifest.js");
  const cids = (await fetchDataGroupCids()).cids;

  if (args.compareRun !== undefined) {
    const r = compareRun(layout.groupDir, resolve(args.compareRun), pids, cids);
    console.log(`[compare] pIDs with folders in both=${r.pidsCompared} of ${pids.length}`);
    console.log(
      `[compare] permits here=${r.permitsHere} Run 1=${r.permitsRun1} identical=${r.permitsIdentical} DIFFERENT=${r.permitContentDiffs.length} not in Run 1=${r.permitsNotInRun1.length}`,
    );
    const dropped = Object.entries(r.droppedByType).sort(([x], [y]) => x.localeCompare(y));
    console.log(
      `[compare] Run 1 permits not republished=${dropped.reduce((n, [, c]) => n + c, 0)} by type: ${
        dropped.map(([t, c]) => `${t}=${c}`).join(" ") || "none"
      }; Roofing lost=${r.roofingLost.length}`,
    );
    console.log(
      `[compare] pIDs dropped (in Run 1, none now)=${r.pidsDropped} with a Roofing permit=${r.pidsDroppedWithRoofing.length}; pIDs new vs Run 1=${r.pidsNotInRun1.length}; unreadable=${r.unreadable.length}`,
    );
    console.log(
      `[compare] shared files: identical=${r.sharedSame} differ=${r.sharedDiffs.length} (expected to differ)`,
    );
    for (const [label, list] of [
      ["PERMIT CONTENT DIFF", r.permitContentDiffs],
      ["PERMIT NOT IN RUN 1", r.permitsNotInRun1],
      ["ROOFING LOST", r.roofingLost],
      ["PID DROPPED WITH ROOFING", r.pidsDroppedWithRoofing],
      ["PID NOT IN RUN 1", r.pidsNotInRun1],
      ["UNREADABLE", r.unreadable],
    ] as const)
      for (const d of list.slice(0, 20)) console.log(`[compare] ${label}: ${d}`);
    console.log(`[compare] ${r.ok ? "PASS" : "FAIL"}`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }

  const { config } = await import("dotenv");
  config({ path: join(here, "../.env"), quiet: true });
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") throw new Error("DATABASE_URL is not set");
  const { default: pg } = await import("postgres");
  const travisAustin = await import("../../../profiles/travis-austin@1.0.0/index.js");
  const { profileApi } = await import("../../oracle-runtime/travis/pilot/profile-api.js");
  const { writeGroupWith } = await import("../services/workflows/permits-backbone.js");
  const profile = profileApi(travisAustin as unknown as Parameters<typeof profileApi>[0]);

  const sql = pg(url, { max: args.concurrency, onnotice: () => {} });
  try {
    console.log(
      `[reexport] job=${args.job} pids=${pids.length} chunk=${args.chunk} concurrency=${args.concurrency}`,
    );
    console.log(`[reexport] group dir ${layout.groupDir}`);
    const s = await runReexport(
      { ...layout, pids, chunk: args.chunk, concurrency: args.concurrency },
      {
        dbDigests: (p) => dbDigests(sql, p),
        writeChunk: async (p, out) => {
          await writeGroupWith(
            { sql, cids, profile, defaultDir: out, batchSize: args.chunk },
            args.job,
            { pids: p, out },
          );
        },
        codeHash: codeHashOf(repoRoot),
        cidsKey: `${cids.seed}|${cids.county}|${cids.propertyImprovement}`,
        log: (l) => console.log(l),
      },
    );
    console.log(
      `[reexport] summary total=${s.total} done=${s.done} reused=${s.reused} redone=${s.redone} empty=${s.empty} folders_written=${s.foldersWritten} property_improvement_files=${s.permitFiles}`,
    );
    if (s.failed !== null) {
      console.error(`[reexport] FAILED: ${s.failed} -- rerun the same command to resume`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`[reexport] FAILED: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
