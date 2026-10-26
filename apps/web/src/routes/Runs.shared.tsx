// Shared pieces of the run pages (A-13 T020/T021/T023: Runs, Compare, Coverage, Manifest,
// Verify). One load path: same-origin `/runs/index.json` → its latest entry (or the run the Runs
// menu chose) → the manifest by CID through the CID copy with the labelled Filebase fallback (fetch-by-cid, FR-016). A failure is
// either the index (FR-021 "Run index unavailable · {reason}", with a link to the file) or the
// manifest ("Manifest unavailable · {cid} · {reason}", the full CID in `data-cid`). The reason is
// the A-03 text (RUN_INDEX_TEXTS, BOTH_HOSTS_DOWN_TEXT, a CID mismatch) as its own element, so
// both the A-03 checks and the A-13 sentence read exactly. Not a route module (no `Component`).
import {
  RUNS_TEXTS,
  SOURCE_LABELS,
  VERIFY_TEXTS,
  isSourceName,
  sourceLabel,
} from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import styles from "./Runs.module.css";
import { Provenance } from "../components/Provenance";
import { readPathUrlsFromEnv } from "../data/config";
import { formatCount } from "../data/format";
import type { RunEvent } from "../data/run-events";
import { loadManifest, type LoadedManifest } from "../data/manifest";
import {
  RUN_STAGE_TEXTS,
  runErrorMessage,
  selectRun,
  type LoadedRun,
  type RunStage,
  type SelectedRun,
} from "../data/run-loader";
import {
  RUNS_INDEX_PATH,
  RunIndexError,
  loadRunsIndex,
  runIndexText,
  runName,
  type RunNumber,
} from "../data/runs-index";

export { RUN_STAGE_TEXTS };

export type RunLoadError =
  | { readonly kind: "index"; readonly reason: string }
  | { readonly kind: "manifest"; readonly cid: string; readonly reason: string };

export class RunLoadFailure extends Error {
  override readonly name = "RunLoadFailure";
  constructor(readonly failure: RunLoadError) {
    super(failure.reason);
  }
}

export type RunPageState =
  | { readonly kind: "loading"; readonly stage: RunStage }
  | { readonly kind: "ready"; readonly run: LoadedRun; readonly selected: SelectedRun }
  | { readonly kind: "error"; readonly error: RunLoadError };

