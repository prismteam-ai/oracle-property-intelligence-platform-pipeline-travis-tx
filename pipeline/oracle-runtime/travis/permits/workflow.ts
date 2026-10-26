// A-04 T051: the AustinPermits workflow logic (durable-workflow-builder; the Restate binding
// is pipeline/local-stack/services/workflows/austin-permits.ts). Modes:
//   backfill     every keyset page of 3syk-w9eu by `:id`, then the AC-12 count at W and the
//                key-set diff (tombstones);
//   incremental  the window `:updated_at > W` of the last watermark; a source-wide re-stamp
//                (restamp.ts) turns it into a full page-through compared by content digest;
//   pilot        maxPages 1 (no watermark, no key-set diff);
//   link         link + classify over the loaded rows (the Loader track does the work).
//
// Durability: one journaled step (`ctx.run`) per page; it returns ONLY
// {lastId, sha256, rows, maxUpdatedAt}, never the body (the body is the gz artifact). On a
// restart Restate replays the journal: completed pages are not fetched again, the next
// `$where` comes only from the journaled `lastId`, and the page in flight is fetched again.
// The Loader merge of each page is idempotent on the page digest.
//
// Stops: a 403 or challenge on any request writes a `blocked` receipt; the run records
// `waiting_human` (exit 2) with nothing marked complete and no further request. A request
// still failing after 5 attempts records `failed` (exit 1). Neither advances the watermark.
//
// Page-level retry (AC-17, NFR-002): a page request that times out or fails with no HTTP
// response is asked again, at most 5 attempts in all, each attempt its own journaled step
// (`page-NNNNNN`, then `page-NNNNNN-aK`) with its own receipt line, separated by a journaled
// full-jitter wait (1 s base, 60 s cap). The `$where` cursor stays the last committed page's
// last `:id`, so no page is skipped, and only the successful attempt carries rows. After the
// 5th failure the run ends `failed` naming the page index and the time. A 403 or challenge is
// never retried.
//
// Resume (backfill): backfill-cursor.json records the last committed page; a new backfill job
// continues after it (page numbering, row counts and the key-set diff include the earlier
// pages). A page captured but not merged is re-merged from its on-disk raw page when the
// sha256 still matches, else fetched again. A completed backfill is never resumed.
//
// AC-12 count at the watermark: count(*) before paging; after paging W = max(:updated_at) of
// the captured rows, count(*) where :updated_at <= W, and count(*) again. Pass = captured rows
// (all ≤ W by construction) = the source count at W; rows above W = end total − count at W,
// counted separately; start ≠ end total (or a failed check) asks for a key-set diff.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PROFILE } from "../../../../profiles/travis-austin@1.0.0/index.js";
import { AUSTIN_PAGES } from "../adapters/socrata/austin-3syk-w9eu.js";
import {
  fetchCount,
  fetchPage,
  PageGuardError,
  fetchUpdatedHistogram,
  pageFileName,
  readPage,
  updatedAfter,
  updatedAtOrBefore,
  type PageConfig,
  type PageReceipt,
  type PageStep,
} from "../adapters/socrata/socrata-pages.js";
import { backoffDelayMs, MAX_ATTEMPTS, type SourceClient } from "../lib/source-client.js";
import {
  archiveCursor,
  commitPage,
  cursorMismatch,
  freshCursor,
  loadCursor,
  markComplete,
  markPending,
  saveCursor,
  type BackfillCursor,
} from "./backfill-cursor.js";
import type { KeyRow } from "./keyset-diff.js";
import {
  PermitsMode,
  inputDigest,
  type AustinWatermark,
  type Limitation,
  type MergeReply,
  type PermitsMergeInput,
} from "./merge-input.js";
import {
  RESTAMP_LIMITATION,
  RESTAMP_LIMITATION_CODE,
  detectRestamp,
  type RestampVerdict,
} from "./restamp.js";

export type { AustinWatermark };

export const WORKFLOW_NAME = "AustinPermits";

/** `pipeline/data/artifacts/permits/travis/` (gitignored): one folder per job. */
export const DEFAULT_ARTIFACTS_ROOT = fileURLToPath(
  new URL("../../../data/artifacts/permits/travis/", import.meta.url),
);

/** The side-effect surface, so the logic runs without Restate in tests. */
export interface PermitsIO {
  /** Journaled current time. */
  now(): Promise<Date>;
  /** Journaled step: runs `fn` once and replays its JSON result afterwards. */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Journaled durable sleep (ctx.sleep). */
  sleep(ms: number): Promise<void>;
  /** Loader.merge({track: "permits", input}) (a journaled call). */
  merge(name: string, input: PermitsMergeInput): Promise<MergeReply>;
  /** A permanent failure (Restate TerminalError): not retried, journaled. */
  fail(message: string): Error;
}

