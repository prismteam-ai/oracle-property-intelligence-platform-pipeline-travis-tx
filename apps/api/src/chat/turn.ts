import { createHash } from 'node:crypto';
import { isStepCount, type ModelMessage, type ToolLoopAgent, wrapLanguageModel } from 'ai';
import type { Limitation, Meta } from '@travis/contract';
import type { Queries } from '@travis/query';
import { sanitizeAnswer, type LinkPolicy } from './answer.js';
import { BEDROCK_PROMPT_CACHE_METADATA } from './bedrock-prompt-cache.js';
import { checkCitations } from './citations.js';
import { EvidenceCollector, turnAssumptions, turnLimitations, type Evidence } from './evidence.js';
import {
  DeadlineError,
  OutputBudgetError,
  TurnBudget,
  classifyBedrockError,
  type BedrockFailure,
} from './governor.js';
import { CoordinateGuard } from './guard.js';
import type { LangSmithFacade } from './langsmith.js';
import { asksPersonal } from './projection.js';
import { PROMPT_VERSION, parseFinalMessage, systemPrompt } from './prompt.js';
import type { ChatMessageIn } from './request.js';
import { buildTurnTools, type ToolCallRecord } from './tools.js';

type WrappedModel = Parameters<typeof wrapLanguageModel>[0]['model'];

export type Outcome =
  | 'answered'
  | 'no_matches'
  | 'needs_clarification'
  | 'out_of_scope'
  | 'out_of_county'
  | 'limit_reached'
  | 'tool_error';

export interface ChatResponseBody {
  outcome: Outcome;
  answer: string;
  assumptions: string[];
  tool_calls: Omit<ToolCallRecord, 'ms'>[];
  evidence: Evidence[];
  limitations: Limitation[];
  run_id: string;
  manifest_cid: string;
  model_id: string;
  prompt_version: string;
  request_id: string;
}

/** What one turn reports to the log line and the metrics: ids, counts, hashes and timings, never text. */
export interface TurnStats {
  outcome: Outcome;
  steps: number;
  tool_calls: number;
  tool_errors: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  model_ms: number;
  turn_ms: number;
  deadline_hit: boolean;
  citation_failures: number;
  /** 1 when the check refused the first answer and the model was asked once to rewrite it. */
  citation_repairs: number;
  bedrock_throttles: number;
  bedrock_denials: number;
  retries: number;
  evidence: number;
  cited: number;
  personal_view: boolean;
  answer_sha256: string | null;
  question_sha256: string;
  /** Per model step: milliseconds and output tokens. */
  step_ms: number[];
  step_output_tokens: number[];
  /** Per model step: characters of text the model wrote (commentary before a tool call shows here). */
  step_text_chars: number[];
}

export type TurnResult =
  | {
      kind: 'response';
      body: ChatResponseBody;
      stats: TurnStats;
      bedrockFailure: BedrockFailure | null;
    }
  | { kind: 'model_unavailable'; stats: TurnStats };

export interface TurnLimits {
  maxOutputTokens: number;
  turnDeadlineSeconds: number;
}

export interface TurnDeps {
  queries: () => Promise<Queries>;
  meta: () => Promise<Meta>;
  /** The Bedrock model wrapped with prompt caching (module scope); the turn adds its own budget around it. */
  model: WrappedModel;
  modelId: string;
  langsmith: LangSmithFacade;
  limits: TurnLimits;
  /** Output cap of one step. */
  stepOutputTokens?: number;
  /** Kept free at the end of the deadline to build the answer and flush the traces. */
  reserveMs?: number;
  maxSteps?: number;
  logToolCall?: (r: ToolCallRecord) => void;
  /** Links the answer may keep (the API host the request came through; the gateways and `#/` routes always). */
  links?: LinkPolicy;
  /** Local debugging only (the golden runner): the model's final text when the server withholds it. */
  onWithheld?: (e: {
    text: string;
    reason: string;
    failures: { token: string; reason: string }[];
  }) => void;
  now?: () => number;
}

export interface TurnInput {
  messages: ChatMessageIn[];
  sessionId: string | undefined;
  requestId: string;
  /** Epoch ms the request was received (`requestContext.timeEpoch`): the deadline counts from here. */
  receivedAt: number;
}

const LIMIT_TEXT =
  'This turn reached its time or output limit before the answer was complete. The evidence gathered so far is listed below; ask again, or narrow the question.';
