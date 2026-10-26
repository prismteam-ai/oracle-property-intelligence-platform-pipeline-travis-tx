// Activity (`/activity`; A-16 T044, AC-10, FR-010; boards Activity1440/768/390, ActivityStates).
// Admin only: a signed-out visitor goes to the admin sign-in, a signed-in user who is not an admin
// sees why. The numbers come from `admin.activity.summary`, three CloudWatch Logs Insights queries
// over the 30-day query log (questions per day, p95 duration, failures by outcome), cached five
// minutes by the API. Every number is a link to the Logs Insights query that produced it, and the
// query text is one disclosure away (TC-020), so the page never shows a figure it cannot source.
// States: loading (indeterminate progress), error with Retry (the board's "The query log could not
// load."), "Not enough activity yet" when the log holds nothing in the window, and the cache time.
// Justified differences from the board: the board's Top areas, Top questions and tools, Most
// searched and per-query log table are not built: the summary procedure returns only the three
// aggregated metrics and a per-day count, and the query log is meant to hold no personal data, so
// no per-query rows are sent to the browser. "Download CSV" (page header, as on the board) exports
// the metrics with their exact values. From 1200 px the summary and the per-day list sit side by
// side like the board's two panels; the metric tiles are filled and borderless as on the board. The
// time-range menu is not built (the window is fixed by the API).
import { ROUTES } from "@countylens/shared/routes";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, Navigate } from "react-router";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatUtc } from "../components/Provenance";
import { ADMIN_TEXTS, AdminApiError, adminApi, type ActivitySummary } from "../auth/admin-api";
import { useAdminAccess } from "../auth/useAdmin";
import { safeHttpUrl } from "../data/safe-url";
import { ShareBar } from "./Runs.shared";
import styles from "./Activity.module.css";
import runsStyles from "./Runs.module.css";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summary: ActivitySummary }
  | { readonly kind: "error"; readonly text: string; readonly expired: boolean };

const LOADING_TEXT = "Reading the query log";

function formatValue(value: string | number | null, unit: string | null | undefined): string {
  if (value === null) return "";
  const text = typeof value === "number" ? new Intl.NumberFormat("en-US").format(value) : value;
  return unit === null || unit === undefined || unit === "" ? text : `${text} ${unit}`;
}

/** The tile text (the CSV keeps the exact value): whole milliseconds, and no "count" unit after a
 *  count, as on the board's tiles ("214", "1,240 ms"). */
function tileValue(value: string | number | null, unit: string | null | undefined): string {
  if (typeof value !== "number") return formatValue(value, unit);
  if (unit === "count") return formatValue(value, null);
  return formatValue(unit === "ms" ? Math.round(value) : value, unit);
}

