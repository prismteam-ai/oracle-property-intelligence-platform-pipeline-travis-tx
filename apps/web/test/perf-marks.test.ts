// A-03 TC-NF-01 / TC-NF-02 instrumentation: the Permits engine emits User Timing marks and
// measures, so the hosted Playwright specs read `performance.getEntriesByType('measure')` instead
// of a debug hook on `window`. The entries carry names and times only (no detail, no data):
// `countylens:duckdb:init` (between the `…:init:start` / `…:init:end` marks), the listing
// `countylens:query:list` and the page's own COUNT `countylens:query:count`. A failed step
// emits no measure, so a timing always belongs to a completed step.
// Red run (before the instrumentation): `Cannot find module '../src/engine/timing'`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import type { QueryEngine, Row } from "@countylens/query-core";
import { PERMITS_TEXTS, readPathUrls } from "@countylens/shared";
import {
  COUNT_PERMITS_SQL,
  countPermits,
  listPermits,
  openEngine,
  type ArrowTableLike,
  type AsyncDuckDbLike,
  type DuckDbRuntime,
} from "../src/engine/duckdb-wasm";
import { createPermitsLoader, type EngineModule } from "../src/engine/load-permits";
import { PERF_MARKS, PERF_MEASURES } from "../src/engine/timing";

const measures = (): PerformanceEntry[] => performance.getEntriesByType("measure");
const measureNames = (): string[] => measures().map((m) => m.name);
const markNames = (): string[] => performance.getEntriesByType("mark").map((m) => m.name);

function runtime(options: { failOpen?: boolean } = {}): DuckDbRuntime {
  const empty: ArrowTableLike = { schema: { fields: [] }, toArray: () => [] };
  const db: AsyncDuckDbLike = {
    instantiate: async () => undefined,
    open: async () => {
      if (options.failOpen) throw new Error("open failed (fake)");
    },
    connect: async () => ({ query: async () => empty, close: async () => undefined }),
    registerFileBuffer: async () => undefined,
    terminate: async () => undefined,
  };
  return {
    extensions: [],
    bundle: {
      mainModule: "/m.wasm",
      mainModuleEncoding: "identity",
      mainWorker: "/w.js",
      pthreadWorker: null,
    },
    createDb: () => db,
  };
}

const VALID_ROW: Row = {
  permit_number: "TEST-0001",
  improvement_status: "Permitted",
  status_class: "open",
  issue_date: "2026-09-03",
  final_date: null,
  permit_close_date: null,
  open_days: 28,
  contractor_resolution: "resolved",
  contractor_name_as_printed: null,
  bbb_url: null,
  cid: "bafkreitest".padEnd(59, "a"),
  source_url: "https://example.test/permit/1",
  captured_at: "2026-10-01T00:00:00.000Z",
  table: "property_improvement/property_improvement",
  table_cid: "bafkreitable".padEnd(59, "a"),
  run_id: "test-run",
  manifest_cid: "bafkreimanifest".padEnd(59, "a"),
  as_of: "2026-10-01T00:00:00.000Z",
  missing: [],
};

function engineReturning(rows: (sql: string) => Row[]): QueryEngine {
  return { run: async () => undefined, all: async (sql) => rows(sql) };
}

beforeEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});
afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

describe("User Timing names (fixed; the hosted specs read them)", () => {
  it("names the init marks and the three measures", () => {
    expect(PERF_MARKS).toStrictEqual({
      initStart: "countylens:duckdb:init:start",
      initEnd: "countylens:duckdb:init:end",
    });
    expect(PERF_MEASURES).toStrictEqual({
      init: "countylens:duckdb:init",
      list: "countylens:query:list",
      count: "countylens:query:count",
    });
  });
});

describe("openEngine: countylens:duckdb:init", () => {
  it("marks start and end and measures the engine start once", async () => {
    const engine = await openEngine(() => Promise.resolve(runtime()));
    expect(markNames()).toEqual(expect.arrayContaining([PERF_MARKS.initStart, PERF_MARKS.initEnd]));
    const init = measures().filter((m) => m.name === PERF_MEASURES.init);
    expect(init).toHaveLength(1);
    expect(init[0]?.duration).toBeGreaterThanOrEqual(0);
    await engine.close();
  });

  it("emits no init measure when the engine cannot start", async () => {
    await expect(openEngine(() => Promise.resolve(runtime({ failOpen: true })))).rejects.toThrow();
    expect(measureNames()).not.toContain(PERF_MEASURES.init);
  });
});

