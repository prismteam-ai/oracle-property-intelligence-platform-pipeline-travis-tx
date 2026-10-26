// A-04 T050: keyset pages over a whole Socrata dataset (county-permit-adapter vendor module,
// grown beside A-03's per-permit adapter, AD-17). A-03's socrata.ts makes one list query plus
// one GET per permit; at 1 request/s that is about 27 days for 2.38 M Austin rows, so the
// backfill reads the dataset in pages of at most 50,000 rows ordered by `:id`:
//
//   $select=*,:id,:updated_at,:created_at   system fields after `*` (`:id,*` answers 400)
//   $order=:id   $limit=50000   $where=:id > '<last :id of the previous page>'
//
// Politeness (NFR-002/006, D-8): every request goes through travis/lib/source-client.ts with
// host spacing on (data.austintexas.gov: 1 in flight, ≥ 1 s between request starts, retries
// included), the project User-Agent, backoff on 429/5xx only (1 s base, 60 s cap, 5 attempts,
// full jitter; the same cursor is asked again, so no page is skipped), no app token header
// and no `$$app_token` parameter, and StopOnBlocked: the first 403 or challenge writes a
// `blocked` receipt and the caller stops with no further request.
//
// The module writes artifacts only (county-permit-adapter): `raw/pages/page-NNNNNN.json.gz`
// (the exact body; its sha256 is over the decoded bytes) and one line per request in
// `receipts.jsonl`. It classifies nothing: no classification term appears here (the
// profile decides, P0-9). The Loader merges the pages into the Query DB.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import {
  stopClass,
  type CaptureReceipt,
  type SourceClient,
  type StopClass,
} from "../../lib/source-client.js";
import { MAX_PAGE_SIZE, POLITENESS, datasetUrl, type SocrataSource } from "./socrata.js";

export { MAX_PAGE_SIZE, POLITENESS };

/** What a dataset needs for keyset paging (the Austin values live in austin-3syk-w9eu.ts). */
export interface PageConfig {
  source: SocrataSource;
  /** `*` first, then the system fields (`:id` must be one of them). */
  select: string;
  pageSize: number;
  /** Calendar-derived source columns left out of the content digest. */
  volatileFields: readonly string[];
  /**
   * Whole-request limit for one page (source-client's default is 60 s, too short for an
   * ~88 MB answer). A timeout is retried at page level by the workflow.
   */
  requestTimeoutMs?: number;
}

/**
 * A structurally impossible page (empty or repeated `:id`, the cursor row served again). The
 * answer is deterministic, so asking again cannot help: the workflow turns this into a terminal
 * stop instead of letting the step retry re-request an ~88 MB page.
 */
export class PageGuardError extends Error {
  override name = "PageGuardError";
}

export const KEY_FIELD = ":id";
export const UPDATED_FIELD = ":updated_at";

const soqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Pages a full keyset pass needs for `rows` rows. */
export const pagesFor = (rows: number, pageSize: number): number => Math.ceil(rows / pageSize);

export interface PageQuery {
  url: string;
  params: Record<string, string>;
}

/** The keyset page after `lastId` (null = the first page), optionally inside `extraWhere`. */
export function buildPageQuery(
  config: PageConfig,
  lastId: string | null,
  extraWhere: string | null = null,
): PageQuery {
  const size = config.pageSize;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new Error(`page size must be between 1 and ${MAX_PAGE_SIZE}, got ${size}`);
  }
  if (!config.select.startsWith("*,") || !config.select.split(",").includes(KEY_FIELD)) {
    throw new Error(`select must be "*,…" and include ${KEY_FIELD}, got ${config.select}`);
  }
  const where = [
    ...(lastId === null ? [] : [`${KEY_FIELD} > ${soqlString(lastId)}`]),
    ...(extraWhere === null ? [] : [extraWhere]),
  ].join(" AND ");
  const params: Record<string, string> = {
    $select: config.select,
    $order: KEY_FIELD,
    $limit: String(size),
    ...(where === "" ? {} : { $where: where }),
  };
  return { url: `${datasetUrl(config.source)}?${new URLSearchParams(params)}`, params };
}

/** `count(*)` of the dataset, optionally inside `where`. */
export function buildCountQuery(source: SocrataSource, where: string | null = null): PageQuery {
  const params: Record<string, string> = {
    $select: "count(*) AS n",
    ...(where === null ? {} : { $where: where }),
  };
  return { url: `${datasetUrl(source)}?${new URLSearchParams(params)}`, params };
}

/**
 * Rows per hour of `:updated_at` after `after` (the re-stamp detector's input).
 * Socrata has no `date_trunc_ymdh`, and `date_trunc_ymd` / `date_extract_hh` take FLOATING
 * timestamps, so the hour is grouped as (UTC day, hour of day) over `to_floating_timestamp`.
 * Verified live against 3syk-w9eu on 2026-10-22 (HTTP 200).
 */
