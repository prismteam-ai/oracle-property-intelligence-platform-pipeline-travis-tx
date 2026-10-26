// T005 guard tests for the single HTTP boundary. Synthetic responses only (test-only);
// no real source is ever called: every test injects `fetch` and `sleep`.
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  HOST_POLICY,
  MAX_ATTEMPTS,
  USER_AGENT,
  backoffDelayMs,
  createSourceClient,
  detectChallengeSignal,
  detectGeoSignal,
  isGeoBlock,
  stopClass,
  stopExitCode,
  type FetchLike,
  type SourceClientOptions,
  wafSignal,
} from "../travis/lib/source-client.js";
import { must } from "./helpers.js";

type Call = { url: string; init: RequestInit };

function respond(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

/** A fake fetch that replays a queue of responses and records every call. */
function scripted(responses: Array<() => Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra request");
    return next();
  };
  return { fetch, calls };
}

const silent = (): void => undefined;
const CountSchema = z.array(z.object({ count: z.string() }));
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function client(opts: Partial<SourceClientOptions> & { fetch: FetchLike }) {
  return createSourceClient({
    sleep: async () => undefined,
    random: () => 1,
    now: () => FIXED_NOW,
    log: silent,
    ...opts,
  });
}

function headerMap(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("source-client: success path", () => {
  it("2xx that parses gives outcome ok with a full receipt", async () => {
    const body = '[{"count":"42"}]';
    const { fetch, calls } = scripted([() => respond(200, body)]);
    const res = await client({ fetch }).capture({
      url: "https://example.test/resource/abcd-1234.json",
      schema: CountSchema,
    });
    expect(calls).toHaveLength(1);
    expect(res.data).toEqual([{ count: "42" }]);
    expect(res.receipt).toMatchObject({
      url: "https://example.test/resource/abcd-1234.json",
      method: "GET",
      status: 200,
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
      captured_at: "2026-01-01T00:00:00.000Z",
      user_agent: USER_AGENT,
      attempts: 1,
      outcome: "ok",
      geo_signal: "none",
      app_token_used: false,
      timeout_ms: null,
      blocked_reason: null,
    });
  });
});

describe("A-01-TC-019 no evasion: source-client StopOnBlocked (403, challenge, timeout)", () => {
  it("403 makes exactly one attempt and gives outcome blocked", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch, calls } = scripted([() => respond(403, "Forbidden")]);
    const res = await client({ fetch, sleep }).capture({ url: "https://example.test/x" });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(res.data).toBeNull();
    expect(res.receipt).toMatchObject({
      status: 403,
      attempts: 1,
      outcome: "blocked",
      blocked_reason: "http-403",
    });
  });

  it("a 2xx challenge HTML page that fails its Zod parse is blocked, not 0 rows", async () => {
    const html = "<html><title>Just a moment...</title><body>Checking your browser</body></html>";
    const { fetch, calls } = scripted([() => respond(200, html, { "content-type": "text/html" })]);
    const res = await client({ fetch }).capture({
      url: "https://example.test/resource/abcd-1234.json",
      schema: CountSchema,
    });
    expect(calls).toHaveLength(1);
    expect(res.data).toBeNull();
    expect(res.receipt.outcome).toBe("blocked");
    expect(res.receipt.blocked_reason).toBe("challenge");
    expect(res.receipt.attempts).toBe(1);
    expect(res.receipt.status).toBe(200);
  });

  it("a timeout makes one attempt and gives blocked with timeout_ms", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetch: FetchLike = (_url, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    };
    const pending = client({ fetch, timeoutMs: 60_000 }).capture({
      url: "https://example.test/slow",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await pending;
    expect(calls).toBe(1);
    expect(res.receipt).toMatchObject({
      status: null,
      attempts: 1,
      outcome: "blocked",
      blocked_reason: "timeout",
      timeout_ms: 60_000,
    });
  });

  it("a non-retryable status such as 404 is not retried and gives failed", async () => {
    const { fetch, calls } = scripted([() => respond(404, "not found")]);
    const res = await client({ fetch }).capture({ url: "https://example.test/missing" });
    expect(calls).toHaveLength(1);
    expect(res.receipt).toMatchObject({ status: 404, attempts: 1, outcome: "failed" });
  });
});

