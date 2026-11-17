import { useState } from "react";
import { Badge, Card, Cid, Stat } from "../components/ui.js";
import type { Dataset } from "../data/dataset.js";
import { useAsync } from "../data/hooks.js";
import type { BuildSummary, Coverage, IngestRun } from "../data/types.js";
import { formatCount, formatDateTime, formatPercent, runIdDate } from "../format.js";

const SOURCE_RECORDS: Record<string, { key: string; unit: string }> = {
  "austin-permits": { key: "permits", unit: "permits" },
  "tcad-appraisal-export": { key: "properties", unit: "properties with owners" },
  "tcad-parcels": { key: "parcels", unit: "parcel centroids" },
  "travis-address-points": { key: "addressPoints", unit: "address points" },
  "bbb-archive": { key: "bbbProfiles", unit: "archived BBB profiles" },
};
const UNCHANGED = "unchanged";
const HISTORY_PAGE = 25;

const FREE_INFRASTRUCTURE = [
  [
    "Ingestion, builds, publication",
    "GitHub Actions on a public repository",
    "Free. Daily ingest 16:30 UTC, weekly IPFS publication Mondays 17:45 UTC.",
  ],
  [
    "Raw store, build store, CID mirror",
    "Cloudflare R2",
    "Free tier: 10 GB-month, no egress fees.",
  ],
  [
    "Explorer and agent proxy",
    "Cloudflare Workers + static assets",
    "Free plan: 100,000 requests a day.",
  ],
  [
    "Agent model",
    "Workers AI",
    "Free allocation: 10,000 neurons a day, capped per app in the Worker.",
  ],
  ["Answer cache and budget counter", "Workers KV", "Free tier."],
  [
    "Query engine",
    "DuckDB-WASM in the visitor's browser",
    "No database server; Parquet is read over HTTP range requests.",
  ],
  [
    "Durable storage",
    "IPFS, pinned by Filebase and Pinata",
    "Free plans. CIDs stay retrievable from public gateways; CARs are attached to GitHub Releases.",
  ],
] as const;

type TimelineEntry =
  | { kind: "ingest"; at: string; run: IngestRun }
  | { kind: "build"; at: string; build: BuildSummary }
  | { kind: "publish"; at: string; buildId: string; rootCid: string; manifestCid: string };

