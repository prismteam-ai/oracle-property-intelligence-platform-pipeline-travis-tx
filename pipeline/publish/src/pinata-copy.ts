// A-16 T079 (AM-10, amends AD-22): the second copy on Pinata's free plan. Pinata refuses
// pin-by-CID and CAR import on that plan, but a file upload with `pinataOptions={"cidVersion":1}`
// reproduces our CIDs exactly (probe 2026-10-26: the Run 3 manifest, raw codec, and a 3 MB dag-pb
// table part). So this module uploads, from local disk, every run manifest plus as many of the
// latest run's table files as fit in the quota (~1 GB, ~500 files), and keeps a pin only when
// Pinata's CID equals the manifest CID. The Lexicon CARs and directory roots stay on Filebase
// plus the GitHub Release (AM-10); this module never uploads them.
//
// Which manifests: the run manifest, plus (by default) every other run runs/index.json lists, read
// from runs/<runId>/manifest.json next to the index, plus any --extra-manifest. Fail closed: every
// manifest must parse as RunManifestV1, be its own exact JCS bytes, and hash to an EXPECTED CID
// from runs/index.json or the command line (--manifest-cid, `path=cid`); without one the run
// manifest is refused (exit 2) and an older one is skipped and reported.
//
// Per file, in order: (1) the local file is checked first — a table part's size + SHA-256 must
// equal the manifest entry; a manifest must pass the checks above — else it is skipped and
// reported, never uploaded; (2) a CID Pinata already lists as pinned is skipped (idempotent re-runs); (3) the
// budget (bytes and files) is reserved before the upload and the run stops cleanly at the first
// file that does not fit, listing what was left; (4) after the upload Pinata's `IpfsHash` is
// compared with the manifest CID: on a mismatch the pin is removed at once and recorded (unless
// Pinata says `isDuplicate`: that pin existed before this run and is left alone), and when
// stop-on-mismatch applies (default for manifests) nothing else is uploaded. One receipt JSON per
// processed file (an existing `pinned` receipt is never overwritten), plus summary-<UTC>.json
// and summary.json (the latest). 429/503 answers back off (Retry-After, else capped exponential)
// for at most MAX_ATTEMPTS; a write that times out or answers 500/502/504 is recorded as an
// error, not resent (a re-run picks it up). At most 3 uploads run at once.
//
// The JWT is passed in by the caller (the CLI reads PINATA_JWT from process.env) and is redacted
// from every message, receipt and summary this module produces.
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { RunManifestV1 } from "@countylens/contract";
import { cidOfBytes } from "./cid.js";
import { jcsBytes } from "./jcs.js";
import { backoffDelayMs } from "./backoff.js";
import {
  PinataHttpError,
  isPinned,
  redactJwt,
  unpin,
  uploadFile,
  usage,
  type FetchLike,
  type PinataUsage,
  type UploadResult,
} from "./pinata-pin.js";

/** About 1 GB on the free plan; leave headroom for Pinata's own DAG overhead. */
export const DEFAULT_QUOTA_BYTES = 950_000_000;
/** The free plan's file limit. */
export const DEFAULT_QUOTA_FILES = 500;
export const MAX_CONCURRENCY = 3;
export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2000;
/** The same safe-run-id rule for --run-id and every runId read from runs/index.json. */
export const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const DEFAULT_RECEIPTS_ROOT = "specs/016-cost-and-admin/pinata-receipts";

export type CopyKind = "manifest" | "table";
export const COPY_KINDS: readonly CopyKind[] = ["manifest", "table"];

interface ArtifactLike {
  name: string;
  cid: string;
  kind: string;
  size: number;
  sha256: string;
}

export interface ExtraManifest {
  path: string;
  /** Expected CID given on the command line (`path=cid`); otherwise runs/index.json is used. */
  cid?: string;
  /** Where `cid` came from, for messages (default "the command line"). */
  cidSource?: string;
}

