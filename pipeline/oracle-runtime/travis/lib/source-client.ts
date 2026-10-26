// T010: the single HTTP boundary for every Travis County source request (pattern 2).
//
// Guard rules (contracts/capture-receipt.md, ARD § 8):
// - at most 2 concurrent requests per host (p-limit per host);
// - one constant, identified User-Agent naming the project and repo (no email);
// - StopOnBlocked: HTTP 403, an explicit bot challenge or a timeout gives exactly one
//   attempt and outcome `blocked`. A challenge needs an explicit signal
//   (`detectChallengeSignal`): the `cf-mitigated: challenge` header, a challenge
//   interstitial body, or challenge markers on a 403/429/503. A Cloudflare beacon script
//   injected into a normal 200 page is not a challenge; a 2xx body that fails its Zod parse
//   without a challenge signal is `failed` ("unexpected body"), not `blocked`;
// - a network error (no HTTP response) is `failed` with `error`; only a real timeout sets
//   `timeout_ms`;
// - the receipt keeps a timeout as `blocked` / `timeout` (one attempt, no retry: the A-01
//   discovery evidence contract), but a run's exit class comes from `stopClass`: a timeout
//   is `error` (exit 1); only a 403 or a challenge is `blocked` (exit 2). Every adapter maps
//   its receipts through `stopClass` / `stopExitCode`, never by reading `outcome` itself;
// - backoff only on 429/5xx: full jitter, 1 s base, 60 s cap, 5 attempts, honouring
//   Retry-After; still failing after 5 attempts gives outcome `failed` (FR-006e);
// - a download that drops part-way resumes with `Range: bytes=<received>-` only when the
//   first 200 advertised `Accept-Ranges: bytes` and a length: same headers and client, at
//   most MAX_RESUMES, inside the same total limit, appended only on a matching 206 with
//   unchanged ETag/Last-Modified, accepted only at the advertised size (FR-003);
// - no proxy, agent, dispatcher, IP or header rotation: the request init carries only
//   method, headers, signal and redirect;
// - a capture receipt per request; an optional Socrata app token is sent as a header and
//   recorded only as `app_token_used`;
// - `isGeoBlock` is true only for an explicit body, error-code or header signal (FR-006b).
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import { performance } from "node:perf_hooks";
import pLimit, { type LimitFunction } from "p-limit";
import type { ZodType } from "zod";
import { createLogger, redact, type LogFields } from "./log.js";

export const USER_AGENT =
  "oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; " +
  "+https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)";

export const MAX_CONCURRENCY_PER_HOST = 2;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Range resumes allowed after a download drops part-way (FR-003, PO 2026-10-20). */
export const MAX_RESUMES = 5;

/** Per-host etiquette (A-04 NFR-002/004/006): one shape for every source host. */
export interface HostPolicy {
  /** Most requests in flight to this host; a configured higher value is capped here. */
  concurrency: number;
  /** Least time between two request starts to this host (0 = no spacing). */
  minIntervalMs: number;
  backoff: { baseMs: number; capMs: number; attempts: number; jitter: "full" };
  /** StopOnBlocked: the first 403 ends the capture with one attempt and no retry. */
  stopOn403: true;
  retryOn403: false;
  /** The single project User-Agent (no rotation). */
  userAgent: string;
}

const policy = (concurrency: number, minIntervalMs = 0): HostPolicy => ({
  concurrency,
  minIntervalMs,
  backoff: {
    baseMs: BACKOFF_BASE_MS,
    capMs: BACKOFF_CAP_MS,
    attempts: MAX_ATTEMPTS,
    jitter: "full",
  },
  stopOn403: true,
  retryOn403: false,
  userAgent: USER_AGENT,
});

/**
 * Host policy table (A-04 T003). Hosts not listed use MAX_CONCURRENCY_PER_HOST and no
 * spacing. GIS ≤ 2 in flight; Austin Socrata 1 in flight and ≤ 1 request/s; TCAD 1.
 */
export const HOST_POLICY: Readonly<Record<string, HostPolicy>> = Object.freeze({
  "gis.traviscountytx.gov": policy(2),
  "data.austintexas.gov": policy(1, 1_000),
  // A-11 Run 3: City of Austin address-point layer (public ArcGIS org), 1 request/s.
  "services.arcgis.com": policy(1, 1_000),
  "traviscad.org": policy(1),
  "www.traviscad.org": policy(1),
});

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type CaptureOutcome = "ok" | "blocked" | "throttled-then-ok" | "failed";
export type BlockedReason = "http-403" | "challenge" | "timeout";
/** How a capture ends a run (contracts/cli.md): ok exit 0, error exit 1, blocked exit 2. */
export type StopClass = "ok" | "blocked" | "error";

/**
 * Exit class of one receipt. `blocked` (exit 2, a human must look) only for an HTTP 403 or
 * an explicit challenge; a timeout, a network error, an unexpected body or any other
 * failure is `error` (exit 1). The receipt itself is unchanged.
 */
export function stopClass(receipt: Pick<CaptureReceipt, "outcome" | "blocked_reason">): StopClass {
  if (receipt.outcome === "ok" || receipt.outcome === "throttled-then-ok") return "ok";
  if (
    receipt.outcome === "blocked" &&
    (receipt.blocked_reason === "http-403" || receipt.blocked_reason === "challenge")
  ) {
    return "blocked";
  }
  return "error";
}

/** Process exit code for a stop class: ok 0, error 1, blocked 2. */
export function stopExitCode(cls: StopClass): 0 | 1 | 2 {
  return cls === "ok" ? 0 : cls === "blocked" ? 2 : 1;
}

