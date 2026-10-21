import { describe, expect, it } from 'vitest';
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { Meta } from '@travis/contract';
import type { Queries } from '@travis/query';
import { applyBedrockPromptCaching } from '../src/chat/bedrock-prompt-cache.js';
import { checkCitations } from '../src/chat/citations.js';
import { EvidenceCollector, turnAssumptions, turnLimitations } from '../src/chat/evidence.js';
import {
  CircuitBreaker,
  DeadlineError,
  OutputBudgetError,
  TurnBudget,
  classifyBedrockError,
} from '../src/chat/governor.js';
import { CoordinateGuard } from '../src/chat/guard.js';
import {
  clearPersonValues,
  hidePersonFields,
  registerPersonValues,
} from '../src/chat/langsmith.js';
import { asksPersonal, centerGuidance, projectToolResult } from '../src/chat/projection.js';
import { PROMPT_VERSION, parseFinalMessage } from '../src/chat/prompt.js';
import { CHAT_LIMITS, parseChatRequest } from '../src/chat/request.js';
import { sanitizeText } from '../src/chat/sanitize.js';
import { runTurn, type TurnDeps } from '../src/chat/turn.js';
import { cachedFlag, createChatHandler, logParams } from '../src/handlers/chat.js';
import { ChatResponse } from '@travis/contract';
import { sanitizeAnswer } from '../src/chat/answer.js';
import { langSmithLoader, registerHistory } from '../src/chat/langsmith.js';
import { stripStateSuffix } from '../src/chat/tools.js';
import { within } from '../src/handlers/chat.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- fixtures ----------------------------------------------------------------------------------------------------------
const RUN = '20261018T143520Z-t5-full';
const CID = (n: number) =>
  `bagu${'q'.repeat(50)}${String(n).padStart(6, 'a').replace(/\d/g, 'a')}${'abcdefghij'[n]}`;
const source = (id: string) => ({
  dataset: 'tcad-2026-certified-appraisal-export',
  record_id: id,
  url: 'https://traviscad.org/export.zip',
  fetched_at: '2026-10-16T18:22:43.623Z',
  run_id: RUN,
  request_identifier: id,
  source_http_request: {
    method: 'GET',
    url: 'https://traviscad.org/export.zip',
    multiValueQueryString: {},
  },
});
const unpublished = {
  dataset: 'x',
  url: 'https://x',
  fetched_at: 't',
  source_http_request: { method: 'GET', url: 'https://x', multiValueQueryString: {} },
  row_sha256: 'h',
  evidence_state: 'confirmed_present',
  fields: ['geo_id'],
};
const property = (id: string, n: number) => ({
  property_id: id,
  geo_id: 'G' + id,
  address: { line1: `${n} MAIN ST`, city: 'AUSTIN', zip: '78704' },
  roof_age_years: 20 + n,
  roof_age_basis: 'year_built',
  roof_age_confidence: 'low',
  roof_age_caveats: [],
  record_cid: CID(n),
  property_cid: CID(n + 1),
  data_group_cid: CID(n + 2),
  source: source(id),
  unpublished_source: unpublished,
  distance_miles: n / 10,
  match_reasons: ['aged_roof'],
});
const permit = (id: string, propertyId: string, contractor: string | null, n: number) => ({
  permit_id: id,
  property_id: propertyId,
  description: 'Re-roof\u200b residence\u202e',
  status_group: n === 9 ? 'needs_review' : 'open',
  roof_work_class: 'primary_roof_replacement',
  open_duration_as_of: '2026-10-20',
  contractor: contractor
    ? {
        contractor_attribution_key: contractor,
        company_name: 'ACME ROOFING',
        printed_name: 'J DOE',
        trade: 'GC',
        phone: '5125550100',
      }
    : null,
  bbb: { status: 'blocked' },
  record_cid: CID(n),
  property_cid: CID(n + 1),
  data_group_cid: CID(n + 2),
  source: { ...source(id), url: `https://abc.austintexas.gov/${n}` },
  unpublished_source: unpublished,
});
const AUSTIN = {
  name: 'AUSTIN',
  kind: 'city',
  match_type: 'exact',
  lat: 30.291378194234046,
  lon: -97.77740571657456,
  parcel_count: 129473,
  basis: 'centroid of 124,832 parcels with situs city AUSTIN',
};
const META = {
  county: 'Travis County, TX',
  fips: '48453',
  run: { run_id: RUN },
  manifest_cid: 'bafybeimanifest' + 'a'.repeat(45),
  deploy: { deploy_id: 'e17c90aa0b91ccae' },
  groups: {},
  counts: {
    properties: 441939,
    with_roof_age: 390212,
    permits_joined_to_property: 1986484,
    roofing_permits: 196002,
    open_roofing_permits: 4365,
    stalled_roofing_permits: 6377,
    roofing_permits_needs_review: 5683,
    permits_needs_review: 445,
    permit_contractor_attributions: 52773,
    business_records: 400661,
    license_records: 30529,
  },
  limitations: [
    {
      source: 'bbb.org',
      availability: 'unsupported',
      source_access_status: 'blocked',
      incomplete_reason: 'http_403_source_block',
      detail: 'BBB blocked',
      evidence: null,
      records_request: null,
    },
    {
      source: 'roof-age',
      availability: 'supported_partial',
      source_access_status: 'available',
      incomplete_reason: 'partial_history',
      detail: 'partial',
      evidence: null,
      records_request: null,
    },
    {
      source: 'austin',
      availability: 'supported_partial',
      source_access_status: 'available',
      incomplete_reason: 'no_contractor_printed',
      detail: 'no contractor',
      evidence: null,
      records_request: null,
    },
  ],
} as unknown as Meta;

