// A-04 T026: the TcadBackbone run (durable-workflow-builder: CountyIngest-style workflow keyed
// by job id, pattern 11 fan-out to TcadChunk children with the pattern 1 backpressure window,
// durable promise for WAITING_HUMAN). Pure logic over injected deps; the Restate binding is
// pipeline/local-stack/services/workflows/tcad-backbone.ts (SDK type-only here).
//   1 status running
//   2 verify the export against the A-01 receipt (size/mtime/inode summary, CR2-10). Missing or
//     mismatched → status waiting_human and wait on a durable promise BEFORE any request
//     (NFR-002 "no new TCAD download without a stop"). Only a human resolution `download`
//     allows ONE identified request through the source client; a 403 is a blocked receipt,
//     status waiting_human again, no retry.
//   3 stream the export once (pilot: the seed pIDs only), write chunk inputs of `chunkSize`
//     records, run TcadChunk children with at most `window` in flight
//   4 refuse every other export file in the input dir (a supplemental export is never mixed in)
//   5 reconcile (seed = loaded + dead + invalid + transform_failure), dead.json, the D-7
//     limitations, finalize (duplicate export points, key inventory digest), status complete
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  DEFAULT_BATCH_PAUSE_MS,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_WINDOW,
} from "../backbone/batch-defaults.js";
import { RunDataError } from "../backbone/errors.js";
import { MIN_FREE_BYTES, freeBytesAt } from "../backbone/disk-guard.js";
import type { DownloadRequest, DownloadResult } from "../lib/source-client.js";
import { GAZETTEER_SHA256 } from "../../../../packages/query-core/src/sql.generated.js";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import { PROPERTY_TYPE_RULES_VERSION } from "../transforms/shared-seed.js";
import { writeChunkInput, type ChunkMergeOp, type ChunkOutcome, type ChunkSpec } from "./chunk.js";
import type { ExportRecordText } from "./export-stream.js";
import { ExportVerifyError } from "./export-verify.js";
import { DUPLICATE_MIN_GEOIDS } from "./export-point.js";
import { limitationsFor } from "./redact.js";
import { reconcile, writeDeadRecords, type Reconciliation } from "./reconcile.js";
import { emptyTypeStats, type ChunkSummary, type TypeStats } from "./process.js";
import type { CoverageRow } from "./write-group.js";

export type { ChunkOutcome, ChunkSpec } from "./chunk.js";

export const TCAD_SOURCE_KEY = "tcad-2026-certified-json";
export {
  DEFAULT_BATCH_PAUSE_MS,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_WINDOW,
} from "../backbone/batch-defaults.js";
/** Health gate: wait 10 s, doubling to at most 60 s, for up to 30 minutes in total. */
export const HEALTH_BACKOFF_FIRST_MS = 10_000;
export const HEALTH_BACKOFF_MAX_MS = 60_000;
export const HEALTH_WAIT_TOTAL_MS = 30 * 60 * 1000;
export const HEALTH_GATE_MESSAGE = "health gate: Postgres/Docker unreachable for 30 min"; // grep-gates:allow message required by the run contract
/** Download limits for the one identified request (A-01 FR-003). */
export const DOWNLOAD_INACTIVITY_MS = 10 * 60 * 1000;
export const DOWNLOAD_TOTAL_MS = 2 * 60 * 60 * 1000;

export type RunStatus = "running" | "waiting_human" | "blocked" | "complete" | "failed";

export type TrackOp =
  | ChunkMergeOp
  | { kind: "finalize"; duplicateMinGeoids: number; keyInventorySha256: string }
  | {
      kind: "run";
      track: "appraisal";
      mode: "pilot" | "full";
      status: RunStatus;
      as_of?: string;
      export_sha256?: string;
      gazetteer_sha256?: string;
      code_sha?: string;
    }
  | {
      kind: "receipt";
      receipt: {
        source_key: string;
        url: string;
        http_status: number | null;
        bytes: number | null;
        sha256: string | null;
        captured_at: string;
        outcome: "ok" | "blocked" | "error" | "skipped_checkpoint";
        attempts: number;
        ua: string;
        blocked_at: string | null;
      };
    }
  | {
      kind: "limitations";
      items: Array<{
        source_key: string;
        code: string;
        text: string;
        count: number | null;
        evidence_url: string | null;
      }>;
    };

