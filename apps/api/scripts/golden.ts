// Replays the golden set (fixtures/rag/queries/*.json, built by golden-build.ts) and reports the hard gates and the
// experimental metrics (decisions.md section 20, "Golden set"). One result file per run in fixtures/rag/results/.
//
// Local (the chat function's exported handler in Node, same API Gateway v2 events, the serving DB of data/deploy/current,
// the deploy bucket's Parquet tables, real Bedrock; the shell's AWS session):
//   eval "$(aws configure export-credentials --profile cdk-lab --format env)"; set -a; . ./.env; set +a
//   LANGSMITH_PROJECT=staraptor-agent npx tsx apps/api/scripts/golden.ts --model us.anthropic.claude-sonnet-4-6
// Live (the deployed POST /v1/agent/chat; the model is the deployed one):
//   npx tsx apps/api/scripts/golden.ts --target "$API_BASE"
// Options: --cases id1,id2  --label text  --no-write
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/* eslint-disable @typescript-eslint/no-explicit-any */

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { values: opt } = parseArgs({
  options: {
    model: { type: 'string', default: 'us.anthropic.claude-sonnet-4-6' },
    target: { type: 'string', default: 'local' },
    cases: { type: 'string' },
    label: { type: 'string' },
    'no-write': { type: 'boolean', default: false },
  },
});
const local = opt.target === 'local';

/** List prices per million tokens (Anthropic's, which Bedrock's on-demand Claude prices follow): in, out, cache read, cache write (5 min). */
const PRICES: Record<string, [number, number, number, number]> = {
  'sonnet-4-6': [3, 15, 0.3, 3.75],
  'opus-4-6': [5, 25, 0.5, 6.25],
  'haiku-4-5': [1, 5, 0.1, 1.25],
};
const priceFor = (modelId: string) =>
  Object.entries(PRICES).find(([k]) => modelId.includes(k))?.[1] ?? null;

interface Fixture {
  id: string;
  description: string;
  local_only?: boolean;
  history?: { role: 'user' | 'assistant'; content: string }[];
  inject_description?: { permit_id: string; text: string };
  turns: { user: string; expected: any }[];
}

const fixtures: Fixture[] = readdirSync(path.join(repo, 'fixtures/rag/queries'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(repo, 'fixtures/rag/queries', f), 'utf8')));
const wanted = opt.cases ? new Set(opt.cases.split(',')) : null;
const selected = fixtures.filter((f) => (!wanted || wanted.has(f.id)) && (local || !f.local_only));

// ---- transport -------------------------------------------------------------------------------------------------------
type Send = (
  fx: Fixture,
  body: unknown,
) => Promise<{ status: number; body: any; ms: number; stats: any | null }>;

