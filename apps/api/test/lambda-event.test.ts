import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { FIXTURE_DB_URL, fixtureExists } from '@travis/query';

const ev = (
  method: string,
  rawPath: string,
  query: Record<string, string> = {},
  body?: string,
  headers: Record<string, string> = {},
) =>
  ({
    version: '2.0',
    rawPath,
    rawQueryString: new URLSearchParams(query).toString(),
    queryStringParameters: Object.keys(query).length ? query : undefined,
    headers,
    body,
    isBase64Encoded: false,
    requestContext: { requestId: 'apigw-req-42', http: { method, path: rawPath } },
  }) as unknown as APIGatewayProxyEventV2;

describe.skipIf(!fixtureExists())('api.ts handler with API Gateway v2 events', () => {
  it('answers with x-request-id equal to requestContext.requestId and no CORS headers', async () => {
    process.env.DUCKDB_PATH = fileURLToPath(FIXTURE_DB_URL);
    process.env.DUCKDB_MEMORY_LIMIT = '1GB';
    process.env.DUCKDB_THREADS = '2';
    process.env.LIMITS_JSON = JSON.stringify({
      stage: { rate: 7, burst: 9 },
      routes: {},
      mcp: {},
      chat: { max_output_tokens: 1500, turn_deadline_seconds: 25 },
    });
    const { handler, getQueries } = await import('../src/handlers/api.js');
    const meta = (await handler(ev('GET', '/v1/meta'))) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };
    expect(meta.statusCode).toBe(200);
    expect(meta.headers['x-request-id']).toBe('apigw-req-42');
    expect(Object.keys(meta.headers).some((h) => h.startsWith('access-control'))).toBe(false);
    expect(JSON.parse(meta.body).limits.stage).toEqual({ rate: 7, burst: 9 });
    const nf = (await handler(ev('GET', '/v1/properties/does-not-exist'))) as {
      statusCode: number;
      body: string;
    };
    expect(nf.statusCode).toBe(404);
    expect(JSON.parse(nf.body)).toEqual({ error: 'not_found', request_id: 'apigw-req-42' });
    const mcp = (await handler(
      ev('POST', '/v1/mcp', {}, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), {
        'MCP-Protocol-Version': '2025-06-18',
      }),
    )) as { statusCode: number; body: string };
    expect(JSON.parse(mcp.body)).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    // the scheduled warm-up (decisions.md section 31): primes once per instance, then only holds
    expect(await handler({ warm: { hold_ms: 0 } })).toEqual({ warmed: true, primed_now: true });
    expect(await handler({ warm: {} })).toEqual({ warmed: true, primed_now: false });
    (await getQueries()).close();
  });
});
