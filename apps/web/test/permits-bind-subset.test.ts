// The hosted Permits page bound every table of the run (~225 parts of a full run: ~1,200 requests,
// ~90 s before COUNT ran) although its COUNT and listing read only v_roofing_permit. The page now
// binds only the tables those views read (bindManifest({ views }), ERR-19) and prefetches only
// their parts, so a small subset is fetched with the loader's own throttled, CID-verified path
// instead of being range-read by DuckDB. jsdom, no network: the engine and `fetchParts` are fakes.
import { describe, expect, it, vi } from "vitest";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import type { BoundRun, QueryEngine } from "@countylens/query-core";
import { readPathUrls } from "@countylens/shared";
import {
  partsToPrefetch,
  PART_PREFETCH_MAX_BYTES,
  type PartToFetch,
} from "../src/data/fetch-parts";
import {
  COUNT_PERMITS_SQL,
  PERMITS_VIEWS,
  bindRun,
  permitsPartNames,
} from "../src/engine/duckdb-wasm";
import { createPermitsLoader, type EngineModule } from "../src/engine/load-permits";

const bindManifestSpy = vi.hoisted(() => vi.fn());
vi.mock("@countylens/query-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@countylens/query-core")>();
  return { ...original, bindManifest: bindManifestSpy };
});

const cid = (tag: string): string => `bafkrei${tag}`.padEnd(59, "a");
const BATCHES = ["b01", "b02", "b03", "b04"];
const COUNTY_TABLES = ["property", "structure", "sales_history", "geometry"];
const PERMIT_TABLES = [
  "property_improvement",
  "property_has_property_improvement",
  "property_improvement_has_contractor",
  "company",
];
const MB = 1024 * 1024;

/** Real batched names (AD-0001); the unread tables are the large ones, as in a full run. */
function artifacts(): RunManifestV1["artifacts"] {
  const part = (name: string, size: number) => ({
    kind: "table",
    name,
    cid: cid(name.replace(/\W/g, "")),
    size,
    sha256: "0".repeat(64),
  });
  return [
    ...BATCHES.flatMap((b) =>
      COUNTY_TABLES.map((t) =>
        part(
          `run/county-batched/tables/${b}/${t}/part-00000.parquet`,
          t === "property" ? MB : 6 * MB,
        ),
      ),
    ),
    ...["b01", "b02"].flatMap((b) =>
      PERMIT_TABLES.map((t) => part(`run/permits-batched/tables/${b}/${t}/part-00000.parquet`, MB)),
    ),
    { kind: "car", name: "car/x.car", cid: cid("car"), size: 99 * MB, sha256: "0".repeat(64) },
  ] as unknown as RunManifestV1["artifacts"];
}

describe("the Permits page binds only v_roofing_permit's tables", () => {
  it("reads v_roofing_permit only: the COUNT and the listing select from nothing else", () => {
    expect(PERMITS_VIEWS).toEqual(["v_roofing_permit"]);
    expect(COUNT_PERMITS_SQL).toContain("v_roofing_permit");
  });

  it("bindRun hands bindManifest the Permits views and the read path's partUrl", async () => {
    const bound: BoundRun = { runId: "r", manifestCid: "m", asOf: "x", tables: [], views: [] };
    bindManifestSpy.mockResolvedValueOnce(bound);
    const engine = {} as QueryEngine;
    const bytes = new Uint8Array([1]);
    const partUrl = (a: { name: string; cid: string }): string => `https://served.test/${a.cid}`;
    await expect(bindRun(engine, bytes, partUrl)).resolves.toBe(bound);
    expect(bindManifestSpy).toHaveBeenCalledTimes(1);
    expect(bindManifestSpy).toHaveBeenCalledWith(bytes, "", engine, {
      partUrl,
      views: ["v_roofing_permit"],
    });
  });

  it("permitsPartNames: the county property part of every batch and four tables per permits batch (the printed contractor company, ERR-66), 4 + 8 of 24", () => {
    const all = artifacts();
    const names = permitsPartNames({ artifacts: all });
    expect(names.sort()).toEqual(
      [
        ...BATCHES.map((b) => `run/county-batched/tables/${b}/property/part-00000.parquet`),
        ...["b01", "b02"].flatMap((b) =>
          [
            "property_improvement",
            "property_has_property_improvement",
            "property_improvement_has_contractor",
            "company",
          ].map((t) => `run/permits-batched/tables/${b}/${t}/part-00000.parquet`),
        ),
      ].sort(),
    );
    expect(all.filter((a) => a.kind === "table")).toHaveLength(24);
  });

  it("partsToPrefetch(only): the subset fits the cap that the whole run exceeds", () => {
    const all = artifacts();
    const subset = new Set(permitsPartNames({ artifacts: all }));
    expect(partsToPrefetch({ artifacts: all })).toBeNull();
    const wanted = partsToPrefetch({ artifacts: all }, PART_PREFETCH_MAX_BYTES, subset);
    expect(wanted?.map((p) => p.name).sort()).toEqual([...subset].sort());
    expect(wanted?.every((p) => p.size === MB)).toBe(true);
  });
});

