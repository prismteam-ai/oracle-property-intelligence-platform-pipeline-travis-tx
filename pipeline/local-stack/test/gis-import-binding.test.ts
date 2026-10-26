// A-04 T043: the GisImport Restate binding (services/workflows/gis-import.ts). The real workflow
// (oracle-runtime travis/gis/workflow.ts) runs over a fake journaled context and a tiny synthetic
// runner artifact written under a temp dir. Loader calls are answered by a fake; nothing is served.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as restate from "@restatedev/restate-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeJournal } from "../../oracle-runtime/test/travis/a04/fake-restate-ctx.js";
import { createService } from "../services/workflows/gis-import.js";

const JOB = "travis-a04-coords-202610220100";
type Def = { name: string; workflow: { run: (ctx: unknown, input: unknown) => Promise<unknown> } };
const def = createService(restate) as unknown as Def;

let root: string;
const SHA = "a".repeat(64);

/** A runner artifact with no pages: valid config, count, empty receipts, `loc=US` egress. */
function writeArtifact(dir: string, withComplete: boolean): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "egress.txt"), "loc=US\n");
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      mode: "full",
      layerUrl: "https://example.test/arcgis/rest/services/parcels/FeatureServer/0",
      pidField: "PID",
      geoidField: null,
      objectIdField: "OBJECTID",
      layerLastEditDate: null,
    }),
  );
  writeFileSync(join(dir, "count.json"), JSON.stringify({ count: 0 }));
  writeFileSync(join(dir, "receipts.jsonl"), "");
  if (withComplete) {
    writeFileSync(
      join(dir, "complete.json"),
      JSON.stringify({
        mode: "full",
        pages: 0,
        features: 0,
        started_at: "2026-10-22T00:00:00Z",
        finished_at: "2026-10-22T00:01:00Z",
        duration_s: 60,
        features_per_s: 0,
        snapshot_sha256: SHA,
        source_count: 0,
        page_size: 1000,
        concurrency: 1,
        object_id_field: "OBJECTID",
        layer_last_edit_date: null,
      }),
    );
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "a04-gis-binding-"));
  writeArtifact(join(root, "complete-run"), true);
  writeArtifact(join(root, "incomplete-run"), false);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(input: unknown, key = JOB) {
  const journal = new FakeJournal();
  const calls: Array<[string, string, unknown]> = [];
  const ctx = journal.ctx(key, (target, method, request) => {
    calls.push([target, method, request]);
    return method === "failRun" ? { failed: true } : { rowsWritten: 7, skipped: false };
  });
  return { calls, journal, result: def.workflow.run(ctx, input) };
}

describe("GisImport binding", () => {
  it("registers the GisImport workflow", () => {
    expect(def.name).toBe("GisImport");
  });

  it("imports a complete artifact through Loader.merge on the gis track (import, then assemble)", async () => {
    const dir = join(root, "complete-run");
    const { calls, result } = run({ artifactDir: dir, assemble: true, tcadJobId: null });
    const out = (await result) as {
      jobId: string;
      gis: Record<string, unknown>;
      assembled: unknown;
    };
    expect(out.jobId).toBe(JOB);
    expect(out.gis).toMatchObject({
      status: "complete",
      detail: "complete",
      limitation: null,
      pages: 0,
      rowsWritten: 7,
    });
    expect(out.assembled).toEqual({ rowsWritten: 7, skipped: false });
    expect(calls.map(([t, m]) => `${t}.${m}`)).toEqual([
      "Loader/travis.merge",
      "Loader/travis.merge",
    ]);
    const [imp, asm] = calls.map(
      ([, , r]) => r as { track: string; input: Record<string, unknown> },
    );
    expect(imp?.track).toBe("gis");
    expect(imp?.input).toMatchObject({
      kind: "import",
      jobId: JOB,
      artifactPath: dir,
      artifactRunId: "complete-run",
    });
    expect(imp?.input.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asm?.input).toMatchObject({
      kind: "assemble",
      jobId: JOB,
      artifactPath: `assemble:${JOB}`,
      tcadJobId: null,
    });
  });

  it("an artifact without complete.json imports as blocked, never complete", async () => {
    const dir = join(root, "incomplete-run");
    const { calls, result } = run({ artifactDir: dir, assemble: false, tcadJobId: null });
    const out = (await result) as {
      gis: { status: string; detail: string; limitation: string };
      assembled: unknown;
    };
    expect(out.gis.status).toBe("blocked");
    expect(out.gis.detail).toBe("partial");
    expect(out.gis.limitation).toMatch(/^gis: blocked at .+; coverage not complete$/);
    expect(out.assembled).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("assemble-only goes straight to the assemble merge, scoped to a TCAD job", async () => {
    const tcad = "travis-a04-tcad-pilot-202610220000";
    const { calls, result } = run({ artifactDir: null, assemble: true, tcadJobId: tcad });
    const out = (await result) as { gis: unknown };
    expect(out.gis).toBeNull();
    expect(calls).toHaveLength(1);
    expect((calls[0]?.[2] as { input: { tcadJobId: string } }).input.tcadJobId).toBe(tcad);
  });

  it("a bad artifact is a terminal error and closes the run row via Loader.failRun", async () => {
    const { calls, result } = run({
      artifactDir: join(root, "does-not-exist"),
      assemble: false,
      tcadJobId: null,
    });
    await expect(result).rejects.toBeInstanceOf(restate.TerminalError);
    expect(calls).toEqual([["Loader/travis", "failRun", { jobId: JOB }]]);
  });

  it.each([
    ["nothing to do", { artifactDir: null, assemble: false, tcadJobId: null }],
    ["a malformed request", { artifactDir: 5 }],
  ])("refuses %s as a terminal failure and fails the row", async (_name, input) => {
    const { calls, result } = run(input);
    await expect(result).rejects.toBeInstanceOf(restate.TerminalError);
    expect(calls).toEqual([["Loader/travis", "failRun", { jobId: JOB }]]);
  });

  it("refuses a key that is not a travis-a04 job id without touching the Loader", async () => {
    const { calls, result } = run(
      { artifactDir: null, assemble: true, tcadJobId: null },
      "bad-key",
    );
    await expect(result).rejects.toThrow(/key must be a travis-a04 job id/);
    expect(calls).toEqual([]);
  });
});