// ---- sanitizer ---------------------------------------------------------------------------------------------------------
describe('sanitizer', () => {
  it('turns controls into spaces and removes zero-width and bidi characters', () => {
    expect(sanitizeText('a\nb\tc\u0007d')).toBe('a b c d');
    expect(sanitizeText('re\u200broof\u202e evil\u2066x\u2069\ufeff')).toBe('reroof evilx');
  });
  it('caps tool text at 1,000 characters', () => {
    const s = sanitizeText('x'.repeat(5000));
    expect(s.length).toBe(1000);
    expect(s.endsWith('…')).toBe(true);
  });
});

// ---- request validation ------------------------------------------------------------------------------------------------
describe('chat request validation', () => {
  const ok = (messages: unknown, extra: Record<string, unknown> = {}) =>
    parseChatRequest(JSON.stringify({ messages, ...extra }));
  it('accepts a valid conversation and session id', () => {
    const r = ok(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yes' },
        { role: 'user', content: 'go' },
      ],
      {
        session_id: 'abc_DEF-123',
      },
    );
    expect(r).toMatchObject({ ok: true, sessionId: 'abc_DEF-123' });
  });
  it('answers 400 for structural errors', () => {
    for (const [body, detail] of [
      [null, 'JSON object'],
      ['{not json', 'not valid JSON'],
      [JSON.stringify({ messages: [] }), 'at least one'],
      [JSON.stringify({ messages: [{ role: 'system', content: 'x' }] }), 'role'],
      [
        JSON.stringify({
          messages: [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
          ],
        }),
        'last message',
      ],
      [JSON.stringify({ messages: [{ role: 'user', content: 1 }] }), 'content'],
      [
        JSON.stringify({ messages: [{ role: 'user', content: 'a' }], session_id: 'has space' }),
        'session_id',
      ],
      [
        JSON.stringify({ messages: [{ role: 'user', content: 'a' }], session_id: 'x'.repeat(65) }),
        'session_id',
      ],
    ] as const) {
      const r = parseChatRequest(body);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toBe('invalid_params');
        expect(r.detail).toContain(detail);
      }
    }
  });
  it('answers 413 above 20 messages, 4,000 characters per message or 16,000 in total', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: 'x',
    }));
    const long = [{ role: 'user', content: 'x'.repeat(CHAT_LIMITS.messageChars + 1) }];
    const total = Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(3500) }));
    for (const m of [many, long, total]) {
      const r = ok(m);
      expect(r).toMatchObject({ ok: false, status: 413, error: 'request_too_large' });
    }
  });
});

// ---- coordinate guard --------------------------------------------------------------------------------------------------
describe('lat/lon guard', () => {
  it('allows a returned center (rounded to four decimals) and typed coordinates, rejects anything else', () => {
    const g = new CoordinateGuard(['within a mile of 30.2672, -97.7431 please']);
    expect(g.check(30.2914, -97.7774).ok).toBe(false);
    g.addCenters([AUSTIN]);
    expect(g.check(AUSTIN.lat, AUSTIN.lon)).toMatchObject({ ok: true, center: { name: 'AUSTIN' } });
    expect(g.check(30.2914, -97.7774)).toMatchObject({ ok: true });
    expect(g.check(30.2672, -97.7431)).toEqual({ ok: true, center: null });
    expect(g.check(30.27, -97.74).ok).toBe(false);
    expect(g.check(30.2672, undefined).ok).toBe(false);
    expect(g.check(undefined, undefined)).toEqual({ ok: true, center: null });
  });
  it('rejects a center that came back only as a prefix or alias match', () => {
    const g = new CoordinateGuard([]);
    g.addCenters([{ ...AUSTIN, match_type: 'alias' }]);
    const r = g.check(AUSTIN.lat, AUSTIN.lon);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/^unconfirmed_search_center/);
    g.addCenters([AUSTIN]);
    expect(g.check(AUSTIN.lat, AUSTIN.lon).ok).toBe(true);
  });
  it('tells the model when to ask', () => {
    expect(centerGuidance([])).toMatch(/out_of_county/);
    expect(centerGuidance([{ ...AUSTIN, match_type: 'alias' }])).toMatch(/needs_clarification/);
    expect(
      centerGuidance([
        { ...AUSTIN, name: 'WEST LAKE', parcel_count: 3 },
        { ...AUSTIN, name: 'WEST LAKE HILLS', match_type: 'prefix', parcel_count: 678 },
      ]),
    ).toMatch(/ask which one/);
    expect(centerGuidance([AUSTIN])).toMatch(/^Use AUSTIN/);
  });
});

// ---- evidence, citations, limitations, assumptions -----------------------------------------------------------------------
function collector() {
  const c = new EvidenceCollector(RUN);
  c.add('resolve_search_center', 'c1', { items: [AUSTIN] });
  c.add('search_properties', 'c2', { total: 2, items: [property('100', 1), property('200', 2)] });
  c.add('search_permits', 'c3', {
    total: 3,
    items: [
      permit('2026-1 BP', '300', 'k1', 3),
      permit('2026-2 BP', '100', null, 4),
      permit('2026-3 BP', '100', 'k1', 9),
    ],
  });
  return c;
}

