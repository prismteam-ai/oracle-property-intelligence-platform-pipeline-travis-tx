import { useEffect, useMemo, useState } from 'react';
import { Cid, ErrorBox, Loading, Section } from '../components/common.js';
import { useManifest, useMeta } from '../hooks.js';
import { fmtBytes } from '../lib/format.js';
import {
  GATEWAYS,
  overallState,
  verifyObject,
  type GatewayResult,
  type ManifestObject,
  type VerifyDeps,
} from '../lib/verify.js';

const LABEL = { match: 'match', mismatch: 'MISMATCH', unverified: 'unverified' } as const;

/** Demo step 5: fetch one object from both public gateways in the browser and compare to the manifest. */
export function Verify({ deps, initialCid }: { deps?: VerifyDeps; initialCid?: string }) {
  const meta = useMeta();
  const manifest = useManifest(meta.data?.run.run_id);
  const [cid, setCid] = useState(initialCid ?? '');
  const [results, setResults] = useState<GatewayResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const objects = manifest.data?.objects;
  const picks = useMemo(() => {
    if (!objects) return [] as { label: string; object: ManifestObject }[];
    const smallest = objects
      .filter((o) => o.codec === 'file')
      .reduce<ManifestObject | null>((best, o) => (!best || o.size < best.size ? o : best), null);
    const root = objects.find((o) => o.codec === 'directory');
    return [
      ...(smallest ? [{ label: 'Smallest file part', object: smallest }] : []),
      ...(root ? [{ label: 'A directory root', object: root }] : []),
    ];
  }, [objects]);

  useEffect(() => {
    if (!cid && picks[0]) setCid(picks[0].object.cid);
  }, [picks, cid]);

  const selected = objects?.find((o) => o.cid === cid.trim());

  async function run() {
    if (!selected) return;
    setBusy(true);
    setResults(null);
    try {
      setResults(await verifyObject(selected, deps));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Verify an artifact on two public gateways" step="5">
      <p>
        The browser fetches the object from <code>{GATEWAYS[0]}</code> and{' '}
        <code>{GATEWAYS[1]}</code> (neither is operated by this environment), then compares size and
        SHA-256 to the manifest. File parts are fetched in full and hashed in a Web Worker; a
        directory root is compared through its <code>?format=raw</code> root block and the CID's own
        multihash. A gateway that does not answer in time is shown as <em>unverified</em>, never as
        a mismatch.
      </p>
      <p className="notice" data-testid="cors-note">
        Gateway CORS, probed with <code>Origin: https://example.cloudfront.net</code>:
        ipfs.filebase.io sends <code>access-control-allow-origin: *</code> on GET and on the
        preflight. gateway.pinata.cloud answered the probes with 429 and no CORS headers, so a
        browser cannot read its answers while it is rate-limiting this client: that case is reported
        here as <em>unverified (gateway rate-limited or no CORS headers)</em>.
      </p>
      {manifest.isPending ? <Loading what="manifest" /> : null}
      {manifest.isError ? <ErrorBox error={manifest.error} /> : null}
      {objects ? (
        <>
          <div className="presets">
            {picks.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setCid(p.object.cid);
                  setResults(null);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label>
            CID{' '}
            <input
              aria-label="CID to verify"
              size={64}
              value={cid}
              onChange={(e) => {
                setCid(e.target.value);
                setResults(null);
              }}
            />
          </label>
          {selected ? (
            <p>
              {selected.name} · {selected.codec} · {fmtBytes(selected.size)} · manifest sha256{' '}
              <code>{selected.sha256}</code>
              {selected.size > 20_000_000 ? (
                <span className="warn">
                  {' '}
                  · large part: the full {fmtBytes(selected.size)} is downloaded
                </span>
              ) : null}
            </p>
          ) : (
            <p className="muted">Enter a CID from the manifest.</p>
          )}
          <button type="button" onClick={() => void run()} disabled={!selected || busy}>
            {busy ? 'Fetching from both gateways…' : 'Verify on both gateways'}
          </button>
        </>
      ) : null}
      {results ? (
        <>
          <p>
            Overall: <strong data-testid="overall">{LABEL[overallState(results)]}</strong>
          </p>
          <table>
            <thead>
              <tr>
                <th>Gateway</th>
                <th>Result</th>
                <th>HTTP</th>
                <th>Size</th>
                <th>sha256</th>
                <th>CID multihash</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.gateway} data-testid="gateway-row">
                  <td>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {new URL(r.gateway).hostname}
                    </a>
                  </td>
                  <td className={`state-${r.state}`}>
                    {LABEL[r.state]}
                    {r.reasons.length > 0 ? (
                      <div className="muted">{r.reasons.join('; ')}</div>
                    ) : null}
                  </td>
                  <td>{r.http ?? '–'}</td>
                  <td>{r.size ?? '–'}</td>
                  <td>{r.sha256 ? <code>{r.sha256.slice(0, 16)}…</code> : '–'}</td>
                  <td>
                    {r.multihashMatches === null ? 'n/a' : r.multihashMatches ? 'equal' : 'differs'}
                  </td>
                  <td>{r.elapsedMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected ? (
            <p className="muted">
              CID <Cid value={selected.cid} />
            </p>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
