// FR-003 (PO decision 2026-10-20): a TCAD export download that drops part-way continues
// from the last byte with an HTTP Range request when the source advertises
// `Accept-Ranges: bytes`; at most 5 resumes, same identity, inside the same 2-hour limit.
// SYNTHETIC TEST FIXTURE (test-only): an in-process fake server that serves an invented
// payload and breaks its streams at scripted byte offsets. No real source is called.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXCERPT_BYTES,
  MAX_RESUMES,
  USER_AGENT,
  createSourceClient,
  type FetchLike,
} from "../travis/lib/source-client.js";
import { missingReason } from "../travis/discovery/probes/common.js";
import { must } from "./helpers.js";

const silent = (): void => undefined;
const FIXED = new Date("2026-01-01T00:00:00.000Z");
const CHUNK = 1024;

/** Deterministic invented bytes. */
function payloadOf(length: number): Buffer {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + 7) % 251;
  return out;
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface ServerPlan {
  payload: Buffer;
  /** Byte offset where response N's stream breaks (absolute); missing = serve to the end. */
  dropAt: number[];
  acceptRanges?: boolean;
  /** Status answered to a Range request (default 206). */
  resumeStatus?: number;
  /** ETag of response N (default the same strong ETag for all). */
  etagFor?: (n: number) => string;
  /** Override the Content-Range of a 206 answer. */
  contentRangeFor?: (start: number, total: number) => string;
  /** Delay (ms) before response N's stream breaks or ends. */
  breakDelayMs?: (n: number) => number;
  /** Response N never ends: it trickles one byte every `trickleMs` until cancelled. */
  trickleFrom?: number;
  trickleMs?: number;
}

interface Recorded {
  headers: Record<string, string>;
}

function headersOf(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

function fakeServer(plan: ServerPlan): { fetch: FetchLike; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const total = plan.payload.byteLength;
  const fetch: FetchLike = async (_url, init) => {
    const n = requests.length;
    const headers = headersOf(init);
    requests.push({ headers });
    const range = /^bytes=(\d+)-$/.exec(headers.range ?? "");
    const ranged = range !== null && (plan.resumeStatus ?? 206) === 206;
    const start = ranged ? Number(must(range)[1]) : 0;
    const end = Math.min(plan.dropAt[n] ?? total, total);
    const etag = plan.etagFor ? plan.etagFor(n) : '"v1"';
    const responseHeaders: Record<string, string> = {
      "content-type": "application/zip",
      "content-length": String(total - start),
      etag,
      "last-modified": "Mon, 19 Oct 2026 00:00:00 GMT",
    };
    if (plan.acceptRanges !== false) responseHeaders["accept-ranges"] = "bytes";
    if (ranged) {
      responseHeaders["content-range"] = plan.contentRangeFor
        ? plan.contentRangeFor(start, total)
        : `bytes ${start}-${total - 1}/${total}`;
    }
    let pos = start;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trickle = plan.trickleFrom !== undefined && n >= plan.trickleFrom;
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (trickle) {
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, plan.trickleMs ?? 100);
          });
          controller.enqueue(new Uint8Array([plan.payload[pos % total] ?? 0]));
          pos += 1;
          return;
        }
        if (pos < end) {
          const next = Math.min(end, pos + CHUNK);
          controller.enqueue(new Uint8Array(plan.payload.subarray(pos, next)));
          pos = next;
          return;
        }
        const delay = plan.breakDelayMs ? plan.breakDelayMs(n) : 0;
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, delay);
          });
        }
        if (end < total) controller.error(new TypeError("terminated"));
        else controller.close();
      },
      cancel: () => {
        clearTimeout(timer);
      },
    });
    return new Response(stream, {
      status: ranged ? 206 : 200,
      headers: responseHeaders,
    });
  };
  return { fetch, requests };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "resume-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function download(
  fetch: FetchLike,
  dir: string,
  limits = { inactivityMs: 60_000, totalMs: 120_000 },
) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  }).download({
    url: "https://traviscad.test/export.zip",
    destPath: join(dir, "export.zip"),
    ...limits,
  });
}