describe('evidence builder', () => {
  it('builds evidence from tool results only, once per record, with sources and CIDs', () => {
    const c = collector();
    const idOf = (e: any) =>
      ({ property: e.property_id, permit: e.permit_id, contractor: e.contractor_attribution_key })[
        e.kind as string
      ] ?? '';
    expect(c.items.map((e) => `${e.kind}:${idOf(e)}`)).toEqual([
      'search_center:',
      'property:100',
      'property:200',
      'permit:2026-1 BP',
      'contractor:k1',
      'permit:2026-2 BP',
      'permit:2026-3 BP',
    ]);
    const p = c.items.find((e) => e.property_id === '100' && e.kind === 'property')!;
    expect(p).toMatchObject({
      tool_call_id: 'c2',
      record_cid: CID(1),
      source: { record_id: '100' },
    });
    expect(c.items.find((e) => e.kind === 'search_center')).toMatchObject({
      record_cid: null,
      source: {},
    });
    const k = c.items.find((e) => e.kind === 'contractor')!;
    expect(k).toMatchObject({ permit_id: '2026-1 BP', record_cid: null });
    c.add('search_properties', 'c9', { total: 1, items: [property('100', 1)] });
    expect(c.items.filter((e) => e.property_id === '100' && e.kind === 'property')).toHaveLength(1);
  });
  it('adds business and license candidates and the current run', () => {
    const c = new EvidenceCollector(RUN);
    c.add('get_contractor', 'c1', {
      contractor_attribution_key: 'k1',
      registry_candidates: [{ business_record_id: 'b1', unpublished_source: unpublished }],
      license_candidates: [{ license_record_id: 'l1', unpublished_source: unpublished }],
    });
    c.add('get_run_summary', 'c2', {
      meta: { run: { run_id: RUN }, manifest_cid: META.manifest_cid, groups: {} },
      runs: [],
    });
    expect(c.items.map((e) => e.kind)).toEqual(['contractor', 'business', 'license', 'run']);
    expect(c.has('business', 'b1') && c.has('license', 'l1') && c.has('run', RUN)).toBe(true);
    expect(c.items.find((e) => e.kind === 'business')).toMatchObject({
      record_cid: null,
      unpublished_source: unpublished,
    });
    expect(c.cids.has(META.manifest_cid)).toBe(true);
  });
  it('adds the typed limitations and the server assumptions', () => {
    const c = collector();
    const reasons = turnLimitations(META, c).map((l) => l.incomplete_reason);
    expect(reasons).toEqual([
      'http_403_source_block',
      'needs_review',
      'no_contractor_printed',
      'partial_history',
    ]);
    expect(
      turnLimitations(META, c).find((l) => l.incomplete_reason === 'needs_review')!.detail,
    ).toMatch(/^1 of the 3 permits/);
    const a = turnAssumptions(c, [AUSTIN]);
    // both counts, so the parcel count the model quotes (129,473) and the centroid's (124,832) read as one statement
    expect(a[0]).toBe(
      'Search center AUSTIN (city, exact match): 129,473 parcels; centroid of 124,832 parcels with situs city AUSTIN (those with coordinates); distances are measured from that centroid.',
    );
    expect(a).toContain(
      'Contractors are the listed contractor as printed on the permit, not a verified identity.',
    );
    expect(a).toContain('Open durations are computed as of 2026-10-20.');
    expect(turnLimitations(META, new EvidenceCollector(RUN))).toEqual([]);
  });
});

describe('citation check', () => {
  it('accepts ids a tool returned in this turn, including a permit’s property', () => {
    const r = checkCitations(
      `See [[property:100]], [[permit:2026-1 BP]] on [[property:300]] by [[contractor:k1]]; record ${CID(1)}.`,
      collector(),
    );
    expect(r).toMatchObject({ ok: true });
    expect(r.cited).toHaveLength(4);
  });
  it('fails closed on an id no tool returned, an unknown kind, a malformed token or a foreign CID', () => {
    const c = collector();
    for (const text of [
      '[[property:999]]',
      '[[search_center:AUSTIN]]',
      '[[property 100]]',
      '[[property:802 BARTON BLVD, AUSTIN]]',
      `cid ${CID(7)}`,
      '[[run:' + RUN + ']]',
    ])
      expect(checkCitations(text, c).ok, text).toBe(false);
  });
});

