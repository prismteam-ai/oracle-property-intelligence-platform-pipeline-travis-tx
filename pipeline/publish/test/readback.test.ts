// T028: readback of one group's uploads against a fake Filebase gateway. Root digests compare by
// sameDigest (the upload summary may print another codec), the part count must agree between
// the local parts, the export summary and the upload summary, and every part is fetched from
// FILEBASE_GATEWAY_HOST with a plain GET and compared on size + SHA-256. No network.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { cidOfFile } from "../src/cid.js";
import {
  CarUploadSummary,
  FILEBASE_GATEWAY_HOST,
  TablesUploadSummary,
  filebaseGatewayHost,
  listTableParts,
  readUploadSummary,
  readbackGroup,
  type FetchLike,
  type ReadbackOptions,
} from "../src/readback.js";
import type { GroupResult } from "../src/sequence.js";

const DAG_CBOR = 0x71;

function write(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

async function dagJsonCid(value: unknown): Promise<CID> {
  return CID.create(1, dagJson.code, await sha256.digest(dagJson.encode(value)));
}

interface Fixture {
  runDir: string;
  group: GroupResult;
  /** Part files in table/position order, with their bytes and raw-leaves CIDs. */
  parts: Array<{ table: string; position: number; path: string; cid: string; bytes: Uint8Array }>;
  carRoot: CID;
  tablesRoot: CID;
}

interface FixtureOptions {
  /** `parts` written into the tables upload summary (default: the local count). */
  uploadedParts?: number;
  /** Root written into the tables upload summary (default: the export root). */
  uploadedTablesRoot?: string;
  /** Root written into the archive upload summary (default: the CAR root as dag-cbor). */
  uploadedCarRoot?: string;
  /** Tables with their part counts (default: property 1, structure 2). */
  tables?: Record<string, number>;
  /** Overrides the export summary's part count for one table. */
  exportParts?: Record<string, number>;
}

async function fixture(opts: FixtureOptions = {}): Promise<Fixture> {
  const runDir = mkdtempSync(join(tmpdir(), "readback-"));
  const tables = opts.tables ?? { property: 1, structure: 2 };
  const carPath = join(runDir, "car/travis-county.car");
  write(carPath, "car bytes");
  const carRoot = await dagJsonCid({ label: "CountyIndex" });
  const tablesDir = join(runDir, "tables/county");
  write(join(tablesDir, "tables.car"), "tables car bytes");
  const tablesRoot = await dagJsonCid({ label: "CountyTables" });
  const parts: Fixture["parts"] = [];
  for (const [table, count] of Object.entries(tables)) {
    for (let position = 0; position < count; position += 1) {
      const bytes = new TextEncoder().encode(`PAR1 ${table} ${position} ${"x".repeat(position)}`);
      const path = join(tablesDir, table, `part-${String(position).padStart(5, "0")}.parquet`);
      write(path, bytes);
      parts.push({ table, position, path, cid: await cidOfFile(path), bytes });
    }
  }
  const tablesExportJson = join(runDir, "reports/county-tables-export.json");
  write(
    tablesExportJson,
    JSON.stringify({
      root: tablesRoot.toString(),
      countyRoot: carRoot.toString(),
      tables: Object.fromEntries(
        Object.entries(tables).map(([t, n]) => [t, { rows: n, parts: opts.exportParts?.[t] ?? n }]),
      ),
    }),
  );
  const archiveJson = join(runDir, "reports/county-archive-upload.json");
  const tablesJson = join(runDir, "reports/county-tables-upload.json");
  // The upload summary prints the root in another codec (dag-cbor): same digest, other string.
  const asCbor = CID.create(1, DAG_CBOR, carRoot.multihash).toString();
  write(
    archiveJson,
    JSON.stringify({
      api: "https://rpc.filebase.io",
      root: opts.uploadedCarRoot ?? asCbor,
      blocks: 1,
      gatewayUrl: `https://ipfs.filebase.io/ipfs/${carRoot.toString()}`,
      uploadedAt: "2026-10-21T16:00:00.000Z",
    }),
  );
  write(
    tablesJson,
    JSON.stringify({
      api: "https://rpc.filebase.io",
      root: opts.uploadedTablesRoot ?? tablesRoot.toString(),
      countyRoot: carRoot.toString(),
      parts: opts.uploadedParts ?? parts.length,
      gatewayUrl: `https://ipfs.filebase.io/ipfs/${tablesRoot.toString()}`,
      uploadedAt: "2026-10-21T16:01:00.000Z",
    }),
  );
  const group: GroupResult = {
    group: "county",
    groupDir: join(runDir, "groups/county"),
    carPath,
    carRoot: carRoot.toString(),
    blocks: 1,
    hashCsv: join(runDir, "reports/county-hash.csv"),
    dataGroupCids: [],
    tablesDir,
    tablesRoot: tablesRoot.toString(),
    tablesExportJson,
    uploads: { archiveJson, tablesJson },
  };
  return { runDir, group, parts, carRoot, tablesRoot };
}

interface GetCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
}