export interface CaptureReceipt {
  url: string;
  method: "GET" | "HEAD" | "POST";
  status: number | null;
  bytes: number;
  sha256: string;
  captured_at: string;
  user_agent: string;
  attempts: number;
  outcome: CaptureOutcome;
  /** "none" or the quoted explicit geo signal from the saved response (FR-006b). */
  geo_signal: string;
  app_token_used: boolean;
  timeout_ms: number | null;
  blocked_reason: BlockedReason | null;
  rate_limits_observed: string | null;
  /**
   * Redacted error message: the network error when no HTTP response was received, the
   * stream error of a download that broke part-way, or why a 2xx body was unexpected.
   */
  error?: string;
  /** The quoted explicit challenge signal from the response, when one was seen. */
  challenge_signal?: string;
  /** A 2xx download whose body stream broke part-way: bytes received and advertised length. */
  incomplete_body?: { bytes: number; content_length: number | null };
  /**
   * Downloads only: HTTP Range resumes made after the stream dropped part-way (0..5,
   * FR-003). Absent on receipts written before 2026-10-20; read absent as 0.
   */
  resumes?: number;
  /** Blocked or failed captures only: what the evidence file needs (T037). Never logged. */
  stop_evidence?: StopEvidence;
}

/** Saved response of a stop (blocked/failed) capture, for the committed evidence file. */
export interface StopEvidence {
  /** Lower-cased response headers without cookies, auth or token-bearing headers. */
  headers: Record<string, string>;
  /** At most EVIDENCE_EXCERPT_BYTES of the body, base64 (JSON-safe for the journal). */
  excerpt_base64: string;
  /** Size of the whole body the excerpt came from. */
  body_bytes: number;
  /**
   * How body_bytes was measured (CR2-8): the advertised Content-Length of an unencoded body,
   * the decoded bytes read when the body was content-encoded (fetch decodes gzip/br, so the
   * encoded length is not the body size), or the bytes read when no length was advertised.
   */
  body_bytes_basis?: "content_length" | "decoded_excerpt" | "bytes_read";
  /** The encoded Content-Length of a content-encoded refusal, kept as its own field. */
  content_length_encoded?: number;
}

export interface CaptureRequest<T> {
  url: string;
  method?: "GET" | "HEAD" | "POST";
  /**
   * A POST form body (`application/x-www-form-urlencoded`), for a query too long for a URL.
   * Not part of the receipt URL; the receipt records only `method`.
   */
  formBody?: string;
  /** Zod schema the body must satisfy; a 2xx that fails it is a challenge (`blocked`). */
  schema?: ZodType<T>;
  /** How the body is handed to the schema: parsed JSON (default) or raw text. */
  bodyKind?: "json" | "text";
  accept?: string;
  timeoutMs?: number;
  /** Send the optional Socrata app token (header `X-App-Token`). */
  useAppToken?: boolean;
  /** Lower the attempt budget below MAX_ATTEMPTS (for example 1 for a single observation). */
  maxAttempts?: number;
}

export interface DownloadRequest {
  url: string;
  /** Final file path; data is streamed to `<destPath>.part` and renamed on success. */
  destPath: string;
  /** No bytes for this long counts as a timeout (FR-003: 10 minutes). */
  inactivityMs: number;
  /** The whole download may not run longer than this (FR-003: 2 hours). */
  totalMs: number;
  accept?: string;
}

export interface DownloadResult {
  receipt: CaptureReceipt;
  /** The saved file, or null when the download did not complete. */
  path: string | null;
  /** Wall-clock seconds from request to last byte (measured with a monotonic clock). */
  seconds: number;
  /** At most EXCERPT_BYTES of a non-2xx or HTML body, for blocked evidence. */
  excerpt: Buffer;
  headers: Record<string, string>;
}

export interface CaptureResult<T> {
  receipt: CaptureReceipt;
  /** Parsed body when a schema was given and the outcome is ok/throttled-then-ok. */
  data: T | null;
  /** Raw body bytes of the final attempt (for evidence files and streaming-free probes). */
  body: Buffer;
  /** Lower-cased response headers of the final attempt. */
  headers: Record<string, string>;
}

export interface SourceClientOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  timeoutMs?: number;
  /** Optional Socrata app token; defaults to SOCRATA_APP_TOKEN from the environment. */
  appToken?: string;
  log?: (event: string, fields: LogFields) => void;
  /** Monotonic milliseconds for elapsed-time measurement; defaults to performance.now. */
  clock?: () => number;
  /** Configured requests in flight per host; HOST_POLICY caps it for listed hosts. */
  maxConcurrencyPerHost?: number;
  /**
   * Enforce HOST_POLICY.minIntervalMs between request starts (A-04 RunContext turns it on).
   * Off by default: the A-01/A-03 callers space their own Austin requests.
   */
  hostSpacing?: boolean;
}

export interface SourceClient {
  capture<T = unknown>(request: CaptureRequest<T>): Promise<CaptureResult<T>>;
  /** Streams one large file to disk with inactivity and total limits (TCAD export). */
  download(request: DownloadRequest): Promise<DownloadResult>;
}

/** Bytes kept from a refused download body for the evidence excerpt. */
export const EXCERPT_BYTES = 64 * 1024;

/** Bytes of a stop body kept on the receipt for the evidence file (journal-friendly). */
export const EVIDENCE_EXCERPT_BYTES = 4 * 1024;

/** Response headers never kept: session cookies, auth challenges and anything token-like. */
const UNSAFE_HEADER =
  /cookie|authori[sz]ation|authenticate|token|secret|password|api-?key|session/i;

/** Drops cookie, auth and token-bearing headers; redacts the remaining values. */
export function safeHeaders(
  headers: Record<string, string>,
  secrets: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (UNSAFE_HEADER.test(lower)) continue;
    out[lower] = redact(value, secrets);
  }
  return out;
}

export function stopEvidence(
  headers: Record<string, string>,
  body: Buffer,
  secrets: readonly string[] = [],
): StopEvidence {
  return {
    headers: safeHeaders(headers, secrets),
    excerpt_base64: body.subarray(0, EVIDENCE_EXCERPT_BYTES).toString("base64"),
    body_bytes: body.byteLength,
  };
}