// ---- projection and personal data ---------------------------------------------------------------------------------------
describe('projection', () => {
  const detail = {
    ...property('100', 1),
    owner: {
      owner_name: 'SMITH JANE',
      mailing_address: { line1: '1 PO BOX', city: 'AUSTIN', state: 'TX', zip: '78701' },
      deed_date: '1990-01-01',
      owner_tenure_years: 36,
    },
    permits: [permit('2026-1 BP', '100', 'k1', 3)],
    permits_total: 1,
    permits_truncated: false,
  };
  it('keeps ids, CIDs, signals and source.url, drops source_http_request and unpublished_source', () => {
    const v = JSON.stringify(projectToolResult('get_property', detail, { personal: false }));
    expect(v).toContain(CID(1));
    expect(v).toContain('https://traviscad.org/export.zip');
    expect(v).not.toContain('source_http_request');
    expect(v).not.toContain('row_sha256');
    expect(v).toContain('Re-roof residence');
    expect(v).not.toMatch(/[\u200b\u202e]/);
  });
  it('omits owner and contact fields unless the question asks about ownership or contact', () => {
    const hidden = JSON.stringify(projectToolResult('get_property', detail, { personal: false }));
    for (const f of ['SMITH JANE', 'PO BOX', '5125550100']) expect(hidden).not.toContain(f);
    const shown = JSON.stringify(projectToolResult('get_property', detail, { personal: true }));
    for (const f of ['SMITH JANE', 'PO BOX', '5125550100']) expect(shown).toContain(f);
    expect(asksPersonal('Who owns property 103857?')).toBe(true);
    expect(asksPersonal('How can I contact the contractor?')).toBe(true);
    expect(asksPersonal('Which properties have roofs older than 15 years?')).toBe(false);
    expect(asksPersonal('Properties with absentee owners')).toBe(true);
  });
  it('gives a shared source URL once per page and drops null fields', () => {
    const v = projectToolResult(
      'search_properties',
      {
        total: 2,
        items: [{ ...property('1', 1), year_built: null }, property('2', 2)],
        next_cursor: 'x',
        area_note: null,
      },
      { personal: false },
    ) as any;
    expect(v).toMatchObject({
      total: 2,
      returned: 2,
      has_more: true,
      source_url: 'https://traviscad.org/export.zip',
    });
    expect(v.items[0]).not.toHaveProperty('source_url');
    expect(v.items[0]).not.toHaveProperty('year_built');
  });
  it('hides person fields in traces, in objects and in JSON text', () => {
    const v = hidePersonFields({
      a: { owner_name: 'SMITH', mailing_address: { line1: 'x' }, phone: '512' },
      b: ['{"owner_name":"SMITH JANE","phone":"512","x":1}'],
      c: { contractor_attribution_key: 'k', address: '1 MAIN' },
      d: { address: '802 BARTON BLVD' },
    });
    expect(JSON.stringify(v)).not.toMatch(/SMITH|512|1 MAIN/);
    expect(JSON.stringify(v)).toContain('802 BARTON BLVD');
    registerPersonValues(['BRAND JAMES', null, 'ab']);
    expect(hidePersonFields({ answer: 'The owner is BRAND JAMES (as printed).' })).toEqual({
      answer: 'The owner is [hidden] (as printed).',
    });
    clearPersonValues();
    expect(hidePersonFields('BRAND JAMES')).toBe('BRAND JAMES');
  });
});

// ---- prompt parsing, caching, logging ------------------------------------------------------------------------------------
describe('final message', () => {
  it('reads the outcome and assumptions and drops a preamble', () => {
    expect(
      parseFinalMessage(
        'Intro text.\n\nOUTCOME: answered\nASSUMPTION: many years = 5\nASSUMPTION:\n---\n\nBody [[property:1]].',
      ),
    ).toEqual({
      outcome: 'answered',
      assumptions: ['many years = 5'],
      answer: 'Body [[property:1]].',
    });
    expect(parseFinalMessage('**OUTCOME:** `needs_clarification`\n\nWhich one?').outcome).toBe(
      'needs_clarification',
    );
    expect(parseFinalMessage('No header here.')).toEqual({
      outcome: null,
      assumptions: [],
      answer: 'No header here.',
    });
    expect(PROMPT_VERSION).toMatch(/^staraptor-agent\.prompt\./);
  });
  it('marks the first system message and the last non-system message for Bedrock caching', () => {
    const prompt = [
      { role: 'system', content: 's' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'q' }],
        providerOptions: { bedrock: { x: 1 }, other: { y: 2 } },
      },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ] as any;
    const r = applyBedrockPromptCaching(prompt);
    expect(r.cachePointsAdded).toBe(2);
    expect(r.prompt[0]!.providerOptions).toEqual({ bedrock: { cachePoint: { type: 'default' } } });
    expect(r.prompt[1]!.providerOptions).toEqual({ bedrock: { x: 1 }, other: { y: 2 } });
    expect(r.prompt[2]!.providerOptions).toEqual({ bedrock: { cachePoint: { type: 'default' } } });
  });
  it('logs free-text parameters as hashes', () => {
    const p = logParams({ q: 'Michael Mann', lat: 30.1, permit_id: '2026-1 BP' });
    expect(p.q).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(p).toMatchObject({ lat: 30.1, permit_id: '2026-1 BP' });
  });
});

// ---- deadline, retry, output budget, circuit breaker --------------------------------------------------------------------
const usage = (out: number) => ({
  inputTokens: { total: 1000, noCache: 400, cacheRead: 500, cacheWrite: 100 },
  outputTokens: { total: out, text: out, reasoning: 0 },
});
const text = (t: string, out = 50) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: 'end_turn' },
  usage: usage(out),
  warnings: [],
});
const toolCall = (id: string, name: string, input: unknown) => ({
  content: [
    { type: 'tool-call' as const, toolCallId: id, toolName: name, input: JSON.stringify(input) },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
  usage: usage(60),
  warnings: [],
});
const callOpts = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] } as any;

