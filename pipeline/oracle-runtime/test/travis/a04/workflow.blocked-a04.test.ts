// A-04 T026 (AC-6, FR-006, NFR-002): a missing or mismatched TCAD export stops the run in
// WAITING_HUMAN before any request; only after a human resolves the durable promise does it
// make ONE identified download request, and a 403 on it is a blocked receipt with no retry.
// Source etiquette for TCAD, GIS and Austin through the one source client. Synthetic test
// input only: fake hosts answer every request; nothing real is called.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  HOST_POLICY,
  MAX_ATTEMPTS,
  USER_AGENT,
  createSourceClient,
  type FetchLike,
} from "../../../travis/lib/source-client.js";
import { verifyExport } from "../../../travis/tcad/export-verify.js";
import {
  runTcadBackbone,
  Suspended,
  type BackboneDeps,
  type BackboneInput,
  type TrackOp,
} from "../../../travis/tcad/workflow.js";
import { command as ingest } from "../../../travis/backbone/commands/ingest.js";
import { createRunContext } from "../../../travis/backbone/run-context.js";
import type { RestateIngressClient } from "../../../travis/backbone/restate-client.js";
import { silent } from "../../fixtures/fake-http.js";

const EXPORT_URL =
  "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip";
const SHA = "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346";
const FIXED = new Date("2026-10-22T03:00:00.000Z");

const forbidden = (body = "<html>Forbidden</html>") =>
  new Response(body, { status: 403, headers: { "content-type": "text/html" } });

function harness(fetch: FetchLike, resolutions: Array<"download" | "abort">) {
  const ops: TrackOp[] = [];
  const statusesAtWait: string[][] = [];
  const requestsAtWait: number[] = [];
  const requests: Array<{ url: string; ua: string | null }> = [];
  const recording: FetchLike = async (url, init) => {
    requests.push({ url, ua: new Headers(init.headers).get("user-agent") });
    return fetch(url, init);
  };
  const client = createSourceClient({
    fetch: recording,
    sleep: async () => undefined,
    random: () => 1,
    now: () => FIXED,
    log: silent,
  });
  let waits = 0;
  const dir = mkdtempSync(join(tmpdir(), "a04-blocked-"));
  const input: BackboneInput = {
    jobId: "travis-a04-202610220300",
    mode: "full",
    asOf: "2026-10-22",
    exportPath: join(dir, "absent.zip"),
    receipt: { url: EXPORT_URL, sha256: SHA, captured_at: "2026-10-19T21:33:41.241Z" },
    runDir: join(dir, "runs/travis-a04-202610220300"),
  };
  const statuses = () =>
    ops.filter((o) => o.kind === "run").map((o) => (o as { status: string }).status);
  const deps: BackboneDeps = {
    step: async (_name, fn) => fn(),
    merge: async (op) => {
      ops.push(op);
      return { rowsWritten: 0 };
    },
    verify: (path, sha) => verifyExport(path, sha),
    waitForHuman: async () => {
      statusesAtWait.push(statuses());
      requestsAtWait.push(requests.length);
      const r = resolutions[waits];
      waits += 1;
      if (r === undefined) throw new Suspended("waiting on a human");
      return { action: r };
    },
    download: (req) => client.download(req),
    runChunk: async () => {
      throw new Error("no chunk may run");
    },
    listInputs: () => [],
    records: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw new Error("the export must not be read");
        },
      }),
    }),
    now: () => FIXED,
  };
  return { input, deps, ops, statuses, statusesAtWait, requestsAtWait, requests };
}