/** The receipt as logged: without the saved stop body. */
function loggable(receipt: CaptureReceipt): LogFields {
  const { stop_evidence: _evidence, ...rest } = receipt;
  return { ...rest };
}

export interface SavedResponse {
  status: number | null;
  headers: Record<string, string>;
  body: string;
}

/** Full-jitter exponential backoff: random() * min(cap, base * 2^(attempt-1)). */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

const GEO_BODY_PATTERNS: readonly RegExp[] = [
  /not (?:available|accessible) (?:in|from) your (?:country|region|location)/i,
  /(?:unavailable|blocked|restricted) in your (?:country|region|location)/i,
  /(?:country|region|geographic(?:al)?|geo)[- ]?(?:block(?:ed|ing)?|restrict(?:ed|ion)?)/i,
  /error code:?\s*1009\b/i, // Cloudflare: "the owner has banned your country or region"
  /access (?:is )?denied[^.]{0,40}\b(?:country|region)\b/i,
];
const GEO_HEADER_NAME = /(?:^|-)geo(?:-|block|$)/i;
const GEO_HEADER_VALUE = /block|restrict|den(?:y|ied)|forbid|country|region/i;
const COUNTRY_INFO_HEADERS = new Set(["cf-ipcountry", "x-country-code", "x-geo-country"]);

/**
 * Returns the quoted explicit geo signal from a saved response, or null. A bare 403, a
 * bot challenge or a country header that every response carries is never a signal.
 */
export function detectGeoSignal(saved: SavedResponse): string | null {
  for (const pattern of GEO_BODY_PATTERNS) {
    const match = pattern.exec(saved.body);
    if (match) return match[0].slice(0, 200);
  }
  for (const [name, value] of Object.entries(saved.headers)) {
    const lower = name.toLowerCase();
    if (COUNTRY_INFO_HEADERS.has(lower)) continue;
    const named = GEO_HEADER_NAME.test(lower) || lower === "x-deny-reason";
    if (named && GEO_HEADER_VALUE.test(value)) return `${lower}: ${value}`.slice(0, 200);
  }
  return null;
}

/** A challenge interstitial's page title (Cloudflare, Sucuri, DDoS-Guard, Imperva, PerimeterX). */
const INTERSTITIAL_TITLE =
  /^\s*(?:just a moment\b|attention required\b|checking your browser\b|one more step\b|security check\b|ddos-guard\b|pardon our interruption\b|access denied\b|request unsuccessful\b)/i;
/** Body markers that appear only on a challenge interstitial, never on a normal page. */
const INTERSTITIAL_BODY =
  /window\._cf_chl_opt|id="challenge-form"|id="cf-chl-widget|request unsuccessful\. incapsula incident id|id="px-captcha"/i;
/** Phrases of a challenge page without a <title> (bare interstitial text). */
const INTERSTITIAL_TEXT =
  /just a moment\.\.\.|attention required! \| cloudflare|checking your browser before accessing|checking if the site connection is secure/i;
/** Looser markers, trusted only on a refusal status (403/429/503). */
const REFUSAL_MARKERS =
  /cf-chl|challenge-platform|just a moment|attention required|checking your browser|captcha|incapsula|perimeterx/i;
const REFUSAL_STATUSES = new Set([403, 429, 503]);

/**
 * A web application firewall naming itself in the body (OR-M2: San Leanna's HTTP 406 page
 * says "a request has been blocked by Mod Security"). Trusted on any status: a WAF refusal
 * may come as 406, 403, 501 or even 200.
 */
const WAF_BODY =
  /\b(?:mod[_ ]?security|web application firewall|waf)\b|\brequest (?:has been |was )?blocked by (?:mod[_ ]?security|the (?:web application )?firewall|waf)\b/i;
/**
 * OR-N8: on a non-2xx answer a bare "request blocked" still counts (fail-closed); on a 2xx
 * page the body must name the firewall, so a Socrata row saying "REQUEST BLOCKED" is data.
 */
const WAF_BODY_REFUSAL = /\brequest (?:has been |was )?blocked\b/i;
/** Response header values naming a WAF (e.g. `server: Mod_Security`). */
const WAF_HEADER = /\bmod[_ ]?security\b/i;
/** A 2xx body larger than this is a document, not a WAF error page (avoids false positives). */
const WAF_MAX_2XX_BODY = 8 * 1024;

/**
 * Returns the quoted explicit WAF/block signal of a saved response, or null (OR-M2): a body
 * that names the firewall, whatever the status (on a 2xx only for a small page), or a
 * header that names it on a non-2xx answer.
 */
export function wafSignal(saved: SavedResponse): string | null {
  const ok2xx = saved.status !== null && saved.status >= 200 && saved.status < 300;
  // A Server header may list mod_security as an installed module on every answer, so a
  // header counts only on a refusal (non-2xx) status.
  for (const [name, value] of Object.entries(saved.headers)) {
    if (!ok2xx && WAF_HEADER.test(value)) return `${name.toLowerCase()}: ${value}`.slice(0, 200);
  }
  if (ok2xx && Buffer.byteLength(saved.body, "utf8") > WAF_MAX_2XX_BODY) return null;
  const match = WAF_BODY.exec(saved.body) ?? (ok2xx ? null : WAF_BODY_REFUSAL.exec(saved.body));
  if (!match) return null;
  const status = saved.status === null ? "no HTTP status" : `HTTP ${saved.status}`;
  return `${status} names a web application firewall: "${match[0]}"`;
}

/**
 * Returns the quoted explicit bot-challenge signal of a saved response, or null. A normal
 * page that merely carries an injected beacon (for example Cloudflare's
 * `/cdn-cgi/challenge-platform/` bot-detection script) is never a challenge. A web
 * application firewall that names itself (`wafSignal`) is a block on any status (OR-M2).
 */
