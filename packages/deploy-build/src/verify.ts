/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  KIT_DATA,
  MANIFEST_PATH,
  captureDir,
  PUBLICATION_PATH,
  RUN_DIR,
  RUN_ID,
  RUN_RECORD_PATH,
  shardIds,
  linkDir,
} from './env.js';
import { HashCache, mapLimit, sha256Hex } from './hash.js';

/** One verified input. `expected` is the digest the run record, manifest or receipt names (null: hashed for inputs_sha256 only). */
export interface InputFile {
  id: string;
  path: string;
  sha256: string;
  expected: string | null;
  check: string;
}

export interface ManifestPart {
  group: string;
  shard: string;
  table: string;
  relPath: string; // e.g. address/part-00000.parquet
  size: number;
  sha256: string;
  cid: string;
  file: string; // absolute path on disk
}

export interface TablesRoot {
  group: string;
  shard: string;
  tablesCid: string;
  archiveCid: string;
}

export interface VerifiedInputs {
  files: InputFile[];
  parts: ManifestPart[];
  /** Directory (absolute) of each shard's chosen export-tables chain: group -> shard -> dir. */
  tablesDirs: Record<string, Record<string, string>>;
  reconcileDirs: Record<string, string>;
  roots: TablesRoot[];
  inputsSha256: string;
}

const readJson = <T = any>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

export class VerificationError extends Error {}

function fail(msg: string): never {
  throw new VerificationError(`input verification failed: ${msg}`);
}

/**
 * Verifies every input and returns its digests. Stops (throws) on any mismatch; never repairs, never falls back to
 * an attempt directory the run record does not name.
 */
