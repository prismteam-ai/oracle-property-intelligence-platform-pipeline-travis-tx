// Data · Catalog (`/data/catalog`; A-13 T037, US8, AC-10, FR-010, FR-019, FR-024; A-16 board
// DataCatalog1440/768, Data390). Left: "Find a table or field", the run's elephant-cli tables (one
// row per table, its row count from the Parquet footers; the `_has_` relationship tables under one
// collapsible row), "Also published" (the run manifest), where names and counts come from, and
// the contract views. Right: the selected table's header card (name, Copy schema, description,
// rows, last updated, source, licence and part CIDs linking to Verify) and its field table. Columns
// and "rows in the published file" come from the Parquet footers (hyparquet, read by HTTP Range
// from the host that served the manifest; this route chunk is the only importer of it);
// `published_rows` from a coverage key that maps to the table. While the manifest lists no
// tables-export.json the page says so. When the manifest or every footer is unreachable the page
// says "Catalog unavailable · {reason}" with a link to the manifest page: never a cached or sample
// list. `?run=` picks an indexed run (latest by default) and `?table=` the shown table.
// A react-router lazy route module exporting `Component`.
import type { RunManifestV1 } from "@countylens/contract";
import { TRAVIS_GROUP_SOURCES } from "@countylens/query-core";
import { PROGRESS_LABELS, sourceLabel } from "@countylens/shared";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import { ROUTES, verifyPath } from "@countylens/shared/routes";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import {
  CatalogFieldTable,
  DERIVED,
  AS_PUBLISHED,
  DerivedCard,
} from "../components/CatalogFieldTable";
import { DataTabs } from "../components/DataTabs";
import { RunSelect } from "../components/RunSelect";
import { ErrorBanner } from "../components/ErrorBanner";
import { FallbackChip } from "../components/FallbackChip";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { truncateCid } from "../components/CidDisplay";
import { formatUtc } from "../components/Provenance";
import { coverageRows, type CoverageRow } from "../data/coverage-rows";
import {
  catalogTables,
  readTableMeta,
  type CatalogTable,
  type ParquetColumn,
} from "../data/parquet-meta";
import type { LoadedRun } from "../data/run-loader";
import { PART_CONCURRENCY } from "../data/fetch-parts";
import { runName as runNameOf, runNumbers, runsByFinish, type RunNumber } from "../data/runs-index";
import { COVERAGE_KINDS } from "./Coverage.kinds";
import { kindOf } from "./Coverage.kinds";
import { RUN_STAGE_TEXTS, useRun } from "./Runs.shared";
import styles from "./DataCatalog.module.css";

/** Counts on screen use thousands separators (hosted review); exact values stay in data-* hooks. */
const formatCount = (n: number): string => n.toLocaleString("en-US");

const TABLES_EXPORT = "tables-export.json";
/** A batched table export directory (Run 1 onward): `…/county-batched/tables/b01`,
 *  `…/permits-batched/tables/b03`. */
const BATCHED_TABLES_DIR = /(^|\/)tables\/b\d+$/;

/** True when the run ships a table export: `tables-export.json` or batched table directories. */
function hasTableExport(artifacts: RunManifestV1["artifacts"]): boolean {
  return artifacts.some(
    (a) => a.name === TABLES_EXPORT || (a.kind === "directory" && BATCHED_TABLES_DIR.test(a.name)),
  );
}
/**
 * Tables read at once. The host's whole budget (PART_CONCURRENCY: 16 on the CID copy, 3 on a
 * public gateway) is shared out between them, each table reading its parts' footers in parallel
 * (label review 2026-10-26: two tables with one footer at a time took about 30 s on Run 4).
 */
const TABLE_CONCURRENCY = 4;
/** Shown on a row until its own Parquet footer has been read. */
const FOOTER_PENDING = "reading the Parquet footer…";

type TableResult =
  | { readonly kind: "ok"; readonly columns: readonly ParquetColumn[]; readonly rows: number }
  | { readonly kind: "fail"; readonly reason: string };

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text === "" ? "the Parquet footer could not be read" : text;
}

async function readTable(
  table: CatalogTable,
  run: LoadedRun,
  signal: AbortSignal,
  concurrency: number,
): Promise<TableResult> {
  try {
    const meta = await readTableMeta(
      table.parts.map((part) => ({ name: part.name, cid: part.cid, size: part.size })),
      (part) => run.read.partUrl({ name: part.name, cid: part.cid }),
      { signal, concurrency },
    );
    return { kind: "ok", columns: meta.columns, rows: meta.rows };
  } catch (error) {
    return { kind: "fail", reason: reasonOf(error) };
  }
}

