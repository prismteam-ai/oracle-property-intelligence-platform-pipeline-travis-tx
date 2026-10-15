import { useEffect, useState } from "react";
import { callTool, fmt, type Row } from "./api.js";

type Summary = {
  snapshot: { base: string; runId: string | null; rootCid: string | null };
  asOf: string;
  run: Row;
  sources: Row[];
  derived: Record<string, number>;
  coverage: Record<string, number>;
  runHistory: Row[];
  tables: Record<string, string>;
};

export function RunSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    callTool<Summary>("get_run_summary").then(setData, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading run summary…</p>;
  return (
    <div className="stack">
      <section className="card">
        <h2>Run {String(data.run.run_id)}</h2>
        <div className="kv">
          <span>Status</span>
          <b className={`status ${String(data.run.status)}`}>{String(data.run.status)}</b>
          <span>Mode</span>
          <b>{String(data.run.mode)}</b>
          <span>Started</span>
          <b>{fmt(data.run.started_at)}</b>
          <span>Finished</span>
          <b>{fmt(data.run.finished_at)}</b>
          <span>As-of date</span>
          <b>{data.asOf}</b>
          <span>Snapshot</span>
          <b className="mono">{data.snapshot.rootCid ?? data.snapshot.base}</b>
        </div>
      </section>

      <section className="card">
        <h2>Coverage</h2>
        <div className="tiles">
          {Object.entries(data.coverage).map(([k, v]) => (
            <div className="tile" key={k}>
              <div className="tile-v">{fmt(v)}</div>
              <div className="tile-k">{k.replaceAll("_", " ")}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Sources, record deltas and limitations</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Seen</th>
                <th>Inserted</th>
                <th>Updated</th>
                <th>Unchanged</th>
                <th>Deleted</th>
                <th>Out of scope</th>
                <th>Collected</th>
                <th>Limitation</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={String(s.source_id)}>
                  <td className="mono">{String(s.source_id)}</td>
                  <td>
                    <span className={`status ${String(s.status)}`}>{String(s.status)}</span>
                  </td>
                  <td>{fmt(s.records_seen)}</td>
                  <td>{fmt(s.inserted)}</td>
                  <td>{fmt(s.updated)}</td>
                  <td>{fmt(s.unchanged)}</td>
                  <td>{fmt(s.deleted)}</td>
                  <td>{fmt(s.out_of_scope)}</td>
                  <td>{fmt(s.finished_at)}</td>
                  <td className="wrap">{fmt(s.limitation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Reconciliation</h2>
        <div className="tiles">
          {Object.entries(data.derived).map(([k, v]) => (
            <div className="tile" key={k}>
              <div className="tile-v">{fmt(v)}</div>
              <div className="tile-k">{k.replaceAll("_", " ")}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Run history</h2>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Started</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {data.runHistory.map((r) => (
              <tr key={String(r.run_id)}>
                <td className="mono">{String(r.run_id)}</td>
                <td>{String(r.mode)}</td>
                <td>{String(r.status)}</td>
                <td>{fmt(r.started_at)}</td>
                <td>{fmt(r.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Tables</h2>
        <ul className="plain">
          {Object.entries(data.tables).map(([k, v]) => (
            <li key={k}>
              <b className="mono">{k}</b> — {v}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
