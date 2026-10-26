// Read one published artifact by CID (A-03 T042, G-C3; interface fixed by T007 for T054): the
// CID copy first, then the Filebase gateway as the labelled fallback (research R-01; data-model
// § FetchByCid state; PO decision D-2). The fallback triggers on a network error, a non-200 or
// no first byte within FIRST_BYTE_TIMEOUT_MS, judged per request; a 429 on the fallback is a
// non-200 (Error state). The host that served the manifest is the host `partUrl` binds for the
// table parts, so one load never mixes hosts. Bytes are accepted only when their raw-leaves CID
// equals the requested one (constitution A3); only the manifest is read this way (one chunk, so
// a manifest above 256 KiB would not verify). Table parts are verified by the SHA-256 the
// manifest records (./fetch-parts) or range-read by the engine through `partUrl`. Browser-safe:
// hosts come in through `urls`; nothing here reads the environment.
import { rawCid } from "@countylens/query-core";
import { VERIFY_TEXTS, type ReadPathUrls } from "@countylens/shared";
import { browserFetch, throwIfAborted } from "./http";

/** D-2: the copy must deliver a first byte within 4 s or the read falls back. */
export const FIRST_BYTE_TIMEOUT_MS = 4000;

/** plan § "Fixed texts": the error-banner text when neither host served the bytes (TC-032 step 5). */
export const BOTH_HOSTS_DOWN_TEXT =
  "Data could not be reached from the CID copy or the Filebase gateway";

/** Which host served a read; `fallback` carries the configured FILEBASE_GATEWAY_HOST for the label. */
export type ReadSource =
  | { readonly kind: "copy"; readonly host: string }
  | { readonly kind: "fallback"; readonly host: string };

/** A manifest table part, as `bindManifest`'s `partUrl` receives it. */
export interface PartArtifact {
  readonly name: string;
  readonly cid: string;
}

export interface FetchByCidOptions {
  /** `readPathUrls(...)` bound to the validated VITE_* hosts. */
  readonly urls: ReadPathUrls;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Defaults to FIRST_BYTE_TIMEOUT_MS. */
  readonly firstByteTimeoutMs?: number;
}

export interface FetchByCidResult {
  readonly cid: string;
  readonly bytes: Uint8Array;
  readonly source: ReadSource;
  /** Binds every table part to the host that served this artifact (no mixed reads in one load). */
  readonly partUrl: (artifact: PartArtifact) => string;
}

/** Both hosts failed: the page shows BOTH_HOSTS_DOWN_TEXT in the error banner. */
export class BothHostsDownError extends Error {
  override readonly name = "BothHostsDownError";

  constructor(
    readonly cid: string,
    options?: { readonly cause?: unknown },
  ) {
    super(BOTH_HOSTS_DOWN_TEXT, options);
  }
}

/** The bytes a host returned do not hash to the requested CID (rejected, never shown). */
export class CidMismatchError extends Error {
  override readonly name = "CidMismatchError";

  constructor(
    readonly expected: string,
    readonly actual: string,
    readonly source: ReadSource,
  ) {
    super(`CID mismatch from ${source.host}: expected ${expected}, got ${actual}`);
  }
}

/** A host answered, but not with 200 (a 429 or 5xx included). */
class HttpStatusError extends Error {
  override readonly name = "HttpStatusError";

  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} answered ${status}`);
  }
}

/** No first byte within the timeout (headers late, or a body that never starts). */
class FirstByteTimeoutError extends Error {
  override readonly name = "FirstByteTimeoutError";

  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(`${url} delivered no first byte within ${timeoutMs} ms`);
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * GET `url` and return its bytes. With a timeout, the first byte (headers and the first body
 * chunk) must arrive within `firstByteTimeoutMs` of the request start; later bytes are not
 * timed (D-2 judges reachability, not throughput). The caller's `signal` aborts at any point.
 * Throws HttpStatusError, FirstByteTimeoutError, the fetch's own error, or the abort reason.
 */
async function readArtifact(
  url: string,
  fetchImpl: typeof fetch,
  firstByteTimeoutMs: number | null,
  outer: AbortSignal | undefined,
): Promise<Uint8Array> {
  throwIfAborted(outer);
  const controller = new AbortController();
  const abortFromOuter = (): void => controller.abort(outer?.reason);
  outer?.addEventListener("abort", abortFromOuter, { once: true });

  // Settles only on abort (timeout or the caller); raced against every await below so a stalled
  // fetch or body read is released even when the fetch implementation ignores the signal.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  aborted.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (firstByteTimeoutMs !== null) {
    timer = setTimeout(() => {
      controller.abort(new FirstByteTimeoutError(url, firstByteTimeoutMs));
    }, firstByteTimeoutMs);
  }
  const firstByteArrived = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal }), aborted]);
    if (response.status !== 200) throw new HttpStatusError(url, response.status);
    const body = response.body;
    if (body === null) {
      const buffer = await Promise.race([response.arrayBuffer(), aborted]);
      firstByteArrived();
      return new Uint8Array(buffer);
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), aborted]);
        firstByteArrived();
        if (next.done) break;
        chunks.push(next.value);
      }
    } catch (error) {
      reader.cancel().catch(() => undefined);
      throw error;
    }
    return concat(chunks);
  } finally {
    firstByteArrived();
    outer?.removeEventListener("abort", abortFromOuter);
  }
}

async function verified(
  cid: string,
  bytes: Uint8Array,
  source: ReadSource,
  urls: ReadPathUrls,
): Promise<FetchByCidResult> {
  const actual = await rawCid(bytes);
  if (actual !== cid) throw new CidMismatchError(cid, actual, source);
  const partUrl =
    source.kind === "copy"
      ? (artifact: PartArtifact): string => urls.copyUrl(artifact.cid)
      : (artifact: PartArtifact): string => urls.gatewayUrl(artifact.cid, "filebase");
  return { cid, bytes, source, partUrl };
}

export async function fetchByCid(
  cid: string,
  options: FetchByCidOptions,
): Promise<FetchByCidResult> {
  const { urls, signal } = options;
  const fetchImpl = options.fetch ?? browserFetch;
  const firstByteTimeoutMs = options.firstByteTimeoutMs ?? FIRST_BYTE_TIMEOUT_MS;

  const copyUrl = urls.copyUrl(cid);
  const copy: ReadSource = { kind: "copy", host: new URL(copyUrl).host };
  let copyFailure: unknown;
  try {
    const bytes = await readArtifact(copyUrl, fetchImpl, firstByteTimeoutMs, signal);
    return await verified(cid, bytes, copy, urls);
  } catch (error) {
    if (error instanceof CidMismatchError || isAborted(signal)) throw error;
    copyFailure = error;
  }

  const fallback: ReadSource = { kind: "fallback", host: urls.gatewayHost("filebase") };
  try {
    const bytes = await readArtifact(urls.gatewayUrl(cid, "filebase"), fetchImpl, null, signal);
    return await verified(cid, bytes, fallback, urls);
  } catch (error) {
    if (error instanceof CidMismatchError || isAborted(signal)) throw error;
    throw new BothHostsDownError(cid, { cause: { copy: copyFailure, fallback: error } });
  }
}

/** Read at call time: the caller's abort is theirs to report, never "both hosts down". */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/** `fallback · {host}` for a fallback read (TC-032…034), `null` when the copy served it. */
export function fallbackLabel(source: ReadSource): string | null {
  return source.kind === "fallback" ? VERIFY_TEXTS.fallback(source.host) : null;
}