/** Coverage rows of `published_rows` derivation whose record kind is published in `table`. */
function publishedRowsFor(table: CatalogTable, manifest: RunManifestV1): CoverageRow[] {
  const path = table.table.replace(".", "/");
  const kinds = COVERAGE_KINDS.filter((kind) => kind.table === path).map((k) => k.id);
  return coverageRows(manifest).filter(
    (row) => row.derivation === "published_rows" && kinds.includes(kindOf(row.key).id),
  );
}

/** A13-7: why a part is not under a table row (missing data says why). */
const UNCLASSIFIED_REASON =
  "Their export batch has no known data group, so they are not listed as a table; each is still in the run manifest.";

/** Parquet table parts of the manifest that no catalog row lists (their batch group is unknown). */
function unclassifiedParts(manifest: RunManifestV1, tables: readonly CatalogTable[]): number {
  const listed = new Set(tables.flatMap((t) => t.parts.map((p) => p.name)));
  return manifest.artifacts.filter(
    (a) => a.kind === "table" && a.name.endsWith(".parquet") && !listed.has(a.name),
  ).length;
}

/** The lexicon class (export table name) of a `{group}.{table}` catalog key. */
const classOf = (table: string): string => table.slice(table.indexOf(".") + 1);
const groupOf = (table: string): string => table.slice(0, table.indexOf("."));
const isRelationship = (table: string): boolean => classOf(table).includes("_has_");

/** Board icons, limited to the glyphs of the self-hosted Material Symbols subset. */
const TABLE_ICONS: Readonly<Record<string, string>> = {
  property: "map",
  properties: "map",
  parcel: "map",
  geometry: "location_on",
  address: "location_on",
  property_improvement: "roofing",
  structure: "roofing",
  sales_history: "history",
  person: "badge",
  company: "badge",
};
const iconOf = (table: string): string => TABLE_ICONS[classOf(table)] ?? "dataset";

interface TableSource {
  /** The manifest `sources[].name`, shown in the field table's Source column. */
  readonly name: string;
  readonly label: string;
  readonly url: string;
}

/** The manifest source a table's data group was captured from (null when not in this run). */
function sourceOf(table: CatalogTable, manifest: RunManifestV1): TableSource | null {
  const name = TRAVIS_GROUP_SOURCES[groupOf(table.table)];
  const source = manifest.sources.find((s) => s.name === name);
  return source === undefined
    ? null
    : { name: source.name, label: sourceLabel(source.name), url: source.url };
}

/** What a row of the table is, from its export name and the run's own limitations. */
function describe(table: string, manifest: RunManifestV1): string {
  const klass = classOf(table);
  if (isRelationship(table)) {
    const [from, to] = klass.split("_has_");
    return `One row per ${from ?? ""} → ${to ?? ""} relationship (from_cid → to_cid), exported by elephant-cli.`;
  }
  const scope = manifest.limitations.filter((l) => l.startsWith(`${klass} `));
  return [
    `One row per ${klass} record, exported by elephant-cli from the lexicon class ${klass}.`,
    ...scope.map((l) => `Run scope: ${l}.`),
  ].join(" ");
}