export interface PinataCopyOptions {
  jwt: string;
  manifestPath: string;
  runId: string;
  filesRoot: string;
  kinds?: readonly CopyKind[];
  /** Bytes this run may add; default DEFAULT_QUOTA_BYTES minus current usage. */
  budgetBytes?: number;
  /** Files this run may add; default DEFAULT_QUOTA_FILES minus current pin count. */
  budgetFiles?: number;
  extraManifests?: readonly ExtraManifest[];
  /** Expected CID of the run manifest when runs/index.json does not list the run yet. */
  manifestCid?: string;
  /** runs/index.json (runId -> manifestCid): the expected CIDs, and the default extra manifests. */
  runsIndexPath?: string;
  /** Also copy every other run's manifest listed in runs/index.json (default true). */
  indexManifests?: boolean;
  dryRun?: boolean;
  firstOnly?: boolean;
  /** Stop after a mismatch on a manifest (default true) / on a table (default false). */
  stopOnMismatchManifest?: boolean;
  stopOnMismatchTable?: boolean;
  concurrency?: number;
  receiptsRoot?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  log?: (line: string) => void;
}

export type ItemStatus =
  | "pinned"
  | "already_pinned"
  | "mismatch_unpinned"
  | "mismatch_unpin_failed"
  /** Pinata answered another CID with isDuplicate: true — a pin that predates this run; kept. */
  | "mismatch_preexisting"
  | "error"
  | "skipped_local"
  | "left_budget"
  | "left_stopped"
  | "planned";

export interface CopyItem {
  kind: CopyKind;
  name: string;
  cid: string;
  size: number;
  sha256: string;
  /** Local file read for the upload. */
  path: string;
}

export interface Receipt {
  schema: "pinata-copy-receipt.v1";
  run_id: string;
  kind: CopyKind;
  name: string;
  cid: string;
  size: number;
  sha256: string;
  status: ItemStatus;
  pinata_cid: string | null;
  match: boolean | null;
  pinned_at: string | null;
  pin_size: number | null;
  is_duplicate: boolean | null;
  recorded_at: string;
  reason?: string;
}

export interface SkippedItem {
  kind: CopyKind;
  name: string;
  cid: string;
  status: ItemStatus;
  reason: string;
  size?: number;
}

export interface CopySummary {
  schema: "pinata-copy-summary.v1";
  run_id: string;
  manifest_path: string;
  manifest_cid: string;
  dry_run: boolean;
  first_only: boolean;
  kinds: CopyKind[];
  budget: { bytes: number; files: number; source: string };
  usage_before: PinataUsage | null;
  usage_after: PinataUsage | null;
  counts: Record<ItemStatus, number>;
  bytes: { uploaded: number; pin_size_uploaded: number; left: number };
  mismatches: Array<{
    name: string;
    cid: string;
    pinata_cid: string;
    unpinned: boolean;
    preexisting: boolean;
  }>;
  skipped: SkippedItem[];
  left: SkippedItem[];
  errors: Array<{ name: string; cid: string; reason: string }>;
  stopped: null | "mismatch" | "error" | "budget";
  ok: boolean;
  finished_at: string;
}

export interface CopyResult {
  summary: CopySummary;
  receipts: Receipt[];
  /** 0 ok (a clean budget stop included), 1 a mismatch or upload error, 2 a precondition. */
  exitCode: number;
}

export class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionError";
  }
}

/** A file-system-safe receipt name for a repo-relative artifact path. */
export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "") || "artifact";
}

/** Retry-After (capped) when sent, else capped full jitter; the shared rule in ./backoff.ts. */
export function backoffMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
  now: () => number = Date.now,
): number {
  return backoffDelayMs(attempt, retryAfter, { baseMs: BACKOFF_BASE_MS, random, now });
}