/**
 * The Loader input for one op: file ops carry their artifact; others hash the op itself plus
 * `seq` (a counter journaled in the workflow) and `nonce` (per invocation), so a repeated
 * status op (waiting_human → running → waiting_human) or a same-job re-run is a new merge and is
 * applied, not skipped as already merged (CR-1). Retries of one call reuse seq and nonce, so
 * they stay idempotent.
 */
export function loaderInput(
  jobId: string,
  op: TrackOp,
  unique: { seq: number; nonce: string } = { seq: 0, nonce: "" },
): { jobId: string; artifactPath: string; artifactSha256: string; op: Record<string, unknown> } {
  if (op.kind === "chunk") {
    return {
      jobId,
      artifactPath: op.artifactPath,
      artifactSha256: op.artifactSha256,
      op: { kind: "chunk" },
    };
  }
  const sha = createHash("sha256")
    .update(`${jobId}\n${unique.nonce}\n${unique.seq}\n${JSON.stringify(op)}`)
    .digest("hex");
  return { jobId, artifactPath: `op:${op.kind}`, artifactSha256: sha, op };
}

export interface BackboneInput {
  jobId: string;
  mode: "pilot" | "full";
  /** Run as-of date, fixed once for the run (RunContext.asOf). */
  asOf: string;
  /** The export file the A-01 receipt names (absolute). */
  exportPath: string;
  receipt: { url: string; sha256: string; captured_at: string };
  /** pipeline/data/runs/<jobId> (absolute). */
  runDir: string;
  /** Pilot: only these pIDs (as printed). */
  seedPids?: string[];
  chunkSize?: number;
  window?: number;
  /** Durable pause before each chunk (default 2000 ms; 0 = none). */
  batchPauseMs?: number;
  /** Pilot: write the County group (needs the live lexicon data-group CIDs). */
  cids?: DataGroupCids;
  codeSha?: string;
}

export type Resolution = { action: "download" } | { action: "abort" };

/** Thrown by a test's waitForHuman to stand for a suspended Restate invocation. */
export class Suspended extends Error {
  override name = "Suspended";
}

/** Counts only; readable through the workflow's status handler. */
export interface RunProgress {
  chunks_done: number;
  chunks_started: number;
  /** Known for a pilot (seed size); null while the full export is still streaming. */
  chunks_total: number | null;
  records_loaded: number;
  /** Records loaded / elapsed seconds since the first chunk was prepared; null until time passes. */
  records_per_s: number | null;
}

export interface BackboneDeps {
  /** A journaled sleep (ctx.sleep). Absent: no pause and no back-off wait. */
  sleep?(ms: number, name: string): Promise<void>;
  /** Health probe before each chunk: true when the Loader's database is reachable. */
  health?(): Promise<boolean>;
  /** Called after each chunk starts or completes; the binding stores it in workflow state. */
  progress?(p: RunProgress): void;
  /** A journaled side effect (ctx.run): replays return the recorded value. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Loader.merge on track tcad (a journaled child call); `seq` counts the run's non-chunk ops. */
  merge(op: TrackOp, seq: number): Promise<{ rowsWritten: number }>;
  /** Free bytes on the run's volume (injectable for tests); default statfs of the run dir. */
  freeBytes?: () => number;
  verify(path: string, sha256: string): Promise<{ sha256: string }>;
  /** Waits on the durable promise `name` until a human resolves it. */
  waitForHuman(name: string, why: string): Promise<Resolution>;
  /** The source client's download (one identified request, StopOnBlocked). */
  download(request: DownloadRequest): Promise<DownloadResult>;
  /** One TcadChunk child (a journaled child call). Never attach .then/.catch/await to it: see raceChunks. */
  runChunk(spec: ChunkSpec): Promise<ChunkOutcome>;
  /**
   * Waits for the first of the in-flight chunk calls to complete and returns its index (in
   * `calls`) and outcome; a failed chunk rejects here. A durable binding MUST build this from
   * the SDK's RestatePromise.race (+ map), because the SDK allows one pending awaitNext per
   * context: a handler on each in-flight call plus any other await ("awaitNext already
   * pending") breaks the run. Absent: a plain-Promise race (tests).
   */
  raceChunks?(
    calls: ReadonlyArray<Promise<ChunkOutcome>>,
  ): Promise<{ index: number; outcome: ChunkOutcome }>;
  /** Files currently in the export's directory. */
  listInputs(): string[];
  records(path: string): AsyncIterable<ExportRecordText>;
  /**
   * The current time. Must be journaled in a durable binding (ctx.date.now): it feeds the
   * progress figure written with ctx.set, which a replay has to reproduce byte for byte.
   */
  now(): Date | Promise<Date>;
}

