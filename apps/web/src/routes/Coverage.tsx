// Coverage (`/tx/travis/coverage`; A-13 T021, AC-2, FR-002, FR-007, FR-022; TC-003, TC-016,
// TC-017). One Atlas card per record kind (Coverage.kinds.ts): each manifest coverage key of the
// kind (`data-coverage-key`) with its count, derivation label and note, the collection time of
// the kind's source, the published table it comes from (with its part CIDs) and the § 8
// provenance line (manifest CID, run). A kind with no key, a missing table or source, and every
// denominator without a `source_total:{source}` key say why in words (data/coverage-rows). Every
// count comes from the manifest; nothing is computed here but sums and shares of manifest numbers.
//
// A-16 (T041, T046; boards Coverage1440/768/390, CoverageStates): header with the run chip and
// Download CSV, four KPI tiles, "Published vs each source's own total", the per-kind cards, Known
// limitations, then "Source speed and constraints" and "Cost" (CoverageCostLimits, which do not
// depend on the run, so they still show when the manifest cannot load, as the Error state says).
// PO 2026-10-26 ("more readable, no big spacing"): dense kind cards (label · count rows grouped
// by derivation, one source line, one table line, notes behind "Details"), one short reason per
// kind without a count, the manifest CID and run said once per section, and "Coverage by area" as
// one line. The source table reads each source's records at capture (`sources[].records`, or a
// `source_total:` key when the manifest has one) against its published rows (SOURCE_PUBLISHED_KEY,
// e.g. parcels_published for the TCAD roll). Justified differences: the area heatmap, the trend
// column and the Reconciliation section are not drawn because the published manifest has no
// per-area, per-run-history or merge counts. A react-router lazy route module.
import type { ManifestArtifact, ManifestSource, RunManifestV1 } from "@countylens/contract";
import {
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  ROUTES,
  verifyPath,
  type Derivation,
} from "@countylens/shared";
import { resolveBatchGroups } from "@countylens/query-core";
import type { ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import { RunSelect } from "../components/RunSelect";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { Provenance, formatUtc } from "../components/Provenance";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import {
  SOURCE_TOTAL_PREFIX,
  coverageRows,
  denominatorRows,
  type CoverageRow,
  type DenominatorRow,
} from "../data/coverage-rows";

import type { LoadedRun } from "../data/run-loader";
import { runNumbers, type RunNumber } from "../data/runs-index";
import {
  COVERAGE_KINDS,
  COVERAGE_KIND_IN_TABLE,
  COVERAGE_KIND_MISSING,
  COVERAGE_KIND_NOT_COLLECTED,
  COVERAGE_NOT_PUBLISHED,
  COVERAGE_SOURCE_MISSING,
  COVERAGE_TABLE_MISSING,
  COVERAGE_TOTAL_MISSING,
  OTHER_KIND,
  SOURCE_PUBLISHED_KEY,
  SOURCE_TITLES,
  kindOf,
  keyWords,
  type CoverageKind,
} from "./Coverage.kinds";
import cov from "./Coverage.module.css";
import { CostSection, SourceSpeed } from "./CoverageCostLimits";
import costStyles from "./CoverageCostLimits.module.css";
import { RUN_STAGE_TEXTS, ShareBar, runErrorNode, runLabel, useRun } from "./Runs.shared";
import styles from "./Runs.module.css";

/** Coverage counts with en-US thousands separators (review 2026-10-26; the tests parse grouping). */
const groupedCount = (count: number): string => count.toLocaleString("en-US");

export function Component(): ReactElement {
  // The shared run dropdown (PO rule): `?run=` picks a run, none means the latest.
  const [params, setParams] = useSearchParams();
  const { state, retry } = useRun(params.get("run"));
  const choose = (runId: string | null): void => setParams(runId === null ? {} : { run: runId });
  return (
    <section
      aria-label="Coverage"
      data-route="coverage"
      data-state={state.kind}
      className={styles.page}
    >
      {/* Board Coverage1440: title and intro on the left, the run and Download CSV on the right. */}
      <div className={costStyles.head}>
        <div className={styles.pageHead}>
          <h2 className={styles.pageTitle}>Coverage</h2>
          <p className={styles.intro}>
            How much of each source is loaded, measured against that source&apos;s own total, and
            where in the county it reaches. Every count has its date and run.
          </p>
        </div>
        {state.kind === "ready" ? <HeadActions run={state.run} onRun={choose} /> : null}
      </div>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <>
          <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
          <p className={styles.helperText}>
            Nothing is wrong with the data. Source speed and Cost below do not depend on the run.
          </p>
        </>
      ) : null}
      {state.kind === "ready" ? <CoverageCards run={state.run} /> : null}
      <SourceSpeed />
      <CostSection />
    </section>
  );
}

