import { createHash } from 'node:crypto';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { Meta } from '@travis/contract';
import { DEFAULT_LIMITS, type Queries } from '@travis/query';
import { CircuitBreaker } from '../chat/governor.js';
import {
  PLAIN_FACADE,
  clearPersonValues,
  langSmithLoader,
  registerHistory,
  type LangSmithFacade,
} from '../chat/langsmith.js';
import { bedrockModel } from '../chat/model.js';
import { parseChatRequest } from '../chat/request.js';
import type { ToolCallRecord } from '../chat/tools.js';
import { runTurn, type TurnDeps, type TurnStats } from '../chat/turn.js';
import { limitsFromEnv, queriesLoader } from '../db.js';
import { createObservability } from '../observability.js';
import { type FlagReader, cachedFlag, ssmFlagReader, within } from '../flag.js';
import { AGENT_PRIME } from '../warm.js';

/** The runtime's name (decisions.md section 20, "Observability"; confirmed 2026-10-20): service, namespace, LangSmith. */
export const AGENT_NAME = 'staraptor-agent';

const { observer, logger, metrics } = createObservability(AGENT_NAME);

export { cachedFlag, SDK_CLIENT_OPTIONS, within, type FlagReader } from '../flag.js';

/** Reads the budget kill-switch parameter (`CHAT_FLAG_PARAM`). */
export const readFlagFromSsm: FlagReader = ssmFlagReader('CHAT_FLAG_PARAM');

/** The warm-up event `just warm` sends to the chat function: opens and primes the instance, never calls the model. */
export interface WarmEvent {
  warm: { hold_ms?: number };
}

export interface ChatHandlerDeps {
  readFlag: FlagReader;
  queries: () => Promise<Queries>;
  langsmith: () => Promise<LangSmithFacade>;
  model: TurnDeps['model'];
  modelId: string;
  limits: () => Meta['limits'];
  breaker?: CircuitBreaker;
  now?: () => number;
  /** Called with each turn's stats (the golden-set runner reads tokens and timings from it). */
  onTurn?: (stats: TurnStats, requestId: string) => void;
  /** Turn options for tests (step cap, reserve). */
  turn?: Partial<Pick<TurnDeps, 'stepOutputTokens' | 'reserveMs' | 'maxSteps' | 'onWithheld'>>;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** Bound of each step before the turn (the flag read, the tracing facade). */
const PRE_TURN_MS = 1500;
/** Free-text parameters (search words, names, printed numbers) are logged as hashes; ids, numbers and flags as given. */
const HASHED_PARAMS = new Set(['q', 'number', 'license_number']);
export function logParams(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args))
    out[k] =
      HASHED_PARAMS.has(k) && typeof v === 'string'
        ? `sha256:${createHash('sha256').update(v).digest('hex').slice(0, 16)}`
        : v;
  return out;
}

function emitTurn(
  stats: TurnStats,
  requestId: string,
  sessionId: string | undefined,
  modelId: string,
) {
  // one EMF document per turn: counts and timings only (decisions.md section 20, "Observability")
  metrics.addDimensions({ operation: 'agentChat' });
  const count = (name: string, v: number) => metrics.addMetric(name, MetricUnit.Count, v);
  count('ChatTurns', 1);
  count('ChatSteps', stats.steps);
  count('ChatToolCalls', stats.tool_calls);
  count('ChatInputTokens', stats.input_tokens);
  count('ChatOutputTokens', stats.output_tokens);
  count('ChatCacheReadTokens', stats.cache_read_tokens);
  count('ChatCacheWriteTokens', stats.cache_write_tokens);
  count('ChatDeadlineHits', stats.deadline_hit ? 1 : 0);
  count('ChatCitationFailures', stats.citation_failures);
  count('BedrockThrottles', stats.bedrock_throttles);
  count('BedrockDenials', stats.bedrock_denials);
  metrics.addMetric('ChatTurnLatency', MetricUnit.Milliseconds, stats.turn_ms);
  metrics.addMetadata('request_id', requestId);
  metrics.addMetadata('outcome', stats.outcome);
  metrics.publishStoredMetrics();
  metrics.addDimensions({ operation: 'agentChat', outcome: stats.outcome });
  count('ChatOutcome', 1);
  metrics.publishStoredMetrics();
  logger.info('chat turn', {
    request_id: requestId,
    session_id: sessionId ?? null,
    model_id: modelId,
    ...stats,
  });
}