describe('turn budget', () => {
  it('refuses to start a step with less than the minimum time left (the deadline counts from receipt)', async () => {
    let t = 0;
    const b = new TurnBudget({
      deadlineAt: 10_000,
      maxOutputTokens: 1500,
      stepOutputTokens: 600,
      now: () => t,
    });
    const m = b.wrap(new MockLanguageModelV4({ doGenerate: text('x') }) as any) as any;
    t = 9000;
    await expect(m.doGenerate(callOpts)).rejects.toBeInstanceOf(DeadlineError);
  });
  it('caps each step at the remaining output budget and stops when it is used up', async () => {
    const seen: number[] = [];
    const b = new TurnBudget({
      deadlineAt: Date.now() + 60_000,
      maxOutputTokens: 1000,
      stepOutputTokens: 600,
    });
    const m = b.wrap(
      new MockLanguageModelV4({
        doGenerate: async (o: any) => {
          seen.push(o.maxOutputTokens);
          return text('x', 500);
        },
      }) as any,
    ) as any;
    await m.doGenerate(callOpts);
    await m.doGenerate(callOpts);
    await expect(m.doGenerate(callOpts)).rejects.toBeInstanceOf(OutputBudgetError);
    expect(seen).toEqual([600, 500]);
    expect(b.totals()).toMatchObject({ steps: 2, outputTokens: 1000, cacheReadTokens: 1000 });
  });
  it('retries once on throttling, never on access denial', async () => {
    const throttle = Object.assign(new Error('ThrottlingException: Too many requests'), {
      statusCode: 429,
    });
    const denied = Object.assign(
      new Error('AccessDeniedException: not available for this account'),
      { statusCode: 403 },
    );
    for (const [err, calls, retries] of [
      [throttle, 2, 1],
      [denied, 1, 0],
    ] as const) {
      let n = 0;
      const b = new TurnBudget({
        deadlineAt: Date.now() + 60_000,
        maxOutputTokens: 1500,
        stepOutputTokens: 600,
        sleep: async () => {},
      });
      const m = b.wrap(
        new MockLanguageModelV4({
          doGenerate: async () => {
            n++;
            throw err;
          },
        }) as any,
      ) as any;
      await expect(m.doGenerate(callOpts)).rejects.toBe(err);
      expect([n, b.retries]).toEqual([calls, retries]);
    }
    expect(classifyBedrockError(denied)).toBe('denied');
    expect(classifyBedrockError(throttle)).toBe('throttled');
    expect(classifyBedrockError(Object.assign(new Error('x'), { statusCode: 503 }))).toBe(
      'server_error',
    );
  });
  it('opens the circuit after three failed turns, then lets one probe through', () => {
    let t = 0;
    const c = new CircuitBreaker(3, 30_000, () => t);
    c.failure();
    c.failure();
    expect(c.allow()).toBe(true);
    c.failure();
    expect(c.allow()).toBe(false);
    t = 31_000;
    expect(c.allow()).toBe(true);
    expect(c.allow()).toBe(false);
    c.success();
    expect(c.allow()).toBe(true);
  });
});

// ---- the turn, end to end with a scripted model ---------------------------------------------------------------------------
const stubQueries = {
  getMeta: async () => META,
  searchCenters: async () => ({ items: [AUSTIN] }),
  searchProperties: async () => ({
    total: 2,
    items: [property('100', 1), property('200', 2)],
    next_cursor: null,
    area_note: null,
  }),
  searchPermits: async () => ({ total: 0, items: [], next_cursor: null, area_note: null }),
} as unknown as Queries;

function deps(steps: any[], extra: Partial<TurnDeps> = {}): TurnDeps {
  return {
    queries: async () => stubQueries,
    meta: async () => META,
    model: new MockLanguageModelV4({ doGenerate: steps }) as any,
    modelId: 'us.anthropic.claude-sonnet-4-6',
    langsmith: {
      tracingEnabled: false,
      ToolLoopAgent,
      providerOptions: () => ({}),
      flush: async () => {},
    },
    limits: { maxOutputTokens: 1500, turnDeadlineSeconds: 25 },
    ...extra,
  };
}
const input = (
  q = 'Which properties within five miles of Austin have roofs older than 15 years?',
) => ({
  messages: [{ role: 'user' as const, content: q }],
  sessionId: 's1',
  requestId: 'rid-1',
  receivedAt: Date.now(),
});
const searchArgs = {
  lat: AUSTIN.lat,
  lon: AUSTIN.lon,
  radius_miles: 5,
  roof_age_min: 15,
  open_permits: false,
};

