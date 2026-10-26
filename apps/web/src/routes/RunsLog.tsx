// Runs · Log (`/runs/log`; A-13 T040, US9, AC-12, FR-012; A-16 T046, board RunsLog1440/768):
// "Pipeline history log": event-kind filter chips with counts, run chips, a table (Time UTC, Run,
// Event, Source, Count, Status pill), a pager and Download CSV. Every event of every run in
// runs/index.json comes only from manifest timestamps (data/run-events): a run's start, each
// source's capture, and its finish with the run's limitations; nothing is invented. Order is
// newest first by default, as on the board; the Time header sorts ascending (A-13 AC-12).
// Justified differences from the board: the board's "Verified", "Records added", "Warning" and
// "Schema checked" events are not in a manifest (it cannot carry its own publish or verify time),
// so the chips are the three kinds that exist; the status pill is "Done" (or "Done with
// limitations" for a finish that carries notes), never a rate-limit or blocked pill the data does
// not record. An unreadable index is one banner; an unreadable manifest is a banner naming its CID
// while the other runs still list. Below 840 px each event is a small card (time and
// status, run, event, source and count) instead of a squeezed table row (D-6).
// A react-router lazy route module.
import type { RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS, ROUTES, RUNS_TEXTS, sourceLabel, isSourceName } from "@countylens/shared";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { RunSelect } from "../components/RunSelect";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatUtc } from "../components/Provenance";
import { formatCount } from "../data/format";
import {
  RunIndexError,
  loadRunsIndex,
  runIndexText,
  runName,
  runNumbers,
  runsByFinish,
  type RunNumber,
} from "../data/runs-index";
import { runEvents, type RunEvent } from "../data/run-events";
import {
  RUN_STAGE_TEXTS,
  eventLabel,
  loadManifestByCid,
  runErrorNode,
  toRunLoadError,
} from "./Runs.shared";
import type { RunLoadError } from "./Runs.shared";
import runsStyles from "./Runs.module.css";
import styles from "./RunsLog.module.css";

type LogState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly manifests: readonly RunManifestV1[];
      /** 1-based run number and finish time by run ID, from the index order. */
      readonly numbers: ReadonlyMap<string, { number: RunNumber; finishedAt: string }>;
      readonly failures: readonly RunLoadError[];
    }
  | { readonly kind: "error"; readonly error: RunLoadError };

async function loadAll(signal: AbortSignal): Promise<LogState> {
  let index;
  try {
    index = await loadRunsIndex({ signal });
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof RunIndexError ? runIndexText(error.reason) : String(error);
    return { kind: "error", error: { kind: "index", reason } };
  }
  const settled = await Promise.allSettled(
    index.runs.map((run) => loadManifestByCid(run.manifestCid, signal)),
  );
  const manifests: RunManifestV1[] = [];
  const failures: RunLoadError[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") manifests.push(result.value.manifest);
    else failures.push(toRunLoadError(result.reason));
  }
  // The one numbering rule (runNumbers): "Run N" / "Pilot slice" match the header and Runs.
  const byId = runNumbers(index);
  const numbers = new Map(
    runsByFinish(index).map((run) => [
      run.runId,
      { number: byId.get(run.runId) ?? null, finishedAt: run.finishedAt },
    ]),
  );
  return { kind: "ready", manifests, numbers, failures };
}

// The board pages at 12; A-13 AC-12 says every event is listed, which the hosted checks read in
// one pass, so a page holds 50 (Justified: the pager only appears once a county has more events).
const PAGE_SIZE = 50;
type Kind = RunEvent["kind"];
const KINDS: readonly { kind: Kind; label: string }[] = [
  { kind: "started", label: "Run started" },
  { kind: "captured", label: "Source captured" },
  { kind: "finished", label: "Run finished" },
];

interface LogRow {
  readonly event: RunEvent;
  /** "Run N" or "Pilot slice" (runName); "" when the index does not list the run. */
  readonly runName: string;
  readonly what: string;
  readonly source: string;
  readonly count: string;
  readonly done: string;
  readonly limited: boolean;
}