describe("A-04-TC-016 export mismatch / injected 403 → waiting_human, nothing loaded as complete", () => {
  it("A-04-TC-016 export missing → WAITING_HUMAN before any request; one download after resolve; 403 → blocked, waiting again", async () => {
    const h = harness(async () => forbidden(), ["download"]);
    await expect(runTcadBackbone(h.input, h.deps)).rejects.toBeInstanceOf(Suspended);
    // stop first: status waiting_human, request log empty
    expect(h.statusesAtWait[0]).toEqual(["running", "waiting_human"]);
    expect(h.requestsAtWait[0]).toBe(0);
    // after resolve: exactly one request, project UA, then waiting again (no retry)
    expect(h.requests).toEqual([{ url: EXPORT_URL, ua: USER_AGENT }]);
    expect(h.requestsAtWait[1]).toBe(1);
    expect(h.statuses()).toEqual(["running", "waiting_human", "waiting_human"]);
    const receipts = h.ops.filter((o) => o.kind === "receipt");
    expect(receipts).toHaveLength(1);
    expect((receipts[0] as { receipt: Record<string, unknown> }).receipt).toMatchObject({
      outcome: "blocked",
      http_status: 403,
      url: EXPORT_URL,
      ua: USER_AGENT,
    });
    const r = (receipts[0] as { receipt: { captured_at: string; blocked_at: string } }).receipt;
    expect(r.blocked_at).toMatch(/Z$/);
    // nothing loaded, no watermark-bearing chunk, never complete
    expect(h.ops.some((o) => o.kind === "chunk" || o.kind === "finalize")).toBe(false);
    expect(h.statuses()).not.toContain("complete");
  });

  it("A-04-TC-016 a SHA-256 mismatch stops the same way (export_sha256_mismatch)", async () => {
    const h = harness(async () => forbidden(), []);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(h.input.exportPath, "not the A-01 export");
    let reason = "";
    const wait = h.deps.waitForHuman;
    h.deps.waitForHuman = async (name, why) => {
      reason = why;
      return wait(name, why);
    };
    await expect(runTcadBackbone(h.input, h.deps)).rejects.toBeInstanceOf(Suspended);
    expect(reason).toBe("export_sha256_mismatch");
    expect(h.requests).toHaveLength(0);
  });

  it("A-04-TC-016 the CLI exits 3 while the run waits on a human", async () => {
    const ingress: RestateIngressClient = {
      call: async <T>(_s: string, handler: string) =>
        (handler === "status" ? { status: "waiting_human" } : null) as T,
      send: async () => ({ invocationId: "inv_synthetic" }),
      callLong: async <T>() => null as T,
      get: async <T>() => null as T,
    };
    const ctx = createRunContext({
      ingress,
      now: () => FIXED,
      freeBytes: () => 50 * 1024 ** 3,
      print: () => undefined,
    });
    const out = await ingest.run(ctx, { track: "appraisal", pollMs: 0 });
    expect(out.exitCode).toBe(3);
  });
});

describe("A-04-TC-017 source etiquette: one User-Agent, GIS ≤ 2 / Austin ≤ 1 req/s, stop on first 403", () => {
  const hosts = [
    "https://traviscad.org/wp-content/largefiles/x.zip",
    "https://gis.traviscountytx.gov/server1/rest/services/x/MapServer/6/query?f=json",
    "https://data.austintexas.gov/resource/3syk-w9eu.json?$limit=1",
  ];

  it.each(hosts)(
    "A-04-TC-017 after the first 403 from %s: 0 further requests, blocked 403",
    async (url) => {
      const seen: string[] = [];
      const fetch: FetchLike = async (u, init) => {
        seen.push(new Headers(init.headers).get("user-agent") ?? "");
        return forbidden();
      };
      const c = createSourceClient({
        fetch,
        sleep: async () => undefined,
        random: () => 1,
        now: () => FIXED,
        log: silent,
      });
      const first = await c.capture({ url });
      expect(first.receipt).toMatchObject({ outcome: "blocked", status: 403, attempts: 1 });
      expect(seen).toEqual([USER_AGENT]);
    },
  );

  it("A-04-TC-017 HOST_POLICY: GIS 2 in flight with a configured 5, TCAD 1, Austin ≥ 1,000 ms apart", async () => {
    expect(HOST_POLICY["gis.traviscountytx.gov"]?.concurrency).toBe(2);
    expect(HOST_POLICY["traviscad.org"]?.concurrency).toBe(1);
    for (const p of Object.values(HOST_POLICY)) {
      expect(p).toMatchObject({ stopOn403: true, retryOn403: false, userAgent: USER_AGENT });
    }
    let inFlight = 0;
    let peak = 0;
    const fetch: FetchLike = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    };
    const c = createSourceClient({
      fetch,
      maxConcurrencyPerHost: 5,
      sleep: async () => undefined,
      now: () => FIXED,
      log: silent,
    });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        c.capture({ url: `https://gis.traviscountytx.gov/q?p=${i}` }),
      ),
    );
    expect(peak).toBe(2);
    let t = 0;
    const starts: number[] = [];
    const spaced = createSourceClient({
      fetch: async () => {
        starts.push(t);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
      hostSpacing: true,
      clock: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => FIXED,
      log: silent,
    });
    for (let i = 0; i < 3; i += 1)
      await spaced.capture({ url: `https://data.austintexas.gov/resource/3syk-w9eu.json?p=${i}` });
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1_000);
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(1_000);
  });

  it("A-04-TC-017 contrast: a 429 is retried with full-jitter backoff (1 s base, 60 s cap, 5 attempts)", async () => {
    expect([BACKOFF_BASE_MS, BACKOFF_CAP_MS, MAX_ATTEMPTS]).toEqual([1_000, 60_000, 5]);
    let n = 0;
    const sleeps: number[] = [];
    const c = createSourceClient({
      fetch: async () => {
        n += 1;
        return new Response("slow down", { status: 429 });
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
      now: () => FIXED,
      log: silent,
    });
    const r = await c.capture({ url: "https://data.austintexas.gov/resource/3syk-w9eu.json" });
    expect(n).toBe(5);
    expect(r.receipt.outcome).not.toBe("ok");
    expect(sleeps.length).toBeGreaterThanOrEqual(4);
    for (const s of sleeps) expect(s).toBeLessThanOrEqual(60_000);
  });
});
