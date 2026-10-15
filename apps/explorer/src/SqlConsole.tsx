import { useState } from "react";
import { callTool, fmt, type Row } from "./api.js";

const DEFAULT_SQL = `SELECT roof_age_basis, count(*) AS properties, round(avg(roof_age_years), 1) AS avg_roof_age
FROM property_leads GROUP BY 1 ORDER BY 2 DESC`;

export function SqlConsole() {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    try {
      setRows((await callTool<{ rows: Row[] }>("query_sql", { sql })).rows);
    } catch (e) {
      setError((e as Error).message);
      setRows(null);
    }
  };
  const cols = rows?.[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="stack">
      <section className="card">
        <h2>Read-only DuckDB query layer</h2>
        <p className="muted">
          Runs in an embedded DuckDB over the Parquet snapshot — no Oracle-hosted database. Single
          SELECT/WITH, max 500 rows.
        </p>
        <textarea className="mono" rows={6} value={sql} onChange={(e) => setSql(e.target.value)} />
        <button className="primary" onClick={run}>
          Run
        </button>
        {error && <p className="error">{error}</p>}
      </section>
      {rows && (
        <section className="card scroll">
          <table>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c}>{fmt(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
