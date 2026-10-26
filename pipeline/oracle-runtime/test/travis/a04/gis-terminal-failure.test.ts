// A-04 (G-FIX): GisImport reports a terminal failure to onTerminalFailure (the local-stack binding
// closes the run row through the Loader), and not a refused request's neighbour states.
import { describe, expect, it } from "vitest";
import { createGisImport } from "../../../travis/gis/workflow.js";

class FakeTerminal extends Error {}
const fakeRestate = {
  workflow: (def: unknown) => def,
  TerminalError: FakeTerminal,
} as unknown as Parameters<typeof createGisImport>[0];
type Run = (ctx: unknown, req: unknown) => Promise<unknown>;

function handler(failed: string[]): Run {
  const def = createGisImport(fakeRestate, {
    merge: async () => ({ rowsWritten: 0, skipped: false }),
    onTerminalFailure: async (_ctx, jobId) => {
      failed.push(jobId);
    },
  }) as unknown as { handlers: { run: Run } };
  return def.handlers.run;
}
const ctx = (key: string) => ({
  key,
  run: async (_n: string, fn: () => unknown) => fn(),
});

describe("GisImport terminal failure", () => {
  it("a bad artifact (terminal) calls onTerminalFailure with the job id and rethrows", async () => {
    const failed: string[] = [];
    const run = handler(failed);
    await expect(
      run(ctx("travis-a04-coords-202610220600"), {
        artifactDir: "/nonexistent-artifact-dir",
        assemble: false,
        tcadJobId: null,
      }),
    ).rejects.toBeInstanceOf(FakeTerminal);
    expect(failed).toEqual(["travis-a04-coords-202610220600"]);
  });

  it("an invalid key never reaches onTerminalFailure (there is no run row to close)", async () => {
    const failed: string[] = [];
    await expect(
      handler(failed)(ctx("x"), { artifactDir: null, assemble: true, tcadJobId: null }),
    ).rejects.toBeInstanceOf(FakeTerminal);
    expect(failed).toEqual([]);
  });
});