/** `POST /v1/agent/chat`: the grounded agent turn (T9), and the chat function's warm-ups. */
export function createChatHandler(deps: ChatHandlerDeps) {
  const breaker = deps.breaker ?? new CircuitBreaker();
  const now = deps.now ?? Date.now;
  let priming: Promise<boolean> | null = null;
  /**
   * Opens the instance (query layer, LangSmith key) and, once per instance, runs AGENT_PRIME so the README turns find
   * their data cached. Resolves true for the call that primed. No model call.
   */
  function prime(): Promise<boolean> {
    if (priming) return priming.then(() => false);
    priming = (async () => {
      const [q] = await Promise.all([deps.queries(), deps.langsmith()]);
      for (const op of AGENT_PRIME) {
        const t = performance.now();
        try {
          await op.run(q);
        } catch (err) {
          logger.warn('warm call failed', { operation: op.name, error: String(err) });
        }
        logger.info('warm call', { operation: op.name, ms: Math.round(performance.now() - t) });
      }
      return true;
    })();
    priming.catch(() => {
      priming = null;
    });
    return priming;
  }

  async function warm(e: WarmEvent['warm']): Promise<{ warmed: true; primed_now: boolean }> {
    const t0 = performance.now();
    const primedNow = await prime();
    const hold = (e.hold_ms ?? 1500) - (performance.now() - t0);
    if (hold > 0) await new Promise((r) => setTimeout(r, hold));
    logger.info('warm', { primed_now: primedNow, ms: Math.round(performance.now() - t0) });
    return { warmed: true, primed_now: primedNow };
  }

  async function http(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
    const t0 = performance.now();
    const requestId = event.requestContext.requestId;
    // timeEpoch is API Gateway's receipt time; a missing or stale one (a hand-made event) counts as now
    const te = event.requestContext.timeEpoch;
    const receivedAt = te && Math.abs(now() - te) < 60_000 ? te : now();
    const reply = (status: number, body: unknown, op: 'ok' | 'client_error' | 'server_error') => {
      observer.record({
        operation: 'agentChat',
        status: op,
        httpStatus: status,
        durationMs: performance.now() - t0,
        requestId,
      });
      return {
        statusCode: status,
        headers: { ...JSON_HEADERS, 'x-request-id': requestId },
        body: JSON.stringify(body),
      };
    };
    const unavailable = (reason: 'budget_exhausted' | 'model_unavailable' | 'circuit_open') =>
      reply(503, { error: 'agent_unavailable', reason, request_id: requestId }, 'server_error');

    const body = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body
      : null;
    const parsed = parseChatRequest(body);
    if (!parsed.ok) {
      // A request the contract rejects still opens the instance before the 400 (or 413) goes out: the explorer's Agent
      // tab sends one ({"messages": []}) when it opens, so the first question finds a primed instance (decisions.md
      // section 32). Bounded by the turn deadline; the first one per instance primes, the rest answer at once.
      const left = receivedAt + deps.limits().chat.turn_deadline_seconds * 1000 - now() - 1000;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        prime().catch(() => false),
        new Promise((r) => (timer = setTimeout(r, Math.max(0, left)))),
      ]);
      clearTimeout(timer);
      return reply(
        parsed.status,
        { error: parsed.error, detail: parsed.detail, request_id: requestId },
        'client_error',
      );
    }
    const limits = deps.limits();
    const deadlineAt = receivedAt + limits.chat.turn_deadline_seconds * 1000;
    // Everything before the turn runs inside the deadline and the try (review S3): the flag, the tracing facade and the
    // data each get a bound, and the circuit breaker's half-open probe is released whatever happens.
    let settled = false;
    let langsmith: LangSmithFacade = PLAIN_FACADE;
    try {
      const flag = await within(deps.readFlag(), PRE_TURN_MS, null);
      if (flag === 'true') return unavailable('budget_exhausted');
      if (!breaker.allow()) {
        settled = true;
        return unavailable('circuit_open');
      }
      langsmith = await within(deps.langsmith(), PRE_TURN_MS, PLAIN_FACADE);
      const q = await within(deps.queries(), Math.max(0, deadlineAt - now() - 2000), null);
      if (!q) throw new Error('the query layer did not open within the turn deadline');
      // the client-sent history reaches LangSmith only as hashes (review S4)
      registerHistory(parsed.messages.slice(0, -1).map((m) => m.content));
      const turnDeps: TurnDeps = {
        queries: deps.queries,
        meta: () => q.getMeta(),
        model: deps.model,
        modelId: deps.modelId,
        langsmith,
        limits: {
          maxOutputTokens: limits.chat.max_output_tokens,
          turnDeadlineSeconds: limits.chat.turn_deadline_seconds,
        },
        links: { apiHost: event.requestContext.domainName },
        logToolCall: (r: ToolCallRecord) =>
          logger.info('chat tool call', {
            request_id: requestId,
            tool_call_id: r.id,
            tool: r.name,
            params: logParams(r.args),
            status: r.status,
            total: r.total,
            returned: r.returned,
            ms: r.ms,
          }),
        now,
        ...deps.turn,
      };
      const result = await runTurn(turnDeps, {
        messages: parsed.messages,
        sessionId: parsed.sessionId,
        requestId,
        receivedAt,
      });
      emitTurn(result.stats, requestId, parsed.sessionId, deps.modelId);
      deps.onTurn?.(result.stats, requestId);
      // flush the traces inside the turn's deadline, keeping half a second to answer
      await langsmith.flush(Math.min(2000, deadlineAt - now() - 500));
      settled = true;
      if (result.kind === 'model_unavailable') {
        breaker.success();
        return unavailable('model_unavailable');
      }
      if (result.bedrockFailure && result.bedrockFailure !== 'other') breaker.failure();
      else breaker.success();
      return reply(200, result.body, 'ok');
    } catch (e) {
      observer.error('chat turn failed', e, requestId);
      await langsmith.flush(Math.min(500, deadlineAt - now() - 500));
      return reply(500, { error: 'internal_error', request_id: requestId }, 'server_error');
    } finally {
      clearPersonValues();
      // a turn that ended before reporting success or failure must not leave a half-open probe pinned
      if (!settled) breaker.release();
    }
  }

  async function handler(event: WarmEvent): Promise<{ warmed: true; primed_now: boolean }>;
  async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2>;
  async function handler(
    event: APIGatewayProxyEventV2 | WarmEvent,
  ): Promise<APIGatewayProxyStructuredResultV2 | { warmed: true; primed_now: boolean }> {
    if ('warm' in event) return warm(event.warm ?? {});
    return http(event);
  }
  return handler;
}