describe("N-1 stop class: a timeout is error (exit 1), a 403 or challenge is blocked (exit 2)", () => {
  it("a real timeout receipt classifies as error with exit code 1", async () => {
    vi.useFakeTimers();
    const fetch: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const pending = client({ fetch, timeoutMs: 1_000 }).capture({
      url: "https://example.test/slow",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await pending;
    expect(res.receipt.blocked_reason).toBe("timeout");
    expect(stopClass(res.receipt)).toBe("error");
    expect(stopExitCode(stopClass(res.receipt))).toBe(1);
  });

  it("an HTTP 403 receipt classifies as blocked with exit code 2", async () => {
    const { fetch } = scripted([() => respond(403, "forbidden")]);
    const res = await client({ fetch }).capture({ url: "https://example.test/forbidden" });
    expect(stopClass(res.receipt)).toBe("blocked");
    expect(stopExitCode(stopClass(res.receipt))).toBe(2);
  });

  it("a challenge receipt classifies as blocked with exit code 2", async () => {
    const html = "<html><title>Just a moment...</title><body>Checking your browser</body></html>";
    const { fetch } = scripted([() => respond(200, html, { "content-type": "text/html" })]);
    const res = await client({ fetch }).capture({
      url: "https://example.test/resource/abcd-1234.json",
      schema: CountSchema,
    });
    expect(res.receipt.blocked_reason).toBe("challenge");
    expect(stopClass(res.receipt)).toBe("blocked");
    expect(stopExitCode(stopClass(res.receipt))).toBe(2);
  });

  it("ok, throttled-then-ok and failed map to ok 0, ok 0 and error 1", () => {
    expect(stopClass({ outcome: "ok", blocked_reason: null })).toBe("ok");
    expect(stopClass({ outcome: "throttled-then-ok", blocked_reason: null })).toBe("ok");
    expect(stopClass({ outcome: "failed", blocked_reason: null })).toBe("error");
    expect(stopExitCode("ok")).toBe(0);
  });
});

describe("A-01-TC-008 429 backoff: source-client backoff only on 429/5xx", () => {
  it("backoffDelayMs is full jitter with 1 s base and 60 s cap", () => {
    expect(backoffDelayMs(1, () => 1)).toBe(1000);
    expect(backoffDelayMs(2, () => 1)).toBe(2000);
    expect(backoffDelayMs(3, () => 1)).toBe(4000);
    expect(backoffDelayMs(4, () => 0.5)).toBe(4000);
    expect(backoffDelayMs(10, () => 1)).toBe(60_000);
    expect(backoffDelayMs(30, () => 1)).toBe(60_000);
    expect(backoffDelayMs(3, () => 0)).toBe(0);
  });

  it("429 then 200 gives throttled-then-ok after one jittered sleep", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const { fetch, calls } = scripted([() => respond(429, "slow down"), () => respond(200, "[]")]);
    const res = await client({ fetch, sleep, random: () => 0.5 }).capture({
      url: "https://example.test/x",
      schema: z.array(z.unknown()),
    });
    expect(calls).toHaveLength(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500]);
    expect(res.receipt).toMatchObject({ outcome: "throttled-then-ok", attempts: 2, status: 200 });
    expect(res.data).toEqual([]);
  });

  it("5xx on every attempt stops after 5 attempts with outcome failed", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const { fetch, calls } = scripted(Array.from({ length: 5 }, () => () => respond(503, "down")));
    const res = await client({ fetch, sleep, random: () => 1 }).capture({
      url: "https://example.test/x",
    });
    expect(calls).toHaveLength(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000]);
    expect(res.receipt).toMatchObject({ outcome: "failed", attempts: 5, status: 503 });
    expect(res.data).toBeNull();
  });

  it("honours Retry-After in seconds", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const { fetch } = scripted([
      () => respond(429, "", { "retry-after": "7" }),
      () => respond(200, "[]"),
    ]);
    const res = await client({ fetch, sleep }).capture({ url: "https://example.test/x" });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([7000]);
    expect(res.receipt.rate_limits_observed).toContain("Retry-After");
  });

  it("honours Retry-After as an HTTP date", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const later = new Date(FIXED_NOW.getTime() + 3000).toUTCString();
    const { fetch } = scripted([
      () => respond(503, "", { "retry-after": later }),
      () => respond(200, "[]"),
    ]);
    await client({ fetch, sleep }).capture({ url: "https://example.test/x" });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([3000]);
  });
});

