// ERR-67: the fetch retry wrapper loaded into elephant-cli. Local HTTP server only.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeError,
  installLongWaits,
  replayableSize,
  withRetry,
  type RetryOptions,
} from "../scripts/fetch-retry.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer, hit: number) => void;

let server: Server | undefined;

async function serve(
  handler: Handler,
): Promise<{ url: string; hits: () => number; bodies: number[] }> {
  let hits = 0;
  const bodies: number[] = [];
  const created = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      hits += 1;
      const body = Buffer.concat(chunks);
      bodies.push(body.length);
      handler(req, res, body, hits);
    });
  });
  server = created;
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  const { port } = created.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/v0/add?pin=true`, hits: () => hits, bodies };
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function options(logs: string[], over: Partial<RetryOptions> = {}): RetryOptions {
  return {
    tries: 4,
    baseTimeoutMs: 2_000,
    importTimeoutMs: 2_000,
    assumedBytesPerSecond: 1_000_000_000,
    firstBackoffMs: 1,
    maxBackoffMs: 5,
    log: (line) => logs.push(line),
    sleep: async () => undefined,
    ...over,
  };
}

function form(): FormData {
  const f = new FormData();
  f.append("file", new Blob([Buffer.alloc(1000, 7)]), "part-00000.parquet");
  return f;
}

describe("fetch retry wrapper (ERR-67)", () => {
  it("retries 503 twice, then succeeds, sending the same FormData body each time", async () => {
    const s = await serve((_req, res, _body, hit) => {
      res.statusCode = hit <= 2 ? 503 : 200;
      res.end(hit <= 2 ? "busy" : '{"Hash":"x"}');
    });
    const logs: string[] = [];
    const fetchR = withRetry(fetch, options(logs));
    const res = await fetchR(s.url, {
      method: "POST",
      headers: { Authorization: "Bearer SECRET-TOKEN" },
      body: form(),
    });
    expect(res.status).toBe(200);
    expect(s.hits()).toBe(3);
    expect(new Set(s.bodies).size).toBe(1);
    expect(s.bodies[0]).toBeGreaterThan(1000);
    expect(logs.filter((l) => l.includes("HTTP 503"))).toHaveLength(2);
    expect(logs.join("\n")).not.toContain("SECRET-TOKEN");
    expect(logs.join("\n")).not.toContain("pin=true");
  });

  it("retries a reset connection and logs the cause", async () => {
    const s = await serve((req, res, _body, hit) => {
      if (hit === 1) {
        req.socket.destroy();
        return;
      }
      res.end("ok");
    });
    const logs: string[] = [];
    const res = await withRetry(fetch, options(logs))(s.url, { method: "POST", body: form() });
    expect(await res.text()).toBe("ok");
    expect(s.hits()).toBe(2);
    expect(logs[0]).toMatch(/try 1\/4 failed after .*s: TypeError .*fetch failed/);
  });

  it("times out a stalled request on its own and retries it", async () => {
    const s = await serve((_req, res, _body, hit) => {
      if (hit === 1) return; // never answers
      res.end("ok");
    });
    const logs: string[] = [];
    const res = await withRetry(fetch, options(logs, { baseTimeoutMs: 200 }))(s.url, {
      method: "POST",
      body: form(),
    });
    expect(await res.text()).toBe("ok");
    expect(logs[0]).toMatch(/TimeoutError/);
  });

  it("gives dag/import its longer floor instead of the base timeout", async () => {
    const s = await serve((_req, res) => {
      setTimeout(() => res.end("imported"), 400);
    });
    const logs: string[] = [];
    const url = s.url.replace("/api/v0/add?pin=true", "/api/v0/dag/import?pin-roots=true");
    const res = await withRetry(
      fetch,
      options(logs, { baseTimeoutMs: 100, importTimeoutMs: 3_000 }),
    )(url, { method: "POST", body: form() });
    expect(await res.text()).toBe("imported");
    expect(s.hits()).toBe(1);
    expect(logs).toHaveLength(0);
  });

  it("does not retry a 4xx other than 429", async () => {
    const s = await serve((_req, res) => {
      res.statusCode = 401;
      res.end("no");
    });
    const logs: string[] = [];
    const res = await withRetry(fetch, options(logs))(s.url, { method: "POST", body: form() });
    expect(res.status).toBe(401);
    expect(s.hits()).toBe(1);
    expect(logs).toHaveLength(0);
  });

  it("gives up after the last try, logs it and throws the original error", async () => {
    const s = await serve((req) => req.socket.destroy());
    const logs: string[] = [];
    await expect(
      withRetry(fetch, options(logs, { tries: 3 }))(s.url, { method: "POST", body: form() }),
    ).rejects.toThrow(/fetch failed/);
    expect(s.hits()).toBe(3);
    expect(logs.at(-1)).toMatch(/failed after 3 tries \(last: TypeError/);
  });

  it("passes a request with its own AbortSignal through untouched (elephant-cli's gateway polling)", async () => {
    const s = await serve((_req, res) => {
      res.statusCode = 503;
      res.end();
    });
    const logs: string[] = [];
    const res = await withRetry(fetch, options(logs))(s.url, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(503);
    expect(s.hits()).toBe(1);
  });

  it("raises Node's built-in fetch waits through the shared undici dispatcher", () => {
    const key = Symbol.for("undici.globalDispatcher.1");
    const before = (globalThis as Record<symbol, unknown>)[key];
    try {
      const agent = installLongWaits({ FETCH_RETRY_HEADERS_TIMEOUT_MS: "1234567" });
      expect((globalThis as Record<symbol, unknown>)[key]).toBe(agent);
    } finally {
      (globalThis as Record<symbol, unknown>)[key] = before;
    }
  });

  it("knows which bodies can be sent again", () => {
    expect(replayableSize(undefined)).toBe(0);
    expect(replayableSize("abc")).toBe(3);
    expect(replayableSize(new Uint8Array(5))).toBe(5);
    expect(replayableSize(form())).toBe(1000);
    expect(replayableSize(new ReadableStream())).toBeNull();
  });

  it("describes an error with its cause code", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
    });
    expect(describeError(error)).toBe(
      "TypeError UND_ERR_HEADERS_TIMEOUT: fetch failed (Headers Timeout Error)",
    );
  });
});