interface GatewayOptions {
  /** Responses per CID before the bytes are served: `[status, retryAfterSeconds?]`. */
  before?: Record<string, Array<[number, number?]>>;
  /** Delay each response (ms), to measure concurrency. */
  delayMs?: number;
}

/** A fake gateway serving `store` at https://<host>/ipfs/<cid>; records calls and in-flight peaks. */
function fakeGateway(store: Map<string, Uint8Array>, opts: GatewayOptions = {}) {
  const calls: GetCall[] = [];
  let inflight = 0;
  let peak = 0;
  const pending = new Map(Object.entries(opts.before ?? {}).map(([k, v]) => [k, [...v]]));
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
    });
    inflight += 1;
    peak = Math.max(peak, inflight);
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const cid = url.pathname.replace(/^\/ipfs\//, "");
      const queued = pending.get(cid)?.shift();
      if (queued) {
        const [status, retryAfter] = queued;
        return new Response("", {
          status,
          headers: retryAfter === undefined ? {} : { "retry-after": String(retryAfter) },
        });
      }
      const bytes = store.get(cid);
      return bytes ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 });
    } finally {
      inflight -= 1;
    }
  };
  return { fetch, calls, peak: () => peak };
}

function storeOf(f: Fixture): Map<string, Uint8Array> {
  return new Map(f.parts.map((p) => [p.cid, p.bytes]));
}

const sleeps: number[] = [];
const options = (fetch: FetchLike, extra: Partial<ReadbackOptions> = {}): ReadbackOptions => ({
  env: {},
  fetch,
  sleep: async (ms) => {
    sleeps.push(ms);
  },
  random: () => 1,
  ...extra,
});

describe("upload summaries", () => {
  it("parses the CAR and tables summaries elephant-cli upload --output-json writes", async () => {
    const f = await fixture();
    const car = readUploadSummary(f.group.uploads?.archiveJson as string, CarUploadSummary);
    expect(car).toMatchObject({ api: "https://rpc.filebase.io", blocks: 1 });
    const tables = readUploadSummary(f.group.uploads?.tablesJson as string, TablesUploadSummary);
    expect(tables).toMatchObject({ root: f.tablesRoot.toString(), parts: 3 });
    expect(() =>
      readUploadSummary(f.group.uploads?.archiveJson as string, TablesUploadSummary),
    ).toThrow();
  });

  it("lists the local parts in table/position order", async () => {
    const f = await fixture();
    expect(listTableParts(f.group.tablesDir)).toEqual([
      {
        table: "property",
        position: 0,
        path: f.parts[0]?.path,
        name: "property/part-00000.parquet",
      },
      {
        table: "structure",
        position: 0,
        path: f.parts[1]?.path,
        name: "structure/part-00000.parquet",
      },
      {
        table: "structure",
        position: 1,
        path: f.parts[2]?.path,
        name: "structure/part-00001.parquet",
      },
    ]);
  });
});