export function Component(): ReactElement {
  const [params, setParams] = useSearchParams();
  const requestedRun = params.get("run");
  const { state, retry, index } = useRun(requestedRun);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<ReadonlyMap<string, TableResult>>(new Map());
  const [listOpen, setListOpen] = useState(true);
  const [copied, setCopied] = useState("");
  const run = state.kind === "ready" ? state.run : null;

  // Each table's footer fills in on arrival (pending → ok | fail); the list paints before any read.
  useEffect(() => {
    if (run === null) return;
    const controller = new AbortController();
    setResults(new Map());
    const tables = catalogTables(run.manifest);
    const budget = PART_CONCURRENCY[run.read.source.kind];
    const tableWorkers = Math.max(1, Math.min(TABLE_CONCURRENCY, budget, tables.length));
    const partConcurrency = Math.max(1, Math.floor(budget / tableWorkers));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tables.length && !controller.signal.aborted) {
        const table = tables[next++] as CatalogTable;
        const result = await readTable(table, run, controller.signal, partConcurrency);
        if (controller.signal.aborted) return;
        setResults((previous) => new Map(previous).set(table.table, result));
      }
    };
    void Promise.all(Array.from({ length: tableWorkers }, worker));
    return () => controller.abort();
  }, [run, attempt]);

  const retryAll = useCallback(() => {
    retry();
    setAttempt((n) => n + 1);
  }, [retry]);

  const tables = run === null ? [] : catalogTables(run.manifest);
  const unclassified = run === null ? 0 : unclassifiedParts(run.manifest, tables);
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const shownTables =
    needle === ""
      ? tables
      : tables.filter((t) => {
          if (t.table.toLowerCase().includes(needle)) return true;
          const r = results.get(t.table);
          return r?.kind === "ok" && r.columns.some((c) => c.name.toLowerCase().includes(needle));
        });
  // One list per data group (county, property_improvement): a class name can be in both.
  const groups = [...new Set(shownTables.map((t) => groupOf(t.table)))];
  const wanted = params.get("table");
  const selected =
    shownTables.find((t) => t.table === wanted) ??
    shownTables.find((t) => !isRelationship(t.table)) ??
    shownTables[0];
  const failures = [...results.values()].flatMap((r) => (r.kind === "fail" ? [r.reason] : []));
  const allFailed = tables.length > 0 && failures.length === tables.length;
  let unavailable: string | null = null;
  if (state.kind === "error") unavailable = state.error.reason;
  else if (allFailed) unavailable = failures[0] ?? "the Parquet footers could not be read";
  const pageState = unavailable !== null ? "error" : run === null ? "loading" : "ready";

  const entries = index === undefined ? [] : runsByFinish(index);
  const latestId = entries.at(-1)?.runId;
  const numbers = index === undefined ? new Map<string, RunNumber>() : runNumbers(index);
  const shownName =
    run === null || !numbers.has(run.entry.runId)
      ? `Run ${run?.manifest.runId ?? ""}`
      : runNameOf(numbers.get(run.entry.runId) ?? null);

  const choose = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };

  const copySchema = (table: string, columns: readonly ParquetColumn[]): void => {
    const text = columns.map((c) => `${c.name}\t${c.type}`).join("\n");
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(`Schema of ${table} copied`))
      .catch(() => setCopied("The clipboard is not available in this browser"));
  };

  const row = (table: CatalogTable): ReactElement => {
    const result = results.get(table.table);
    const isSelected = table.table === selected?.table;
    return (
      <li key={table.table}>
        <button
          type="button"
          className={`${styles.row} ${isSelected ? styles.selected : ""}`}
          aria-pressed={isSelected}
          data-table={table.table}
          data-catalog-row={`tables/${table.table.replace(".", "/")}`}
          onClick={() => {
            choose({ table: table.table });
            setCopied("");
            // On a phone the folded list puts the chosen table's detail in view (CSS keeps the
            // list open from 600 px, so this changes nothing wider).
            setListOpen(false);
          }}
        >
          <Icon name={iconOf(table.table)} size="medium" />
          <span className={styles.rowName}>{classOf(table.table)}</span>
          <span className={styles.rowCount}>
            {result === undefined ? (
              <span data-footer-status="pending" title={FOOTER_PENDING}>
                …
              </span>
            ) : result.kind === "ok" ? (
              <span data-rows="" data-value={result.rows}>
                {formatCount(result.rows)}
              </span>
            ) : (
              <span data-footer-status="fail" title={result.reason}>
                unavailable<span className={styles.srOnly}> · {result.reason}</span>
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section
      aria-label="Data · Catalog"
      data-route="data-catalog"
      data-state={pageState}
      className={styles.page}
    >
      {/* Board DataCatalog1440: the title left, the Run menu right. */}
      <div className={styles.head}>
        <h2 className={styles.title}>Data</h2>
        {entries.length > 0 && latestId !== undefined ? (
          // The shared run dropdown (PO rule: a run list of run + date is RunSelect).
          <RunSelect
            runs={entries}
            value={run?.entry.runId ?? requestedRun ?? latestId}
            onChange={(runId) => setParams(runId === null ? {} : { run: runId })}
            label="Run"
            hideLabel
          />
        ) : null}
      </div>
      <DataTabs current="catalog" verifyCid={run === null ? null : run.manifestCid} />
      {pageState === "loading" ? (
        <>
          <LinearProgress
            label={PROGRESS_LABELS.runs}
            stageText={
              state.kind === "loading" ? RUN_STAGE_TEXTS[state.stage] : "Reading the run manifest"
            }
          />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {unavailable !== null ? (
        <ErrorBanner
          message={
            <>
              <span data-error-text="">{PAGE_TEXTS.catalogUnavailable(unavailable)}</span>{" "}
              <Link to={ROUTES.dataManifest}>Run manifest</Link>
            </>
          }
          onRetry={retryAll}
        />
      ) : null}
      {pageState === "ready" && run !== null ? (
        <>
          <FallbackChip source={run.read.source} />
          {hasTableExport(run.manifest.artifacts) ? null : (
            <p className={styles.notice} data-export-notice="">
              {PAGE_TEXTS.tableExportMissing}
            </p>
          )}
          {unclassified > 0 ? (
            <p className={styles.notice} data-unclassified-parts={unclassified}>
              <StatusPill
                status="unavailable"
                text={`unclassified table parts (${unclassified})`}
              />{" "}
              {UNCLASSIFIED_REASON}
            </p>
          ) : null}
          <div className={styles.layout}>
            <nav aria-label="Tables" className={styles.side}>
              <div className={styles.searchBox}>
                {/* The icon subset has no search glyph: a 20 px magnifier drawn in currentColor. */}
                <svg className={styles.searchIcon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9.5 3a6.5 6.5 0 0 1 5.2 10.4l5.4 5.4-1.4 1.4-5.4-5.4A6.5 6.5 0 1 1 9.5 3Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                </svg>
                <label className={styles.srOnly} htmlFor="catalog-find">
                  Find a table or field
                </label>
                <input
                  id="catalog-find"
                  className={styles.search}
                  type="text"
                  placeholder="Find a table or field"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                />
                {find === "" ? null : (
                  <button
                    type="button"
                    className={styles.clear}
                    aria-label="Clear the search"
                    onClick={() => setFind("")}
                  >
                    <Icon name="close" size="medium" />
                  </button>
                )}
              </div>
              <div className={styles.captionRow}>
                <span className={styles.caption}>
                  elephant-cli tables · {shownName} · one per class
                </span>
                {/* Data390: the list folds away on a phone; from 600 px it is always open. */}
                <button
                  type="button"
                  className={styles.toggle}
                  aria-label={listOpen ? "Hide the table list" : "Show the table list"}
                  aria-expanded={listOpen}
                  aria-controls="catalog-tables"
                  onClick={() => setListOpen((open) => !open)}
                >
                  <span className={listOpen ? styles.chevronUp : styles.chevronDown}>
                    <Icon name="chevron_right" size="medium" />
                  </span>
                </button>
              </div>
              <div
                id="catalog-tables"
                className={styles.lists}
                data-open={listOpen ? "true" : "false"}
              >
                {shownTables.length === 0 && tables.length > 0 ? (
                  <p className={styles.notice} role="status">
                    No table or field matches “{find.trim()}”.
                  </p>
                ) : null}
                {tables.length === 0 ? (
                  <StatusPill
                    status="unavailable"
                    text="no published table in this run's manifest"
                  />
                ) : null}
                {groups.map((group) => {
                  const own = shownTables.filter((t) => groupOf(t.table) === group);
                  const classes = own.filter((t) => !isRelationship(t.table));
                  const relations = own.filter((t) => isRelationship(t.table));
                  return (
                    <div key={group} className={styles.group} data-group={group}>
                      {groups.length > 1 ? (
                        <span className={styles.groupName}>{group}/</span>
                      ) : null}
                      {classes.length > 0 ? (
                        <ul className={styles.list} aria-label={`${group} tables`}>
                          {classes.map(row)}
                        </ul>
                      ) : null}
                      {relations.length > 0 ? (
                        <details
                          className={styles.relations}
                          open={
                            needle !== "" ||
                            (selected !== undefined && relations.includes(selected))
                          }
                        >
                          <summary className={styles.row}>
                            <Icon name="compare_arrows" size="medium" />
                            <span className={styles.rowName}>relationships/</span>
                            <span className={styles.rowCount}>{relations.length} tables</span>
                          </summary>
                          <ul className={styles.list} aria-label={`${group} relationship tables`}>
                            {relations.map(row)}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
                <span className={styles.subhead}>Also published</span>
                <ul className={styles.list} aria-label="Also published">
                  <li>
                    <Link className={styles.row} to={ROUTES.dataManifest}>
                      <Icon name="description" size="medium" />
                      <span className={styles.rowName}>manifest.json</span>
                      <span className={styles.rowCount}>run manifest</span>
                    </Link>
                  </li>
                </ul>
                <p className={styles.info}>
                  <Icon name="info" size="small" />
                  {run.manifest.artifacts.some((a) => a.name === TABLES_EXPORT)
                    ? "Names come from the run manifest and tables-export.json. "
                    : "Names come from the run manifest. "}
                  Columns and row counts come from each table&apos;s Parquet footer.
                </p>
              </div>
              <div className={styles.views} data-views-note="">
                <b className={styles.viewsTitle}>In MCP, use the views</b>
                <span className={styles.mono}>v_property · v_roofing_permit</span>
                <span className={styles.mono}>v_contractor · v_run</span>
                <span className={styles.viewsNote}>
                  views.sql defines them over these tables only. No other copy of the data is
                  published.
                </span>
              </div>
            </nav>
            {selected === undefined ? null : (
              <TableDetail
                table={selected}
                result={results.get(selected.table)}
                published={publishedRowsFor(selected, run.manifest)}
                manifest={run.manifest}
                runName={shownName}
                copied={copied}
                onCopy={copySchema}
              />
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function TableDetail({
  table,
  result,
  published,
  manifest,
  runName,
  copied,
  onCopy,
}: {
  readonly table: CatalogTable;
  readonly result: TableResult | undefined;
  readonly published: readonly CoverageRow[];
  readonly manifest: RunManifestV1;
  readonly runName: string;
  readonly copied: string;
  readonly onCopy: (table: string, columns: readonly ParquetColumn[]) => void;
}): ReactElement {
  const titleId = `table-${table.table}`;
  const klass = classOf(table.table);
  const source = sourceOf(table, manifest);
  const [first] = table.parts;
  return (
    <section className={styles.detail} aria-labelledby={titleId} data-catalog-detail={table.table}>
      <article className={styles.card}>
        <div className={styles.cardHead}>
          <h3 id={titleId} className={styles.name}>
            {klass}
          </h3>
          <Link className={styles.action} to={ROUTES.explore}>
            Search in Explore
          </Link>
          {result?.kind === "ok" ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => onCopy(table.table, result.columns)}
            >
              <Icon name="content_copy" size="medium" />
              Copy schema
            </button>
          ) : null}
        </div>
        <span className={styles.copied} aria-live="polite">
          {copied}
        </span>
        <p className={styles.description}>{describe(table.table, manifest)}</p>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Rows</dt>
            <dd>
              {result?.kind === "ok" ? (
                formatCount(result.rows)
              ) : result === undefined ? (
                <span data-footer-status="pending">{FOOTER_PENDING}</span>
              ) : (
                "rows unavailable"
              )}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Last updated</dt>
            <dd>
              {formatUtc(manifest.finishedAt).slice(0, 16)} UTC · {runName}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Source</dt>
            <dd>
              {isRelationship(table.table) ? (
                "elephant-cli"
              ) : source === null ? (
                "source not in this run's manifest"
              ) : (
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.label}
                  <span className={styles.srOnly}> (opens in a new tab)</span>
                </a>
              )}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Licence · CID</dt>
            <dd>
              <Link to={ROUTES.legalData}>
                {isRelationship(table.table) ? DERIVED : AS_PUBLISHED}
              </Link>
              {" · "}
              {table.parts.length === 1 && first !== undefined ? (
                <Link to={verifyPath(first.cid)} className={styles.cid} data-cid={first.cid}>
                  {truncateCid(first.cid)}
                </Link>
              ) : (
                <details className={styles.parts}>
                  <summary className={styles.partsSummary}>{table.parts.length} files</summary>
                  <ul className={styles.partList} aria-label="Files">
                    {table.parts.map((part) => (
                      <li key={part.cid}>
                        <Link to={verifyPath(part.cid)} className={styles.cid} data-cid={part.cid}>
                          {truncateCid(part.cid)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <span className={styles.size}>
                <span data-size="" data-value={table.size}>
                  {formatCount(table.size)} bytes
                </span>{" "}
                in {table.parts.length} {table.parts.length === 1 ? "file" : "files"}
              </span>
            </dd>
          </div>
          {published.map((row) => (
            <div
              key={row.key}
              className={styles.fact}
              data-published-rows=""
              data-coverage-key={row.key}
              data-value={row.count}
            >
              <dt>published_rows · {row.label === row.key ? row.key : row.label}</dt>
              <dd data-count={row.count}>{formatCount(row.count)}</dd>
            </div>
          ))}
        </dl>
      </article>
      <div className={styles.columnsSlot} data-columns-slot="">
        {result === undefined ? (
          <p className={styles.pending} data-footer-status="pending">
            columns: {FOOTER_PENDING}
          </p>
        ) : result.kind === "fail" ? (
          <StatusPill status="unavailable" text={`columns unavailable · ${result.reason}`} />
        ) : (
          <CatalogFieldTable
            table={table.table}
            klass={klass}
            columns={result.columns}
            sourceName={isRelationship(table.table) ? "elephant-cli" : (source?.name ?? null)}
          />
        )}
      </div>
      <DerivedCard klass={klass} />
    </section>
  );
}
