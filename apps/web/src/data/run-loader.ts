// The Runs page's load, as one async function (A-03 T042, G-C3; data-model § "Runs page
// state"): the same-origin run index → its latest entry → the manifest by CID through the
// copy/fallback read → the parsed RunManifestV1. The stage text feeds the progress bar's
// `aria-valuetext`; `runErrorMessage` maps every failure to the text the error banner shows
// (fixed texts from @countylens/shared; a CID mismatch or an unmapped source keeps its own
// message, so the page never shows a blank).
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { sourceLabel, type ReadPathUrls } from "@countylens/shared";
import { BothHostsDownError, type FetchByCidResult } from "./fetch-by-cid";
import { loadManifest } from "./manifest";
import { byFinish, numberRuns, type RunNumber } from "./run-numbers";
import {
  RunIndexError,
  latestRun,
  loadRunsIndex,
  runIndexText,
  type RunsIndexEntry,
} from "./runs-index";

export type RunStage = "index" | "manifest";

/** Stage texts of the Runs progress bar (`aria-valuetext`; plan § Atlas element map → Progress). */
export const RUN_STAGE_TEXTS: Readonly<Record<RunStage, string>> = {
  index: "Reading the run index",
  manifest: "Reading the manifest by CID",
};

export interface LoadRunOptions {
  readonly urls: ReadPathUrls;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onStage?: (stage: RunStage) => void;
}

export interface LoadedRun {
  readonly index: RunsIndexV1;
  readonly entry: RunsIndexEntry;
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
  readonly read: FetchByCidResult;
}

export async function loadRun(options: LoadRunOptions): Promise<LoadedRun> {
  const io = {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  options.onStage?.("index");
  const index = await loadRunsIndex(io);
  const entry = latestRun(index);

  options.onStage?.("manifest");
  const { manifest, manifestCid, read } = await loadManifest(entry.manifestCid, {
    urls: options.urls,
    ...io,
  });
  // An unmapped manifest source is a build gap: fail loudly, never a blank (data-model § UI mappings).
  for (const source of manifest.sources) sourceLabel(source.name);

  return { index, entry, manifest, manifestCid, read };
}

/** The run a page shows: the requested run of the index, else the latest one. */
export interface SelectedRun {
  readonly entry: RunsIndexEntry;
  /** The run's number (RUNS_TEXTS.numbering, runNumbers); `null` for the pilot slice. */
  readonly number: RunNumber;
  readonly isLatest: boolean;
  /** The requested run ID when the index has no such run (the page then shows the latest). */
  readonly notFound: string | null;
}

/**
 * The Run menu's choice (A-16 PO note, `/runs?run=<runId>`): the entry with `runId`, or the
 * latest run when no run is requested or the index has no such run (`notFound` names it, so the
 * page can say why it shows another run instead of a blank).
 */
export function selectRun(index: RunsIndexV1, runId: string | null): SelectedRun {
  const ordered = byFinish(index.runs);
  const latest = latestRun(index);
  const wanted =
    runId === null || runId === "" ? undefined : ordered.find((r) => r.runId === runId);
  const entry = wanted ?? latest;
  return {
    entry,
    number: numberRuns(index.runs).get(entry.runId) ?? null,
    isLatest: entry === latest,
    notFound: wanted === undefined && runId !== null && runId !== "" ? runId : null,
  };
}

/** The error-banner text for a failed load (plan § "Fixed texts"; FR-002, FR-005(c)). */
export function runErrorMessage(error: unknown): string {
  if (error instanceof RunIndexError) return runIndexText(error.reason);
  if (error instanceof BothHostsDownError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
