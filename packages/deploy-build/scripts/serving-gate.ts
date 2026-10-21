// The decisions.md section 30 gate, run before any deploy that changes the serving set or the query layer:
// every operation, each on a cold instance, over data/deploy/current/serving served at RATE bytes/s in total with
// LATENCY_MS per request (Lambda's measured reads), equal to the full file's answer. The CRM's main call must finish
// under 10 s and every operation under 15 s, opening included.
// Usage: npx tsx scripts/serving-gate.ts   (env RATE=5000000 LATENCY_MS=30 THREADS=4 MEMORY=2GB)
// With SERVING_BASE=s3://<deploy bucket>/serving and AWS credential variables set, it reads the uploaded set from S3
// instead (signing, session token, TLS and region checked before Lambda; the timings are then this machine's).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Queries, servingFromEnv } from '@travis/query';
import { DEPLOY_ROOT } from '../src/env.js';
import { SERVING_DB_FILE } from '../src/serving.js';
import { CRM_F1, opSample, servingOps, startRangeServer } from '../test/serving-ops.js';

const RATE = Number(process.env.RATE ?? 5e6);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 30);
const THREADS = Number(process.env.THREADS ?? 4);
const MEMORY = process.env.MEMORY ?? '2GB';
const dir = path.join(DEPLOY_ROOT, 'current');
const deployJson = JSON.parse(readFileSync(path.join(dir, 'deploy.json'), 'utf8'));
if (!deployJson.serving)
  throw new Error('deploy.json has no serving block: run the serving command first');

// the image carries deploy.json beside the serving file, so /v1/meta reports the full file's SHA-256 as here
process.env.DUCKDB_SHA256 = deployJson.duckdb_sha256;
const server = await startRangeServer(path.join(dir, 'serving'), {
  rate: RATE,
  latencyMs: LATENCY_MS,
});
const full = await Queries.open({
  dbPath: path.join(dir, 'travis.duckdb'),
  memoryLimit: '4GB',
  threads: 4,
});
const sample = await opSample(full);
console.log(
  process.env.SERVING_BASE
    ? `serving gate: deploy ${deployJson.deploy_id} from ${process.env.SERVING_BASE} (MB and req columns stay 0), ${THREADS} threads, ${MEMORY}`
    : `serving gate: deploy ${deployJson.deploy_id}, ${(RATE / 1e6).toFixed(1)} MB/s, ${LATENCY_MS} ms per request, ${THREADS} threads, ${MEMORY}`,
);
console.log('   open ms     op ms  total ms      MB   req   warm ms  equal  operation');
const failures: string[] = [];
for (const op of servingOps(sample)) {
  const want = JSON.stringify(await op.run(full));
  server.reset();
  const t0 = performance.now();
  const q = await Queries.open({
    dbPath: path.join(dir, 'serving', SERVING_DB_FILE),
    memoryLimit: MEMORY,
    threads: THREADS,
    serving: servingFromEnv() ?? { base: `${server.url}/serving` },
  });
  const t1 = performance.now();
  let got: string;
  try {
    got = JSON.stringify(await op.run(q));
  } catch (e) {
    got = `error: ${String(e)}`;
  }
  const t2 = performance.now();
  const s = server.stats();
  await op.run(q).catch(() => undefined);
  const warm = performance.now() - t2;
  q.close();
  const total = t2 - t0;
  const equal = got === want;
  const limit = op.name === CRM_F1 ? 10_000 : 15_000;
  if (!equal) failures.push(`${op.name}: differs from the full file (${got.slice(0, 160)})`);
  if (total >= limit) failures.push(`${op.name}: ${Math.round(total)} ms >= ${limit} ms`);
  console.log(
    [
      Math.round(t1 - t0)
        .toString()
        .padStart(10),
      Math.round(t2 - t1)
        .toString()
        .padStart(9),
      Math.round(total).toString().padStart(9),
      (s.bytes / 1e6).toFixed(1).padStart(7),
      String(s.requests).padStart(5),
      Math.round(warm).toString().padStart(9),
      (equal ? 'yes' : 'NO').padStart(6),
      ` ${op.name}`,
    ].join(' '),
  );
}
full.close();
await server.close();
if (failures.length) {
  console.log(`FAIL\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('PASS');
