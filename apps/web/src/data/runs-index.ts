// The committed run index (A-03 T042, G-C3; interface fixed by T007 for T048): served
// same-origin from `/runs/index.json` (copied into apps/web/public at build, T044) and checked
// against `RunsIndexV1`. Missing, non-JSON or schema mismatch → `unreadable`; `runs: []` →
// `empty` (FR-002, TC-014); the page maps both to RUN_INDEX_TEXTS. The latest entry is the run
// the pages show. No value here is a fixture: the file is written by the publish step only.
import { RunsIndexV1 } from "@countylens/contract";
import { RUN_INDEX_TEXTS } from "@countylens/shared";
import { browserFetch, requestInit, throwIfAborted } from "./http";
import { byFinish, numberRuns, numberedByFinish, runName, type RunNumber } from "./run-numbers";

export {
  PILOT_RUN_IDS,
  PILOT_SLICE_LABEL,
  isPilotRun,
  runName,
  type RunNumber,
} from "./run-numbers";

export const RUNS_INDEX_PATH = "/runs/index.json";

export type RunsIndexEntry = RunsIndexV1["runs"][number];

export type RunIndexFailure = "unreadable" | "empty";

export class RunIndexError extends Error {
  override readonly name = "RunIndexError";

  constructor(
    readonly reason: RunIndexFailure,
    options?: { readonly cause?: unknown },
  ) {
    super(`run index ${reason}`, options);
  }
}

export interface LoadRunsIndexOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** GET RUNS_INDEX_PATH; throws RunIndexError("unreadable") or RunIndexError("empty"). */
export async function loadRunsIndex(options: LoadRunsIndexOptions = {}): Promise<RunsIndexV1> {
  const fetchImpl = options.fetch ?? browserFetch;
  let response: Response;
  try {
    response = await fetchImpl(RUNS_INDEX_PATH, requestInit(options.signal));
  } catch (error) {
    throwIfAborted(options.signal);
    throw new RunIndexError("unreadable", { cause: error });
  }
  if (response.status !== 200) {
    throw new RunIndexError("unreadable", {
      cause: new Error(`${RUNS_INDEX_PATH} answered ${response.status}`),
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.text());
  } catch (error) {
    throw new RunIndexError("unreadable", { cause: error });
  }
  const parsed = RunsIndexV1.safeParse(data);
  if (!parsed.success) throw new RunIndexError("unreadable", { cause: parsed.error });
  if (parsed.data.runs.length === 0) throw new RunIndexError("empty");
  return parsed.data;
}

/** The entry with the greatest `finishedAt` (the index is ordered; the last one). */
export function latestRun(index: RunsIndexV1): RunsIndexEntry {
  let latest: RunsIndexEntry | undefined;
  for (const run of index.runs) {
    if (latest === undefined || Date.parse(run.finishedAt) >= Date.parse(latest.finishedAt)) {
      latest = run;
    }
  }
  if (latest === undefined) throw new RunIndexError("empty");
  return latest;
}

/** The fixed banner text for a RunIndexError (plan § "Fixed texts"; the only source is shared). */
export function runIndexText(reason: RunIndexFailure): string {
  return RUN_INDEX_TEXTS[reason];
}

/** The index's runs oldest first (by `finishedAt`), the pilot slice included. */
export function runsByFinish(index: RunsIndexV1): RunsIndexEntry[] {
  return byFinish(index.runs);
}

/** The numbered runs oldest first (RUNS_TEXTS.numbering): Run N is entry N-1; no pilot run. */
export function numberedRuns(index: RunsIndexV1): RunsIndexEntry[] {
  return numberedByFinish(index.runs);
}

/**
 * The Compare page's query for two runs (label review 2026-10-26): Compare reads `a` and `b` as
 * positions among the numbered runs oldest first, not as run-ID numbers ("3.1" is position 4), so
 * a link built from run names opened the wrong pair. Empty when either run is not numbered.
 */
export function compareQuery(index: RunsIndexV1, olderRunId: string, newerRunId: string): string {
  const runs = numberedRuns(index);
  const a = runs.findIndex((r) => r.runId === olderRunId) + 1;
  const b = runs.findIndex((r) => r.runId === newerRunId) + 1;
  return a === 0 || b === 0 ? "" : `?a=${a}&b=${b}`;
}

/**
 * Each run's number by run ID (RUNS_TEXTS.numbering, run-numbers.ts): 1..n over the non-pilot
 * runs in finish order, `null` for the pilot slice. The same "Run N" the header badge, Hub, Runs,
 * Compare, Log, Coverage, Catalog and the Manifest chain show.
 */
export function runNumbers(index: RunsIndexV1): ReadonlyMap<string, RunNumber> {
  return numberRuns(index.runs);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Oct 25, 2026` (UTC) for an ISO instant; the instant itself when it does not parse. */
export function runDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * A run in a run picker (PO 2026-10-26: a run list with only the run and its date is a dropdown):
 * `Run 3 · Oct 25, 2026` or `Pilot slice · Oct 21, 2026` (runName, runNumbers).
 */
export function runOptionLabel(number: RunNumber, finishedAt: string): string {
  return `${runName(number)} · ${runDate(finishedAt)}`;
}