export function buildUpdatedHistogramQuery(source: SocrataSource, after: string): PageQuery {
  const floating = `to_floating_timestamp(${UPDATED_FIELD},'UTC')`;
  const params: Record<string, string> = {
    $select: `date_trunc_ymd(${floating}) AS d, date_extract_hh(${floating}) AS hh, count(*) AS n`,
    $where: updatedAfter(after),
    $group: "d,hh",
    $order: "d,hh",
    $limit: String(MAX_PAGE_SIZE),
  };
  return { url: `${datasetUrl(source)}?${new URLSearchParams(params)}`, params };
}

export const updatedAfter = (w: string): string => `${UPDATED_FIELD} > ${soqlString(w)}`;
export const updatedAtOrBefore = (w: string): string => `${UPDATED_FIELD} <= ${soqlString(w)}`;

/** One line of `receipts.jsonl` (snake_case, like every receipt in this repo). */
export interface PageReceipt {
  source: string;
  kind: "page" | "count" | "histogram";
  page_index: number | null;
  url: string;
  method: "GET";
  http_status: number | null;
  bytes: number;
  sha256: string;
  captured_at: string;
  outcome: "ok" | "blocked" | "error";
  blocked_reason: string | null;
  blocked_at: string | null;
  attempts: number;
  /** Which page-level attempt this line records (1-based; a timeout or network error retries). */
  page_attempt?: number;
  ua: string;
  app_token_used: false;
  rows: number | null;
  last_id: string | null;
  file: string | null;
  error?: string;
}

/** What one completed page step returns (the journal holds only this, never the body). */
export interface PageStep {
  lastId: string | null;
  sha256: string;
  rows: number;
  maxUpdatedAt: string | null;
}

export type PageFetch =
  | ({ kind: "ok"; file: string; receipt: PageReceipt } & PageStep)
  | {
      kind: "stop";
      stop: Exclude<StopClass, "ok">;
      receipt: PageReceipt;
      /** A timeout or a network error with no HTTP response: the same page may be asked again. */
      retryable: boolean;
    };

/**
 * Retried at page level: no HTTP response at all (timeout or network error). Never a 403 or a
 * challenge (StopOnBlocked), and never a status the client already retried (429/5xx) or a
 * body it could not parse.
 */
export function isRetryablePageStop(
  r: Pick<PageReceipt, "outcome" | "http_status" | "blocked_reason">,
): boolean {
  return (
    r.outcome === "error" &&
    r.http_status === null &&
    r.blocked_reason !== "http-403" &&
    r.blocked_reason !== "challenge"
  );
}

const PageRow = z.looseObject({
  [KEY_FIELD]: z.string().min(1),
  permit_number: z.string().min(1),
});
export const PageRows = z.array(PageRow);
export type PageRow = z.infer<typeof PageRow>;

const CountRows = z.array(z.looseObject({ n: z.union([z.string(), z.number()]) })).length(1);
const HistogramRows = z.array(
  z.looseObject({
    d: z.string().min(1),
    hh: z.union([z.string(), z.number()]),
    n: z.union([z.string(), z.number()]),
  }),
);

export const pageFileName = (pageIndex: number): string =>
  `raw/pages/page-${String(pageIndex).padStart(6, "0")}.json.gz`;

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function receiptOf(
  source: SocrataSource,
  kind: PageReceipt["kind"],
  pageIndex: number | null,
  r: CaptureReceipt,
): PageReceipt {
  const cls = stopClass(r);
  return {
    source: source.name,
    kind,
    page_index: pageIndex,
    url: r.url,
    method: "GET",
    http_status: r.status,
    bytes: r.bytes,
    sha256: r.sha256,
    captured_at: r.captured_at,
    outcome: cls,
    blocked_reason: r.blocked_reason,
    blocked_at: cls === "blocked" ? r.captured_at : null,
    attempts: r.attempts,
    ua: r.user_agent,
    app_token_used: false,
    rows: null,
    last_id: null,
    file: null,
    ...(r.error !== undefined ? { error: r.error } : {}),
  };
}

function appendReceipt(jobDir: string, receipt: PageReceipt): void {
  mkdirSync(jobDir, { recursive: true });
  appendFileSync(join(jobDir, "receipts.jsonl"), `${JSON.stringify(receipt)}\n`);
}

export interface FetchPageInput {
  client: SourceClient;
  config: PageConfig;
  jobDir: string;
  pageIndex: number;
  lastId: string | null;
  extraWhere?: string | null;
  /** 1-based page-level attempt number, recorded on the receipt line (default 1). */
  pageAttempt?: number;
}

