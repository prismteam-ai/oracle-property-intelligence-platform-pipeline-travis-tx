import { describe, expect, it } from "vitest";
import { type RetryPolicy, retryingFetch } from "../../src/infrastructure/retrying-fetch.js";

const POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  attemptTimeoutMs: 120_000,
};
const URL = "https://data.austintexas.gov/resource/3syk-w9eu.json";

type Step = Response | Error;

function scripted(steps: Step[]) {
  const signals: (AbortSignal | null | undefined)[] = [];
  const sleeps: number[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    signals.push(init?.signal);
    const step = steps.shift();
    if (!step) throw new Error("fetch called more often than scripted");
    if (step instanceof Error) throw step;
    return step;
  };
  const sleep = async (milliseconds: number) => {
    sleeps.push(milliseconds);
  };
  return { fetch: retryingFetch(fetchImpl, POLICY, sleep), signals, sleeps, remaining: steps };
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(String(code), { status: code, headers });
}

describe("retryingFetch", () => {
  it("returns the first successful response without waiting", async () => {
    const { fetch, sleeps } = scripted([status(200)]);

    expect((await fetch(URL)).status).toBe(200);
    expect(sleeps).toEqual([]);
  });

  it("backs off exponentially on server errors", async () => {
    const { fetch, sleeps } = scripted([status(503), status(502), status(200)]);

    expect((await fetch(URL)).status).toBe(200);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("waits as long as Retry-After asks on rate limiting", async () => {
    const { fetch, sleeps } = scripted([status(429, { "retry-after": "7" }), status(200)]);

    expect((await fetch(URL)).status).toBe(200);
    expect(sleeps).toEqual([7_000]);
  });

  it("gives up at once when Retry-After is longer than the policy allows", async () => {
    const { fetch, sleeps, remaining } = scripted([
      status(429, { "retry-after": "3540" }),
      status(200),
    ]);

    expect((await fetch(URL)).status).toBe(429);
    expect(sleeps).toEqual([]);
    expect(remaining).toHaveLength(1);
  });

  it("returns the last failure after the final attempt", async () => {
    const { fetch, sleeps } = scripted([status(500), status(500), status(500)]);

    expect((await fetch(URL)).status).toBe(500);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("does not retry client errors", async () => {
    const { fetch, sleeps } = scripted([status(404)]);

    expect((await fetch(URL)).status).toBe(404);
    expect(sleeps).toEqual([]);
  });

  it("retries network failures and rethrows the last one", async () => {
    const failure = new TypeError("fetch failed");
    const { fetch, sleeps } = scripted([failure, failure, failure]);

    await expect(fetch(URL)).rejects.toBe(failure);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("gives every attempt its own timeout", async () => {
    const { fetch, signals } = scripted([status(503), status(200)]);

    await fetch(URL);

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