export interface PermitsDeps {
  client: SourceClient;
  /** `pipeline/data/artifacts/permits/travis/` (one folder per job). */
  artifactsRoot: string;
  /** The last Austin watermark (read-only Query DB read by the host). */
  readWatermark(): Promise<AustinWatermark | null>;
  /** Source limitations recorded with every full run (the jurisdictions report). */
  limitations(): Limitation[];
  /** Tests page smaller; the Austin config is 50,000. */
  pageSize?: number;
  config?: PageConfig;
  /** Jitter source for the page-retry waits (tests inject a seeded one). */
  random?: () => number;
}

export const PermitsRunInput = z.object({
  jobId: z.string().regex(/^travis-a04-permits-[a-z0-9-]+$/),
  mode: PermitsMode,
  /** Backfill only: archive the existing resume cursor and start at page 1 (`--fresh`). */
  fresh: z.boolean().optional(),
});
export type PermitsRunInput = z.infer<typeof PermitsRunInput>;

export interface PermitsRunResult {
  jobId: string;
  mode: PermitsMode;
  status: "complete" | "waiting_human" | "failed";
  exitCode: 0 | 1 | 2;
  reason?: string;
  pages: number;
  rows: number;
  written: number;
  tombstones: number;
  startTotal: number | null;
  endTotal: number | null;
  sourceCountAtW: number | null;
  capturedAtW: number | null;
  aboveW: number | null;
  watermark: string | null;
  watermarkCheck: AustinWatermark["watermarkCheck"];
  keysetDiffRequested: boolean;
  restamp: RestampVerdict | null;
}

/**
 * Fingerprint of what shapes the captured pages (select list, key field, digest exclusions).
 * A cursor written by different page code or config is not resumed.
 */
export function codeFingerprint(config: PageConfig): string {
  return createHash("sha256")
    .update(JSON.stringify([config.source.name, config.select, [...config.volatileFields].sort()]))
    .digest("hex");
}

const STOP_PREFIX = "permits-stop:";

interface StopInfo {
  stop: "blocked" | "error";
  reason: string;
}

const pad = (n: number): string => String(n).padStart(6, "0");

function parseStop(error: unknown): StopInfo | null {
  const message = error instanceof Error ? error.message : String(error);
  const at = message.indexOf(STOP_PREFIX);
  if (at < 0) return null;
  try {
    return JSON.parse(message.slice(at + STOP_PREFIX.length)) as StopInfo;
  } catch {
    return null;
  }
}

function stopReason(r: PageReceipt): string {
  return `${r.kind}${r.page_index === null ? "" : ` ${r.page_index}`} ${r.outcome} (HTTP ${r.http_status ?? "none"}, ${r.attempts} attempt(s)${r.blocked_reason ? `, ${r.blocked_reason}` : ""}${r.error ? `, ${r.error}` : ""})`;
}

/** Writes `keys.ndjson` ({row_id, permit_number} per row) from the verified page artifacts. */
export function writeKeys(
  jobDir: string,
  pages: readonly { index: number; sha256: string; dir?: string }[],
): { path: string; sha256: string; count: number } {
  const lines: string[] = [];
  for (const p of pages) {
    for (const r of readPage(join(p.dir ?? jobDir, pageFileName(p.index)), p.sha256)) {
      lines.push(JSON.stringify({ row_id: r[":id"], permit_number: r.permit_number }));
    }
  }
  const body = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  const path = join(jobDir, "keys.ndjson");
  writeFileSync(path, body);
  return {
    path,
    sha256: createHash("sha256").update(body, "utf8").digest("hex"),
    count: lines.length,
  };
}

const KeyLine = z.object({ row_id: z.string().min(1), permit_number: z.string().min(1) });

/** Reads `keys.ndjson` back, verifying its sha256. */
export function readKeys(path: string, expectedSha256: string): KeyRow[] {
  const body = readFileSync(path);
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`keys artifact ${path} sha256 ${actual} differs from ${expectedSha256}`);
  }
  return body
    .toString("utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const k = KeyLine.parse(JSON.parse(l));
      return { rowId: k.row_id, permitNumber: k.permit_number };
    });
}

const maxIso = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

