// A-04 batched, safe full run: the pause and the health gate before each chunk, the progress
// counter, and the worker-count cap. Synthetic input only; sleeps and the probe are injected.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { a04Record } from "../../fixtures/a04/tcad/export.js";
import { sha256Text, type ExportRecordText } from "../../../travis/tcad/export-stream.js";
import {
  runTcadBackbone,
  type BackboneDeps,
  type BackboneInput,
  type ChunkOutcome,
  type ChunkSpec,
} from "../../../travis/tcad/workflow.js";
import {
  DEFAULT_BATCH_PAUSE_MS,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_WINDOW,
} from "../../../travis/backbone/batch-defaults.js";
import { capConcurrency, applyConcurrencyCap } from "../../../travis/backbone/concurrency.js";

const GIB = 1024 ** 3;
const rec = (i: number): ExportRecordText => {
  const t = JSON.stringify(a04Record({ pID: 9000 + i, geoID: `09000000${i}` }), null, 1);
  return { ordinal: i, text: t, sha256: sha256Text(t), bytes: Buffer.byteLength(t) };
};
const outcome = (spec: ChunkSpec): ChunkOutcome => ({
  n: spec.n,
  summary: {
    records: spec.records,
    loaded: spec.records,
    dead: 0,
    invalid: 0,
    transform_failure: 0,
    redacted: 0,
    by_prop_type: { R: spec.records },
  },
  dead: [],
  inventory: { pID: spec.records },
  mappedSha256: "a".repeat(64),
  zips: 0,
  coverage: null,
  typeStats: { fallback: 0, fallbackByState: {}, a4: 0, f4: 0 },
});

function harness(
  n: number,
  over: Partial<BackboneDeps> = {},
  inputOver: Partial<BackboneInput> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "a04-batched-"));
  let tick = 0;
  const sleeps: number[] = [];
  const progress: Array<Record<string, unknown>> = [];
  const input: BackboneInput = {
    jobId: "travis-a04-20261022050000",
    mode: "full",
    asOf: "2026-10-22",
    exportPath: join(dir, "x.zip"),
    receipt: {
      url: "https://example.test/x.zip",
      sha256: "c".repeat(64),
      captured_at: "2026-10-19T21:33:41Z",
    },
    runDir: join(dir, "run"),
    chunkSize: 1,
    window: 2,
    batchPauseMs: 2000,
    ...inputOver,
  };
  const deps: BackboneDeps = {
    step: async (_n, fn) => fn(),
    merge: async () => ({ rowsWritten: 0 }),
    verify: async () => ({ sha256: "c".repeat(64) }),
    waitForHuman: async () => {
      throw new Error("no wait");
    },
    download: async () => {
      throw new Error("no download");
    },
    runChunk: async (spec) => outcome(spec),
    listInputs: () => [],
    records: () =>
      (async function* () {
        for (let i = 0; i < n; i += 1) yield rec(i);
      })(),
    now: () => new Date(Date.UTC(2026, 9, 22, 5, 0, (tick += 2))),
    freeBytes: () => 100 * GIB,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    progress: (p) => {
      progress.push({ ...p });
    },
    ...over,
  };
  return { input, deps, sleeps, progress };
}

describe("safe batch defaults", () => {
  it("are 2000 records, 3 in flight, 1 s pause", () => {
    expect([DEFAULT_CHUNK_SIZE, DEFAULT_WINDOW, DEFAULT_BATCH_PAUSE_MS]).toEqual([2000, 3, 1000]);
  });
});

describe("the durable pause", () => {
  it("sleeps batchPauseMs before every chunk", async () => {
    const h = harness(3);
    await runTcadBackbone(h.input, h.deps);
    expect(h.sleeps).toEqual([2000, 2000, 2000]);
  });
  it("a pause of 0 does not sleep", async () => {
    const h = harness(2, {}, { batchPauseMs: 0 });
    await runTcadBackbone(h.input, h.deps);
    expect(h.sleeps).toEqual([]);
  });
});

