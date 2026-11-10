const TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR = 500;
const MILLISECONDS_PER_SECOND = 1_000;
const RETRY_AFTER_HEADER = "retry-after";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  attemptTimeoutMs: number;
}

export type Sleep = (milliseconds: number) => Promise<void>;

export function retryingFetch(
  fetchImpl: typeof fetch,
  policy: RetryPolicy,
  sleep: Sleep,
): typeof fetch {
  return async (input, init) => {
    for (let attempt = 1; ; attempt += 1) {
      const isFinalAttempt = attempt >= policy.maxAttempts;
      let response: Response;
      try {
        response = await fetchImpl(input, { ...init, signal: attemptSignal(policy, init?.signal) });
      } catch (error) {
        if (isFinalAttempt) throw error;
        await sleep(backoffDelay(policy, attempt));
        continue;
      }

      if (!isRetryable(response.status) || isFinalAttempt) return response;
      const delay = retryAfterDelay(response) ?? backoffDelay(policy, attempt);
      if (delay > policy.maxDelayMs) return response;

      await response.body?.cancel();
      await sleep(delay);
    }
  };
}

function attemptSignal(
  policy: RetryPolicy,
  callerSignal: AbortSignal | null | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(policy.attemptTimeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

function isRetryable(status: number): boolean {
  return status === TOO_MANY_REQUESTS || status >= FIRST_SERVER_ERROR;
}

function backoffDelay(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}

function retryAfterDelay(response: Response): number | undefined {
  const value = response.headers.get(RETRY_AFTER_HEADER);
  if (value === null) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * MILLISECONDS_PER_SECOND;

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now());
}