export async function verifyInputs(
  cache: HashCache,
  log: (m: string) => void = () => {},
  opts: { shards?: string[] } = {},
): Promise<VerifiedInputs> {
  const shards = opts.shards ?? shardIds();
  const files: InputFile[] = [];
  const add = (f: InputFile) => files.push(f);

  // ---- manifest, run record, publication record --------------------------------------------------------------------
  const manifestBytes = readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const run = readJson(RUN_RECORD_PATH);
  const pub = readJson(PUBLICATION_PATH);
  if (manifest.run_id !== RUN_ID || run.run_id !== RUN_ID)
    fail('run id mismatch between manifest and run record');
  for (const [id, p] of [
    ['manifest.json', MANIFEST_PATH],
    ['run-record.json', RUN_RECORD_PATH],
    ['publication.json', PUBLICATION_PATH],
  ] as const) {
    add({
      id: `repo:${id}`,
      path: p,
      sha256: await cache.sha256(p),
      expected: null,
      check: 'hashed',
    });
  }
  const manifestCid: string | undefined = pub?.manifest?.cid;
  if (!manifestCid) fail('publication record has no manifest.cid');

  // ---- manifest objects: archive/tables roots and parts ------------------------------------------------------------
  const archiveRoots = new Map<string, string>();
  const tablesRoots = new Map<string, string>();
  const manifestParts = new Map<string, { size: number; sha256: string; cid: string }>();
  for (const o of manifest.objects as {
    name: string;
    cid: string;
    size: number;
    sha256: string;
  }[]) {
    let m = /^(county|property_improvement)\/(s\d{4})\/archive \(CountyIndex root\)$/.exec(o.name);
    if (m) archiveRoots.set(`${m[1]}/${m[2]}`, o.cid);
    m = /^(county|property_improvement)\/(s\d{4})\/tables \(CountyTables root\)$/.exec(o.name);
    if (m) tablesRoots.set(`${m[1]}/${m[2]}`, o.cid);
    if (/\/part-\d+\.parquet$/.test(o.name))
      manifestParts.set(o.name, { size: o.size, sha256: o.sha256, cid: o.cid });
  }

  // ---- the per-shard chain directories named by the done markers ------------------------------------------------------
  const tablesDirs: Record<string, Record<string, string>> = {
    county: {},
    property_improvement: {},
  };
  const reconcileDirs: Record<string, string> = {};
  const roots: TablesRoot[] = [];
  for (const shard of shards) {
    const sd = path.join(RUN_DIR, 'shards', shard);
    for (const group of ['county', 'property_improvement'] as const) {
      const marker = path.join(sd, `${group}.export_tables.done.json`);
      if (!existsSync(marker)) {
        if (group === 'property_improvement') continue; // a shard may publish no permit (88 of 89 do)
        fail(`${group} export marker missing for ${shard}`);
      }
      const d = readJson(marker);
      const dir = path.join(sd, d.output.chain_dir, 'tables');
      tablesDirs[group]![shard] = dir;
      const want = tablesRoots.get(`${group}/${shard}`);
      if (!want) fail(`manifest has no tables root for ${group}/${shard}`);
      if (d.output.tables?.root !== want)
        fail(
          `${group}/${shard}: done-marker tables root ${d.output.tables?.root} != manifest ${want}`,
        );
      roots.push({
        group,
        shard,
        tablesCid: want,
        archiveCid: archiveRoots.get(`${group}/${shard}`) ?? '',
      });
    }
    const rm = readJson(path.join(sd, 'reconcile.done.json'));
    reconcileDirs[shard] = path.join(sd, rm.output.dir);
    for (const f of rm.output.files as { path: string; sha256: string }[]) {
      const abs = path.join(sd, f.path);
      add({
        id: `run:${shard}/${f.path}`,
        path: abs,
        sha256: await cache.sha256(abs),
        expected: f.sha256,
        check: 'reconcile.done.json',
      });
    }
  }

  // ---- Parquet parts vs the manifest ----------------------------------------------------------------------------
  const parts: ManifestPart[] = [];
  const seen = new Set<string>();
  for (const [group, byShard] of Object.entries(tablesDirs)) {
    for (const [shard, dir] of Object.entries(byShard)) {
      for (const table of readdirSync(dir)) {
        const tdir = path.join(dir, table);
        if (!statSync(tdir).isDirectory()) continue;
        for (const f of readdirSync(tdir).sort()) {
          if (!f.endsWith('.parquet')) continue;
          const name = `${group}/${shard}/tables/${table}/${f}`;
          const m = manifestParts.get(name);
          if (!m) fail(`${name} is on disk but not in the manifest`);
          seen.add(name);
          parts.push({
            group,
            shard,
            table,
            relPath: `${table}/${f}`,
            size: m.size,
            sha256: m.sha256,
            cid: m.cid,
            file: path.join(tdir, f),
          });
        }
      }
    }
  }
  if (!opts.shards) {
    for (const name of manifestParts.keys())
      if (!seen.has(name)) fail(`${name} is in the manifest but not on disk`);
  } else {
    // a subset run only checks the parts it loads
  }
  log(`hashing ${parts.length} Parquet parts`);
  await mapLimit(parts, 8, async (p) => {
    if (statSync(p.file).size !== p.size)
      fail(`${p.file}: size ${statSync(p.file).size} != manifest ${p.size}`);
    const h = await cache.sha256(p.file);
    if (h !== p.sha256) fail(`${p.file}: sha256 ${h} != manifest ${p.sha256}`);
  });
  for (const p of parts)
    add({
      id: `part:${p.group}/${p.shard}/${p.relPath}`,
      path: p.file,
      sha256: p.sha256,
      expected: p.sha256,
      check: 'manifest',
    });

  // ---- per-shard seed, extras, link files ----------------------------------------------------------------------------
  const linkDone = readJson(path.join(RUN_DIR, 'global', 'link.done.json'));
  const linkSha = new Map<string, string>(
    (linkDone.output.files as { path: string; sha256: string }[]).map((f) => [f.path, f.sha256]),
  );
  for (const shard of shards) {
    for (const rel of ['seed.csv', 'extras.jsonl']) {
      const p = path.join(RUN_DIR, 'shards', shard, rel);
      add({
        id: `run:${shard}/${rel}`,
        path: p,
        sha256: await cache.sha256(p),
        expected: null,
        check: 'hashed',
      });
    }
    const rel = `${path.basename(linkDir())}/${shard}.jsonl`;
    const p = path.join(RUN_DIR, 'global', rel);
    add({
      id: `run:global/${rel}`,
      path: p,
      sha256: await cache.sha256(p),
      expected: linkSha.get(rel) ?? fail(`link.done.json has no ${rel}`),
      check: 'link.done.json',
    });
  }
  const pi = path.join(linkDir(), 'permits-internal.jsonl');
  add({
    id: `run:global/${path.basename(linkDir())}/permits-internal.jsonl`,
    path: pi,
    sha256: await cache.sha256(pi),
    expected: null,
    check: 'hashed',
  });

  // ---- Socrata permit capture vs its receipts and the run record ---------------------------------------------------
  const capDir = captureDir();
  const capture = readJson(path.join(capDir, 'capture.json'));
  const receipts = readFileSync(path.join(capDir, 'receipts.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(
      (l) =>
        JSON.parse(l) as {
          kind: string;
          file: string;
          sha256: string;
          bytes: number;
          status?: number;
          retried?: boolean;
        },
    );
  // the kit's partitionReceipts rule: the latest answered (200, not retried) page receipt per partition file
  const latest = new Map<string, (typeof receipts)[number]>();
  for (const r of receipts)
    if (r.kind === 'page' && r.status === 200 && !r.retried) latest.set(r.file, r);
  const pages = [...latest.values()].sort((a, b) => a.file.localeCompare(b.file));
  if (pages.length !== capture.partitions)
    fail(`capture has ${pages.length} partition receipts, capture.json says ${capture.partitions}`);
  await mapLimit(pages, 6, async (r) => {
    const p = path.join(capDir, r.file);
    const h = await cache.sha256(p);
    if (h !== r.sha256) fail(`${p}: sha256 ${h} != receipt ${r.sha256}`);
  });
  for (const r of pages)
    add({
      id: `capture:permits/${r.file}`,
      path: path.join(capDir, r.file),
      sha256: r.sha256,
      expected: r.sha256,
      check: 'receipts.jsonl',
    });
  // the run record's sha256 for the permit capture is the loader watermark digest of the partition hash index
  const partIndexFile = path.join(
    KIT_DATA,
    'loader',
    'full',
    'generations',
    RUN_ID,
    'hash-index.partitions.json',
  );
  const partIndex = readJson<Record<string, [string, string]>>(partIndexFile);
  const artifact = sha256Hex(
    JSON.stringify(
      Object.keys(partIndex)
        .sort()
        .map((k) => [k, partIndex[k]![0], partIndex[k]![1]]),
    ),
  );
  const permitsSource = (run.sources as { dataset: string; sha256: string | null }[]).find(
    (s) => s.dataset === 'austin-issued-construction-permits/3syk-w9eu',
  );
  if (artifact !== permitsSource?.sha256)
    fail(`permit capture artifact hash ${artifact} != run record ${permitsSource?.sha256}`);
  for (const r of pages)
    if (partIndex[r.file]?.[1] !== r.sha256)
      fail(`${r.file}: loader partition index differs from the receipt`);
  add({
    id: 'capture:permits/hash-index.partitions.json',
    path: partIndexFile,
    sha256: await cache.sha256(partIndexFile),
    expected: null,
    check: 'digest = run record sources[]',
  });
  if (capture.rows !== run.inputs.capture.rows)
    fail('capture.json rows differ from the run record');
  for (const f of ['capture.json', 'receipts.jsonl']) {
    add({
      id: `capture:permits/${f}`,
      path: path.join(capDir, f),
      sha256: await cache.sha256(path.join(capDir, f)),
      expected: null,
      check: 'hashed',
    });
  }

  // ---- registry and licensing snapshots (watermark digests) and matcher universes ------------------------------------------
  const srcSha = new Map<string, string | null>(
    (run.sources as { dataset: string; sha256: string | null }[]).map((s) => [s.dataset, s.sha256]),
  );
  for (const track of ['registry', 'licensing'] as const) {
    const wm = readJson(path.join(KIT_DATA, track, 'watermark.json'));
    for (const [name, e] of Object.entries<any>(wm.entries)) {
      const parquet = path.join(KIT_DATA, track, `${name}.parquet`);
      const h = await cache.sha256(parquet);
      if (h !== e.snapshot.sha256)
        fail(`${parquet}: sha256 ${h} != watermark ${e.snapshot.sha256}`);
      add({
        id: `${track}:${name}.parquet`,
        path: parquet,
        sha256: h,
        expected: e.snapshot.sha256,
        check: 'watermark.json snapshot',
      });
      const hi = path.join(KIT_DATA, track, `${name}.hash-index.json`);
      const index = readJson<{ path: string; artifact_hash: string }[]>(hi);
      const digest = sha256Hex(
        JSON.stringify(
          index
            .map((x) => [x.path, x.artifact_hash])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ),
      );
      if (digest !== e.artifact_hash)
        fail(`${hi}: digest ${digest} != watermark artifact_hash ${e.artifact_hash}`);
      const want = srcSha.get(name);
      if (want !== undefined && want !== e.artifact_hash)
        fail(`${name}: run record sha256 ${want} != watermark ${e.artifact_hash}`);
      add({
        id: `${track}:${name}.hash-index.json`,
        path: hi,
        sha256: await cache.sha256(hi),
        expected: e.artifact_hash,
        check: 'artifact hash (run record sources[])',
      });
      const lr = path.join(KIT_DATA, track, `${name}.load-report.json`);
      add({
        id: `${track}:${name}.load-report.json`,
        path: lr,
        sha256: await cache.sha256(lr),
        expected: null,
        check: 'hashed',
      });
    }
  }
  const vj = path.join(
    KIT_DATA,
    'registry',
    'tx-sos-veteran-owned-business.franchise-join.parquet',
  );
  add({
    id: 'registry:veteran-franchise-join',
    path: vj,
    sha256: await cache.sha256(vj),
    expected: null,
    check: 'hashed',
  });
  for (const n of [
    'tx-comptroller-franchise-tax-statewide',
    'tx-comptroller-sales-tax-travis',
    'tx-sos-veteran-owned-business',
    'tdlr-license-files',
    'tsbpe-responsible-master-plumber',
    'austin-row-contractor-licenses',
  ]) {
    const p = path.join(KIT_DATA, 'matcher', `${n}.names.parquet`);
    add({
      id: `matcher:${n}.names.parquet`,
      path: p,
      sha256: await cache.sha256(p),
      expected: null,
      check: 'hashed',
    });
  }

  // ---- TCAD export, listing and extras (receipts / index) ------------------------------------------------------------------
  const rc = readFileSync(path.join(KIT_DATA, 'export', 'download-receipts.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { name: string; sha256: string });
  const zipName = '2026 Certified Appraisal Export Supp 0_07182026.zip';
  const zipExpected = rc.find((r) => r.name === zipName)?.sha256;
  const runZip = (run.sources as { dataset: string; sha256: string | null }[]).find(
    (s) => s.dataset === 'tcad-2026-certified-appraisal-export',
  )?.sha256;
  if (!zipExpected || zipExpected !== runZip)
    fail('TCAD export receipt sha256 differs from the run record');
  const zipPath = path.join(KIT_DATA, 'export', zipName);
  const zipH = await cache.sha256(zipPath);
  if (zipH !== zipExpected) fail(`${zipPath}: sha256 ${zipH} != receipt ${zipExpected}`);
  add({
    id: 'tcad:appraisal-export.zip',
    path: zipPath,
    sha256: zipH,
    expected: zipExpected,
    check: 'download-receipts.jsonl',
  });
  const lstDir = path.join(KIT_DATA, 'tcad-permit-listing', '6f7a758568fd03fa');
  const lst = readJson(path.join(lstDir, 'index.json'));
  const lstH = await cache.sha256(path.join(lstDir, 'listing.tsv'));
  if (lstH !== lst.listing.sha256 || lstH !== run.inputs.tcad_permit_listing.listing_sha256)
    fail('TCAD permit listing sha256 mismatch');
  if (lst.source.sha256 !== run.inputs.tcad_permit_listing.source_sha256)
    fail('TCAD special export sha256 differs from the run record');
  add({
    id: 'tcad:permit-listing.tsv',
    path: path.join(lstDir, 'listing.tsv'),
    sha256: lstH,
    expected: lst.listing.sha256,
    check: 'index.json + run record',
  });
  const exDir = path.join(KIT_DATA, 'tcad-extras', 'travis-tcad-extras-v1');
  const exIndex = readJson(path.join(exDir, 'index.json'));
  if (exIndex.source.sha256 !== run.inputs.tcad_extras.archive_sha256)
    fail('TCAD extras source archive differs from the run record');
  add({
    id: 'tcad:extras.jsonl',
    path: path.join(exDir, 'extras.jsonl'),
    sha256: await cache.sha256(path.join(exDir, 'extras.jsonl')),
    expected: null,
    check: 'hashed',
  });

  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const inputsSha256 = sha256Hex(files.map((f) => `${f.id}:${f.sha256}`).join('\n'));
  cache.save();
  return { files, parts, tablesDirs, reconcileDirs, roots, inputsSha256 };
}
