import { Cid, ErrorBox, Loading, Section, Stat } from '../components/common.js';
import { useMeta, useRuns } from '../hooks.js';
import { fmtInt, fmtTime } from '../lib/format.js';

/** Demo step 1: the completed run, source list, county coverage, record counts, timestamps and limitations. */
export function Summary() {
  const meta = useMeta();
  const runs = useRuns();
  if (meta.isPending) return <Loading what="run summary" />;
  if (meta.isError) return <ErrorBox error={meta.error} />;
  const m = meta.data;
  const run = runs.data?.items.find((r) => r.run_id === m.run.run_id);
  const c = m.counts;
  const pct = (part: number, whole: number) =>
    whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : 'n/a';

  return (
    <>
      <Section title="Pipeline run summary" step="1">
        <p>
          <strong>{m.county}</strong> (FIPS {m.fips}) · run <code>{m.run.run_id}</code> completed
        </p>
        <p className="muted">
          started {fmtTime(m.run.started_at)} · finished {fmtTime(m.run.finished_at)} · API snapshot{' '}
          <code>{m.deploy.deploy_id}</code> deployed {fmtTime(m.deploy.deployed_at)} · DuckDB{' '}
          {m.deploy.duckdb_version}
        </p>
        <p>
          Run manifest CID: <Cid value={m.manifest_cid} />
        </p>
        <div className="stats">
          <Stat label="properties" value={fmtInt(c.properties)} />
          <Stat
            label={`with coordinates (${pct(c.with_coordinates, c.properties)})`}
            value={fmtInt(c.with_coordinates)}
          />
          <Stat label="with a roof-age estimate" value={fmtInt(c.with_roof_age)} />
          <Stat label="permits joined to a property" value={fmtInt(c.permits_joined_to_property)} />
          <Stat label="permits not joined" value={fmtInt(c.permits_unmatched)} />
          <Stat label="roofing permits" value={fmtInt(c.roofing_permits)} />
          <Stat label="open roofing permits" value={fmtInt(c.open_roofing_permits)} />
          <Stat label="stalled roofing permits" value={fmtInt(c.stalled_roofing_permits)} />
        </div>
      </Section>

      <Section title="County coverage">
        <p>
          {fmtInt(c.properties)} parcels loaded for {m.county}; {fmtInt(c.with_coordinates)} (
          {pct(c.with_coordinates, c.properties)}) carry coordinates for radius search,{' '}
          {fmtInt(c.with_roof_age)} carry a roof-age estimate.{' '}
          {fmtInt(c.permits_joined_to_property)} permits link to a property on <code>geo_id</code>;
          the rest are counted by reason:
        </p>
        <ul>
          {Object.entries(m.unlinked_reasons).map(([reason, count]) => (
            <li key={reason}>
              {reason.replaceAll('_', ' ')}: {fmtInt(Number(count))}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Sources">
        {run?.sources && run.sources.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Watermark</th>
                <th>Fetched</th>
                <th>Availability</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {run.sources.map((s) => (
                <tr key={`${s.dataset}-${s.fetched_at}`}>
                  <td>
                    {s.url ? (
                      <a href={s.url} rel="noreferrer">
                        {s.dataset}
                      </a>
                    ) : (
                      s.dataset
                    )}
                  </td>
                  <td>{s.watermark ?? 'n/a'}</td>
                  <td>{fmtTime(s.fetched_at)}</td>
                  <td>{s.availability}</td>
                  <td>{s.source_access_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            {runs.isPending ? 'Loading sources…' : 'No source list in the run record.'}
          </p>
        )}
        <h3>Business and licensing sources</h3>
        <ul>
          {Object.entries(c.by_source).map(([key, s]) => (
            <li key={key}>
              {key} ({s.kind}, {s.dataset}): {fmtInt(s.rows_loaded)} rows loaded, fetched{' '}
              {fmtTime(s.fetched_at)}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Documented limitations">
        {m.limitations.length === 0 ? (
          <p>None recorded.</p>
        ) : (
          <ul className="limitations">
            {m.limitations.map((l, i) => (
              <li key={`${l.source}-${i}`}>
                <strong>{l.source}</strong>: {l.availability} / access {l.source_access_status}
                {l.incomplete_reason ? ` (${l.incomplete_reason})` : ''}.{' '}
                <span className="muted">{l.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
