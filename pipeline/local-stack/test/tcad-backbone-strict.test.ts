// A-04 live bug (job travis-a04-20261022051731): "[500 Internal] awaitNext already pending". The
// SDK allows one pending awaitNext per context and every .then/.catch/await on a RestatePromise
// registers one; a handler on each in-flight TcadChunk call plus the loop's own ctx.date.now /
// ctx.run / ctx.sleep made a second. The strict fake context throws the same error.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it, vi } from "vitest";
import { sha256Text, type ExportRecordText } from "../../oracle-runtime/travis/tcad/export-stream.js";
import type { ChunkSpec } from "../../oracle-runtime/travis/tcad/workflow.js";
import { FakeJournal, strictRace, recordThenReplay } from "../../oracle-runtime/test/travis/a04/fake-restate-ctx.js";

const h = vi.hoisted(() => ({ dir: "", healthy: true }));

vi.mock("../../oracle-runtime/travis/tcad/export-source.js", async () => {
  const { mkdtempSync: mk } = await import("node:fs");
  const { tmpdir: td } = await import("node:os");
  const { join: j } = await import("node:path");
  h.dir = mk(j(td(), "a04-det-"));
  return {
    exportSource: () => ({
      exportPath: j(h.dir, "x.zip"),
      receipt: { url: "https://example.test/x.zip", sha256: "c".repeat(64), captured_at: "2026-10-19T21:33:41Z" },
    }),
    runDirFor: () => j(h.dir, "run"),
  };
});
vi.mock("../../oracle-runtime/travis/tcad/export-verify.js", async (orig) => ({
  ...(await orig<object>()),
  verifyExport: async () => ({ sha256: "c".repeat(64) }),
}));
vi.mock("../../oracle-runtime/travis/tcad/export-stream.js", async (orig) => {
  const real = await orig<typeof import("../../oracle-runtime/travis/tcad/export-stream.js")>();
  return {
    ...real,
    streamExportRecords: () =>
      (async function* () {
        for (let i = 0; i < 500; i += 1) {
          const text = JSON.stringify({ pID: 9000 + i });
          yield { ordinal: i, text, sha256: real.sha256Text(text), bytes: text.length } satisfies ExportRecordText;
        }
      })(),
  };
});
vi.mock("../services/loader.js", async (orig) => ({
  ...(await orig<object>()),
  lazyQueryDb: () => () => (async () => [{ ok: 1 }]) as never,
}));

import { createService } from "../services/workflows/tcad-backbone.js";

const outcome = (spec: ChunkSpec) => ({
  n: spec.n,
  summary: { records: spec.records, loaded: spec.records, dead: 0, invalid: 0, transform_failure: 0, redacted: 0, by_prop_type: { R: spec.records } },
  dead: [],
  inventory: { pID: spec.records },
  mappedSha256: "a".repeat(64),
  zips: 0,
  coverage: null,
  typeStats: { fallback: 0, fallbackByState: {}, a4: 0, f4: 0 },
});

const jobId = "travis-a04-20261022999998";
type Run = (c: unknown, r: unknown) => Promise<{ chunks: number; summary: { loaded: number } }>;
const service = () =>
  (createService(restate, { race: strictRace as never }) as unknown as { workflow: { run: Run } }).workflow.run;
const req = { jobId, mode: "full", asOf: "2026-10-22", chunkSize: 100, window: 3, batchPauseMs: 1000 };

describe("TcadBackbone.run keeps at most one await pending (strict context)", () => {
  it("window of 3 chunk calls in flight while date.now / disk-guard / sleep / health run", async () => {
    mkdirSync(join(h.dir, "run"), { recursive: true });
    const inflightMax = { now: 0, max: 0 };
    const onCall = (target: string, _m: string, r: unknown) => {
      if (target !== "TcadChunk") return { rowsWritten: 0 };
      inflightMax.now += 1;
      inflightMax.max = Math.max(inflightMax.max, inflightMax.now);
      return new Promise((res) =>
        setTimeout(() => {
          inflightMax.now -= 1;
          res(outcome(r as ChunkSpec));
        }, 15),
      );
    };
    const result = await service()(new FakeJournal().ctx(jobId, onCall, false), req);
    expect(result.chunks).toBe(5);
    expect(result.summary.loaded).toBe(500);
    expect(inflightMax.max).toBe(3);
  });

  it("a chunk failing while the stream loop still runs is reported at the next await, not as unhandledRejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const onCall = (target: string, _m: string, r: unknown) => {
        if (target !== "TcadChunk") return { rowsWritten: 0 };
        const spec = r as ChunkSpec;
        return new Promise((res, rej) =>
          setTimeout(() => (spec.n === 0 ? rej(new Error("chunk 0 failed")) : res(outcome(spec))), spec.n === 0 ? 1 : 15),
        );
      };
      await expect(service()(new FakeJournal().ctx(jobId, onCall, false), req)).rejects.toThrow("chunk 0 failed");
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
