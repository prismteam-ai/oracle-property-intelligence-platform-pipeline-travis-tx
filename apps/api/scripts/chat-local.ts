// The chat function's exported handler, run in Node (tsx) with the same API Gateway v2 events Lambda receives, against
// the serving DB built into the image (data/deploy/current/serving/serving.duckdb), the S3 Parquet tables of the deploy
// bucket and real Bedrock (decisions.md section 32). Credentials: the shell's AWS session (the operator's profile), not the
// function role. Used by golden.ts; `npx tsx apps/api/scripts/chat-local.ts "question"` sends one turn.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DEFAULT_LIMITS } from '@travis/query';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** API Gateway v2 event for `POST /v1/agent/chat`, as the HTTP API sends it. */
export function chatEvent(body: unknown, requestId = randomUUID()): APIGatewayProxyEventV2 {
  const now = Date.now();
  return {
    version: '2.0',
    routeKey: 'POST /v1/agent/chat',
    rawPath: '/v1/agent/chat',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'local',
      domainPrefix: 'local',
      http: {
        method: 'POST',
        path: '/v1/agent/chat',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'golden',
      },
      requestId,
      routeKey: 'POST /v1/agent/chat',
      stage: '$default',
      time: new Date(now).toISOString(),
      timeEpoch: now,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function out(key: string): string {
  return execFileSync(
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
}

/**
 * Sets the function environment the CDK stack sets (decisions.md section 30), then imports the handler module. The
 * caller exports AWS credentials (`aws configure export-credentials --format env`) so httpfs can read the bucket.
 */
export async function localChatHandler(modelId: string) {
  process.env.AWS_REGION ??= 'us-east-2';
  process.env.DUCKDB_PATH = path.join(repo, 'data/deploy/current/serving/serving.duckdb');
  process.env.SERVING_BASE ??= `s3://${out('DeployBucketName')}/serving`;
  process.env.DUCKDB_MEMORY_LIMIT ??= '2GB';
  process.env.DUCKDB_THREADS ??= '4';
  process.env.LIMITS_JSON ??= JSON.stringify({ ...DEFAULT_LIMITS });
  process.env.BEDROCK_MODEL_ID = modelId;
  process.env.LANGSMITH_PROJECT = 'staraptor-agent';
  process.env.POWERTOOLS_LOG_LEVEL ??= 'WARN';
  process.env.POWERTOOLS_METRICS_DISABLED ??= 'true';
  const mod = await import('../src/handlers/chat.js');
  return mod;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const question =
    process.argv[2] ??
    'Which properties in Travis County within five miles of Austin have roofs older than 15 years?';
  const mod = await localChatHandler(process.env.MODEL ?? 'us.anthropic.claude-sonnet-4-6');
  const { createChatHandler, readFlagFromSsm } = mod;
  void readFlagFromSsm;
  const { queriesLoader, limitsFromEnv } = await import('../src/db.js');
  const { createObservability } = await import('../src/observability.js');
  const { langSmithLoader } = await import('../src/chat/langsmith.js');
  const { bedrockModel } = await import('../src/chat/model.js');
  const { logger } = createObservability('staraptor-agent');
  const stats: unknown[] = [];
  const h = createChatHandler({
    readFlag: async () => 'false',
    queries: queriesLoader(logger),
    langsmith: langSmithLoader({ ...process.env, LANGSMITH_PROJECT: 'staraptor-agent' }),
    model: bedrockModel(process.env.BEDROCK_MODEL_ID!),
    modelId: process.env.BEDROCK_MODEL_ID!,
    limits: () => limitsFromEnv() ?? DEFAULT_LIMITS,
    onTurn: (s) => stats.push(s),
  });
  const t0 = performance.now();
  const r = (await h(
    chatEvent({ messages: [{ role: 'user', content: question }], session_id: 'local-smoke' }),
  )) as {
    statusCode: number;
    body: string;
  };
  const ms = Math.round(performance.now() - t0);
  const b = JSON.parse(r.body);
  console.log(r.statusCode, ms, 'ms');
  console.log(
    JSON.stringify(
      {
        ...b,
        evidence: `${b.evidence?.length} items`,
        limitations: b.limitations?.map((l: { incomplete_reason: string }) => l.incomplete_reason),
      },
      null,
      1,
    ),
  );
  console.log(JSON.stringify(stats));
  process.exit(0);
}