async function localSender(): Promise<{ send: Send; warm: () => Promise<unknown> }> {
  const { localChatHandler, chatEvent } = await import('./chat-local.js');
  const mod = await localChatHandler(opt.model!);
  const { queriesLoader, limitsFromEnv } = await import('../src/db.js');
  const { createObservability } = await import('../src/observability.js');
  const { langSmithLoader } = await import('../src/chat/langsmith.js');
  const { bedrockModel } = await import('../src/chat/model.js');
  const { DEFAULT_LIMITS } = await import('@travis/query');
  const { logger } = createObservability('staraptor-agent');
  const getQueries = queriesLoader(logger);
  let inject: Fixture['inject_description'] | undefined;
  // the tool-text injection case: the named permit's description is replaced in every result that carries it
  const patch = (v: any): any => {
    if (!inject || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(patch);
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = patch(x);
    if (o.permit_id === inject.permit_id && 'description' in o) o.description = inject.text;
    return o;
  };
  const queries = async () => {
    const q = await getQueries();
    return new Proxy(q, {
      get(t, p, r) {
        const f = Reflect.get(t, p, r);
        return typeof f === 'function'
          ? (...a: unknown[]) => {
              const out = f.apply(t, a);
              return out instanceof Promise ? out.then(patch) : out;
            }
          : f;
      },
    });
  };
  let last: any = null;
  const handler = mod.createChatHandler({
    readFlag: async () => 'false',
    queries,
    langsmith: langSmithLoader({ ...process.env, LANGSMITH_PROJECT: 'staraptor-agent' }),
    model: bedrockModel(opt.model!),
    modelId: opt.model!,
    limits: () => limitsFromEnv() ?? DEFAULT_LIMITS,
    onTurn: (s) => (last = s),
    turn: process.env.DEBUG_WITHHELD
      ? {
          onWithheld: (e) =>
            console.error(
              'WITHHELD',
              e.reason,
              JSON.stringify(e.failures),
              JSON.stringify(e.text.slice(0, 1500)),
            ),
        }
      : undefined,
  });
  return {
    warm: () => handler({ warm: { hold_ms: 0 } }),
    send: async (fx, body) => {
      inject = fx.inject_description;
      last = null;
      const t0 = performance.now();
      const r = (await handler(chatEvent(body))) as { statusCode: number; body: string };
      return {
        status: r.statusCode,
        body: JSON.parse(r.body),
        ms: Math.round(performance.now() - t0),
        stats: last,
      };
    },
  };
}

function remoteSender(base: string): { send: Send } {
  const url = `${base.replace(/\/+$/, '')}/v1/agent/chat`;
  return {
    send: async (_fx, body) => {
      for (const wait of [1000, 2000, 4000, 0]) {
        const t0 = performance.now();
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const ms = Math.round(performance.now() - t0);
        const text = await r.text();
        if (r.status === 429 && wait) {
          await new Promise((res) => setTimeout(res, wait));
          continue;
        }
        let parsed: any = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* gateway text */
        }
        return { status: r.status, body: parsed, ms, stats: null };
      }
      throw new Error('unreachable');
    },
  };
}

// ---- evaluation ------------------------------------------------------------------------------------------------------
const ID_FIELD: Record<string, string> = {
  property: 'property_id',
  permit: 'permit_id',
  contractor: 'contractor_attribution_key',
  business: 'business_record_id',
  license: 'license_record_id',
};

function matchArg(want: any, got: any): boolean {
  if (want && typeof want === 'object' && !Array.isArray(want)) {
    if ('$absent' in want) return got === undefined;
    if ('$in' in want) return (want.$in as unknown[]).some((w) => matchArg(w, got));
    if ('$contains' in want) {
      const hay = Array.isArray(got) ? got.map(String).join(' ') : String(got ?? '');
      return (want.$contains as string[]).every((w) => hay.toLowerCase().includes(w.toLowerCase()));
    }
  }
  if (typeof want === 'number') return typeof got === 'number' && Math.abs(want - got) <= 1e-4;
  if (typeof want === 'string')
    return typeof got === 'string' && want.toLowerCase() === got.toLowerCase();
  if (Array.isArray(want))
    return Array.isArray(got) && want.length === got.length && want.every((w) => got.includes(w));
  return want === got;
}
const callMatches = (want: { name: string; args: Record<string, unknown> }, call: any) =>
  call.name === want.name &&
  Object.entries(want.args).every(([k, v]) => matchArg(v, call.args?.[k]));

