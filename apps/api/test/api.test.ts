import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS, OPENAPI_JSON, TOOLS, mcpToolListing } from '@travis/contract';
import { FIXTURE_DB_URL, FIXTURE_SKIP_MESSAGE, Queries, fixtureExists } from '@travis/query';
import { App, type HttpRequest } from '../src/app.js';

if (!fixtureExists()) console.warn(FIXTURE_SKIP_MESSAGE);

const get = (
  path: string,
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
): HttpRequest => ({
  method: 'GET',
  path,
  query,
  headers,
  body: null,
  requestId: 'req-1',
});
const post = (body: unknown, headers: Record<string, string> = {}): HttpRequest => ({
  method: 'POST',
  path: '/v1/mcp',
  query: {},
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  requestId: 'req-mcp',
});

describe.skipIf(!fixtureExists())('REST router and MCP endpoint on the fixture database', () => {
  let q: Queries;
  let app: App;
  let ids: Record<string, string>;
  let center: { lat: string; lon: string };
  let clock = 0;
  const one = async (sql: string) =>
    (await q.conn.runAndReadAll(sql)).getRowObjectsJson()[0] as Record<string, string>;
  beforeAll(async () => {
    q = await Queries.open({
      dbPath: fileURLToPath(FIXTURE_DB_URL),
      memoryLimit: '1GB',
      threads: 2,
    });
    app = new App({
      queries: async () => q,
      mcpLimits: { search_permit_text: { rate: 1, burst: 2 } },
      now: () => clock,
    });
    const c = await one(`SELECT lat, lon FROM search_centers WHERE center_id = 'city:austin'`);
    center = { lat: String(c.lat), lon: String(c.lon) };
    ids = {
      property: (
        await one(
          `SELECT property_id v FROM properties WHERE geo_id IS NOT NULL AND roof_age_years > 15 ORDER BY 1 LIMIT 1`,
        )
      ).v!,
      geo: (
        await one(
          `SELECT geo_id v FROM properties WHERE geo_id IS NOT NULL AND roof_age_years > 15 ORDER BY property_id LIMIT 1`,
        )
      ).v!,
      permit: (await one(`SELECT permit_id v FROM permits ORDER BY 1 LIMIT 1`)).v!,
      contractor: (
        await one(`SELECT contractor_attribution_key v FROM registry_candidates ORDER BY 1 LIMIT 1`)
      ).v!,
      business: (await one(`SELECT business_record_id v FROM business_records ORDER BY 1 LIMIT 1`))
        .v!,
      businessName: (
        await one(
          `SELECT name v FROM business_records WHERE taxpayer_number IS NOT NULL ORDER BY 1 LIMIT 1`,
        )
      ).v!,
      license: (await one(`SELECT license_record_id v FROM license_records ORDER BY 1 LIMIT 1`)).v!,
      licenseName: (
        await one(
          `SELECT holder_name v FROM license_records WHERE holder_name IS NOT NULL ORDER BY 1 LIMIT 1`,
        )
      ).v!,
    };
  });
  afterAll(() => q?.close());

  const rest = (path: string, query?: Record<string, string>) => app.handle(get(path, query));

  it('serves every REST endpoint with a schema-valid body and an x-request-id', async () => {
    const calls: [string, string, Record<string, string>][] = [
      ['getMeta', '/v1/meta', {}],
      ['searchCenters', '/v1/search-centers', { q: 'austin' }],
      ['searchProperties', '/v1/properties/search', { ...center, radius_miles: '8', limit: '5' }],
      ['getProperty', `/v1/properties/${encodeURIComponent(ids.property!)}`, {}],
      ['getPropertyByGeoId', `/v1/properties/by-geo-id/${encodeURIComponent(ids.geo!)}`, {}],
      ['searchPermits', '/v1/permits/search', { ...center, radius_miles: '8', limit: '5' }],
      ['searchPermitText', '/v1/permits/text-search', { q: 'reroof', limit: '5' }],
      ['getPermit', `/v1/permits/${encodeURIComponent(ids.permit!)}`, {}],
      ['getContractor', `/v1/contractors/${ids.contractor}`, {}],
      ['searchBusinesses', '/v1/businesses/search', { q: ids.businessName! }],
      ['getBusiness', `/v1/businesses/${ids.business}`, {}],
      ['searchLicenses', '/v1/licenses/search', { q: ids.licenseName! }],
      ['getLicense', `/v1/licenses/${ids.license}`, {}],
      ['listRuns', '/v1/runs', {}],
      ['getRunManifest', '/v1/runs/20261018T143520Z-t5-full/manifest', {}],
    ];
    for (const [op, path, query] of calls) {
      const e = ENDPOINTS.find((x) => x.operationId === op)!;
      const res = await rest(path, query);
      expect(res.statusCode, `${op} ${path}`).toBe(200);
      expect(res.headers['x-request-id']).toBe('req-1');
      const body = JSON.parse(res.body);
      const parsed = e.response.safeParse(body);
      expect(
        parsed.success
          ? []
          : parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
        `${op} schema`,
      ).toEqual([]);
      if (op.startsWith('search') && op !== 'searchCenters')
        expect(body.items.length, `${op} rows`).toBeGreaterThan(0);
    }
  });

  it('serves openapi.json byte-identical and the manifest bytes unchanged', async () => {
    const res = await rest('/v1/openapi.json');
    expect(res.body).toBe(OPENAPI_JSON);
    expect(
      readFileSync(
        fileURLToPath(new URL('../../../packages/contract/openapi.json', import.meta.url)),
        'utf8',
      ),
    ).toBe(res.body);
    const m = await rest('/v1/runs/20261018T143520Z-t5-full/manifest');
    expect(Buffer.from(m.body).equals(await q.getRunManifest('20261018T143520Z-t5-full'))).toBe(
      true,
    );
  });

  it('errors follow the contract: 400, 404, 405 and stale cursors', async () => {
    const bad = await rest('/v1/properties/search', { lat: '30.2' });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body)).toMatchObject({ error: 'invalid_params', request_id: 'req-1' });
    expect(
      JSON.parse((await rest('/v1/properties/search', { radius_miles: '99' })).body).detail,
    ).toContain('radius_miles');
    const nf = await rest('/v1/permits/9999-000000%20XX');
    expect(nf.statusCode).toBe(404);
    expect(JSON.parse(nf.body)).toEqual({ error: 'not_found', request_id: 'req-1' });
    expect((await rest('/v1/nothing')).statusCode).toBe(404);
    expect((await app.handle({ ...get('/v1/meta'), method: 'DELETE' })).statusCode).toBe(405);
    const stale = Buffer.from(JSON.stringify({ d: 'old', a: q.today(), o: 1 })).toString(
      'base64url',
    );
    const s = await rest('/v1/properties/search', { cursor: stale });
    expect(s.statusCode).toBe(400);
    expect(JSON.parse(s.body)).toEqual({ error: 'stale_cursor', request_id: 'req-1' });
    // the chat route is not served by this function
    expect((await app.handle({ ...get('/v1/agent/chat'), method: 'POST' })).statusCode).toBe(404);
  });

  it('a permit id with a space is path-encoded', async () => {
    const r = await rest(`/v1/permits/${encodeURIComponent(ids.permit!)}`);
    expect(r.statusCode).toBe(200);
    expect(ids.permit).toContain(' ');
  });

  describe('MCP', () => {
    const call = async (body: unknown, headers?: Record<string, string>) =>
      app.handle(post(body, headers));
    const rpc = async (method: string, params?: unknown, id: number | string = 1) =>
      JSON.parse((await call({ jsonrpc: '2.0', id, method, params })).body);

    it('initializes on protocol 2025-06-18 and lists the tools from the registry', async () => {
      const init = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      });
      expect(init.result.protocolVersion).toBe('2025-06-18');
      expect(init.result.instructions).toMatch(/Travis County, TX/);
      expect(init.result.instructions).toMatch(/untrusted data/);
      const list = await rpc('tools/list');
      expect(list.result.tools).toEqual(JSON.parse(JSON.stringify(mcpToolListing())));
      expect(list.result.tools.length).toBe(12);
      const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(res.headers['mcp-session-id']).toBeUndefined();
      expect(res.headers['x-request-id']).toBe('req-mcp');
    });

    it('answers notifications with 202, GET and DELETE with 405 and a wrong protocol version with 400', async () => {
      expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode).toBe(
        202,
      );
      expect((await app.handle({ ...post({}), method: 'GET' })).statusCode).toBe(405);
      expect((await app.handle({ ...post({}), method: 'DELETE' })).statusCode).toBe(405);
      const wrong = await call(
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { 'mcp-protocol-version': '2024-11-05' },
      );
      expect(wrong.statusCode).toBe(400);
      expect(
        (
          await call(
            { jsonrpc: '2.0', id: 1, method: 'ping' },
            { 'mcp-protocol-version': '2025-06-18' },
          )
        ).statusCode,
      ).toBe(200);
      expect(
        JSON.parse((await call({ jsonrpc: '2.0', id: 3, method: 'nope' })).body).error.code,
      ).toBe(-32601);
      expect(JSON.parse((await call('{not json')).body).error.code).toBe(-32700);
    });

    const args = (): Record<string, unknown> => ({
      resolve_search_center: { q: 'austin' },
      search_properties: {
        ...Object.fromEntries(Object.entries(center).map(([k, v]) => [k, Number(v)])),
        radius_miles: 8,
        open_permits: true,
        limit: 5,
      },
      get_property: { property_id: ids.property },
      search_permits: {
        ...Object.fromEntries(Object.entries(center).map(([k, v]) => [k, Number(v)])),
        radius_miles: 8,
        limit: 5,
      },
      search_permit_text: { q: 'reroof', limit: 5 },
      get_permit: { permit_id: ids.permit },
      get_contractor: { contractor_attribution_key: ids.contractor },
      get_run_summary: {},
      search_businesses: { q: ids.businessName },
      get_business: { business_record_id: ids.business },
      search_licenses: { q: ids.licenseName },
      get_license: { license_record_id: ids.license },
    });

    it('every tool returns structuredContent valid against its output schema, with the same JSON as text', async () => {
      const a = args();
      for (const tool of TOOLS) {
        clock += 60_000;
        const r = await rpc('tools/call', { name: tool.name, arguments: a[tool.name] });
        expect(r.result.isError, tool.name).toBe(false);
        const parsed = tool.output.safeParse(r.result.structuredContent);
        expect(
          parsed.success
            ? []
            : parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
          `${tool.name} output`,
        ).toEqual([]);
        expect(r.result.content).toHaveLength(1);
        expect(JSON.parse(r.result.content[0].text)).toEqual(r.result.structuredContent);
        const items = r.result.structuredContent.items;
        if (Array.isArray(items) && tool.name !== 'resolve_search_center')
          expect(items.length, `${tool.name} rows`).toBeGreaterThan(0);
      }
    });

    it('get_property embeds at most 20 permits on MCP and search_properties needs open_permits', async () => {
      const r = await rpc('tools/call', {
        name: 'get_property',
        arguments: { property_id: ids.property },
      });
      expect(r.result.structuredContent.permits.length).toBeLessThanOrEqual(20);
      const miss = await rpc('tools/call', {
        name: 'search_properties',
        arguments: { lat: 30.27, lon: -97.74 },
      });
      expect(miss.result.isError).toBe(true);
      expect(miss.result.structuredContent).toMatchObject({
        error: 'invalid_params',
        request_id: 'req-mcp',
      });
      expect(miss.result.structuredContent.detail).toContain('open_permits');
    });

    it('tool failures are isError results with structuredContent, never JSON-RPC errors', async () => {
      const nf = await rpc('tools/call', { name: 'get_permit', arguments: { permit_id: 'nope' } });
      expect(nf.error).toBeUndefined();
      expect(nf.result).toMatchObject({
        isError: true,
        structuredContent: { error: 'not_found', request_id: 'req-mcp' },
      });
      const both = await rpc('tools/call', {
        name: 'get_property',
        arguments: { property_id: '1', geo_id: '2' },
      });
      expect(both.result.isError).toBe(true);
      const unknown = await rpc('tools/call', { name: 'nope', arguments: {} });
      expect(unknown.result.isError).toBe(true);
      const stale = Buffer.from(JSON.stringify({ d: 'old', a: q.today(), o: 1 })).toString(
        'base64url',
      );
      const c = await rpc('tools/call', { name: 'search_permits', arguments: { cursor: stale } });
      expect(c.result.structuredContent).toMatchObject({ error: 'stale_cursor' });
    });

    it('enforces the per-instance, per-tool limit and reports retry_after_seconds', async () => {
      clock += 3_600_000;
      const t = () =>
        rpc('tools/call', { name: 'search_permit_text', arguments: { q: 'roof', limit: 1 } });
      expect((await t()).result.isError).toBe(false);
      expect((await t()).result.isError).toBe(false);
      const limited = await t();
      expect(limited.result.isError).toBe(true);
      expect(limited.result.structuredContent.error).toBe('rate_limited');
      expect(limited.result.structuredContent.retry_after_seconds).toBeGreaterThanOrEqual(1);
      clock += 5_000;
      expect((await t()).result.isError).toBe(false);
    });
  });
});

