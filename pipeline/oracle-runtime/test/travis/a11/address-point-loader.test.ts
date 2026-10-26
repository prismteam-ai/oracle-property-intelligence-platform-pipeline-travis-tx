// A-11 Run 3 (ADR 0004): the address-layer loader is polite (identified User-Agent, GET only,
// spaced requests, backoff on 429/5xx, stop on 403), paged, resumable and leaves a receipt.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadAddressLayer,
  readAddressLayerCache,
} from "../../../travis/gis/address-point-loader.js";
import { ADDRESS_LAYER_URL } from "../../../travis/gis/address-points.js";
import { HOST_POLICY, USER_AGENT, createSourceClient } from "../../../travis/lib/source-client.js";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "a11-address-layer-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TOTAL = 5;
const feature = (id: number, over: Record<string, unknown> = {}) => ({
  attributes: {
    OBJECTID: id,
    PLACE_ID: 9000 + id,
    ADDRESS: 100 + id,
    FULL_STREET_NAME: `${100 + id} MAIN ST`,
    ADDRESS_FRACTION: null,
    ADDRESS_SUFFIX: null,
    ADDRESS_TYPE: 1,
    ...over,
  },
  geometry: { x: -97.7 + id / 1000, y: 30.2 + id / 1000 },
});
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Call {
  url: string;
  method: string | undefined;
  ua: string | undefined;
}

function fakeLayer(opts: { editDate?: number; failFirstPageWith?: number; block?: boolean } = {}) {
  const calls: Call[] = [];
  let failed = false;
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: init.method,
      ua: (init.headers as Record<string, string> | undefined)?.["user-agent"],
    });
    if (opts.block === true) return new Response("forbidden", { status: 403 });
    if (!url.includes("/query?")) {
      return json({
        name: "Addresses",
        maxRecordCount: 2000,
        editingInfo: { dataLastEditDate: opts.editDate ?? 1792816268027 },
      });
    }
    if (url.includes("returnCountOnly=true")) return json({ count: TOTAL });
    const offset = Number(/resultOffset=(\d+)/.exec(url)?.[1]);
    const size = Number(/resultRecordCount=(\d+)/.exec(url)?.[1]);
    if (opts.failFirstPageWith !== undefined && offset === 0 && !failed) {
      failed = true;
      return new Response("busy", { status: opts.failFirstPageWith });
    }
    const ids = Array.from({ length: TOTAL }, (_, i) => i + 1).slice(offset, offset + size);
    return json({ features: ids.map((i) => feature(i)) });
  };
  return { fetch, calls };
}

const client = (
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  sleeps: number[] = [],
) =>
  createSourceClient({
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
    hostSpacing: true,
    log: () => undefined,
  });

describe("host policy", () => {
  it("the ArcGIS host is held to one request in flight, one per second", () => {
    expect(HOST_POLICY["services.arcgis.com"]).toMatchObject({
      concurrency: 1,
      minIntervalMs: 1000,
      stopOn403: true,
      retryOn403: false,
    });
  });
});

