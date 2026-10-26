// One retry-delay rule for verify (src/verify.ts, scripts/verify-manifest.ts) and the Pinata copy
// (src/pinata-copy.ts). Dependency-free: scripts/ imports it by relative path.
//
// `Retry-After` (delta-seconds or an HTTP-date) when the server sent one, capped: Pinata has been
// observed (2026-10-24) to answer values over 2800 s under sustained load, which would make one
// request wait most of an hour. Otherwise full jitter over an exponential base, also capped.

export const BACKOFF_CAP_MS = 60_000;

export interface BackoffOptions {
  /** The first ceiling (attempt 1); doubles per attempt. */
  baseMs: number;
  capMs?: number;
  random?: () => number;
  now?: () => number;
}

export function backoffDelayMs(
  attempt: number,
  retryAfter: string | null,
  options: BackoffOptions,
): number {
  const cap = options.capMs ?? BACKOFF_CAP_MS;
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim();
    if (/^\d+$/.test(trimmed)) return Math.min(cap, Number(trimmed) * 1000);
    const at = Date.parse(trimmed);
    if (!Number.isNaN(at)) return Math.min(cap, Math.max(0, at - (options.now ?? Date.now)()));
  }
  const ceiling = Math.min(cap, options.baseMs * 2 ** (attempt - 1));
  return Math.max(1, Math.round((options.random ?? Math.random)() * ceiling));
}