// ---- Lambda wiring (module scope, reused by warm invocations) -------------------------------------------------------

const modelId = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const getQueries = queriesLoader(logger);
const getLangSmith = langSmithLoader(
  {
    LANGSMITH_TRACING: process.env.LANGSMITH_TRACING,
    LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT ?? AGENT_NAME,
    LANGSMITH_ENDPOINT: process.env.LANGSMITH_ENDPOINT,
    LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
    LANGSMITH_API_KEY_SECRET_ID: process.env.LANGSMITH_API_KEY_SECRET_ID,
    AWS_REGION: process.env.AWS_REGION,
  },
  undefined,
  (e) => logger.warn('tracing disabled', { error: e instanceof Error ? e.name : String(e) }),
);
// Credentials come from the function role (the Lambda environment); the provider signs each call with SigV4.
const model = bedrockModel(modelId, undefined, (u) =>
  logger.info('Bedrock prompt cache usage.', {
    bedrockPromptCacheReadInputTokens: u.cacheReadTokens,
    bedrockPromptCacheWriteInputTokens: u.cacheWriteTokens,
  }),
);
// Start both at init, so the first turn finds the instance ready or nearly so.
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  getQueries().catch(() => undefined);
  getLangSmith().catch(() => undefined);
}

export const handler = createChatHandler({
  readFlag: cachedFlag(readFlagFromSsm),
  queries: getQueries,
  langsmith: getLangSmith,
  model,
  modelId,
  limits: () => limitsFromEnv() ?? DEFAULT_LIMITS,
});