/** The manifest by CID through the configured read path (copy, then the Filebase fallback). */
export async function loadManifestByCid(
  cid: string,
  signal?: AbortSignal,
): Promise<LoadedManifest> {
  try {
    return await loadManifest(cid, {
      urls: readPathUrlsFromEnv(),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new RunLoadFailure({ kind: "manifest", cid, reason: runErrorMessage(error) });
  }
}

/** Index → latest entry → manifest; throws RunLoadFailure naming which read failed. */
export async function loadLatestRun(
  signal: AbortSignal,
  onStage?: (stage: RunStage) => void,
  onIndex?: (index: LoadedRun["index"]) => void,
): Promise<LoadedRun> {
  return (await loadSelectedRun(signal, null, onStage, onIndex)).run;
}

/**
 * Index → the requested run (`runId`, else the latest; selectRun) → its manifest. The Runs page's
 * Run menu (A-16 PO note) reads an earlier run through the same path as the latest one.
 */
export async function loadSelectedRun(
  signal: AbortSignal,
  runId: string | null,
  onStage?: (stage: RunStage) => void,
  onIndex?: (index: LoadedRun["index"]) => void,
): Promise<{ readonly run: LoadedRun; readonly selected: SelectedRun }> {
  onStage?.("index");
  let index: LoadedRun["index"];
  try {
    index = await loadRunsIndex({ signal });
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof RunIndexError ? runIndexText(error.reason) : String(error);
    throw new RunLoadFailure({ kind: "index", reason });
  }
  const selected = selectRun(index, runId);
  const { entry } = selected;
  // A-16 T045 (A13-3, LCP): the run list is known as soon as the index is read; the page paints
  // it while the (much larger) manifest is still being fetched.
  onIndex?.(index);
  onStage?.("manifest");
  const { manifest, manifestCid, read } = await loadManifestByCid(entry.manifestCid, signal);
  try {
    // An unmapped manifest source is a build gap: fail loudly, never a blank (A-03).
    for (const source of manifest.sources) sourceLabel(source.name);
  } catch (error) {
    throw new RunLoadFailure({
      kind: "manifest",
      cid: manifestCid,
      reason: runErrorMessage(error),
    });
  }
  return { run: { index, entry, manifest, manifestCid, read }, selected };
}

export function toRunLoadError(error: unknown): RunLoadError {
  if (error instanceof RunLoadFailure) return error.failure;
  return { kind: "index", reason: runErrorMessage(error) };
}

/** The latest run for a page, with its loading stage, error and a retry. */
export function useLatestRun(): {
  readonly state: RunPageState;
  readonly retry: () => void;
  /** The run index once it is read, before the manifest (A-16 LCP: the list paints first). */
  readonly index: LoadedRun["index"] | undefined;
} {
  return useRun(null);
}

/**
 * The requested run (`runId`, else the latest) for a page. Choosing another run reloads only
 * that run; the index already read stays on screen meanwhile, so the Run menu does not flicker.
 */
export function useRun(runId: string | null): {
  readonly state: RunPageState;
  readonly retry: () => void;
  readonly index: LoadedRun["index"] | undefined;
} {
  const [state, setState] = useState<RunPageState>({ kind: "loading", stage: "index" });
  const [index, setIndex] = useState<LoadedRun["index"] | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const live = (): boolean => !controller.signal.aborted;
    setState({ kind: "loading", stage: "index" });
    loadSelectedRun(
      controller.signal,
      runId,
      (stage) => {
        if (live()) setState({ kind: "loading", stage });
      },
      (read) => {
        if (live()) setIndex(read);
      },
    ).then(
      ({ run, selected }) => {
        if (live()) setState({ kind: "ready", run, selected });
      },
      (error: unknown) => {
        if (live()) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
  }, [attempt, runId]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry, index: state.kind === "ready" ? state.run.index : index };
}

const MARK_A = "\u0000";
const MARK_B = "\u0001";

/** Fills a fixed text template from @countylens/shared with nodes, keeping its exact wording. */
function fill(template: string, a: ReactNode, b?: ReactNode): ReactNode[] {
  return template
    .split(new RegExp(`(${MARK_A}|${MARK_B})`))
    .map((part, i) =>
      part === MARK_A ? (
        <span key={i}>{a}</span>
      ) : part === MARK_B ? (
        <span key={i}>{b}</span>
      ) : (
        part
      ),
    );
}

/**
 * The ErrorBanner message for a run load error: the sentence keeps the reason, and for a manifest
 * the full CID, as separate elements.
 */
export function runErrorNode(error: RunLoadError): ReactNode {
  return (
    <>
      <span data-error-text="">
        {error.kind === "index"
          ? fill(RUNS_TEXTS.indexUnavailable(MARK_A), error.reason)
          : fill(
              RUNS_TEXTS.manifestUnavailable(MARK_A, MARK_B),
              <code data-cid={error.cid}>{error.cid}</code>,
              error.reason,
            )}
      </span>
      {error.kind === "index" ? (
        <>
          {" "}
          <a href={RUNS_INDEX_PATH}>{RUNS_INDEX_PATH}</a>
        </>
      ) : null}
    </>
  );
}

export type BarTone = "primary" | "added" | "changed" | "removed";

/**
 * A share bar drawn with the native `<progress>` element, so the width comes from `value` and
 * `max` and no inline style is needed (the web app bans them). `label` is its accessible name.
 */
export function ShareBar({
  value,
  max,
  label,
  tone = "primary",
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly tone?: BarTone;
}): ReactElement {
  const toneClass = `${styles.progress} ${styles[`bar_${tone}`] ?? ""}`;
  return (
    <progress
      className={toneClass}
      value={Math.max(0, value)}
      max={Math.max(1, max)}
      aria-label={label}
    />
  );
}

/**
 * Board "What Run N changed": one bar split into added, changed and removed, its length the share
 * of `scale` (one scale for the whole run). An SVG whose segment widths are attributes in viewBox
 * units, so no inline style is needed; `label` is its accessible name.
 */
export function ChangeBar({
  added,
  changed,
  removed,
  scale,
  label,
}: {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly scale: number;
  readonly label: string;
}): ReactElement {
  const max = Math.max(1, scale, added + changed + removed);
  const parts: readonly [BarTone, number][] = [
    ["added", Math.max(0, added)],
    ["changed", Math.max(0, changed)],
    ["removed", Math.max(0, removed)],
  ];
  let x = 0;
  return (
    <svg
      className={styles.changeBar}
      viewBox={`0 0 ${max} 1`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {parts.map(([tone, value]) => {
        const at = x;
        x += value;
        return value === 0 ? null : (
          <rect
            key={tone}
            className={styles[`fill_${tone}`]}
            x={at}
            y={0}
            width={value}
            height={1}
          />
        );
      })}
    </svg>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Oct 24` (UTC) for an ISO instant; the instant itself when it does not parse. */
export function shortDay(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

/**
 * `Run 3 · Oct 24` or `Pilot slice · Oct 21` (parity matrix R7): the run's name from the one rule
 * (runName, runNumbers; RUNS_TEXTS.numbering) and its finish day in UTC. The run ID stays visible
 * beside it where the page has room.
 */
export function runLabel(number: RunNumber, finishedAt: string): string {
  return `${runName(number)} · ${shortDay(finishedAt)}`;
}

/** The Log and Latest events wording of a manifest-derived event. */
export function eventLabel(event: RunEvent): string {
  if (event.kind === "started") return "Run started";
  if (event.kind === "finished") return "Run finished";
  const name = isSourceName(event.source) ? SOURCE_LABELS[event.source] : event.source;
  return `Captured ${name}`;
}

/** Per-source delta versus the previous run (FR-001c), or the first-run text. */
export function SourceDeltas({
  added,
  changed,
  removed,
  firstRun,
}: {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly firstRun: boolean;
}): ReactElement {
  if (firstRun) return <span>{RUNS_TEXTS.firstRun}</span>;
  return (
    <span>
      vs previous run: added <span data-delta="added">{formatCount(added)}</span> · changed{" "}
      <span data-delta="changed">{formatCount(changed)}</span> · removed{" "}
      <span data-delta="removed">{formatCount(removed)}</span>
    </span>
  );
}

/**
 * "Stored on" (A-16 T076, ARD § 16 AM-10): where the published bytes live. Filebase pins every
 * artifact; Pinata holds a second copy of every run manifest and of the latest run's table files
 * that fit its free quota (not every artifact); the run's GitHub Release holds the CARs as the
 * re-pinnable backup. Fixed wording from VERIFY_TEXTS; the provenance names the policy.
 */
export function StoredOn(): ReactElement {
  return (
    <section className={styles.card} aria-labelledby="stored-on-heading" data-stored-on="">
      <h3 id="stored-on-heading" className={styles.sectionTitle}>
        {VERIFY_TEXTS.storedOnTitle}
      </h3>
      <ul className={styles.list}>
        {VERIFY_TEXTS.storedOn.map((line) => (
          <li key={line} className={`${styles.item} ${styles.itemBody}`}>
            {line}
          </li>
        ))}
      </ul>
      <Provenance>{VERIFY_TEXTS.storedOnProvenance}</Provenance>
    </section>
  );
}
