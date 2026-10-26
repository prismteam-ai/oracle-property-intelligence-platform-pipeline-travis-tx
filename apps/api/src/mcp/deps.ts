// The hosted engine wiring of `McpToolDeps`, shared by the MCP Lambda (handlers/mcp.ts) and the
// in-process "Try a tool" proxy (routers/mcp-proxy.ts). `resolveRun` binds the AD-18 DuckDB engine
// (src/engine/duckdb-node.ts) to the caller's `manifest_cid` or the latest `runs/index.json`
// entry. A-16 (A14-6, AC-13): an unknown run still resolves to `undefined` (`run_not_found`), but a
// runs index that cannot be read is `run_lookup_failed`, and a run without a usable Explore index
// is `index_not_built` / `index_stale` — each a typed failure src/mcp/tools.ts reports as
// `isError`, never a guessed or empty answer. Nothing here reads a secret or the MCP token.
import type { RunsIndexV1 } from "@countylens/contract";
import {
  bindOnce,
  getEngine,
  interruptQueries,
  ownerAreaPublished,
} from "../engine/duckdb-node.js";
import { isIndexUnavailable } from "../engine/explore-index.js";
import { lazyViewEngine } from "../engine/lazy-views.js";
import { latestOf, loadRunsIndex } from "./runs-index.js";
import {
  RUN_LOOKUP_FAILED_MESSAGE,
  type McpRunContext,
  type McpRunFailure,
  type McpToolDeps,
} from "./tools.js";

export function createEngineDeps(): McpToolDeps {
  return {
    async resolveRun(manifestCid): Promise<McpRunContext | McpRunFailure | undefined> {
      let cid = manifestCid;
      if (cid === undefined) {
        try {
          const latest = latestOf(await loadRunsIndex());
          if (latest === undefined) return undefined;
          cid = latest.manifestCid;
        } catch {
          return { failure: "run_lookup_failed", message: RUN_LOOKUP_FAILED_MESSAGE };
        }
      }
      try {
        const [bound, engine] = await Promise.all([bindOnce(cid, ["v_run"]), getEngine()]);
        const runCid = cid;
        return {
          engine: lazyViewEngine(engine, runCid),
          bound,
          ownerAreaPublished: () => ownerAreaPublished(runCid),
        };
      } catch (error) {
        if (isIndexUnavailable(error)) return { failure: error.reason, message: error.message };
        return undefined;
      }
    },
    runsIndex(): Promise<Pick<RunsIndexV1, "runs">> {
      return loadRunsIndex();
    },
    interrupt(): void {
      interruptQueries();
    },
  };
}
