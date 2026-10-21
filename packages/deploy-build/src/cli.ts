import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { S3Client } from '@aws-sdk/client-s3';
import { buildDatabase } from './build.js';
import { DEPLOY_ROOT, PUBLICATION_PATH, REPO_ROOT, RUN_ID, SCHEMA_DIR, shardIds } from './env.js';
import { buildFixture } from './fixture.js';
import { HashCache, sha256FileRaw, sha256Hex } from './hash.js';
import { mirror, stageInputs } from './mirror.js';
import { uploadAll } from './s3.js';
import { SERVING_DB_FILE, buildServing } from './serving.js';
import { verifyInputs } from './verify.js';

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

function codeHash(): string {
  const files = [
    path.join(SCHEMA_DIR, 'schema.sql'),
    path.join(SCHEMA_DIR, 'post_load.sql'),
    path.join(SCHEMA_DIR, 'src', 'text.ts'),
    ...readdirSync(path.join(REPO_ROOT, 'packages', 'deploy-build', 'src'))
      .filter(
        (f) =>
          f.endsWith('.ts') &&
          f !== 'cli.ts' &&
          f !== 'fixture.ts' &&
          f !== 'mirror.ts' &&
          f !== 's3.ts' &&
          f !== 'serving.ts',
      )
      .sort()
      .map((f) => path.join(REPO_ROOT, 'packages', 'deploy-build', 'src', f)),
  ];
  return sha256Hex(
    files.map((f) => `${path.basename(f)}:${sha256Hex(readFileSync(f))}`).join('\n'),
  );
}