function retryable(err: unknown, write: boolean): err is PinataHttpError {
  if (!(err instanceof PinataHttpError)) return false;
  // A rejected write (429, or 503 "try later") pinned nothing, so it is safe to resend. A 500/502/
  // 504 on a write may have pinned; it is not resent blind (the idempotent re-run picks it up).
  return write ? err.status === 429 || err.status === 503 : err.status === 429 || err.status >= 500;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function readRunsIndex(path: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (path === undefined || !existsSync(path)) return map;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { runs?: unknown };
  if (!Array.isArray(parsed.runs)) return map;
  for (const r of parsed.runs as Array<{ runId?: unknown; manifestCid?: unknown }>)
    if (typeof r.runId === "string" && typeof r.manifestCid === "string")
      map.set(r.runId, r.manifestCid);
  return map;
}

interface CheckedManifest {
  item: CopyItem;
  runId: string | undefined;
  artifacts: ArtifactLike[];
  problem?: string;
}

/**
 * Reads a manifest and proves its bytes, failing closed: it must parse as RunManifestV1 (so it has
 * a runId), be its own exact JCS bytes, and hash to an expected CID from the command line or
 * runs/index.json. With no expected CID it is a problem, never a pass.
 */
async function checkManifest(
  path: string,
  expectedCid: string | undefined,
  index: Map<string, string>,
  cidSource = "the command line",
): Promise<CheckedManifest> {
  const bytes = readFileSync(path);
  const cid = await cidOfBytes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    raw = undefined;
  }
  const parsed = RunManifestV1.safeParse(raw);
  const runId = parsed.success ? parsed.data.runId : undefined;
  const item: CopyItem = {
    kind: "manifest",
    name: runId === undefined ? path : `runs/${runId}/manifest.json`,
    cid,
    size: bytes.length,
    sha256,
    path,
  };
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      item,
      runId,
      artifacts: [],
      problem: `not a RunManifestV1${first ? ` (${first.path.join(".") || "root"}: ${first.message})` : ""}`,
    };
  }
  const out: CheckedManifest = { item, runId, artifacts: parsed.data.artifacts };
  const fromIndex = index.get(parsed.data.runId);
  const expected = expectedCid ?? fromIndex;
  // The same comparison src/verify.ts makes: the exact JCS bytes of the PARSED RunManifestV1.
  if (!bytes.equals(Buffer.from(jcsBytes(parsed.data)))) {
    out.problem = "not the exact JCS bytes of its own content";
  } else if (expected === undefined) {
    out.problem = `no expected CID: runs/index.json does not list ${parsed.data.runId}; pass the CID on the command line`;
  } else if (expected !== cid) {
    out.problem = `hashes to ${cid}, but ${expectedCid === undefined ? "runs/index.json" : cidSource} names ${expected}`;
  }
  return out;
}

/** Resolves a manifest entry's repo-relative name under filesRoot; refuses any path escape. */
export function localPathFor(filesRoot: string, name: string): string | null {
  if (isAbsolute(name)) return null;
  const root = resolve(filesRoot);
  const full = resolve(root, name);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return full;
}

async function checkTable(
  filesRoot: string,
  a: ArtifactLike,
): Promise<{ item: CopyItem } | { problem: string }> {
  const path = localPathFor(filesRoot, a.name);
  if (path === null) return { problem: `name ${a.name} escapes --files-root` };
  if (!existsSync(path)) return { problem: `missing on disk: ${path}` };
  const size = statSync(path).size;
  if (size !== a.size) return { problem: `size on disk ${size}, manifest says ${a.size}` };
  const sha256 = await sha256OfFile(path);
  if (sha256 !== a.sha256)
    return { problem: `sha256 on disk ${sha256}, manifest says ${a.sha256}` };
  return {
    item: { kind: "table", name: a.name, cid: a.cid, size: a.size, sha256: a.sha256, path },
  };
}

function emptyCounts(): Record<ItemStatus, number> {
  return {
    pinned: 0,
    already_pinned: 0,
    mismatch_unpinned: 0,
    mismatch_unpin_failed: 0,
    mismatch_preexisting: 0,
    error: 0,
    skipped_local: 0,
    left_budget: 0,
    left_stopped: 0,
    planned: 0,
  };
}