export function detectChallengeSignal(saved: SavedResponse): string | null {
  const waf = wafSignal(saved);
  if (waf !== null) return waf;
  const mitigated = Object.entries(saved.headers).find(
    ([name]) => name.toLowerCase() === "cf-mitigated",
  );
  if (mitigated && /challenge/i.test(mitigated[1])) {
    return `cf-mitigated: ${mitigated[1]}`.slice(0, 200);
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(saved.body)?.[1]?.trim() ?? null;
  if (title !== null && INTERSTITIAL_TITLE.test(title)) return `title: "${title}"`.slice(0, 200);
  const marker = INTERSTITIAL_BODY.exec(saved.body);
  if (marker) return `interstitial marker: "${marker[0]}"`;
  if (title === null) {
    const phrase = INTERSTITIAL_TEXT.exec(saved.body);
    if (phrase) return `interstitial text: "${phrase[0]}"`;
  }
  if (saved.status !== null && REFUSAL_STATUSES.has(saved.status)) {
    const refusal = REFUSAL_MARKERS.exec(saved.body);
    if (refusal) return `HTTP ${saved.status} with challenge marker "${refusal[0]}"`;
  }
  return null;
}

export function isGeoBlock(saved: SavedResponse): boolean {
  return detectGeoSignal(saved) !== null;
}

function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A refused answer: the bounded excerpt and how big the whole body was (CR2-8). */
interface RefusedBody {
  excerpt: Buffer;
  bodyBytes: number;
  basis: NonNullable<StopEvidence["body_bytes_basis"]>;
  contentLengthEncoded?: number;
  challenge: string | null;
}

/** One download request's abort controller and limit timers. */
interface StreamGuard {
  controller: AbortController;
  /** Restarts the inactivity timer (called on every chunk). */
  resetIdle: () => void;
  clear: () => void;
}

function lowerHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

function parseLength(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** The whole-file length advertised by the first (200) answer, or null. */
function advertisedLength(headers: Record<string, string>): number | null {
  return parseLength(headers["content-length"]);
}

/**
 * A dropped download may resume only when the source advertises `Accept-Ranges: bytes`,
 * a whole-file length to verify against, and an unencoded body (byte offsets of a
 * decoded stream would not match the server's).
 */
function supportsResume(headers: Record<string, string>, advertised: number | null): boolean {
  const ranges = (headers["accept-ranges"] ?? "").toLowerCase().split(",");
  return (
    ranges.some((r) => r.trim() === "bytes") && advertised !== null && identityEncoded(headers)
  );
}

/** True when the body is not content-encoded (its byte count can match Content-Length). */
function identityEncoded(headers: Record<string, string>): boolean {
  const encoding = (headers["content-encoding"] ?? "identity").trim().toLowerCase();
  return encoding === "" || encoding === "identity";
}

/**
 * Reads at most `limit` bytes of a body, then cancels the stream (CR-1). Never buffers a
 * whole body: a refused answer may be a multi-GB file.
 */
async function readBounded(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader() ?? null;
  if (reader === null) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).subarray(0, limit);
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
  } catch {
    // a body that breaks while its excerpt is read keeps what arrived
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, limit);
}

/** Waits for `drain`, or returns at once when the stream errors or closes (CR-2: no hang). */
function drained(out: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      out.off("drain", done);
      out.off("error", done);
      out.off("close", done);
      resolve();
    };
    out.once("drain", done);
    out.once("error", done);
    out.once("close", done);
  });
}

/** Removes a `.part` file; never throws (it may be missing, or not a file at all). */
function removePart(part: string): void {
  try {
    rmSync(part, { force: true });
  } catch {
    // nothing to clean up that we may delete
  }
}

/** Range (and If-Range, so a changed file is never spliced) for a resume from `from`. */
function resumeHeaders(first: Record<string, string>, from: number): Record<string, string> {
  const out: Record<string, string> = { range: `bytes=${from}-` };
  const etag = first.etag;
  const lastModified = first["last-modified"];
  if (etag !== undefined && !etag.startsWith("W/")) out["if-range"] = etag;
  else if (lastModified !== undefined) out["if-range"] = lastModified;
  return out;
}

/**
 * Why a 206 answer cannot be appended, or null: its Content-Range must start at the last
 * byte received and end at the advertised length, and the ETag and Last-Modified of the
 * first answer must not have changed.
 */
function resumeMismatch(
  first: Record<string, string>,
  resumed: Record<string, string>,
  from: number,
  advertised: number | null,
): string | null {
  for (const name of ["etag", "last-modified"]) {
    const before = first[name];
    if (before !== undefined && resumed[name] !== before) {
      return `${name === "etag" ? "ETag" : "Last-Modified"} changed between attempts`;
    }
  }
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec((resumed["content-range"] ?? "").trim());
  const start = range ? Number(range[1]) : Number.NaN;
  const end = range ? Number(range[2]) : Number.NaN;
  const total = range ? Number(range[3]) : Number.NaN;
  if (advertised === null || start !== from || end !== advertised - 1 || total !== advertised) {
    return `Content-Range "${resumed["content-range"] ?? "none"}" does not continue bytes ${from}-${(advertised ?? 0) - 1}/${advertised ?? "unknown"}`;
  }
  const partLength = parseLength(resumed["content-length"]);
  if (partLength !== null && partLength !== advertised - from) {
    return `Content-Length ${partLength} does not equal the ${advertised - from} bytes left`;
  }
  return null;
}

type Attempt =
  | { kind: "response"; status: number; headers: Record<string, string>; body: Buffer; at: Date }
  | { kind: "timeout"; at: Date }
  | { kind: "error"; message: string; at: Date };

