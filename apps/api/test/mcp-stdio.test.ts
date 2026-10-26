// A-14 unit coverage: the local stdio MCP build (src/mcp/stdio.ts). Real DuckDB (in-process, no
// network) and the SDK's in-memory transport in place of stdin/stdout. RUNS_INDEX_PATH points at a
// temp index. The one filesystem seam: node:fs/promises.readFile is wrapped so that the manifest of
// the fake run id "fixture-run" is served from a test fixture with no table parts (the committed
// runs/ manifests declare real parquet parts that are not in the repo); every other path is read
// for real, including the committed runs/<runId>/manifest.json used for the failure case.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fixtureManifest, type Fixture } from "./helpers/fakes.js";

const served = vi.hoisted(() => ({ bytes: undefined as Uint8Array | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: ((path: unknown, ...rest: unknown[]) =>
      typeof path === "string" && path.endsWith("/runs/fixture-run/manifest.json")
        ? Promise.resolve(Buffer.from(served.bytes ?? new Uint8Array()))
        : (actual.readFile as (...a: unknown[]) => Promise<unknown>)(
            path,
            ...rest,
          )) as typeof actual.readFile,
  };
});

import { buildMcpServer } from "../src/mcp/server.js";
import { asRun } from "../src/mcp/tools.js";
import { RUNS_TABLES_DIR_ENV, createLocalDeps, openLocalDuckDb } from "../src/mcp/stdio.js";

const COMMITTED = JSON.parse(
  readFileSync(new URL("../../../runs/index.json", import.meta.url), "utf8"),
) as { runs: Array<{ runId: string; manifestCid: string; finishedAt: string }> };
const REAL = COMMITTED.runs.at(-1);
if (REAL === undefined) throw new Error("runs/index.json has no runs");
const SLOW = 30_000;

let dir: string;
let fixture: Fixture;
let env: Record<string, string>;
let realEnv: Record<string, string>;

function indexFile(name: string, runs: unknown[]): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ schema: "oracle-travis-runs-index.v1", runs }));
  return file;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "countylens-stdio-"));
  fixture = await fixtureManifest({ runId: "fixture-run", parts: [] });
  served.bytes = fixture.bytes;
  env = {
    RUNS_INDEX_PATH: indexFile("fixture.json", [
      { runId: "fixture-run", manifestCid: fixture.cid, finishedAt: "2026-10-20T22:00:10.663Z" },
    ]),
  };
  realEnv = { RUNS_INDEX_PATH: indexFile("real.json", [REAL]) };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("stdio local deps", () => {
  it(
    "names the tables-dir env var and opens a local DuckDB that answers a query",
    async () => {
      expect(RUNS_TABLES_DIR_ENV).toBe("RUNS_TABLES_DIR");
      const db = await openLocalDuckDb();
      expect(await db.all("SELECT 42 AS answer")).toEqual([{ answer: 42 }]);
    },
    SLOW,
  );

  it(
    "resolves undefined for an unknown manifest_cid and for an unreadable index",
    async () => {
      const deps = createLocalDeps(env);
      await expect(deps.resolveRun(`ba${"z".repeat(60)}`)).resolves.toBeUndefined();
      await expect(
        createLocalDeps({ RUNS_INDEX_PATH: join(dir, "missing.json") }).resolveRun(),
      ).resolves.toBeUndefined();
      await expect(deps.runsIndex()).resolves.toMatchObject({ runs: [{ runId: "fixture-run" }] });
    },
    SLOW,
  );

  it(
    "resolves undefined (run_not_found) when the manifest declares parts that are not on disk",
    async () => {
      const deps = createLocalDeps(realEnv); // RUNS_TABLES_DIR unset, committed manifest has parts
      await expect(deps.resolveRun()).resolves.toBeUndefined();
    },
    SLOW,
  );

  it(
    "binds the latest run (cached on the second call) and serves six tools over MCP",
    async () => {
      const deps = createLocalDeps(env);
      const first = await deps.resolveRun();
      expect(asRun(first)?.bound.runId).toBe("fixture-run");
      expect(asRun(first)?.bound.manifestCid).toBe(fixture.cid);
      const again = await deps.resolveRun(fixture.cid);
      expect(asRun(again)?.bound).toBe(asRun(first)?.bound); // one bind per manifest_cid

      const server = buildMcpServer(deps);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "stdio-test", version: "0.0.0" });
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
      try {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(6);

        const schema = (await client.callTool({
          name: "get_schema",
          arguments: {},
        })) as unknown as {
          structuredContent: { views: Array<{ name: string }> };
        };
        expect(schema.structuredContent.views.map((v) => v.name)).toContain("v_property");

        const runs = (await client.callTool({ name: "list_runs", arguments: {} })) as unknown as {
          structuredContent: { latest: { manifest_cid: string } };
        };
        expect(runs.structuredContent.latest.manifest_cid).toBe(fixture.cid);

        const cov = (await client.callTool({ name: "get_coverage", arguments: {} })) as unknown as {
          structuredContent: { coverage: unknown; run: { run_id: string }; empty_reason?: string };
        };
        expect(cov.structuredContent.run.run_id).toBe("fixture-run");
        expect(cov.structuredContent.coverage).toEqual(fixture.manifest.coverage);
      } finally {
        await client.close();
      }
    },
    SLOW,
  );
});
