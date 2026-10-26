// T020 (A-14, agent-design.md § 6.3, ../../../assessment-guide/reference/checks.md § 7.2): the
// grader logic for golden.json, run by golden.test.ts against the deployed agent.ask. Pure
// functions over an already-fetched `AgentAskResponse` and an `oracle` ResultEnvelope so they can
// be unit-exercised without a network call or a live engine; golden.test.ts supplies both.
//
// "oracle" here is always a real query-core call (searchProperties / listPermits / geocodePlace,
// built in wave 1, packages/query-core/src/tools/functions.ts) — never a re-derived SQL string —
// per agent-design.md § 6.2's "oracle (query-core call the grader re-runs)" column.
import type { BoundRun } from "@countylens/query-core";
import {
  geocodePlace,
  getProperty,
  listPermits,
  searchProperties,
  type GeocodeResult,
  type GetPropertyInput,
  type ListPermitsInput,
  type QueryEngine,
  type ResultEnvelope,
  type Row,
  type SearchPropertiesInput,
} from "@countylens/query-core";

// ---------------------------------------------------------------------------------------
// agent.ask response shape (data-model.md § agent.ask response, agent-design.md ash § contract)
// ---------------------------------------------------------------------------------------

export interface AgentAskMatch {
  n?: number;
  citationIndex?: number;
  property_cid?: string;
  permit_cid?: string;
  permit_number?: string;
  [key: string]: unknown;
}

export interface AgentAskMissing {
  field?: string;
  reason?: string;
}

