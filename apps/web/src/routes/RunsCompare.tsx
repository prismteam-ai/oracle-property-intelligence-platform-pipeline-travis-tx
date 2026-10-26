// Runs · Compare (`/runs/compare?a=&b=`; A-13 T020, AC-1, FR-001a, FR-001b, FR-016; TC-007,
// TC-014, TC-015). `a` and `b` are 1-based run numbers in `runs/index.json` order (default: the
// run before the latest, and the latest). With one published run the page says "first run ·
// nothing to compare against" and links to it; nothing is invented. With two it shows both runs
// (run ID, manifest CID, finish time, fallback chip when Filebase served the read), run b's
// `previousManifestCid` link and its per-source deltas, and the old-manifest check: a plain GET
// of run a's manifest on Pinata, orbitor and Filebase (data/run-chain, never the CID copy); "old
// manifest still resolves on Pinata and orbitor" appears only after both independent gateways
// answered with bytes of that CID. Filebase is listed as the labelled fallback (AM-10) and never
// decides the text. Layout (A-16 F3, board RunsCompare1440/768/390): previous and current cards side by
// side from 1024 px, the change table (compact per-source blocks below 600 px), then Immutability
// checks beside the old-manifest check. Justified: the board's third "CAR available" card is
// folded into each card's CAR link, the "CAR available" chip and "Directory CAR" (bundle budget).
// A react-router lazy route module.
import type { RunManifestV1 } from "@countylens/contract";
import {
  PROGRESS_LABELS,
  ROUTES,
  RUNS_TEXTS,
  VERIFY_TEXTS,
  isIndependentGateway,
  isSourceName,
  sourceLabel,
  verifyPath,
} from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import { Icon } from "../components/Icon";
import { RunSelect } from "../components/RunSelect";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import type { ReadSource } from "../data/fetch-by-cid";
import { formatCount } from "../data/format";
import { formatUtc } from "../components/Provenance";
import {
  checkManifestResolves,
  oldManifestResolvesText,
  PENDING_RESOLVES,
  type ChainResolves,
  type GatewayCheck,
} from "../data/run-chain";
import { numberedRuns, type RunsIndexEntry } from "../data/runs-index";
import { numberRuns, runName } from "../data/run-numbers";
import { VERIFY_GATEWAYS, verifyUrlsFromEnv } from "../data/verify-lane";
import {
  RUN_STAGE_TEXTS,
  runErrorNode,
  SourceDeltas,
  loadManifestByCid,
  toRunLoadError,
  useLatestRun,
  type RunLoadError,
} from "./Runs.shared";
import styles from "./Runs.module.css";

const GATEWAY_LABELS = VERIFY_TEXTS.gatewayOperators;
const CHECK_LABELS: Readonly<Record<GatewayCheck, string>> = {
  pending: "checking",
  resolves: "answered with the manifest's bytes",
  fails: "did not serve the manifest's bytes",
};

interface ComparedRun {
  /** Position among the numbered runs (the URL's `?a=&b=`). */
  readonly n: number;
  /** "Run 3.1": the run-ID number every page shows (run-numbers.ts). */
  readonly label: string;
  readonly entry: RunsIndexEntry;
  readonly manifest: RunManifestV1;
  readonly source: ReadSource;
}

function runNumber(value: string | null, fallback: number): number {
  // Run numbers start at 1 (RUNS_TEXTS.numbering); empty, 0 or junk means the default.
  const n = value === null || value.trim() === "" ? NaN : Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  const [params] = useSearchParams();
  return (
    <section
      aria-label="Runs · Compare"
      data-route="runs-compare"
      data-state={state.kind}
      className={styles.page}
    >
      {state.kind === "ready" ? null : <h2 className={styles.pageTitle}>Runs · Compare</h2>}
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={2} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {/* The numbered runs only (RUNS_TEXTS.numbering): `?a=N` is Run N; the pilot slice is not
          offered here (the URL speaks run numbers, and the pilot has none). */}
      {state.kind === "ready" ? (
        <ComparePair
          entries={numberedRuns(state.run.index)}
          a={params.get("a")}
          b={params.get("b")}
        />
      ) : null}
    </section>
  );
}