// Both PR descriptions link the bare API_BASE, which `$default` sends here; contract v1 is frozen, so `/` is not in it.
describe('GET /', () => {
  const app = new App({
    queries: () => Promise.reject(new Error('GET / must not open the query layer')),
  });
  it('answers 200 JSON with the service, the contract version and where openapi.json is', async () => {
    const res = await app.handle(get('/'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['x-request-id']).toBe('req-1');
    expect(JSON.parse(res.body)).toEqual({
      status: 'ok',
      service: 'Travis County property intelligence API',
      version: '1.0.0',
      openapi: '/v1/openapi.json',
      request_id: 'req-1',
    });
  });
  it('stays out of the contract, and other unknown paths still answer 404', async () => {
    expect(ENDPOINTS.some((e) => e.path === '/')).toBe(false);
    expect(Object.keys(JSON.parse(OPENAPI_JSON).paths)).not.toContain('/');
    const nf = await app.handle(get('/v1/nothing'));
    expect(nf.statusCode).toBe(404);
    expect(JSON.parse(nf.body)).toEqual({ error: 'not_found', request_id: 'req-1' });
  });
});

// The HTTP API's `$default` route also catches CORS preflights, so they reach this app; API Gateway adds the configured
// CORS headers to its answer, but the browser rejects a preflight whose status is not 2xx (the Agent tab's POST, live).
describe('CORS preflight', () => {
  const app = new App({
    queries: () => Promise.reject(new Error('a preflight must not open the query layer')),
  });
  it.each(['/v1/agent/chat', '/v1/mcp', '/v1/meta', '/v1/nothing'])(
    'answers OPTIONS %s with 204 and no body',
    async (path) => {
      const res = await app.handle({ ...get(path), method: 'OPTIONS' });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(res.headers['x-request-id']).toBe('req-1');
    },
  );
});