/** Runs the copy. Throws PreconditionError (exit 2) before any upload when the inputs are wrong. */
export async function runPinataCopy(options: PinataCopyOptions): Promise<CopyResult> {
  const jwt = options.jwt;
  const dryRun = options.dryRun ?? false;
  if (!dryRun && !jwt) throw new PreconditionError("PINATA_JWT is not set in the environment");
  if (!SAFE_RUN_ID.test(options.runId))
    throw new PreconditionError(`--run-id ${options.runId} is not a safe run id`);
  const kinds = [...new Set(options.kinds ?? COPY_KINDS)];
  for (const k of kinds)
    if (!COPY_KINDS.includes(k))
      throw new PreconditionError(`--kinds: ${String(k)} is not one of ${COPY_KINDS.join(",")}`);
  const firstOnly = options.firstOnly ?? false;
  if (firstOnly && !kinds.includes("manifest"))
    throw new PreconditionError(
      "--first-only uploads the run manifest, so --kinds must include manifest",
    );
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, options.concurrency ?? 2));
  const stopManifest = options.stopOnMismatchManifest ?? true;
  const stopTable = options.stopOnMismatchTable ?? false;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const rawLog = options.log ?? ((line: string) => console.log(line));
  const log = (line: string): void => rawLog(redactJwt(line, jwt));
  const clean = (text: string): string => redactJwt(text, jwt);
  const pinata = { jwt, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const receiptsDir = join(options.receiptsRoot ?? DEFAULT_RECEIPTS_ROOT, options.runId);

  async function withRetry<T>(what: string, write: boolean, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || !retryable(err, write)) throw err;
        const ms = backoffMs(attempt, err.retryAfter, random);
        log(`wait ${what}: HTTP ${err.status}, retry ${attempt + 1}/${MAX_ATTEMPTS} in ${ms} ms`);
        await sleep(ms);
      }
    }
  }

  // 1. Local checks, before any network call.
  const index = readRunsIndex(options.runsIndexPath);
  if (!existsSync(options.manifestPath))
    throw new PreconditionError(`${options.manifestPath} does not exist`);
  const main = await checkManifest(options.manifestPath, options.manifestCid, index);
  if (main.problem !== undefined)
    throw new PreconditionError(`${options.manifestPath}: ${main.problem}`);
  if (main.runId !== options.runId)
    throw new PreconditionError(
      `${options.manifestPath} is run ${main.runId}, not --run-id ${options.runId}`,
    );

  const skipped: SkippedItem[] = [];
  const queue: CopyItem[] = [];
  if (kinds.includes("manifest")) {
    queue.push(main.item);
    // Older runs from runs/index.json (default), then explicit --extra-manifest, deduplicated.
    const extras: ExtraManifest[] = [];
    if ((options.indexManifests ?? true) && options.runsIndexPath !== undefined)
      for (const [runId, cid] of index) {
        if (runId === options.runId) continue;
        if (!SAFE_RUN_ID.test(runId)) {
          // Never build a path from an unsafe id (e.g. "../x"): skip and report it.
          skipped.push({
            kind: "manifest",
            name: `runs/index.json runId ${JSON.stringify(runId)}`,
            cid,
            status: "skipped_local",
            reason: "unsafe run id in runs/index.json",
          });
          log(`skip runs/index.json runId ${JSON.stringify(runId)}: unsafe run id`);
          continue;
        }
        extras.push({
          path: join(dirname(options.runsIndexPath), runId, "manifest.json"),
          cid,
          cidSource: "runs/index.json",
        });
      }
    for (const extra of options.extraManifests ?? []) {
      const at = extras.findIndex((e) => resolve(e.path) === resolve(extra.path));
      if (at >= 0) extras.splice(at, 1);
      extras.push(extra);
    }
    if (!firstOnly)
      for (const extra of extras) {
        if (!existsSync(extra.path)) {
          skipped.push({
            kind: "manifest",
            name: extra.path,
            cid: extra.cid ?? "",
            status: "skipped_local",
            reason: "missing on disk",
          });
          log(`skip ${extra.path}: missing on disk`);
          continue;
        }
        const checked = await checkManifest(extra.path, extra.cid, index, extra.cidSource);
        if (checked.problem !== undefined) {
          skipped.push({
            kind: "manifest",
            name: checked.item.name,
            cid: checked.item.cid,
            status: "skipped_local",
            reason: checked.problem,
          });
          log(`skip ${checked.item.name}: ${checked.problem}`);
        } else queue.push(checked.item);
      }
  }
  if (kinds.includes("table") && !firstOnly) {
    for (const a of main.artifacts.filter((x) => x.kind === "table")) {
      const checked = await checkTable(options.filesRoot, a);
      if ("problem" in checked) {
        skipped.push({
          kind: "table",
          name: a.name,
          cid: a.cid,
          status: "skipped_local",
          reason: checked.problem,
          size: a.size,
        });
        log(`skip ${a.name}: ${checked.problem}`);
      } else queue.push(checked.item);
    }
  }

  // 2. Budget.
  let usageBefore: PinataUsage | null = null;
  if (!dryRun) usageBefore = await withRetry("usage", false, () => usage(pinata));
  // Never more than the quota minus what the account already holds, whatever the flags say.
  const quotaBytes = DEFAULT_QUOTA_BYTES - (usageBefore?.pinSizeTotal ?? 0);
  const quotaFiles = DEFAULT_QUOTA_FILES - (usageBefore?.pinCount ?? 0);
  let bytesLeft = Math.max(0, Math.min(options.budgetBytes ?? Infinity, quotaBytes));
  let filesLeft = Math.max(0, Math.min(options.budgetFiles ?? Infinity, quotaFiles));
  const flagged = options.budgetBytes !== undefined || options.budgetFiles !== undefined;
  const capped =
    (options.budgetBytes ?? -Infinity) > quotaBytes ||
    (options.budgetFiles ?? -Infinity) > quotaFiles;
  const budgetSource = dryRun
    ? `${flagged ? "flag" : "quota"} (dry run: usage not read)`
    : flagged
      ? capped
        ? "flag, capped at quota minus usage"
        : "flag"
      : "quota minus usage";
  const budget = { bytes: bytesLeft, files: filesLeft, source: budgetSource };
  log(
    `budget: ${bytesLeft} bytes, ${filesLeft} files (${budgetSource})${usageBefore ? `; usage before: ${usageBefore.pinCount} pins, ${usageBefore.pinSizeTotal} bytes` : ""}`,
  );

  const receipts: Receipt[] = [];
  const left: SkippedItem[] = [];
  const mismatches: CopySummary["mismatches"] = [];
  const errors: CopySummary["errors"] = [];
  const counts = emptyCounts();
  for (const s of skipped) counts[s.status] += 1;
  let uploadedBytes = 0;
  let pinSizeUploaded = 0;
  let stopped: CopySummary["stopped"] = null;

  function writeReceipt(r: Receipt): void {
    receipts.push(r);
    if (dryRun) return;
    mkdirSync(receiptsDir, { recursive: true });
    const file = join(receiptsDir, `${safeName(r.name)}.json`);
    // The receipt of the upload that actually pinned the file is evidence: a re-run (which finds
    // the CID already pinned) never overwrites it.
    if (existsSync(file)) {
      try {
        const prior = JSON.parse(readFileSync(file, "utf8")) as { status?: unknown; cid?: unknown };
        if (prior.status === "pinned" && prior.cid === r.cid) {
          log(`note ${r.name}: kept the existing pinned receipt`);
          return;
        }
      } catch {
        // An unreadable prior receipt is replaced.
      }
    }
    writeFileSync(file, `${clean(JSON.stringify(r, null, 2))}\n`);
  }

  function receiptOf(item: CopyItem, status: ItemStatus, extra: Partial<Receipt> = {}): Receipt {
    return {
      schema: "pinata-copy-receipt.v1",
      run_id: options.runId,
      kind: item.kind,
      name: item.name,
      cid: item.cid,
      size: item.size,
      sha256: item.sha256,
      status,
      pinata_cid: null,
      match: null,
      pinned_at: null,
      pin_size: null,
      is_duplicate: null,
      recorded_at: now().toISOString(),
      ...extra,
    };
  }

  /** Gives back the budget reserved for an item that did not end up adding a pin of ours. */
  function refund(item: CopyItem): void {
    bytesLeft += item.size;
    filesLeft += 1;
  }

  /** Uploads one item; returns the reason when the run must stop, else null. */
  async function copyOne(item: CopyItem): Promise<null | "mismatch" | "error"> {
    if (dryRun) {
      counts.planned += 1;
      receipts.push(receiptOf(item, "planned"));
      log(`plan ${item.kind} ${item.name} cid=${item.cid} size=${item.size}`);
      return null;
    }
    let uploaded: UploadResult;
    try {
      uploaded = await withRetry(`upload ${item.name}`, true, () =>
        uploadFile(item.path, item.name, pinata),
      );
    } catch (err) {
      const reason = clean(err instanceof Error ? err.message : String(err));
      counts.error += 1;
      errors.push({ name: item.name, cid: item.cid, reason });
      writeReceipt(receiptOf(item, "error", { reason }));
      log(`FAIL ${item.name}: ${reason}`);
      refund(item);
      // A manifest that could not be copied stops the run before any table upload, exactly like
      // a manifest mismatch (unless --no-stop-on-mismatch).
      return item.kind === "manifest" && stopManifest ? "error" : null;
    }
    const match = uploaded.cid === item.cid;
    const pinFields = {
      pinata_cid: uploaded.cid,
      match,
      pinned_at: uploaded.timestamp ?? null,
      pin_size: uploaded.pinSize ?? null,
      is_duplicate: uploaded.isDuplicate ?? null,
    };
    if (match) {
      counts.pinned += 1;
      uploadedBytes += item.size;
      pinSizeUploaded += uploaded.pinSize ?? item.size;
      writeReceipt(receiptOf(item, "pinned", pinFields));
      log(`ok   ${item.kind} ${item.name} cid=${item.cid} pinata=${uploaded.cid} match`);
      return null;
    }
    let reason = `Pinata returned ${uploaded.cid}, manifest says ${item.cid}`;
    const preexisting = uploaded.isDuplicate === true;
    let unpinned = false;
    let status: ItemStatus;
    if (preexisting) {
      // That CID was pinned on the account before this upload: not ours to remove.
      reason += "; Pinata reports it as a duplicate of an existing pin, which is left in place";
      status = "mismatch_preexisting";
    } else {
      try {
        await withRetry(`unpin ${uploaded.cid}`, false, () => unpin(uploaded.cid, pinata));
        unpinned = true;
        status = "mismatch_unpinned";
      } catch (err) {
        reason += `; unpin failed: ${clean(err instanceof Error ? err.message : String(err))}`;
        status = "mismatch_unpin_failed";
      }
    }
    // Unpinned, or a pin that predates this run: nothing of this upload stays, so its budget
    // goes back. A failed unpin leaves the pin, and the quota it uses, in place.
    if (status !== "mismatch_unpin_failed") refund(item);
    counts[status] += 1;
    mismatches.push({
      name: item.name,
      cid: item.cid,
      pinata_cid: uploaded.cid,
      unpinned,
      preexisting,
    });
    writeReceipt(receiptOf(item, status, { ...pinFields, reason }));
    log(`FAIL MISMATCH ${item.name}: ${reason}${unpinned ? " (unpinned)" : ""}`);
    const stop = item.kind === "manifest" ? stopManifest : stopTable;
    return stop ? "mismatch" : null;
  }

  // 3. Dispatch: manifests one at a time (first), then tables at `concurrency`. The budget is
  //    reserved here, in order, so the run stops at the first file that does not fit.
  let next = 0;
  let halt = false;
  let haltStatus: ItemStatus = "left_budget";
  let haltReason = "";
  function leaveOne(item: CopyItem): void {
    counts[haltStatus] += 1;
    left.push({
      kind: item.kind,
      name: item.name,
      cid: item.cid,
      status: haltStatus,
      reason: haltReason,
      size: item.size,
    });
  }
  /** Stops dispatching: everything not yet claimed is reported as left, with the reason. */
  function haltRun(
    why: "budget" | "mismatch" | "error",
    status: ItemStatus,
    reason: string,
    first?: CopyItem,
  ): void {
    if (halt) return;
    halt = true;
    stopped = why;
    haltStatus = status;
    haltReason = reason;
    if (first !== undefined) leaveOne(first);
    for (const item of queue.slice(next)) leaveOne(item);
    next = queue.length;
  }

  /** Claims the next item (synchronously, so concurrent workers never share one). */
  async function take(): Promise<CopyItem | null> {
    for (;;) {
      if (halt || next >= queue.length) return null;
      const item = queue[next] as CopyItem;
      next += 1;
      if (!dryRun) {
        let already = false;
        try {
          already = await withRetry(`pinList ${item.cid}`, false, () => isPinned(item.cid, pinata));
        } catch (err) {
          log(
            `note ${item.name}: pinList failed (${clean(err instanceof Error ? err.message : String(err))}); uploading anyway`,
          );
        }
        if (already) {
          counts.already_pinned += 1;
          writeReceipt(receiptOf(item, "already_pinned", { pinata_cid: item.cid, match: true }));
          log(`skip ${item.name}: already pinned on Pinata`);
          continue;
        }
      }
      // Claimed before another worker halted the run: it is left too, never uploaded.
      if (halt) {
        leaveOne(item);
        return null;
      }
      if (item.size > bytesLeft || filesLeft < 1) {
        const reason = `budget: ${item.name} needs ${item.size} bytes, ${bytesLeft} bytes and ${filesLeft} files left`;
        log(`stop ${reason}`);
        haltRun("budget", "left_budget", reason, item);
        return null;
      }
      bytesLeft -= item.size;
      filesLeft -= 1;
      return item;
    }
  }

  async function copyAndMaybeHalt(item: CopyItem): Promise<void> {
    const why = await copyOne(item);
    if (why !== null)
      haltRun(
        why,
        "left_stopped",
        `stopped after the ${why === "error" ? "upload error" : "mismatch"} on ${item.name}`,
      );
  }

  // Manifests first, one at a time; --first-only stops after the run manifest.
  while (!halt && next < queue.length && (queue[next] as CopyItem).kind === "manifest") {
    const item = await take();
    if (item === null) break;
    await copyAndMaybeHalt(item);
    if (firstOnly) break;
  }

  async function worker(): Promise<void> {
    for (;;) {
      const item = await take();
      if (item === null) return;
      await copyAndMaybeHalt(item);
    }
  }
  if (!halt && !firstOnly) await Promise.all(Array.from({ length: concurrency }, worker));

  // 4. Summary.
  let usageAfter: PinataUsage | null = null;
  if (!dryRun) {
    try {
      usageAfter = await withRetry("usage", false, () => usage(pinata));
    } catch (err) {
      log(`note usage after: ${clean(err instanceof Error ? err.message : String(err))}`);
    }
  }
  const ok = mismatches.length === 0 && errors.length === 0;
  const summary: CopySummary = {
    schema: "pinata-copy-summary.v1",
    run_id: options.runId,
    manifest_path: options.manifestPath,
    manifest_cid: main.item.cid,
    dry_run: dryRun,
    first_only: firstOnly,
    kinds,
    budget,
    usage_before: usageBefore,
    usage_after: usageAfter,
    counts,
    bytes: {
      uploaded: uploadedBytes,
      pin_size_uploaded: pinSizeUploaded,
      left: left.reduce((n, x) => n + (x.size ?? 0), 0),
    },
    mismatches,
    skipped,
    left,
    errors,
    stopped,
    ok,
    finished_at: now().toISOString(),
  };
  if (!dryRun) {
    mkdirSync(receiptsDir, { recursive: true });
    const text = `${clean(JSON.stringify(summary, null, 2))}\n`;
    // One summary per run, never overwritten; summary.json is a copy of the latest.
    const stamp = summary.finished_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    writeFileSync(join(receiptsDir, `summary-${stamp}.json`), text);
    writeFileSync(join(receiptsDir, "summary.json"), text);
  }
  log(
    `${ok ? "DONE" : "FAILED"}: ${counts.pinned} pinned, ${counts.already_pinned} already pinned, ${mismatches.length} mismatches, ${errors.length} errors, ${skipped.length} skipped, ${left.length} left${stopped ? ` (stopped: ${stopped})` : ""}${dryRun ? " [dry run: nothing uploaded, nothing written]" : ""}`,
  );
  return { summary, receipts, exitCode: ok ? 0 : 1 };
}
