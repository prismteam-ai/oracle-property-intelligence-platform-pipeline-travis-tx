import { useState } from 'react';
import { Cid, ErrorBox, Loading, Section } from '../components/common.js';
import { useRuns } from '../hooks.js';
import { fmtInt, fmtTime } from '../lib/format.js';
import { GATEWAYS, gatewayUrl } from '../lib/verify.js';

/** Demo step 6: every run with its group roots (`<group>/<shard>` keys) and manifest CID, which opens on both public gateways; a second run appends here. */
export function Runs() {
  const runs = useRuns();
  const [filter, setFilter] = useState('');
  if (runs.isPending) return <Loading what="run history" />;
  if (runs.isError) return <ErrorBox error={runs.error} />;
  const items = runs.data.items;
  return (
    <Section title="Run history" step="6">
      <p>
        {items.length} run{items.length === 1 ? '' : 's'} published. A later incremental run appears
        here with its own manifest CID and group roots; earlier CIDs are never mutated and stay
        listed.
      </p>
      <input
        type="search"
        aria-label="Filter group roots"
        placeholder="Filter group roots, e.g. county/s0001"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {items.map((run) => {
        const groups = Object.entries(run.groups).filter(([key]) => key.includes(filter.trim()));
        return (
          <article className="card" key={run.run_id} data-testid="run-card">
            <h3>{run.run_id}</h3>
            <p>
              started {fmtTime(run.started_at)} · finished {fmtTime(run.finished_at)}
            </p>
            <p>
              Manifest CID:{' '}
              {run.manifest_cid ? <Cid value={run.manifest_cid} /> : 'n/a (not published)'}
              {run.manifest_cid
                ? GATEWAYS.map((g) => (
                    <a
                      key={g}
                      href={gatewayUrl(g, { cid: run.manifest_cid as string, codec: 'file' })}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {new URL(g).hostname}
                    </a>
                  )).flatMap((a) => [' · ', a])
                : null}
            </p>
            {run.deltas ? (
              <p className="muted">
                Deltas:{' '}
                {Object.entries(run.deltas)
                  .map(
                    ([track, d]) =>
                      `${track} ${fmtInt(Number(d.new ?? 0))} new / ${fmtInt(Number(d.changed ?? 0))} changed / ${fmtInt(Number(d.unchanged ?? 0))} unchanged`,
                  )
                  .join(' · ')}
              </p>
            ) : null}
            <details>
              <summary>
                {Object.keys(run.groups).length} group roots
                {filter ? ` (${groups.length} shown)` : ''}
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Group/shard</th>
                      <th>Archive root</th>
                      <th>Schema</th>
                      <th>Tables</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([key, g]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>
                          <Cid value={g.cid} />
                        </td>
                        <td>
                          <Cid value={g.schema} />
                        </td>
                        <td>
                          <Cid value={g.tables} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </article>
        );
      })}
    </Section>
  );
}