function buildRows(
  manifests: readonly RunManifestV1[],
  numbers: ReadonlyMap<string, { number: RunNumber; finishedAt: string }>,
): LogRow[] {
  const byRun = new Map(manifests.map((m) => [m.runId, m]));
  return runEvents(manifests).map((event) => {
    const manifest = byRun.get(event.runId);
    const listed = numbers.get(event.runId);
    const runNumber = listed === undefined ? "" : runName(listed.number);
    if (event.kind === "started") {
      return {
        event,
        runName: runNumber,
        what: eventLabel(event),
        source: "Manual or scheduled start",
        count: `${manifest?.sources.length ?? 0} sources`,
        done: "Started",
        limited: false,
      };
    }
    if (event.kind === "captured") {
      const source = manifest?.sources.find((s) => s.name === event.source);
      return {
        event,
        runName: runNumber,
        what: "Source captured",
        source: isSourceName(event.source) ? sourceLabel(event.source) : event.source,
        count: source === undefined ? "–" : formatCount(source.records),
        done: "Done",
        limited: false,
      };
    }
    return {
      event,
      runName: runNumber,
      what: eventLabel(event),
      source: "Manifest and run index",
      count: `${manifest?.artifacts.length ?? 0} artifacts`,
      done: event.limitations.length > 0 ? "Done with limitations" : "Done",
      limited: event.limitations.length > 0,
    };
  });
}

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function toCsv(rows: readonly LogRow[]): string {
  const head = ["Time (UTC)", "Run", "Run ID", "Event", "Source", "Count", "Status"];
  const lines = rows.map((r) =>
    [formatUtc(r.event.time), r.runName, r.event.runId, r.what, r.source, r.count, r.done]
      .map(csvCell)
      .join(","),
  );
  return [head.map(csvCell).join(","), ...lines].join("\n");
}

export function Component(): ReactElement {
  const [state, setState] = useState<LogState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    loadAll(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setState(next);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // The header slot Download CSV renders into (the button needs the table's filtered rows).
  const [actions, setActions] = useState<HTMLElement | null>(null);

  return (
    <section
      aria-label="Runs · Log"
      data-route="runs-log"
      data-state={state.kind}
      className={runsStyles.page}
    >
      <div className={runsStyles.pageHead}>
        {/* Board RunsLog1440/768: back arrow and title left, Download CSV right. */}
        <div className={runsStyles.compareTop}>
          <div className={runsStyles.compareTitle}>
            <Link className={runsStyles.textLink} to={ROUTES.runs} aria-label="Back to runs">
              <Icon name="arrow_back" size="medium" />
            </Link>
            <h2 className={runsStyles.pageTitle}>Pipeline history log</h2>
          </div>
          <span ref={setActions} />
        </div>
        <p className={runsStyles.intro}>
          Every event of every published run, read from each run&apos;s manifest.{" "}
          {RUNS_TEXTS.nextSync}
        </p>
      </div>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS.manifest} />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? (
        <>
          {state.failures.map((failure, i) => (
            <ErrorBanner key={i} message={runErrorNode(failure)} onRetry={retry} />
          ))}
          <LogTable manifests={state.manifests} numbers={state.numbers} actions={actions} />
        </>
      ) : null}
    </section>
  );
}

