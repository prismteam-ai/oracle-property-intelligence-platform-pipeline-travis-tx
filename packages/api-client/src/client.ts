import { ENDPOINTS } from '@travis/contract';
import type {
  Contractor,
  Endpoint,
  Meta,
  PermitDetail,
  PermitSummary,
  PropertyDetail,
  PropertySummary,
  Run,
} from '@travis/contract';
import { ApiError, ContractViolation } from './errors.js';

export type QueryValue =
  string | number | boolean | readonly (string | number)[] | undefined | null;
export type Query = Record<string, QueryValue>;

/** Waits before retry n (0-based) after a 429: 1 s, 2 s, 4 s. */
export const BACKOFF_MS = [1000, 2000, 4000] as const;

export interface ClientOptions {
  /** API base, e.g. the `$default` execute-api URL (`VITE_API_URL`). Empty string means same-origin. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Injected for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each back-off wait. */
  onRateLimited?: (attempt: number, waitMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function operation(operationId: string): Endpoint {
  const found = ENDPOINTS.find((e) => e.operationId === operationId);
  if (!found) throw new Error(`unknown operation ${operationId}`);
  return found;
}

/** Fills `{name}` path templates with URL-encoded values (permit ids contain a space). */
export function fillPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
}

/** Lists are comma-separated on REST; undefined and null are omitted. */
export function toSearch(query: Query | undefined): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

type Json = Record<string, unknown>;

export interface PageResponse<T> {
  items: T[];
  total: number;
  next_cursor: string | null;
  area_note: string | null;
}
export interface SearchCenterItem {
  name: string;
  kind: 'city' | 'zip';
  match_type: 'exact' | 'prefix' | 'alias';
  lat: number;
  lon: number;
  parcel_count: number;
  basis: string;
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? defaultSleep;
  const base = options.baseUrl.replace(/\/+$/, '');

  async function send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await doFetch(url, init);
      if (response.status !== 429 || attempt >= BACKOFF_MS.length) return response;
      const wait = BACKOFF_MS[attempt] as number;
      options.onRateLimited?.(attempt + 1, wait);
      await sleep(wait);
    }
  }

  async function failure(response: Response): Promise<ApiError> {
    const text = await response.text().catch(() => '');
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* gateway-generated bodies can be plain text */
    }
    const record = (typeof body === 'object' && body !== null ? body : {}) as Json;
    const code =
      typeof record.error === 'string'
        ? record.error
        : response.status === 429
          ? 'rate_limited'
          : typeof record.message === 'string'
            ? record.message
            : null;
    const detail =
      typeof record.detail === 'string'
        ? record.detail
        : typeof record.reason === 'string'
          ? record.reason
          : null;
    return new ApiError({
      status: response.status,
      code,
      detail,
      requestId:
        (typeof record.request_id === 'string' ? record.request_id : null) ??
        response.headers.get('x-request-id') ??
        response.headers.get('apigw-requestid'),
      body,
    });
  }

  /** Calls one `ENDPOINTS` operation and validates the body with that endpoint's Zod response schema. */
  async function call<T = unknown>(
    operationId: string,
    args: { path?: Record<string, string>; query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const endpoint = operation(operationId);
    const url = `${base}${fillPath(endpoint.path, args.path)}${toSearch(args.query)}`;
    const request: RequestInit =
      endpoint.method === 'POST'
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(args.body ?? {}),
          }
        : { method: 'GET', headers: { accept: 'application/json' } };
    const response = await send(url, request);
    if (!response.ok) throw await failure(response);
    const data: unknown = await response.json();
    const parsed = endpoint.response.safeParse(data);
    if (!parsed.success) throw new ContractViolation(operationId, parsed.error.issues, data);
    return parsed.data as T;
  }

  /** MCP Streamable HTTP, stateless JSON: one JSON-RPC request per POST. */
  async function mcp(method: string, params?: Json, id: number | string = 1): Promise<Json> {
    const response = await send(`${base}/v1/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
    });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as Json;
  }

  const get = <T>(id: string, path?: Record<string, string>, query?: Query) =>
    call<T>(id, { path, query });

  return {
    baseUrl: base,
    call,
    mcp,
    getMeta: () => get<Meta>('getMeta'),
    searchCenters: (q: string) =>
      get<{ items: SearchCenterItem[] }>('searchCenters', undefined, { q }),
    searchProperties: (query: Query) =>
      get<PageResponse<PropertySummary>>('searchProperties', undefined, query),
    getPropertyByGeoId: (geoId: string) =>
      get<PropertyDetail>('getPropertyByGeoId', { geo_id: geoId }),
    getProperty: (propertyId: string) =>
      get<PropertyDetail>('getProperty', { property_id: propertyId }),
    searchPermits: (query: Query) =>
      get<PageResponse<PermitSummary>>('searchPermits', undefined, query),
    searchPermitText: (query: Query) =>
      get<PageResponse<PermitSummary>>('searchPermitText', undefined, query),
    getPermit: (permitId: string) => get<PermitDetail>('getPermit', { permit_id: permitId }),
    getContractor: (key: string) =>
      get<Contractor>('getContractor', { contractor_attribution_key: key }),
    searchBusinesses: (query: Query) => get<Json>('searchBusinesses', undefined, query),
    getBusiness: (id: string) => get<Json>('getBusiness', { business_record_id: id }),
    searchLicenses: (query: Query) => get<Json>('searchLicenses', undefined, query),
    getLicense: (id: string) => get<Json>('getLicense', { license_record_id: id }),
    listRuns: () => get<{ items: Run[] }>('listRuns'),
    getRunManifest: (runId: string) => get<Json>('getRunManifest', { run_id: runId }),
    getOpenApi: () => get<Json>('getOpenApi'),
    /** Chat is never retried on 5xx or 504 (only the 429 back-off applies). */
    agentChat: (body: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      session_id?: string;
    }) => call<Json>('agentChat', { body }),
    mcpToolsList: () => mcp('tools/list'),
    mcpToolsCall: (name: string, args: Json) => mcp('tools/call', { name, arguments: args }),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