/** The hard gate, checked again from the response alone: ids in tokens, bare ids, link paths and CIDs (review S1). */
function gateCitations(b: any): { ok: boolean; bad: string[] } {
  const bad: string[] = [];
  const text: string = [...(b.assumptions ?? []), b.answer ?? ''].join('\n');
  const ev: any[] = b.evidence ?? [];
  const has = (kind: string, id: string) =>
    kind === 'run'
      ? id === b.run_id && ev.some((e) => e.kind === 'run')
      : kind === 'property'
        ? ev.some((e) => (e.kind === 'property' || e.kind === 'permit') && e.property_id === id)
        : !!ID_FIELD[kind] && ev.some((e) => e.kind === kind && e[ID_FIELD[kind]!] === id);
  for (const m of text.matchAll(/\[\[([^\]\n]*)\]\]/g)) {
    const [kind, ...rest] = m[1]!.split(':');
    if (!has(kind!, rest.join(':').trim())) bad.push(m[0]);
  }
  const plain = text.replace(/\[\[[^\]\n]*\]\]/g, ' ');
  for (const m of plain.matchAll(/\b(\d{4}-\d{6})[ -]?([A-Z]{2})\b/g))
    if (!has('permit', `${m[1]} ${m[2]}`)) bad.push(m[0]);
  for (const m of plain.matchAll(/\b[0-9a-f]{32}\b/g))
    if (!['contractor', 'business', 'license'].some((k) => has(k, m[0]))) bad.push(m[0]);
  for (const m of plain.matchAll(/\bproperty(?:\s+id)?\s*(?:#|no\.|number)?\s*:?\s*(\d{3,9})\b/gi))
    if (!has('property', m[1]!)) bad.push(m[0]);
  const kinds: Record<string, string> = {
    properties: 'property',
    permits: 'permit',
    contractors: 'contractor',
    businesses: 'business',
    licenses: 'license',
    runs: 'run',
  };
  for (const m of plain.matchAll(
    /\/v1\/(properties|permits|contractors|businesses|licenses|runs)\/([^\s)"'\]>#?]+)/g,
  ))
    if (!has(kinds[m[1]!]!, decodeURIComponent(m[2]!))) bad.push(m[0]);
  const cids = new Set(ev.map((e) => e.record_cid).filter(Boolean));
  for (const m of text.matchAll(/\bba[a-z2-7]{40,}\b/g)) {
    const ok = cids.has(m[0]) || (m[0] === b.manifest_cid && ev.some((e) => e.kind === 'run'));
    if (!ok) bad.push(m[0]);
  }
  return { ok: bad.length === 0, bad };
}

function evaluateTurn(expected: any, res: { status: number; body: any }) {
  const b = res.body ?? {};
  const calls: any[] = b.tool_calls ?? [];
  const ev: any[] = b.evidence ?? [];
  const cit = res.status === 200 ? gateCitations(b) : { ok: true, bad: [] };
  const answeredOk = !(b.outcome === 'answered' && !calls.some((c) => c.status === 'ok'));
  const toolsWant: any[] = expected.tools ?? [];
  const matched = toolsWant.filter((w) => calls.some((c) => callMatches(w, c))).length;
  const paramAccuracy =
    toolsWant.length === 0 ? (calls.length === 0 ? 1 : 0) : matched / toolsWant.length;
  let idRecall: number | null = null;
  if (expected.ids && expected.ids.values.length > 0) {
    // evidence keeps each record once, under the first call that returned it, so a record the expected tool returned
    // after another tool already had may sit under that other call: count the turn's records of the kind
    const got = new Set(
      ev.filter((e) => e.kind === expected.ids.kind).map((e) => e[ID_FIELD[expected.ids.kind]!]),
    );
    idRecall =
      expected.ids.values.filter((v: string) => got.has(v)).length / expected.ids.values.length;
  }
  let text: { k: number; precision: number; recall: number } | null = null;
  if (expected.relevant_permit_ids) {
    const textCalls = new Set(
      calls.filter((c) => c.name === 'search_permit_text').map((c) => c.id),
    );
    const got = [
      ...new Set(
        ev
          .filter((e) => textCalls.has(e.tool_call_id) && e.kind === 'permit')
          .map((e) => e.permit_id),
      ),
    ];
    const rel = new Set<string>(expected.relevant_permit_ids);
    const hit = got.filter((g) => rel.has(g)).length;
    text = { k: got.length, precision: got.length ? hit / got.length : 0, recall: hit / rel.size };
  }
  const forbidden = (expected.answer_must_not_match ?? []).filter((re: string) =>
    new RegExp(re, 'im').test(b.answer ?? ''),
  );
  return {
    status: res.status,
    outcome: b.outcome ?? null,
    outcome_ok: res.status === 200 && expected.outcomes.includes(b.outcome),
    gate_citations: cit.ok,
    bad_citations: cit.bad,
    gate_answered_needs_tool: answeredOk,
    forbidden_matches: forbidden,
    param_accuracy: paramAccuracy,
    id_recall: idRecall,
    text,
    tool_sequence: calls.map((c) => `${c.name}:${c.status}`),
    evidence: ev.length,
  };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

// ---- run -------------------------------------------------------------------------------------------------------------
const runId = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, 'Z');
const transport: { send: Send; warm?: () => Promise<unknown> } = local
  ? await localSender()
  : remoteSender(opt.target!);
if (transport.warm) {
  const t0 = performance.now();
  await transport.warm();
  console.error(
    `warm-up (open + README prime, no model call): ${Math.round(performance.now() - t0)} ms`,
  );
}
const turns: any[] = [];
let modelId = local ? opt.model! : '';
for (const fx of selected) {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [...(fx.history ?? [])];
  const session = `golden-${fx.id}-${runId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
  for (const [i, t] of fx.turns.entries()) {
    messages.push({ role: 'user', content: t.user });
    const res = await transport.send(fx, { messages, session_id: session });
    const b = res.body ?? {};
    if (b.model_id) modelId = b.model_id;
    const evaln = evaluateTurn(t.expected, res);
    const s = res.stats;
    const price = priceFor(b.model_id ?? modelId);
    const cost =
      s && price
        ? ((s.input_tokens - s.cache_read_tokens - s.cache_write_tokens) * price[0] +
            s.output_tokens * price[1] +
            s.cache_read_tokens * price[2] +
            s.cache_write_tokens * price[3]) /
          1e6
        : null;
    const answer: string = typeof b.answer === 'string' ? b.answer : '';
    turns.push({
      case: fx.id,
      turn: i + 1,
      ms: res.ms,
      ...evaln,
      stats: s
        ? {
            steps: s.steps,
            input_tokens: s.input_tokens,
            output_tokens: s.output_tokens,
            cache_read_tokens: s.cache_read_tokens,
            cache_write_tokens: s.cache_write_tokens,
            model_ms: s.model_ms,
            turn_ms: s.turn_ms,
            deadline_hit: s.deadline_hit,
            citation_failures: s.citation_failures,
            step_ms: s.step_ms,
            step_output_tokens: s.step_output_tokens,
          }
        : null,
      cost_usd: cost === null ? null : Math.round(cost * 10000) / 10000,
      request_id: b.request_id ?? null,
      prompt_version: b.prompt_version ?? null,
      answer_sha256: answer ? createHash('sha256').update(answer).digest('hex').slice(0, 16) : null,
      // owner and contact answers stay out of the repository (decisions.md section 20, "Personal data")
      answer_excerpt: fx.id === 'owner-contact' ? '[omitted: personal view]' : answer.slice(0, 600),
      assumptions: b.assumptions ?? [],
      limitations: (b.limitations ?? []).map((l: any) => l.incomplete_reason),
    });
    console.error(
      `${fx.id}#${i + 1} ${res.status} ${b.outcome ?? b.error ?? ''} ${res.ms} ms params=${r3(evaln.param_accuracy)} recall=${r3(evaln.id_recall)} gates=${evaln.gate_citations && evaln.gate_answered_needs_tool ? 'ok' : 'FAIL'} ${evaln.outcome_ok ? '' : 'OUTCOME-MISS'} ${evaln.forbidden_matches.length ? 'FORBIDDEN' : ''} [${evaln.tool_sequence.join(' ')}]`,
    );
    if (process.env.GOLDEN_SHOW && s)
      console.error(
        `  steps ${JSON.stringify(s.step_ms)} out ${JSON.stringify(s.step_output_tokens)} text ${JSON.stringify(s.step_text_chars)} turn ${s.turn_ms}`,
      );
    if (process.env.GOLDEN_SHOW)
      console.error(
        `  > ${JSON.stringify(answer.slice(0, 900))}\n  assumptions ${JSON.stringify(b.assumptions)}`,
      );
    messages.push({ role: 'assistant', content: answer || '(no answer)' });
  }
}

const ok200 = turns.filter((t) => t.status === 200);
const readme = turns.filter((t) => t.case === 'readme-two-turn');
const stateSuffix = turns.filter((t) => t.case.startsWith('state-suffix-'));
const withStats = turns.filter((t) => t.stats);
const summary = {
  run_id: runId,
  target: local ? 'local' : opt.target,
  model_id: modelId,
  label: opt.label ?? null,
  prompt_version: turns.find((t) => t.prompt_version)?.prompt_version ?? null,
  cases: selected.length,
  turns: turns.length,
  hard_gates: {
    citations_from_this_turn: `${turns.filter((t) => t.gate_citations).length}/${turns.length}`,
    answered_needs_successful_tool: `${turns.filter((t) => t.gate_answered_needs_tool).length}/${turns.length}`,
    pass: turns.every((t) => t.gate_citations && t.gate_answered_needs_tool),
  },
  experimental: {
    outcome_accuracy: r3(turns.filter((t) => t.outcome_ok).length / turns.length),
    parameter_accuracy: r3(mean(turns.map((t) => t.param_accuracy))),
    id_recall_returned_page: r3(
      mean(turns.filter((t) => t.id_recall !== null).map((t) => t.id_recall)),
    ),
    text_search_precision_at_k: r3(mean(turns.filter((t) => t.text).map((t) => t.text.precision))),
    text_search_recall_at_k: r3(mean(turns.filter((t) => t.text).map((t) => t.text.recall))),
    forbidden_answer_text: turns.filter((t) => t.forbidden_matches.length).length,
    latency_ms_p50: pct(
      ok200.map((t) => t.ms),
      50,
    ),
    latency_ms_p95: pct(
      ok200.map((t) => t.ms),
      95,
    ),
    latency_ms_max: pct(
      ok200.map((t) => t.ms),
      100,
    ),
    readme_turn_ms: readme.map((t) => t.ms),
    state_suffix_turn_ms: stateSuffix.map((t) => t.ms),
    model_ms_p50: pct(
      withStats.map((t) => t.stats.model_ms),
      50,
    ),
    model_ms_p95: pct(
      withStats.map((t) => t.stats.model_ms),
      95,
    ),
    steps_mean: r3(mean(withStats.map((t) => t.stats.steps))),
    input_tokens_mean: r3(mean(withStats.map((t) => t.stats.input_tokens))),
    output_tokens_mean: r3(mean(withStats.map((t) => t.stats.output_tokens))),
    cache_read_tokens_mean: r3(mean(withStats.map((t) => t.stats.cache_read_tokens))),
    cache_write_tokens_mean: r3(mean(withStats.map((t) => t.stats.cache_write_tokens))),
    cost_usd_per_turn_mean: r3(
      mean(turns.filter((t) => t.cost_usd !== null).map((t) => t.cost_usd)),
    ),
    deadline_hits: withStats.filter((t) => t.stats.deadline_hit).length,
    non_200: turns.length - ok200.length,
  },
};
console.log(JSON.stringify(summary, null, 2));
if (!opt['no-write']) {
  const dir = path.join(repo, 'fixtures/rag/results');
  mkdirSync(dir, { recursive: true });
  const name = `${runId}-${local ? 'local' : 'live'}-${(modelId || 'model').replace(/^us\.anthropic\./, '').replace(/[^a-z0-9.-]/gi, '-')}${opt.label ? `-${opt.label}` : ''}.json`;
  writeFileSync(path.join(dir, name), `${JSON.stringify({ summary, turns }, null, 2)}\n`);
  console.error(`wrote fixtures/rag/results/${name}`);
}
process.exit(0);