function serverCommit(): string {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return 'unknown';
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function pointCurrent(dir: string): void {
  const link = path.join(DEPLOY_ROOT, 'current');
  const tmp = `${link}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(path.basename(dir), tmp);
  if (
    existsSync(link) ||
    (() => {
      try {
        lstatSync(link);
        return true;
      } catch {
        return false;
      }
    })()
  )
    rmSync(link, { recursive: false, force: true });
  renameSync(tmp, link);
}

async function commandBuild(args: string[]): Promise<void> {
  const fixture = args.includes('--fixture');
  const force = args.includes('--force');
  const nShards = flag(args, '--shards');
  const shards = nShards ? shardIds().slice(0, Number(nShards)) : shardIds();
  const subset = shards.length !== 89;
  const t0 = performance.now();
  mkdirSync(DEPLOY_ROOT, { recursive: true });
  const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
  log('verifying inputs');
  const v = await verifyInputs(cache, log, subset ? { shards } : {});
  log(`inputs ok: ${v.files.length} files, ${v.parts.length} Parquet parts match the manifest`);
  const inputsSha256 = sha256Hex(
    `${v.inputsSha256}\n${codeHash()}\n${subset ? shards.join(',') : 'all'}`,
  );
  const deployId = (subset ? 'dev-' : '') + inputsSha256.slice(0, 16);
  const dir = path.join(DEPLOY_ROOT, deployId);
  const dbFile = path.join(dir, 'travis.duckdb');
  if (!force && existsSync(dbFile) && existsSync(path.join(dir, 'deploy.json'))) {
    log(`inputs_sha256 unchanged (${deployId}): skipping the rebuild`);
    if (!subset) pointCurrent(dir);
  } else {
    mkdirSync(dir, { recursive: true });
    const work = path.join(dir, 'work');
    const report = await buildDatabase({
      dbFile,
      workDir: work,
      verified: v,
      deployId,
      inputsSha256,
      serverCommit: serverCommit(),
      shards,
      subset,
      memoryLimit: flag(args, '--memory') ?? '18GB',
      threads: Number(flag(args, '--threads') ?? 8),
      log,
    });
    const duckdbSha256 = await sha256FileRaw(dbFile);
    const manifestCid = JSON.parse(readFileSync(PUBLICATION_PATH, 'utf8')).manifest.cid;
    const deployJson = {
      deploy_id: deployId,
      inputs_sha256: inputsSha256,
      deployed_at: new Date().toISOString(),
      server_commit: serverCommit(),
      duckdb_version: '1.5.6',
      duckdb_sha256: duckdbSha256,
      run_id: RUN_ID,
      manifest_cid: manifestCid,
      bytes: statSync(dbFile).size,
      build: {
        wall_seconds: Math.round((performance.now() - t0) / 1000),
        peak_rss_mb: report.peakRssMb,
        timings_ms: report.timings,
        subset,
      },
      reconcile: report.reconcile,
    };
    writeFileSync(path.join(dir, 'deploy.json'), JSON.stringify(deployJson, null, 2) + '\n');
    rmSync(work, { recursive: true, force: true });
    if (!subset) pointCurrent(dir);
    log(
      `built ${dbFile} (${(deployJson.bytes / 1e6).toFixed(0)} MB) in ${deployJson.build.wall_seconds}s, peak RSS ${report.peakRssMb} MB`,
    );
  }
  cache.save();
  if (fixture) {
    const out = path.join(REPO_ROOT, 'packages', 'query', 'fixtures', 'travis-fixture.duckdb');
    const rep = await buildFixture({ fullDb: dbFile, outFile: out, log });
    log(`fixture ${out}: ${(rep.bytes / 1e6).toFixed(1)} MB, ${JSON.stringify(rep.counts)}`);
  }
}

async function commandMirror(args: string[]): Promise<void> {
  const bucket = flag(args, '--bucket');
  if (!bucket) throw new Error('mirror: --bucket <mirror bucket> is required');
  const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
  const v = await verifyInputs(cache, log);
  const s3 = new S3Client({ region: flag(args, '--region') ?? 'us-east-2' });
  const r = await mirror(s3, bucket, v, { dryRun: args.includes('--dry-run'), log });
  log(
    `mirror: ${r.uploaded.length} uploaded, ${r.skipped.length} already present with the same checksum`,
  );
}

async function commandStage(args: string[]): Promise<void> {
  const bucket = flag(args, '--bucket');
  if (!bucket) throw new Error('stage-inputs: --bucket <private deploy bucket> is required');
  const cache = new HashCache(path.join(DEPLOY_ROOT, '.hash-cache.json'));
  const v = await verifyInputs(cache, log);
  const s3 = new S3Client({ region: flag(args, '--region') ?? 'us-east-2' });
  const r = await stageInputs(s3, bucket, v, { dryRun: args.includes('--dry-run'), log });
  log(
    `stage-inputs: ${r.uploaded.length} uploaded, ${r.skipped.length} already present; index key ${r.indexKey}`,
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The deploy directory `data/deploy/current` points at, and its deploy.json. */
function currentDeploy(): { dir: string; deployJsonFile: string; deployJson: Record<string, any> } {
  const dir = path.join(DEPLOY_ROOT, 'current');
  const deployJsonFile = path.join(dir, 'deploy.json');
  if (!existsSync(deployJsonFile))
    throw new Error(`${deployJsonFile} is missing: run build-db first`);
  return { dir, deployJsonFile, deployJson: JSON.parse(readFileSync(deployJsonFile, 'utf8')) };
}

const servingCode = (): string =>
  sha256Hex(readFileSync(path.join(REPO_ROOT, 'packages', 'deploy-build', 'src', 'serving.ts')));

/** True when every file deploy.json's `serving` block names is on disk with its recorded size. */
function servingPresent(dir: string, serving: Record<string, any> | undefined): boolean {
  if (!serving || serving.code_sha256 !== servingCode()) return false;
  const all = [serving.db, ...serving.files] as { file: string; bytes: number }[];
  return all.every((f) => {
    const p = path.join(dir, 'serving', f.file);
    return existsSync(p) && statSync(p).size === f.bytes;
  });
}

/** Exports the serving set (decisions.md section 30) of data/deploy/current and records it in deploy.json. */
async function commandServing(args: string[]): Promise<void> {
  const { dir, deployJsonFile, deployJson } = currentDeploy();
  if (!args.includes('--force') && servingPresent(dir, deployJson.serving)) {
    log(`serving set of ${deployJson.deploy_id} is up to date: skipping the export`);
    return;
  }
  const t0 = performance.now();
  const r = await buildServing({
    fullDb: path.join(dir, 'travis.duckdb'),
    outDir: path.join(dir, 'serving'),
    threads: Number(flag(args, '--threads') ?? 8),
    memoryLimit: flag(args, '--memory') ?? '12GB',
    log,
  });
  deployJson.serving = {
    code_sha256: servingCode(),
    built_at: new Date().toISOString(),
    wall_seconds: Math.round((performance.now() - t0) / 1000),
    key_prefix: `serving/${deployJson.deploy_id}/`,
    db: r.db,
    files: r.files,
    local_tables: r.localTables,
  };
  writeFileSync(deployJsonFile, JSON.stringify(deployJson, null, 2) + '\n');
  const remote = r.files.reduce((n, f) => n + f.bytes, 0);
  log(
    `serving: ${r.files.length} Parquet files (${(remote / 1e6).toFixed(0)} MB) and ${SERVING_DB_FILE} (${(r.db.bytes / 1e6).toFixed(0)} MB) in ${deployJson.serving.wall_seconds}s`,
  );
}

/** Uploads the serving Parquet files to the private deploy bucket under serving/<deploy_id>/ (immutable, SHA-256 checked). */
async function commandUploadServing(args: string[]): Promise<void> {
  const bucket = flag(args, '--bucket');
  if (!bucket) throw new Error('upload-serving: --bucket <private deploy bucket> is required');
  const { dir, deployJson } = currentDeploy();
  if (!servingPresent(dir, deployJson.serving))
    throw new Error(
      'upload-serving: the serving set is missing or stale: run the serving command first',
    );
  const s3 = new S3Client({ region: flag(args, '--region') ?? 'us-east-2' });
  const items = (deployJson.serving.files as { file: string; sha256: string; bytes: number }[]).map(
    (f) => ({
      key: `${deployJson.serving.key_prefix}${f.file}`,
      file: path.join(dir, 'serving', f.file),
      sha256: f.sha256,
      size: f.bytes,
    }),
  );
  const r = await uploadAll(s3, bucket, items, {
    concurrency: 4,
    contentType: 'application/vnd.apache.parquet',
    dryRun: args.includes('--dry-run'),
    log,
  });
  log(
    `upload-serving: ${r.uploaded.length} uploaded, ${r.skipped.length} already present with the same checksum (s3://${bucket}/${deployJson.serving.key_prefix})`,
  );
}

const [cmd = 'build-db', ...rest] = process.argv.slice(2);
const main = cmd.startsWith('--')
  ? commandBuild([cmd, ...rest])
  : cmd === 'build-db'
    ? commandBuild(rest)
    : cmd === 'mirror'
      ? commandMirror(rest)
      : cmd === 'stage-inputs'
        ? commandStage(rest)
        : cmd === 'serving'
          ? commandServing(rest)
          : cmd === 'upload-serving'
            ? commandUploadServing(rest)
            : Promise.reject(new Error(`unknown command ${cmd}`));
main.catch((e) => {
  console.error(e instanceof Error ? (process.env.DEBUG ? e.stack : e.message) : e);
  process.exit(1);
});