describe("FR-003 range resume of a broken TCAD export download", () => {
  it("allows at most 5 resumes", () => {
    expect(MAX_RESUMES).toBe(5);
  });

  it("one drop + 206 resume: ok with the full size and the SHA-256 of the whole file", async () => {
    const payload = payloadOf(10_000);
    const dir = tempDir();
    const server = fakeServer({ payload, dropAt: [4_096] });
    const dl = await download(server.fetch, dir);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.headers.range).toBe("bytes=4096-");
    expect(dl.receipt).toMatchObject({
      status: 200,
      outcome: "ok",
      bytes: 10_000,
      sha256: sha(payload),
      resumes: 1,
      attempts: 1,
    });
    expect(dl.receipt.incomplete_body).toBeUndefined();
    expect(dl.path).toBe(join(dir, "export.zip"));
    expect(sha(readFileSync(must(dl.path)))).toBe(sha(payload));
    expect(existsSync(join(dir, "export.zip.part"))).toBe(false);
  });

  it("a download without a drop records resumes: 0", async () => {
    const payload = payloadOf(5_000);
    const server = fakeServer({ payload, dropAt: [] });
    const dl = await download(server.fetch, tempDir());
    expect(server.requests).toHaveLength(1);
    expect(dl.receipt).toMatchObject({ outcome: "ok", bytes: 5_000, resumes: 0 });
  });

  it("five drops (five resumes) still give ok", async () => {
    const payload = payloadOf(12_000);
    const server = fakeServer({ payload, dropAt: [1_000, 3_000, 5_000, 7_000, 9_000] });
    const dl = await download(server.fetch, tempDir());
    expect(server.requests).toHaveLength(6);
    expect(server.requests.slice(1).map((r) => r.headers.range)).toEqual([
      "bytes=1000-",
      "bytes=3000-",
      "bytes=5000-",
      "bytes=7000-",
      "bytes=9000-",
    ]);
    expect(dl.receipt).toMatchObject({
      outcome: "ok",
      bytes: 12_000,
      sha256: sha(payload),
      resumes: 5,
    });
  });

  it("a sixth drop is failed with incomplete_body and no seventh request", async () => {
    const payload = payloadOf(12_000);
    const dir = tempDir();
    const server = fakeServer({
      payload,
      dropAt: [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000],
    });
    const dl = await download(server.fetch, dir);
    expect(server.requests).toHaveLength(6);
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip.part"))).toBe(false);
    expect(dl.receipt).toMatchObject({
      status: 200,
      outcome: "failed",
      blocked_reason: null,
      timeout_ms: null,
      resumes: 5,
      bytes: 6_000,
    });
    expect(dl.receipt.incomplete_body).toEqual({ bytes: 6_000, content_length: 12_000 });
    expect(missingReason(dl.receipt)).toMatch(/broke at 6000 of 12000 bytes/);
    expect(missingReason(dl.receipt)).toMatch(/5 range resume/);
  });

  it("no Accept-Ranges: failed as before, with no resume request", async () => {
    const payload = payloadOf(10_000);
    const server = fakeServer({ payload, dropAt: [4_096], acceptRanges: false });
    const dl = await download(server.fetch, tempDir());
    expect(server.requests).toHaveLength(1);
    expect(dl.receipt).toMatchObject({ outcome: "failed", resumes: 0, error: "terminated" });
    expect(dl.receipt.incomplete_body).toEqual({ bytes: 4_096, content_length: 10_000 });
  });

  it("HTTP 200 instead of 206 on the resume: failed, nothing appended", async () => {
    const payload = payloadOf(10_000);
    const dir = tempDir();
    const server = fakeServer({ payload, dropAt: [4_096], resumeStatus: 200 });
    const dl = await download(server.fetch, dir);
    expect(server.requests).toHaveLength(2);
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip.part"))).toBe(false);
    expect(dl.receipt).toMatchObject({ outcome: "failed", status: 200, resumes: 1 });
    expect(dl.receipt.error).toMatch(/206/);
    expect(dl.receipt.incomplete_body).toEqual({ bytes: 4_096, content_length: 10_000 });
  });

  it("a changed ETag between attempts: failed", async () => {
    const payload = payloadOf(10_000);
    const server = fakeServer({
      payload,
      dropAt: [4_096],
      etagFor: (n) => (n === 0 ? '"v1"' : '"v2"'),
    });
    const dl = await download(server.fetch, tempDir());
    expect(dl.receipt).toMatchObject({ outcome: "failed", resumes: 1 });
    expect(dl.receipt.error).toMatch(/etag/i);
    expect(dl.receipt.incomplete_body).toEqual({ bytes: 4_096, content_length: 10_000 });
  });

  it("a Content-Range that does not start at the last byte or names another length: failed", async () => {
    const payload = payloadOf(10_000);
    const server = fakeServer({
      payload,
      dropAt: [4_096],
      contentRangeFor: (start, total) => `bytes ${start}-${total - 1}/${total + 1}`,
    });
    const dl = await download(server.fetch, tempDir());
    expect(dl.receipt).toMatchObject({ outcome: "failed", resumes: 1 });
    expect(dl.receipt.error).toMatch(/content-range/i);
  });

  it("every resume request carries the same User-Agent and Accept", async () => {
    const payload = payloadOf(8_000);
    const server = fakeServer({ payload, dropAt: [2_000, 5_000] });
    await download(server.fetch, tempDir());
    expect(server.requests).toHaveLength(3);
    for (const r of server.requests) {
      expect(r.headers["user-agent"]).toBe(USER_AGENT);
      expect(r.headers.accept).toBe("*/*");
    }
  });

  it("the 2-hour total limit spans all resumes: blocked timeout, no further resume", async () => {
    // Only timers and Date are faked: the .part file is real I/O, so setImmediate stays
    // real and is used below to let file callbacks finish between timer steps.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const payload = payloadOf(10_000);
    const dir = tempDir();
    // the first stream breaks after 600 ms; the resumed stream trickles forever
    const server = fakeServer({
      payload,
      dropAt: [2_000],
      breakDelayMs: (n) => (n === 0 ? 600 : 0),
      trickleFrom: 1,
      trickleMs: 100,
    });
    const pending = createSourceClient({
      fetch: server.fetch,
      log: silent,
      clock: () => Date.now(),
    }).download({
      url: "https://traviscad.test/export.zip",
      destPath: join(dir, "export.zip"),
      inactivityMs: 10_000,
      totalMs: 1_000,
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    // ERR-8: the .part writes are real I/O, so a slow CI disk needs more turns between fake
    // timer steps; the loop stops as soon as the download settles, and every asserted time
    // comes from the fake clock, so a larger budget does not change what is tested.
    for (let step = 0; step < 400 && !settled; step += 1) {
      await vi.advanceTimersByTimeAsync(50);
      for (let turn = 0; turn < 3; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    expect(settled).toBe(true);
    const dl = await pending;
    expect(server.requests).toHaveLength(2);
    expect(dl.receipt).toMatchObject({ outcome: "blocked", blocked_reason: "timeout", resumes: 1 });
    // a total limit restarted per request would fire at ~1,600 ms (600 + 1,000)
    expect(must(dl.receipt.timeout_ms)).toBeGreaterThanOrEqual(1_000);
    expect(must(dl.receipt.timeout_ms)).toBeLessThan(1_200);
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip.part"))).toBe(false);
  });

  it("a 403 on a resume request stops as blocked (no further resume)", async () => {
    const payload = payloadOf(10_000);
    let n = 0;
    const base = fakeServer({ payload, dropAt: [4_096] });
    const fetch: FetchLike = async (url, init) => {
      n += 1;
      if (n === 2) return new Response("forbidden", { status: 403 });
      return base.fetch(url, init);
    };
    const dl = await download(fetch, tempDir());
    expect(n).toBe(2);
    expect(dl.receipt).toMatchObject({
      outcome: "blocked",
      blocked_reason: "http-403",
      status: 403,
      resumes: 1,
    });
  });
});

/** A body that never ends: 16 KiB chunks for as long as it is read; counts what was pulled. */
function endlessBody(): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const chunk = new Uint8Array(16 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulled: () => pulled };
}

describe("CR-1, CR-2, CR-6: bounded refusals, write errors and the final size check", () => {
  it("CR-1: a full 200 answer to a resume is never buffered; only a bounded excerpt is read", async () => {
    const payload = payloadOf(10_000);
    const base = fakeServer({ payload, dropAt: [4_096] });
    const endless = endlessBody();
    let n = 0;
    const fetch: FetchLike = async (url, init) => {
      n += 1;
      if (n === 2) {
        // a "3.5 GB" whole file instead of 206 Partial Content
        return new Response(endless.stream, {
          status: 200,
          headers: { "content-type": "application/zip", "content-length": "3554021795" },
        });
      }
      return base.fetch(url, init);
    };
    const dir = tempDir();
    const dl = await download(fetch, dir);
    expect(n).toBe(2);
    expect(endless.pulled()).toBeLessThanOrEqual(EXCERPT_BYTES + 64 * 1024);
    expect(dl.receipt).toMatchObject({ outcome: "failed", status: 200, resumes: 1 });
    expect(dl.receipt.error).toMatch(/instead of 206/);
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip.part"))).toBe(false);
  });

  it("CR-1: a refused first answer with a huge body keeps a bounded excerpt and the advertised size", async () => {
    const endless = endlessBody();
    const fetch: FetchLike = async () =>
      new Response(endless.stream, {
        status: 404,
        headers: { "content-type": "text/html", "content-length": "999999999" },
      });
    const dl = await download(fetch, tempDir());
    expect(endless.pulled()).toBeLessThanOrEqual(EXCERPT_BYTES + 64 * 1024);
    expect(dl.receipt.outcome).toBe("failed");
    expect(dl.receipt.bytes).toBe(EXCERPT_BYTES);
    expect(dl.receipt.stop_evidence?.body_bytes).toBe(999_999_999);
    expect(dl.excerpt.byteLength).toBe(EXCERPT_BYTES);
  });

  it("CR-2: a .part write error (EISDIR) gives a failed receipt, no crash, no hang, no resume", async () => {
    const payload = payloadOf(200_000);
    const dir = tempDir();
    mkdirSync(join(dir, "export.zip.part"));
    const server = fakeServer({ payload, dropAt: [] });
    const dl = await download(server.fetch, dir);
    expect(server.requests).toHaveLength(1);
    expect(dl.receipt.outcome).toBe("failed");
    expect(dl.receipt.error).toMatch(/writing the \.part file failed: EISDIR/);
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip"))).toBe(false);
    // the directory that stood in the way is not deleted
    expect(statSync(join(dir, "export.zip.part")).isDirectory()).toBe(true);
  });

  it("CR2-2: a .part stream that fails while a read is pending gives a failed receipt, no hang", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "export.zip.part"));
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array(payloadOf(1_024)));
          return;
        }
        // the .part open (EISDIR) fails while this read is pending; then a chunk larger
        // than the stream's buffer arrives, so write() answers false on a closed stream
        await new Promise((resolve) => setTimeout(resolve, 150));
        controller.enqueue(new Uint8Array(payloadOf(256 * 1_024)));
      },
    });
    const fetch: FetchLike = async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/zip", "accept-ranges": "bytes" },
      });
    const dl = await download(fetch, dir);
    expect(dl.receipt.outcome).toBe("failed");
    expect(dl.receipt.error).toMatch(/writing the \.part file failed: EISDIR/);
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip"))).toBe(false);
  }, 5_000);

  it("CR-6: a first download that ends short without an error is failed and keeps its .part", async () => {
    const payload = payloadOf(10_000);
    const fetch: FetchLike = async () =>
      new Response(new Uint8Array(payload.subarray(0, 4_096)), {
        status: 200,
        // advertised 10,000 bytes, only 4,096 sent, then a clean end of stream
        headers: { "content-type": "application/zip", "content-length": "10000" },
      });
    const dir = tempDir();
    const dl = await download(fetch, dir);
    expect(dl.receipt).toMatchObject({ outcome: "failed", status: 200, resumes: 0, bytes: 4_096 });
    expect(dl.receipt.error).toMatch(/does not equal the advertised length 10000/);
    expect(dl.receipt.incomplete_body).toEqual({ bytes: 4_096, content_length: 10_000 });
    expect(dl.path).toBeNull();
    expect(existsSync(join(dir, "export.zip"))).toBe(false);
    expect(statSync(join(dir, "export.zip.part")).size).toBe(4_096);
  });
});
