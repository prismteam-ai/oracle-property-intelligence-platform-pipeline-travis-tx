import { publishedTables } from "@travis-oracle/query-core";
import { useState } from "react";
import { Card, Cid, DataTable, ErrorNote, Spinner } from "../components/ui.js";
import type { Dataset } from "../data/dataset.js";
import type { Database, QueryResult } from "../data/duckdb.js";
import { formatCount } from "../format.js";

const EXAMPLES: { label: string; sql: string }[] = [
  {
    label: "Rows per table",
    sql: `SELECT 'properties' AS table_name, count(*) AS rows FROM properties
UNION ALL SELECT 'roofing_permits', count(*) FROM roofing_permits
UNION ALL SELECT 'contractors', count(*) FROM contractors
UNION ALL SELECT 'permits', count(*) FROM permits
UNION ALL SELECT 'businesses', count(*) FROM businesses
UNION ALL SELECT 'hail_events', count(*) FROM hail_events
UNION ALL SELECT 'owners', count(*) FROM owners`,
  },
  {
    label: "Roof-age basis",
    sql: `SELECT roof_age_anchor, roof_age_confidence, count(*) AS properties,
       round(avg(roof_age_years), 1) AS average_roof_age
FROM properties
WHERE roof_age_years IS NOT NULL
GROUP BY ALL
ORDER BY properties DESC`,
  },
  {
    label: "Longest-open roofing permits",
    sql: `SELECT permit_number, address, permit_state, years_open, open_since,
       contractor_name, bbb_rating, bbb_snapshot_date, source_url
FROM roofing_permits
WHERE unfinished
ORDER BY years_open DESC, permit_number
LIMIT 25`,
  },
  {
    label: "Busiest roofing contractors and their BBB grades",
    sql: `SELECT contractor_key, roofing_permits, unfinished_roofing_permits, properties,
       bbb_rating, bbb_accredited, bbb_match_method, bbb_snapshot_date
FROM contractors
ORDER BY roofing_permits DESC
LIMIT 25`,
  },
  {
    label: "Roofing contractors in the Texas registry",
    sql: `SELECT contractor_key, roofing_permits, registry_name, registry_organization_type,
       registry_active, registry_charter_date, registry_match_method, license_types
FROM contractors
WHERE roofing_permits > 0 AND registry_taxpayer_number IS NOT NULL
ORDER BY roofing_permits DESC
LIMIT 25`,
  },
  {
    label: "Roofing businesses with a Travis County sales tax outlet",
    sql: `SELECT outlet_name, taxpayer_name, address, city, zip, permit_issue_date, prop_id
FROM businesses
WHERE naics_code = '238160'
ORDER BY permit_issue_date
LIMIT 25`,
  },
  {
    label: "Owners with the most aged roofs",
    sql: `SELECT owner_name, mailing_city, mailing_state, properties, aged_roofs,
       unfinished_roofing_permits, total_market_value
FROM owners
ORDER BY aged_roofs DESC
LIMIT 25`,
  },
  {
    label: "Hail reports by year",
    sql: `SELECT year(event_date) AS year, count(*) AS reports,
       count(*) FILTER (WHERE magnitude_inches >= 1) AS one_inch_or_larger,
       max(magnitude_inches) AS largest_inches
FROM hail_events
GROUP BY 1
ORDER BY 1 DESC`,
  },
  {
    label: "Owners by locality",
    sql: `SELECT owner_locality, count(*) AS properties,
       count(*) FILTER (WHERE ownership_years > 10) AS held_over_10_years
FROM properties
GROUP BY owner_locality
ORDER BY properties DESC`,
  },
  {
    label: "Permits by type and year (2.4 million rows)",
    sql: `SELECT year(issue_date) AS issued, permit_type, count(*) AS permits
FROM permits
WHERE issue_date >= DATE '2020-01-01'
GROUP BY ALL
ORDER BY issued DESC, permits DESC
LIMIT 40`,
  },
];

const SHOWN_ROWS = 500;

export function SqlPage({ dataset, database }: { dataset: Dataset; database: Database }) {
  const [sql, setSql] = useState(EXAMPLES[0]?.sql ?? "");
  const [result, setResult] = useState<QueryResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<Record<string, QueryResult>>({});

  const run = async (text = sql) => {
    setRunning(true);
    setError(undefined);
    try {
      setResult(await database.query(text));
    } catch (failure) {
      setResult(undefined);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRunning(false);
    }
  };

  const loadSchema = async (table: string) => {
    if (schema[table]) return;
    const described = await database.query(`DESCRIBE ${table}`);
    setSchema((current) => ({ ...current, [table]: described }));
  };

  return (
    <div className="page">
      <Card
        title="DuckDB query console"
        subtitle={
          <>
            DuckDB-WASM runs in this browser and reads the published Parquet tables of dataset{" "}
            <Cid cid={dataset.publication.rootCid} /> with HTTP range requests. There is no database
            server.
          </>
        }
      >
        <div className="sql-layout">
          <aside className="schema">
            <h3>Tables</h3>
            {publishedTables(dataset.build.tables).map((table) => (
              <details
                key={table}
                onToggle={(event) => (event.currentTarget.open ? loadSchema(table) : undefined)}
              >
                <summary>
                  <code>{table}</code>
                </summary>
                <ul>
                  {(schema[table]?.rows ?? []).map((column) => (
                    <li key={String(column.column_name)}>
                      <code>{String(column.column_name)}</code>{" "}
                      <span className="muted">{String(column.column_type)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <h3>Examples</h3>
            <ul className="examples">
              {EXAMPLES.map((example) => (
                <li key={example.label}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setSql(example.sql);
                      run(example.sql);
                    }}
                  >
                    {example.label}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="sql-editor">
            <textarea
              aria-label="SQL"
              value={sql}
              spellCheck={false}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) run();
              }}
            />
            <div className="row">
              <button type="button" className="button" onClick={() => run()} disabled={running}>
                Run query
              </button>
              <span className="muted small">Ctrl/⌘ + Enter</span>
              {result && !running && (
                <span className="muted small">
                  {formatCount(result.rows.length)} rows in {formatCount(result.elapsedMs)} ms
                </span>
              )}
            </div>
            {running && <Spinner label="Running in DuckDB-WASM…" />}
            {error && <ErrorNote message={error} />}
            {result && !running && (
              <DataTable rows={result.rows.slice(0, SHOWN_ROWS)} columns={result.columns} />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