/** A citation repair step needs about one short answer step of time. */
const REPAIR_MIN_MS = 5000;
const repairRequest = (tokens: string[]) =>
  `Your answer cited ids that no tool returned in this turn: ${tokens.join(', ')}. Do not call any tool. Write the same answer again, citing only ids that appear in this turn's tool results, copied character for character; leave out any record you cannot cite. Keep the OUTCOME and ASSUMPTION lines.`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnResult> {
  const now = deps.now ?? Date.now;
  const meta = await deps.meta();
  const runId = meta.run.run_id;
  const deadline = input.receivedAt + deps.limits.turnDeadlineSeconds * 1000;
  const reserve = deps.reserveMs ?? 1500;
  const budget = new TurnBudget({
    deadlineAt: deadline - reserve,
    maxOutputTokens: deps.limits.maxOutputTokens,
    stepOutputTokens: deps.stepOutputTokens ?? 600,
    now,
  });
  const question = input.messages[input.messages.length - 1]!.content;
  const personal = asksPersonal(question);
  const evidence = new EvidenceCollector(runId);
  const guard = new CoordinateGuard(
    input.messages.filter((m) => m.role === 'user').map((m) => m.content),
  );
  const { tools, records, usedCenters, notes } = buildTurnTools({
    queries: deps.queries,
    evidence,
    guard,
    personal,
    remainingMs: () => budget.remainingMs(),
    log: deps.logToolCall ?? (() => {}),
  });
  const maxSteps = deps.maxSteps ?? 6;
  const sessionKey = input.sessionId ?? input.requestId;
  const AgentClass: typeof ToolLoopAgent = deps.langsmith.ToolLoopAgent;
  const agentSettings = (steps: number) => ({
    model: budget.wrap(deps.model),
    instructions: systemPrompt(meta),
    tools,
    stopWhen: isStepCount(steps),
    maxRetries: 0,
    providerOptions: {
      langsmith: deps.langsmith.providerOptions({
        session_id: sessionKey,
        thread_id: sessionKey,
        request_id: input.requestId,
        bedrock_model_id: deps.modelId,
        ls_provider: 'amazon_bedrock',
        ls_model_name: deps.modelId,
        prompt_version: PROMPT_VERSION,
        personal_view: personal,
        ...BEDROCK_PROMPT_CACHE_METADATA,
      }),
    },
  });
  const agent = new AgentClass(agentSettings(maxSteps));
  const repairCitations = async (
    settings: ReturnType<typeof agentSettings>,
    msgs: ModelMessage[],
  ): Promise<{ text: string; finishReason: string } | null> => {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), Math.max(0, deadline - reserve - now()));
    try {
      const r = await new AgentClass(settings).generate({
        messages: msgs,
        abortSignal: ctl.signal,
      });
      return r.text ? { text: r.text, finishReason: r.finishReason ?? 'other' } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(tm);
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - reserve - now()));
  const messages: ModelMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let text = '';
  let finishReason = 'other';
  let stoppedBy: 'deadline' | 'output_budget' | 'steps' | null = null;
  let stepText: number[] = [];
  let failure: unknown = null;
  let responseMessages: ModelMessage[] = [];
  try {
    const r = await agent.generate({ messages, abortSignal: controller.signal });
    text = r.text ?? '';
    finishReason = r.finishReason ?? 'other';
    stepText = r.steps.map((x) => x.text?.length ?? 0);
    responseMessages = r.response.messages as ModelMessage[];
    const last = r.steps[r.steps.length - 1];
    if ((last?.toolCalls?.length ?? 0) > 0 && r.steps.length >= maxSteps) stoppedBy = 'steps';
  } catch (e) {
    if (e instanceof DeadlineError || controller.signal.aborted || budget.remainingMs() <= 0)
      stoppedBy = 'deadline';
    else if (e instanceof OutputBudgetError || hasCause(e, OutputBudgetError))
      stoppedBy = 'output_budget';
    else if (hasCause(e, DeadlineError)) stoppedBy = 'deadline';
    else failure = e;
  } finally {
    clearTimeout(timer);
  }

  const totals = budget.totals();
  const baseStats = (
    outcome: Outcome,
    answer: string | null,
    extra: Partial<TurnStats> = {},
  ): TurnStats => ({
    outcome,
    steps: totals.steps,
    tool_calls: records.length,
    tool_errors: records.filter((r) => r.status !== 'ok').length,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_read_tokens: totals.cacheReadTokens,
    cache_write_tokens: totals.cacheWriteTokens,
    model_ms: totals.modelMs,
    turn_ms: now() - input.receivedAt,
    deadline_hit: stoppedBy === 'deadline',
    citation_failures: 0,
    citation_repairs: 0,
    bedrock_throttles: budget.throttles,
    bedrock_denials: budget.denials,
    retries: budget.retries,
    evidence: evidence.items.length,
    cited: 0,
    personal_view: personal,
    answer_sha256: answer ? sha(answer) : null,
    question_sha256: sha(question),
    step_ms: budget.steps.map((x) => x.ms),
    step_output_tokens: budget.steps.map((x) => x.outputTokens),
    step_text_chars: stepText,
    ...extra,
  });

  let bedrockFailure: BedrockFailure | null = null;
  if (failure) {
    bedrockFailure = classifyBedrockError(failure);
    if (bedrockFailure === 'denied')
      return { kind: 'model_unavailable', stats: baseStats('tool_error', null) };
  }
  if (budget.modelTimeouts > 0 && !bedrockFailure) bedrockFailure = 'server_error';

  const okCalls = records.filter((r) => r.status === 'ok').length;
  const assumptions = [...notes, ...turnAssumptions(evidence, usedCenters)];
  const limitations = turnLimitations(meta, evidence);
  const respond = (
    outcome: Outcome,
    answer: string,
    extraAssumptions: string[],
    extra: Partial<TurnStats> = {},
  ): TurnResult => ({
    kind: 'response',
    bedrockFailure,
    stats: baseStats(outcome, answer || null, extra),
    body: {
      outcome,
      answer,
      assumptions: [...extraAssumptions, ...assumptions],
      tool_calls: records.map(({ ms: _ms, ...r }) => r),
      evidence: evidence.items,
      limitations,
      run_id: runId,
      manifest_cid: meta.manifest_cid,
      model_id: deps.modelId,
      prompt_version: PROMPT_VERSION,
      request_id: input.requestId,
    },
  });

  if (stoppedBy) return respond('limit_reached', LIMIT_TEXT, []);
  // Every tool_error carries no model text at all: no answer, no model assumptions (review B1).
  if (failure) return respond('tool_error', '', []);

  // No HTML, no images, links only to the API, the explorer and the gateways: enforced here, not only in the explorer.
  const links = deps.links ?? {};
  const read = (t: string, reason: string) => {
    const p = parseFinalMessage(t);
    const a = sanitizeAnswer(p.answer, links);
    return {
      parsed: p,
      answer: a && reason === 'length' ? `${a} …` : a,
      modelAssumptions: p.assumptions.map((x) => sanitizeAnswer(x, links)).filter((x) => x),
    };
  };
  let { parsed, answer, modelAssumptions } = read(text, finishReason);
  if (!answer) {
    deps.onWithheld?.({ text, reason: 'empty_answer', failures: [] });
    return respond('tool_error', '', []);
  }
  // The model's assumption lines are checked with the answer: they are model text too (review B1).
  let check = checkCitations([...modelAssumptions, answer].join('\n'), evidence);
  let citationRepairs = 0;
  let failures = 0;
  if (!check.ok) {
    deps.onWithheld?.({ text, reason: 'citation_check', failures: check.failures });
    failures = check.failures.length;
    // One repair round when time is left: the model is told which ids the check refused and rewrites the answer, which
    // is checked again; anything still failing returns no model text, as before.
    const repaired =
      budget.remainingMs() > REPAIR_MIN_MS
        ? await repairCitations(agentSettings(1), [
            ...messages,
            ...responseMessages,
            { role: 'user', content: repairRequest(check.failures.map((f) => f.token)) },
          ])
        : null;
    if (repaired) {
      citationRepairs = 1;
      ({ parsed, answer, modelAssumptions } = read(repaired.text, repaired.finishReason));
      check = checkCitations([...modelAssumptions, answer].join('\n'), evidence);
    }
    if (!repaired || !answer || !check.ok) {
      if (repaired)
        deps.onWithheld?.({
          text: repaired.text,
          reason: 'citation_check',
          failures: check.failures,
        });
      return respond('tool_error', '', [], {
        citation_failures: failures,
        citation_repairs: citationRepairs,
      });
    }
  }
  // Without an OUTCOME line: a reply that cites nothing and asks something is a clarification question.
  const asks = check.cited.length === 0 && /\?/.test(answer);
  let outcome: Outcome =
    parsed.outcome ??
    (asks ? 'needs_clarification' : okCalls > 0 ? 'answered' : 'needs_clarification');
  // `answered` (and `no_matches`, which also reports on the data) requires at least one successful tool call.
  if ((outcome === 'answered' || outcome === 'no_matches') && okCalls === 0) {
    deps.onWithheld?.({ text, reason: 'answered_without_tool', failures: [] });
    return respond('tool_error', '', []);
  }
  if (outcome === 'answered' && check.cited.length === 0 && evidence.items.length === 0)
    outcome = 'no_matches';
  return respond(outcome, answer, modelAssumptions, {
    cited: check.cited.length,
    citation_failures: failures,
    citation_repairs: citationRepairs,
  });
}

function hasCause(e: unknown, cls: new (...a: never[]) => Error): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof cls) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
