// The Runs page (`/runs`; A-03 T042 + T060, G-C3; A-16 T043/T045/T046, boards Runs1440/768/390,
// RunsStates, RunsAdmin1440; spec FR-002, FR-005(b), FR-009, AC-6..AC-9, AC-12). Board order:
// title "Pipeline runs" and the run list; Sync status (last sync, next sync, county coverage,
// "Admin sign-in" or the admin controls); the pipeline steps; Latest events; "What Run N changed";
// then the run card (A-03: run ID, times, state pill, sources, coverage, data groups, limitations,
// server check), which keeps its place as the page's one `article`.
//
// LCP (A-16 T045, A13-3): the run list and the Sync status card come from `runs/index.json` alone
// and paint as soon as the index is read; the manifest-backed sections fill in after it.
//
// Every count comes from the manifest, every time from the manifest or the index. Justified
// differences from the boards (parity matrix):
// - The Gantt timeline and the selected-source strip: the manifest carries only a start, one
//   capture time per source and a finish, no step timings, so the chart is not drawn; the
//   timeline stays a Coming soon item and Latest events lists the times that exist.
// - Fresh / Stale / Rate-limited / Failed pills: no freshness threshold is defined for the product
//   (the board's 8 days is a sample value) and a published run is by definition complete, so the
//   pill reads "Published". Running / failed / stopped come live from the bridge (admin only).
// Run menu (A-16 PO note): choosing a run sets `?run=<runId>` and the pipeline steps, Latest
// events, What changed and the run card show that run (default: the latest). Sync status always
// describes the latest run. An unknown `run` shows the latest run and says why.
// Layout (A-16 F3, PO 2026-10-26): title + Run menu left of Sync status from 1024 px; the
// pipeline as a Fetch sources panel (each manifest source with its records) and steps 2–5;
// Latest events (the empty Timeline card was removed, PO 2026-10-26); What changed split into totals + CIDs and
// the per-source rows; the run card in two columns with data groups as a compact grid. The Run
// menu floats over the page and closes on a choice, on focus leaving it, or on Escape.
// A react-router lazy route module: it exports `Component` and nothing else.
import type { ManifestSource, RunManifestV1 } from "@countylens/contract";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  ROUTES,
  RUNS_TEXTS,
  sourceLabel,
  verifyPath,
  type CoverageLabelKey,
} from "@countylens/shared";
import { type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { RunSelect } from "../components/RunSelect";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { Icon } from "../components/Icon";
import { SourceLink, formatUtc } from "../components/Provenance";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { useAdminAccess, useLiveRun } from "../auth/useAdmin";
import { formatCount } from "../data/format";
import { RUN_STAGE_TEXTS, type LoadedRun, type SelectedRun } from "../data/run-loader";
import { dataGroupItems, type DataGroupItem } from "../data/data-groups";
import { runEvents, type RunEvent } from "../data/run-events";
import {
  RUNS_INDEX_PATH,
  runName,
  runNumbers,
  runsByFinish,
  type RunNumber,
  type RunsIndexEntry,
  compareQuery,
} from "../data/runs-index";
import { serverCheckText, useServerCheck } from "../data/server-check";
import { AdminActions, NotAdminNote } from "./RunsAdmin";
import {
  eventLabel,
  runErrorNode,
  runLabel,
  ChangeBar,
  SourceDeltas,
  useRun,
  type RunPageState,
} from "./Runs.shared";
import styles from "./Runs.module.css";

/** The coverage rows of the card, in display order (plan § Atlas element map → Coverage rows). */
const COVERAGE_ROWS: readonly CoverageLabelKey[] = ["permits_emitted", "permits_no_tcad_geoid"];

/** Helper text when the manifest carries no such coverage key (never a blank row). */
const COVERAGE_NOT_REPORTED = "Not reported in this run's manifest";

const DAY_MS = 86_400_000;

export function Component(): ReactElement {
  const [params] = useSearchParams();
  const requested = params.get("run");
  const { state, retry, index } = useRun(requested);
  const access = useAdminAccess();
  const live = useLiveRun(access.kind === "admin");
  const run = state.kind === "ready" ? state.run : undefined;
  const selected = state.kind === "ready" ? state.selected : undefined;
  const entries = index === undefined ? [] : runsByFinish(index);
  const latest = entries[entries.length - 1];
  // While a chosen run loads, the menu already marks it (the URL is the source of truth).
  const currentId = selected?.entry.runId ?? requested ?? latest?.runId;

  return (
    <section aria-label="Runs" data-route="runs" data-state={state.kind} className={styles.page}>
      {/* Board Runs1440: title, Run menu and intro on the left, Sync status on the right. */}
      <div>
        <div className={styles.pageHead}>
          <h2 className={styles.pageTitle}>Pipeline runs</h2>
          {entries.length > 0 ? <RunList entries={entries} currentId={currentId} /> : null}
          <p className={styles.intro}>
            Each run fetches every source, checks and joins them, derives roof age and contractors,
            then publishes a new manifest CID. A run never changes an earlier one. Every count comes
            from the run&apos;s manifest.
          </p>
        </div>
        {latest === undefined ? null : (
          <SyncStatus
            latest={latest}
            number={index === undefined ? null : (runNumbers(index).get(latest.runId) ?? null)}
            run={selected?.isLatest === false ? "earlier" : run}
            adminSlot={
              access.kind === "admin" ? (
                <AdminActions access={access} liveState={live.state} refresh={live.refresh} />
              ) : access.kind === "signed-out" ? (
                <Link className={styles.textLink} to={ROUTES.adminSignIn}>
                  <Icon name="admin_panel_settings" size="medium" />
                  Admin sign-in
                </Link>
              ) : access.kind === "checking" ? (
                <p className={styles.helperText} data-admin-note="checking">
                  Checking admin access…
                </p>
              ) : (
                <NotAdminNote
                  kind={access.kind}
                  email={"identity" in access ? access.identity.email : null}
                />
              )
            }
          />
        )}
      </div>
      {state.kind === "loading" ? (
        <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {selected?.notFound == null ? null : (
        <p className={styles.helperText} role="status" data-run-not-found={selected.notFound}>
          Run <code className={styles.mono}>{selected.notFound}</code> is not in {RUNS_INDEX_PATH} ·
          showing the latest run instead.
        </p>
      )}
      {state.kind === "loading" && latest !== undefined ? <PendingSections state={state} /> : null}
      {run === undefined || selected === undefined ? (
        <ComingSoonEntries ids={["pipeline-diagram", "timeline-scrubber"]} />
      ) : (
        <div className={styles.cardGrid} data-shown-run={run.entry.runId}>
          {/* The run card is first in the DOM: its provenance line (the manifest CID) is the
              page's first CID and sits inside the first phone screen (A-03-TC-NF-03). From 600 px
              CSS `order` shows it last, as on the boards. */}
          <RunCard run={run} selected={selected} />
          <PipelineSteps
            manifest={run.manifest}
            manifestCid={run.manifestCid}
            label={runLabel(selected.number, run.entry.finishedAt)}
          />
          {/* PO 2026-10-26: the Timeline card (two Coming soon links, no data for any run) is
              removed; its planned items stay in the Coming soon sheet. */}
          <div className={styles.wide}>
            <LatestEvents manifest={run.manifest} />
          </div>
          <WhatChanged run={run} number={selected.number} />
        </div>
      )}
      {state.kind === "loading" && latest === undefined ? (
        <Skeleton variant="cards" count={1} />
      ) : null}
    </section>
  );
}

function PendingSections({
  state,
}: {
  readonly state: Extract<RunPageState, { kind: "loading" }>;
}): ReactElement {
  return (
    <div data-pending-manifest="" role="status" aria-label={RUN_STAGE_TEXTS[state.stage]}>
      <Skeleton variant="cards" count={1} />
    </div>
  );
}

/**
 * The run picker (PO 2026-10-26: run + date only → a dropdown, RunSelect): every run newest
 * first, the shown one selected. A choice sets `?run=<runId>` (none for the latest). Beside it, the
 * shown run's publication pill, finish time and run ID.
 */
function RunList({
  entries,
  currentId,
}: {
  readonly entries: readonly RunsIndexEntry[];
  readonly currentId: string | undefined;
}): ReactElement {
  const navigate = useNavigate();
  const latestId = entries[entries.length - 1]?.runId;
  const shown = entries.find((entry) => entry.runId === currentId) ?? entries[entries.length - 1];
  return (
    // Board "rsel": one outlined card, done glyph, the run (dropdown) over its finish time and run
    // ID, the publication pill on the right.
    <div className={styles.runPick} data-run-list="" data-current-run={shown?.runId ?? ""}>
      <Icon name="check_circle" size="medium" />
      <span>
        <RunSelect
          runs={entries}
          value={shown?.runId ?? null}
          label="Run"
          hideLabel
          onChange={(runId) => {
            if (runId !== null) void navigate({ search: runSearch(runId, latestId) });
          }}
        />
        {shown === undefined ? null : (
          <span title={shown.runId}>
            {formatUtc(shown.finishedAt)} UTC · {shown.runId}
          </span>
        )}
      </span>
      <StatusPill status="info" icon="cloud_done" text="Published" />
    </div>
  );
}

/** The `/runs` query for a run: none for the latest (the default), else `?run=<runId>`. */
function runSearch(runId: string, latestId: string | undefined): string {
  return runId === latestId ? "" : `?${new URLSearchParams({ run: runId }).toString()}`;
}

/** Calendar days in UTC between the run's finish and now ("today" only on the same UTC day). */
function ageText(finishedAt: string, now: number): string {
  const utcDay = (ms: number): number => Math.floor(ms / DAY_MS);
  const days = utcDay(now) - utcDay(Date.parse(finishedAt));
  if (Number.isNaN(days) || days < 0) return "";
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function SyncStatus({
  latest,
  number,
  run,
  adminSlot,
}: {
  readonly latest: RunsIndexEntry;
  readonly number: RunNumber;
  /** The latest run once read; "earlier" while the page shows an earlier run's manifest. */
  readonly run: LoadedRun | "earlier" | undefined;
  readonly adminSlot: ReactElement;
}): ReactElement {
  const age = ageText(latest.finishedAt, Date.now());
  return (
    <section className={styles.card} aria-labelledby="sync-heading" data-sync-status="">
      <div className={styles.cardHead}>
        <h3 id="sync-heading" className={styles.cardTitle}>
          Sync status
        </h3>
        <StatusPill status="info" icon="cloud_done" text="Published" />
      </div>
      <dl className={styles.kv}>
        <div className={styles.kvRow}>
          <dt>Last sync</dt>
          <dd data-last-sync="">
            <time dateTime={latest.finishedAt}>{formatUtc(latest.finishedAt)}</time> UTC ·{" "}
            {runLabel(number, latest.finishedAt)}
            {age === "" ? "" : ` · ${age}`}
          </dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Next sync</dt>
          <dd>None · scheduler off by default</dd>
        </div>
        <div className={styles.kvRow}>
          <dt>County coverage</dt>
          <dd data-county-coverage="">
            {run === undefined
              ? "Reading the manifest…"
              : run === "earlier"
                ? "Not shown · an earlier run is open; choose the latest in the Run menu"
                : countyCoverage(run.manifest)}
          </dd>
        </div>
      </dl>
      <p className={styles.provenance}>
        <Icon name="info" size="small" />
        <span>
          Runs start by hand. Last sync comes from {RUNS_INDEX_PATH}; coverage from the manifest.
        </span>
      </p>
      <div className={styles.adminSlot}>{adminSlot}</div>
    </section>
  );
}

/** Parcels with data out of the TCAD roll, only from manifest keys; else the reason it is missing. */
/** The TCAD roll total: a `source_total:` coverage key when the run has one, else the records the
 *  run read from the TCAD source at capture (`sources[].records`, the roll's own count). */
function tcadRollTotal(manifest: RunManifestV1): number | undefined {
  const key = manifest.coverage["source_total:tcad-2026-certified-json"]?.count;
  if (key !== undefined) return key;
  return manifest.sources.find((s) => s.name === "tcad-2026-certified-json")?.records;
}

function countyCoverage(manifest: RunManifestV1): string {
  const published = manifest.coverage["parcels_published"];
  const total = tcadRollTotal(manifest);
  if (published === undefined || total === undefined || total === 0) {
    return "Not available · this run's manifest has no parcel count with the TCAD roll total";
  }
  const pct = ((published.count / total) * 100).toFixed(1);
  return `${pct}% of the TCAD roll · ${formatCount(published.count)} of ${formatCount(total)} parcels`;
}

/**
 * The pipeline (board "Pipeline · Run N"): step 1 lists every fetched source with its records,
 * then steps 2–5, each with one fact the manifest holds. No step timings exist, so no times.
 */
function PipelineSteps({
  manifest,
  manifestCid,
  label,
}: {
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
  readonly label: string;
}): ReactElement {
  const coverageKeys = Object.keys(manifest.coverage).length;
  const tables = manifest.artifacts.filter((a) => a.kind === "table").length;
  const steps: readonly { name: string; icon: string; metric: string }[] = [
    { name: "Check and join", icon: "rule", metric: `${coverageKeys} coverage counts recorded` },
    { name: "Derive", icon: "auto_fix_high", metric: `${tables} published table parts` },
    {
      name: "Publish",
      icon: "cloud_upload",
      metric: `${manifest.artifacts.length} files · manifest ${manifestCid.slice(0, 8)}…`,
    },
    { name: "Verify", icon: "verified", metric: "Check it yourself on the Verify page" },
  ];
  return (
    <section
      className={`${styles.card} ${styles.wide}`}
      aria-labelledby="steps-heading"
      data-pipeline-steps=""
    >
      <div>
        <h3 id="steps-heading" className={styles.cardTitle}>
          Pipeline · {label}
        </h3>
        <p className={styles.helperText}>
          {manifest.sources.length} sources → check and join → derive → publish → verify ·{" "}
          <span className={styles.mono}>{manifest.runId}</span>
        </p>
        <p className={styles.helperText}>
          A run that is in the index finished all five steps. The manifest records no per-step
          times.
        </p>
      </div>
      <ol>
        <li className={styles.step} data-step="Fetch sources">
          <span>
            <span className={styles.stepNumber}>1</span>
            <b>
              <Icon name="cloud_download" size="medium" />
              Fetch sources
            </b>
            <span className={styles.itemBody}>
              {fetchedIn(manifest).length} fetched ·{" "}
              {manifest.sources.length - fetchedIn(manifest).length} carried over
            </span>
          </span>
          <ul aria-label="Fetch step: records per feed">
            {manifest.sources.map((source) => {
              const fetched = fetchedIn(manifest).includes(source);
              return (
                <li
                  key={source.name}
                  data-fetch-source={source.name}
                  data-fetched={fetched ? "yes" : "no"}
                >
                  <Icon name={fetched ? "check_circle" : "history"} size="small" />
                  <span>
                    {sourceLabel(source.name)}
                    {fetched
                      ? ""
                      : ` · carried over, captured ${formatUtc(source.captured_at)} UTC`}
                  </span>
                  <span>{formatCount(source.records)}</span>
                </li>
              );
            })}
          </ul>
        </li>
        {steps.map((step, i) => (
          <li key={step.name} className={styles.step} data-step={step.name}>
            <span>
              <Icon name="check_circle" size="medium" />
              <span className={styles.stepNumber}>{i + 2}</span>
            </span>
            <b>
              <Icon name={step.icon} size="medium" />
              {step.name}
            </b>
            <span className={styles.itemBody}>{step.metric}</span>
            <span>Done</span>
          </li>
        ))}
      </ol>
      <FetchStrip
        sources={fetchedIn(manifest)}
        carried={manifest.sources.length - fetchedIn(manifest).length}
      />
    </section>
  );
}

/**
 * Board strip under the pipeline ("Austin permits · Done · Start · End · Records · Log"), adapted
 * to what the manifest holds: the fetch step as a whole, its first and last capture time and the
 * records it fetched, with a link to the full log.
 */
/**
 * The sources this run captured itself (label review 2026-10-26): a capture time at or after the
 * run's start (the first run: all of them). The others were carried over unchanged from an earlier
 * run; the Runs log reads the same split from the earlier manifests (run-events.ts).
 */
function fetchedIn(manifest: RunManifestV1): readonly ManifestSource[] {
  // The first run fetched everything, even what it captured before its recorded start.
  if (manifest.previousManifestCid === null) return manifest.sources;
  const start = Date.parse(manifest.startedAt);
  return manifest.sources.filter((s) => Date.parse(s.captured_at) >= start);
}

function FetchStrip({
  sources,
  carried,
}: {
  readonly sources: readonly ManifestSource[];
  readonly carried: number;
}): ReactElement {
  const times = sources.map((s) => s.captured_at).sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = times[0];
  const last = times[times.length - 1];
  const records = sources.reduce((total, s) => total + s.records, 0);
  return (
    <div className={styles.fetchStrip} data-fetch-strip="">
      <Icon name="check_circle" size="medium" />
      <span>
        <b>Fetch sources · Done</b>
        <br />
        {sources.length === 0
          ? "No source fetched in this run; every source is carried over"
          : `${sources.length} fetched in this run${carried > 0 ? `, ${carried} carried over from earlier runs` : ""}; one capture time per source`}
      </span>
      <dl>
        <div>
          <dt>First capture</dt>
          <dd>{first === undefined ? "—" : `${formatUtc(first)} UTC`}</dd>
        </div>
        <div>
          <dt>Last capture</dt>
          <dd>{last === undefined ? "—" : `${formatUtc(last)} UTC`}</dd>
        </div>
        <div>
          <dt>Records fetched</dt>
          <dd>{formatCount(records)}</dd>
        </div>
      </dl>
      <Link className={styles.textLink} to={ROUTES.runsLog}>
        <Icon name="description" size="medium" />
        Log
      </Link>
    </div>
  );
}

const EVENT_ICONS: Readonly<Record<RunEvent["kind"], { readonly icon: string }>> = {
  started: { icon: "play_arrow" },
  captured: { icon: "cloud_download" },
  finished: { icon: "cloud_upload" },
};

function LatestEvents({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  // Only this run's own captures: one carried over from an earlier run is that run's event.
  const own = new Set(fetchedIn(manifest).map((s) => s.name));
  const events = runEvents([manifest])
    .filter((event) => event.kind !== "captured" || own.has(event.source))
    .slice(-5)
    .reverse();
  return (
    <section className={styles.card} aria-labelledby="events-heading" data-latest-events="">
      <div className={styles.cardHead}>
        <h3 id="events-heading" className={styles.cardTitle}>
          Latest events
        </h3>
        <Link className={styles.textLink} to={ROUTES.runsLog}>
          Full log
        </Link>
      </div>
      <ul className={styles.list}>
        {events.map((event, i) => (
          <li key={i} data-event={event.kind}>
            <Icon name={EVENT_ICONS[event.kind].icon} size="small" />
            <span>
              <span>{eventLabel(event)}</span>
              <span className={styles.itemBody}>
                <time dateTime={event.time}>{formatUtc(event.time)}</time> UTC ·{" "}
                <span className={styles.mono}>{event.runId}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WhatChanged({
  run,
  number,
}: {
  readonly run: LoadedRun;
  readonly number: RunNumber;
}): ReactElement {
  const { manifest, manifestCid } = run;
  const first = manifest.previousManifestCid === null;
  // The previous run by its manifest CID, named by the one rule (the pilot slice is unnumbered).
  const previous = run.index.runs.find((r) => r.manifestCid === manifest.previousManifestCid);
  const previousNumber =
    previous === undefined ? null : (runNumbers(run.index).get(previous.runId) ?? null);
  const name = runName(number);
  const previousName = previous === undefined ? "the previous run" : runName(previousNumber);
  // Compare takes numbered runs only (RUNS_TEXTS.numbering).
  const comparable = !first && number !== null && previousNumber !== null;
  const scale = Math.max(1, ...manifest.sources.map((s) => s.added + s.changed + s.removed));
  const sum = (key: "added" | "changed" | "removed"): number =>
    manifest.sources.reduce((total, s) => total + s[key], 0);
  const added = sum("added");
  const changed = sum("changed");
  const removed = sum("removed");
  const total = added + changed + removed;
  return (
    <section
      className={`${styles.card} ${styles.wide}`}
      aria-labelledby="changed-heading"
      data-what-changed=""
    >
      <div className={styles.cardHead}>
        <div>
          <h3 id="changed-heading" className={styles.cardTitle}>
            What {name} changed
          </h3>
          <p className={styles.helperText}>
            {first ? RUNS_TEXTS.firstRun : `Counted against ${previousName}'s manifest.`}
          </p>
        </div>
        {!comparable ? null : (
          <Link
            className={styles.textLink}
            to={`${ROUTES.runsCompare}${compareQuery(run.index, previous?.runId ?? "", run.entry.runId)}`}
          >
            <Icon name="compare_arrows" size="medium" />
            Compare {name} with {previousName}
          </Link>
        )}
      </div>
      <div>
        <div>
          {first ? null : (
            <>
              <p className={styles.itemBody}>
                Changes in {name} vs {previousName} · <b data-total-changes="">{total}</b> records
              </p>
              <ChangeBar
                added={added}
                changed={changed}
                removed={removed}
                scale={total}
                label={`${added} added, ${changed} changed, ${removed} removed`}
              />
              <ul className={styles.legend} aria-label="Changes by kind">
                {(
                  [
                    ["added", "Added", added],
                    ["changed", "Changed", changed],
                    ["removed", "Removed", removed],
                  ] as const
                ).map(([tone, name, value]) => (
                  <li key={tone} data-legend={tone}>
                    <svg viewBox="0 0 1 1" aria-hidden="true">
                      <rect className={styles[`fill_${tone}`]} width={1} height={1} />
                    </svg>
                    {name} <b>{formatCount(value)}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div data-cid-boxes="">
            <div>
              <span className={styles.tileLabel}>Manifest CID</span>
              <span>
                <CidDisplay cid={manifestCid} />
                <Link className={styles.link} to={verifyPath(manifestCid)}>
                  Verify
                </Link>
              </span>
            </div>
            <div>
              <span className={styles.tileLabel}>Previous manifest CID</span>
              <span>
                {manifest.previousManifestCid === null ? (
                  RUNS_TEXTS.firstRun
                ) : (
                  <CidDisplay cid={manifest.previousManifestCid} />
                )}
              </span>
            </div>
          </div>
        </div>
        <div>
          <p className={styles.changeRow} aria-hidden="true">
            <span>Source</span>
            <span className={styles.num}>Records</span>
            <span>Changed records (one scale for this run)</span>
            <span className={styles.num}>+ / ~ / −</span>
          </p>
          <ul className={styles.list} aria-label="Changed records per source">
            {manifest.sources.map((source) => (
              <li key={source.name} className={styles.changeRow} data-change-source={source.name}>
                <span className={styles.itemTitle}>{sourceLabel(source.name)}</span>
                <span className={styles.count}>{formatCount(source.records)} records</span>
                {first ? (
                  <span className={styles.helper}>{RUNS_TEXTS.firstRun}</span>
                ) : (
                  <>
                    <ChangeBar
                      added={source.added}
                      changed={source.changed}
                      removed={source.removed}
                      scale={scale}
                      label={changeAria(source)}
                    />
                    <span className={styles.count}>
                      +{source.added} / ~{source.changed} / −{source.removed}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const changeAria = (s: ManifestSource): string =>
  `${s.added} added, ${s.changed} changed, ${s.removed} removed`;

function Glyph({ name }: { readonly name: string }): ReactElement {
  return (
    <span className={`material-symbols-rounded ${styles.icon}`} aria-hidden="true">
      {name}
    </span>
  );
}

function RunCard({
  run,
  selected,
}: {
  readonly run: LoadedRun;
  readonly selected: SelectedRun;
}): ReactElement {
  const { manifest, manifestCid, read } = run;
  const groups = dataGroupItems(manifest);
  return (
    <article className={`${styles.card} ${styles.wide}`} aria-labelledby="run-title">
      <header className={styles.header}>
        <h2 id="run-title" className={styles.title}>
          {manifest.runId}
        </h2>
        <FallbackChip source={read.source} />
      </header>
      <div>
        <p className={styles.times} data-run-number={selected.number ?? "pilot"}>
          {runLabel(selected.number, run.entry.finishedAt)} ·{" "}
          {selected.isLatest ? "the latest run" : "an earlier run (choose another in the Run menu)"}
        </p>
        <p className={styles.provenance}>
          <Glyph name="description" />
          <span>
            Index: this site ({RUNS_INDEX_PATH}) · Manifest: <CidDisplay cid={manifestCid} />
          </span>
        </p>
        <p className={styles.times}>
          Started <UtcTime iso={manifest.startedAt} /> · Finished{" "}
          <UtcTime iso={manifest.finishedAt} />
        </p>
        <div className={styles.state}>
          <StatusPill status="info" icon="schedule" text={PUBLICATION_STATE_TEXT} />
        </div>
        <p className={styles.times}>{RUNS_TEXTS.nextSync}</p>
        <p className={styles.itemBody}>
          {/* The shown run (`?run=` may pick an earlier one) against its own predecessor. */}
          <Link
            className={styles.link}
            to={`${ROUTES.runsCompare}${compareQuery(
              run.index,
              run.index.runs.find((r) => r.manifestCid === manifest.previousManifestCid)?.runId ??
                "",
              run.entry.runId,
            )}`}
          >
            Compare with the previous run
          </Link>
        </p>
      </div>

      <div>
        <div>
          <h3 id="sources-heading" className={styles.sectionTitle}>
            Sources
          </h3>
          <ul className={styles.list} aria-labelledby="sources-heading">
            {manifest.sources.map((source) => (
              <SourceItem
                key={source.name}
                source={source}
                firstRun={manifest.previousManifestCid === null}
              />
            ))}
          </ul>

          <h3 id="coverage-heading" className={styles.sectionTitle}>
            Coverage
          </h3>
          <ul className={styles.list} aria-labelledby="coverage-heading">
            {COVERAGE_ROWS.map((key) => (
              <CoverageRow key={key} coverageKey={key} coverage={manifest.coverage} />
            ))}
          </ul>

          <h3 id="groups-heading" className={styles.sectionTitle}>
            Data groups
          </h3>
          <ul aria-labelledby="groups-heading">
            {groups.map((item) => (
              <GroupItem key={item.artifact.name} item={item} />
            ))}
          </ul>
        </div>

        <div>
          <h3 id="limitations-heading" className={styles.sectionTitle}>
            Limitations
          </h3>
          <Limitations manifest={manifest} />
        </div>
      </div>

      <ServerCheckLine manifestCid={manifestCid} />
    </article>
  );
}

/** The first limitations shown; the rest sit behind "Show all N limitations" (as on Coverage). */
const LIMITATIONS_SHOWN = 3;
/** A hex run of 16+ characters (a sha256, a long digest) in a manifest note. */
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;

/**
 * A manifest note as published, with each long hex run cut to 8 characters and an ellipsis (the
 * full value in `title`). The note itself is immutable; only its presentation is compact.
 */
function NoteText({ text }: { readonly text: string }): ReactElement {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(LONG_HEX)) {
    parts.push(text.slice(at, match.index));
    parts.push(
      <abbr key={match.index} title={match[0]} data-hex={match[0]}>
        {match[0].slice(0, 8)}…
      </abbr>,
    );
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** Run limitations, then each source's, in manifest order; `data-text` keeps the full note. */
function Limitations({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  const items = [
    ...manifest.limitations.map((text) => ({ key: `run:${text}`, text, source: null })),
    ...manifest.sources.flatMap((s) =>
      s.limitations.map((text) => ({ key: `${s.name}:${text}`, text, source: s.name })),
    ),
  ];
  const item = ({ key, text, source }: (typeof items)[number]): ReactElement => (
    <li
      key={key}
      className={`${styles.item} ${styles.itemBody}`}
      data-text={text}
      data-limitation-source={source ?? undefined}
    >
      <span>
        <NoteText text={text} />
      </span>
      {source === null ? null : (
        <>
          {" · "}
          <code className={styles.mono}>{source}</code>
        </>
      )}
    </li>
  );
  return (
    <>
      <ul className={styles.list} aria-labelledby="limitations-heading">
        {items.slice(0, LIMITATIONS_SHOWN).map(item)}
      </ul>
      {items.length > LIMITATIONS_SHOWN ? (
        <details className={styles.limitationsMore}>
          <summary>Show all {items.length} limitations</summary>
          <ul className={styles.list} aria-label="More limitations">
            {items.slice(LIMITATIONS_SHOWN).map(item)}
          </ul>
        </details>
      ) : null}
    </>
  );
}

/**
 * An instant as the board prints it (`2026-10-25 07:36:00 UTC`, review: no `T…000Z`); the
 * `<time datetime>` keeps the manifest's own ISO value for tests and assistive tech.
 */
function UtcTime({ iso }: { readonly iso: string }): ReactElement {
  return <time dateTime={iso}>{formatUtc(iso)} UTC</time>;
}

/** § 7 List item, two lines: the display name (+ manifest id), then records · collected · link. */
function SourceItem({
  source,
  firstRun,
}: {
  readonly source: ManifestSource;
  readonly firstRun: boolean;
}): ReactElement {
  return (
    <li className={styles.item} data-source={source.name}>
      <span className={styles.itemTitle}>
        <span>{sourceLabel(source.name)}</span>
        <code className={styles.mono}>{source.name}</code>
      </span>
      <span className={styles.itemBody}>
        {formatCount(source.records)} records · collected <UtcTime iso={source.captured_at} /> ·{" "}
        {source.watermark === null ? null : <>watermark {source.watermark} · </>}
        <SourceLink url={source.url} className={styles.link} />
      </span>
      <span className={styles.itemBody} data-source-delta={source.name}>
        <SourceDeltas
          added={source.added}
          changed={source.changed}
          removed={source.removed}
          firstRun={firstRun}
        />
      </span>
    </li>
  );
}

/** Label · count · derivation helper text (visible, not a tooltip; FR-009, TC-031). */
function CoverageRow({
  coverageKey,
  coverage,
}: {
  readonly coverageKey: CoverageLabelKey;
  readonly coverage: RunManifestV1["coverage"];
}): ReactElement {
  const value = coverage[coverageKey];
  return (
    <li className={styles.coverageRow} data-coverage={coverageKey}>
      <span className={styles.coverageLabel}>{COVERAGE_LABELS[coverageKey]}</span>
      {value === undefined ? (
        <span className={styles.helper}>{COVERAGE_NOT_REPORTED}</span>
      ) : (
        <>
          <span className={styles.count}>{formatCount(value.count)}</span>
          <span className={styles.helper}>{DERIVATION_LABELS[value.derivation]}</span>
        </>
      )}
    </li>
  );
}

/** § 7 List item, two lines: the data group (and its batch), then its tables directory CID (TC-013). */
function GroupItem({ item }: { readonly item: DataGroupItem }): ReactElement {
  const { artifact, batch, batches } = item;
  const group = item.group ?? artifact.name;
  return (
    <li className={styles.item} data-group={group}>
      <span className={styles.itemTitle}>
        <code className={styles.mono}>{group}</code>
        {batches > 1 ? (
          <span className={styles.helper}>
            batch {batch} of {batches}
          </span>
        ) : null}
      </span>
      <span className={styles.itemBody}>
        tables <CidDisplay cid={artifact.cid} />
      </span>
    </li>
  );
}

/** Secondary text with its own provenance; the counts above come only from the manifest. */
function ServerCheckLine({ manifestCid }: { readonly manifestCid: string }): ReactElement {
  const check = useServerCheck(manifestCid);
  return (
    <p className={styles.serverCheck}>
      <Glyph name="cloud_done" />
      <span>{serverCheckText(check)}</span>
    </p>
  );
}