function ComparePair({
  entries,
  a,
  b,
}: {
  readonly entries: readonly RunsIndexEntry[];
  readonly a: string | null;
  readonly b: string | null;
}): ReactElement {
  const count = entries.length;
  const bn = runNumber(b, count);
  const an = runNumber(a, bn - 1);
  const valid = count >= 2 && an >= 1 && bn <= count && an < bn;
  const ea = valid ? entries[an - 1] : undefined;
  const eb = valid ? entries[bn - 1] : undefined;
  const numbers = numberRuns(entries);
  const labelOf = (entry: RunsIndexEntry): string => runName(numbers.get(entry.runId) ?? null);
  const header = (
    <>
      <CompareHeader
        entries={entries}
        a={ea === undefined ? null : an}
        b={eb === undefined ? null : bn}
      />
      <p className={styles.helperText} data-run-numbering="">
        {RUNS_TEXTS.numbering}
      </p>
    </>
  );

  if (ea === undefined || eb === undefined) {
    const only = entries[count - 1];
    return (
      <>
        {header}
        <article
          className={styles.card}
          data-compare-single=""
          data-cid={only?.manifestCid}
          aria-label="Single run"
        >
          <p className={styles.times}>{RUNS_TEXTS.firstRun}</p>
          {only === undefined ? null : (
            <p className={styles.itemBody}>
              <Link className={styles.link} to={ROUTES.runs}>
                {only.runId}
              </Link>{" "}
              · <CidDisplay cid={only.manifestCid} /> ·{" "}
              <Link className={styles.link} to={verifyPath(only.manifestCid)} data-manifest-link="">
                Open manifest
              </Link>
            </p>
          )}
        </article>
      </>
    );
  }
  return (
    <>
      {header}
      <TwoRuns
        key={`${an}-${bn}`}
        a={{ n: an, label: labelOf(ea), entry: ea }}
        b={{ n: bn, label: labelOf(eb), entry: eb }}
      />
    </>
  );
}

/** Back link, "Run b vs Run a" and the two run pickers (board RunsCompare1440). */
function CompareHeader({
  entries,
  a,
  b,
}: {
  readonly entries: readonly RunsIndexEntry[];
  readonly a: number | null;
  readonly b: number | null;
}): ReactElement {
  const [params, setParams] = useSearchParams();
  // The URL keeps run numbers (`?a=&b=`); RunSelect speaks run IDs.
  const choose = (key: "a" | "b", runId: string | null): void => {
    const n = entries.findIndex((entry) => entry.runId === runId) + 1;
    if (n === 0) return;
    const next = new URLSearchParams(params);
    next.set(key, String(n));
    setParams(next);
  };
  const idOf = (n: number): string | null => entries[n - 1]?.runId ?? null;
  const numbers = numberRuns(entries);
  const nameOf = (n: number): string => runName(numbers.get(idOf(n) ?? "") ?? null);
  return (
    <div className={styles.compareTop}>
      <div className={styles.compareTitle}>
        <Link className={styles.textLink} to={ROUTES.runs} aria-label="Back to runs">
          <Icon name="arrow_back" size="medium" />
        </Link>
        <h2 className={styles.pageTitle}>
          {a === null || b === null
            ? "Runs · Compare"
            : // The runs' own names (Run 4 vs Run 3.1), not their positions in the URL.
              `${nameOf(b)} vs ${nameOf(a)}`}
        </h2>
      </div>
      {entries.length >= 2 ? (
        <span>
          <RunSelect
            runs={entries}
            value={idOf(b ?? entries.length)}
            onChange={(runId) => choose("b", runId)}
            label="Newer run"
            hideLabel
          />
          <span className={styles.selectLabel}>vs</span>
          <RunSelect
            runs={entries}
            value={idOf(a ?? entries.length - 1)}
            onChange={(runId) => choose("a", runId)}
            label="Older run"
            hideLabel
          />
        </span>
      ) : null}
    </div>
  );
}

type PairState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly a: ComparedRun; readonly b: ComparedRun }
  | { readonly kind: "error"; readonly error: RunLoadError };

