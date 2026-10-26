// A-04 determinism: the AustinPermits body replayed against its journal, with the clock shifted,
// Math.random changed and the file system different, issues the same operations.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runAustinPermits,
  type PermitsDeps,
  type PermitsIO,
} from "../../../travis/permits/workflow.js";
import { FakeJournal, recordThenReplay } from "./fake-restate-ctx.js";

describe("AustinPermits body replays deterministically", () => {
  it("a stop reads the receipts file once; a replay sends the journaled value", async () => {
    const root = mkdtempSync(join(tmpdir(), "a04-det-permits-"));
    const jobId = "travis-a04-permits-incremental-1";
    const deps: PermitsDeps = {
      client: {} as PermitsDeps["client"],
      artifactsRoot: root,
      readWatermark: async () => null, // no backfill watermark: the run stops (failed)
      limitations: () => [],
    };
    const journal = new FakeJournal();
    const { first, second } = await recordThenReplay(journal, async (pass) => {
      if (pass === 2) {
        mkdirSync(join(root, jobId), { recursive: true });
        writeFileSync(join(root, jobId, "receipts.jsonl"), "{}\n");
      }
      const ctx = journal.ctx(jobId, () => ({ rowsWritten: 0, tombstones: 0 }));
      const io: PermitsIO = {
        now: async () => new Date(await ctx.date.now()),
        sleep: (ms) => ctx.sleep(ms),
        run: (name, fn) => ctx.run(name, fn),
        merge: async (name, input) => {
          const out = await ctx.objectClient({ name: "Loader" }, "travis").merge({ name, input });
          return out as never;
        },
        fail: (m) => new Error(m),
      };
      return runAustinPermits(io, { jobId, mode: "incremental" }, deps);
    });
    expect(first.some((o) => o.name === "receipts-present")).toBe(true);
    expect(second.map((o) => JSON.stringify(o))).toEqual(first.map((o) => JSON.stringify(o)));
  });
});