function LogTable({
  manifests,
  numbers,
  actions,
}: {
  readonly actions: HTMLElement | null;
  readonly manifests: readonly RunManifestV1[];
  readonly numbers: ReadonlyMap<string, { number: RunNumber; finishedAt: string }>;
}): ReactElement {
  const all = useMemo(() => buildRows(manifests, numbers), [manifests, numbers]);
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(new Set());
  const [run, setRun] = useState<string>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(1);

  const runIds = [...numbers.entries()].map(([runId, v]) => ({ runId, ...v }));
  const inRun = (r: LogRow): boolean => run === "all" || r.event.runId === run;
  const fit = all.filter((r) => inRun(r) && (kinds.size === 0 || kinds.has(r.event.kind)));
  const ordered = newestFirst ? [...fit].reverse() : fit;
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const shown = ordered.slice(start, start + PAGE_SIZE);
  const filtered = kinds.size > 0 || run !== "all";

  const toggleKind = (kind: Kind): void => {
    const next = new Set(kinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setKinds(next);
    setPage(1);
  };
  const clear = (): void => {
    setKinds(new Set());
    setRun("all");
    setPage(1);
  };
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([toCsv(ordered)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "pipeline_log.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={runsStyles.card}>
      <div className={styles.filters}>
        <div className={runsStyles.chips} role="group" aria-label="Event kind">
          <button
            type="button"
            className={runsStyles.chip}
            aria-pressed={kinds.size === 0}
            onClick={() => {
              setKinds(new Set());
              setPage(1);
            }}
          >
            All events
          </button>
          {KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              className={runsStyles.chip}
              aria-pressed={kinds.has(kind)}
              onClick={() => toggleKind(kind)}
            >
              {label} · {all.filter((r) => inRun(r) && r.event.kind === kind).length}
            </button>
          ))}
          {filtered ? (
            <button type="button" className={runsStyles.chip} onClick={clear}>
              <Icon name="filter_alt_off" size="small" />
              Clear filters
            </button>
          ) : null}
        </div>
        <RunSelect
          runs={runIds}
          value={run === "all" ? null : run}
          label="Run"
          hideLabel
          allLabel="All runs"
          onChange={(runId) => {
            setRun(runId ?? "all");
            setPage(1);
          }}
        />
      </div>
      {actions === null
        ? null
        : createPortal(
            <button type="button" className={styles.download} onClick={download}>
              <Icon name="download" size="small" />
              Download CSV
            </button>,
            actions,
          )}
      <div className={runsStyles.tableWrap}>
        <table className={`${runsStyles.table} ${styles.log}`} aria-label="Run events">
          <thead>
            <tr>
              <th aria-sort={newestFirst ? "descending" : "ascending"}>
                <button
                  type="button"
                  className={`${styles.sort} ${newestFirst ? "" : styles.sortUp}`}
                  onClick={() => setNewestFirst(!newestFirst)}
                >
                  Time (UTC)
                  {/* The icon subset has arrow_drop_down only; ascending turns it up. */}
                  <Icon name="arrow_drop_down" size="medium" />
                </button>
              </th>
              <th>Run</th>
              <th>Event</th>
              <th>Source</th>
              <th className={runsStyles.num}>Count</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr
                key={`${row.event.runId}-${row.event.kind}-${row.event.time}-${i}`}
                data-event={row.event.kind}
                data-time={row.event.time}
                data-run-id={row.event.runId}
              >
                <td className={runsStyles.num}>
                  <time dateTime={row.event.time}>{formatUtc(row.event.time)}</time>
                </td>
                <td>
                  <span data-run-number="">{row.runName}</span>
                  <span className={styles.runId} data-run-id-text="" title={row.event.runId}>
                    {row.event.runId}
                  </span>
                </td>
                <td>
                  {row.what}
                  {row.event.kind === "finished" && row.event.limitations.length > 0 ? (
                    <details>
                      <summary>Limitations ({row.event.limitations.length})</summary>
                      <ul className={styles.notes} aria-label="Limitations">
                        {row.event.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </td>
                <td>{row.source}</td>
                <td className={runsStyles.num}>{row.count}</td>
                <td>
                  <StatusPill
                    status={row.limited ? "warning" : row.done === "Started" ? "info" : "verified"}
                    icon={row.done === "Started" ? "play_arrow" : row.limited ? "warning" : "check"}
                    text={row.done}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? (
          <p className={runsStyles.helperText} data-log-empty="">
            No events match these filters.{" "}
            <button type="button" className={runsStyles.chip} onClick={clear}>
              Clear filters
            </button>
          </p>
        ) : null}
      </div>
      <div className={runsStyles.pager}>
        <span className={runsStyles.helperText}>
          Read from the run history in each manifest · times are UTC
        </span>
        <span aria-live="polite" data-pager-text="">
          {ordered.length === 0
            ? "0 of 0"
            : `${start + 1}–${Math.min(ordered.length, start + PAGE_SIZE)} of ${ordered.length}`}
        </span>
        <span className={runsStyles.chips} role="group" aria-label="Log pages">
          <button
            type="button"
            className={runsStyles.chip}
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            <Icon name="chevron_left" size="small" />
            Previous
          </button>
          <button
            type="button"
            className={runsStyles.chip}
            disabled={current >= pages}
            onClick={() => setPage(current + 1)}
          >
            Next
            <Icon name="chevron_right" size="small" />
          </button>
        </span>
      </div>
    </div>
  );
}