export function createSourceClient(options: SourceClientOptions = {}): SourceClient {
  const rawFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clock = options.clock ?? (() => performance.now());
  // An empty token (option or environment) means no token.
  const appToken = (options.appToken ?? process.env.SOCRATA_APP_TOKEN ?? "") || null;
  const secrets = appToken ? [appToken] : [];
  const logger = createLogger(undefined, secrets);
  const emit = options.log ?? ((event: string, fields: LogFields) => logger.info(event, fields));
  const limiters = new Map<string, LimitFunction>();
  const configured = Math.max(1, options.maxConcurrencyPerHost ?? MAX_CONCURRENCY_PER_HOST);
  const nextStart = new Map<string, number>();

  const limiterFor = (url: string): LimitFunction => {
    const host = new URL(url).host;
    let limiter = limiters.get(host);
    if (!limiter) {
      const cap = HOST_POLICY[host]?.concurrency;
      limiter = pLimit(cap === undefined ? configured : Math.min(configured, cap));
      limiters.set(host, limiter);
    }
    return limiter;
  };

  // With hostSpacing, every request start (first attempt, retry or Range resume) to a spaced
  // host waits for the host policy interval; the wait uses the injected sleep and clock.
  const fetchImpl: FetchLike = async (url, init) => {
    const host = new URL(url).host;
    const interval = options.hostSpacing === true ? (HOST_POLICY[host]?.minIntervalMs ?? 0) : 0;
    if (interval > 0) {
      const due = nextStart.get(host);
      if (due !== undefined) {
        const wait = due - clock();
        if (wait > 0) await sleep(wait);
      }
      nextStart.set(host, clock() + interval);
    }
    return rawFetch(url, init);
  };

  async function attemptOnce(
    url: string,
    method: "GET" | "HEAD" | "POST",
    headers: Record<string, string>,
    timeoutMs: number,
    formBody?: string,
  ): Promise<Attempt> {
    const at = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        ...(formBody === undefined ? {} : { body: formBody }),
        signal: controller.signal,
        redirect: "follow",
      });
      const body = Buffer.from(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });
      return { kind: "response", status: response.status, headers: responseHeaders, body, at };
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return { kind: "timeout", at };
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "error", message: redact(message, secrets), at };
    } finally {
      clearTimeout(timer);
    }
  }

  async function captureUnlimited<T>(request: CaptureRequest<T>): Promise<CaptureResult<T>> {
    const method = request.method ?? "GET";
    const timeoutMs = request.timeoutMs ?? defaultTimeout;
    const tokenUsed = request.useAppToken === true && appToken !== null;
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: request.accept ?? "*/*",
    };
    if (tokenUsed && appToken !== null) headers["x-app-token"] = appToken;
    if (request.formBody !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }

    const observed: string[] = [];
    let attempts = 0;
    let last: Attempt | null = null;

    const budget = Math.max(1, Math.min(MAX_ATTEMPTS, request.maxAttempts ?? MAX_ATTEMPTS));
    while (attempts < budget) {
      attempts += 1;
      last = await attemptOnce(request.url, method, headers, timeoutMs, request.formBody);
      if (last.kind !== "response" || !isRetryable(last.status)) break;
      // a challenge is never retried, whatever its status (StopOnBlocked)
      if (challengeOf(last.status, last.headers, last.body) !== null) break;
      const retryAfterHeader = last.headers["retry-after"] ?? null;
      observed.push(
        retryAfterHeader === null
          ? `HTTP ${last.status}`
          : `HTTP ${last.status} Retry-After ${retryAfterHeader}`,
      );
      if (attempts >= budget) break;
      const retryAfterMs = parseRetryAfter(retryAfterHeader, now());
      await sleep(retryAfterMs ?? backoffDelayMs(attempts, random));
    }
    if (last === null) throw new Error("source-client: no attempt was made");

    const body = last.kind === "response" ? last.body : Buffer.alloc(0);
    const responseHeaders = last.kind === "response" ? last.headers : {};
    const status = last.kind === "response" ? last.status : null;

    let outcome: CaptureOutcome;
    let blockedReason: BlockedReason | null = null;
    let data: T | null = null;
    let error: string | null = null;
    const challenge =
      last.kind === "response" ? challengeOf(last.status, last.headers, last.body) : null;

    if (last.kind === "timeout") {
      outcome = "blocked";
      blockedReason = "timeout";
    } else if (last.kind === "error") {
      outcome = "failed";
      error = last.message;
    } else if (challenge !== null) {
      outcome = "blocked";
      blockedReason = "challenge";
    } else if (last.status === 403) {
      outcome = "blocked";
      blockedReason = "http-403";
    } else if (last.status >= 200 && last.status < 300) {
      const parsed = request.schema ? parseBody(request.schema, body, request.bodyKind) : null;
      if (parsed && !parsed.ok) {
        outcome = "failed";
        error = UNEXPECTED_BODY;
      } else {
        data = parsed ? parsed.value : null;
        outcome = attempts > 1 ? "throttled-then-ok" : "ok";
      }
    } else {
      outcome = "failed";
    }

    const geo =
      outcome === "blocked" || outcome === "failed"
        ? detectGeoSignal({ status, headers: responseHeaders, body: body.toString("utf8") })
        : null;

    const receipt: CaptureReceipt = {
      url: redact(request.url, secrets),
      method,
      status,
      bytes: body.byteLength,
      sha256: sha256(body),
      captured_at: last.at.toISOString(),
      user_agent: USER_AGENT,
      attempts,
      outcome,
      geo_signal: geo ?? "none",
      app_token_used: tokenUsed,
      timeout_ms: last.kind === "timeout" ? timeoutMs : null,
      blocked_reason: blockedReason,
      rate_limits_observed: observed.length > 0 ? observed.join("; ") : null,
    };
    if (error !== null) receipt.error = error;
    if (challenge !== null) receipt.challenge_signal = redact(challenge, secrets);
    if (outcome === "blocked" || outcome === "failed") {
      receipt.stop_evidence = stopEvidence(responseHeaders, body, secrets);
    }

    emit("source.capture", loggable(receipt));
    return { receipt, data, body, headers: responseHeaders };
  }

  async function downloadUnlimited(request: DownloadRequest): Promise<DownloadResult> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: request.accept ?? "*/*",
    };
    const startedMs = clock();
    const startedAt = now();
    const part = `${request.destPath}.part`;
    const observed: string[] = [];
    let attempts = 0;

    const finish = (
      fields: Pick<CaptureReceipt, "status" | "outcome"> &
        Partial<
          Pick<
            CaptureReceipt,
            | "timeout_ms"
            | "blocked_reason"
            | "error"
            | "challenge_signal"
            | "incomplete_body"
            | "resumes"
          >
        > & {
          bytes: number;
          sha256: string;
          /** Size of the whole refused body (advertised or read) for the stop evidence. */
          body_bytes?: number;
          body_bytes_basis?: StopEvidence["body_bytes_basis"];
          content_length_encoded?: number;
          headers: Record<string, string>;
          excerpt: Buffer;
          path: string | null;
        },
    ): DownloadResult => {
      const geo =
        fields.outcome === "blocked" || fields.outcome === "failed"
          ? detectGeoSignal({
              status: fields.status,
              headers: fields.headers,
              body: fields.excerpt.toString("utf8"),
            })
          : null;
      const receipt: CaptureReceipt = {
        url: redact(request.url, secrets),
        method: "GET",
        status: fields.status,
        bytes: fields.bytes,
        sha256: fields.sha256,
        captured_at: startedAt.toISOString(),
        user_agent: USER_AGENT,
        attempts,
        outcome: fields.outcome,
        geo_signal: geo ?? "none",
        app_token_used: false,
        timeout_ms: fields.timeout_ms ?? null,
        blocked_reason: fields.blocked_reason ?? null,
        rate_limits_observed: observed.length > 0 ? observed.join("; ") : null,
        resumes: fields.resumes ?? 0,
      };
      if (fields.error !== undefined) receipt.error = fields.error;
      if (fields.challenge_signal !== undefined) {
        receipt.challenge_signal = redact(fields.challenge_signal, secrets);
      }
      if (fields.incomplete_body !== undefined) receipt.incomplete_body = fields.incomplete_body;
      if (fields.outcome === "blocked" || fields.outcome === "failed") {
        receipt.stop_evidence = stopEvidence(fields.headers, fields.excerpt, secrets);
        receipt.stop_evidence.body_bytes = fields.body_bytes ?? fields.bytes;
        if (fields.body_bytes_basis !== undefined) {
          receipt.stop_evidence.body_bytes_basis = fields.body_bytes_basis;
        }
        if (fields.content_length_encoded !== undefined) {
          receipt.stop_evidence.content_length_encoded = fields.content_length_encoded;
        }
      }
      emit("source.download", loggable(receipt));
      return {
        receipt,
        path: fields.path,
        seconds: (clock() - startedMs) / 1000,
        excerpt: fields.excerpt,
        headers: fields.headers,
      };
    };

    // A timer can fire a fraction of a millisecond before the monotonic clock reaches its
    // limit, so a timeout records at least the limit that fired (FR-003: >= 10 min / 2 h).
    // ERR-8: the elapsed time is taken when the limit fires, not after the cleanup that
    // follows, so `timeout_ms` reports when the download was stopped.
    let limitHit = 0;
    let firedAt: number | null = null;
    let timedOut = false;
    const elapsed = (): number => Math.max(1, limitHit, firedAt ?? Math.round(clock() - startedMs));

    /**
     * One request's abort controller with the shared 2-hour total limit (measured from the
     * first request, so it spans every resume) and its own 10-minute inactivity limit.
     */
    const openGuard = (): StreamGuard => {
      const controller = new AbortController();
      const fire = (limit: number) => (): void => {
        timedOut = true;
        limitHit = Math.max(limitHit, limit);
        firedAt ??= Math.round(clock() - startedMs);
        controller.abort();
      };
      const total = setTimeout(
        fire(request.totalMs),
        Math.max(0, request.totalMs - (clock() - startedMs)),
      );
      let idle = setTimeout(fire(request.inactivityMs), request.inactivityMs);
      return {
        controller,
        resetIdle: () => {
          clearTimeout(idle);
          idle = setTimeout(fire(request.inactivityMs), request.inactivityMs);
        },
        clear: () => {
          clearTimeout(total);
          clearTimeout(idle);
        },
      };
    };

    const timeoutStop = (fields: {
      status: number | null;
      bytes: number;
      sha256: string;
      headers: Record<string, string>;
      resumes?: number;
    }): DownloadResult =>
      finish({
        ...fields,
        outcome: "blocked",
        blocked_reason: "timeout",
        timeout_ms: elapsed(),
        excerpt: Buffer.alloc(0),
        path: null,
      });

    /**
     * A refused (non-2xx, or HTML) answer: never streamed to disk and never buffered whole
     * (CR-1: a full 200 of the multi-GB export answering a resume must not fill the heap).
     * At most EXCERPT_BYTES are read, then the body stream is cancelled. `excerpt` is what
     * was read; the receipt's bytes and sha256 are of that excerpt, and `bodyBytes` is the
     * advertised Content-Length when there is one, otherwise the bytes read.
     */
    const refusal = async (
      response: Response,
      responseHeaders: Record<string, string>,
      guard: StreamGuard,
    ): Promise<RefusedBody> => {
      const excerpt = await readBounded(response, EXCERPT_BYTES);
      guard.clear();
      const advertised = advertisedLength(responseHeaders);
      // CR2-8: fetch decodes gzip/br, so an encoded Content-Length is not the body size.
      const encoded = !identityEncoded(responseHeaders);
      return {
        excerpt,
        bodyBytes: !encoded && advertised !== null ? advertised : excerpt.byteLength,
        basis: encoded ? "decoded_excerpt" : advertised !== null ? "content_length" : "bytes_read",
        ...(encoded && advertised !== null ? { contentLengthEncoded: advertised } : {}),
        challenge: challengeOf(response.status, responseHeaders, excerpt),
      };
    };

    /**
     * Streams one response body into `out`, hashing as it arrives; the stream error or null.
     * A write error on `out` (CR-2: disk full, EISDIR) is reported through `writeFailed`,
     * stops reading at once and is never answered with a Range resume.
     */
    const pump = async (
      response: Response,
      guard: StreamGuard,
      out: WriteStream,
      onChunk: (chunk: Uint8Array) => void,
      writeFailed: () => string | null,
    ): Promise<string | null> => {
      const reader = response.body?.getReader() ?? null;
      const onAbort = (): void => {
        void reader?.cancel().catch(() => undefined);
      };
      guard.controller.signal.addEventListener("abort", onAbort);
      try {
        while (reader) {
          if (writeFailed() !== null) {
            await reader.cancel().catch(() => undefined);
            break;
          }
          const { done, value } = await reader.read();
          if (done || timedOut) break;
          // CR2-2: the .part stream may have failed while this read was pending. Its `error`
          // and `close` events have then already fired, so `drained()` would wait forever:
          // stop before writing, and never wait for `drain` on a failed stream.
          if (writeFailed() !== null) {
            await reader.cancel().catch(() => undefined);
            break;
          }
          guard.resetIdle();
          onChunk(value);
          if (!out.write(value) && writeFailed() === null) await drained(out);
        }
        if (writeFailed() !== null) await reader?.cancel().catch(() => undefined);
        return null;
      } catch (error) {
        return timedOut ? null : error instanceof Error ? error.message : String(error);
      } finally {
        guard.clear();
        guard.controller.signal.removeEventListener("abort", onAbort);
      }
    };

    const streamWithResumes = async (
      response: Response,
      firstHeaders: Record<string, string>,
      firstGuard: StreamGuard,
    ): Promise<DownloadResult> => {
      mkdirSync(dirname(request.destPath), { recursive: true });
      const out = createWriteStream(part);
      // CR-2: without a listener a write error would crash the process.
      let writeError: string | null = null;
      out.on("error", (error: NodeJS.ErrnoException) => {
        writeError ??= error.code ?? error.message;
      });
      // CR2-2: also reports a stream that errored or closed before its `error` listener ran
      // (`errored` is set synchronously) or was destroyed without an error.
      const writeFailed = (): string | null => {
        if (writeError === null) {
          const errored = out.errored as NodeJS.ErrnoException | null;
          if (errored) writeError = errored.code ?? errored.message;
          else if (out.destroyed || out.writableEnded) {
            writeError = "the .part stream closed before the body was written";
          }
        }
        return writeError;
      };
      const hash = createHash("sha256");
      let bytes = 0;
      let resumes = 0;
      const onChunk = (chunk: Uint8Array): void => {
        hash.update(chunk);
        bytes += chunk.byteLength;
      };
      // Safe on an errored or destroyed stream: resolves once the stream has finished or closed.
      const closeOut = async (): Promise<void> => {
        if (!out.destroyed && !out.writableEnded) out.end();
        await finished(out).catch(() => undefined);
      };
      const advertised = advertisedLength(firstHeaders);
      const rangeable = supportsResume(firstHeaders, advertised);

      let streamError = await pump(response, firstGuard, out, onChunk, writeFailed);
      while (
        streamError !== null &&
        writeError === null &&
        !timedOut &&
        rangeable &&
        resumes < MAX_RESUMES
      ) {
        resumes += 1;
        const guard = openGuard();
        let resumed: Response;
        try {
          resumed = await fetchImpl(request.url, {
            method: "GET",
            headers: { ...headers, ...resumeHeaders(firstHeaders, bytes) },
            signal: guard.controller.signal,
            redirect: "follow",
          });
        } catch (error) {
          guard.clear();
          if (timedOut || guard.controller.signal.aborted || isAbort(error)) break;
          const message = error instanceof Error ? error.message : String(error);
          streamError = `resume ${resumes} failed with a network error: ${message}`;
          break;
        }
        const resumedHeaders = lowerHeaders(resumed);
        if (resumed.status !== 206) {
          const refused = await refusal(resumed, resumedHeaders, guard);
          if (refused.challenge !== null || resumed.status === 403) {
            // StopOnBlocked is unchanged on a resume: stop, no further request.
            await closeOut();
            removePart(part);
            return finish({
              status: resumed.status,
              outcome: "blocked",
              blocked_reason: refused.challenge !== null ? "challenge" : "http-403",
              ...(refused.challenge === null ? {} : { challenge_signal: refused.challenge }),
              bytes: refused.excerpt.byteLength,
              sha256: sha256(refused.excerpt),
              body_bytes: refused.bodyBytes,
              body_bytes_basis: refused.basis,
              ...(refused.contentLengthEncoded === undefined
                ? {}
                : { content_length_encoded: refused.contentLengthEncoded }),
              headers: resumedHeaders,
              excerpt: refused.excerpt,
              path: null,
              resumes,
            });
          }
          streamError = `resume ${resumes} refused: HTTP ${resumed.status} instead of 206 Partial Content`;
          break;
        }
        const mismatch = resumeMismatch(firstHeaders, resumedHeaders, bytes, advertised);
        if (mismatch !== null) {
          await resumed.body?.cancel().catch(() => undefined);
          guard.clear();
          streamError = `resume ${resumes} rejected: ${mismatch}`;
          break;
        }
        streamError = await pump(resumed, guard, out, onChunk, writeFailed);
      }
      await closeOut();

      if (timedOut) {
        removePart(part);
        return timeoutStop({
          status: response.status,
          bytes,
          sha256: hash.digest("hex"),
          headers: firstHeaders,
          resumes,
        });
      }
      if (writeError !== null) {
        // CR-2: the .part file could not be written; nothing is resumed or renamed.
        removePart(part);
        return finish({
          status: response.status,
          outcome: "failed",
          error: redact(`writing the .part file failed: ${writeError}`, secrets),
          incomplete_body: { bytes, content_length: advertised },
          bytes,
          sha256: hash.digest("hex"),
          headers: firstHeaders,
          excerpt: Buffer.alloc(0),
          path: null,
          resumes,
        });
      }
      // CR-6: every completed stream is checked against the advertised whole-file length
      // (resumed or not), unless the body is content-encoded (the length is then of the
      // encoded body). A size mismatch keeps the .part file for inspection; it is never
      // renamed to the final path.
      if (streamError === null && advertised !== null && identityEncoded(firstHeaders)) {
        if (bytes !== advertised) {
          return finish({
            status: response.status,
            outcome: "failed",
            error: `file size ${bytes} does not equal the advertised length ${advertised}${resumes > 0 ? ` after ${resumes} resume(s)` : ""}; the .part file is kept`,
            incomplete_body: { bytes, content_length: advertised },
            bytes,
            sha256: hash.digest("hex"),
            headers: firstHeaders,
            excerpt: Buffer.alloc(0),
            path: null,
            resumes,
          });
        }
      }
      if (streamError !== null) {
        removePart(part);
        return finish({
          status: response.status,
          outcome: "failed",
          error: redact(streamError, secrets),
          incomplete_body: { bytes, content_length: advertised },
          bytes,
          sha256: hash.digest("hex"),
          headers: firstHeaders,
          excerpt: Buffer.alloc(0),
          path: null,
          resumes,
        });
      }
      renameSync(part, request.destPath);
      return finish({
        status: response.status,
        outcome: attempts > 1 ? "throttled-then-ok" : "ok",
        bytes,
        sha256: hash.digest("hex"),
        headers: firstHeaders,
        excerpt: Buffer.alloc(0),
        path: request.destPath,
        resumes,
      });
    };

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      const guard = openGuard();

      let response: Response;
      try {
        response = await fetchImpl(request.url, {
          method: "GET",
          headers,
          signal: guard.controller.signal,
          redirect: "follow",
        });
      } catch (error) {
        guard.clear();
        if (timedOut || guard.controller.signal.aborted || isAbort(error)) {
          return timeoutStop({
            status: null,
            bytes: 0,
            sha256: sha256(Buffer.alloc(0)),
            headers: {},
          });
        }
        const message = error instanceof Error ? error.message : String(error);
        return finish({
          status: null,
          outcome: "failed",
          error: redact(message, secrets),
          bytes: 0,
          sha256: sha256(Buffer.alloc(0)),
          headers: {},
          excerpt: Buffer.alloc(0),
          path: null,
        });
      }

      const responseHeaders = lowerHeaders(response);
      const contentType = responseHeaders["content-type"] ?? "";
      const isHtml = /text\/html/i.test(contentType);

      if (response.status < 200 || response.status >= 300 || isHtml) {
        // Read a bounded excerpt only; never stream an error or challenge body to disk.
        const refused = await refusal(response, responseHeaders, guard);
        const { excerpt, bodyBytes, challenge } = refused;
        if (isRetryable(response.status) && challenge === null && attempts < MAX_ATTEMPTS) {
          const retryAfterHeader = responseHeaders["retry-after"] ?? null;
          observed.push(
            retryAfterHeader === null
              ? `HTTP ${response.status}`
              : `HTTP ${response.status} Retry-After ${retryAfterHeader}`,
          );
          const retryAfterMs = parseRetryAfter(retryAfterHeader, now());
          await sleep(retryAfterMs ?? backoffDelayMs(attempts, random));
          continue;
        }
        if (isRetryable(response.status)) observed.push(`HTTP ${response.status}`);
        const blocked = challenge !== null || response.status === 403;
        const ok2xx = response.status >= 200 && response.status < 300;
        return finish({
          status: response.status,
          outcome: blocked ? "blocked" : "failed",
          blocked_reason: blocked ? (challenge !== null ? "challenge" : "http-403") : null,
          ...(challenge === null ? {} : { challenge_signal: challenge }),
          ...(!blocked && ok2xx ? { error: UNEXPECTED_HTML_DOWNLOAD } : {}),
          bytes: excerpt.byteLength,
          sha256: sha256(excerpt),
          body_bytes: bodyBytes,
          body_bytes_basis: refused.basis,
          ...(refused.contentLengthEncoded === undefined
            ? {}
            : { content_length_encoded: refused.contentLengthEncoded }),
          headers: responseHeaders,
          excerpt,
          path: null,
        });
      }

      // 2xx with a file body: stream it to <dest>.part, hashing as it arrives. A drop
      // part-way continues with Range requests when the source supports them (FR-003).
      return streamWithResumes(response, responseHeaders, guard);
    }
    throw new Error("source-client: download loop ended without a result");
  }

  return {
    capture<T = unknown>(request: CaptureRequest<T>): Promise<CaptureResult<T>> {
      return limiterFor(request.url)(() => captureUnlimited(request));
    },
    download(request: DownloadRequest): Promise<DownloadResult> {
      return limiterFor(request.url)(() => downloadUnlimited(request));
    },
  };
}

/** Why a 2xx body that fails its expected-format parse (and shows no challenge) stops. */
export const UNEXPECTED_BODY = "unexpected body: the 2xx response failed the expected-format check";
/** Why a 2xx text/html answer to a file download (without a challenge signal) stops. */
export const UNEXPECTED_HTML_DOWNLOAD =
  "unexpected body: a text/html page answered instead of the file";

function challengeOf(status: number, headers: Record<string, string>, body: Buffer): string | null {
  return detectChallengeSignal({ status, headers, body: body.toString("utf8") });
}

function parseBody<T>(
  schema: ZodType<T>,
  body: Buffer,
  kind: "json" | "text" = "json",
): { ok: true; value: T } | { ok: false } {
  const text = body.toString("utf8");
  let input: unknown = text;
  if (kind === "json") {
    try {
      input = JSON.parse(text) as unknown;
    } catch {
      return { ok: false };
    }
  }
  const result = schema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}
