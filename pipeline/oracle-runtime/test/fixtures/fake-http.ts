// SYNTHETIC TEST FIXTURE (test-only). A scripted HTTP router and clocks so probe tests
// never call a real source. Every response body here is invented.
import type { FetchLike } from "../../travis/lib/source-client.js";

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface Route {
  /** Returns true when this route answers the request. */
  match: (url: URL) => boolean;
  respond: (url: URL, init: RequestInit) => Response | Promise<Response>;
}

/** A fake fetch that answers from the first matching route and records every call. */
export function fakeHttp(routes: Route[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    const route = routes.find((r) => r.match(parsed));
    if (!route) throw new Error(`fake-http: no route for ${url}`);
    return route.respond(parsed, init);
  };
  return { fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function text(
  body: string,
  status = 200,
  headers: Record<string, string> = { "content-type": "text/html" },
): Response {
  return new Response(body, { status, headers });
}

/** A fetch response that never resolves until the request is aborted (a hung server). */
export function hangUntilAborted(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal;
    if (!signal) return;
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
}

/** A clock that advances by `stepMs` on every call, starting at `startIso`. */
export function steppingClock(startIso: string, stepMs: number): () => Date {
  let t = Date.parse(startIso);
  return () => {
    const d = new Date(t);
    t += stepMs;
    return d;
  };
}

/** A clock that returns the given instants in order (and repeats the last one). */
export function scriptedClock(isoTimes: readonly string[]): () => Date {
  let i = 0;
  return () => {
    const iso = isoTimes[Math.min(i, isoTimes.length - 1)];
    i += 1;
    if (iso === undefined) throw new Error("scriptedClock: no times given");
    return new Date(iso);
  };
}

export const silent = (): void => undefined;