function TwoRuns({
  a,
  b,
}: {
  readonly a: { readonly n: number; readonly label: string; readonly entry: RunsIndexEntry };
  readonly b: { readonly n: number; readonly label: string; readonly entry: RunsIndexEntry };
}): ReactElement {
  const [state, setState] = useState<PairState>({ kind: "loading" });
  const { n: an, label: al, entry: ea } = a;
  const { n: bn, label: bl, entry: eb } = b;
  useEffect(() => {
    const controller = new AbortController();
    const load = async (run: {
      readonly n: number;
      readonly label: string;
      readonly entry: RunsIndexEntry;
    }): Promise<ComparedRun> => {
      const loaded = await loadManifestByCid(run.entry.manifestCid, controller.signal);
      return { ...run, manifest: loaded.manifest, source: loaded.read.source };
    };
    Promise.all([
      load({ n: an, label: al, entry: ea }),
      load({ n: bn, label: bl, entry: eb }),
    ]).then(
      ([ra, rb]) => {
        if (!controller.signal.aborted) setState({ kind: "ready", a: ra, b: rb });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
    // The pair is keyed by its run numbers (ComparePair), so the entries are fixed for a mount.
  }, [ea.manifestCid, eb.manifestCid]);

  if (state.kind === "loading") return <Skeleton variant="cards" count={2} />;
  if (state.kind === "error") return <ErrorBanner message={runErrorNode(state.error)} />;
  return (
    <>
      {/* Board RunsCompare1440: previous and current side by side (the CAR card is folded into the CAR links and checks). */}
      <div>
        <RunColumn run={state.a} role="previous" />
        <RunColumn run={state.b} role="current" />
      </div>
      <ChangeTable a={state.a} b={state.b} />
      <div>
        <ImmutabilityChecks a={state.a} b={state.b} />
        <OldManifestCheck cid={state.a.entry.manifestCid} />
      </div>
    </>
  );
}

/** MB or GB in decimal units (1 GB = 10^9 bytes, as the Cost section and the bill count); the
 *  exact bytes stay in `data-total-size`. */
const humanSize = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;

/** `bafk…vlfm`: the short form CidDisplay uses, for a CID shown as link text. */
const shortCid = (cid: string): string => `${cid.slice(0, 4)}…${cid.slice(-4)}`;

function RunColumn({
  run,
  role,
}: {
  readonly run: ComparedRun;
  readonly role: "previous" | "current";
}): ReactElement {
  const { manifest, entry } = run;
  const titleId = `compare-run-${run.n}`;
  const totalSize = manifest.artifacts.reduce((sum, a) => sum + a.size, 0);
  const cars = manifest.artifacts.filter((a) => a.kind === "car");
  const car = cars[0];
  return (
    <article aria-labelledby={titleId} data-compare-run={run.n} data-cid={entry.manifestCid}>
      <header className={styles.header}>
        <h3 id={titleId} className={styles.cardTitle}>
          {run.label} · {role}
        </h3>
        <FallbackChip source={run.source} />
      </header>
      <span>{manifest.runId}</span>
      <p>
        {formatUtc(manifest.startedAt)} – {formatUtc(manifest.finishedAt)} UTC
      </p>
      <p>
        Manifest <CidDisplay cid={entry.manifestCid} /> · previous{" "}
        {manifest.previousManifestCid === null ? (
          <span>{RUNS_TEXTS.firstRun}</span>
        ) : (
          <Link
            className={styles.link}
            to={verifyPath(manifest.previousManifestCid)}
            data-previous-cid={manifest.previousManifestCid}
            title={manifest.previousManifestCid}
          >
            {shortCid(manifest.previousManifestCid)}
          </Link>
        )}
      </p>
      <p>
        {manifest.artifacts.length} files ·{" "}
        <span data-total-size={totalSize}>{humanSize(totalSize)} in total</span>
        {car === undefined ? null : (
          <>
            {" · "}
            <Link className={styles.link} to={verifyPath(car.cid)} data-car-link={car.cid}>
              {/* A batched run publishes one CAR per batch; the link opens the first. */}
              {cars.length > 1 ? `CAR 1 of ${cars.length}` : "CAR"}
            </Link>
          </>
        )}
      </p>
      <details>
        <summary>Sources ({manifest.sources.length})</summary>
        <ul className={styles.list} aria-label={`Sources of ${run.label}`}>
          {manifest.sources.map((source) => (
            <li key={source.name} className={styles.item} data-source={source.name}>
              <span className={styles.itemTitle}>
                <code className={styles.mono}>{source.name}</code>
              </span>
              <span className={styles.itemBody}>
                {formatCount(source.records)} records ·{" "}
                <SourceDeltas
                  added={source.added}
                  changed={source.changed}
                  removed={source.removed}
                  firstRun={manifest.previousManifestCid === null}
                />
              </span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

const sourceName = (name: string): string => (isSourceName(name) ? sourceLabel(name) : name);

/**
 * An artifact's name without the run's own folders (`…/publish-run3-1/county-batched/cars/x.car`
 * → `county-batched/cars/x.car`): every run publishes under its own directory, so full names
 * never match across runs (label audit 2026-10-26: Compare said "0 kept the same CID").
 */
export function logicalName(name: string): string {
  const at = name.search(/\/publish-[^/]+\//);
  return at < 0 ? name : name.slice(name.indexOf("/", at + 1) + 1);
}

/** How many of `b`'s files kept a CID of `a`, changed (same logical name), are new, or went. */
export function artifactChanges(
  a: readonly { readonly name: string; readonly cid: string }[],
  b: readonly { readonly name: string; readonly cid: string }[],
): { same: number; changed: number; added: number; removed: number } {
  const beforeCids = new Set(a.map((x) => x.cid));
  const beforeNames = new Set(a.map((x) => logicalName(x.name)));
  const afterCids = new Set(b.map((x) => x.cid));
  const afterNames = new Set(b.map((x) => logicalName(x.name)));
  let same = 0;
  let changed = 0;
  let added = 0;
  for (const artifact of b) {
    if (beforeCids.has(artifact.cid)) same += 1;
    else if (beforeNames.has(logicalName(artifact.name))) changed += 1;
    else added += 1;
  }
  const removed = a.filter(
    (x) => !afterCids.has(x.cid) && !afterNames.has(logicalName(x.name)),
  ).length;
  return { same, changed, added, removed };
}

/** Per-source records and deltas, then how many files kept, changed or gained a CID. */
function ChangeTable({ a, b }: { readonly a: ComparedRun; readonly b: ComparedRun }): ReactElement {
  const { same, changed, added, removed } = artifactChanges(
    a.manifest.artifacts,
    b.manifest.artifacts,
  );
  // A manifest records added / changed / removed against its own previous run only, so the
  // columns hold for a pair of neighbours; for any other pair they would mislabel b's own delta
  // as "a to b" (label review 2026-10-26).
  const neighbours = b.manifest.previousManifestCid === a.entry.manifestCid;
  const delta = (n: number, sign: string): string =>
    neighbours ? `${sign}${formatCount(n)}` : "—";
  return (
    <section
      className={styles.card}
      aria-labelledby="changed-table-heading"
      data-change-table=""
      data-neighbours={neighbours ? "yes" : "no"}
    >
      <h3 id="changed-table-heading" className={styles.cardTitle}>
        What changed, per source and artifact
      </h3>
      {neighbours ? null : (
        <p className={styles.helperText} data-delta-note="">
          Added, changed and removed are recorded against each run's own previous run, and {b.label}{" "}
          does not follow {a.label}, so they are not shown for this pair. The file CIDs below still
          compare the two runs directly.
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Source</th>
              <th className={styles.num}>{a.label}</th>
              <th className={styles.num}>{b.label}</th>
              <th className={styles.num}>Added</th>
              <th className={styles.num}>Changed</th>
              <th className={styles.num}>Removed</th>
            </tr>
          </thead>
          <tbody>
            {b.manifest.sources.map((source) => {
              const prev = a.manifest.sources.find((s) => s.name === source.name);
              return (
                <tr key={source.name} data-change-source={source.name}>
                  <td data-label="Source">
                    <span>
                      <span>{sourceName(source.name)}</span>
                      <code>{source.name}</code>
                    </span>
                  </td>
                  <td data-label={a.label} className={styles.num}>
                    {prev === undefined ? "not in this run" : formatCount(prev.records)}
                  </td>
                  <td data-label={b.label} className={styles.num}>
                    {formatCount(source.records)}
                  </td>
                  <td data-label="Added" className={styles.num}>
                    {delta(source.added, "+")}
                  </td>
                  <td data-label="Changed" className={styles.num}>
                    {delta(source.changed, "~")}
                  </td>
                  <td data-label="Removed" className={styles.num}>
                    {delta(source.removed, "−")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.provenance} data-artifact-cids="">
        <Icon name="info" size="small" />
        <span>
          Files: {same} kept the same CID, {changed} changed CID, {added} are new in {b.label},{" "}
          {removed} are not in {b.label}. An unchanged file keeps the same CID, so a changed CID
          always means changed bytes.
        </span>
      </p>
    </section>
  );
}

/** The immutability checks that need only the two manifests and the index (no network). */
function ImmutabilityChecks({
  a,
  b,
}: {
  readonly a: ComparedRun;
  readonly b: ComparedRun;
}): ReactElement {
  const cars = b.manifest.artifacts.filter((x) => x.kind === "car");
  const car = cars[0];
  const checks: readonly { ok: boolean; icon: string; text: string }[] = [
    {
      ok: a.entry.manifestCid !== b.entry.manifestCid,
      icon: "check",
      text: "New run has a distinct CID",
    },
    {
      ok: b.manifest.previousManifestCid === a.entry.manifestCid,
      icon: "check",
      text: "New manifest links to the old one (previousManifestCid)",
    },
    { ok: true, icon: "check", text: "Both runs listed in runs/index.json" },
    { ok: car !== undefined, icon: "inventory_2", text: "CAR available" },
  ];
  return (
    <section className={styles.card} aria-labelledby="checks-heading" data-immutability="">
      <h3 id="checks-heading" className={styles.cardTitle}>
        Immutability checks
      </h3>
      <div className={styles.chips}>
        {checks.map((check) => (
          <StatusPill
            key={check.text}
            status={check.ok ? "verified" : "warning"}
            icon={check.ok ? check.icon : "warning"}
            text={check.ok ? check.text : `Not true here: ${check.text}`}
          />
        ))}
      </div>
      <div className={styles.chips}>
        {car === undefined ? null : (
          <Link className={styles.textLink} to={verifyPath(car.cid)}>
            <Icon name="download" size="medium" />
            {cars.length > 1 ? `CAR 1 of ${cars.length}, ${b.label}` : `CAR, ${b.label}`}
          </Link>
        )}
        <Link className={styles.textLink} to={verifyPath(b.entry.manifestCid)}>
          <Icon name="verified" size="medium" />
          Verify both on gateways
        </Link>
      </div>
    </section>
  );
}

function OldManifestCheck({ cid }: { readonly cid: string }): ReactElement {
  const [resolves, setResolves] = useState<ChainResolves>(PENDING_RESOLVES);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResolves(PENDING_RESOLVES);
    setFailure(null);
    let urls: ReturnType<typeof verifyUrlsFromEnv>;
    try {
      urls = verifyUrlsFromEnv();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return () => controller.abort();
    }
    checkManifestResolves(cid, { urls, signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setResolves(result);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [cid, attempt]);
  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  const text = oldManifestResolvesText(resolves);
  return (
    <section className={styles.card} aria-labelledby="old-manifest-heading">
      <h3 id="old-manifest-heading" className={styles.cardTitle}>
        Old manifest on the public gateways
      </h3>
      {text === null && failure === null ? null : (
        <div className={styles.chips}>
          {text === null ? null : <StatusPill status="verified" text={text} />}
          {failure === null ? null : <StatusPill status="error" text={failure} />}
        </div>
      )}
      <ul className={styles.list}>
        {VERIFY_GATEWAYS.map((gateway) => (
          <li
            key={gateway}
            className={`${styles.item} ${styles.itemBody}`}
            data-gateway={gateway}
            data-check={resolves[gateway]}
          >
            {GATEWAY_LABELS[gateway]}: {CHECK_LABELS[resolves[gateway]]}
            {isIndependentGateway(gateway) ? null : ` · ${VERIFY_TEXTS.laneRoles[gateway]}`}
          </li>
        ))}
      </ul>
      <p className={styles.itemBody}>
        <button type="button" className={styles.action} onClick={recheck}>
          Re-check
        </button>
      </p>
    </section>
  );
}