describe("A-01-TC-NF-01 etiquette: source-client identity and network posture", () => {
  it("the User-Agent is constant across attempts and names the project and repo, no email", async () => {
    const { fetch, calls } = scripted([
      () => respond(503, ""),
      () => respond(429, ""),
      () => respond(200, "[]"),
    ]);
    const res = await client({ fetch }).capture({ url: "https://example.test/x" });
    const agents = calls.map((c) => headerMap(c.init)["user-agent"]);
    expect(agents).toEqual([USER_AGENT, USER_AGENT, USER_AGENT]);
    expect(res.receipt.user_agent).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/oracle/i);
    expect(USER_AGENT).toContain(
      "https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx",
    );
    expect(USER_AGENT).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it("configures no proxy, agent or dispatcher and sends no rotating headers", async () => {
    const before = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://proxy.example.test:8080";
    try {
      const { fetch, calls } = scripted([() => respond(503, ""), () => respond(200, "[]")]);
      await client({ fetch }).capture({ url: "https://example.test/x" });
      for (const call of calls) {
        for (const key of Object.keys(call.init)) {
          expect(["method", "headers", "signal", "redirect"]).toContain(key);
        }
        for (const name of Object.keys(headerMap(call.init))) {
          expect(["user-agent", "accept", "x-app-token"]).toContain(name);
        }
      }
      expect(headerMap(must(calls[0]).init)).toEqual(headerMap(must(calls[1]).init));
    } finally {
      if (before === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = before;
    }
  });

  it("runs at most 2 concurrent requests per host", async () => {
    const inflight = new Map<string, number>();
    const peak = new Map<string, number>();
    const releases: Array<() => void> = [];
    const fetch: FetchLike = (url) => {
      const host = new URL(url).host;
      inflight.set(host, (inflight.get(host) ?? 0) + 1);
      peak.set(host, Math.max(peak.get(host) ?? 0, inflight.get(host) ?? 0));
      return new Promise<Response>((resolve) => {
        releases.push(() => {
          inflight.set(host, (inflight.get(host) ?? 1) - 1);
          resolve(respond(200, "[]"));
        });
      });
    };
    const c = client({ fetch });
    const all = [
      ...Array.from({ length: 5 }, (_, i) => c.capture({ url: `https://a.example.test/${i}` })),
      ...Array.from({ length: 3 }, (_, i) => c.capture({ url: `https://b.example.test/${i}` })),
    ];
    // Drain: release whatever is in flight until every request has completed.
    let done = false;
    const finished = Promise.all(all).then(() => {
      done = true;
    });
    while (!done) {
      await new Promise((r) => setImmediate(r));
      releases.splice(0).forEach((release) => release());
    }
    await finished;
    expect(peak.get("a.example.test")).toBe(2);
    expect(peak.get("b.example.test")).toBe(2);
  });

  it("sends the optional app token as a header and records only app_token_used", async () => {
    const token = "synthetic-token-value-123";
    const { fetch, calls } = scripted([() => respond(200, "[]")]);
    const res = await client({ fetch, appToken: token }).capture({
      url: "https://example.test/resource/abcd-1234.json",
      useAppToken: true,
    });
    expect(headerMap(must(calls[0]).init)["x-app-token"]).toBe(token);
    expect(must(calls[0]).url).not.toContain(token);
    expect(res.receipt.app_token_used).toBe(true);
    expect(JSON.stringify(res.receipt)).not.toContain(token);
  });

  it("does not send the app token unless the request asks for it", async () => {
    const { fetch, calls } = scripted([() => respond(200, "[]")]);
    const res = await client({ fetch, appToken: "synthetic-token" }).capture({
      url: "https://example.test/x",
    });
    expect(headerMap(must(calls[0]).init)["x-app-token"]).toBeUndefined();
    expect(res.receipt.app_token_used).toBe(false);
  });

  it("strips credentials and token parameters from the receipt URL", async () => {
    const { fetch } = scripted([() => respond(200, "[]")]);
    const res = await client({ fetch }).capture({
      url: "https://user:secretpw@example.test/x?$$app_token=abc123&limit=1",
    });
    expect(res.receipt.url).not.toContain("secretpw");
    expect(res.receipt.url).not.toContain("abc123");
    expect(res.receipt.url).toContain("limit=1");
  });
});

describe("isGeoBlock (FR-006b): only an explicit signal counts", () => {
  it("a bare 403 is not a geo-block", () => {
    expect(isGeoBlock({ status: 403, headers: {}, body: "Forbidden" })).toBe(false);
    expect(detectGeoSignal({ status: 403, headers: {}, body: "Forbidden" })).toBeNull();
  });

  it("a bot challenge is not a geo-block", () => {
    const body = "<title>Just a moment...</title> Attention Required! Cloudflare";
    expect(
      isGeoBlock({ status: 403, headers: { server: "cloudflare", "cf-ray": "1" }, body }),
    ).toBe(false);
  });

  it("a country header that every response carries is not a geo-block", () => {
    expect(isGeoBlock({ status: 403, headers: { "cf-ipcountry": "SE" }, body: "" })).toBe(false);
  });

  it("an explicit body message is a geo-block and is quoted", () => {
    const saved = {
      status: 403,
      headers: {},
      body: "<p>Sorry, this service is not available in your country.</p>",
    };
    expect(isGeoBlock(saved)).toBe(true);
    expect(detectGeoSignal(saved)).toMatch(/not available in your country/i);
  });

  it("an explicit country-block error code is a geo-block", () => {
    expect(isGeoBlock({ status: 403, headers: {}, body: "error code: 1009 Access denied" })).toBe(
      true,
    );
  });

  it("an explicit geo header is a geo-block", () => {
    const saved = { status: 403, headers: { "x-geo-block": "country restricted" }, body: "" };
    expect(isGeoBlock(saved)).toBe(true);
    expect(detectGeoSignal(saved)).toContain("x-geo-block");
  });

  it("the receipt geo_signal is none for a bare 403 and quotes an explicit signal", async () => {
    const bare = scripted([() => respond(403, "Forbidden")]);
    const r1 = await client({ fetch: bare.fetch }).capture({ url: "https://example.test/x" });
    expect(r1.receipt.geo_signal).toBe("none");
    const geo = scripted([() => respond(403, "Not available in your region")]);
    const r2 = await client({ fetch: geo.fetch }).capture({ url: "https://example.test/x" });
    expect(r2.receipt.geo_signal).toMatch(/not available in your region/i);
  });
});

describe("OR-M2: a web application firewall that names itself is a block on any status", () => {
  // The exact body saved in docs/evidence/blocked/jurisdiction-san_leanna-20261020T085313Z.md
  // (300 bytes, SHA-256 8970d3ea...); copied here, the evidence file is not read at test time.
  const SAN_LEANNA_406 =
    "<html><head><title>Error 406 - Not Acceptable</title><head><body><h1>Error 406 - Not Acceptable</h1><p>Generally a 406 error is caused because a request has been blocked by Mod Security. If you believe that your request has been blocked by mistake please contact the web site owner.</p></body></html>";
  const SAN_LEANNA_HEADERS = {
    connection: "Keep-Alive",
    "content-length": "300",
    "content-type": "text/html; charset=iso-8859-1",
    server: "Apache",
  };

  it("the fixture is byte-identical to the saved evidence body", () => {
    expect(Buffer.byteLength(SAN_LEANNA_406)).toBe(300);
    expect(createHash("sha256").update(SAN_LEANNA_406).digest("hex")).toBe(
      "8970d3ea6059606600e849b7d48adcae7d56b01a70cc5fa34b558cab199eb021",
    );
  });

  it("the San Leanna HTTP 406 Mod Security page is a challenge/block signal", () => {
    const saved = { status: 406, headers: SAN_LEANNA_HEADERS, body: SAN_LEANNA_406 };
    expect(wafSignal(saved)).toMatch(
      /HTTP 406 .*web application firewall.*request has been blocked|Mod Security/i,
    );
    expect(detectChallengeSignal(saved)).toBe(wafSignal(saved));
  });

  it("capture records the 406 Mod Security page as blocked (challenge), one attempt", async () => {
    const s = scripted([() => respond(406, SAN_LEANNA_406, SAN_LEANNA_HEADERS)]);
    const r = await client({ fetch: s.fetch }).capture({ url: "https://example.test/packet.pdf" });
    expect(s.calls).toHaveLength(1);
    expect(r.receipt).toMatchObject({
      outcome: "blocked",
      blocked_reason: "challenge",
      status: 406,
    });
    expect(r.receipt.challenge_signal).toMatch(/web application firewall/);
  });

  it("names Mod Security, mod_security, ModSecurity and Request blocked on any status", () => {
    for (const body of ["blocked by mod_security", "ModSecurity Action"]) {
      expect(wafSignal({ status: 200, headers: {}, body })).not.toBeNull();
      expect(wafSignal({ status: 501, headers: {}, body })).not.toBeNull();
    }
    expect(wafSignal({ status: 403, headers: { server: "Mod_Security 2.9" }, body: "" })).toMatch(
      /server: Mod_Security/,
    );
  });

  it("a normal page is not a WAF block", () => {
    const page =
      "<html><head><title>Building permits</title></head><body>Apply online.</body></html>";
    expect(wafSignal({ status: 200, headers: { server: "Apache" }, body: page })).toBeNull();
    expect(detectChallengeSignal({ status: 200, headers: {}, body: page })).toBeNull();
    // a Server header listing the module on a 200 is not a block
    expect(
      wafSignal({ status: 200, headers: { server: "Apache mod_security/2.9" }, body: page }),
    ).toBeNull();
    // a large 2xx document that mentions the firewall is a document, not a block page
    const doc = `<html><body>${"x".repeat(9_000)} ModSecurity rules guide</body></html>`;
    expect(wafSignal({ status: 200, headers: {}, body: doc })).toBeNull();
  });
});

// A-04 T002 (CR2-8): fetch decodes a gzip/br body, so an encoded Content-Length is not the
// size of the body we read. Synthetic test input only; no source is called.
describe("CR2-8 refused body size under content-encoding", () => {
  const html = `<html><body>${"refused ".repeat(1024)}</body></html>`; // 8,219 decoded bytes
  const refused =
    (headers: Record<string, string>): FetchLike =>
    async () =>
      new Response(html, { status: 404, headers });
  const dl = (fetch: FetchLike) =>
    client({ fetch }).download({
      url: "https://traviscad.test/export.zip",
      destPath: join(mkdtempSync(join(tmpdir(), "cr2-8-")), "export.zip"),
      inactivityMs: 10_000,
      totalMs: 60_000,
    });

  for (const encoding of ["gzip", "br"]) {
    it(`a ${encoding} refusal records the decoded excerpt size and keeps the encoded length apart`, async () => {
      const r = await dl(
        refused({
          "content-type": "text/html",
          "content-encoding": encoding,
          "content-length": "412",
        }),
      );
      const ev = must(r.receipt.stop_evidence);
      expect(ev.body_bytes).toBe(Buffer.byteLength(html));
      expect(ev.body_bytes_basis).toBe("decoded_excerpt");
      expect(ev.content_length_encoded).toBe(412);
    });
  }

  it("an identity refusal keeps the advertised Content-Length", async () => {
    const r = await dl(refused({ "content-type": "text/html", "content-length": "999999" }));
    const ev = must(r.receipt.stop_evidence);
    expect(ev.body_bytes).toBe(999_999);
    expect(ev.body_bytes_basis).toBe("content_length");
    expect(ev.content_length_encoded).toBeUndefined();
  });
});

// A-04 T003 (OR-N8 + host policy). Synthetic test input only.
describe("OR-N8 WAF body needs a firewall noun; HOST_POLICY", () => {
  const SAN_LEANNA_406 =
    "<html><head><title>Error 406 - Not Acceptable</title><head><body><h1>Error 406 - Not Acceptable</h1><p>Generally a 406 error is caused because a request has been blocked by Mod Security. If you believe that your request has been blocked by mistake please contact the web site owner.</p></body></html>";

  it("the San Leanna 406 ModSecurity page stays blocked", async () => {
    const s = scripted([() => respond(406, SAN_LEANNA_406, { "content-type": "text/html" })]);
    const r = await client({ fetch: s.fetch }).capture({ url: "https://example.test/x" });
    expect(r.receipt.outcome).toBe("blocked");
  });

  it("a small 2xx Socrata JSON page whose text says REQUEST BLOCKED is not blocked", async () => {
    const body = JSON.stringify([
      { permit_number: "2026-000001 BP", description: "REQUEST BLOCKED BY OWNER - REVISION" },
    ]);
    expect(wafSignal({ status: 200, headers: {}, body })).toBeNull();
    const s = scripted([() => respond(200, body, { "content-type": "application/json" })]);
    const r = await client({ fetch: s.fetch }).capture({
      url: "https://data.austintexas.test/resource/x.json",
    });
    expect(r.receipt.outcome).toBe("ok");
  });

  it("a 2xx page that names the firewall is still blocked", () => {
    for (const body of [
      "<p>Request blocked by the web application firewall.</p>",
      "<p>This request was blocked by WAF.</p>",
      "ModSecurity Action",
    ]) {
      expect(wafSignal({ status: 200, headers: {}, body })).not.toBeNull();
    }
  });

  it("non-2xx stays fail-closed: a bare 'Request blocked' on 406 or 501 is a block", () => {
    for (const status of [406, 501]) {
      expect(wafSignal({ status, headers: {}, body: "<p>Request blocked.</p>" })).not.toBeNull();
    }
  });

  it("HOST_POLICY: GIS ≤ 2, Austin 1 req/s and 1 in flight, TCAD 1; shared backoff; stop on first 403", () => {
    expect(HOST_POLICY["gis.traviscountytx.gov"]?.concurrency).toBeLessThanOrEqual(2);
    expect(HOST_POLICY["data.austintexas.gov"]).toMatchObject({ concurrency: 1 });
    expect(HOST_POLICY["data.austintexas.gov"]?.minIntervalMs).toBeGreaterThanOrEqual(1_000);
    for (const host of ["traviscad.org", "www.traviscad.org"]) {
      expect(HOST_POLICY[host]?.concurrency).toBe(1);
    }
    for (const policy of Object.values(HOST_POLICY)) {
      expect(policy.backoff).toEqual({
        baseMs: BACKOFF_BASE_MS,
        capMs: BACKOFF_CAP_MS,
        attempts: MAX_ATTEMPTS,
        jitter: "full",
      });
      expect(BACKOFF_BASE_MS).toBe(1_000);
      expect(BACKOFF_CAP_MS).toBe(60_000);
      expect(MAX_ATTEMPTS).toBe(5);
      expect(policy.stopOn403).toBe(true);
      expect(policy.retryOn403).toBe(false);
      expect(policy.userAgent).toBe(USER_AGENT);
    }
  });

  it("the client caps a configured concurrency of 5 at the host policy (GIS 2, TCAD 1 in flight)", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return respond(200, "[]", { "content-type": "application/json" });
    };
    const c = client({ fetch, maxConcurrencyPerHost: 5 });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        c.capture({ url: `https://gis.traviscountytx.gov/q?page=${i}` }),
      ),
    );
    expect(peak).toBe(2);
    peak = 0;
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => c.capture({ url: `https://traviscad.org/f?i=${i}` })),
    );
    expect(peak).toBe(1);
  });

  it("with hostSpacing the client spaces Austin request starts by at least the policy interval", async () => {
    let t = 0;
    const starts: number[] = [];
    const fetch: FetchLike = async () => {
      starts.push(t);
      return respond(200, "[]", { "content-type": "application/json" });
    };
    const c = client({
      fetch,
      hostSpacing: true,
      clock: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await c.capture({ url: `https://data.austintexas.gov/resource/3syk-w9eu.json?p=${i}` });
    }
    expect(must(starts[1]) - must(starts[0])).toBeGreaterThanOrEqual(1_000);
    expect(must(starts[2]) - must(starts[1])).toBeGreaterThanOrEqual(1_000);
  });
});
