// A-14 unit coverage: createEngineDeps (src/mcp/deps.ts), the hosted wiring shared by the MCP
// Lambda and the tRPC proxy. The DuckDB edge (bindOnce/getEngine) is mocked; the runs-index loader,
// latestOf and lazyViewEngine are the real code, with the index served from a temp file.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryEngine, Row } from "@countylens/query-core";

const edge = vi.hoisted(() => ({ bindOnce: vi.fn(), getEngine: vi.fn() }));
vi.mock("../src/engine/duckdb-node.js", () => ({
  bindOnce: edge.bindOnce,
  getEngine: edge.getEngine,
}));

import { createEngineDeps } from "../src/mcp/deps.js";
import { asRun } from "../src/mcp/tools.js";

const CID1 = `ba${"a".repeat(60)}`;
const CID2 = `ba${"b".repeat(60)}`;
const BOUND = { runId: "r", manifestCid: CID2, asOf: "x", tables: [], views: [] };

let dir: string;
const saved: Record<string, string | undefined> = {};

function writeIndex(runs: unknown[]): void {
  const file = join(dir, "index.json");
  writeFileSync(file, JSON.stringify({ schema: "oracle-travis-runs-index.v1", runs }));
  process.env.RUNS_INDEX_PATH = file;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "countylens-deps-"));
  for (const k of ["RUNS_INDEX_URL", "RUNS_INDEX_PATH"]) saved[k] = process.env[k];
  delete process.env.RUNS_INDEX_URL;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const sqlLog: string[] = [];
const baseEngine: QueryEngine = {
  async run(sql: string): Promise<void> {
    sqlLog.push(sql);
  },
  async all(sql: string): Promise<Row[]> {
    sqlLog.push(sql);
    return [];
  },
};

beforeEach(() => {
  edge.bindOnce.mockReset();
  edge.getEngine.mockReset();
  edge.bindOnce.mockResolvedValue(BOUND);
  edge.getEngine.mockResolvedValue(baseEngine);
  sqlLog.length = 0;
  writeIndex([
    { runId: "a", manifestCid: CID1, finishedAt: "2026-01-01T00:00:00.000Z" },
    { runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" },
  ]);
});

describe("createEngineDeps().resolveRun", () => {
  it("binds the named manifest_cid without reading the runs index", async () => {
    process.env.RUNS_INDEX_PATH = join(dir, "does-not-exist.json"); // would throw if it were read
    const ctx = await createEngineDeps().resolveRun(CID1);
    expect(asRun(ctx)?.bound).toBe(BOUND);
    expect(edge.bindOnce).toHaveBeenCalledWith(CID1, ["v_run"]);
  });

  it("falls back to the newest run of the runs index when no manifest_cid is given", async () => {
    const ctx = await createEngineDeps().resolveRun(undefined);
    expect(asRun(ctx)?.bound).toBe(BOUND);
    expect(edge.bindOnce).toHaveBeenCalledWith(CID2, ["v_run"]);
  });

  it("returns an engine that lazily binds only the views a statement reads", async () => {
    const ctx = await createEngineDeps().resolveRun(CID1);
    edge.bindOnce.mockClear();
    await asRun(ctx)?.engine.all("SELECT 1");
    expect(edge.bindOnce).not.toHaveBeenCalled();
    await asRun(ctx)?.engine.all("SELECT * FROM v_roofing_permit");
    expect(edge.bindOnce).toHaveBeenCalledTimes(1);
    expect(edge.bindOnce.mock.calls[0]?.[0]).toBe(CID1);
    expect(edge.bindOnce.mock.calls[0]?.[1]).toContain("v_roofing_permit");
    expect(sqlLog).toEqual(["SELECT 1", "SELECT * FROM v_roofing_permit"]);
  });

  it("resolves undefined (never throws) when the index has no runs", async () => {
    writeIndex([]);
    await expect(createEngineDeps().resolveRun()).resolves.toBeUndefined();
    expect(edge.bindOnce).not.toHaveBeenCalled();
  });

  it("A14-6: an unreadable runs index is run_lookup_failed; a failed bind of a named run is run_not_found", async () => {
    process.env.RUNS_INDEX_PATH = join(dir, "missing.json");
    await expect(createEngineDeps().resolveRun()).resolves.toMatchObject({
      failure: "run_lookup_failed",
    });
    edge.bindOnce.mockRejectedValue(new Error("bind failed"));
    await expect(createEngineDeps().resolveRun(CID1)).resolves.toBeUndefined();
  });
});

describe("createEngineDeps().runsIndex", () => {
  it("returns the validated runs index and rejects when it is unreadable", async () => {
    const index = await createEngineDeps().runsIndex();
    expect(index.runs.map((r) => r.runId)).toEqual(["a", "b"]);
    process.env.RUNS_INDEX_PATH = join(dir, "missing.json");
    await expect(createEngineDeps().runsIndex()).rejects.toThrow();
  });
});
