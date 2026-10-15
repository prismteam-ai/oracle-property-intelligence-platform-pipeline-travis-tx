import { useEffect, useState } from "react";
import { callTool, fmt, GATEWAYS, sha256Hex } from "./api.js";

type HistoryRun = {
  runId: string;
  createdAt: string;
  status: string;
  rootCid: string;
  carCid: string;
  manifestCid: string | null;
  manifestPath: string;
  previousRootCid: string | null;
  ipns: { name: string; resolvedCid: string } | null;
  published: boolean;
  providers: { provider: string; status: string }[];
};
type ManifestObject = {
  name: string;
  path: string;
  cid: string;
  codec: string;
  size: number;
  sha256: string | null;
  rows?: number;
};
type Manifest = {
  runId: string;
  root: {
    cid: string;
    name: string;
    size: number;
    car: { cid: string; size: number; sha256: string };
  };
  objects: ManifestObject[];
  ipns: { name: string; resolvedCid: string } | null;
};
type Check = { gateway: string; status: string; ok: boolean; bytes?: number; sha256?: string };

const MAX_BROWSER_VERIFY_BYTES = 64 * 1024 * 1024;

export function Publication() {
  const [history, setHistory] = useState<HistoryRun[] | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [checks, setChecks] = useState<Record<string, Check[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callTool<{ runs: HistoryRun[] }>("get_publication_history").then(
      (h) => {
        setHistory(h.runs);
        const last = h.runs[h.runs.length - 1];
        if (last) void openManifest(last.runId);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  async function openManifest(runId: string) {
    try {
      setManifest(await callTool<Manifest>("get_artifact_manifest", { runId }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function verify(o: ManifestObject) {
    setChecks((c) => ({
      ...c,
      [o.cid]: GATEWAYS.map((g) => ({ gateway: g, status: "fetching…", ok: false })),
    }));
    const results = await Promise.all(
      GATEWAYS.map(async (g): Promise<Check> => {
        try {
          const res = await fetch(`${g}/ipfs/${o.cid}`);
          if (!res.ok) return { gateway: g, status: `HTTP ${res.status}`, ok: false };
          const buf = await res.arrayBuffer();
          const sha = await sha256Hex(buf);
          const ok = buf.byteLength === o.size && (o.sha256 === null || sha === o.sha256);
          return {
            gateway: g,
            status: ok ? "match" : "MISMATCH",
            ok,
            bytes: buf.byteLength,
            sha256: sha,
          };
        } catch (e) {
          return { gateway: g, status: (e as Error).message, ok: false };
        }
      }),
    );
    setChecks((c) => ({ ...c, [o.cid]: results }));
  }

  if (error) return <p className="error">{error}</p>;
  if (!history) return <p className="muted">Loading publication history…</p>;
  return (
    <div className="stack">
      <section className="card">
        <h2>Publication history (immutable CIDs)</h2>
        {history.length === 0 && <p className="muted">No run has been published yet.</p>}
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Root CID (directory)</th>
                <th>CAR CID</th>
                <th>Previous root</th>
                <th>IPNS → resolved</th>
                <th>Pinned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.runId}>
                  <td className="mono">{r.runId}</td>
                  <td className="mono">
                    <a href={`${GATEWAYS[0]}/ipfs/${r.rootCid}`} target="_blank" rel="noreferrer">
                      {r.rootCid}
                    </a>
                  </td>
                  <td className="mono">
                    <a href={`${GATEWAYS[1]}/ipfs/${r.carCid}`} target="_blank" rel="noreferrer">
                      {r.carCid.slice(0, 18)}…
                    </a>
                  </td>
                  <td className="mono">
                    {r.previousRootCid ? `${r.previousRootCid.slice(0, 18)}…` : "—"}
                  </td>
                  <td className="mono">
                    {r.ipns
                      ? `${r.ipns.name.slice(0, 14)}… → ${r.ipns.resolvedCid.slice(0, 14)}…`
                      : "—"}
                  </td>
                  <td>
                    {r.providers.map((p) => `${p.provider}:${p.status}`).join(", ") ||
                      "not published"}
                  </td>
                  <td>
                    <button onClick={() => openManifest(r.runId)}>Manifest</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {manifest && (
        <section className="card">
          <h2>Artifact manifest · {manifest.runId}</h2>
          <div className="kv">
            <span>Root</span>
            <b className="mono">
              {manifest.root.cid} (directory, {fmt(manifest.root.size)} bytes)
            </b>
            <span>CAR</span>
            <b className="mono">
              {manifest.root.car.cid} ({fmt(manifest.root.car.size)} bytes, sha256{" "}
              {manifest.root.car.sha256.slice(0, 16)}…)
            </b>
            <span>IPNS</span>
            <b className="mono">
              {manifest.ipns ? `${manifest.ipns.name} → ${manifest.ipns.resolvedCid}` : "not used"}
            </b>
          </div>
          <p className="muted">
            Gateway URLs are derived from CIDs. “Verify” fetches the bytes from{" "}
            {GATEWAYS.join(" and ")} in your browser and compares size and SHA-256 with the manifest
            (objects ≤ 64 MB).
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Codec</th>
                  <th>Size</th>
                  <th>Rows</th>
                  <th>CID</th>
                  <th>SHA-256</th>
                  <th>Gateway check</th>
                </tr>
              </thead>
              <tbody>
                {manifest.objects.map((o) => (
                  <tr key={o.path}>
                    <td className="mono">{o.name}</td>
                    <td>{o.codec}</td>
                    <td>{fmt(o.size)}</td>
                    <td>{fmt(o.rows)}</td>
                    <td className="mono">
                      <a href={`${GATEWAYS[0]}/ipfs/${o.cid}`} target="_blank" rel="noreferrer">
                        {o.cid.slice(0, 20)}…
                      </a>
                    </td>
                    <td className="mono">{o.sha256 ? `${o.sha256.slice(0, 12)}…` : "—"}</td>
                    <td>
                      {o.codec === "file" && o.size <= MAX_BROWSER_VERIFY_BYTES && (
                        <button onClick={() => verify(o)}>Verify</button>
                      )}
                      {(checks[o.cid] ?? []).map((c) => (
                        <div key={c.gateway} className={c.ok ? "ok" : "bad"}>
                          {new URL(c.gateway).host}: {c.status}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