describe('runTurn', () => {
  it('answers with evidence from the tools, server assumptions and limitations', async () => {
    const r = await runTurn(
      deps([
        toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
        toolCall('t2', 'search_properties', searchArgs),
        text(
          'OUTCOME: answered\nASSUMPTION: radius 5 mi\n\nTwo match: [[property:100]] and [[property:200]].',
        ),
      ]),
      input(),
    );
    expect(r.kind).toBe('response');
    if (r.kind !== 'response') return;
    expect(r.body).toMatchObject({
      outcome: 'answered',
      answer: 'Two match: [[property:100]] and [[property:200]].',
      run_id: RUN,
      manifest_cid: META.manifest_cid,
      model_id: 'us.anthropic.claude-sonnet-4-6',
      prompt_version: PROMPT_VERSION,
      request_id: 'rid-1',
    });
    expect(r.body.tool_calls.map((c) => [c.name, c.status, c.total, c.returned])).toEqual([
      ['resolve_search_center', 'ok', 1, 1],
      ['search_properties', 'ok', 2, 2],
    ]);
    expect(r.body.evidence.map((e) => e.kind)).toEqual(['search_center', 'property', 'property']);
    expect(r.body.assumptions[0]).toBe('radius 5 mi');
    expect(r.body.assumptions[1]).toContain('AUSTIN');
    expect(r.body.limitations.map((l) => l.incomplete_reason)).toEqual(['partial_history']);
    expect(r.stats).toMatchObject({ steps: 3, tool_calls: 2, cited: 2, citation_failures: 0 });
  });
  it('fails closed when the answer cites an id no tool returned, even after the one repair', async () => {
    const r = await runTurn(
      deps([
        toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
        text('OUTCOME: answered\n\nSee [[property:103857]].'),
        text('OUTCOME: answered\n\nSee [[property:103858]].'),
      ]),
      input(),
    );
    expect(r.kind === 'response' && r.body).toMatchObject({ outcome: 'tool_error', answer: '' });
    expect(r.stats).toMatchObject({ citation_failures: 1, citation_repairs: 1 });
  });
  it('one repair round fixes an id the model mistyped (the live alias-westlake miss)', async () => {
    const r = await runTurn(
      deps([
        toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
        toolCall('t2', 'search_properties', searchArgs),
        text('OUTCOME: answered\n\nOne match: [[property:104]] — 701 Newman Dr.'),
        text('OUTCOME: answered\n\nOne match: [[property:100]] — 701 Newman Dr.'),
      ]),
      input(),
    );
    expect(r.kind === 'response' && r.body).toMatchObject({
      outcome: 'answered',
      answer: 'One match: [[property:100]] — 701 Newman Dr.',
    });
    expect(r.stats).toMatchObject({ cited: 1, citation_failures: 1, citation_repairs: 1 });
  });
  it('a year after "property" is not read as a property id', () => {
    expect(checkCitations('This property 1967 roof is old.', new EvidenceCollector('r')).ok).toBe(
      true,
    );
    expect(checkCitations('See property 103857.', new EvidenceCollector('r')).ok).toBe(false);
  });
  it('never answers "answered" without a successful tool call', async () => {
    const r = await runTurn(
      deps([text('OUTCOME: answered\n\nThere are many old roofs.')]),
      input(),
    );
    expect(r.kind === 'response' && r.body.outcome).toBe('tool_error');
    const ok = await runTurn(
      deps([text('OUTCOME: out_of_scope\n\nI answer questions about this dataset.')]),
      input('A poem?'),
    );
    expect(ok.kind === 'response' && ok.body.outcome).toBe('out_of_scope');
  });
  it('rejects a search around coordinates resolve_search_center did not return', async () => {
    const r = await runTurn(
      deps([
        toolCall('t1', 'search_properties', { ...searchArgs, lat: 30.27, lon: -97.74 }),
        text('OUTCOME: needs_clarification\n\nWhich place did you mean?'),
      ]),
      input(),
    );
    if (r.kind !== 'response') throw new Error('expected a response');
    expect(r.body.tool_calls[0]).toMatchObject({ status: 'error' });
    expect(r.body.tool_calls[0]!.result_summary).toMatch(/^coordinates_not_allowed/);
    expect(r.body.evidence).toEqual([]);
  });
  it('answers limit_reached with the evidence so far at the deadline', async () => {
    const r = await runTurn(
      deps(
        [
          toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
          text('OUTCOME: answered\n\nlate'),
        ],
        {
          // the deadline is 25 s from receipt; the request arrived 22.5 s ago, so the second step cannot start
          now: (() => {
            let first = true;
            return () => {
              const t = Date.now() + (first ? 0 : 22_500);
              first = false;
              return t;
            };
          })(),
        },
      ),
      { ...input(), receivedAt: Date.now() },
    );
    if (r.kind !== 'response') throw new Error('expected a response');
    expect(r.body.outcome).toBe('limit_reached');
    expect(r.stats.deadline_hit).toBe(true);
  });
  it('reports model_unavailable on Bedrock access denial', async () => {
    const denied = Object.assign(
      new Error('AccessDeniedException: not available for this account'),
      { statusCode: 403 },
    );
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw denied;
      },
    });
    const r = await runTurn(deps([], { model: model as any }), input());
    expect(r.kind).toBe('model_unavailable');
  });
});

// ---- the handler -------------------------------------------------------------------------------------------------------
const event = (body: unknown, requestId = 'rid-1'): APIGatewayProxyEventV2 =>
  ({
    requestContext: { requestId, http: { method: 'POST' }, timeEpoch: Date.now() },
    headers: {},
    rawPath: '/v1/agent/chat',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as APIGatewayProxyEventV2;

function handler(
  flag = 'false',
  steps: any[] = [text('OUTCOME: out_of_scope\n\nOnly this dataset.')],
) {
  let primes = 0;
  const h = createChatHandler({
    readFlag: async () => flag,
    queries: async () => {
      primes++;
      return stubQueries;
    },
    langsmith: async () => ({
      tracingEnabled: false,
      ToolLoopAgent,
      providerOptions: () => ({}),
      flush: async () => {},
    }),
    model: new MockLanguageModelV4({ doGenerate: steps }) as any,
    modelId: 'us.anthropic.claude-sonnet-4-6',
    limits: () => ({ chat: { max_output_tokens: 1500, turn_deadline_seconds: 25 } }) as any,
  });
  return { h, primes: () => primes };
}

describe('chat handler', () => {
  it('answers 400 and 413 with the contract body and x-request-id', async () => {
    const { h } = handler();
    const r400 = (await h(event({ messages: [] }))) as any;
    expect(r400.statusCode).toBe(400);
    expect(r400.headers['x-request-id']).toBe('rid-1');
    expect(JSON.parse(r400.body)).toMatchObject({ error: 'invalid_params', request_id: 'rid-1' });
    const r413 = (await h(
      event({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }),
    )) as any;
    expect(r413.statusCode).toBe(413);
    expect(JSON.parse(r413.body)).toMatchObject({
      error: 'request_too_large',
      request_id: 'rid-1',
    });
  });
  it('answers 503 budget_exhausted while the kill switch is set, without a model call', async () => {
    const { h } = handler('true');
    const r = (await h(event({ messages: [{ role: 'user', content: 'hi' }] }, 'rid-2'))) as any;
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body)).toEqual({
      error: 'agent_unavailable',
      reason: 'budget_exhausted',
      request_id: 'rid-2',
    });
  });
  it('answers a turn with the contract fields', async () => {
    const { h } = handler();
    const r = (await h(
      event({ messages: [{ role: 'user', content: 'Write a poem' }], session_id: 's-1' }),
    )) as any;
    expect(r.statusCode).toBe(200);
    expect(Object.keys(JSON.parse(r.body)).sort()).toEqual(
      [
        'answer',
        'assumptions',
        'evidence',
        'limitations',
        'manifest_cid',
        'model_id',
        'outcome',
        'prompt_version',
        'request_id',
        'run_id',
        'tool_calls',
      ].sort(),
    );
  });
  it('warms without a model call and primes once per instance; a rejected request primes too', async () => {
    const { h } = handler();
    expect(await h({ warm: { hold_ms: 0 } })).toEqual({ warmed: true, primed_now: true });
    expect(await h({ warm: {} as { hold_ms?: number } })).toEqual({
      warmed: true,
      primed_now: false,
    });
    const second = handler();
    await second.h(event({ messages: [] }));
    expect(second.primes()).toBe(1);
  });
  it('reads the kill-switch flag with a short cache and survives a failing read', async () => {
    let reads = 0;
    let t = 0;
    let value: string | Error = 'true';
    const f = cachedFlag(
      async () => {
        reads++;
        if (value instanceof Error) throw value;
        return value;
      },
      30_000,
      () => t,
    );
    expect(await f()).toBe('true');
    value = 'false';
    t = 10_000;
    expect(await f()).toBe('true');
    t = 40_000;
    expect(await f()).toBe('false');
    value = new Error('ssm down');
    t = 80_000;
    expect(await f()).toBe('false');
    expect(reads).toBe(3);
  });
});

