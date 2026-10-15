import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { log } from "./log.js";

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly bodySnippet: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export type FetchOptions = {
  userAgent: string;
  timeoutMs: number;
  headers?: Record<string, string>;
  retries?: number;
  baseDelayMs?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(url: string, opts: FetchOptions, fn: () => Promise<T>): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 1500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const retryable =
        err instanceof HttpError
          ? err.retryable
          : !(err instanceof TypeError && /Invalid URL/.test(err.message));
      if (!retryable || attempt >= retries) throw err;
      const delay = base * 2 ** attempt + Math.floor(Math.random() * base);
      log.warn("http_retry", { url, attempt: attempt + 1, delayMs: delay, error: String(err) });
      await sleep(delay);
      attempt++;
    }
  }
}

function buildHeaders(opts: FetchOptions): Record<string, string> {
  return { "user-agent": opts.userAgent, accept: "*/*", ...opts.headers };
}

export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<T> {
  return withRetry(url, opts, async () => {
    const res = await fetch(url, {
      headers: buildHeaders(opts),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) throw new HttpError(url, res.status, (await res.text()).slice(0, 300));
    return (await res.json()) as T;
  });
}

export type DownloadResult = {
  url: string;
  filePath: string;
  bytes: number;
  sha256: string;
  status: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
};

export async function downloadToFile(
  url: string,
  filePath: string,
  opts: FetchOptions,
): Promise<DownloadResult> {
  await mkdir(path.dirname(filePath), { recursive: true });
  return withRetry(url, opts, async () => {
    const fetchedAt = new Date().toISOString();
    const res = await fetch(url, {
      headers: buildHeaders(opts),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok || !res.body)
      throw new HttpError(url, res.status, res.body ? (await res.text()).slice(0, 300) : "");
    const hash = createHash("sha256");
    let bytes = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        cb(null, chunk);
      },
    });
    const tmp = `${filePath}.part`;
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      tap,
      createWriteStream(tmp),
    );
    await rename(tmp, filePath);
    return {
      url,
      filePath,
      bytes,
      sha256: hash.digest("hex"),
      status: res.status,
      contentType: res.headers.get("content-type"),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      fetchedAt,
    };
  });
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
