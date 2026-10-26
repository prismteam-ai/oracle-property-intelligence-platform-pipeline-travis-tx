#!/usr/bin/env node
// T027 (A-14/A-15 G-3): local stdio entry point for Claude Desktop / Claude Code and the MCP
// Inspector (docs/mcp.md). The same six tools and the same McpServer registrations
// (tools.ts/server.ts's `buildMcpServer`) as the hosted `/mcp` route, over `StdioServerTransport`
// instead of Streamable HTTP, and resolving "the run to read" from the local filesystem instead
// of SSM + presigned S3 GETs:
//   - `runs/index.json` and `runs/<runId>/manifest.json`, read directly (no S3, no manifest
//     presigning) — the repo-root files already committed (apps/api/src/mcp/runs-index.ts);
//   - the run's table parts, read directly by DuckDB's own Parquet reader off `RUNS_TABLES_DIR`
//     (export-tables' `<group>/<table>/part-*.parquet` layout) instead of s3-read.ts's presigned
//     `ipfs/<cid>` GETs.
// stdio has no network exposure, so there is no bearer-token check here (auth.ts/T017 guards only
// the hosted `/mcp` route) — this is a local dev tool, never the graded demo surface; docs/mcp.md
// points Claude Desktop/Code at this entry for development and at the hosted `/mcp` + bearer
// token for the graded demo.
//
// `RUNS_TABLES_DIR` is required to see real rows. Without it (or when a part file genuinely isn't
// there), `bindManifest` still succeeds — every required table the manifest's artifacts don't
// cover becomes an empty typed table (bind-manifest.ts's own behaviour) — so `get_schema`,
// `list_runs`, and `get_coverage` (coverage is a manifest field, not a table) always work, and
// `search_properties`/`list_permits`/`get_property` answer honestly empty rather than crash. A
// part the manifest *does* declare but that isn't on disk at `RUNS_TABLES_DIR` surfaces as a tool
// `isError` result (the SDK itself turns a thrown engine error into that, per its own
// `CallToolRequestSchema` handler) — never a fabricated row.
import { bindManifest, CONTRACT_VIEWS, type BoundRun } from "@countylens/query-core";
import { RunsIndexV1 } from "@countylens/contract";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDuckDb, type DuckDbEngine } from "../engine/duckdb-instance.js";
import { buildMcpServer } from "./server.js";
import { latestOf, loadRunsIndex, type RunsIndexEnv } from "./runs-index.js";
import type { McpRunContext, McpToolDeps } from "./tools.js";

/** The directory holding `<group>/<table>/part-*.parquet` for the run being bound (export-tables
 *  output layout, same contract as `apps/api/src/engine/duckdb-node.ts`'s presigned URLs). No
 *  default: a missing var means "no real table data available this session", not a guessed path. */
export const RUNS_TABLES_DIR_ENV = "RUNS_TABLES_DIR";

function manifestPath(runId: string): string {
  return fileURLToPath(new URL(`../../../../runs/${runId}/manifest.json`, import.meta.url));
}

/** The one call into `apps/api/src/engine/duckdb-instance.ts` (ESLint only allows DuckDB imports
 *  under an app's own src/engine directory, AD-19) — `httpfs`/`cacheRemoteReads` off, since every
 *  read here is a local file path, never a presigned URL. */
export async function openLocalDuckDb(): Promise<DuckDbEngine> {
  return openDuckDb({
    threads: 1,
    memoryLimit: "512MB",
    extensionDirectory: tmpdir(),
    tempDirectory: join(tmpdir(), "countylens-mcp-stdio"),
    httpfs: false,
  });
}

/** Builds `McpToolDeps` over one local DuckDB instance: binds whichever `manifestCid` is asked
 *  for (default: the latest entry of `runs/index.json`), reading table parts from
 *  `RUNS_TABLES_DIR`/<group>/<table>/<part> when that env var is set. */
export function createLocalDeps(env: RunsIndexEnv = process.env): McpToolDeps {
  const engine = openLocalDuckDb();
  const bound = new Map<string, Promise<BoundRun>>();

  async function bind(manifestCid: string, runId: string): Promise<BoundRun> {
    const cached = bound.get(manifestCid);
    if (cached) return cached;
    const run = (async (): Promise<BoundRun> => {
      const bytes = await readFile(manifestPath(runId));
      const db = await engine;
      const tablesDir = env[RUNS_TABLES_DIR_ENV] ?? "";
      return bindManifest(bytes, tablesDir, db, { views: CONTRACT_VIEWS });
    })();
    bound.set(manifestCid, run);
    return run;
  }

  return {
    async resolveRun(manifestCid): Promise<McpRunContext | undefined> {
      try {
        const index: Pick<RunsIndexV1, "runs"> = await loadRunsIndex(env);
        const entry =
          manifestCid === undefined
            ? latestOf(index)
            : index.runs.find((r) => r.manifestCid === manifestCid);
        if (entry === undefined) return undefined;
        const [db, run] = await Promise.all([engine, bind(entry.manifestCid, entry.runId)]);
        return { engine: db, bound: run };
      } catch {
        return undefined;
      }
    },
    runsIndex(): Promise<Pick<RunsIndexV1, "runs">> {
      return loadRunsIndex(env);
    },
  };
}

async function main(): Promise<void> {
  const server = buildMcpServer(createLocalDeps());
  await server.connect(new StdioServerTransport());
}

// Only run when this is the process entry point (so tests can import createLocalDeps/
// openLocalDuckDb without starting a stdio server).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error("countylens-mcp stdio: fatal error", error);
    process.exitCode = 1;
  });
}