// ---- the fix pass after the alakazam review (2026-10-20) ---------------------------------------------------------------
describe('review S1: ids outside the citation tokens', () => {
  const c2 = new EvidenceCollector(RUN);
  c2.add('search_permits', 'c1', {
    total: 1,
    items: [permit('2026-000001 BP', '300', 'a'.repeat(32), 1)],
  });
  it('accepts bare ids a tool returned in this turn', () => {
    expect(checkCitations(`permit 2026-000001 BP is open, by ${'a'.repeat(32)}`, c2).ok).toBe(true);
    expect(checkCitations('on property 300, see /v1/permits/2026-000001%20BP', c2).ok).toBe(true);
    expect(checkCitations('50,260 properties; open since 1981-10-23; 139 permits', c2).ok).toBe(
      true,
    );
  });
  it('fails closed on bare ids, keys, property mentions and API link paths no tool returned', () => {
    for (const bad of [
      'permit 1981-013092 BP has been open 45 years',
      'permit 1981-013092-BP',
      `listed contractor ${'b'.repeat(32)}`,
      'property 114347 again',
      'Property ID 114347',
      '[link](https://api.example/v1/permits/1981-013092%20BP)',
      `https://api.example/v1/contractors/${'c'.repeat(32)}`,
    ])
      expect(checkCitations(bad, c2).ok, bad).toBe(false);
  });
});

describe('review S2: the answer sanitizer', () => {
  const p = { apiHost: 'api.example' };
  it('removes HTML and images, keeps allowed links and only the text of the others', () => {
    const s = sanitizeAnswer(
      'A <img src=x onerror=alert(1)> b <script>x()</script> ![t](https://x.example/?d=SMITH) ![r][ref] ' +
        '[api](https://api.example/v1/properties/1) [gw](https://ipfs.filebase.io/ipfs/bafy) [ex](#/runs) ' +
        '[evil](https://evil.example/a) [js](javascript:alert(1)) <https://evil.example> https://evil.example/x ' +
        'https://gateway.pinata.cloud/ipfs/bafy\n[ref]: https://evil.example/r',
      p,
    );
    expect(s).not.toMatch(/<|>|!\[|evil\.|javascript|SMITH/);
    expect(s).toContain('[api](https://api.example/v1/properties/1)');
    expect(s).toContain('[gw](https://ipfs.filebase.io/ipfs/bafy)');
    expect(s).toContain('[ex](#/runs)');
    expect(s).toContain('https://gateway.pinata.cloud/ipfs/bafy');
    expect(s).toMatch(/ evil js/);
  });
  it('keeps citation tokens, lists and comparisons', () => {
    const t = 'Two match:\n\n- [[property:1]] roof 5 < 10 years\n- [[permit:2026-000001 BP]]';
    expect(sanitizeAnswer(t, p)).toBe(t);
  });
});

describe('state suffix in the agent place lookup', () => {
  it('drops a trailing Texas suffix only', () => {
    for (const [q, want] of [
      ['Pflugerville, TX', 'Pflugerville'],
      ['Austin TX', 'Austin'],
      ['austin, texas', 'austin'],
      ['Austin Texas', 'Austin'],
      ['Round Rock,TX.', 'Round Rock'],
      ['ATX', 'ATX'],
      ['TX', 'TX'],
      ['Texas', 'Texas'],
      ['78704', '78704'],
    ] as const)
      expect(stripStateSuffix(q), q).toBe(want);
  });
});

describe('review S4: the client history in traces', () => {
  it('hides every earlier message as a hash', () => {
    registerHistory(['Who owns property 103857?', 'The owner is BRAND JAMES RUTLAND.', 'ok']);
    const j = JSON.stringify(
      hidePersonFields({
        messages: [
          { role: 'user', content: 'Who owns property 103857?' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'The owner is BRAND JAMES RUTLAND.' }],
          },
          { role: 'user', content: 'And its roof?' },
        ],
      }),
    );
    expect(j).not.toMatch(/BRAND|Who owns/);
    expect(j).toMatch(/\[earlier message sha256:[0-9a-f]{16}\]/);
    expect(j).toContain('And its roof?');
    clearPersonValues();
    expect(hidePersonFields('Who owns property 103857?')).toBe('Who owns property 103857?');
  });
});