describe("readbackGroup", () => {
  it("passes when roots agree by digest, counts agree and every part matches size + SHA-256", async () => {
    const f = await fixture();
    const gw = fakeGateway(storeOf(f));
    const result = await readbackGroup(f.group, options(gw.fetch));
    expect(result.ok).toBe(true);
    expect(result.group).toBe("county");
    expect(result.rootMatches).toBe(true);
    expect(result.archiveRoot.ok).toBe(true);
    expect(result.archiveRoot.uploaded).not.toBe(f.carRoot.toString());
    expect(result.tablesRoot.ok).toBe(true);
    expect(result.partCount).toBe(3);
    expect(result.uploadedParts).toBe(3);
    expect(result.partCountMatches).toBe(true);
    expect(result.parts).toEqual(
      f.parts.map((p) => ({
        table: p.table,
        position: p.position,
        name: `${p.table}/part-${String(p.position).padStart(5, "0")}.parquet`,
        cid: p.cid,
        size: p.bytes.length,
        sha256: sha(p.bytes),
        ok: true,
      })),
    );
    expect(result.problems).toEqual([]);
    // Two parts are in flight at a time, so the GET order is not fixed; the set is.
    expect(gw.calls.map((c) => c.url.href).sort()).toEqual(
      f.parts.map((p) => `https://ipfs.filebase.io/ipfs/${p.cid}`).sort(),
    );
    for (const c of gw.calls) {
      expect(c.method).toBe("GET");
      expect(c.headers.range).toBeUndefined();
    }
  });

  it("reads the gateway host from FILEBASE_GATEWAY_HOST (default ipfs.filebase.io)", async () => {
    expect(FILEBASE_GATEWAY_HOST).toBe("ipfs.filebase.io");
    expect(filebaseGatewayHost({})).toBe("ipfs.filebase.io");
    expect(filebaseGatewayHost({ FILEBASE_GATEWAY_HOST: "gw.example.test" })).toBe(
      "gw.example.test",
    );
    const f = await fixture();
    const gw = fakeGateway(storeOf(f));
    const result = await readbackGroup(
      f.group,
      options(gw.fetch, { env: { FILEBASE_GATEWAY_HOST: "gw.example.test" } }),
    );
    expect(result.ok).toBe(true);
    expect(gw.calls.every((c) => c.url.host === "gw.example.test")).toBe(true);
  });

  it("fails a part whose served bytes differ (same size, other SHA-256)", async () => {
    const f = await fixture();
    const store = storeOf(f);
    const victim = f.parts[1] as Fixture["parts"][number];
    // Same length, last byte flipped: only the digest can tell.
    const tampered = Uint8Array.from(victim.bytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
    store.set(victim.cid, tampered);
    expect(store.get(victim.cid)?.length).toBe(victim.bytes.length);
    const result = await readbackGroup(f.group, options(fakeGateway(store).fetch));
    expect(result.ok).toBe(false);
    expect(result.parts.map((p) => p.ok)).toEqual([true, false, true]);
    expect(result.parts[1]?.sha256).toBe(sha(victim.bytes));
    expect(result.problems.join("\n")).toMatch(/structure\/part-00000\.parquet.*sha256/i);
  });

  it("fails a part served with an extra byte (size mismatch) and a part the gateway lacks", async () => {
    const f = await fixture();
    const store = storeOf(f);
    const first = f.parts[0] as Fixture["parts"][number];
    store.set(first.cid, new Uint8Array([...first.bytes, 0]));
    const third = f.parts[2] as Fixture["parts"][number];
    store.delete(third.cid);
    const result = await readbackGroup(f.group, options(fakeGateway(store).fetch));
    expect(result.ok).toBe(false);
    expect(result.parts.map((p) => p.ok)).toEqual([false, true, false]);
    expect(result.problems.join("\n")).toMatch(/property\/part-00000\.parquet.*size/i);
    expect(result.problems.join("\n")).toMatch(/structure\/part-00001\.parquet.*404/);
  });

  it("fails when the uploaded part count differs, before any GET", async () => {
    const f = await fixture({ uploadedParts: 2 });
    const gw = fakeGateway(storeOf(f));
    const result = await readbackGroup(f.group, options(gw.fetch));
    expect(result.ok).toBe(false);
    expect(result.partCountMatches).toBe(false);
    expect(result.partCount).toBe(3);
    expect(result.uploadedParts).toBe(2);
    expect(gw.calls).toHaveLength(0);
  });

  it("fails when the export summary's part count differs from the local parts", async () => {
    const f = await fixture({ exportParts: { structure: 1 } });
    const gw = fakeGateway(storeOf(f));
    const result = await readbackGroup(f.group, options(gw.fetch));
    expect(result.ok).toBe(false);
    expect(result.partCountMatches).toBe(false);
    expect(result.problems.join("\n")).toMatch(/export/i);
  });

  it("fails when an uploaded root has another digest; a codec difference alone is fine", async () => {
    const other = (await dagJsonCid({ label: "other" })).toString();
    const tables = await fixture({ uploadedTablesRoot: other });
    const r1 = await readbackGroup(tables.group, options(fakeGateway(storeOf(tables)).fetch));
    expect(r1.ok).toBe(false);
    expect(r1.rootMatches).toBe(false);
    expect(r1.tablesRoot).toEqual({
      expected: tables.tablesRoot.toString(),
      uploaded: other,
      ok: false,
    });
    expect(r1.archiveRoot.ok).toBe(true);
    const car = await fixture({ uploadedCarRoot: other });
    const r2 = await readbackGroup(car.group, options(fakeGateway(storeOf(car)).fetch));
    expect(r2.ok).toBe(false);
    expect(r2.archiveRoot.ok).toBe(false);
    expect(r2.tablesRoot.ok).toBe(true);
  });

  it("retries a 503 and a 429 (honouring Retry-After), then passes", async () => {
    const f = await fixture();
    const first = f.parts[0] as Fixture["parts"][number];
    const gw = fakeGateway(storeOf(f), { before: { [first.cid]: [[503], [429, 3]] } });
    sleeps.length = 0;
    const result = await readbackGroup(f.group, options(gw.fetch));
    expect(result.ok).toBe(true);
    expect(gw.calls.filter((c) => c.url.pathname.endsWith(first.cid))).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBe(3000);
  });

  it("gives up after the attempts are spent", async () => {
    const f = await fixture();
    const first = f.parts[0] as Fixture["parts"][number];
    const gw = fakeGateway(storeOf(f), {
      before: { [first.cid]: [[503], [503], [503], [503], [503], [503]] },
    });
    const result = await readbackGroup(f.group, options(gw.fetch, { attempts: 3 }));
    expect(result.ok).toBe(false);
    expect(gw.calls.filter((c) => c.url.pathname.endsWith(first.cid))).toHaveLength(3);
    expect(result.problems.join("\n")).toMatch(/503/);
  });

  it("fetches at most two parts at a time", async () => {
    const f = await fixture({ tables: { a: 3, b: 3 } });
    const gw = fakeGateway(storeOf(f), { delayMs: 15 });
    const result = await readbackGroup(f.group, options(gw.fetch));
    expect(result.ok).toBe(true);
    expect(result.partCount).toBe(6);
    expect(gw.peak()).toBe(2);
  });
});
