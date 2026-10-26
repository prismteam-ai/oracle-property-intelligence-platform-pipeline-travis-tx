// T022 (A-14, contracts/agent-ask.md, data-model.md § "agent.ask contract", agent-design.md §
// "ash"): the `agent.ask` tRPC procedure. AI SDK tool loop over `getModel()` (model.ts) and the
// four tools (tools.ts), with explicit step/call/token budgets, the AD-27 4-layer timeout's
// server-side layer (23 s abort -> `timed_out`; the 25 s Lambda timeout, the 25 s client stop and
// the 29-30 s HTTP API ceiling are the other three layers, set outside this module), a spend-cap
// pre-check (spend.ts) -> `paused`, and Bedrock-throttle detection -> `throttled`. Conversation
// state is client-sent `turns[]` (no server store, AD-09's "one response, no streaming" model).
// `how`/`missing[]`/`query` are composed here from tool-result envelopes only, never from model
// text (agent-design.md § 4: "the model writes only `answer` prose and chooses tool arguments").
//
// Every external dependency (the DynamoDB spend client, the engine/bind functions, the
// latest-run index read, the model-loop call itself) is injectable via `AskDeps` so the four
// outcomes T023 tests for (`answered`, `paused`, `throttled`, `timed_out`) are each reachable
// through documented, reversible configuration (an env var or a constructor override) rather
// than by hand-crafting a fake `outcome` value.
//
// A-16 A14-5 (Task B's structured empty outcomes): `missing[]` and the honesty sentences come from
// tool results only (empty_reason, an owner-area notice, the declareUnpublished tool, applied
// thresholds), never from the question's wording, and an answer that cites nothing carries
// `empty_outcome` (empty_in_scope, field_not_published, …) with its plain sentence. AC-13: a run
// with no usable Explore index answers `failed` with reason index_not_built / index_stale, and a
// runs index that cannot be read answers `failed` with reason run_lookup_failed (A14-6).
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { CidV1 } from "@countylens/contract";
import { MetricUnit } from "@aws-lambda-powertools/metrics";
import { EXPLORE_BOUNDS, type BoundRun, type QueryEngine } from "@countylens/query-core";
import { abortError, raceAbort } from "./abort.js";
import { bindOnce, getEngine, ownerAreaPublished } from "../engine/duckdb-node.js";
import { isIndexUnavailable } from "../engine/explore-index.js";
import { lazyViewEngine, type BindViews } from "../engine/lazy-views.js";
import {
  ADDRESS_NOT_PUBLISHED_TEXT,
  EMPTY_OUTCOME_SENTENCES,
  UNPUBLISHED_FIELDS,
  fieldLabel,
  plainWording,
  createCitationRegistry,
  emptyOutcomeOf,
  unpublishedFromTools,
  type EmptyOutcome,
  type Match,
} from "./citations.js";
import { agentObservability } from "./observability.js";
import {
  DAILY_SPEND_CAP_USD,
  SPEND_RESERVATION_USD,
  getSpendDocumentClient,
  recordSpend,
  releaseSpend,
  tryReserveSpend,
} from "./spend.js";
import { getModel, type EnvSource } from "./model.js";
import { latestOf, loadRunsIndex } from "../mcp/runs-index.js";
import { createAgentTools, type AgentTools } from "./tools.js";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Stage 5 review fix (Critical #2): the EMF metric name infra/src/api-stack.ts's `SpendAlarm`
 *  watches (`SPEND_METRIC_NAME`, not imported directly -- infra depends on the bundled entry,
 *  not apps/api's source, same reason as every other infra/app name pairing in this story). The
 *  alarm's statistic is `Maximum` over 5 minutes, so the value emitted each call must be the
 *  day's running total (`spentUsd` after the increment), not the per-call delta, or the alarm
 *  would never see $4.00. */
export const SPEND_METRIC_NAME = "AiSpendUsd";

// ---------------------------------------------------------------------------------------
// Contract (data-model.md § "agent.ask contract"; contracts/agent-ask.md)
// ---------------------------------------------------------------------------------------

/** Same cap as the top-level prompt: a turn is a past prompt the client resends. */
export const MAX_PROMPT_CHARS = 2000;

export const AGENT_OUTCOMES = [
  "answered",
  "failed",
  "paused",
  "throttled",
  "timed_out",
  "cancelled",
] as const;
export const AgentOutcome = z.enum(AGENT_OUTCOMES);
export type AgentOutcome = z.infer<typeof AgentOutcome>;

export const AgentAskTurn = z
  .object({ prompt: z.string().max(MAX_PROMPT_CHARS), outcome: AgentOutcome })
  .strict();

const bounded = (range: readonly [number, number]) =>
  z.number().finite().min(range[0]).max(range[1]);

/** The four "How I read this" chips a person can edit (ExploreAi.state.ts EDITABLE_CHIPS), with
 *  query-core's bounds. Strict: any other key is a caller error. Only these validated numbers ever
 *  reach the system prompt. */
export const AgentAskOverrides = z
  .object({
    roof_age_years_min: bounded(EXPLORE_BOUNDS.roof),
    radius_mi: bounded(EXPLORE_BOUNDS.radiusMi),
    tenure_years_min: bounded(EXPLORE_BOUNDS.tenure),
    open_years_min: bounded(EXPLORE_BOUNDS.openYrs),
  })
  .partial()
  .strict();
export type AgentAskOverrides = z.infer<typeof AgentAskOverrides>;

/** Client-sent, never persisted server-side (AD-09). */
export const AgentAskInput = z
  .object({
    prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
    /** Last <=4 turns; the client resends them so "that area" resolves without a server store. */
    turns: z.array(AgentAskTurn).max(4).optional(),
    /** From an edited "How I read this" chip, e.g. `{ tenure_years_min: 3 }`. */
    overrides: AgentAskOverrides.optional(),
    /** Pins the run this conversation compares against. Omitted on turn 1 -> latest. */
    manifest_cid: CidV1.optional(),
  })
  .strict();
export type AgentAskInput = z.infer<typeof AgentAskInput>;

/** Which run a response is about (same shape as the tools' run echo). */
export interface RunEcho {
  run_id: string;
  manifest_cid: string;
  as_of: string;
}

/** Plain-language reasons for the `unknown_excluded` keys the tools can report besides a filtered
 *  field being null. Any other non-zero key is reported with the generic reason `unknown`. */
const UNPLACED_REASONS: Record<string, { reason: string; sentence: (n: number) => string }> = {
  property_link: {
    reason: "permit has no matching property row",
    sentence: (n) =>
      `${n} ${n === 1 ? "permit" : "permits"} could not be placed in the radius because ${n === 1 ? "it has" : "they have"} no matching property record.`,
  },
  coordinates: {
    reason: "property has no coordinates",
    sentence: (n) =>
      `${n} ${n === 1 ? "record" : "records"} could not be placed in the radius because the property has no coordinates.`,
  },
};

function runEchoOf(bound: { runId: string; manifestCid: string; asOf: string }): RunEcho {
  return { run_id: bound.runId, manifest_cid: bound.manifestCid, as_of: bound.asOf };
}

/** `2026-10-21T10:35:16.000Z` -> `2026-10-21`. */
function asOfDate(asOf: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(asOf)?.[0] ?? asOf;
}

export interface AgentAskStep {
  tool: string;
  input: unknown;
  summary: string;
}

export interface AgentAskResponse {
  answer: string;
  how: string;
  steps: AgentAskStep[];
  matches: Match[];
  query: Record<string, unknown>;
  missing: { field: string; reason: string }[];
  outcome: AgentOutcome;
  /** The one run this answer is about (donphan Major 1): present on every response produced after
   *  the run was bound, so an empty answer still names the run it searched. */
  run?: RunEcho;
  /** A-16 A14-5: why an answer cites nothing, from the tool results (absent when rows matched). */
  empty_outcome?: EmptyOutcome;
  /** ERR-63: observable budgets (AC-5). All optional so older clients stay compatible. */
  modelCalls?: number;
  outputTokens?: number;
  durationMs?: number;
  /** X-Ray trace id of the Lambda invocation (`_X_AMZN_TRACE_ID` Root=...), no secrets. */
  traceId?: string;
}

// ---------------------------------------------------------------------------------------
// Budgets (AC-5; agent-design.md § "ash" > "Limits & how enforced")
// ---------------------------------------------------------------------------------------

export const MAX_MODEL_CALLS = 3;
export const MAX_TOOL_STEPS = 6;
export const MAX_OUTPUT_TOKENS = 1500;
/** 23 s per-request abort (AD-27 layer 1); the Lambda (25 s), client (25 s) and HTTP API
 *  (29-30 s) layers are configured outside this module. */
export const DEFAULT_ABORT_MS = 23_000;

/** Spend-counter price estimates (no real-time per-token billing query exists on either provider).
 *  Documented here, not imported from a provider SDK (constitution VI): this is money math, not a
 *  model call. List prices for a Sonnet-class model: input $3 per million tokens, output $15 per
 *  million tokens (output is about 5x input). */
export const ESTIMATED_USD_PER_INPUT_TOKEN = 0.000_003;
export const ESTIMATED_USD_PER_OUTPUT_TOKEN = 0.000_015;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Estimated USD for one request's usage, or undefined when the provider reported none. Input and
 *  output are priced separately when both are known; with only a total (or a total plus one side)
 *  the unknown remainder is priced at the OUTPUT rate, the conservative choice. */
export function estimateCostUsd(usage: TokenUsage): number | undefined {
  const { inputTokens, outputTokens, totalTokens } = usage;
  if (inputTokens !== undefined && outputTokens !== undefined) {
    return (
      inputTokens * ESTIMATED_USD_PER_INPUT_TOKEN + outputTokens * ESTIMATED_USD_PER_OUTPUT_TOKEN
    );
  }
  if (totalTokens === undefined) return undefined;
  if (inputTokens !== undefined) {
    return (
      inputTokens * ESTIMATED_USD_PER_INPUT_TOKEN +
      Math.max(totalTokens - inputTokens, 0) * ESTIMATED_USD_PER_OUTPUT_TOKEN
    );
  }
  if (outputTokens !== undefined) {
    return (
      outputTokens * ESTIMATED_USD_PER_OUTPUT_TOKEN +
      Math.max(totalTokens - outputTokens, 0) * ESTIMATED_USD_PER_INPUT_TOKEN
    );
  }
  return totalTokens * ESTIMATED_USD_PER_OUTPUT_TOKEN;
}

function envNumber(env: EnvSource, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `AI_DAILY_CAP_USD`, else spend.ts's `DAILY_SPEND_CAP_USD` -- a documented, reversible way to
 *  drive the real spend counter to `paused` without issuing $3 of real Bedrock calls (the
 *  verification-run pattern agent-design.md's "Outcome taxonomy" table names for `paused`). */
export function dailySpendCapUsd(env: EnvSource = process.env): number {
  return envNumber(env, "AI_DAILY_CAP_USD", DAILY_SPEND_CAP_USD);
}

/** `AGENT_ABORT_MS`, else `DEFAULT_ABORT_MS` -- the same documented, reversible pattern for
 *  `timed_out` (agent-design.md's "Outcome taxonomy": "temporarily set the abort to 1s via env
 *  var for one verification call, then restore"). */
export function abortMs(env: EnvSource = process.env): number {
  return envNumber(env, "AGENT_ABORT_MS", DEFAULT_ABORT_MS);
}

// ---------------------------------------------------------------------------------------
// Model loop (the one seam between this module and the Vercel AI SDK's own call shape)
// ---------------------------------------------------------------------------------------

export interface ModelLoopOutput {
  text: string;
  steps: AgentAskStep[];
  /** Every tool call's output this turn, in call order (Stage 5 review fix, Major #5: using
   *  only the LAST call's output silently dropped a real filtered result when a later call --
   *  e.g. `geocodePlace`, run last to disambiguate before answering -- wasn't the one carrying
   *  the `applied`/`area`/`unknown_excluded` envelope). `how`/`query`/`missing[]` are built by
   *  aggregating across all of these, never from model text. */
  toolOutputs: Record<string, unknown>[];
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelCalls?: number;
  /** ERR-61: true when the loop did not end in a final text answer (budget used up on tool
   *  calls, output cut at the token limit, ...). The text is then planning chatter, never an
   *  answer. */
  incomplete?: boolean;
}

export interface ModelLoopParams {
  model: LanguageModel;
  tools: AgentTools;
  system: string;
  prompt: string;
  abortSignal: AbortSignal;
  maxOutputTokens: number;
  maxSteps: number;
  /** Called each time a model call has returned (so it was billed). Lets the caller tell a
   *  throttle on the first call (nothing billed) from one after earlier billed calls. */
  onModelCallDone?: () => void;
}

export type RunModelLoop = (params: ModelLoopParams) => Promise<ModelLoopOutput>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The real tool loop: one `generateText` call with `tools`, `stopWhen: stepCountIs(maxSteps)`
 *  (AC-5's combined step/model-call cap -- see the module header's T022 note on how the two
 *  separate budgets in agent-design.md are enforced through one AI SDK stop condition here) and
 *  the 23 s `abortSignal`. */
export async function defaultRunModelLoop(params: ModelLoopParams): Promise<ModelLoopOutput> {
  const result = await generateText({
    model: params.model,
    tools: params.tools,
    system: params.system,
    prompt: params.prompt,
    abortSignal: params.abortSignal,
    maxOutputTokens: params.maxOutputTokens,
    stopWhen: stepCountIs(params.maxSteps),
    onStepFinish: () => params.onModelCallDone?.(),
    // ERR-61: the last allowed step is text-only, so the model must write its answer from the
    // results it already has instead of planning one more call.
    prepareStep: ({ stepNumber }) =>
      stepNumber >= params.maxSteps - 1 ? { toolChoice: "none" as const } : undefined,
  });

  const steps: AgentAskStep[] = result.steps.map((step) => {
    const call = step.toolCalls[0];
    return {
      tool: call?.toolName ?? "",
      input: call?.input ?? null,
      summary: `${step.toolCalls.length} tool call(s), ${step.toolResults.length} result(s)`,
    };
  });

  // result.toolResults is the LAST step only; the answer needs every step's envelope.
  const toolOutputs = result.steps
    .flatMap((step) => step.toolResults)
    .map((toolResult) => toolResult.output)
    .filter(isRecord);

  const usage = result.totalUsage ?? result.usage;
  return {
    text: result.text,
    steps,
    toolOutputs,
    modelCalls: result.steps.length,
    incomplete: result.finishReason !== "stop",
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
  };
}

// ---------------------------------------------------------------------------------------
// Latest-run resolution (manifest_cid omitted on turn 1 -> runs/index.json's latest entry)
// ---------------------------------------------------------------------------------------

export type ResolveManifestCid = (env: EnvSource, signal?: AbortSignal) => Promise<string>;

/** Reads the site's `runs/index.json` (`loadRunsIndex`, via `RUNS_INDEX_URL`) and returns the
 *  entry with the greatest `finishedAt` (`latestOf`). Any read/parse failure, or an empty index,
 *  throws: it propagates as a real Lambda error, never a guessed run. */
export async function defaultResolveManifestCid(
  env: EnvSource,
  signal?: AbortSignal,
): Promise<string> {
  const latest = latestOf(await loadRunsIndex(env, signal));
  if (latest === undefined) throw new Error("runs/index.json: no published runs");
  return latest.manifestCid;
}

// ---------------------------------------------------------------------------------------
// Error classification (abort -> timed_out, throttle -> throttled, anything else -> failed)
// ---------------------------------------------------------------------------------------

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function errorStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.statusCode;
  return typeof code === "number" ? code : undefined;
}

/** `AbortSignal.timeout`'s DOMException is named "TimeoutError"; a manually-aborted
 *  `AbortController` throws "AbortError" -- both mean the 23 s layer fired. */
export function isAbortError(error: unknown): boolean {
  const name = errorName(error);
  return name === "AbortError" || name === "TimeoutError";
}

/** Model-provider throttling only (Bedrock's `ThrottlingException`, 10 req/min account-wide, or a
 *  429 from the Gateway), as the AI SDK surfaces it. A DynamoDB throttle (spend table) is not one:
 *  it names DynamoDB / provisioned throughput and is a plain failure. The caller also only asks
 *  this for errors raised while the model loop runs. */
export function isThrottleError(error: unknown): boolean {
  const message = errorMessage(error);
  if (
    /dynamodb|provisioned ?throughput|requestlimitexceeded/i.test(`${errorName(error)} ${message}`)
  )
    return false;
  if (errorStatusCode(error) === 429) return true;
  return /throttlingexception|toomanyrequests|too many requests|rate exceeded/i.test(message);
}

// ---------------------------------------------------------------------------------------
// Structured parts: how / query / missing, built only from tool-result envelopes
// ---------------------------------------------------------------------------------------

function dedupeMissing(
  entries: { field: string; reason: string }[],
): { field: string; reason: string }[] {
  const seen = new Set<string>();
  const out: { field: string; reason: string }[] = [];
  for (const entry of entries) {
    const key = `${entry.field}:${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** A query-core `ResultEnvelope`-shaped tool output (always carries `applied`, per
 *  tools.ts's `projectEnvelope`) -- `geocodePlace`'s own output shape (`status`/`label`/`point`)
 *  never does, so this filter is what tells the two apart without a tool-name allowlist. */
function isEnvelopeOutput(
  output: Record<string, unknown>,
): output is Record<string, unknown> & { applied: Record<string, unknown> } {
  return isRecord(output.applied);
}

/**
 * Stage 5 review fix (Major #5): aggregates `how`/`query`/`missing[]` across EVERY envelope-
 * shaped tool output this turn, not just the last tool call -- a turn that calls
 * `searchProperties` then `geocodePlace` last (to disambiguate before answering) must not lose
 * `searchProperties`'s real filtered-result data just because it was not the final call.
 * `applied` fields merge left-to-right (a later call's threshold overrides an earlier one's, the
 * ordinary "most recent wins" rule); `area`/`unknown_excluded`/`empty_reason`/`truncated`
 * contribute to `missing[]`/`how` from every envelope, not only the last.
 */
/** ERR-63: the contract's names (packages/contract columns.ts UNCARRIED + golden.json
 *  must_flag_missing) for fields the row-level `missing` reports under their column names. */
const CONTRACT_MISSING_NAMES: Record<string, string> = {
  contractor_name_raw: "contractor.name_as_printed",
  // Contract v1.1 (A-11 Run 3): the view reports the printed name under its new column name.
  contractor_name_as_printed: "contractor.name_as_printed",
  bbb_rating: "bbb_status",
};

/** A-16: questions asking for a street address (not in the published export). */
export function asksAddress(question: string): boolean {
  return /\b(street )?address(es)?\b/i.test(question) && !/mailing/i.test(question);
}

/** ERR-64: questions about contractors / BBB (not answerable from the published export). */
export function asksContractorOrBbb(question: string): boolean {
  return /contractor|\bbbb\b|better business/i.test(question);
}

/** ERR-64: questions that filter on owners living outside the area (owner mailing location is
 *  not in the published export). */
export function asksOutOfAreaOwner(question: string): boolean {
  if (/absentee|out[- ]of[- ](area|town|state)/i.test(question)) return true;
  return (
    /\bowners?\b|\blive\b|\bliving\b|mailing/i.test(question) &&
    /\b(outside|out of)\b[^?.]*\b(area|town|state|county)\b/i.test(question)
  );
}

/** ERR-64: a vague duration ("many years", "a long time") the model must read as 5 years. */
export function asksVagueDuration(question: string): boolean {
  return /\bmany years\b|\ba long time\b|\blong[- ]open\b/i.test(question);
}

/** The "many years" sentence only makes sense for open-permit questions, not owner tenure. */
export function asksOpenPermitDuration(question: string): boolean {
  return asksVagueDuration(question) && /\bpermits?\b|\bopen\b|\bstalled\b/i.test(question);
}

/** A BBB lookup that produced a real answer (rated / not_found / blocked), not a gap. */
export function hasRealBbbStatus(matches: Match[]): boolean {
  return matches.some(
    (m) =>
      m.bbb_status !== undefined &&
      m.bbb_status !== "not_checked" &&
      m.bbb_status !== "unavailable",
  );
}

/** The sentence the deterministic permit lookup appends. "Not found in this run" is only true for a
 *  complete, genuinely empty lookup: never when the result was truncated or the tool gave another
 *  reason (run_not_found, out_of_scope, field_not_published, ...). Empty string = say nothing. */
export function permitLookupFacts(asked: string, output: Record<string, unknown>): string {
  const found = Array.isArray(output.matches) ? (output.matches as Record<string, unknown>[]) : [];
  if (found.length > 0) {
    return `Permit ${asked} [${String(found[0]?.n)}]: status ${String(found[0]?.status_class)}, open ${String(found[0]?.open_years ?? "unknown")} years.`;
  }
  const reallyAbsent =
    output.truncated !== true &&
    (output.empty_reason === "not_found" || output.empty_reason === "no_match");
  return reallyAbsent ? `Permit ${asked} was not found in this run.` : "";
}

/** A permit number as printed ('YYYY-NNNNNN XX'), if the question contains one. */
export function permitNumberIn(question: string): string | undefined {
  return /\b\d{4}-\d{6} [A-Z]{2}\b/.exec(question)?.[0];
}

export function composeStructuredParts(
  matches: Match[],
  toolOutputs: Record<string, unknown>[],
  _question = "",
  run?: RunEcho,
): {
  how: string;
  query: Record<string, unknown>;
  missing: { field: string; reason: string }[];
  unplacedSentences: string[];
} {
  const envelopes = toolOutputs.filter(isEnvelopeOutput);

  let applied: Record<string, unknown> = {};
  let areaLabel: string | undefined;
  let gazetteerNote: string | undefined;
  const unplaced = new Map<string, number>();
  const missing: { field: string; reason: string }[] = [];

  for (const envelope of envelopes) {
    applied = { ...applied, ...envelope.applied };

    const area = isRecord(envelope.area) ? envelope.area : undefined;
    if (typeof area?.label === "string") areaLabel = area.label;
    // Donphan Major 3: cite the gazetteer exactly as the envelope stamps it, never a constant.
    const gaz = isRecord(area?.gazetteer) ? area.gazetteer : undefined;
    const src = isRecord(area?.source) ? area.source : undefined;
    const gazSha = typeof gaz?.sha256 === "string" ? gaz.sha256 : undefined;
    const srcSha = typeof src?.sha256 === "string" ? src.sha256 : undefined;
    if (typeof gaz?.version === "string") {
      gazetteerNote = `Gazetteer ${gaz.version}${gazSha !== undefined ? ` (sha256 ${gazSha.slice(0, 12)}…)` : ""}`;
    } else if (srcSha !== undefined) {
      gazetteerNote = `Gazetteer source (sha256 ${srcSha.slice(0, 12)}…)`;
    }

    const unknownExcluded = isRecord(envelope.unknown_excluded) ? envelope.unknown_excluded : {};
    for (const [field, count] of Object.entries(unknownExcluded)) {
      if (typeof count !== "number" || count <= 0) continue;
      const known = UNPLACED_REASONS[field];
      missing.push({ field, reason: known?.reason ?? "unknown" });
      unplaced.set(field, (unplaced.get(field) ?? 0) + count);
    }
    const emptyReason = envelope.empty_reason;
    if (typeof emptyReason === "string") missing.push({ field: "result", reason: emptyReason });
    if (envelope.truncated === true) missing.push({ field: "result", reason: "truncated" });
  }
  for (const match of matches) {
    // A real BBB lookup (rated / not_found / blocked) is an answer, not a gap.
    const realBbb = hasRealBbbStatus([match]);
    for (const entry of match.missing) {
      const field = CONTRACT_MISSING_NAMES[entry.field] ?? entry.field;
      if (realBbb && field === "bbb_status") continue;
      missing.push({ field, reason: entry.reason });
    }
    if (match.bbb_status !== undefined && !realBbb) {
      missing.push({ field: "bbb_status", reason: match.bbb_status_reason ?? match.bbb_status });
    }
  }
  // ERR-62 / A-16 A14-5: fields the export does not carry, from structured tool results only
  // (an applied out-of-area filter, an owner-area "not published" notice, declareUnpublished),
  // never from the question's wording.
  missing.push(...unpublishedFromTools(toolOutputs));

  const howParts: string[] = [];
  if (run !== undefined) howParts.push(`Run ${run.run_id}, as of ${asOfDate(run.as_of)}`);
  if (areaLabel !== undefined) howParts.push(areaLabel);
  if (gazetteerNote !== undefined) howParts.push(gazetteerNote);
  for (const [key, value] of Object.entries(applied)) {
    if (key === "area" || key === "manifest_cid") continue;
    howParts.push(`${key}: ${JSON.stringify(value)}`);
  }
  if (typeof applied.tenure_years_min === "number") {
    howParts.push(`owner tenure more than ${applied.tenure_years_min} years`);
  }
  if (typeof applied.open_years_min === "number") {
    howParts.push(`permits open at least ${applied.open_years_min} years`);
  }

  const unplacedSentences = [...unplaced.entries()].map(([key, n]) =>
    UNPLACED_REASONS[key] !== undefined
      ? UNPLACED_REASONS[key].sentence(n)
      : `${n} ${n === 1 ? "record was" : "records were"} left out because ${fieldLabel(key)} is unknown.`,
  );

  return {
    how: howParts.join("; "),
    query: applied,
    missing: dedupeBbb(dedupeMissing(missing)),
    unplacedSentences,
  };
}

/** One `bbb_status` entry only: the specific reason a match carried (e.g. source_missing) wins
 *  over the generic declared one (UNPUBLISHED_FIELDS.bbb_status). */
function dedupeBbb(
  entries: { field: string; reason: string }[],
): { field: string; reason: string }[] {
  const bbb = entries.filter((e) => e.field === "bbb_status");
  if (bbb.length < 2) return entries;
  const chosen = bbb.find((e) => e.reason !== UNPUBLISHED_FIELDS.bbb_status) ?? bbb[0];
  const out: { field: string; reason: string }[] = [];
  let placed = false;
  for (const e of entries) {
    if (e.field !== "bbb_status") out.push(e);
    else if (!placed && chosen !== undefined) {
      out.push(chosen);
      placed = true;
    }
  }
  return out;
}

const FILTER_IGNORED = new Set(["limit", "sort", "manifest_cid"]);

/** ERR-61/62: filters the model changed between calls of the same tool (or relaxed against the
 *  question) are never silent. Returns plain-language change notes, empty when none. */
export function describeFilterChanges(steps: AgentAskStep[], question: string): string[] {
  const notes: string[] = [];
  const last = new Map<string, Record<string, unknown>>();
  const show = (v: unknown): string => JSON.stringify(v);
  for (const step of steps) {
    if (
      !isRecord(step.input) ||
      (step.tool !== "searchProperties" && step.tool !== "searchRoofingPermits")
    )
      continue;
    const current = step.input;
    const previous = last.get(step.tool);
    if (previous !== undefined) {
      const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
      for (const key of keys) {
        if (FILTER_IGNORED.has(key)) continue;
        const before = previous[key];
        const after = current[key];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        notes.push(
          before === undefined
            ? `${key} added (${show(after)})`
            : after === undefined
              ? `${key} dropped (was ${show(before)})`
              : `${key} changed from ${show(before)} to ${show(after)}`,
        );
      }
    }
    last.set(step.tool, current);
    // PO 2026-10-26: an "open" permit includes stalled ones (still open, past expiry, never
    // closed), so open_or_stalled is the reading of "open"; it is a widening only when the
    // question asks for active / not-expired permits.
    if (
      current.status_class === "open_or_stalled" &&
      /\b(active|current|not expired|unexpired)\b/i.test(question) &&
      !/stalled/i.test(question)
    ) {
      notes.push(
        "status_class widened to open_or_stalled although the question asked for active permits",
      );
    }
  }
  return [...new Set(notes)];
}

/** Only validated numbers under the four known keys (AgentAskOverrides) are ever written out. */
function overridesLine(overrides: AgentAskOverrides | undefined): string {
  const parts = Object.entries(overrides ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0
    ? `The user edited these assumptions this turn: ${parts.join(", ")}.`
    : "";
}

function buildSystemPrompt(input: AgentAskInput): string {
  return [
    "You are CountyLens's property-lead assistant for Travis County roofing leads.",
    "Answer only from tool results: cite every claim about a specific property or permit as",
    "[n] where n is the citation index a tool call returned; never invent a CID or a count.",
    "If a filtered field is unknown for some rows, say 'unknown', never 'none found'.",
    "If the question refers to 'that area' or a prior place, use the most recent area from",
    "turns/overrides unless the question names a new place; call geocodePlace only to",
    "disambiguate, since searchProperties/searchRoofingPermits resolve area.place themselves.",
    "An 'open' permit includes stalled permits (still open, past expiry, never closed): for open",
    "permits use status_class open_or_stalled and say how many are open and how many stalled; use",
    "status_class open only when the user asks for active, current or not-expired permits.",
    "Keep the user's filters exactly as asked: never loosen a threshold or widen the radius to",
    "find more rows; when a search returns nothing, say",
    "so plainly and name the filters used. With an area, always pass radius_mi: 5 miles when the",
    "user names none; state it as an assumption. Do not call tools again after an empty result unless the question needs a",
    "different tool. Never claim 'good coverage' or 'genuinely no matches' unless a tool result",
    "supports it; unknown_excluded and empty_reason are the only coverage evidence.",
    "Owner location IS published from the owner's mailing ZIP (contract v1.2): for owners outside",
    "the area, set owner_is_out_of_area true and report the matches. Only when a search result",
    "carries an owner_area notice with status not_published, say the owner's mailing location is",
    "not in this run's published export. BBB ratings are not available because BBB",
    "blocks automated lookups (bbb_status blocked / not_checked); say that when asked, and give",
    "the permit's bbb_url (a BBB search link) where one is present. The contractor's name AS PRINTED on the permit IS",
    "published (contractor_name_as_printed on each permit row, ERR-78): report it for each permit",
    "that has one, and say 'no contractor printed on this permit' for rows where it is empty;",
    "never say contractor names are unavailable in general. Whenever the question asks about a",
    "BBB rating, call declareUnpublished with bbb_status in the same step as your search. Street",
    "addresses ARE published (address on each property row): name properties by their address;",
    "only for a row without one say exactly 'Address not in the published export'. Write plain",
    "words, never field names (say",
    "'contractor name', 'owner lives outside the area', 'year built', not the column names).",
    "Read vague durations as numbers: 'many years' or 'a long time' means open_years_min 5 (at",
    "least 5 years) unless the user gives a number; say the threshold you applied. If the",
    "question asks for owners outside/out of the area, run the search with owner_is_out_of_area",
    "true and the other filters. When the question",
    "contains a permit number (YYYY-NNNNNN XX), ALWAYS call searchRoofingPermits with that",
    "permit_number first, then answer from the result; BBB ratings are not available (BBB",
    "blocks automated lookups), but still report the permit facts you found.",
    "Thresholds: tenure_years_min means owner tenure MORE THAN that many years (strictly); say",
    "'more than N years' for it. roof_age_years_min and open_years_min mean at least N years.",
    "Say 'in this run' for coverage claims: this answer searches ONE published run; never say 'in",
    "the published dataset' or 'in the data' as a general claim about all of Travis County.",
    "Your last step writes the final answer with no further tool calls; never end by planning a call.",
    "Be concise: this answer has a 1,500-output-token budget and at most 3 tool-calling turns.",
    "Roofing permits come from the City of Austin only (the other Travis jurisdictions publish no",
    "permit feed): outside Austin, say permits for that place are not in the data, never that no",
    "permit exists.",
    "A year built of 1900 is often a TCAD default for old buildings of unknown year: call roof ages",
    "from it approximate. For roof-age questions sort nearest first unless the user asks for the",
    "oldest roofs.",
    "List at most 10 properties or permits in the answer, each with its address and [n] citation;",
    "the page shows every returned row under the answer, so say how many matched and that the",
    "rest are listed below. Never write a table longer than 10 rows. Keep the whole answer under",
    "250 words: one line with the count, at most 10 short rows, then one line of caveats.",
    "In the caveat line, count and cite only the rows you listed above it: never cite a row number",
    "you did not list, and when you give a count of listed rows, it must equal the citations named.",
    overridesLine(input.overrides),
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function buildPrompt(input: AgentAskInput): string {
  const history = (input.turns ?? [])
    .map((turn) => `Q: ${turn.prompt}\n(outcome: ${turn.outcome})`)
    .join("\n");
  return history.length > 0 ? `${history}\nQ: ${input.prompt}` : input.prompt;
}

// ---------------------------------------------------------------------------------------
// Dependencies (every external boundary, overridable for the T023 contract tests)
// ---------------------------------------------------------------------------------------

export interface AskDeps {
  env: EnvSource;
  now: () => Date;
  ddb: DynamoDBDocumentClient;
  spendTableName: string;
  dailySpendCapUsd: number;
  abortMs: number;
  maxModelCalls: number;
  maxToolSteps: number;
  maxOutputTokens: number;
  reservationUsd: number;
  model: LanguageModel;
  getEngine: () => Promise<QueryEngine>;
  /** The initial bind: just `v_run`, enough for the run echo (ERR-19 follow-up). */
  bindOnce: (manifestCid: string) => Promise<BoundRun>;
  /** Binds the views a tool query names, lazily, per statement (default: bindOnce). */
  bindViews: BindViews;
  resolveManifestCid: ResolveManifestCid;
  runModelLoop: RunModelLoop;
  /** Whether a run publishes any owner area (default: engine/duckdb-node.ts). */
  ownerAreaPublished: (manifestCid: string) => Promise<boolean>;
}

/** A14-6: the runs index could not be read, so the latest run is unknown. */
export class RunLookupFailedError extends Error {
  override readonly name = "RunLookupFailedError";
}

export const RUN_LOOKUP_FAILED_ANSWER =
  "I could not read the list of published runs right now, so I have no run to search. Try again in a minute.";

/** T037: the only text a `failed` outcome from an unexpected error carries. */
const FAILED_MESSAGE = "Something went wrong on our side. Try again, or use Filters instead.";

function emptyResponse(outcome: AgentOutcome, answer = "", run?: RunEcho): AgentAskResponse {
  return {
    answer,
    how: "",
    steps: [],
    matches: [],
    query: {},
    missing: [],
    outcome,
    ...(run !== undefined ? { run } : {}),
  };
}

/**
 * The `agent.ask` tool loop. Every field of `deps` is optional and defaults to the real AWS/AI
 * SDK wiring; tests override one field at a time (a lowered `abortMs`/`dailySpendCapUsd`, or a
 * `runModelLoop` fake that throws a throttle/abort-shaped error) to reach each outcome
 * deterministically, per T023.
 */
export async function runAgentAsk(
  rawInput: z.input<typeof AgentAskInput>,
  overrides: Partial<AskDeps> = {},
): Promise<AgentAskResponse> {
  // Bad input is the caller's error (tRPC maps a ZodError to a 4xx), not an agent failure.
  const input = AgentAskInput.parse(rawInput);
  const env = overrides.env ?? process.env;
  const now = overrides.now ?? (() => new Date());
  const ddb = overrides.ddb ?? getSpendDocumentClient();
  const spendTableName = overrides.spendTableName ?? env.SPEND_TABLE_NAME ?? "";
  const cap = overrides.dailySpendCapUsd ?? dailySpendCapUsd(env);
  const reservationUsd = overrides.reservationUsd ?? SPEND_RESERVATION_USD;
  const abortTimeoutMs = overrides.abortMs ?? abortMs(env);
  const maxModelCalls = overrides.maxModelCalls ?? MAX_MODEL_CALLS;
  const maxToolSteps = overrides.maxToolSteps ?? MAX_TOOL_STEPS;
  const maxOutputTokens = overrides.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  const getEngineFn = overrides.getEngine ?? getEngine;
  const bindFn = overrides.bindOnce ?? ((manifestCid: string) => bindOnce(manifestCid, ["v_run"]));
  const bindViews = overrides.bindViews ?? bindOnce;
  const resolveManifestCid = overrides.resolveManifestCid ?? defaultResolveManifestCid;
  const runModelLoop = overrides.runModelLoop ?? defaultRunModelLoop;
  const ownerArea = overrides.ownerAreaPublished ?? ownerAreaPublished;

  // T036 (AD-27 layer 1): the 23 s abort starts before the first awaited step (spend reservation,
  // run lookup, engine, bind, tool calls, model loop) and the whole body is raced against it, so
  // a hung tool or engine call still ends as `timed_out`, never a 5xx.
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortTimeoutMs);
  const signal = controller.signal;

  // Spend accounting (money safety on a public route). One state machine, settled exactly once:
  //   "none"    nothing reserved
  //   "held"    reserved, not yet settled
  //   "settled" trued up, released or deliberately kept (terminal: nothing touches it again)
  // `claim()` is the only way out of "held" and is synchronous, so the request body and the abort
  // path can never both settle it. The reservation is RELEASED only when it is certain no model
  // call was billed; once a call was placed (`modelMayHaveBilled`) an abort or failure KEEPS the
  // reservation as the conservative estimate, and a normal answer trues it up to the real cost.
  let reservation = "none" as "none" | "held" | "settled";
  let reservedAt = now();
  let modelMayHaveBilled = false;
  let modelPhase = false; // true only while the model loop runs (errors then may be throttles)
  let stepBilled = false;
  let runEcho: RunEcho | undefined; // set once the run is bound

  const claim = (): boolean => {
    if (reservation !== "held") return false;
    reservation = "settled";
    return true;
  };
  /** Best effort, never throws. */
  const release = async (): Promise<void> => {
    if (!claim()) return;
    try {
      await releaseSpend(ddb, spendTableName, reservedAt, reservationUsd);
    } catch (releaseError) {
      agentObservability().logger.error("agent.ask could not release its spend reservation", {
        errorName: errorName(releaseError),
      });
    }
  };

  const execute = async (): Promise<AgentAskResponse> => {
    const model = overrides.model ?? getModel(env);

    // Spend-cap pre-check (agent-design.md § "ash" > "Spend-cap + alarm design"; Stage 5 review
    // fix, Major #3): one atomic conditional reservation, never a separate read-then-later-write
    // (which let two concurrent requests both pass a check before either's model call finished).
    // Never a half-run -- checked/reserved before any model call is placed.
    reservedAt = now();
    const { reserved, status: spend } = await tryReserveSpend(
      ddb,
      spendTableName,
      reservedAt,
      reservationUsd,
      cap,
    );
    if (reserved) reservation = "held";
    if (spend.spentUsd >= cap) {
      agentObservability().logger.warn("agent.ask paused: daily spend cap reached", {
        spentUsd: spend.spentUsd,
        cap,
      });
      await release(); // a taken reservation that landed at/over the cap must not leak
      return emptyResponse("paused", "Daily AI budget reached for today.");
    }
    if (signal.aborted) {
      // The abort fired while the reservation was in flight and it landed late: nothing billed.
      await release();
      throw abortError();
    }

    let manifestCid = input.manifest_cid;
    if (manifestCid === undefined) {
      try {
        manifestCid = await resolveManifestCid(env, signal);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error;
        throw new RunLookupFailedError(errorMessage(error));
      }
    }
    const runCid = manifestCid;
    const engine = await getEngineFn();
    const bound = await bindFn(manifestCid);
    runEcho = runEchoOf(bound);

    const registry = createCitationRegistry();
    const tools = createAgentTools({
      engine: lazyViewEngine(engine, manifestCid, bindViews),
      bound,
      registry,
      ownerAreaPublished: () => ownerArea(runCid),
    });

    const traceId = /Root=([^;]+)/.exec(env._X_AMZN_TRACE_ID ?? "")?.[1];
    const telemetry = (modelCalls?: number, outputTokens?: number) => ({
      ...(modelCalls !== undefined ? { modelCalls } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      durationMs: Date.now() - startedAt,
      ...(traceId !== undefined ? { traceId } : {}),
    });

    if (signal.aborted) {
      await release();
      throw abortError();
    }
    modelMayHaveBilled = true;
    modelPhase = true;
    const result = await runModelLoop({
      model,
      tools,
      system: buildSystemPrompt(input),
      prompt: buildPrompt(input),
      abortSignal: signal,
      maxOutputTokens,
      // AC-5's two budgets (<=6 tool steps, <=3 model calls) are enforced through the one AI SDK
      // stop condition the default loop supports (stepCountIs): the smaller cap dominates, which
      // is <=3 model calls for this tool set (each step issues at most one tool call).
      maxSteps: Math.min(maxModelCalls, maxToolSteps),
      onModelCallDone: () => {
        stepBilled = true;
      },
    });
    modelPhase = false;

    // True the reservation up to the real cost (never re-incrementing model_calls -- reserveSpend
    // already counted this call). Skipped when an abort already settled it (kept as the estimate).
    // When the provider reported no usage the reservation stays as the cost estimate. A failure to
    // record the true-up must not discard a good answer: log it and carry on.
    const actualUsd = estimateCostUsd(result);
    if (claim() && actualUsd !== undefined) {
      try {
        const status = await recordSpend(
          ddb,
          spendTableName,
          actualUsd - reservationUsd,
          reservedAt,
          { incrementModelCalls: false },
        );
        // The SpendAlarm's statistic is Maximum/5min: emit the day's running total, not the delta.
        agentObservability().metrics.addMetric(
          SPEND_METRIC_NAME,
          MetricUnit.NoUnit,
          status.spentUsd,
        );
      } catch (spendError) {
        agentObservability().logger.error("agent.ask could not true up its spend", {
          errorName: errorName(spendError),
          errorMessage: errorMessage(spendError),
        });
      }
    }

    // ERR-64: a permit number in the question is always looked up, even if the model skipped the
    // tool; the answer then carries the permit's facts and citation. Respects the step budget.
    const asked = permitNumberIn(input.prompt);
    if (
      asked !== undefined &&
      result.incomplete !== true &&
      result.text.trim() !== "" &&
      result.steps.length < maxToolSteps &&
      !result.steps.some(
        (s) =>
          s.tool === "searchRoofingPermits" && isRecord(s.input) && s.input.permit_number === asked,
      )
    ) {
      const lookupInput = { permit_number: asked, limit: 1, sort: "open_desc" as const };
      const output: unknown = await tools.searchRoofingPermits.execute?.(lookupInput, {
        toolCallId: "deterministic-permit-lookup",
        messages: [],
        abortSignal: signal,
        context: {},
      });
      if (isRecord(output)) {
        result.toolOutputs = [...result.toolOutputs, output];
        result.steps = [
          ...result.steps,
          {
            tool: "searchRoofingPermits",
            input: lookupInput,
            summary: "deterministic permit lookup",
          },
        ];
        const facts = permitLookupFacts(asked, output);
        if (facts !== "") result.text = `${result.text.trim()} ${facts}`;
      }
    }

    const matches = registry.matches();
    const { cleaned, outOfRangeCitations, ungroundedCids } = registry.postCheck(result.text);
    const composed = composeStructuredParts(matches, result.toolOutputs, input.prompt, runEcho);
    const { query } = composed;
    let { how, missing } = composed;
    const changes = describeFilterChanges(result.steps, input.prompt);
    const modelCalls = result.modelCalls ?? result.steps.length;

    // ERR-61: no final text answer (budget spent on tool calls, token cut-off, empty text) is
    // never "answered" and the planning text is never surfaced; say what was tried.
    if (result.incomplete === true || result.text.trim() === "") {
      const tried = result.steps
        .filter((s) => s.tool !== "")
        .map((s) => `${s.tool} ${JSON.stringify(s.input)}`)
        .join("; ");
      agentObservability().logger.warn("agent.ask incomplete: no final answer", {
        toolSteps: result.steps.length,
      });
      return {
        answer:
          "I could not finish this question within my step limit, so I have no answer to give." +
          (tried.length > 0 ? ` I tried: ${tried}.` : "") +
          (changes.length > 0 ? ` Filters changed along the way: ${changes.join("; ")}.` : "") +
          " This is not a 'none found'. Try a narrower question, or use Filters.",
        how,
        steps: result.steps,
        matches: [],
        query,
        missing: [{ field: "result", reason: "incomplete" }],
        outcome: "failed",
        ...(runEcho !== undefined ? { run: runEcho } : {}),
        ...telemetry(modelCalls, result.outputTokens),
      };
    }

    // ERR-62/63: plain statements the structured parts guarantee, in case the model omitted them.
    const extra: string[] = [];
    if (changes.length > 0) {
      how = [how, `Filters changed during the search: ${changes.join("; ")}`]
        .filter((p) => p.length > 0)
        .join("; ");
      extra.push(`Note: the search filters changed during this answer (${changes.join("; ")}).`);
    }
    // Only when the run does not publish owner location at all; a row without an owner record
    // (no_owner_record, zip_not_zcta) is a per-row gap, not "cannot tell" (label audit 2026-10-26).
    if (
      missing.some((m) => m.field === "owner_is_out_of_area" && m.reason === "not_in_export") &&
      !(/not in the published export/i.test(cleaned) && /outside the area/i.test(cleaned))
    ) {
      extra.push(
        "I cannot tell which owners live outside the area: the owner's mailing location is not in the published export.",
      );
    }
    // A14-5: from the applied threshold, not the question's wording.
    const years = query.open_years_min;
    if (typeof years === "number") {
      const stated = new RegExp(`(at least|>=)\\s*${years}\\b`, "i");
      if (!stated.test(cleaned)) {
        extra.push(
          `I read the open-time threshold as at least ${years} years (>= ${years} years).`,
        );
      }
    }
    if (
      missing.some((m) => m.field === "bbb_status") &&
      !hasRealBbbStatus(matches) &&
      !/BBB blocks automated lookups/i.test(cleaned)
    ) {
      // A-16: BBB status is published (blocked / not_checked); the rating is not, because BBB
      // blocks automated lookups. Say that, never "not published".
      extra.push(
        "BBB status is not available: BBB blocks automated lookups, so BBB was not checked; a BBB search link is given where a contractor is printed.",
      );
    }
    if (
      missing.some((m) => m.field === "contractor.name_as_printed") &&
      !/contractor not printed|no_lexicon_carrier/i.test(cleaned)
    ) {
      // Self-assessment 2026-10-26: true whether some or all listed permits lack a contractor (the
      // old wording followed a list of named contractors and read as if none had one).
      extra.push(
        "A permit listed without a contractor prints none on the City record (contractor not printed).",
      );
    }
    if (asksAddress(input.prompt) && !/address not in the published export/i.test(cleaned))
      extra.push(`${ADDRESS_NOT_PUBLISHED_TEXT}.`);
    missing = dedupeMissing(missing);
    extra.push(...composed.unplacedSentences);
    const emptyOutcome = emptyOutcomeOf(matches.length, result.toolOutputs);
    if (emptyOutcome !== null && !cleaned.includes(EMPTY_OUTCOME_SENTENCES[emptyOutcome]))
      extra.push(EMPTY_OUTCOME_SENTENCES[emptyOutcome]);

    agentObservability().logger.info("agent.ask answered", {
      toolSteps: result.steps.length,
      matches: matches.length,
      outOfRangeCitations,
      ungroundedCids,
    });

    return {
      // A-16: one address wording, plain labels instead of raw field names.
      answer: plainWording([cleaned, ...extra].join(" ").trim()),
      how,
      steps: result.steps,
      matches,
      query,
      missing,
      outcome: "answered",
      ...(runEcho !== undefined ? { run: runEcho } : {}),
      ...(emptyOutcome !== null ? { empty_outcome: emptyOutcome } : {}),
      ...telemetry(modelCalls, result.outputTokens),
    };
  };

  try {
    return await raceAbort(execute(), signal);
  } catch (error) {
    if (isAbortError(error)) {
      agentObservability().logger.warn("agent.ask timed out (23s abort)");
      return emptyResponse(
        "timed_out",
        "Took too long. Try again, or use Filters instead.",
        runEcho,
      );
    }
    // AC-13: the run has no usable Explore index; A14-6: the runs index could not be read.
    if (isIndexUnavailable(error)) {
      agentObservability().logger.warn("agent.ask: run has no usable Explore index", {
        reason: error.reason,
        manifestCid: error.manifestCid,
      });
      return {
        ...emptyResponse("failed", EMPTY_OUTCOME_SENTENCES[error.reason], runEcho),
        missing: [{ field: "result", reason: error.reason }],
        empty_outcome: error.reason,
      };
    }
    if (error instanceof RunLookupFailedError) {
      agentObservability().logger.warn("agent.ask: runs index could not be read", {
        errorMessage: error.message,
      });
      return {
        ...emptyResponse("failed", RUN_LOOKUP_FAILED_ANSWER, runEcho),
        missing: [{ field: "run", reason: "run_lookup_failed" }],
      };
    }
    // Throttling is only a model-provider condition: a throttle-shaped error from DynamoDB, the
    // runs index or a tool is a plain failure. A throttle before any billed step means the
    // provider refused the first call, so nothing was billed.
    if (modelPhase && isThrottleError(error)) {
      if (!stepBilled) modelMayHaveBilled = false;
      agentObservability().logger.warn("agent.ask throttled by the model provider");
      return emptyResponse(
        "throttled",
        "The model is busy right now; try again in a minute.",
        runEcho,
      );
    }
    // T037 (FR-005, contract "Never a 5xx"): any other failure (DynamoDB, runs index, engine,
    // bind, tool, ...) is a plain `failed` outcome with a fixed message; the detail goes to the
    // log only, never into the response.
    agentObservability().logger.error("agent.ask failed", {
      errorName: errorName(error),
      errorMessage: errorMessage(error),
    });
    return emptyResponse("failed", FAILED_MESSAGE, runEcho);
  } finally {
    clearTimeout(timer);
    if (modelMayHaveBilled) {
      // A model call was placed (it may be billed, or still running after an abort): keep the
      // reservation as the conservative cost estimate; do not release and do not adjust.
      claim();
    } else {
      await release(); // certain nothing was billed: give the reservation back
    }
  }
}
