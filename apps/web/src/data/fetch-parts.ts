// Table parts read up front, in parallel (A-03 ERR-15, ERR-16, ERR-17). DuckDB-WASM reads remote
// files with synchronous XHRs from its worker: four strictly sequential requests per part (HEAD,
// GET 0-0, HEAD 0-, GET 0-n), 84 round trips for the 21 pilot parts. That serial chain was most
// of the hosted first load (ERR-17), never finished when each copy request took 2 s (TC-024,
// ERR-16), and burst the Filebase gateway into HTTP 429 answers without CORS headers, which the
// browser reports as `net::ERR_FAILED` (ERR-15). Here the page reads each part once with a
// ranged GET (`Range: bytes=0-{size-1}` → 206, TC-026), at most PART_CONCURRENCY at a time, from
// the host that served the manifest (`read.partUrl`: one probe decides the host for the whole
// load, D-2), retries a throttled or dropped request with backoff, accepts the bytes only when
// their SHA-256 equals the one the manifest records for the part (the manifest itself is
// CID-verified, so its hashes are trusted: constitution A3 as amended by PO decision 2026-10-24;
// a part above 256 KiB has a UnixFS DAG CID that rawCid cannot recompute), and hands them to the
// engine as registered files. A run whose parts total more than PART_PREFETCH_MAX_BYTES is not prefetched:
// the engine range-reads those parts over HTTP itself (ADR-0001 decision 4 flags).
import type { RunManifestV1 } from "@countylens/contract";
import type { FetchByCidResult, ReadSource } from "./fetch-by-cid";
import { browserFetch, throwIfAborted } from "./http";

/** Above this total the parts stay remote and DuckDB range-reads them (ADR-0001). */
export const PART_PREFETCH_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Parallel part reads per host kind. The copy is CloudFront over HTTP/2. The public Filebase
 * gateway is rate-limited per client IP (measured 2026-10-21: a burst of about 50 requests, then
 * about 2 per second, each excess request answered 429 without CORS headers), so it gets few.
 */
export const PART_CONCURRENCY: Readonly<Record<ReadSource["kind"], number>> = Object.freeze({
  copy: 16,
  fallback: 3,
});

/**
 * Waits before each retry of a throttled (429), failing (5xx) or dropped (network) part read:
 * 15 s in all, long enough for the gateway's bucket to refill the parts of one load.
 */
export const PART_RETRY_DELAYS_MS: readonly number[] = Object.freeze([1000, 2000, 4000, 8000]);

export interface PartToFetch {
  readonly name: string;
  readonly cid: string;
  readonly size: number;
  /** The part's SHA-256 (64 lowercase hex characters) as the CID-verified manifest records it. */
  readonly sha256: string;
}

export interface FetchedPart extends PartToFetch {
  readonly bytes: Uint8Array;
}

/** A part could not be read from the load's host (after the retries), or its bytes were wrong. */
export class PartReadError extends Error {
  override readonly name = "PartReadError";

  constructor(
    readonly part: PartToFetch,
    readonly host: string,
    detail: string,
    options?: { readonly cause?: unknown },
  ) {
    super(
      `Table part ${part.name} (${part.cid}) could not be read from ${host}: ${detail}`,
      options,
    );
  }
}

/**
 * The table parts of a manifest, or null when they are too large to read up front. `only` limits
 * the parts (and so the size total) to those names: the parts the bind will read, not the whole run.
 */
export function partsToPrefetch(
  manifest: Pick<RunManifestV1, "artifacts">,
  maxBytes: number = PART_PREFETCH_MAX_BYTES,
  only?: ReadonlySet<string>,
): PartToFetch[] | null {
  const parts = manifest.artifacts
    .filter(
      (artifact) => artifact.kind === "table" && (only === undefined || only.has(artifact.name)),
    )
    .map(({ name, cid, size, sha256 }) => ({ name, cid, size, sha256 }));
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return total > maxBytes ? null : parts;
}

/** `Range: bytes=0-{size-1}`: the whole part as one 206 (TC-026); an empty part asks for no range. */
export function partRangeHeader(size: number): Record<string, string> {
  return size > 0 ? { Range: `bytes=0-${size - 1}` } : {};
}

export interface FetchPartsOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly retryDelaysMs?: readonly number[];
  readonly concurrency?: number;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

const sleepFor = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });

/** A non-2xx answer worth retrying: throttled or a server error. */
const retryableStatus = (status: number): boolean => status === 429 || status >= 500;

class RetryableReadError extends Error {
  override readonly name = "RetryableReadError";
}

/** Lowercase hex SHA-256 of `bytes` (Web Crypto: Node and the browser). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readOnce(
  part: PartToFetch,
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  host: string,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: partRangeHeader(part.size),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    throwIfAborted(signal);
    // A 429 without CORS headers surfaces here as a TypeError (ERR-15): retry it.
    throw new RetryableReadError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  if (response.status !== 206 && response.status !== 200) {
    const detail = `HTTP ${response.status}`;
    if (retryableStatus(response.status)) throw new RetryableReadError(detail);
    throw new PartReadError(part, host, detail);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== part.size) {
    throw new PartReadError(part, host, `${bytes.length} bytes, the manifest says ${part.size}`);
  }
  const actual = await sha256Hex(bytes);
  if (actual !== part.sha256) {
    throw new PartReadError(
      part,
      host,
      `bytes hash to sha256 ${actual}, the manifest says ${part.sha256}`,
    );
  }
  return bytes;
}

async function readPart(
  part: PartToFetch,
  read: Pick<FetchByCidResult, "source" | "partUrl">,
  fetchImpl: typeof fetch,
  options: FetchPartsOptions,
): Promise<FetchedPart> {
  const delays = options.retryDelaysMs ?? PART_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepFor;
  const url = read.partUrl(part);
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return {
        ...part,
        bytes: await readOnce(part, url, fetchImpl, options.signal, read.source.host),
      };
    } catch (error) {
      if (!(error instanceof RetryableReadError)) throw error;
      const delay = delays[attempt];
      if (delay === undefined) {
        throw new PartReadError(part, read.source.host, error.message, { cause: error });
      }
      await sleep(delay, options.signal);
    }
  }
}

/**
 * Reads every part from the host that served the manifest, at most `concurrency` at a time,
 * and returns them in input order. Throws PartReadError (or the caller's abort reason).
 */
export async function fetchParts(
  parts: readonly PartToFetch[],
  read: Pick<FetchByCidResult, "source" | "partUrl">,
  options: FetchPartsOptions = {},
): Promise<FetchedPart[]> {
  const fetchImpl = options.fetch ?? browserFetch;
  const limit = Math.max(1, options.concurrency ?? PART_CONCURRENCY[read.source.kind]);
  const results: FetchedPart[] = new Array<FetchedPart>(parts.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < parts.length) {
      const index = next;
      next += 1;
      const part = parts[index] as PartToFetch;
      try {
        results[index] = await readPart(part, read, fetchImpl, options);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, parts.length) }, worker));
  return results;
}

/** The engine-side file name a prefetched part is registered under (no host, no network). */
export function registeredPartName(part: { readonly cid: string }): string {
  return `countylens-part-${part.cid}.parquet`;
}
