// A-04 T051/T053: what the AustinPermits workflow hands the Loader's `permits` track
// (pipeline/local-stack/services/tracks/permits.ts). The workflow only writes artifacts; the
// Loader (single writer) merges them. Every input carries the Loader base fields
// {jobId, artifactPath, artifactSha256}; (track, artifactSha256) makes a re-merge a no-op, so
// inputs that are not a file use the SHA-256 of their own canonical JSON (inputDigest).
import { createHash } from "node:crypto";
import { z } from "zod";
import { jcs } from "./content-digest.js";

export const PERMITS_SOURCE_KEY = "austin-3syk-w9eu";

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);
const Sha = z.string().regex(/^[a-f0-9]{64}$/);
const Iso = z.string().min(10);
export const PermitsMode = z.enum(["backfill", "incremental", "pilot", "link"]);
export type PermitsMode = z.infer<typeof PermitsMode>;

const Base = {
  jobId: JobId,
  artifactPath: z.string().min(1),
  artifactSha256: Sha,
  mode: PermitsMode,
};

/** The Austin watermark row value ({lastId, maxUpdatedAt, sourceCountAtW} + the AC-12 counts). */
export const AustinWatermark = z.object({
  lastId: z.string().nullable(),
  maxUpdatedAt: z.string().nullable(),
  sourceCountAtW: z.number().int().nonnegative().nullable(),
  capturedAtW: z.number().int().nonnegative(),
  aboveW: z.number().int().nullable(),
  startTotal: z.number().int().nonnegative(),
  endTotal: z.number().int().nonnegative().nullable(),
  watermarkCheck: z.enum(["pass", "fail", "not_applicable"]),
  pages: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  startedAt: Iso,
  finishedAt: Iso,
  jobId: JobId,
  mode: PermitsMode,
  restamp: z
    .object({ detected: z.boolean(), rowsWritten: z.number().int().nonnegative() })
    .nullable(),
});
export type AustinWatermark = z.infer<typeof AustinWatermark>;

export const Limitation = z.object({
  sourceKey: z.string().min(1),
  code: z.string().min(1),
  text: z.string().min(1),
  count: z.number().int().nullable(),
  evidenceUrl: z.string().nullable(),
});
export type Limitation = z.infer<typeof Limitation>;

/** One line of the job's `receipts.jsonl` (socrata-pages.ts PageReceipt). */
export const ReceiptLine = z.looseObject({
  source: z.string(),
  kind: z.enum(["page", "count", "histogram"]),
  page_index: z.number().int().nullable(),
  url: z.string(),
  http_status: z.number().int().nullable(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  captured_at: Iso,
  outcome: z.enum(["ok", "blocked", "error"]),
  blocked_at: Iso.nullable(),
  attempts: z.number().int().nonnegative(),
  ua: z.string(),
  rows: z.number().int().nullable(),
});
export type ReceiptLine = z.infer<typeof ReceiptLine>;

export const RunStartInput = z.object({
  kind: z.literal("run_start"),
  ...Base,
  startedAt: Iso,
  profileSha256: Sha,
});

export const PageInput = z.object({
  kind: z.literal("page"),
  ...Base,
  pageIndex: z.number().int().positive(),
  rows: z.number().int().nonnegative(),
  receiptsPath: z.string().min(1),
});

export const FinalizeInput = z.object({
  kind: z.literal("finalize"),
  ...Base,
  finishedAt: Iso,
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  watermark: AustinWatermark.nullable(),
  /** The keys a full page-through saw (ndjson {row_id, permit_number}), for the key-set diff. */
  keys: z.object({ path: z.string().min(1), sha256: Sha, count: z.number().int() }).nullable(),
  limitations: z.array(Limitation),
  /** The job's receipts.jsonl: count/histogram receipts are recorded at the end. */
  receiptsPath: z.string().min(1).nullable(),
});

export const StopInput = z.object({
  kind: z.literal("stop"),
  ...Base,
  status: z.enum(["waiting_human", "failed"]),
  finishedAt: Iso,
  reason: z.string(),
  /** The job's receipts.jsonl (null when the run stopped before any request). */
  receiptsPath: z.string().min(1).nullable(),
});

export const LinkInput = z.object({
  kind: z.literal("link"),
  ...Base,
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const PermitsMergeInput = z.discriminatedUnion("kind", [
  RunStartInput,
  PageInput,
  FinalizeInput,
  StopInput,
  LinkInput,
]);
export type PermitsMergeInput = z.infer<typeof PermitsMergeInput>;

/** What Loader.merge answers (pipeline/local-stack/services/loader.ts MergeResult). */
export interface MergeReply {
  track: string;
  artifactSha256: string;
  skipped: boolean;
  rowsWritten: number;
  tombstones: number;
}

/** SHA-256 of an input's canonical JSON (its Loader idempotency key when it is not a file). */
export const inputDigest = (value: unknown): string =>
  createHash("sha256").update(jcs(value), "utf8").digest("hex");