export function OverviewPage({ dataset }: { dataset: Dataset }) {
  const { build, coverage, runs, sources, publication } = dataset;
  const properties = coverage.properties ?? {};
  const roofing = coverage.roofing_permits ?? {};
  const contractors = coverage.contractors ?? {};
  const permits = coverage.permits ?? {};
  const businesses = coverage.businesses;
  const hail = coverage.hail_events;
  const owners = coverage.owners;
  const hailYears = Object.keys((hail?.by_year ?? {}) as Record<string, number>).sort();
  const count = (group: Coverage[string], key: string) => Number(group[key] ?? 0);
  const registryDetail =
    contractors.with_registry_match === undefined
      ? ""
      : `, ${formatCount(count(contractors, "with_registry_match"))} resolved to a Texas Comptroller taxpayer, ${formatCount(count(contractors, "with_license"))} to TDLR licenses`;
  const locality = (properties.owner_locality ?? {}) as Record<string, number>;
  const outOfArea =
    (locality.regional ?? 0) + (locality.out_of_state ?? 0) + (locality.foreign ?? 0);
  const latestRun = (source: string) => runs?.ingests.filter((run) => run.source === source).at(-1);
  const lastChange = (source: string) =>
    runs?.ingests.filter((run) => run.source === source && run.status !== UNCHANGED).at(-1);
  const budget = useAsync(
    async () =>
      (await fetch("/api/agent/budget")).json() as Promise<{
        used: number;
        limit: number;
        model: string;
      }>,
    "budget",
  );

  return (
    <div className="page">
      <Card
        title="Pipeline run summary"
        subtitle={
          <>
            Build <code>{build.buildId}</code> as of {build.asOf}, published{" "}
            {formatDateTime(publication.publishedAt)} · dataset root{" "}
            <Cid cid={publication.rootCid} />
          </>
        }
      >
        <div className="stats">
          <Stat
            label="Properties"
            value={formatCount(count(properties, "rows"))}
            detail="Travis County appraisal roll"
          />
          <Stat
            label="Permits"
            value={formatCount(count(permits, "rows"))}
            detail="City of Austin, all types"
          />
          <Stat
            label="Roofing permits"
            value={formatCount(count(roofing, "rows"))}
            detail={`${formatCount(count(roofing, "unfinished"))} never finished`}
          />
          <Stat
            label="Never finished 5+ years"
            value={formatCount(count(roofing, "open_5_years_or_more"))}
            detail={
              roofing.still_open_5_years_or_more === undefined
                ? "open, or expired without a final inspection"
                : `${formatCount(count(roofing, "still_open_5_years_or_more"))} still open, the rest expired without a final inspection`
            }
          />
          <Stat
            label="Roofs older than 15 years"
            value={formatCount(count(properties, "roof_older_than_15_years"))}
            detail="estimated roof age"
          />
          <Stat
            label="Contractors"
            value={formatCount(count(contractors, "rows"))}
            detail={
              contractors.with_roofing_permits === undefined
                ? `${formatCount(count(contractors, "with_bbb_rating"))} with a BBB grade`
                : `${formatCount(count(contractors, "with_roofing_permits"))} roofing, ${formatCount(count(contractors, "with_registry_match"))} in the state registry`
            }
          />
          <Stat
            label="Located"
            value={formatPercent(count(properties, "with_coordinates"), count(properties, "rows"))}
            detail="properties with coordinates"
          />
        </div>
      </Card>

      <Card
        title="Records by kind"
        subtitle="What the database holds, where it came from and when it was collected."
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Records</th>
              <th>Detail</th>
              <th>Source</th>
              <th>Collected</th>
            </tr>
          </thead>
          <tbody>
            <KindRow
              kind="Property"
              records={count(properties, "rows")}
              detail={`${formatCount(count(properties, "with_year_built"))} with year built, ${formatCount(count(properties, "with_roof_covering"))} with roof covering`}
              source="tcad-appraisal-export"
              run={lastChange("tcad-appraisal-export")}
            />
            <KindRow
              kind="Permit"
              records={count(permits, "rows")}
              detail={`${formatCount(count(roofing, "rows"))} roofing permits with status, open duration and contractor`}
              source="austin-permits"
              run={latestRun("austin-permits")}
            />
            <KindRow
              kind="Ownership"
              records={count(properties, "rows")}
              detail={`${formatCount(count(properties, "owned_longer_than_10_years"))} held over 10 years, ${formatCount(outOfArea)} owners outside the Austin area`}
              source="tcad-appraisal-export"
              run={lastChange("tcad-appraisal-export")}
            />
            <KindRow
              kind="Contractor"
              records={count(contractors, "rows")}
              detail={`reconciled from permit names and phones; ${formatCount(count(contractors, "with_bbb_rating"))} with a BBB grade${registryDetail}`}
              source={
                businesses
                  ? "austin-permits, tx-franchise-taxpayers, tx-sales-tax-permits, tdlr-licenses"
                  : "austin-permits"
              }
              run={latestRun("austin-permits")}
            />
            {businesses && (
              <KindRow
                kind="Business (sales tax outlet)"
                records={count(businesses, "rows")}
                detail={`Travis County locations with an active Texas sales tax permit; ${formatCount(count(businesses, "with_property"))} linked to a TCAD property, ${formatCount(count(businesses, "with_coordinates"))} located`}
                source="tx-sales-tax-permits"
                run={latestRun("tx-sales-tax-permits")}
              />
            )}
            {owners && (
              <KindRow
                kind="Owner entity"
                records={count(owners, "rows")}
                detail={`owners reconciled by name and mailing address; ${formatCount(count(owners, "with_two_or_more_properties"))} hold two or more properties, the largest ${formatCount(count(owners, "largest_portfolio"))}`}
                source="tcad-appraisal-export"
                run={lastChange("tcad-appraisal-export")}
              />
            )}
            {hail && (
              <KindRow
                kind="Hail report"
                records={count(hail, "rows")}
                detail={`NOAA Storm Events hail reports around Travis County, ${hailYears[0]}–${hailYears.at(-1)}; ${formatCount(count(hail, "one_inch_or_larger"))} one inch or larger`}
                source="noaa-storm-events"
                run={lastChange("noaa-storm-events")}
              />
            )}
            <KindRow
              kind="Business (BBB profile)"
              records={build.sourceRows.bbbProfiles ?? 0}
              detail="BBB business profiles with grade, accreditation and phone, as of the snapshot date"
              source="bbb-archive"
              run={latestRun("bbb-archive")}
            />
            <KindRow
              kind="Coordinate"
              records={count(properties, "with_coordinates")}
              detail={Object.entries((properties.coordinate_source ?? {}) as Record<string, number>)
                .map(([source, rows]) => `${source} ${formatCount(rows)}`)
                .join(", ")}
              source="tcad-parcels, travis-address-points"
              run={lastChange("tcad-parcels")}
            />
          </tbody>
        </table>
      </Card>

      <Card
        title="Sources"
        subtitle="Publisher, refresh strategy and documented limitations of every source."
      >
        {sources ? (
          <div className="sources">
            {sources.map((source) => {
              const records = SOURCE_RECORDS[source.id];
              const run = latestRun(source.id);
              return (
                <article key={source.id} className="source">
                  <header>
                    <h3>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.name}
                      </a>
                    </h3>
                    <Badge tone="info">{source.id}</Badge>
                  </header>
                  <p className="muted">{source.publisher}</p>
                  {records && (
                    <p>
                      <strong>{formatCount(build.sourceRows[records.key])}</strong> {records.unit}{" "}
                      in this build
                      {run && <> · last checked {formatDateTime(run.runId)}</>}
                    </p>
                  )}
                  <p>{source.refresh}</p>
                  <ul className="limitations">
                    {source.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted">This publication predates the published source catalog.</p>
        )}
      </Card>

      <Card
        title="Latest build deltas"
        subtitle={`Compared with the previous build. Build ${build.buildId}.`}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Rows</th>
              <th>Added</th>
              <th>Changed</th>
              <th>Removed</th>
            </tr>
          </thead>
          <tbody>
            {build.tables.map((table) => (
              <tr key={table.table}>
                <td>
                  <code>{table.table}</code>
                </td>
                <td>{formatCount(table.rows)}</td>
                <td>{formatCount(table.added)}</td>
                <td>{formatCount(table.changed)}</td>
                <td>{formatCount(table.removed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <RunTimeline dataset={dataset} />

      <Card
        title="Infrastructure and cost"
        subtitle="Oracle carries no infrastructure cost: every component runs on a free plan."
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Runs on</th>
              <th>Plan</th>
            </tr>
          </thead>
          <tbody>
            {FREE_INFRASTRUCTURE.map(([role, platform, plan]) => (
              <tr key={role}>
                <td>{role}</td>
                <td>{platform}</td>
                <td>{plan}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {budget.state === "ready" && (
          <p className="muted">
            Agent today: {formatCount(Math.round(budget.value.used))} of{" "}
            {formatCount(budget.value.limit)} neurons used by this app ({budget.value.model}).
          </p>
        )}
      </Card>
    </div>
  );
}

function KindRow({
  kind,
  records,
  detail,
  source,
  run,
}: {
  kind: string;
  records: number;
  detail: string;
  source: string;
  run: IngestRun | undefined;
}) {
  return (
    <tr>
      <td>
        <strong>{kind}</strong>
      </td>
      <td>{formatCount(records)}</td>
      <td>{detail}</td>
      <td>
        <code>{source}</code>
      </td>
      <td>{run ? formatDateTime(run.receipt?.fetchedAt ?? run.runId) : "–"}</td>
    </tr>
  );
}

function RunTimeline({ dataset }: { dataset: Dataset }) {
  const [shown, setShown] = useState(HISTORY_PAGE);
  const entries: TimelineEntry[] = [
    ...(dataset.runs?.ingests ?? []).map((run) => ({
      kind: "ingest" as const,
      at: run.runId,
      run,
    })),
    ...(dataset.runs?.builds ?? []).map((build) => ({
      kind: "build" as const,
      at: build.buildId,
      build,
    })),
    { kind: "build" as const, at: dataset.build.buildId, build: dataset.build },
    ...dataset.publications.map((publication) => ({
      kind: "publish" as const,
      at: publication.publishedAt,
      buildId: publication.buildId,
      rootCid: publication.rootCid,
      manifestCid: publication.manifestCid,
    })),
  ].sort((a, b) => timeOf(b.at) - timeOf(a.at));

  return (
    <Card
      title="Run history"
      subtitle="Every ingest, build and publication, newest first. Ingests re-read only new or changed records; builds report row deltas."
    >
      {!dataset.runs && (
        <p className="muted">This publication predates the published run history.</p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Step</th>
            <th>What</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, shown).map((entry) => (
            <tr
              key={`${entry.kind}-${entry.at}-${entry.kind === "ingest" ? entry.run.source : ""}`}
            >
              <td className="nowrap">{formatDateTime(entry.at)}</td>
              <td>
                <Badge
                  tone={
                    entry.kind === "publish" ? "good" : entry.kind === "build" ? "info" : "neutral"
                  }
                >
                  {entry.kind}
                </Badge>
              </td>
              <td>{entrySummary(entry)}</td>
              <td>{entryOutcome(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > shown && (
        <button type="button" className="link-button" onClick={() => setShown(entries.length)}>
          Show all {entries.length} runs
        </button>
      )}
    </Card>
  );
}

function timeOf(at: string): number {
  return (runIdDate(at) ?? new Date(at)).getTime();
}

function entrySummary(entry: TimelineEntry) {
  if (entry.kind === "publish") {
    return (
      <>
        Build <code>{entry.buildId}</code> → root <Cid cid={entry.rootCid} />, manifest{" "}
        <Cid cid={entry.manifestCid} />
      </>
    );
  }
  if (entry.kind === "build")
    return (
      <>
        Lead tables <code>{entry.build.buildId}</code>
      </>
    );
  const { run } = entry;
  const window = run.window?.kind === "since" ? `since ${run.window.since}` : run.window?.kind;
  return (
    <>
      <code>{run.source}</code>
      {window && <> · {window}</>}
      {run.watermark && <> · watermark {run.watermark}</>}
    </>
  );
}

function entryOutcome(entry: TimelineEntry): string {
  if (entry.kind === "publish") return "pinned, IPNS updated";
  if (entry.kind === "build") {
    return entry.build.tables
      .map(
        (table) =>
          `${table.table} ${formatCount(table.rows)} (+${formatCount(table.added)} ~${formatCount(table.changed)} −${formatCount(table.removed)})`,
      )
      .join(" · ");
  }
  const { run } = entry;
  if (run.status === UNCHANGED) return "unchanged since last run";
  const fetched =
    typeof run.fetched === "number"
      ? `${formatCount(run.fetched)} profiles fetched, ${formatCount(Number(run.remaining ?? 0))} left`
      : undefined;
  return (
    fetched ?? `${formatCount(run.records)} records${run.pages ? ` in ${run.pages} pages` : ""}`
  );
}