export async function runAustinPermits(
  io: PermitsIO,
  raw: unknown,
  deps: PermitsDeps,
): Promise<PermitsRunResult> {
  const { jobId, mode, fresh } = PermitsRunInput.parse(raw);
  const base = deps.config ?? AUSTIN_PAGES;
  const config: PageConfig = { ...base, pageSize: deps.pageSize ?? base.pageSize };
  const source = config.source;
  const jobDir = join(deps.artifactsRoot, jobId);
  const receiptsPath = join(jobDir, "receipts.jsonl");
  const startedAt = (await io.now()).toISOString();
  const runKey = (kind: string, extra: Record<string, unknown> = {}) => ({
    jobId,
    mode,
    artifactPath: `run:${jobId}:${kind}`,
    artifactSha256: inputDigest({ jobId, mode, kind, ...extra }),
  });

  await io.merge("run-start", {
    kind: "run_start",
    ...runKey("run_start"),
    startedAt,
    profileSha256: PROFILE.sha256,
  });

  const result: PermitsRunResult = {
    jobId,
    mode,
    status: "complete",
    exitCode: 0,
    pages: 0,
    rows: 0,
    written: 0,
    tombstones: 0,
    startTotal: null,
    endTotal: null,
    sourceCountAtW: null,
    capturedAtW: null,
    aboveW: null,
    watermark: null,
    watermarkCheck: "not_applicable",
    keysetDiffRequested: false,
    restamp: null,
  };

  const finish = async (
    status: "waiting_human" | "failed",
    reason: string,
  ): Promise<PermitsRunResult> => {
    const finishedAt = (await io.now()).toISOString();
    // a file-system reading, so journaled: a replay must send the same receiptsPath
    const hasReceipts = await io.run("receipts-present", async () => existsSync(receiptsPath));
    await io.merge("stop", {
      kind: "stop",
      ...runKey("stop", { status }),
      status,
      finishedAt,
      reason,
      receiptsPath: hasReceipts ? receiptsPath : null,
    });
    return { ...result, status, exitCode: status === "waiting_human" ? 2 : 1, reason };
  };

  const stopOn = (r: { stop: "blocked" | "error"; receipt: PageReceipt }): Error =>
    io.fail(`${STOP_PREFIX}${JSON.stringify({ stop: r.stop, reason: stopReason(r.receipt) })}`);

  try {
    if (mode === "link") {
      const asOf = (await io.now()).toISOString().slice(0, 10);
      const reply = await io.merge("link", { kind: "link", ...runKey("link", { asOf }), asOf });
      result.written = reply.rowsWritten;
      const finishedAt = (await io.now()).toISOString();
      await io.merge("finalize", {
        kind: "finalize",
        ...runKey("finalize"),
        finishedAt,
        asOf,
        watermark: null,
        keys: null,
        limitations: [],
        receiptsPath: null,
      });
      return result;
    }

    let prior: AustinWatermark | null = null;
    if (mode === "incremental") {
      prior = await io.run("read-watermark", () => deps.readWatermark());
      if (prior === null || prior.maxUpdatedAt === null) {
        return await finish("failed", "no backfill watermark: run --mode backfill first");
      }
    }
    mkdirSync(jobDir, { recursive: true });

    const count = (name: string, where: string | null): Promise<number> =>
      io.run(name, async () => {
        const r = await fetchCount(deps.client, source, jobDir, where);
        if (r.kind === "stop") throw stopOn(r);
        return r.n;
      });

    const startTotal = await count("count-start", null);
    result.startTotal = startTotal;

    let extraWhere: string | null = null;
    let full = mode !== "pilot";
    if (prior !== null && prior.maxUpdatedAt !== null) {
      const w0 = prior.maxUpdatedAt;
      const windowCount = await count("count-window", updatedAfter(w0));
      const hours = await io.run("histogram-window", async () => {
        const r = await fetchUpdatedHistogram(deps.client, source, jobDir, w0);
        if (r.kind === "stop") throw stopOn(r);
        return r.hours;
      });
      result.restamp = detectRestamp({ total: startTotal, windowCount, hours });
      if (!result.restamp.detected) {
        extraWhere = updatedAfter(w0);
        full = false;
      }
    }

    const maxPages = mode === "pilot" ? 1 : Number.POSITIVE_INFINITY;
    const resumable = mode === "backfill";
    const start: BackfillCursor | null = resumable
      ? await io.run("resume-cursor", async () => {
          const found = loadCursor(deps.artifactsRoot);
          const stamp = { profileSha256: PROFILE.sha256, codeSha: codeFingerprint(config) };
          if (found !== null && !found.complete && fresh !== true) {
            const why = cursorMismatch(found, stamp);
            if (why !== null) {
              // deterministic: resuming under other code could skip or double pages
              throw io.fail(
                `${STOP_PREFIX}${JSON.stringify({
                  stop: "error",
                  reason: `backfill cursor of ${found.originJobId} was written under other code (${why}); not resumed, run with --fresh to archive it and start at page 1`,
                })}`,
              );
            }
            const stamped = { ...found, ...stamp };
            saveCursor(deps.artifactsRoot, stamped);
            return stamped;
          }
          if (found !== null) archiveCursor(deps.artifactsRoot, `${found.originJobId}.${jobId}`);
          const next = freshCursor(jobId, stamp);
          saveCursor(deps.artifactsRoot, next);
          return next;
        })
      : null;
    const pageDir = (owner: string): string => join(deps.artifactsRoot, owner);
    const pages: { index: number; sha256: string; dir: string }[] = (start?.pages ?? []).map(
      (p) => ({ index: p.index, sha256: p.sha256, dir: pageDir(p.jobId) }),
    );
    const first = start?.nextIndex ?? 1;
    let lastId: string | null = start?.lastId ?? null;
    let maxUpdatedAt: string | null = start?.maxUpdatedAt ?? null;
    result.rows = start?.rows ?? 0;
    result.written = start?.written ?? 0;
    result.pages = first - 1;
    let reusable = start?.pending ?? null;
    for (let n = 0; n < maxPages; n += 1) {
      const index = first + n;
      const cursor = lastId;
      let owner = jobId;
      let step: PageStep | null = null;
      if (reusable !== null && reusable.index === index) {
        // captured but not merged by an earlier job: use its raw page if it still verifies
        const held = reusable;
        step = await io.run(`page-${pad(index)}-reuse`, async () => {
          try {
            readPage(join(pageDir(held.jobId), pageFileName(index)), held.sha256);
          } catch {
            return null;
          }
          return {
            lastId: held.lastId,
            sha256: held.sha256,
            rows: held.rows,
            maxUpdatedAt: held.maxUpdatedAt,
          };
        });
        if (step !== null) owner = held.jobId;
      }
      reusable = null;
      let lastFailure: { reason: string; at: string } | null = null;
      for (let attempt = 1; step === null && attempt <= MAX_ATTEMPTS; attempt += 1) {
        const outcome: PageStep | { retry: true; reason: string; at: string } = await io.run(
          attempt === 1 ? `page-${pad(index)}` : `page-${pad(index)}-a${attempt}`,
          async () => {
            let r: Awaited<ReturnType<typeof fetchPage>>;
            try {
              r = await fetchPage({
                client: deps.client,
                config,
                jobDir,
                pageIndex: index,
                lastId: cursor,
                extraWhere,
                pageAttempt: attempt,
              });
            } catch (error) {
              // a structural guard is deterministic: stop, never re-request the page
              if (error instanceof PageGuardError) {
                throw io.fail(
                  `${STOP_PREFIX}${JSON.stringify({ stop: "error", reason: error.message })}`,
                );
              }
              throw error;
            }
            if (r.kind === "stop") {
              if (!r.retryable) throw stopOn(r);
              return {
                retry: true as const,
                reason: stopReason(r.receipt),
                at: r.receipt.captured_at,
              };
            }
            if (resumable) {
              markPending(deps.artifactsRoot, jobId, {
                index,
                sha256: r.sha256,
                jobId,
                lastId: r.lastId,
                rows: r.rows,
                maxUpdatedAt: r.maxUpdatedAt,
              });
            }
            return {
              lastId: r.lastId,
              sha256: r.sha256,
              rows: r.rows,
              maxUpdatedAt: r.maxUpdatedAt,
            };
          },
        );
        if ("retry" in outcome) {
          lastFailure = outcome;
          if (attempt < MAX_ATTEMPTS) {
            const wait = await io.run(`page-${pad(index)}-backoff-${attempt}`, async () =>
              backoffDelayMs(attempt, deps.random ?? Math.random),
            );
            await io.sleep(wait);
          }
        } else {
          step = outcome;
        }
      }
      if (step === null) {
        throw io.fail(
          `${STOP_PREFIX}${JSON.stringify({
            stop: "error",
            reason: `page ${index} failed after ${MAX_ATTEMPTS} attempts, last: ${lastFailure?.reason ?? "unknown"}, at ${lastFailure?.at ?? "unknown time"}`,
          })}`,
        );
      }
      let pageWritten = 0;
      if (step.rows > 0) {
        const reply = await io.merge(`page-${pad(index)}`, {
          kind: "page",
          jobId,
          mode,
          artifactPath: join(pageDir(owner), pageFileName(index)),
          artifactSha256: step.sha256,
          pageIndex: index,
          rows: step.rows,
          receiptsPath,
        });
        pageWritten = reply.rowsWritten;
        result.written += pageWritten;
        pages.push({ index, sha256: step.sha256, dir: pageDir(owner) });
      }
      if (resumable) {
        const committed = step;
        await io.run(`commit-page-${pad(index)}`, async () => {
          commitPage(
            deps.artifactsRoot,
            jobId,
            {
              index,
              sha256: committed.sha256,
              jobId: owner,
              lastId: committed.lastId,
              rows: committed.rows,
              maxUpdatedAt: committed.maxUpdatedAt,
            },
            pageWritten,
          );
          return true;
        });
      }
      result.pages = index;
      result.rows += step.rows;
      maxUpdatedAt = maxIso(maxUpdatedAt, step.maxUpdatedAt);
      if (step.lastId !== null) lastId = step.lastId;
      if (step.rows < config.pageSize) break;
    }

    const w = maxIso(prior?.maxUpdatedAt ?? null, maxUpdatedAt);
    result.watermark = w;
    if (mode !== "pilot") {
      result.sourceCountAtW = w === null ? 0 : await count("count-at-w", updatedAtOrBefore(w));
      result.endTotal = await count("count-end", null);
      result.capturedAtW = result.rows;
      result.aboveW = result.endTotal - result.sourceCountAtW;
      if (full) {
        result.watermarkCheck = result.capturedAtW === result.sourceCountAtW ? "pass" : "fail";
        result.keysetDiffRequested =
          result.startTotal !== result.endTotal || result.watermarkCheck === "fail";
      }
    }

    const keys = full ? await io.run("keys", async () => writeKeys(jobDir, pages)) : null;
    if (full && mode !== "pilot") {
      // OR-M2: a watermark whose count check failed, or a source total that moved without the
      // captured key set accounting for it, is never written and the run is never `complete`.
      // The cursor and the captured pages stay, so a re-run resumes (or --fresh restarts).
      const problems: string[] = [];
      if (result.watermarkCheck === "fail") {
        problems.push(
          `count at watermark ${w ?? "none"}: ${result.capturedAtW} captured rows with :updated_at <= W but the source reports ${result.sourceCountAtW}`,
        );
      }
      if (result.startTotal !== result.endTotal && keys?.count !== result.endTotal) {
        problems.push(
          `source total moved from ${result.startTotal} to ${result.endTotal} while paging and the ${keys?.count ?? 0} captured keys do not account for it`,
        );
      }
      if (problems.length > 0) {
        return await finish(
          "failed",
          `watermark not advanced: ${problems.join("; ")}. Pages and cursor kept; re-run to resume or use --fresh in a quiet window`,
        );
      }
    }
    const limitations: Limitation[] = [];
    if (result.restamp?.detected) {
      limitations.push({
        sourceKey: source.name,
        code: RESTAMP_LIMITATION_CODE,
        text: RESTAMP_LIMITATION,
        count: result.written,
        evidenceUrl: null,
      });
    }
    if (mode !== "pilot") {
      limitations.push(...(await io.run("limitations", async () => deps.limitations())));
    }
    const finishedAt = (await io.now()).toISOString();
    const watermark: AustinWatermark | null =
      mode === "pilot"
        ? null
        : {
            lastId: lastId ?? prior?.lastId ?? null, // a cursor in server order, never max()-ed
            maxUpdatedAt: w,
            sourceCountAtW: result.sourceCountAtW,
            capturedAtW: result.capturedAtW ?? 0,
            aboveW: result.aboveW,
            startTotal,
            endTotal: result.endTotal,
            watermarkCheck: result.watermarkCheck,
            pages: result.pages,
            rows: result.rows,
            startedAt,
            finishedAt,
            jobId,
            mode,
            restamp: result.restamp
              ? { detected: result.restamp.detected, rowsWritten: result.written }
              : null,
          };
    const reply = await io.merge("finalize", {
      kind: "finalize",
      ...runKey("finalize"),
      finishedAt,
      asOf: finishedAt.slice(0, 10),
      watermark,
      keys,
      limitations,
      receiptsPath,
    });
    result.tombstones = reply.tombstones;
    if (resumable) {
      await io.run("cursor-complete", async () => {
        markComplete(deps.artifactsRoot);
        return true;
      });
    }
    await io.run("status", async () => {
      mkdirSync(join(jobDir, "status"), { recursive: true });
      writeFileSync(join(jobDir, "status", "run.json"), `${JSON.stringify(result, null, 2)}\n`);
      return true;
    });
    return result;
  } catch (error) {
    const stop = parseStop(error);
    if (stop === null) throw error;
    return finish(stop.stop === "blocked" ? "waiting_human" : "failed", stop.reason);
  }
}
