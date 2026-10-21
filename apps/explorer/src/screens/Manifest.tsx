import { useMemo, useState } from 'react';
import { Cid, ErrorBox, Loading, Section } from '../components/common.js';
import { useManifest, useMeta, useRuns } from '../hooks.js';
import { fmtBytes, fmtInt } from '../lib/format.js';
import { GATEWAYS, gatewayUrl } from '../lib/verify.js';

const PAGE = 100;

/** Demo step 4: every artifact with CID, size, name, codec and digest; gateway URLs are derived from the CIDs. */
export function Manifest() {
  const meta = useMeta();
  const runs = useRuns();
  const [chosen, setChosen] = useState('');
  const runId = chosen || meta.data?.run.run_id;
  const manifest = useManifest(runId);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const all = manifest.data?.objects ?? [];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((o) => o.name.toLowerCase().includes(f) || o.cid.includes(f)) : all;
  }, [manifest.data, filter]);

  const run = runs.data?.items.find((r) => r.run_id === runId);
  const manifestCid =
    run?.manifest_cid ?? (runId === meta.data?.run.run_id ? meta.data?.manifest_cid : null);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE);

  return (
    <Section title="Published artifact manifest" step="4">
      {runs.data && runs.data.items.length > 1 ? (
        <label>
          Run{' '}
          <select
            value={runId}
            onChange={(e) => {
              setChosen(e.target.value);
              setPage(0);
            }}
            aria-label="Run"
          >
            {runs.data.items.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p>
        Manifest CID: {manifestCid ? <Cid value={manifestCid} /> : 'n/a'} · IPNS: none minted for
        this dataset (the CID is the snapshot).
      </p>
      {manifest.isPending ? <Loading what="manifest" /> : null}
      {manifest.isError ? <ErrorBox error={manifest.error} /> : null}
      {manifest.data ? (
        <>
          <p>
            {fmtInt(manifest.data.objects.length)} objects
            {manifest.data.label ? ` · ${manifest.data.label}` : ''}. Gateway URLs below are derived
            from the CIDs; a directory root's digest is the sha256 of its root block (
            <code>?format=raw</code>).
          </p>
          <input
            type="search"
            placeholder="Filter by name or CID"
            aria-label="Filter manifest"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          />
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>CID</th>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Codec</th>
                  <th>sha256</th>
                  <th>Gateways</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr key={o.cid} data-testid="manifest-row">
                    <td>
                      <Cid value={o.cid} />
                    </td>
                    <td>{o.name}</td>
                    <td className="num" title={`${o.size} bytes`}>
                      {fmtBytes(o.size)}
                    </td>
                    <td>{o.codec}</td>
                    <td>
                      <code title={o.sha256}>{o.sha256.slice(0, 16)}…</code>
                      {o.digest_of ? <span className="muted"> of {o.digest_of}</span> : null}
                    </td>
                    <td>
                      {GATEWAYS.map((g) => (
                        <a key={g} href={gatewayUrl(g, o)} target="_blank" rel="noreferrer">
                          {new URL(g).hostname}
                        </a>
                      )).flatMap((a, i) => (i === 0 ? [a] : [' · ', a]))}
                    </td>
                    <td>
                      <a href={`#/verify?cid=${encodeURIComponent(o.cid)}`}>Verify</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <span>
              Page {current + 1} of {pages} · {fmtInt(rows.length)} rows
            </span>
            <button
              type="button"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
          {manifest.data.notes?.length ? (
            <details>
              <summary>Manifest notes</summary>
              <ul>
                {manifest.data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
