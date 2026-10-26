// A-11 Run 3 (ERR-67): a fetch retry wrapper loaded into elephant-cli, which stays the uploader.
//
//   NODE_OPTIONS="--import tsx --import <abs path>/pipeline/publish/scripts/fetch-retry.ts"
//
// elephant-cli's tables upload sends one request per Parquet part and one dag/import, each a plain
// fetch with no retry, and on failure prints only "fetch failed" (the cause is discarded). On a
// slow, unstable uplink one stalled or reset request fails the whole attempt and the next attempt
// re-sends every part. This wrapper changes nothing in elephant-cli's logic or checks: for a
// request whose body can be sent again (none, string, bytes, Blob, FormData), it retries that one
// request on a network error, its own per-request timeout, or HTTP 429/5xx, with backoff, and logs
// the real cause to stderr. Requests that bring their own AbortSignal (elephant-cli's gateway
// polling, which already retries until its deadline) and streaming bodies pass through untouched.
// Never logs headers (the Filebase bearer token) or query values.
//
// Filebase answers a dag/import only after pinning the imported root. For a tables.car (a root that
// links every part) that took longer than Node's built-in 300 s wait for response headers on
// 2026-10-25, although the root was already served by the gateways. So the wrapper also raises
// that wait, through undici (the library Node's fetch is built on, same version as Node's own).

import { Agent, setGlobalDispatcher } from "undici";

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export interface RetryOptions {
  /** Total tries per request, including the first. */
  tries: number;
  /** Fixed part of the per-request timeout. */
  baseTimeoutMs: number;
  /** Floor for a Kubo `dag/import` (Filebase answers it only after pinning; see the header). */
  importTimeoutMs: number;
  /** Upload rate assumed for the size-based part of the timeout. */
  assumedBytesPerSecond: number;
  /** First backoff wait; doubles per retry, capped at maxBackoffMs. */
  firstBackoffMs: number;
  maxBackoffMs: number;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
}

export function defaultOptions(env: NodeJS.ProcessEnv = process.env): RetryOptions {
  const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    tries: num(env.FETCH_RETRY_TRIES, 6),
    baseTimeoutMs: num(env.FETCH_RETRY_BASE_TIMEOUT_MS, 120_000),
    importTimeoutMs: num(env.FETCH_RETRY_IMPORT_TIMEOUT_MS, 1_500_000),
    assumedBytesPerSecond: num(env.FETCH_RETRY_ASSUMED_BPS, 256 * 1024),
    firstBackoffMs: num(env.FETCH_RETRY_FIRST_BACKOFF_MS, 2_000),
    maxBackoffMs: num(env.FETCH_RETRY_MAX_BACKOFF_MS, 60_000),
    log: (line) => process.stderr.write(`${line}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** Byte size of a body that can be sent again, or null when it cannot (a stream, for example). */
export function replayableSize(body: FetchInit["body"]): number | null {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof FormData) {
    let total = 0;
    for (const [, value] of body.entries()) {
      total += typeof value === "string" ? Buffer.byteLength(value) : value.size;
    }
    return total;
  }
  return null;
}

/** "TypeError UND_ERR_HEADERS_TIMEOUT: fetch failed" style, from the error and its cause. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code: unknown }).code)
      : "";
  const causeMessage = cause instanceof Error ? ` (${cause.message})` : "";
  return `${error.name}${code ? ` ${code}` : ""}: ${error.message}${causeMessage}`;
}

function where(input: FetchInput, method: string): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw);
    return `${method} ${url.host}${url.pathname}`;
  } catch {
    return method;
  }
}

/** Wraps a fetch so one failed request is retried on its own; see the header. */
export function withRetry(original: typeof fetch, options: RetryOptions): typeof fetch {
  return async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const request = init ?? {};
    const size = replayableSize(request.body);
    if (request.signal || size === null || input instanceof Request) return original(input, init);
    const method = (request.method ?? "GET").toUpperCase();
    const label = where(input, method);
    const sized = options.baseTimeoutMs + Math.ceil((size / options.assumedBytesPerSecond) * 1000);
    const timeoutMs = label.endsWith("/api/v0/dag/import")
      ? Math.max(sized, options.importTimeoutMs)
      : sized;
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;
      const backoff = Math.min(options.maxBackoffMs, options.firstBackoffMs * 2 ** (attempt - 1));
      try {
        const response = await original(input, {
          ...request,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!RETRY_STATUS.has(response.status) || attempt >= options.tries) return response;
        await response.body?.cancel();
        options.log(
          `[fetch-retry] ${label} try ${attempt}/${options.tries} answered HTTP ${response.status} after ${elapsed()}; waiting ${backoff / 1000}s`,
        );
      } catch (error) {
        const what = describeError(error);
        if (attempt >= options.tries) {
          options.log(
            `[fetch-retry] ${label} failed after ${attempt} tries (last: ${what} after ${elapsed()})`,
          );
          throw error;
        }
        options.log(
          `[fetch-retry] ${label} try ${attempt}/${options.tries} failed after ${elapsed()}: ${what}; waiting ${backoff / 1000}s`,
        );
      }
      await options.sleep(backoff);
    }
  };
}

/**
 * Raises Node's built-in waits for response headers and body (300 s each by default) so a slow
 * dag/import reply is not cut off; the per-request timeout above stays the real limit.
 */
export function installLongWaits(env: NodeJS.ProcessEnv = process.env): Agent {
  const parsed = Number(env.FETCH_RETRY_HEADERS_TIMEOUT_MS);
  const wait = Number.isFinite(parsed) && parsed > 0 ? parsed : 1_800_000;
  const agent = new Agent({ headersTimeout: wait, bodyTimeout: wait });
  setGlobalDispatcher(agent);
  return agent;
}

// Installed when loaded with --import; importing it from a test does not patch the global fetch.
if (process.env.FETCH_RETRY_DISABLE !== "1" && process.env.VITEST === undefined) {
  installLongWaits();
  globalThis.fetch = withRetry(globalThis.fetch.bind(globalThis), defaultOptions());
}
