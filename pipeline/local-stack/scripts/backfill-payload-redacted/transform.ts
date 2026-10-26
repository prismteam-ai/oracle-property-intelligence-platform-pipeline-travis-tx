// A-11 fix 1c: the per-record work of the payload_redacted backfill, run inside a worker thread
// (worker.ts) or in-process. It calls the loader's own `processRecord` (parse → redact → map),
// so the payload is exactly what a fresh load writes today. `processRecord` has no side effect
// beyond the key inventory it is handed (one per worker): it does no I/O.
import type { ExportRecordText } from "../../../oracle-runtime/travis/tcad/export-stream.js";
import type { KeyInventory } from "../../../oracle-runtime/travis/tcad/key-inventory.js";
import { processRecord, type ChunkContext } from "../../../oracle-runtime/travis/tcad/process.js";

/** One parcel row to rewrite: its key, the computed record_sha256 and the payload as JSON text. */
export interface BackfillRow {
  id: string;
  sha: string;
  /** JSON text of the slim payload; bound as text and cast `::text::jsonb` (never as jsonb). */
  payload: string;
  /** The payload has the `propertyLegalDescription` key. */
  legal: boolean;
}

/** A contiguous run of export records [lo, hi] handed to one worker. */
export interface ChunkIn {
  seq: number;
  lo: number;
  hi: number;
  records: ExportRecordText[];
}

export interface ChunkOut {
  seq: number;
  lo: number;
  hi: number;
  rows: BackfillRow[];
  /** Records `processRecord` did not load (dead / invalid / transform_failure). */
  notLoaded: number;
  /** Loaded records outside the `--pids` scope. */
  outOfScope: number;
}

export interface WorkerInit {
  ctx: ChunkContext;
  pids: string[] | null;
}

export type WorkerReply =
  | { ok: true; out: ChunkOut }
  | { ok: false; seq: number; error: { name: string; message: string } };

export function transformChunk(
  chunk: ChunkIn,
  ctx: ChunkContext,
  inventory: KeyInventory,
  pids: ReadonlySet<string> | null,
): ChunkOut {
  const out: ChunkOut = {
    seq: chunk.seq,
    lo: chunk.lo,
    hi: chunk.hi,
    rows: [],
    notLoaded: 0,
    outOfScope: 0,
  };
  for (const rec of chunk.records) {
    const l = processRecord(rec, ctx, inventory).loaded;
    if (l === undefined) {
      out.notLoaded += 1;
      continue;
    }
    const id = l.parcel.request_identifier;
    if (pids !== null && !pids.has(id)) {
      out.outOfScope += 1;
      continue;
    }
    const payload = l.parcel.payload_redacted;
    out.rows.push({
      id,
      sha: l.parcel.record_sha256,
      payload: JSON.stringify(payload),
      legal: Object.hasOwn(payload, "propertyLegalDescription"),
    });
  }
  return out;
}