export interface AgentAskResponse {
  answer: string;
  how: string;
  steps: Array<{ tool: string; input: unknown; summary: string }>;
  matches: AgentAskMatch[];
  query: Record<string, unknown>;
  missing: Array<string | AgentAskMissing>;
  outcome: "answered" | "failed" | "paused" | "throttled" | "timed_out" | "cancelled";
  message?: string;
  modelCalls?: number;
  outputTokens?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------------------
// Oracle dispatch — the real wave-1 query-core functions, by name
// ---------------------------------------------------------------------------------------

export type OracleFn = "searchProperties" | "listPermits" | "geocodePlace";

export interface OracleCall {
  fn: OracleFn;
  input: unknown;
}

export type OracleResult = ResultEnvelope<Row> | GeocodeResult;

/** Dispatches a golden.json `oracle` entry to the real query-core function it names. `engine`/
 *  `bound` are required for `searchProperties`/`listPermits` (DB-backed); `geocodePlace` is pure
 *  and needs neither. Callers (golden.test.ts) are expected to skip DB-backed oracle calls
 *  cleanly when no bound engine is available this run — see that file's header comment. */
export async function runOracle(
  call: OracleCall,
  ctx: { engine?: QueryEngine; bound?: BoundRun } = {},
): Promise<OracleResult> {
  switch (call.fn) {
    case "geocodePlace":
      return geocodePlace(call.input as { query: string });
    case "searchProperties": {
      if (!ctx.engine || !ctx.bound) {
        throw new Error("runOracle(searchProperties) needs { engine, bound }");
      }
      return searchProperties(ctx.engine, ctx.bound, call.input as SearchPropertiesInput);
    }
    case "listPermits": {
      if (!ctx.engine || !ctx.bound) {
        throw new Error("runOracle(listPermits) needs { engine, bound }");
      }
      return listPermits(ctx.engine, ctx.bound, call.input as ListPermitsInput);
    }
    default:
      throw new Error(`Unknown oracle fn: ${String((call as OracleCall).fn)}`);
  }
}

/** Helper for golden.test.ts to resolve G5's permit_number and G4's radius assumption from the
 *  bound run at test start, rather than hard-coding them (agent-design.md § 6.2 note). */
export async function firstStalledPermitNumber(
  engine: QueryEngine,
  bound: BoundRun,
): Promise<string | null> {
  const envelope = await listPermits(engine, bound, {
    status_class: "stalled",
    sort: "open_desc",
    limit: 1,
  } as ListPermitsInput);
  const row = envelope.rows[0] as Row | undefined;
  return typeof row?.permit_number === "string" ? row.permit_number : null;
}

export async function propertyExists(
  engine: QueryEngine,
  bound: BoundRun,
  cid: string,
): Promise<boolean> {
  const envelope = await getProperty(engine, bound, { property_cid: cid } as GetPropertyInput);
  return envelope.returned > 0;
}

// ---------------------------------------------------------------------------------------
// 1. Groundedness — every matches[].property_cid/permit_cid exists in the bound run
// ---------------------------------------------------------------------------------------

export interface GroundednessResult {
  pass: boolean;
  checked: number;
  ungrounded: string[];
}

/** `exists(cid)` is expected to check against the hosted MCP or tRPC — never a local DB copy,
 *  per agent-design.md § 6.3.1. 100% required. */
export async function checkGroundedness(
  response: AgentAskResponse,
  exists: (cid: string) => Promise<boolean>,
): Promise<GroundednessResult> {
  const cids = response.matches
    .flatMap((m) => [m.property_cid, m.permit_cid])
    .filter((cid): cid is string => typeof cid === "string");
  const ungrounded: string[] = [];
  for (const cid of cids) {
    if (!(await exists(cid))) ungrounded.push(cid);
  }
  return { pass: ungrounded.length === 0, checked: cids.length, ungrounded };
}

// ---------------------------------------------------------------------------------------
// 2. Correctness / precision — every match satisfies the oracle filter
// ---------------------------------------------------------------------------------------

export interface CorrectnessResult {
  pass: boolean;
  total: number;
  incorrect: string[];
}

function oracleCidSet(oracle: OracleResult): Set<string> {
  if ("rows" in oracle) {
    return new Set(
      oracle.rows
        .flatMap((r) => [r.property_cid, r.permit_cid, r.cid])
        .filter((v): v is string => typeof v === "string"),
    );
  }
  return new Set<string>();
}

/** 100% required: every returned CID must be in the oracle's own result set. */
export function checkCorrectness(
  response: AgentAskResponse,
  oracle: OracleResult,
): CorrectnessResult {
  const oracleCids = oracleCidSet(oracle);
  const matchCids = response.matches
    .flatMap((m) => [m.property_cid, m.permit_cid])
    .filter((v): v is string => typeof v === "string");
  const incorrect = matchCids.filter((cid) => !oracleCids.has(cid));
  return { pass: incorrect.length === 0, total: matchCids.length, incorrect };
}

// ---------------------------------------------------------------------------------------
// 3. Recall — |matches ∩ oracle_topN| / |oracle_topN| >= 0.80, N = min(oracle.total, 25)
// ---------------------------------------------------------------------------------------

export interface RecallResult {
  pass: boolean;
  recall: number;
  n: number;
}

export const RECALL_THRESHOLD = 0.8;
export const RECALL_TOP_N_CAP = 25;

export function checkRecall(response: AgentAskResponse, oracle: OracleResult): RecallResult {
  const oracleCids = [...oracleCidSet(oracle)];
  const total = "total" in oracle ? oracle.total : oracleCids.length;

  // When the oracle is empty, recall passes iff matches is also empty.
  if (total === 0) {
    const pass = response.matches.length === 0;
    return { pass, recall: pass ? 1 : 0, n: 0 };
  }

  const n = Math.min(total, RECALL_TOP_N_CAP);
  const topN = new Set(oracleCids.slice(0, n));
  const matchCids = new Set(
    response.matches
      .flatMap((m) => [m.property_cid, m.permit_cid])
      .filter((v): v is string => typeof v === "string"),
  );
  const hit = [...topN].filter((cid) => matchCids.has(cid)).length;
  const recall = n === 0 ? 1 : hit / n;
  return { pass: recall >= RECALL_THRESHOLD, recall, n };
}

// ---------------------------------------------------------------------------------------
// 4. Honesty — must_mention regexes, must_flag_missing fields, empty_reason match
// ---------------------------------------------------------------------------------------

export interface HonestyResult {
  pass: boolean;
  missingMentions: string[];
  missingFlags: string[];
  emptyReasonMismatch: boolean;
  /** The empty_reason actually required of this case (undefined = not checked). */
  expectedEmptyReason: string | null | undefined;
}

function missingFields(missing: AgentAskResponse["missing"]): string[] {
  return missing.map((m) => (typeof m === "string" ? m : (m.field ?? ""))).filter(Boolean);
}

/** The expectation is the oracle's truth over the pinned run. A golden file that says `null`
 *  ("there are rows") is only meaningful when the oracle returns rows; when the oracle returns
 *  zero rows, the expected reason is the oracle's own empty_reason (e.g. `no_match`). A non-null
 *  golden reason (field_not_published, out_of_scope, ...) is always required as written, and
 *  `null` stays `null` whenever the oracle returns rows. `oracleRowCount` null means unknown
 *  (geocode oracle): the golden value is used as written. */
export function expectedEmptyReason(
  goldenEmptyReason: string | null | undefined,
  oracleRowCount: number | null,
  oracleEmptyReason: string | null,
): string | null | undefined {
  if (goldenEmptyReason === undefined) return undefined;
  if (goldenEmptyReason === null && oracleRowCount === 0) return oracleEmptyReason;
  // Not evaluable on this run: the response carries no empty_reason of its own, so the golden
  // value is only compared with what the oracle can express. A geocode oracle has no row count
  // (G6: the out-of-scope sentence is graded by checkOutOfScope), and a run with no in-scope
  // properties cannot exhibit `field_not_published` (G4: the disclosure is graded by
  // must_mention and must_flag_missing). Both are reported as inconclusive, never as a pass.
  if (goldenEmptyReason !== null && oracleRowCount === null) return undefined;
  if (
    goldenEmptyReason === "field_not_published" &&
    oracleRowCount === 0 &&
    oracleEmptyReason === "no_match"
  ) {
    return undefined;
  }
  return goldenEmptyReason;
}

/** True when the golden file requires an empty_reason that this run's oracle cannot express, so
 *  that part of the honesty check was skipped (see expectedEmptyReason). */
export function isEmptyReasonInconclusive(
  goldenEmptyReason: string | null | undefined,
  oracleRowCount: number | null,
  oracleEmptyReason: string | null,
): boolean {
  return (
    goldenEmptyReason !== undefined &&
    goldenEmptyReason !== null &&
    expectedEmptyReason(goldenEmptyReason, oracleRowCount, oracleEmptyReason) === undefined
  );
}

/** True when the oracle returned zero rows, so every recall/precision/groundedness pass is
 *  vacuous (nothing to find, nothing to ground). */
export function isVacuous(oracleRowCount: number | null): boolean {
  return oracleRowCount === 0;
}

export function checkHonesty(
  response: AgentAskResponse,
  expect: { must_mention?: string[]; must_flag_missing?: string[]; empty_reason?: string | null },
  oracleEmptyReason: string | null,
  oracleRowCount: number | null = null,
): HonestyResult {
  const haystack = `${response.answer}\n${response.how}`;
  const missingMentions = (expect.must_mention ?? []).filter(
    (pattern) => !new RegExp(pattern, "i").test(haystack),
  );

  const flagged = new Set(missingFields(response.missing));
  const missingFlags = (expect.must_flag_missing ?? []).filter((field) => !flagged.has(field));

  const expected = expectedEmptyReason(expect.empty_reason, oracleRowCount, oracleEmptyReason);
  const emptyReasonMismatch = expected !== undefined && expected !== oracleEmptyReason;

  return {
    pass: missingMentions.length === 0 && missingFlags.length === 0 && !emptyReasonMismatch,
    missingMentions,
    missingFlags,
    emptyReasonMismatch,
    expectedEmptyReason: expected,
  };
}

// ---------------------------------------------------------------------------------------
// 5. G6 — zero matches, out-of-scope sentence, no CID-shaped token in the prose
// ---------------------------------------------------------------------------------------

const CID_SHAPED = /\b(bafy[0-9a-z]{55}|bafk[0-9a-z]{55})\b/i;

export interface OutOfScopeResult {
  pass: boolean;
  hasMatches: boolean;
  containsCid: boolean;
}

export function checkOutOfScope(response: AgentAskResponse): OutOfScopeResult {
  const hasMatches = response.matches.length > 0;
  const containsCid = CID_SHAPED.test(response.answer);
  return { pass: !hasMatches && !containsCid, hasMatches, containsCid };
}

// ---------------------------------------------------------------------------------------
// 6. Budget — steps <= 6, model calls <= 3, output tokens <= 1500
// ---------------------------------------------------------------------------------------

export const MAX_STEPS = 6;
export const MAX_MODEL_CALLS = 3;
export const MAX_OUTPUT_TOKENS = 1500;

export interface BudgetResult {
  pass: boolean;
  steps: number;
  modelCalls: number | null;
  outputTokens: number | null;
  durationMs: number | null;
}

export function checkBudget(response: AgentAskResponse): BudgetResult {
  const steps = response.steps.length;
  const modelCalls = response.modelCalls ?? null;
  const outputTokens = response.outputTokens ?? null;
  const stepsOk = steps <= MAX_STEPS;
  const callsOk = modelCalls === null || modelCalls <= MAX_MODEL_CALLS;
  const tokensOk = outputTokens === null || outputTokens <= MAX_OUTPUT_TOKENS;
  return {
    pass: stepsOk && callsOk && tokensOk,
    steps,
    modelCalls,
    outputTokens,
    durationMs: response.durationMs ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Results row, for docs/evidence/A-14-agent.md (agent-design.md § 6.3.7)
// ---------------------------------------------------------------------------------------

export interface GoldenResultRow {
  id: string;
  durationMs: number | null;
  steps: number;
  groundedness: boolean;
  precision: boolean;
  recall: number;
  honesty: boolean;
  traceId?: string;
  model?: string;
  provider?: string;
}

export function toResultRow(
  id: string,
  budget: BudgetResult,
  groundedness: GroundednessResult,
  correctness: CorrectnessResult,
  recall: RecallResult,
  honesty: HonestyResult,
  meta: { traceId?: string; model?: string; provider?: string } = {},
): GoldenResultRow {
  return {
    id,
    durationMs: budget.durationMs,
    steps: budget.steps,
    groundedness: groundedness.pass,
    precision: correctness.pass,
    recall: recall.recall,
    honesty: honesty.pass,
    ...meta,
  };
}
