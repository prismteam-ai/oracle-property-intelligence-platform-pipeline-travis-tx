// A-04 determinism: TcadChunk.run replayed against its journal with a different disk reading,
// clock and Math.random must issue the same operations (the free-space reading is journaled).
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it, vi } from "vitest";
import { FakeJournal, recordThenReplay } from "../../oracle-runtime/test/travis/a04/fake-restate-ctx.js";

vi.mock("../../oracle-runtime/travis/tcad/chunk.js", () => ({
  prepareChunk: async () => ({ n: 0, mappedSha256: "a".repeat(64), summary: { records: 1, loaded: 1 } }),
  cleanupChunk: () => {},
}));

import { createService } from "./../services/workflows/tcad-chunk.js";

const GIB = 1024 ** 3;

describe("TcadChunk.run replays deterministically", () => {
  it("a replay that reads less free space still follows the journaled path", async () => {
    let reading = 100 * GIB;
    const def = createService(restate, { freeBytes: () => reading }) as unknown as {
      service: { run: (c: unknown, s: unknown) => Promise<unknown> };
    };
    const journal = new FakeJournal();
    const spec = { jobId: "travis-a04-20261022999999", n: 0, inputPath: "/nope/x", inputSha256: "a".repeat(64), mappedPath: "/nope/y" };
    const { first, second } = await recordThenReplay(journal, async (pass) => {
      reading = pass === 1 ? 100 * GIB : 1 * GIB;
      return def.service.run(journal.ctx("c0", () => ({ rowsWritten: 0 })), spec);
    });
    expect(first.length).toBeGreaterThan(2);
    expect(second.map((o) => JSON.stringify(o))).toEqual(first.map((o) => JSON.stringify(o)));
  });
});