export interface BackboneResult {
  jobId: string;
  status: RunStatus;
  chunks: number;
  summary: ChunkSummary;
  reconciliation: Reconciliation;
  refused_inputs: Array<{ file: string; reason: "supplemental_export_not_mixed" }>;
  key_inventory_sha256: string;
  coverage: CoverageRow[] | null;
  zips: number;
  /**
   * False when the roll is not clean (difference over the 2 % gate, unexplained rows or
   * transform failures): the status is still `complete` (the closed status list has no other
   * value), the limitation `roll_difference_unexplained` is written and the CLI exits 1.
   */
  clean: boolean;
}

const PID_LINE = /^\s*"pID": "?([0-9]+)"?,?$/m;

/** pID as printed in a record's text (the export prints it near the top). */
export function pidOfText(text: string): string | null {
  return PID_LINE.exec(text.slice(0, 400))?.[1] ?? null;
}

/** Export files next to the run's export: refused, never read. */
export function refusedInputs(
  files: readonly string[],
  exportPath: string,
): BackboneResult["refused_inputs"] {
  return files
    .filter((f) => f !== exportPath && /\.(zip|json)$/i.test(f) && /json/i.test(basename(f)))
    .map((f) => ({ file: basename(f), reason: "supplemental_export_not_mixed" as const }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function inventorySha(parts: readonly ChunkOutcome[]): string {
  const keys = new Set<string>();
  for (const p of parts) for (const k of Object.keys(p.inventory)) keys.add(k);
  return createHash("sha256")
    .update([...keys].sort().join("\n"))
    .digest("hex");
}

type Merge = (op: TrackOp) => Promise<{ rowsWritten: number }>;

async function verifyOrWait(
  input: BackboneInput,
  deps: BackboneDeps,
  merge: Merge,
): Promise<boolean> {
  const runOp = (status: RunStatus): TrackOp => ({
    kind: "run",
    track: "appraisal",
    mode: input.mode,
    status,
    export_sha256: input.receipt.sha256,
  });
  for (let attempt = 0; ; attempt += 1) {
    const check = await deps.step(`verify-${attempt}`, async () => {
      try {
        await deps.verify(input.exportPath, input.receipt.sha256);
        return { ok: true as const, code: null };
      } catch (e) {
        if (e instanceof ExportVerifyError) return { ok: false as const, code: e.code };
        throw e;
      }
    });
    if (check.ok) {
      // back from a human wait (and a download): the status was waiting_human
      if (attempt > 0) await merge(runOp("running"));
      return true;
    }
    await merge(runOp("waiting_human"));
    const resolution = await deps.waitForHuman(
      `resolve:${TCAD_SOURCE_KEY}:${attempt}`,
      check.code ?? "export_missing",
    );
    if (resolution.action === "abort") {
      await merge(runOp("failed"));
      return false;
    }
    // The one identified request a human allowed (no retry after a 403).
    const receipt = await deps.step(`download-${attempt}`, async () => {
      const d = await deps.download({
        url: input.receipt.url,
        destPath: input.exportPath,
        inactivityMs: DOWNLOAD_INACTIVITY_MS,
        totalMs: DOWNLOAD_TOTAL_MS,
      });
      const r = d.receipt;
      const blocked = r.outcome === "blocked";
      return {
        source_key: TCAD_SOURCE_KEY,
        url: r.url,
        http_status: r.status,
        bytes: r.bytes,
        sha256: r.sha256 === "" ? null : r.sha256,
        captured_at: r.captured_at,
        outcome: blocked
          ? ("blocked" as const)
          : r.outcome === "failed"
            ? ("error" as const)
            : ("ok" as const),
        attempts: r.attempts,
        ua: r.user_agent,
        blocked_at: blocked ? r.captured_at : null,
      };
    });
    await merge({ kind: "receipt", receipt });
  }
}

export async function runTcadBackbone(
  input: BackboneInput,
  deps: BackboneDeps,
): Promise<BackboneResult> {
  const runOp = (
    status: RunStatus,
    extra: Partial<Extract<TrackOp, { kind: "run" }>> = {},
  ): TrackOp => ({
    kind: "run",
    track: "appraisal",
    mode: input.mode,
    status,
    export_sha256: input.receipt.sha256,
    gazetteer_sha256: GAZETTEER_SHA256,
    ...(input.codeSha ? { code_sha: input.codeSha } : {}),
    ...extra,
  });
  let seq = 0;
  const merge: Merge = (op) => deps.merge(op, seq++);
  const free =
    deps.freeBytes ??
    ((): number => {
      let dir = input.runDir;
      while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
      return freeBytesAt(dir);
    });
  /** OR-M5: stop cleanly (the run fails, the row closes) below 5 GiB free. */
  // journaled (a step): the free-space reading differs between a run and its replay, and it
  // decides whether the run continues
  let diskChecks = 0;
  const guardDisk = async (): Promise<void> => {
    diskChecks += 1;
    await deps.step(`disk-guard-${diskChecks}`, async () => {
      if (free() < MIN_FREE_BYTES) throw new RunDataError("disk below 5 GiB");
      return true;
    });
  };
  await merge(runOp("running"));
  const empty: ChunkSummary = {
    records: 0,
    loaded: 0,
    dead: 0,
    invalid: 0,
    transform_failure: 0,
    redacted: 0,
    by_prop_type: {},
  };
  if (!(await verifyOrWait(input, deps, merge))) {
    return {
      jobId: input.jobId,
      status: "failed",
      chunks: 0,
      summary: empty,
      reconciliation: reconcile(0, []),
      refused_inputs: [],
      key_inventory_sha256: "",
      coverage: null,
      zips: 0,
      clean: false,
    };
  }

  const size = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const window = Math.max(1, input.window ?? DEFAULT_WINDOW);
  const wanted = input.seedPids ? new Set(input.seedPids) : null;
  const ctx = {
    jobId: input.jobId,
    asOf: input.asOf,
    exportSha256: input.receipt.sha256,
    capturedAt: input.receipt.captured_at,
  };
  const outcomes: ChunkOutcome[] = [];
  // In-flight chunk calls. No handler is ever attached to one of them (each .then/.catch/await
  // on a RestatePromise registers an awaitNext, and the SDK allows one at a time): they are only
  // awaited through deps.raceChunks, and only while no other durable operation is pending, i.e.
  // when the window is full and at the end. A failing chunk is reported at that next await
  // (a RestatePromise is lazy: it never raises an unhandledRejection).
  const inflight: Array<Promise<ChunkOutcome>> = [];
  const race =
    deps.raceChunks ??
    ((calls) => {
      return Promise.race(calls.map((c, index) => c.then((outcome) => ({ index, outcome }))));
    });
  const awaitOneChunk = async (): Promise<void> => {
    const { index, outcome } = await race(inflight);
    inflight.splice(index, 1);
    await finished(outcome);
  };
  let batch: ExportRecordText[] = [];
  let n = 0;
  let seen = 0;
  let done = 0;
  let loadedRecords = 0;
  const pause = input.batchPauseMs ?? DEFAULT_BATCH_PAUSE_MS;
  const total = wanted === null ? null : Math.ceil(wanted.size / size);
  let startedAt: number | null = null;
  const rate = async (): Promise<number | null> => {
    if (startedAt === null) return null;
    // deps.now() is journaled, so a replay computes the same elapsed time
    const secs = ((await deps.now()).getTime() - startedAt) / 1000;
    return secs > 0 && loadedRecords > 0 ? Math.round((loadedRecords / secs) * 10) / 10 : null;
  };
  const report = async (): Promise<void> => {
    if (deps.progress === undefined) return;
    deps.progress({
      chunks_done: done,
      chunks_started: n,
      chunks_total: total,
      records_loaded: loadedRecords,
      records_per_s: await rate(),
    });
  };
  const finished = async (o: ChunkOutcome): Promise<void> => {
    outcomes.push(o);
    done += 1;
    loadedRecords += o.summary.loaded;
    await report();
  };
  let sleepSeq = 0;
  const sleep = async (ms: number, what: string): Promise<void> => {
    if (deps.sleep === undefined || ms <= 0) return;
    sleepSeq += 1;
    await deps.sleep(ms, `${what}-${sleepSeq}`);
  };
  /** Waits (journaled sleeps) while the probe says unhealthy; fails after 30 minutes in total. */
  const healthGate = async (): Promise<void> => {
    if (deps.health === undefined) return;
    const probe = deps.health;
    let waited = 0;
    let backoff = HEALTH_BACKOFF_FIRST_MS;
    for (let attempt = 0; ; attempt += 1) {
      const ok = await deps.step(`health-${n}-${attempt}`, async () => {
        try {
          return await probe();
        } catch {
          return false;
        }
      });
      if (ok) return;
      if (waited >= HEALTH_WAIT_TOTAL_MS) throw new RunDataError(HEALTH_GATE_MESSAGE);
      await sleep(backoff, "health-wait");
      waited += backoff;
      backoff = Math.min(backoff * 2, HEALTH_BACKOFF_MAX_MS);
    }
  };
  const flush = async (): Promise<void> => {
    // journaled once (deps.now), so the rate is measured from the same instant after a replay
    startedAt ??= (await deps.now()).getTime();
    await sleep(pause, "batch-pause");
    await healthGate();
    await guardDisk();
    const records = batch;
    const index = n;
    batch = [];
    n += 1;
    const spec = await deps.step(`chunk-input-${index}`, async (): Promise<ChunkSpec> => {
      const inputPath = join(input.runDir, "chunks", `c${index}.input.ndjson.gz`);
      return {
        jobId: input.jobId,
        n: index,
        inputPath,
        inputSha256: writeChunkInput(inputPath, records),
        records: records.length,
        mappedPath: join(input.runDir, "chunks", `c${index}.ndjson.gz`),
        ctx,
        ...(input.cids
          ? { group: { dir: join(input.runDir, "groups", "county"), cids: input.cids } }
          : {}),
      };
    });
    while (inflight.length >= window) await awaitOneChunk();
    const call = deps.runChunk(spec);
    // plain promises only: a failure before it is raced is not an unhandled rejection. With
    // raceChunks the call is a lazy RestatePromise and must stay untouched.
    if (deps.raceChunks === undefined) call.catch(() => undefined);
    inflight.push(call);
    await report();
  };
  for await (const rec of deps.records(input.exportPath)) {
    if (wanted !== null) {
      const pid = pidOfText(rec.text);
      if (pid === null || !wanted.has(pid)) continue;
    }
    seen += 1;
    batch.push(rec);
    if (batch.length >= size) await flush();
  }
  if (batch.length > 0) await flush();
  while (inflight.length > 0) await awaitOneChunk();
  if (wanted !== null && seen !== wanted.size) {
    throw new RunDataError(`pilot: ${wanted.size - seen} seed pIDs are not in the export`);
  }

  const refused = await deps.step("inputs", async () =>
    refusedInputs(deps.listInputs(), input.exportPath),
  );
  outcomes.sort((a, b) => a.n - b.n);
  const reconciliation = reconcile(
    seen,
    outcomes.map((o) => o.summary),
  );
  await deps.step("dead", async () => {
    writeDeadRecords(
      input.runDir,
      outcomes.flatMap((o) => o.dead),
    );
    return true;
  });
  const [countText, ruleText] = limitationsFor(reconciliation.redacted);
  const stats = sumTypeStats(outcomes);
  const clean =
    reconciliation.within_gate &&
    reconciliation.unexplained === 0 &&
    reconciliation.transform_failure === 0;
  const item = (code: string, text: string, count: number | null) => ({
    source_key: TCAD_SOURCE_KEY,
    code,
    text,
    count,
    evidence_url: null,
  });
  await guardDisk();
  await merge({
    kind: "limitations",
    items: [
      item("owner_confidential_count", countText, reconciliation.redacted),
      item("owner_confidential_rule", ruleText, null),
      ...typeLimitations(stats),
      item(
        "tenure_latest_sale_assumption",
        "tenure_years and is_long_tenure come from the latest dated sale, which may not be the current owner's: the export has no link between an owner and a sale",
        null,
      ),
      ...(clean
        ? []
        : [
            item(
              "roll_difference_unexplained",
              `the roll is not clean: ${reconciliation.difference} of ${reconciliation.n} records are not loaded (dead ${reconciliation.dead}, invalid ${reconciliation.invalid}, transform_failure ${reconciliation.transform_failure}, unexplained ${reconciliation.unexplained}${reconciliation.within_gate ? "" : ", over the 2 % gate"}); the run is marked complete only because the status list has no other value`,
              reconciliation.difference,
            ),
          ]),
    ],
  });
  const keyInventorySha256 = inventorySha(outcomes);
  await merge({
    kind: "finalize",
    duplicateMinGeoids: DUPLICATE_MIN_GEOIDS,
    keyInventorySha256,
  });
  await merge(runOp("complete", { as_of: input.asOf }));
  const coverage = outcomes.flatMap((o) => o.coverage ?? []);
  return {
    jobId: input.jobId,
    status: "complete",
    chunks: outcomes.length,
    summary: {
      records: reconciliation.n,
      loaded: reconciliation.loaded,
      dead: reconciliation.dead,
      invalid: reconciliation.invalid,
      transform_failure: reconciliation.transform_failure,
      redacted: reconciliation.redacted,
      by_prop_type: reconciliation.by_prop_type,
    },
    reconciliation,
    refused_inputs: refused,
    key_inventory_sha256: keyInventorySha256,
    coverage: coverage.length === 0 ? null : mergeCoverage(coverage),
    zips: outcomes.reduce((s, o) => s + o.zips, 0),
    clean,
  };
}

function sumTypeStats(parts: readonly ChunkOutcome[]): TypeStats {
  const out = emptyTypeStats();
  for (const p of parts) {
    const t = p.typeStats;
    if (t === undefined) continue;
    out.fallback += t.fallback;
    out.a4 += t.a4;
    out.f4 += t.f4;
    for (const [code, c] of Object.entries(t.fallbackByState)) {
      out.fallbackByState[code] = (out.fallbackByState[code] ?? 0) + c;
    }
  }
  return out;
}

/** The property_type source limitations (OR-M4, DP-1, DP-2, DP-8); counts from the chunks. */
function typeLimitations(stats: TypeStats): Array<{
  source_key: string;
  code: string;
  text: string;
  count: number | null;
  evidence_url: string | null;
}> {
  const top = Object.entries(stats.fallbackByState)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([code, c]) => `${code} (${c})`)
    .join(", ");
  return [
    {
      source_key: TCAD_SOURCE_KEY,
      code: "property_type_improvement_fallback",
      text: `property_type of ${stats.fallback} published (R) accounts is a generic fallback, not a table mapping (${PROPERTY_TYPE_RULES_VERSION}): Building where the record prints an improvement, LandParcel where it prints none; no residential or condominium claim. Top TCAD state codes without a table entry: ${top === "" ? "none" : top}`,
      count: stats.fallback,
      evidence_url: null,
    },
    {
      source_key: TCAD_SOURCE_KEY,
      code: "property_type_unverified_state_codes",
      text: `A4 (${stats.a4} accounts) is typed Townhouse, a deprecated lexicon value, and its condominium reading is unverified (DEC-A-01); F4 (${stats.f4} accounts) has no table entry and gets the generic fallback. No official TCAD state-code table is on disk`,
      count: stats.a4 + stats.f4,
      evidence_url: null,
    },
  ];
}

/** One coverage row per field across chunks (extracted when any chunk extracted it). */
export function mergeCoverage(rows: readonly CoverageRow[]): CoverageRow[] {
  const by = new Map<string, CoverageRow>();
  for (const r of rows) {
    const prior = by.get(r.field);
    by.set(
      r.field,
      prior
        ? {
            ...prior,
            extracted: prior.extracted || r.extracted,
            properties: prior.properties + r.properties,
          }
        : { ...r },
    );
  }
  return [...by.values()];
}
