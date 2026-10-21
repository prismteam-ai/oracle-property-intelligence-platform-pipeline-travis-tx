import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  BACKOFF_MS,
  ContractViolation,
  collectPages,
  createClient,
  fillPath,
  pageWithRestart,
  toSearch,
} from '../src/index.js';

// A real run record (runs/20261018T143520Z-t5-full.json); the API serves this shape at /v1/runs.
const realRun = JSON.parse(
  readFileSync(new URL('../../../runs/20261018T143520Z-t5-full.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const run = {
  run_id: realRun.run_id,
  started_at: realRun.started_at,
  finished_at: realRun.finished_at,
  // Real sources that were captured; the run record also lists sources with null url/fetched_at/sha256 (blocked or
  // unsupported ones), which RunSource in @travis/contract rejects: reported as a contract defect.
  sources: (
    realRun.sources as { sha256: string | null; url: string | null; fetched_at: string | null }[]
  ).filter((x) => x.sha256 && x.url && x.fetched_at),
  limitations: (realRun.limitations as { records_request: unknown }[]).filter(
    (l) => l.records_request === null || typeof l.records_request === 'object',
  ),
  groups: {},
  manifest_cid: 'bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4',
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('request building', () => {
  it('URL-encodes path ids (permit ids contain a space)', () => {
    expect(fillPath('/v1/permits/{permit_id}', { permit_id: '2026-102216 EP' })).toBe(
      '/v1/permits/2026-102216%20EP',
    );
  });
  it('serialises lists as comma-separated and drops undefined', () => {
    expect(
      toSearch({ status_group: ['open', 'stalled'], lat: 30.25, cursor: undefined, ok: true }),
    ).toBe('?status_group=open%2Cstalled&lat=30.25&ok=true');
  });
});

describe('createClient', () => {
  it('validates a /v1/runs body against the contract and returns it typed', async () => {
    const fetchMock = vi.fn(async () => json(200, { items: [run] }));
    const client = createClient({ baseUrl: 'https://api.example/', fetch: fetchMock as never });
    const result = await client.listRuns();
    expect(result.items[0]?.run_id).toBe('20261018T143520Z-t5-full');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/runs',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws ContractViolation when the body fails its Zod schema', async () => {
    const client = createClient({
      baseUrl: '',
      fetch: (async () => json(200, { items: [{ run_id: 'x' }] })) as never,
    });
    await expect(client.listRuns()).rejects.toBeInstanceOf(ContractViolation);
  });

  it('backs off 1 s, 2 s, 4 s on 429 and then succeeds', async () => {
    const answers = [429, 429, 429, 200];
    const fetchMock = vi.fn(async () => {
      const status = answers.shift() as number;
      return status === 200
        ? json(200, { items: [run] })
        : json(429, { message: 'Too Many Requests' });
    });
    const sleeps: number[] = [];
    const client = createClient({
      baseUrl: '',
      fetch: fetchMock as never,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await client.listRuns();
    expect(sleeps).toEqual([...BACKOFF_MS]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('gives up after the third back-off and reports rate_limited', async () => {
    const fetchMock = vi.fn(async () => json(429, { message: 'Too Many Requests' }));
    const client = createClient({ baseUrl: '', fetch: fetchMock as never, sleep: async () => {} });
    const error = await client.listRuns().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isRateLimited).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('surfaces the chat 503 agent_unavailable body and never retries a 5xx', async () => {
    const fetchMock = vi.fn(async () =>
      json(503, { error: 'agent_unavailable', reason: 'model_unavailable', request_id: 'abc' }),
    );
    const client = createClient({ baseUrl: '', fetch: fetchMock as never, sleep: async () => {} });
    const error = (await client
      .agentChat({ messages: [{ role: 'user', content: 'hello' }] })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.isAgentUnavailable).toBe(true);
    expect(error.detail).toBe('model_unavailable');
    expect(error.requestId).toBe('abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts MCP JSON-RPC with the protocol header', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { jsonrpc: '2.0', id: 1, result: { tools: [] } }),
    );
    const client = createClient({ baseUrl: 'https://api.example', fetch: fetchMock as never });
    await client.mcpToolsList();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/v1/mcp');
    expect((init.headers as Record<string, string>)['mcp-protocol-version']).toBe('2025-06-18');
    expect(JSON.parse(init.body as string)).toMatchObject({ method: 'tools/list' });
  });
});

describe('stale cursors', () => {
  const stale = () => new ApiError({ status: 400, code: 'stale_cursor', requestId: 'r1' });

  it('collectPages restarts from the first page once and returns one consistent snapshot', async () => {
    const calls: (string | undefined)[] = [];
    let thrown = false;
    const pages = async (cursor: string | undefined) => {
      calls.push(cursor);
      if (cursor === 'c2' && !thrown) {
        thrown = true;
        throw stale();
      }
      if (cursor === undefined) return { items: ['a'], next_cursor: 'c2' };
      return { items: ['b'], next_cursor: null };
    };
    const result = await collectPages(pages);
    expect(result.items).toEqual(['a', 'b']);
    expect(result.restarts).toBe(1);
    expect(calls).toEqual([undefined, 'c2', undefined, 'c2']);
  });

  it('collectPages rethrows a second stale cursor', async () => {
    const pages = async (cursor: string | undefined) => {
      if (cursor === undefined) return { items: ['a'], next_cursor: 'c2' };
      throw stale();
    };
    await expect(collectPages(pages)).rejects.toBeInstanceOf(ApiError);
  });

  it('pageWithRestart falls back to the first page', async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => {
      if (cursor === 'old') throw stale();
      return { items: [1], next_cursor: null };
    });
    const { page, restarted } = await pageWithRestart(fetchPage, 'old');
    expect(restarted).toBe(true);
    expect(page.items).toEqual([1]);
  });
});
