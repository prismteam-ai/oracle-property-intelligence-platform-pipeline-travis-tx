// A-11 Run 3 (ADR 0004): GisImport loads the address-point layer cache through the Loader gis
// track (kind address_points) before assembling, and `backbone coords --address-points` feeds it.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGisImport, type GisMergeInput } from "../../../travis/gis/workflow.js";
import { command } from "../../../travis/backbone/commands/coords.js";

class FakeTerminal extends Error {}
const fakeRestate = {
  workflow: (def: unknown) => def,
  TerminalError: FakeTerminal,
} as unknown as Parameters<typeof createGisImport>[0];
type Run = (ctx: unknown, req: unknown) => Promise<Record<string, unknown>>;
const ctx = {
  key: "travis-a04-coords-20261025000000",
  run: async (_n: string, fn: () => unknown) => fn(),
};

function handler(seen: GisMergeInput[]): Run {
  const def = createGisImport(fakeRestate, {
    merge: async (_c, input) => {
      seen.push(input);
      return { rowsWritten: input.kind === "address_points" ? 7 : 3, skipped: false };
    },
  }) as unknown as { handlers: { run: Run } };
  return def.handlers.run;
}

function cacheDir(receipt: unknown): string {
  const d = mkdtempSync(join(tmpdir(), "addr-cache-"));
  writeFileSync(join(d, "receipt.json"), JSON.stringify(receipt));
  return d;
}

describe("GisImport address points", () => {
  it("loads the layer first, then assembles, using the receipt sha256", async () => {
    const sha = "a".repeat(64);
    const dir = cacheDir({ sha256: sha, record_count: 12 });
    const seen: GisMergeInput[] = [];
    const out = await handler(seen)(ctx, {
      artifactDir: null,
      assemble: true,
      tcadJobId: null,
      addressPointsDir: dir,
    });
    expect(seen.map((s) => s.kind)).toEqual(["address_points", "assemble"]);
    expect(seen[0]).toMatchObject({ artifactPath: dir, artifactSha256: sha });
    expect(out.addressPoints).toEqual({
      sha256: sha,
      recordCount: 12,
      rowsWritten: 7,
      skipped: false,
    });
  });

  it("an old request without addressPointsDir still works and loads nothing", async () => {
    const seen: GisMergeInput[] = [];
    const out = await handler(seen)(ctx, { artifactDir: null, assemble: true, tcadJobId: null });
    expect(seen.map((s) => s.kind)).toEqual(["assemble"]);
    expect(out.addressPoints).toBeNull();
  });

  it("a cache without a usable receipt is a terminal error and merges nothing", async () => {
    const seen: GisMergeInput[] = [];
    await expect(
      handler(seen)(ctx, {
        artifactDir: null,
        assemble: true,
        tcadJobId: null,
        addressPointsDir: cacheDir({ nope: true }),
      }),
    ).rejects.toBeInstanceOf(FakeTerminal);
    expect(seen).toEqual([]);
  });
});

describe("backbone coords --address-points", () => {
  it("is accepted with --assemble-only and refused alone", () => {
    expect(command.args.safeParse({ assembleOnly: true, addressPoints: "/x" }).success).toBe(true);
    expect(command.args.safeParse({ addressPoints: "/x", gisArtifact: "/y" }).success).toBe(false);
  });
});
