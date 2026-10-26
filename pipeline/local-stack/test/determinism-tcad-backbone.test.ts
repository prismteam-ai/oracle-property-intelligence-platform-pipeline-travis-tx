// A-04 determinism: the TcadBackbone.run handler replayed against its own journal, with the wall
// clock shifted and Math.random changed, must issue byte-identical ctx.set / ctx.run / ctx.sleep /
// call sequences (Restate replays the whole handler after a suspension; RT0016 otherwise).
import { mkdtempSync, mkdirSync } from "node:fs";
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
        for (let i = 0; i < 250; i += 1) {
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

describe("TcadBackbone.run replays deterministically", () => {
  it("same ctx.set / run / sleep / call sequence under a shifted clock and different Math.random", async () => {
    mkdirSync(join(h.dir, "run"), { recursive: true });
    const def = createService(restate, { race: strictRace as never }) as unknown as { workflow: { run: (c: unknown, r: unknown) => Promise<unknown> } };
    const run = def.workflow.run;
    const jobId = "travis-a04-20261022999999";
    const journal = new FakeJournal();
    let probes = 0;
    const onCall = (target: string, method: string, req: unknown) => {
      if (target === "TcadChunk") return outcome(req as ChunkSpec);
      return { rowsWritten: 0 };
    };
    const { first, second } = await recordThenReplay(journal, async () => {
      probes += 1;
      const ctx = journal.ctx(jobId, onCall);
      return run(ctx, { jobId, mode: "full", asOf: "2026-10-22", chunkSize: 100, window: 2, batchPauseMs: 1000 });
    });
    expect(probes).toBe(2);
    const progressSets = first.filter((o) => o.kind === "set" && o.payload.includes("records_per_s"));
    expect(progressSets.length).toBeGreaterThan(0);
    expect(second.map((o) => JSON.stringify(o))).toEqual(first.map((o) => JSON.stringify(o)));
  });
});