/** Fetches one keyset page, writes the body (gz) and its receipt, and returns the step. */
export async function fetchPage(input: FetchPageInput): Promise<PageFetch> {
  const { client, config, jobDir, pageIndex } = input;
  const query = buildPageQuery(config, input.lastId, input.extraWhere ?? null);
  const result = await client.capture({
    url: query.url,
    schema: PageRows,
    accept: "application/json",
    useAppToken: false,
    ...(config.requestTimeoutMs !== undefined ? { timeoutMs: config.requestTimeoutMs } : {}),
  });
  const receipt: PageReceipt = {
    ...receiptOf(config.source, "page", pageIndex, result.receipt),
    page_attempt: input.pageAttempt ?? 1,
  };
  if (receipt.outcome !== "ok" || result.data === null) {
    const stopReceipt: PageReceipt = {
      ...receipt,
      outcome: receipt.outcome === "blocked" ? "blocked" : "error",
    };
    const stop: PageFetch = {
      kind: "stop",
      stop: receipt.outcome === "blocked" ? "blocked" : "error",
      receipt: stopReceipt,
      retryable: isRetryablePageStop(stopReceipt),
    };
    appendReceipt(jobDir, stop.receipt);
    return stop;
  }
  const rows = result.data;
  // Socrata's `:id` order is the server's own (not lexicographic), so the server's order and
  // cursor are authoritative; only structural guards are kept here.
  let lastId: string | null = null;
  let maxUpdatedAt: string | null = null;
  const seenIds = new Set<string>();
  for (const r of rows) {
    const id = r[KEY_FIELD];
    if (typeof id !== "string" || id === "") {
      throw new PageGuardError(`page ${pageIndex}: a row has no non-empty string ${KEY_FIELD}`);
    }
    if (input.lastId !== null && id === input.lastId) {
      throw new PageGuardError(`page ${pageIndex}: ${KEY_FIELD} ${id} is the cursor itself`);
    }
    if (seenIds.has(id))
      throw new PageGuardError(`page ${pageIndex}: duplicate ${KEY_FIELD} ${id}`);
    seenIds.add(id);
    lastId = id;
    const u = r[UPDATED_FIELD];
    if (typeof u === "string" && (maxUpdatedAt === null || u > maxUpdatedAt)) maxUpdatedAt = u;
  }
  const file = pageFileName(pageIndex);
  const digest = sha256(result.body);
  mkdirSync(dirname(join(jobDir, file)), { recursive: true });
  writeFileSync(join(jobDir, file), gzipSync(result.body));
  const ok: PageReceipt = { ...receipt, rows: rows.length, last_id: lastId, file, sha256: digest };
  appendReceipt(jobDir, ok);
  return {
    kind: "ok",
    file,
    receipt: ok,
    lastId,
    sha256: digest,
    rows: rows.length,
    maxUpdatedAt,
  };
}

export type CountFetch =
  | { kind: "ok"; n: number; receipt: PageReceipt }
  | { kind: "stop"; stop: Exclude<StopClass, "ok">; receipt: PageReceipt };

/** One `count(*)` request (with its receipt). */
export async function fetchCount(
  client: SourceClient,
  source: SocrataSource,
  jobDir: string,
  where: string | null = null,
): Promise<CountFetch> {
  const query = buildCountQuery(source, where);
  const result = await client.capture({ url: query.url, schema: CountRows, useAppToken: false });
  const receipt = receiptOf(source, "count", null, result.receipt);
  appendReceipt(jobDir, receipt);
  const first = result.data?.[0];
  if (receipt.outcome !== "ok" || first === undefined) {
    return { kind: "stop", stop: receipt.outcome === "blocked" ? "blocked" : "error", receipt };
  }
  const n = Number(first.n);
  if (!Number.isInteger(n) || n < 0) throw new Error(`count is not a whole number: ${first.n}`);
  return { kind: "ok", n, receipt };
}

export type HistogramFetch =
  | { kind: "ok"; hours: { hour: string; n: number }[]; receipt: PageReceipt }
  | { kind: "stop"; stop: Exclude<StopClass, "ok">; receipt: PageReceipt };

/** `d` (a floating UTC day, `YYYY-MM-DDT00:00:00.000`) plus `hh` hours, as an ISO-8601 UTC instant. */
export function hourStart(d: string, hh: string | number): string {
  const hour = Number(hh);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`bad hour ${hh}`);
  return `${d.slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

/** Rows per `:updated_at` hour after `after` (one request). */
export async function fetchUpdatedHistogram(
  client: SourceClient,
  source: SocrataSource,
  jobDir: string,
  after: string,
): Promise<HistogramFetch> {
  const query = buildUpdatedHistogramQuery(source, after);
  const result = await client.capture({
    url: query.url,
    schema: HistogramRows,
    useAppToken: false,
  });
  const receipt = receiptOf(source, "histogram", null, result.receipt);
  appendReceipt(jobDir, receipt);
  if (receipt.outcome !== "ok" || result.data === null) {
    return { kind: "stop", stop: receipt.outcome === "blocked" ? "blocked" : "error", receipt };
  }
  return {
    kind: "ok",
    hours: result.data.map((r) => ({ hour: hourStart(r.d, r.hh), n: Number(r.n) })),
    receipt,
  };
}

/** Reads a page artifact back, verifying the decoded bytes against `expectedSha256`. */
export function readPage(path: string, expectedSha256: string): PageRow[] {
  if (!existsSync(path)) throw new Error(`page artifact missing: ${path}`);
  const body = gunzipSync(readFileSync(path));
  const actual = sha256(body);
  if (actual !== expectedSha256) {
    throw new Error(`page artifact ${path} sha256 ${actual} differs from ${expectedSha256}`);
  }
  return PageRows.parse(JSON.parse(body.toString("utf8")));
}