describe("loadAddressLayer", () => {
  it("pages the whole layer, writes the cache and a receipt with url, time, count, sha256 and edit date", async () => {
    const dir = tmp();
    const { fetch, calls } = fakeLayer();
    const receipt = await loadAddressLayer({
      client: client(fetch),
      cacheDir: dir,
      pageSize: 2,
      now: () => new Date("2026-10-25T00:49:51.937Z"),
    });
    // 1 layer info + 1 count + 3 pages (2 + 2 + 1)
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.method === "GET" || c.method === undefined)).toBe(true);
    expect(calls.every((c) => c.url.startsWith(ADDRESS_LAYER_URL))).toBe(true);
    expect(receipt).toMatchObject({
      layer_url: ADDRESS_LAYER_URL,
      retrieved_at: "2026-10-25T00:49:51.937Z",
      record_count: TOTAL,
      source_count: TOTAL,
      pages: 3,
      page_size: 2,
      layer_last_edit_date: new Date(1792816268027).toISOString(),
    });
    const file = readFileSync(join(dir, "address-points.ndjson"));
    expect(receipt.sha256).toBe(createHash("sha256").update(file).digest("hex"));
    const read = readAddressLayerCache(dir);
    expect(read.records).toHaveLength(TOTAL);
    expect(read.records[0]).toMatchObject({
      object_id: 1,
      address: 101,
      lat: 30.201,
      lon: -97.699,
    });
    expect(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")).sha256).toBe(receipt.sha256);
  });

  it("sends the project User-Agent on every request, no cookies, no token", async () => {
    const dir = tmp();
    const seen: Array<Record<string, string>> = [];
    const { fetch } = fakeLayer();
    await loadAddressLayer({
      client: client(async (url, init) => {
        seen.push(init.headers as Record<string, string>);
        return fetch(url, init);
      }),
      cacheDir: dir,
      pageSize: 5,
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const h of seen) {
      expect(h["user-agent"]).toBe(USER_AGENT);
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("cookie");
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
    }
  });

  it("spaces requests at least one second apart", async () => {
    const dir = tmp();
    const sleeps: number[] = [];
    let t = 0;
    const { fetch } = fakeLayer();
    const c = createSourceClient({
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      clock: () => t,
      random: () => 1,
      hostSpacing: true,
      log: () => undefined,
    });
    await loadAddressLayer({ client: c, cacheDir: dir, pageSize: 2 });
    // 5 requests: the first starts at once, each of the other four waits out the 1 s interval
    expect(sleeps.filter((ms) => ms >= 1000 - 1)).toHaveLength(4);
  });

  it("backs off on a 503 and then succeeds", async () => {
    const dir = tmp();
    const sleeps: number[] = [];
    const { fetch } = fakeLayer({ failFirstPageWith: 503 });
    const receipt = await loadAddressLayer({
      client: client(fetch, sleeps),
      cacheDir: dir,
      pageSize: 5,
    });
    expect(receipt.record_count).toBe(TOTAL);
    expect(sleeps.some((ms) => ms > 0)).toBe(true);
  });

  it("stops on a 403 without retrying and caches nothing", async () => {
    const dir = tmp();
    const { fetch, calls } = fakeLayer({ block: true });
    await expect(
      loadAddressLayer({ client: client(fetch), cacheDir: dir, pageSize: 2 }),
    ).rejects.toThrow(/BLOCKED/);
    expect(calls).toHaveLength(1);
    expect(readdirSync(join(dir, "pages"))).toEqual([]);
  });

  it("resumes: pages already on disk are not requested again", async () => {
    const dir = tmp();
    const first = fakeLayer();
    await expect(
      loadAddressLayer({ client: client(first.fetch), cacheDir: dir, pageSize: 2, maxPages: 1 }),
    ).rejects.toThrow(/incomplete/);
    expect(readdirSync(join(dir, "pages"))).toHaveLength(1);

    const second = fakeLayer();
    const receipt = await loadAddressLayer({
      client: client(second.fetch),
      cacheDir: dir,
      pageSize: 2,
    });
    const pageCalls = second.calls.filter((c) => c.url.includes("resultOffset="));
    expect(pageCalls).toHaveLength(2);
    expect(pageCalls.some((c) => c.url.includes("resultOffset=0&"))).toBe(false);
    expect(receipt.record_count).toBe(TOTAL);
  });

  it("restarts when the layer was edited since the cache was written", async () => {
    const dir = tmp();
    await expect(
      loadAddressLayer({
        client: client(fakeLayer().fetch),
        cacheDir: dir,
        pageSize: 2,
        maxPages: 1,
      }),
    ).rejects.toThrow(/incomplete/);
    const edited = fakeLayer({ editDate: 1792900000000 });
    await loadAddressLayer({ client: client(edited.fetch), cacheDir: dir, pageSize: 2 });
    expect(edited.calls.filter((c) => c.url.includes("resultOffset="))).toHaveLength(3);
  });

  it("refuses a cache whose file no longer matches the receipt sha256", async () => {
    const dir = tmp();
    await loadAddressLayer({ client: client(fakeLayer().fetch), cacheDir: dir, pageSize: 5 });
    writeFileSync(join(dir, "address-points.ndjson"), "{}\n");
    expect(() => readAddressLayerCache(dir)).toThrow(/sha256/);
  });

  it("rejects a layer that answers HTTP 200 with an ArcGIS error body", async () => {
    const dir = tmp();
    const fetch = async (url: string): Promise<Response> =>
      url.includes("/query?")
        ? json({ error: { code: 400, message: "Invalid query" } })
        : json({ name: "Addresses", editingInfo: { dataLastEditDate: 1 } });
    await expect(
      loadAddressLayer({ client: client(fetch), cacheDir: dir, pageSize: 2 }),
    ).rejects.toThrow();
  });
});
