// A-04 T026: one TcadChunk child (durable-workflow-builder pattern 11): ~10k export records
// from a chunk input file → processChunk (parse → redact → map) → the mapped, redacted chunk
// artifact → ONE Loader merge (track tcad) → (pilot) the County group zips. The input and the
// mapped artifact are deleted after the merge; the outcome holds counts only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { RunDataError } from "../backbone/errors.js";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import type { ExportRecordText } from "./export-stream.js";
import { createKeyInventory, UnknownKeyError } from "./key-inventory.js";
import {
  processChunk,
  writeChunkFile,
  type ChunkContext,
  type ChunkSummary,
  type DeadRecord,
  type TypeStats,
} from "./process.js";
import { coverageReport, writeCountyZips, type CoverageRow } from "./write-group.js";

export interface ChunkSpec {
  jobId: string;
  n: number;
  inputPath: string;
  inputSha256: string;
  records: number;
  /** Where the mapped artifact is written (runs/<jobId>/chunks/c<N>.ndjson.gz). */
  mappedPath: string;
  ctx: ChunkContext;
  /** Pilot only: write the County group zips of this chunk's R accounts here. */
  group?: { dir: string; cids: DataGroupCids };
}

export interface ChunkOutcome {
  n: number;
  summary: ChunkSummary;
  dead: DeadRecord[];
  /** Key inventory counts of this chunk (key names only). */
  inventory: Record<string, number>;
  mappedSha256: string;
  zips: number;
  coverage: CoverageRow[] | null;
  /** Counts behind the property_type source limitations (process.ts TypeStats). */
  typeStats: TypeStats;
}

export interface ChunkMergeOp {
  kind: "chunk";
  artifactPath: string;
  artifactSha256: string;
}

export interface ChunkDeps {
  merge(op: ChunkMergeOp): Promise<{ rowsWritten: number }>;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** Writes a chunk input file (gzipped NDJSON of exact record texts) and returns its SHA-256. */
export function writeChunkInput(path: string, records: readonly ExportRecordText[]): string {
  const body = gzipSync(Buffer.from(records.map((r) => JSON.stringify(r)).join("\n"), "utf8"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return sha256(body);
}

export function readChunkInput(path: string, expectedSha256: string): ExportRecordText[] {
  const body = readFileSync(path);
  if (sha256(body) !== expectedSha256)
    throw new RunDataError(`chunk input ${path}: sha256 changed`);
  const text = gunzipSync(body).toString("utf8");
  return text === "" ? [] : text.split("\n").map((l) => JSON.parse(l) as ExportRecordText);
}

/** Counts-only outcome kept next to the mapped file so a retry after cleanup can skip (CR-9). */
export const outcomePathOf = (spec: ChunkSpec): string =>
  spec.mappedPath.replace(/(\.ndjson\.gz)?$/, ".outcome.json");

function recordedOutcome(spec: ChunkSpec): ChunkOutcome | null {
  try {
    const rec = JSON.parse(readFileSync(outcomePathOf(spec), "utf8")) as {
      inputSha256?: string;
      outcome?: ChunkOutcome;
    };
    return rec.inputSha256 === spec.inputSha256 && rec.outcome !== undefined ? rec.outcome : null;
  } catch {
    return null;
  }
}

/**
 * The file work of one chunk (journal it as one step): read the input, parse → redact → map,
 * write the mapped artifact (and, pilot, the County group zips). Returns counts only.
 *
 * Idempotent after cleanup (CR-9): when the input is gone and this chunk's outcome was
 * recorded, that outcome is returned (the Loader merge is itself a no-op for a merged sha).
 * A missing input with no record is a RunDataError, not a retryable ENOENT. A deterministic
 * failure removes the unredacted input before it propagates (OR-m2).
 */
export async function prepareChunk(spec: ChunkSpec): Promise<ChunkOutcome> {
  if (!existsSync(spec.inputPath)) {
    const done = recordedOutcome(spec);
    if (done !== null) return done;
    throw new RunDataError(`chunk ${spec.n}: input is missing and no outcome was recorded`);
  }
  try {
    const out = await prepareFromInput(spec);
    writeFileSync(
      outcomePathOf(spec),
      JSON.stringify({ inputSha256: spec.inputSha256, outcome: out }),
    );
    return out;
  } catch (error) {
    if (error instanceof UnknownKeyError || error instanceof RunDataError) cleanupChunk(spec);
    throw error;
  }
}

async function prepareFromInput(spec: ChunkSpec): Promise<ChunkOutcome> {
  const records = readChunkInput(spec.inputPath, spec.inputSha256);
  const inventory = createKeyInventory();
  let mappedSha256 = "";
  let zips = 0;
  let coverage: CoverageRow[] | null = null;
  const result = await processChunk(records, spec.ctx, inventory, {
    store: async (rows, reconciliation) => {
      mappedSha256 = writeChunkFile(spec.mappedPath, {
        rows: [...rows],
        reconciliation: [...reconciliation],
      });
    },
    ...(spec.group
      ? {
          cids: spec.group.cids,
          validate: async (groups) => {
            zips = writeCountyZips(spec.group?.dir ?? "", groups).length;
            coverage = coverageReport(groups);
          },
        }
      : {}),
  });
  return {
    n: spec.n,
    summary: result.summary,
    dead: result.dead,
    inventory: inventory.counts(),
    mappedSha256,
    zips,
    coverage,
    typeStats: result.typeStats,
  };
}

/** Deletes the chunk input and the mapped artifact (after the Loader merged it). */
export function cleanupChunk(spec: ChunkSpec): void {
  rmSync(spec.inputPath, { force: true });
  rmSync(spec.mappedPath, { force: true });
}

/** prepare → ONE Loader merge → cleanup (the Restate binding journals each part). */
export async function runTcadChunk(spec: ChunkSpec, deps: ChunkDeps): Promise<ChunkOutcome> {
  const out = await prepareChunk(spec);
  await deps.merge({
    kind: "chunk",
    artifactPath: spec.mappedPath,
    artifactSha256: out.mappedSha256,
  });
  cleanupChunk(spec);
  return out;
}