describe("the health gate waits instead of failing", () => {
  it("backs off 10 s, 20 s, then continues once healthy", async () => {
    let calls = 0;
    const h = harness(1, { health: async () => (calls += 1) > 2 }, { batchPauseMs: 0 });
    const out = await runTcadBackbone(h.input, h.deps);
    expect(out.status).toBe("complete");
    expect(h.sleeps).toEqual([10_000, 20_000]);
  });
  it("caps the back-off at 60 s", async () => {
    let calls = 0;
    const h = harness(1, { health: async () => (calls += 1) > 6 }, { batchPauseMs: 0 });
    await runTcadBackbone(h.input, h.deps);
    expect(h.sleeps).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });
  it("a probe that throws counts as unhealthy", async () => {
    let calls = 0;
    const h = harness(
      1,
      {
        health: async () => {
          if ((calls += 1) === 1) throw new Error("connect ECONNREFUSED");
          return true;
        },
      },
      { batchPauseMs: 0 },
    );
    await runTcadBackbone(h.input, h.deps);
    expect(h.sleeps).toEqual([10_000]);
  });
  it("fails with a clear terminal message after 30 minutes of waiting", async () => {
    const h = harness(1, { health: async () => false }, { batchPauseMs: 0 });
    await expect(runTcadBackbone(h.input, h.deps)).rejects.toThrow(
      "health gate: Postgres/Docker unreachable for 30 min",
    );
    const total = h.sleeps.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(30 * 60_000);
    expect(total).toBeLessThan(32 * 60_000);
  });
});

describe("the progress counter", () => {
  it("reports chunks and records loaded (counts only)", async () => {
    const h = harness(3);
    await runTcadBackbone(h.input, h.deps);
    const last = h.progress.at(-1);
    expect(last).toMatchObject({ chunks_done: 3, chunks_started: 3, records_loaded: 3 });
    for (const p of h.progress)
      expect(Object.keys(p).sort()).toEqual([
        "chunks_done",
        "chunks_started",
        "chunks_total",
        "records_loaded",
        "records_per_s",
      ]);
  });
  it("reports records per second from elapsed time (records loaded / seconds)", async () => {
    const h = harness(3);
    await runTcadBackbone(h.input, h.deps);
    const last = h.progress.at(-1) as { records_per_s: number | null };
    expect(last.records_per_s).toBeGreaterThan(0);
    expect(h.progress[0]?.records_per_s).toBeNull();
  });
  it("a pilot knows the total (seed size / chunk size, rounded up)", async () => {
    const h = harness(3, {}, { chunkSize: 2, seedPids: ["9000", "9001", "9002"] });
    await runTcadBackbone(h.input, h.deps);
    expect(h.progress.at(-1)).toMatchObject({ chunks_total: 2 });
  });
});

describe("the worker-count cap", () => {
  it("caps the old large values at transform 6 / prepare 2", () => {
    expect(capConcurrency({ CONCURRENCY_TRANSFORM: "16", CONCURRENCY_PREPARE: "8" })).toEqual({
      transform: 6,
      prepare: 2,
    });
  });
  it("uses the safe default when unset or invalid, and keeps smaller values", () => {
    expect(capConcurrency({})).toEqual({ transform: 6, prepare: 2 });
    expect(capConcurrency({ CONCURRENCY_TRANSFORM: "x", CONCURRENCY_PREPARE: "0" })).toEqual({
      transform: 6,
      prepare: 2,
    });
    expect(capConcurrency({ CONCURRENCY_TRANSFORM: "1", CONCURRENCY_PREPARE: "1" })).toEqual({
      transform: 1,
      prepare: 1,
    });
  });
  it("TCAD_UNSAFE_CONCURRENCY=1 lifts the cap", () => {
    expect(
      capConcurrency({
        CONCURRENCY_TRANSFORM: "16",
        CONCURRENCY_PREPARE: "8",
        TCAD_UNSAFE_CONCURRENCY: "1",
      }),
    ).toEqual({ transform: 16, prepare: 8 });
  });
  it("TCAD_TRANSFORM_WORKERS (1..8) wins over the cap but never exceeds 8", () => {
    const base = { CONCURRENCY_TRANSFORM: "16", CONCURRENCY_PREPARE: "8" };
    expect(capConcurrency({ ...base, TCAD_TRANSFORM_WORKERS: "8" }).transform).toBe(8);
    expect(capConcurrency({ ...base, TCAD_TRANSFORM_WORKERS: "4" }).transform).toBe(4);
    expect(capConcurrency({ ...base, TCAD_TRANSFORM_WORKERS: "12" }).transform).toBe(8);
    expect(capConcurrency({ ...base, TCAD_TRANSFORM_WORKERS: "0" }).transform).toBe(6);
  });
  it("applyConcurrencyCap writes the capped values into the env it is given", () => {
    const env: Record<string, string | undefined> = {
      CONCURRENCY_TRANSFORM: "16",
      CONCURRENCY_PREPARE: "8",
    };
    applyConcurrencyCap(env);
    expect(env).toMatchObject({ CONCURRENCY_TRANSFORM: "6", CONCURRENCY_PREPARE: "2" });
  });
});
