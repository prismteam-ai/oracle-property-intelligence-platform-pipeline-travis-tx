// T024-T026 support (A-14, G-3/G-4): a loader for the committed `runs/index.json`
// (`RunsIndexV1`, contracts/manifest.md), used by `list_runs`, by the agent's latest-run default
// (`apps/api/src/agent/ask.ts`) and by every other tool's "no manifest_cid given -> use the
// latest published run" default.
//
// The index is a committed file served by the site at `/runs/index.json` (the Runs page reads it
// same-origin); it is NOT in the CID-copy bucket (which holds only `ipfs/*`). When
// `env.RUNS_INDEX_URL` is set (the hosted Lambdas: the CDK Api stack sets it to the site URL) this
// does one HTTPS GET (5 s timeout), requires a 2xx JSON body and Zod-validates it. Any failure
// (network, timeout, non-2xx, bad JSON, schema) throws -- never a default/empty index -- and the
// MCP adapters (tools.ts) turn that into the typed `run_not_found` envelope, never a guess.
//
// `RUNS_INDEX_URL` unset falls back to reading a local file path (`RUNS_INDEX_PATH_ENV`, default
// the repo-root `runs/index.json`) -- the legitimate case for the local stdio build
// (apps/api/src/mcp/stdio.ts, T027, which has no network dependency and reads a local export) and
// for tests.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RunsIndexV1 } from "@countylens/contract";

/** The HTTPS URL of the site's `/runs/index.json` (hosted Lambdas). */
export const RUNS_INDEX_URL_ENV = "RUNS_INDEX_URL";

const FETCH_TIMEOUT_MS = 5_000;

/** A-14 item 8: a fetched runs index is reused this long per sandbox (one GET per minute at most
 *  instead of one per tool call); a failed fetch is never cached. */
export const RUNS_INDEX_CACHE_MS = 60_000;

const urlCache = new Map<string, { readonly at: number; readonly index: RunsIndexV1 }>();

/** Tests only: forget the cached runs index. */
export function resetRunsIndexCache(): void {
  urlCache.clear();
}

/** Overrides the local-file fallback's default repo-root `runs/index.json` path (the stdio
 *  build, or tests). Only consulted when `RUNS_INDEX_URL` is unset. */
export const RUNS_INDEX_PATH_ENV = "RUNS_INDEX_PATH";

/** `apps/api/src/mcp/runs-index.ts` -> repo root is four directories up. */
function defaultRunsIndexPath(): string {
  return fileURLToPath(new URL("../../../../runs/index.json", import.meta.url));
}

export type RunsIndexEnv = Readonly<Record<string, string | undefined>>;

async function loadFromUrl(url: string, signal?: AbortSignal): Promise<RunsIndexV1> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  // T036: the caller's deadline (agent.ask's 23 s abort) also cancels this fetch.
  const response = await fetch(url, {
    signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
  });
  if (!response.ok) throw new Error(`runs index: GET ${url} answered ${response.status}`);
  return RunsIndexV1.parse(await response.json());
}

async function loadFromLocalFile(env: RunsIndexEnv): Promise<RunsIndexV1> {
  const path = env[RUNS_INDEX_PATH_ENV] ?? defaultRunsIndexPath();
  const text = await readFile(path, "utf8");
  return RunsIndexV1.parse(JSON.parse(text));
}

/** Reads and Zod-validates `runs/index.json`: from the site URL (`RUNS_INDEX_URL` set -- the
 *  hosted Lambdas) or from a local file (unset -- the stdio build, tests). Throws (never a
 *  default/empty index) on any failure. */
export async function loadRunsIndex(
  env: RunsIndexEnv = process.env,
  signal?: AbortSignal,
): Promise<RunsIndexV1> {
  const url = env[RUNS_INDEX_URL_ENV];
  if (url === undefined || url === "") return loadFromLocalFile(env);
  const cached = urlCache.get(url);
  if (cached !== undefined && Date.now() - cached.at < RUNS_INDEX_CACHE_MS) return cached.index;
  const index = await loadFromUrl(url, signal);
  urlCache.set(url, { at: Date.now(), index });
  return index;
}

export interface RunsIndexEntry {
  readonly runId: string;
  readonly manifestCid: string;
  readonly finishedAt: string;
}

/** The newest entry by `finishedAt`, or `undefined` for an empty index. Same ordering as
 *  query-core's `listRuns`. */
export function latestOf(index: Pick<RunsIndexV1, "runs">): RunsIndexEntry | undefined {
  return [...index.runs].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
}
