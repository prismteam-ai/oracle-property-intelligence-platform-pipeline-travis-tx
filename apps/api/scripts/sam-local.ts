// SAM local for the chat function (decisions.md section 32): the image SAM builds from cdk.out (`just sam-local` runs
// `cdk synth -c sam-local=1` and `sam build --use-buildkit` first), invoked with the API Gateway v2 events in
// apps/api/sam/events/: the README two-turn conversation, one out-of-scope question and one prompt injection. It proves
// the image, the packaging and the event handling, nothing about IAM, quotas or Bedrock access (the operator's
// credentials stand in for the function role). The out-of-scope event runs through a one-shot `sam local invoke` (a
// cold container); the others through `sam local start-lambda --warm-containers LAZY` (the chat container is created on the first call and kept), primed first by the warm-up event,
// because a cold container reading the S3 tables from the operator's machine (open about 9 s) cannot fit a README turn in
// the function's 28 s.
// Usage: AWS_PROFILE=cdk-lab npx tsx apps/api/scripts/sam-local.ts <built template> <result dir>
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable @typescript-eslint/no-explicit-any */

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const template = process.argv[2] ?? path.join(repo, 'apps/api/build/sam/template.yaml');
const work = process.argv[3] ?? path.join(repo, 'apps/api/build/sam');
const FN = 'ChatFunction3D7C447E';
const PORT = 3001;
const profile = process.env.AWS_PROFILE ?? 'cdk-lab';
const sam = process.env.SAM_CLI ?? 'sam';

const out = (key: string) =>
  execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'TravisApi',
      '--region',
      'us-east-2',
      '--query',
      `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`,
      '--output',
      'text',
    ],
    { encoding: 'utf8' },
  ).trim();

// SERVING_BASE is a CloudFormation reference SAM cannot resolve; the rest of the environment comes from the template.
const envFile = path.join(work, 'env.json');
mkdirSync(work, { recursive: true });
writeFileSync(
  envFile,
  JSON.stringify({ [FN]: { SERVING_BASE: `s3://${out('DeployBucketName')}/serving` } }),
);

const eventsDir = path.join(repo, 'apps/api/sam/events');
const events = readdirSync(eventsDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f.replace(/\.json$/, ''),
    ...JSON.parse(readFileSync(path.join(eventsDir, f), 'utf8')),
  }));

/** The event as Lambda receives it, received now (the turn deadline counts from timeEpoch). */
function fresh(e: any) {
  const event = { ...e };
  delete event._expect;
  delete event.name;
  const now = Date.now();
  return {
    ...event,
    requestContext: { ...event.requestContext, timeEpoch: now, time: new Date(now).toISOString() },
  };
}

function check(e: any, r: any, ms: number) {
  const body = typeof r?.body === 'string' ? JSON.parse(r.body) : null;
  const x = e._expect;
  const tools = (body?.tool_calls ?? []).map((c: any) => c.name);
  const forbidden = (x.answer_must_not_match ?? []).filter((re: string) =>
    new RegExp(re, 'im').test(body?.answer ?? ''),
  );
  const pass =
    r?.statusCode === 200 &&
    x.outcomes.includes(body?.outcome) &&
    x.tools.every((t: string) => tools.includes(t)) &&
    forbidden.length === 0;
  const row = {
    event: e.name,
    status: r?.statusCode ?? null,
    outcome: body?.outcome ?? null,
    tools,
    evidence: body?.evidence?.length ?? null,
    model_id: body?.model_id ?? null,
    prompt_version: body?.prompt_version ?? null,
    ms,
    pass,
    answer_excerpt: (body?.answer ?? '').slice(0, 300),
    error: r?.errorMessage ?? null,
  };
  console.error(
    `${e.name}: ${row.status} ${row.outcome} ${ms} ms ${pass ? 'PASS' : 'FAIL'} [${tools.join(' ')}]`,
  );
  return row;
}

const rows: any[] = [];

// 1. one-shot `sam local invoke` (a cold container) for the out-of-scope event
const cold = events.find((e) => e.name.includes('out-of-scope'))!;
const coldFile = path.join(work, 'event-cold.json');
writeFileSync(coldFile, JSON.stringify(fresh(cold)));
{
  const t0 = performance.now();
  const stdout = execFileSync(
    sam,
    [
      'local',
      'invoke',
      FN,
      '-t',
      template,
      '-e',
      coldFile,
      '--env-vars',
      envFile,
      '--profile',
      profile,
      '--region',
      'us-east-2',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
  );
  const line = stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{"statusCode"'))
    .pop();
  rows.push({
    mode: 'sam local invoke (cold container)',
    ...check(cold, line ? JSON.parse(line) : null, Math.round(performance.now() - t0)),
  });
}

// 2. `sam local start-lambda` with a warm container: the warm-up event, then the README conversation and the injection
const server = spawn(
  sam,
  [
    'local',
    'start-lambda',
    '-t',
    template,
    '--env-vars',
    envFile,
    '--profile',
    profile,
    '--region',
    'us-east-2',
    '--warm-containers',
    'LAZY',
    '--port',
    String(PORT),
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const invoke = async (payload: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/2015-03-31/functions/${FN}/invocations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return r.json();
};
try {
  for (let i = 0; i < 120 && !/Running on http/.test(log); i++)
    await new Promise((r) => setTimeout(r, 1000));
  if (!/Running on http/.test(log))
    throw new Error(`sam local start-lambda did not start:\n${log.slice(-2000)}`);
  const t0 = performance.now();
  const w = await invoke({ warm: { hold_ms: 0 } });
  console.error(`warm-up: ${JSON.stringify(w)} ${Math.round(performance.now() - t0)} ms`);
  for (const e of events.filter((x) => x !== cold)) {
    const t = performance.now();
    rows.push({
      mode: 'sam local start-lambda (warm container)',
      ...check(e, await invoke(fresh(e)), Math.round(performance.now() - t)),
    });
  }
} finally {
  server.kill('SIGINT');
}

const result = {
  run_at: new Date().toISOString(),
  template: path.relative(repo, template),
  pass: rows.every((r) => r.pass),
  rows,
};
const name = `${result.run_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-sam-local.json`;
mkdirSync(path.join(repo, 'fixtures/rag/results'), { recursive: true });
writeFileSync(
  path.join(repo, 'fixtures/rag/results', name),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify({ pass: result.pass, file: `fixtures/rag/results/${name}` }));
process.exit(result.pass ? 0 : 1);