describe('review B1: model assumptions are model text', () => {
  it('checks the assumption lines with the answer and drops all model text on tool_error', async () => {
    const r = await runTurn(
      deps([
        toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
        toolCall('t2', 'search_properties', searchArgs),
        text(
          'OUTCOME: answered\nASSUMPTION: same homes as [[property:114347]] earlier\n\nSee [[property:100]].',
        ),
      ]),
      input(),
    );
    if (r.kind !== 'response') throw new Error('expected a response');
    expect(r.body.outcome).toBe('tool_error');
    expect(r.body.answer).toBe('');
    expect(r.body.assumptions.join(' ')).not.toContain('same homes');
    expect(r.body.assumptions.join(' ')).toContain('AUSTIN');
    const bare = await runTurn(
      deps([
        toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
        text(
          'OUTCOME: answered\nASSUMPTION: from the last turn\n\npermit 1981-013092 BP has been open 45 years.',
        ),
      ]),
      input(),
    );
    if (bare.kind !== 'response') throw new Error('expected a response');
    expect(bare.body).toMatchObject({ outcome: 'tool_error', answer: '' });
    expect(bare.body.assumptions.join(' ')).not.toContain('last turn');
  });
  it('strips HTML and images from the answer and the assumptions before returning', async () => {
    const r = await runTurn(
      deps([
        toolCall('t1', 'resolve_search_center', { q: 'Austin' }),
        toolCall('t2', 'search_properties', searchArgs),
        text(
          'OUTCOME: answered\nASSUMPTION: radius <b>5</b> mi\n\nSee [[property:100]] ![x](https://x.example/?d=1) <img src=x>.',
        ),
      ]),
      input(),
    );
    if (r.kind !== 'response') throw new Error('expected a response');
    expect(r.body.answer).toBe('See [[property:100]] .');
    expect(r.body.assumptions[0]).toBe('radius 5 mi');
  });
  it('drops a state suffix from the place name and says so', async () => {
    let asked = '';
    const q = {
      ...stubQueries,
      searchCenters: async (p: { q: string }) => ((asked = p.q), { items: [AUSTIN] }),
    } as unknown as Queries;
    const r = await runTurn(
      deps(
        [
          toolCall('t1', 'resolve_search_center', { q: 'Austin, TX' }),
          toolCall('t2', 'search_properties', searchArgs),
          text('OUTCOME: answered\n\nSee [[property:100]].'),
        ],
        { queries: async () => q },
      ),
      input('Which properties within 5 miles of Austin, TX have roofs older than 15 years?'),
    );
    expect(asked).toBe('Austin');
    if (r.kind !== 'response') throw new Error('expected a response');
    expect(r.body.outcome).toBe('answered');
    expect(r.body.assumptions[0]).toBe(
      'State suffix dropped from the place name: "Austin, TX" → "Austin" (search centers are Travis County names).',
    );
    expect(r.body.tool_calls[0]!.args).toMatchObject({ q: 'Austin, TX' });
  });
});

describe('review S3: the steps before the turn', () => {
  const okModel = () =>
    new MockLanguageModelV4({
      doGenerate: [text('OUTCOME: out_of_scope\n\nOnly this dataset.')],
    }) as any;
  const limits = () => ({ chat: { max_output_tokens: 1500, turn_deadline_seconds: 25 } }) as any;
  const msg = { messages: [{ role: 'user', content: 'A poem?' }] };
  it('parses with the frozen ChatResponse schema, also for a stale timeEpoch', async () => {
    const { h } = handler();
    const e = event({ messages: [{ role: 'user', content: 'Write a poem' }], session_id: 's-1' });
    (e.requestContext as any).timeEpoch = 0;
    const r = (await h(e)) as any;
    expect(r.statusCode).toBe(200);
    expect(ChatResponse.safeParse(JSON.parse(r.body)).success).toBe(true);
    expect(JSON.parse(r.body).outcome).toBe('out_of_scope');
  });
  it('a stalled flag read and a failed secret read never fail the turn', async () => {
    const h = createChatHandler({
      readFlag: () => new Promise(() => {}),
      queries: async () => stubQueries,
      langsmith: langSmithLoader({ LANGSMITH_API_KEY_SECRET_ID: 'x' }, async () => {
        throw new Error('secrets manager down');
      }),
      model: okModel(),
      modelId: 'm',
      limits,
    });
    const t0 = Date.now();
    const r = (await h(event(msg))) as any;
    expect(r.statusCode).toBe(200);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await within(new Promise(() => {}), 10, 'fallback')).toBe('fallback');
    expect(await within(Promise.reject(new Error('x')), 1000, null)).toBeNull();
  });
  it('releases a half-open probe when the data cannot open, so the instance is not pinned at circuit_open', async () => {
    let t = 0;
    const breaker = new CircuitBreaker(1, 30_000, () => t);
    breaker.failure();
    let fail = true;
    const h = createChatHandler({
      readFlag: async () => 'false',
      queries: async () => {
        if (fail) throw new Error('open failed');
        return stubQueries;
      },
      langsmith: async () => ({
        tracingEnabled: false,
        ToolLoopAgent,
        providerOptions: () => ({}),
        flush: async () => {},
      }),
      model: okModel(),
      modelId: 'm',
      breaker,
      limits,
    });
    expect(JSON.parse(((await h(event(msg))) as any).body).reason).toBe('circuit_open');
    t = 31_000;
    expect(((await h(event(msg))) as any).statusCode).toBe(500);
    fail = false;
    expect(((await h(event(msg))) as any).statusCode).toBe(200);
  });
});