describe("listPermits / countPermits: countylens:query:list and countylens:query:count", () => {
  it("measures the listing query once per call, with no detail attached", async () => {
    await listPermits(engineReturning(() => [VALID_ROW]));
    await listPermits(engineReturning(() => [VALID_ROW]));
    const list = measures().filter((m) => m.name === PERF_MEASURES.list);
    expect(list).toHaveLength(2);
    for (const m of list) expect((m as PerformanceMeasure).detail ?? null).toBeNull();
  });

  it("runs the page's own COUNT over v_roofing_permit and measures it", async () => {
    const seen: string[] = [];
    const n = await countPermits(
      engineReturning((sql) => {
        seen.push(sql);
        return [{ n: 37 }];
      }),
    );
    expect(n).toBe(37);
    expect(seen).toEqual([COUNT_PERMITS_SQL]);
    expect(COUNT_PERMITS_SQL).toMatch(/count\(\*\)[\s\S]*FROM v_roofing_permit/i);
    expect(measureNames().filter((name) => name === PERF_MEASURES.count)).toHaveLength(1);
  });

  it("emits no measure for a failed query", async () => {
    const failing: QueryEngine = {
      run: async () => undefined,
      all: async () => {
        throw new Error("query failed (fake)");
      },
    };
    await expect(countPermits(failing)).rejects.toThrow();
    await expect(listPermits(failing)).rejects.toThrow();
    expect(measureNames()).toEqual([]);
  });

  it("refuses a COUNT result that is not one integer row", async () => {
    await expect(countPermits(engineReturning(() => []))).rejects.toThrow(/COUNT/);
    await expect(countPermits(engineReturning(() => [{ n: "37" }]))).rejects.toThrow(/COUNT/);
  });
});

describe("createPermitsLoader runs the COUNT and checks it against the manifest (FR-009)", () => {
  const manifestCid = "bafkreimanifest".padEnd(59, "a");
  const index: RunsIndexV1 = {
    schema: "oracle-travis-runs-index.v1",
    runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
  };

  function loader(engineCount: number, emitted: number) {
    const manifest = {
      runId: "test-run",
      coverage: { permits_emitted: { count: emitted, derivation: "published_rows" } },
      artifacts: [],
    } as unknown as RunManifestV1;
    const engine = {
      registerFile: async () => undefined,
      run: async () => undefined,
      all: async () => [],
      close: async () => undefined,
    };
    const engineModule: EngineModule = {
      openEngine: vi.fn(async () => engine),
      permitsPartNames: (m) => m.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
      bindRun: vi.fn(async () => ({
        runId: "test-run",
        manifestCid,
        asOf: "x",
        tables: [],
        views: [],
      })),
      countPermits: vi.fn(async () => engineCount),
      listPermits: vi.fn(async () => []),
    };
    return {
      engineModule,
      load: createPermitsLoader({
        loadRunsIndex: async () => index,
        latestRun: (i) => i.runs[0] as RunsIndexV1["runs"][number],
        loadManifest: async () => ({
          manifest,
          manifestCid,
          read: {
            cid: manifestCid,
            bytes: new Uint8Array(),
            source: { kind: "copy" as const, host: "copy.test" },
            partUrl: () => "https://copy.test/x",
          },
        }),
        fallbackLabel: () => null,
        urls: readPathUrls({ cidCopyHost: "copy.test", filebaseGatewayHost: "gateway.test" }),
        engine: async () => engineModule,
      }),
    };
  }

  it("counts before listing", async () => {
    const l = loader(0, 0);
    await l.load(() => undefined, new AbortController().signal);
    const countOrder = vi.mocked(l.engineModule.countPermits).mock.invocationCallOrder[0] ?? 0;
    const listOrder = vi.mocked(l.engineModule.listPermits).mock.invocationCallOrder[0] ?? 0;
    expect(countOrder).toBeGreaterThan(0);
    expect(countOrder).toBeLessThan(listOrder);
  });

  it("fails with the fixed count-mismatch text when the engine COUNT differs from the manifest", async () => {
    const l = loader(36, 37);
    await expect(l.load(() => undefined, new AbortController().signal)).rejects.toThrow(
      PERMITS_TEXTS.countMismatch(36, 37),
    );
    expect(l.engineModule.listPermits).not.toHaveBeenCalled();
  });
});
