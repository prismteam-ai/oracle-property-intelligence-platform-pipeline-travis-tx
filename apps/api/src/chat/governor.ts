import { APICallError, wrapLanguageModel } from 'ai';

/**
 * The turn's time and token budget (decisions.md section 20, "Time budget and isolation"): a deadline of about 25 s
 * counted from the request's receipt (`requestContext.timeEpoch`, so the cold start is included); each model step's
 * timeout is what remains of it; at most one retry, only on throttling or a 5xx and only if the budget allows; the output
 * budget (`max_output_tokens`) counts across steps. Applied as one middleware around the cached Bedrock model.
 */
type WrappedModel = Parameters<typeof wrapLanguageModel>[0]['model'];

export class DeadlineError extends Error {
  constructor(message = 'turn deadline reached') {
    super(message);
    this.name = 'DeadlineError';
  }
}
export class OutputBudgetError extends Error {
  constructor() {
    super('output token budget used up');
    this.name = 'OutputBudgetError';
  }
}

export interface StepUsage {
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  finishReason: string;
}

export interface TurnBudgetOptions {
  /** Epoch ms after which no model step may still run (receipt + deadline − the reserve to answer). */
  deadlineAt: number;
  /** `max_output_tokens` from LIMITS_JSON: the output budget of the whole turn. */
  maxOutputTokens: number;
  /** Cap of one step's output (keeps the final answer short; long lists reach the user as evidence). */
  stepOutputTokens: number;
  /** A step is not started with less time than this left. */
  minStepMs?: number;
  /** Wait before the one retry. */
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type BedrockFailure = 'throttled' | 'server_error' | 'denied' | 'other';

/** Classifies a Bedrock call failure: throttling and 5xx are retried once; access denial is `model_unavailable`. */
export function classifyBedrockError(e: unknown): BedrockFailure {
  const err = e as { statusCode?: number; name?: string; message?: string; cause?: unknown };
  const status = APICallError.isInstance(e) ? e.statusCode : err?.statusCode;
  const text = `${err?.name ?? ''} ${err?.message ?? ''}`;
  if (status === 429 || /Throttl|TooManyRequests|ServiceQuotaExceeded/i.test(text))
    return 'throttled';
  if (
    status === 403 ||
    /AccessDenied|not available for this account|don't have access|not authorized|ResourceNotFound|model identifier is invalid/i.test(
      text,
    )
  )
    return 'denied';
  if (typeof status === 'number' && status >= 500) return 'server_error';
  if (/ServiceUnavailable|InternalServer|ModelNotReady|ModelError/i.test(text))
    return 'server_error';
  return 'other';
}

export class TurnBudget {
  readonly steps: StepUsage[] = [];
  outputUsed = 0;
  retries = 0;
  throttles = 0;
  denials = 0;
  /** Model calls cut by the deadline while running. */
  modelTimeouts = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: TurnBudgetOptions) {
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  remainingMs(): number {
    return this.o.deadlineAt - this.now();
  }
  get outputRemaining(): number {
    return this.o.maxOutputTokens - this.outputUsed;
  }

  totals() {
    const sum = (k: keyof StepUsage) =>
      this.steps.reduce((a, s) => a + (typeof s[k] === 'number' ? (s[k] as number) : 0), 0);
    return {
      steps: this.steps.length,
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cacheReadTokens: sum('cacheReadTokens'),
      cacheWriteTokens: sum('cacheWriteTokens'),
      modelMs: sum('ms'),
    };
  }

  /** Wraps the model so every step runs inside this budget. */
  wrap(model: WrappedModel): WrappedModel {
    const minStep = this.o.minStepMs ?? 1500;
    return wrapLanguageModel({
      model,
      middleware: {
        specificationVersion: 'v4',
        wrapGenerate: async ({ params, model: inner }) => {
          for (let attempt = 0; ; attempt++) {
            const remaining = this.remainingMs();
            if (remaining < minStep) throw new DeadlineError();
            const maxOut = Math.min(this.o.stepOutputTokens, this.outputRemaining);
            if (maxOut < 64) throw new OutputBudgetError();
            const signals = [AbortSignal.timeout(remaining)];
            if (params.abortSignal) signals.push(params.abortSignal);
            const t0 = this.now();
            try {
              const r = await inner.doGenerate({
                ...params,
                maxOutputTokens: maxOut,
                abortSignal: AbortSignal.any(signals),
              });
              const u = r.usage;
              const out = u?.outputTokens?.total ?? 0;
              this.outputUsed += out;
              this.steps.push({
                ms: this.now() - t0,
                inputTokens: u?.inputTokens?.total ?? 0,
                outputTokens: out,
                cacheReadTokens: u?.inputTokens?.cacheRead ?? 0,
                cacheWriteTokens: u?.inputTokens?.cacheWrite ?? 0,
                finishReason: r.finishReason?.unified ?? 'other',
              });
              return r;
            } catch (e) {
              if (this.remainingMs() <= 0 || (e as Error)?.name === 'TimeoutError') {
                this.modelTimeouts++;
                throw new DeadlineError();
              }
              const kind = classifyBedrockError(e);
              if (kind === 'throttled') this.throttles++;
              if (kind === 'denied') this.denials++;
              const delay = this.o.retryDelayMs ?? 400;
              const retryable = kind === 'throttled' || kind === 'server_error';
              if (attempt === 0 && retryable && this.remainingMs() - delay >= minStep) {
                this.retries++;
                await this.sleep(delay);
                continue;
              }
              throw e;
            }
          }
        },
      },
    });
  }
}

/**
 * Per-instance circuit breaker (decisions.md section 20): after `threshold` consecutive turns that failed on Bedrock
 * (throttling, 5xx or timeouts after the retry), chat answers `503 circuit_open` for `openMs` without calling the model,
 * then lets one turn through to probe. State lives in the instance, like the MCP limiter.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;
  constructor(
    private readonly threshold = 3,
    private readonly openMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when a turn may call the model now. */
  allow(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt < this.openMs) return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }
  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }
  /** Ends a probe that reported neither success nor failure (the turn failed before or outside the model). */
  release(): void {
    this.probing = false;
  }
  failure(): void {
    this.failures++;
    this.probing = false;
    if (this.failures >= this.threshold || this.openedAt !== null) this.openedAt = this.now();
  }
  get state(): 'closed' | 'open' {
    return this.openedAt === null ? 'closed' : 'open';
  }
}