describe("createPermitsLoader fetches and registers only the Permits tables' parts", () => {
  const manifestCid = cid("manifest");
  const index: RunsIndexV1 = {
    schema: "oracle-travis-runs-index.v1",
    runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
  };
  const urls = readPathUrls({ cidCopyHost: "copy.test", filebaseGatewayHost: "gateway.test" });

  it("prefetches 12 of 24 parts from the CID copy, and binds with the registered names", async () => {
    const all = artifacts();
    const manifest = {
      runId: "test-run",
      coverage: { permits_emitted: { count: 2, derivation: "published_rows" } },
      artifacts: all,
    } as unknown as RunManifestV1;
    const registered: string[] = [];
    const engine = {
      registerFile: async (name: string) => void registered.push(name),
      run: async () => undefined,
      all: async () => [],
      close: async () => undefined,
    } as unknown as QueryEngine & { close(): Promise<void> };
    const fetchedNames: string[] = [];
    const engineModule: EngineModule = {
      openEngine: vi.fn(async () => engine) as unknown as EngineModule["openEngine"],
      permitsPartNames,
      bindRun: vi.fn(async () => ({
        runId: "test-run",
        manifestCid,
        asOf: "x",
        tables: [],
        views: [],
      })),
      countPermits: vi.fn(async () => 2),
      listPermits: vi.fn(async () => []),
    };
    const load = createPermitsLoader({
      loadRunsIndex: async () => index,
      latestRun: (i) => i.runs[0] as RunsIndexV1["runs"][number],
      loadManifest: async () => ({
        manifest,
        manifestCid,
        read: {
          cid: manifestCid,
          bytes: new Uint8Array(),
          source: { kind: "copy" as const, host: "copy.test" },
          partUrl: (a) => urls.copyUrl(a.cid),
        },
      }),
      fetchParts: async (parts: readonly PartToFetch[]) => {
        fetchedNames.push(...parts.map((p) => p.name));
        return parts.map((p) => ({ ...p, bytes: new Uint8Array(1) }));
      },
      fallbackLabel: () => null,
      urls,
      engine: async () => engineModule,
    });
    await load(() => undefined, new AbortController().signal);
    expect(fetchedNames.sort()).toEqual(permitsPartNames({ artifacts: all }).sort());
    expect(fetchedNames).toHaveLength(12);
    expect(registered).toHaveLength(12);
    expect(engineModule.bindRun).toHaveBeenCalledTimes(1);
  });

  it("a Permits subset above PERMITS_PREFETCH_MAX_BYTES stays with DuckDB's range reads (fetchParts not called)", async () => {
    const big = artifacts().map((a) =>
      a.kind === "table" ? { ...a, size: 8 * MB } : a,
    ) as unknown as RunManifestV1["artifacts"];
    const manifest = {
      runId: "test-run",
      coverage: { permits_emitted: { count: 0, derivation: "published_rows" } },
      artifacts: big,
    } as unknown as RunManifestV1;
    const engine = {
      registerFile: async () => undefined,
      run: async () => undefined,
      all: async () => [],
      close: async () => undefined,
    } as unknown as QueryEngine & { close(): Promise<void> };
    const fetchParts = vi.fn(async () => []);
    const engineModule: EngineModule = {
      openEngine: vi.fn(async () => engine) as unknown as EngineModule["openEngine"],
      permitsPartNames,
      bindRun: vi.fn(async () => ({
        runId: "test-run",
        manifestCid,
        asOf: "x",
        tables: [],
        views: [],
      })),
      countPermits: vi.fn(async () => 0),
      listPermits: vi.fn(async () => []),
    };
    const load = createPermitsLoader({
      loadRunsIndex: async () => index,
      latestRun: (i) => i.runs[0] as RunsIndexV1["runs"][number],
      loadManifest: async () => ({
        manifest,
        manifestCid,
        read: {
          cid: manifestCid,
          bytes: new Uint8Array(),
          source: { kind: "copy" as const, host: "copy.test" },
          partUrl: (a) => urls.copyUrl(a.cid),
        },
      }),
      fetchParts,
      fallbackLabel: () => null,
      urls,
      engine: async () => engineModule,
    });
    await load(() => undefined, new AbortController().signal);
    expect(fetchParts).not.toHaveBeenCalled();
  });
});
