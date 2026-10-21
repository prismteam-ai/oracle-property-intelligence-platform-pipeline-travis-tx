import { useMemo, useRef, useState } from 'react';
import { Cid, ErrorBox, Loading, Section } from '../components/common.js';
import { useManifest, useMeta } from '../hooks.js';
import { fmtBytes } from '../lib/format.js';
import { mirrorPath, tablePartsByShard } from '../lib/manifest.js';
import type { SqlEngine, SqlResult } from '../lib/duckdb.js';

export type EngineLoader = () => Promise<SqlEngine>;

type Source = 'mirror' | 'filebase';
const FILEBASE = 'https://ipfs.filebase.io/ipfs/';

let shared: Promise<SqlEngine> | null = null;
/** DuckDB-WASM, started once per page; App starts it in the background shortly after load, so this tab finds it ready. */
export function preloadEngine(): Promise<SqlEngine> {
  if (!shared) {
    shared = import('../lib/duckdb.js').then((m) => m.openDuckDb());
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}
const defaultLoader: EngineLoader = preloadEngine;

const PRESETS: { label: string; sql: (tables: string[]) => string }[] = [
  {
    label: 'Row counts per table',
    sql: (t) =>
      t.map((n) => `select '${n}' as "table", count(*) as rows from "${n}"`).join('\nunion all\n'),
  },
  {
    label: 'Peek at the first table',
    sql: (t) => `select * from "${t[0] ?? 'property'}" limit 10`,
  },
  { label: 'Describe the first table', sql: (t) => `describe "${t[0] ?? 'property'}"` },
  { label: 'DuckDB version', sql: () => 'select version() as duckdb_version' },
];

/** Demo step 3: DuckDB-backed, no database server; a DuckDB-WASM box over the mirrored Parquet parts. */
export function QueryLayer({ loadEngine = defaultLoader }: { loadEngine?: EngineLoader }) {
  const meta = useMeta();
  const runId = meta.data?.run.run_id;
  const manifest = useManifest(runId);
  const [shard, setShard] = useState<string>('');
  const [source, setSource] = useState<Source>('mirror');
  const [sql, setSql] = useState('select version() as duckdb_version');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [engine, setEngine] = useState<SqlEngine | null>(null);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registeredShard = useRef('');
  const [readCids, setReadCids] = useState<{ table: string; cids: string[] }[]>([]);

  const shards = useMemo(
    () => (manifest.data ? tablePartsByShard(manifest.data.objects) : new Map()),
    [manifest.data],
  );
  const shardKeys = useMemo(() => [...shards.keys()].sort(), [shards]);
  const activeShard = shard || shardKeys[0] || '';
  const tablesCid = meta.data?.groups[activeShard]?.tables;
  const tables = useMemo(() => {
    const byTable = new Map<string, { cid: string; size: number; relativePath: string }[]>();
    for (const part of shards.get(activeShard) ?? []) {
      const list = byTable.get(part.table) ?? [];
      list.push(part);
      byTable.set(part.table, list);
    }
    return byTable;
  }, [shards, activeShard]);

  async function run() {
    setError(null);
    try {
      let current = engine;
      if (!current) {
        setStatus('loading');
        current = await loadEngine();
        setEngine(current);
      }
      if (!tablesCid) throw new Error(`no tables CID for ${activeShard} in /v1/meta.groups`);
      const registration = `${source}:${activeShard}`;
      if (registeredShard.current !== registration) {
        await current.registerTables(
          [...tables.entries()].map(([name, parts]) => ({
            name,
            urls: parts.map((p) =>
              source === 'filebase' ? `${FILEBASE}${p.cid}` : mirrorPath(tablesCid, p.relativePath),
            ),
          })),
        );
        registeredShard.current = registration;
      }
      const used = [...tables.keys()].filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(sql));
      setReadCids(
        used.map((table) => ({ table, cids: (tables.get(table) ?? []).map((p) => p.cid) })),
      );
      setResult(await current.query(sql));
      setStatus('ready');
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Section title="DuckDB-backed query layer" step="3">
        <p>
          The loaded data is queryable with <strong>DuckDB</strong> and{' '}
          <strong>no database server</strong>: the API embeds a read-only DuckDB file, and the box
          below runs DuckDB-WASM in this browser over the published Parquet parts, mirrored
          same-origin at <code>/tables/&lt;tables_cid&gt;/…</code> and read with HTTP range
          requests. Switch the source to read each part straight from an IPFS gateway by its CID
          instead. Oracle hosts no database and no query compute for it.
        </p>
        {meta.data ? (
          <p className="muted">
            API engine: DuckDB {meta.data.deploy.duckdb_version}, snapshot{' '}
            <code>{meta.data.deploy.deploy_id}</code>, text index of{' '}
            {meta.data.deploy.text_index.rows.toLocaleString('en-US')} permit rows.
          </p>
        ) : null}
      </Section>

      <Section title="SQL over the mirrored Parquet (DuckDB-WASM)">
        {manifest.isPending ? <Loading what="manifest tables" /> : null}
        {manifest.isError ? <ErrorBox error={manifest.error} /> : null}
        {shardKeys.length > 0 ? (
          <>
            <label>
              Group and shard{' '}
              <select
                value={activeShard}
                onChange={(e) => setShard(e.target.value)}
                aria-label="Group and shard"
              >
                {shardKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Read from{' '}
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
                aria-label="Read from"
              >
                <option value="mirror">Same-origin mirror (fast)</option>
                <option value="filebase">IPFS by part CID (ipfs.filebase.io)</option>
              </select>
            </label>
            <p>Tables root CID: {tablesCid ? <Cid value={tablesCid} /> : 'n/a'}</p>
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Part CIDs</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {[...tables.entries()].map(([name, parts]) => (
                  <tr key={name}>
                    <td>
                      <code>{name}</code>
                    </td>
                    <td>
                      {parts.map((p) => (
                        <div key={p.cid}>
                          <Cid value={p.cid} />
                        </div>
                      ))}
                    </td>
                    <td>{fmtBytes(parts.reduce((n, p) => n + p.size, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSql(preset.sql([...tables.keys()]))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <textarea
              aria-label="SQL"
              rows={6}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
            />
            <button type="button" onClick={() => void run()} disabled={status === 'loading'}>
              {status === 'loading' ? 'Starting DuckDB-WASM…' : 'Run query'}
            </button>
            {status === 'loading' ? (
              <p className="notice" role="status">
                Starting DuckDB-WASM in this browser: the engine (about 8 MB) downloads once and
                opens, which can take 5-20 seconds on a first visit. The query then runs here,
                reading the Parquet mirror directly; no server is involved.
              </p>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {readCids.length > 0 ? (
          <div data-testid="cids-read">
            <h3>Tables read, by CID</h3>
            <ul>
              {readCids.map((r) => (
                <li key={r.table}>
                  <code>{r.table}</code> →{' '}
                  {r.cids.map((cid) => (
                    <Cid key={cid} value={cid} />
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {result ? (
          <div className="scroll">
            <p className="muted">
              {result.rows.length} rows in {result.elapsedMs} ms
            </p>
            <table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 200).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell === null ? 'null' : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
    </>
  );
}