/** The shown run's number by the one rule (runNumbers; `null` for the pilot slice). */
function runNumber(run: LoadedRun): RunNumber {
  return runNumbers(run.index).get(run.entry.runId) ?? null;
}

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function coverageCsv(rows: readonly CoverageRow[], runId: string): string {
  const head = ["Run", "Key", "Label", "Count", "Derivation", "Note"].map(csvCell).join(",");
  const lines = rows.map((r) =>
    [runId, r.key, r.label, String(r.count), r.derivationLabel, r.note ?? ""]
      .map(csvCell)
      .join(","),
  );
  return [head, ...lines].join("\n");
}

function HeadActions({
  run,
  onRun,
}: {
  readonly run: LoadedRun;
  readonly onRun: (runId: string | null) => void;
}): ReactElement {
  const { manifest, read } = run;
  const download = (): void => {
    const blob = new Blob([coverageCsv(coverageRows(manifest), manifest.runId)], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coverage.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={costStyles.headActions}>
      <FallbackChip source={read.source} />
      <RunSelect
        runs={run.index.runs}
        value={run.entry.runId}
        onChange={onRun}
        label="Run"
        hideLabel
      />
      <button type="button" className={costStyles.outlined} onClick={download}>
        <Icon name="download" size="medium" />
        Download CSV
      </button>
    </div>
  );
}

function CoverageCards({ run }: { readonly run: LoadedRun }): ReactElement {
  const { manifest, manifestCid } = run;
  const rows = coverageRows(manifest);
  const byKind = new Map<string, CoverageRow[]>();
  for (const row of rows) {
    const id = kindOf(row.key).id;
    byKind.set(id, [...(byKind.get(id) ?? []), row]);
  }
  const kinds = [...COVERAGE_KINDS, ...(byKind.has(OTHER_KIND.id) ? [OTHER_KIND] : [])];
  const counted = kinds.filter((k) => (byKind.get(k.id)?.length ?? 0) > 0);
  const uncounted = kinds.filter((k) => (byKind.get(k.id)?.length ?? 0) === 0);
  const number = runNumber(run);
  return (
    <>
      <KpiTiles run={run} kinds={kinds} byKind={byKind} number={number} />
      <LoadedVsTotal manifest={manifest} manifestCid={manifestCid} />
      <section className={cov.section} aria-labelledby="kinds-heading" data-section="kinds">
        <div className={cov.sectionHead}>
          <h3 id="kinds-heading" className={styles.sectionTitle}>
            Counts by record kind
          </h3>
          <RunProvenance manifest={manifest} manifestCid={manifestCid} />
        </div>
        {/* PO 2026-10-26: dense cards, provenance once per kind, one short reason per gap. */}
        <div className={cov.kindGrid}>
          {counted.map((kind) => (
            <KindCard
              key={kind.id}
              kind={kind}
              rows={byKind.get(kind.id) ?? []}
              manifest={manifest}
            />
          ))}
        </div>
        {uncounted.length === 0 ? null : (
          <div className={cov.gapGrid}>
            {uncounted.map((kind) => (
              <KindCard key={kind.id} kind={kind} rows={[]} manifest={manifest} />
            ))}
          </div>
        )}
      </section>
      <AreaNotice />
      <KnownLimitations manifest={manifest} />
    </>
  );
}

/** The § 8 provenance line, said once per section: the manifest CID and the run. */
function RunProvenance({
  manifest,
  manifestCid,
}: {
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
}): ReactElement {
  return (
    <Provenance>
      Manifest <CidDisplay cid={manifestCid} /> · run {manifest.runId}
    </Provenance>
  );
}

function KpiTiles({
  run,
  kinds,
  byKind,
  number,
}: {
  readonly run: LoadedRun;
  readonly kinds: readonly CoverageKind[];
  readonly byKind: ReadonlyMap<string, readonly CoverageRow[]>;
  readonly number: RunNumber;
}): ReactElement {
  const { manifest } = run;
  const listed = kinds.filter((k) => k.id !== OTHER_KIND.id);
  const withCounts = listed.filter((k) => (byKind.get(k.id)?.length ?? 0) > 0).length;
  // Records read from the sources at capture (manifest sources[].records), not published rows.
  const read = manifest.sources.reduce((sum, s) => sum + s.records, 0);
  const published = sourceFigures(manifest).filter((f) => f.published !== null);
  const publishedSum = published.reduce((sum, f) => sum + (f.published ?? 0), 0);
  return (
    <div className={`${styles.tiles} ${cov.tiles}`} data-kpi-tiles="">
      <div className={styles.tile} data-tile="kinds">
        <span className={styles.tileLabel}>Record kinds with counts</span>
        <b className={styles.tileBig}>
          {withCounts} of {listed.length}
        </b>
        <ShareBar
          value={withCounts}
          max={listed.length}
          label={`${withCounts} of ${listed.length} kinds have counts`}
        />
      </div>
      <div className={styles.tile} data-tile="loaded">
        <span className={styles.tileLabel}>Source records read</span>
        <b className={styles.tileBig}>{groupedCount(read)}</b>
        <span className={styles.tileLabel}>
          {published.length === 0
            ? `from ${manifest.sources.length} sources · none published as rows`
            : `${groupedCount(publishedSum)} published as rows · ${manifest.sources.length} sources`}
        </span>
      </div>
      <div className={styles.tile} data-tile="areas">
        <span className={styles.tileLabel}>Areas with permit data</span>
        <b className={styles.tileBig} aria-label="Not available">
          —
        </b>
        <span className={styles.tileLabel}>No per-area counts in this run&apos;s manifest</span>
      </div>
      <div className={styles.tile} data-tile="counted-from">
        <span className={styles.tileLabel}>Counted from</span>
        <b className={styles.tileBig}>{runLabel(number, manifest.finishedAt)}</b>
        <span className={costStyles.pillLine}>
          <StatusPill status="info" icon="cloud_done" text="Published" />
          <Link className={styles.textLink} to={ROUTES.runs}>
            Open the run
          </Link>
        </span>
      </div>
    </div>
  );
}

/**
 * The parts of `{group}/{table}`. A part's table is its parent folder and its group the one
 * query-core resolves for its export batch (the rule parquet-meta's `catalogTables` and
 * data-groups use), so the pilot's `tables/<group>/<table>/<part>` and a full-county run's
 * `…/tables/<bNN>/<table>/<part>` both match (data audit 2026-10-26, row 6).
 */
function tableParts(manifest: RunManifestV1, table: string): ManifestArtifact[] {
  const parts = manifest.artifacts.filter((a) => a.kind === "table");
  const groups = resolveBatchGroups(parts.map((a) => a.name));
  return parts.filter((a) => {
    const segs = a.name.split("/");
    const group = groups.get(segs.slice(0, -2).join("/"));
    return group !== undefined && group !== null && `${group}/${segs.at(-2) ?? ""}` === table;
  });
}

/** The kind's rows grouped by derivation (the label is said once per group, not per row). */
function byDerivation(rows: readonly CoverageRow[]): [Derivation, CoverageRow[]][] {
  const groups = new Map<Derivation, CoverageRow[]>();
  for (const row of rows) groups.set(row.derivation, [...(groups.get(row.derivation) ?? []), row]);
  return [...groups.entries()];
}

const rowLabel = (row: CoverageRow): string =>
  row.label === row.key ? keyWords(row.key) : row.label;

// PO 2026-10-26: one dense card per kind. Rows are label · count (right-aligned), grouped under
// their derivation; the source, collection time and denominator are one small line; the table
// is one line; the notes and part CIDs sit behind "Details". A kind with no coverage key is a
// single line with one short reason.
function KindCard({
  kind,
  rows,
  manifest,
}: {
  readonly kind: CoverageKind;
  readonly rows: readonly CoverageRow[];
  readonly manifest: RunManifestV1;
}): ReactElement {
  const titleId = `kind-${kind.id}`;
  const source =
    kind.source === null ? undefined : manifest.sources.find((s) => s.name === kind.source);
  const parts = kind.table === null ? [] : tableParts(manifest, kind.table);
  const notes = rows.filter((row) => row.note !== null);
  const tableLine =
    kind.table === null || parts.length === 0 ? null : (
      <div className={cov.fact} data-table={kind.table}>
        Table <code className={styles.mono}>{kind.table}</code>
        {parts.length === 1 ? (
          <>
            {" · "}
            <CidDisplay cid={parts[0]?.cid ?? ""} />
          </>
        ) : (
          <details className={cov.details}>
            <summary>{parts.length} parts</summary>
            <ul className={cov.cidList}>
              {parts.map((part) => (
                <li key={part.cid}>
                  <CidDisplay cid={part.cid} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  if (rows.length === 0) {
    const reason =
      kind.reason ?? (tableLine === null ? COVERAGE_KIND_NOT_COLLECTED : COVERAGE_KIND_IN_TABLE);
    return (
      <article className={`${cov.card} ${cov.gap}`} aria-labelledby={titleId} data-kind={kind.id}>
        <h4 id={titleId} className={cov.kindTitle}>
          {kind.title}
        </h4>
        {kind.reason === null && tableLine !== null ? (
          // PO 2026-10-26: rows published but no count in the manifest: no pill is drawn (the
          // table line below shows the rows); the TC-017 words stay for screen readers.
          <span className={cov.srOnly} data-kind-missing="">
            {`${reason} · ${COVERAGE_KIND_MISSING}`}
          </span>
        ) : (
          <span
            className={cov.reason}
            data-kind-missing=""
            {...(kind.source === null ? { "data-kind-denominator": "none" } : {})}
          >
            {/* One pill: the short reason drawn, the TC-017 words kept as its text and tooltip. */}
            <StatusPill
              status="unavailable"
              text={`${reason} · ${COVERAGE_KIND_MISSING}`}
              short={reason}
            />
          </span>
        )}
        {/* A kind with no source says its reason only; the pill above is its denominator line. */}
        {kind.id === OTHER_KIND.id || kind.source === null ? null : (
          <div className={cov.fact} data-kind-denominator={kind.source}>
            {sourceLine(kind, manifest, source)}
          </div>
        )}
        {tableLine}
      </article>
    );
  }
  return (
    <article className={cov.card} aria-labelledby={titleId} data-kind={kind.id}>
      <h4 id={titleId} className={cov.kindTitle}>
        {kind.title}
      </h4>
      {byDerivation(rows).map(([derivation, group]) => (
        <div key={derivation} data-derivation={derivation}>
          <p className={cov.derivation}>{DERIVATION_LABELS[derivation]}</p>
          <ul className={cov.rows} aria-label={`${kind.title} · ${DERIVATION_LABELS[derivation]}`}>
            {group.map((row) => (
              <li key={row.key} data-coverage-key={row.key}>
                <span>{rowLabel(row)}</span>
                <span className={styles.count} data-count={row.count}>
                  {groupedCount(row.count)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {kind.id === OTHER_KIND.id ? null : (
        <div className={cov.fact} data-kind-denominator={kind.source ?? "none"}>
          {sourceLine(kind, manifest, source)}
        </div>
      )}
      {tableLine ??
        (kind.id === OTHER_KIND.id ? null : (
          <div className={cov.fact}>{COVERAGE_TABLE_MISSING}</div>
        ))}
      {notes.length === 0 ? null : (
        <details className={cov.details}>
          <summary>Notes</summary>
          <dl className={cov.notes}>
            {notes.map((row) => (
              <div key={row.key}>
                <dt>{rowLabel(row)}</dt>
                <dd>{row.note}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </article>
  );
}

// The kind's source in one line: its readable name, records read and collection time, then its
// own denominator (FR-002) — the manifest's `source_total:{source}` value with its derivation,
// else the short "no source total recorded". Never a typed number.
function sourceLine(
  kind: CoverageKind,
  manifest: RunManifestV1,
  source: ManifestSource | undefined,
): ReactElement {
  if (kind.source === null) return <>No single source in this run</>;
  if (source === undefined) return <>{COVERAGE_SOURCE_MISSING}</>;
  const total = manifest.coverage[`${SOURCE_TOTAL_PREFIX}${kind.source}`];
  return (
    <>
      {SOURCE_TITLES[source.name] ?? source.name} · {groupedCount(source.records)} records read ·
      collected <time dateTime={source.captured_at}>{formatUtc(source.captured_at)}</time> UTC ·{" "}
      {total === undefined ? (
        COVERAGE_TOTAL_MISSING
      ) : (
        <>
          source total <span data-denominator-value={total.count}>{groupedCount(total.count)}</span>{" "}
          ({DERIVATION_LABELS[total.derivation]})
        </>
      )}
    </>
  );
}

interface SourceFigure {
  readonly row: DenominatorRow;
  /** Records read from the source at capture (sources[].records). */
  readonly read: number;
  /** Published rows of the source's records (SOURCE_PUBLISHED_KEY), null when none. */
  readonly published: number | null;
  readonly publishedKey: string | null;
}

function sourceFigures(manifest: RunManifestV1): SourceFigure[] {
  const records = new Map(manifest.sources.map((s) => [s.name, s.records]));
  return denominatorRows(manifest).map((row) => {
    const key = SOURCE_PUBLISHED_KEY[row.source] ?? null;
    const entry = key === null ? undefined : manifest.coverage[key];
    return {
      row,
      read: records.get(row.source) ?? 0,
      published: entry?.count ?? null,
      publishedKey: entry === undefined ? null : key,
    };
  });
}

// "Published vs each source's records": what the run read from each source at capture
// (sources[].records, or the source's own `source_total:` count when the manifest has one) and
// how many of them are published as rows (the source's published coverage key). No bar where a
// figure is missing: "—" and a short reason.
function LoadedVsTotal({
  manifest,
  manifestCid,
}: {
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
}): ReactElement {
  return (
    <section
      className={cov.section}
      aria-labelledby="denominators-heading"
      data-section="loaded-vs-total"
    >
      <div className={cov.sectionHead}>
        <h3 id="denominators-heading" className={styles.sectionTitle}>
          Published vs each source&apos;s own total
        </h3>
        <Provenance>
          <Link className={styles.link} to={verifyPath(manifestCid)}>
            Run manifest
          </Link>{" "}
          <CidDisplay cid={manifestCid} /> · run {manifest.runId}
        </Provenance>
      </div>
      <table
        className={`${styles.table} ${costStyles.stack} ${costStyles.flat} ${cov.sourceTable}`}
        aria-label="Published vs source total"
      >
        <thead>
          <tr>
            <th>Source</th>
            <th className={styles.num}>Source total</th>
            <th className={styles.num}>Published</th>
            <th>Share</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          {sourceFigures(manifest).map(({ row, read, published, publishedKey }) => {
            const total = row.count ?? read;
            const share = published === null || total === 0 ? null : (published / total) * 100;
            return (
              <tr key={row.source} data-denominator={row.source}>
                <td data-label="Source">
                  <span className={cov.sourceName}>
                    <b>{SOURCE_TITLES[row.source] ?? row.source}</b>
                    <code className={styles.mono}>{row.source}</code>
                  </span>
                </td>
                <td data-label="Source total" className={styles.num}>
                  {row.count === null ? (
                    <span data-records={read} title="Records read from the source at capture">
                      {groupedCount(read)} <span className={cov.sub}>read</span>
                    </span>
                  ) : (
                    <span className={styles.count} data-count={row.count}>
                      {groupedCount(row.count)}
                    </span>
                  )}
                </td>
                <td data-label="Published" className={styles.num}>
                  {published === null ? (
                    <span>
                      — <span className={cov.sub}>{COVERAGE_NOT_PUBLISHED}</span>
                    </span>
                  ) : (
                    <span data-published={published} data-published-key={publishedKey ?? ""}>
                      {groupedCount(published)}
                    </span>
                  )}
                </td>
                <td data-label="Share">
                  {share === null ? (
                    "—"
                  ) : (
                    <span className={cov.share}>
                      <ShareBar
                        value={Math.min(100, share)}
                        max={100}
                        label={`${share.toFixed(1)} percent published`}
                      />
                      <span>{share.toFixed(1)}%</span>
                    </span>
                  )}
                </td>
                <td data-label="Collected">
                  <time dateTime={row.capturedAt}>{formatUtc(row.capturedAt)}</time> UTC
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {manifest.sources.some(
        (s) => manifest.coverage[`${SOURCE_TOTAL_PREFIX}${s.name}`] === undefined,
      ) ? (
        <p className={styles.helperText}>
          Where the manifest has no <code className={styles.mono}>source_total:…</code> key, the
          total is the records the run read from the source at capture.
        </p>
      ) : null}
    </section>
  );
}

function AreaNotice(): ReactElement {
  return (
    <section className={cov.notice} aria-labelledby="area-heading" data-section="by-area">
      <h3 id="area-heading" className={styles.sectionTitle}>
        Coverage by area
      </h3>
      <StatusPill
        status="unavailable"
        text="Not available · no per-area counts in this run's manifest"
      />
    </section>
  );
}

/** Known limitations show the first five; CSS shows the rest when "Show all" is open (A-16). */
const LIMITATIONS_SHOWN = 5;

function KnownLimitations({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  const items: { key: string; text: string; source: string | null }[] = [
    ...manifest.limitations.map((text) => ({ key: `run:${text}`, text, source: null })),
    ...manifest.sources.flatMap((s) =>
      s.limitations.map((text) => ({ key: `${s.name}:${text}`, text, source: s.name })),
    ),
  ];
  return (
    <section className={cov.section} aria-labelledby="limits-heading" data-section="limitations">
      <h3 id="limits-heading" className={styles.sectionTitle}>
        Known limitations
      </h3>
      {items.length === 0 ? (
        <StatusPill status="unavailable" text="No limitation is recorded in this run's manifest" />
      ) : (
        <ul className={`${styles.limitations} ${cov.limitations}`}>
          {items.map((item) => (
            <li key={item.key} className={styles.itemBody}>
              {item.text}
              {item.source === null ? null : (
                <>
                  {" · "}
                  <code className={styles.mono}>{SOURCE_TITLES[item.source] ?? item.source}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > LIMITATIONS_SHOWN ? (
        <details className={cov.details}>
          <summary>Show all {items.length} limitations</summary>
        </details>
      ) : null}
    </section>
  );
}
