// The Hub's light read of `/runs/index.json` (A-13 T035; research R9): only the two fields the
// chip needs, checked by hand so the Hub's initial graph carries no schema library. The Runs,
// Coverage, Manifest, Catalog and Log pages read the same file through runs-index.ts, which
// validates the whole file against `RunsIndexV1`; an index this reader accepts but that schema
// rejects shows the chip here and the full banner there.
import { browserFetch, requestInit } from "./http";
import { numberRuns, runName } from "./run-numbers";

export const HUB_INDEX_PATH = "/runs/index.json";

export interface HubRun {
  readonly runId: string;
  readonly manifestCid: string;
  readonly finishedAt: string;
}

export class HubIndexError extends Error {
  override readonly name = "HubIndexError";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** GET the run index; throws HubIndexError with a plain reason. */
export async function loadHubRuns(signal?: AbortSignal): Promise<HubRun[]> {
  let response: Response;
  try {
    response = await browserFetch(HUB_INDEX_PATH, requestInit(signal));
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new HubIndexError("the run index could not be read from this site", { cause: error });
  }
  if (response.status !== 200) {
    throw new HubIndexError("the run index could not be read from this site");
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new HubIndexError("the run index could not be read from this site");
  }
  const runs = isRecord(data) ? data.runs : undefined;
  if (!Array.isArray(runs))
    throw new HubIndexError("the run index could not be read from this site");
  if (runs.length === 0) throw new HubIndexError("no runs published yet");
  return runs.map((run): HubRun => {
    if (
      !isRecord(run) ||
      typeof run.runId !== "string" ||
      typeof run.manifestCid !== "string" ||
      typeof run.finishedAt !== "string" ||
      Number.isNaN(Date.parse(run.finishedAt))
    ) {
      throw new HubIndexError("the run index could not be read from this site");
    }
    return { runId: run.runId, manifestCid: run.manifestCid, finishedAt: run.finishedAt };
  });
}

/**
 * The latest run's name ("Run N" or "Pilot slice", the one rule in run-numbers.ts) and instant;
 * the header badge and the Hub chip show it.
 */
export function latestChip(runs: readonly HubRun[]): {
  readonly name: string;
  readonly finishedAt: string;
} {
  const ordered = [...runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
  const latest = ordered[ordered.length - 1] as HubRun;
  return {
    name: runName(numberRuns(runs).get(latest.runId) ?? null),
    finishedAt: latest.finishedAt,
  };
}