function downloadCsv(summary: ActivitySummary): void {
  const url = URL.createObjectURL(new Blob([toCsv(summary)], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "activity.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** A CloudWatch console link only: anything else is shown as the query text, never as a link. */
export function consoleHref(url: string): string | undefined {
  const safe = safeHttpUrl(url);
  if (safe === undefined) return undefined;
  try {
    const host = new URL(safe).hostname;
    return host === "console.aws.amazon.com" || host.endsWith(".console.aws.amazon.com")
      ? safe
      : undefined;
  } catch {
    return undefined;
  }
}

/** Quoted CSV cell; a leading = + - @ (or tab / CR) is prefixed with ' so spreadsheets never run it. */
const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

function toCsv(summary: ActivitySummary): string {
  const head = ["Metric", "Value", "Query"].map(csvCell).join(",");
  const lines = summary.metrics.map((m) =>
    [m.label, formatValue(m.value, m.unit), m.query].map(csvCell).join(","),
  );
  const days = summary.perDay.map((d) =>
    [d.day, String(d.questions), "questions per day"].map(csvCell).join(","),
  );
  return [head, ...lines, ...days].join("\n");
}

export function Component(): ReactElement {
  const access = useAdminAccess();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const isAdmin = access.kind === "admin";

  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    setLoad({ kind: "loading" });
    adminApi.activity().then(
      (summary) => {
        if (live) setLoad({ kind: "ready", summary });
      },
      (error: unknown) => {
        if (!live) return;
        const expired = error instanceof AdminApiError && error.code === "UNAUTHORIZED";
        setLoad({
          kind: "error",
          expired,
          text: expired ? ADMIN_TEXTS.signedOut : "The query log could not load.",
        });
      },
    );
    return () => {
      live = false;
    };
  }, [isAdmin, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (access.kind === "signed-out" || access.kind === "expired") {
    return <Navigate to={ROUTES.adminSignIn} replace />;
  }

  return (
    <section
      aria-label="Activity"
      data-route="activity"
      data-state={access.kind === "admin" ? load.kind : access.kind}
      className={runsStyles.page}
    >
      <div className={styles.head}>
        <div className={`${runsStyles.pageHead} ${styles.titleRow}`}>
          <h2 className={runsStyles.pageTitle}>Activity</h2>
          <p className={runsStyles.provenance}>
            <Icon name="shield_lock" size="small" />
            <span>
              Admins only · server-side events from CloudWatch Logs Insights over the query log: AI
              questions and MCP calls · kept 30 days · no personal data. Filters run on the
              visitor&apos;s device and are not logged.
            </span>
          </p>
        </div>
        {isAdmin && load.kind === "ready" ? (
          <button
            type="button"
            className={styles.download}
            onClick={() => downloadCsv(load.summary)}
          >
            <Icon name="download" size="small" />
            Download CSV
          </button>
        ) : null}
      </div>
      {access.kind === "checking" ? (
        <LinearProgress label="Loading activity" stageText="Checking admin access" />
      ) : null}
      {access.kind === "not-admin" ? (
        <StatusPill status="unavailable" text={ADMIN_TEXTS.notAdmin} />
      ) : null}
      {access.kind === "unavailable" ? <ErrorBanner message={ADMIN_TEXTS.unavailable} /> : null}
      {isAdmin && load.kind === "loading" ? (
        <>
          <LinearProgress label="Loading activity" stageText={LOADING_TEXT} />
          <Skeleton variant="cards" count={2} />
        </>
      ) : null}
      {isAdmin && load.kind === "error" ? (
        <>
          <ErrorBanner
            message={
              load.expired ? (
                <>
                  {load.text} <Link to={ROUTES.adminSignIn}>Admin sign-in</Link>
                </>
              ) : (
                load.text
              )
            }
            {...(load.expired ? {} : { onRetry: retry })}
          />
          <p className={runsStyles.helperText}>Search, Explore and the helper are not affected.</p>
        </>
      ) : null}
      {isAdmin && load.kind === "ready" ? <Summary summary={load.summary} /> : null}
    </section>
  );
}

function Summary({ summary }: { readonly summary: ActivitySummary }): ReactElement {
  const empty =
    summary.metrics.every((m) => m.value === null || m.value === 0) &&
    summary.perDay.every((d) => d.questions === 0);
  const peak = Math.max(1, ...summary.perDay.map((d) => d.questions));
  return (
    <div className={styles.panels}>
      <section className={runsStyles.card} aria-labelledby="wk-heading" data-activity-summary="">
        <div className={styles.cardHead}>
          <h3 id="wk-heading" className={runsStyles.sectionTitle}>
            Last 30 days
          </h3>
          <p className={runsStyles.helperText} data-cached-at={summary.cachedAt}>
            Cached at <time dateTime={summary.cachedAt}>{formatUtc(summary.cachedAt)}</time> UTC
            (the API keeps the answer five minutes)
          </p>
        </div>
        {empty ? (
          <div className={styles.empty} data-activity-empty="">
            <span className={styles.emptyIcon}>
              <Icon name="monitoring" size="large" />
            </span>
            <b className={styles.emptyTitle}>Not enough activity yet</b>
            <span>
              The summary appears once the query log holds questions. Nothing is counted as zero
              until a query has run: an empty log is shown as empty, not as a measured result.
            </span>
            <Link className={styles.tonal} to={ROUTES.explore}>
              <Icon name="map" size="medium" />
              Start a search
            </Link>
          </div>
        ) : null}
        {empty ? null : (
          <ul className={styles.metrics} aria-label="Activity metrics">
            {summary.metrics.map((metric) => {
              const href = consoleHref(metric.consoleUrl);
              const shown = tileValue(metric.value, metric.unit);
              return (
                <li key={metric.id} className={runsStyles.tile} data-metric={metric.id}>
                  <span className={runsStyles.tileLabel}>{metric.label}</span>
                  {metric.value === null ? (
                    <StatusPill
                      status="unavailable"
                      text="Not available · the Logs Insights query returned no value"
                    />
                  ) : href === undefined ? (
                    <b className={runsStyles.tileBig}>{shown}</b>
                  ) : (
                    <a
                      className={`${runsStyles.tileBig} ${styles.metricLink}`}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${metric.label}: ${shown}. Open the Logs Insights query`}
                    >
                      {shown}
                    </a>
                  )}
                  <details className={styles.query}>
                    <summary>Show the query</summary>
                    <pre className={styles.pre}>{metric.query}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className={runsStyles.card} aria-labelledby="day-heading" data-per-day="">
        <h3 id="day-heading" className={runsStyles.sectionTitle}>
          Questions per day
        </h3>
        {summary.perDay.length === 0 ? (
          <StatusPill
            status="unavailable"
            text="Not available · the query log has no days with questions in this window"
          />
        ) : (
          <ul className={runsStyles.list} aria-label="Questions per day">
            {summary.perDay.map((d) => (
              <li key={d.day} className={runsStyles.changeRow} data-day={d.day}>
                <span className={runsStyles.itemTitle}>{d.day}</span>
                <span className={runsStyles.count}>{d.questions}</span>
                <ShareBar value={d.questions} max={peak} label={`${d.questions} questions`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
