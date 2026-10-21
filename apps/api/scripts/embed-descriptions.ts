// Embeds every distinct text-indexed permit description of the current deploy with Bedrock Titan Text Embeddings V2
// (256 dimensions, normalized) for hybrid text search (decisions.md section 37). Distinct by md5(lower(trim(description))),
// computed in DuckDB so the deploy build joins on the same key. Vectors are stored quantized to int8 (round(x * 127)).
// Resumable: lines already in the output file are skipped. On-demand quota: 6,000 requests a minute; paced below it.
// Usage: AWS credentials in the environment, then npx tsx apps/api/scripts/embed-descriptions.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { DuckDBInstance } from '@duckdb/node-api';
import { embed } from 'ai';

const repo = path.resolve(import.meta.dirname, '../../..');
const DB = path.join(repo, 'data/deploy/current/travis.duckdb');
const OUT_DIR = path.join(repo, 'data/deploy/embeddings');
const OUT = path.join(OUT_DIR, 'titan-embed-text-v2-256.jsonl');
const RATE = Number(process.env.EMBED_RATE ?? 95);
const CONCURRENCY = 48;

mkdirSync(OUT_DIR, { recursive: true });
const done = new Set<string>();
if (existsSync(OUT))
  for (const line of readFileSync(OUT, 'utf8').split('\n'))
    if (line) done.add((JSON.parse(line) as { k: string }).k);

const conn = await (await DuckDBInstance.create(DB, { access_mode: 'READ_ONLY' })).connect();
const rows = (
  await conn.runAndReadAll(`SELECT md5(lower(trim(description))) k, any_value(lower(trim(description))) t
    FROM permits WHERE is_text_indexed AND description IS NOT NULL AND trim(description) <> '' GROUP BY 1 ORDER BY 1`)
).getRowObjectsJson() as { k: string; t: string }[];
const todo = rows.filter((r) => !done.has(r.k));
console.log(
  `${rows.length} distinct descriptions, ${done.size} already embedded, ${todo.length} to go`,
);

const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION ?? 'us-east-2' });
const model = bedrock.embedding('amazon.titan-embed-text-v2:0');
const t0 = Date.now();
let next = 0;
let finished = 0;
let failed = 0;
let inFlight = 0;
let tokens = 0;

async function one(r: { k: string; t: string }) {
  try {
    const { embedding } = await embed({
      model,
      value: r.t.slice(0, 8000),
      maxRetries: 8,
      providerOptions: { bedrock: { dimensions: 256, normalize: true } },
    });
    appendFileSync(
      OUT,
      JSON.stringify({ k: r.k, v: embedding.map((x) => Math.round(x * 127)) }) + '\n',
    );
    finished++;
  } catch (e) {
    failed++;
    if (failed <= 5) console.error(`failed ${r.k}: ${String(e).slice(0, 200)}`);
  } finally {
    inFlight--;
  }
}

await new Promise<void>((resolve) => {
  const tick = setInterval(() => {
    tokens = Math.min(RATE, tokens + RATE / 20);
    while (tokens >= 1 && inFlight < CONCURRENCY && next < todo.length) {
      tokens--;
      inFlight++;
      void one(todo[next++]!);
    }
    if (next >= todo.length && inFlight === 0) {
      clearInterval(tick);
      clearInterval(progress);
      resolve();
    }
  }, 50);
  const progress = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    const rate = finished / s;
    console.log(
      `${finished}/${todo.length} embedded, ${failed} failed, ${rate.toFixed(1)}/s, ETA ${Math.round((todo.length - finished) / Math.max(rate, 1) / 60)} min`,
    );
  }, 60_000);
});
console.log(
  `done: ${finished} embedded, ${failed} failed in ${Math.round((Date.now() - t0) / 1000)} s`,
);
