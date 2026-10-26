// The only HTTP boundary of the profile scripts (T023, T024): read-only SoQL GETs to the
// Austin issued-permits dataset `3syk-w9eu`. The pattern follows
// pipeline/oracle-runtime/travis/lib/source-client.ts (copied idea, not imported):
// - one identified User-Agent, no app token, no proxy or header rotation;
// - at most one request per second (MIN_INTERVAL_MS between request starts);
// - page size at most 50,000;
// - a receipt (url, status, bytes, sha256, captured_at) for every request;
// - HTTP 403 or a challenge page stops the run with a `blocked` receipt and no retry;
//   any other non-2xx stops with `failed` (no retry with another identity).
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { RULES } from "../index.js";

export const USER_AGENT =
  "countylens-profile/1.0.0 (PrismTeam CountyLens travis-austin profile measurement; " +
  "+https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)";
export const MAX_PAGE_SIZE = 50_000;
export const MIN_INTERVAL_MS = 1_100;
export const TIMEOUT_MS = 180_000;

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export type HttpGet = (url: string) => Promise<HttpResponse>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface Receipt {
  url: string;
  method: "GET";
  status: number;
  bytes: number;
  sha256: string;
  captured_at: string;
  user_agent: string;
  app_token_used: false;
  outcome: "ok" | "blocked" | "failed";
  blocked_reason: "http-403" | "challenge" | null;
}

export class StopError extends Error {
  constructor(
    message: string,
    readonly receipt: Receipt,
  ) {
    super(message);
    this.name = "StopError";
  }
}

export interface SocrataClientOptions {
  get?: HttpGet;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Monotonic milliseconds; defaults to performance.now. */
  clock?: () => number;
}

const challengeSignal = (r: HttpResponse): boolean =>
  (r.headers["cf-mitigated"] ?? "").toLowerCase() === "challenge" || /^\s*</.test(r.body);

export class SocrataClient {
  readonly datasetUrl = RULES.dataset.url;
  readonly receipts: Receipt[] = [];
  private readonly get: HttpGet;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  readonly now: () => Date;
  private last: number | null = null;

  constructor(opts: SocrataClientOptions = {}) {
    const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
    this.get =
      opts.get ??
      (async (url) => {
        const res = await doFetch(url, {
          method: "GET",
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: "error",
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
        return { status: res.status, headers, body: await res.text() };
      });
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => new Date());
    this.clock = opts.clock ?? (() => performance.now());
  }

  url(params: Record<string, string>): string {
    const u = new URL(this.datasetUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  /** One SoQL GET; returns the parsed JSON array. Throws StopError on block or failure. */
  async query(params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const limit = params["$limit"];
    if (limit !== undefined && Number(limit) > MAX_PAGE_SIZE)
      throw new Error("page size above 50,000");
    if (this.last !== null) {
      const wait = MIN_INTERVAL_MS - (this.clock() - this.last);
      if (wait > 0) await this.sleep(wait);
    }
    this.last = this.clock();
    const url = this.url(params);
    const captured_at = this.now().toISOString();
    const res = await this.get(url);
    const bytes = Buffer.byteLength(res.body);
    const receipt: Receipt = {
      url,
      method: "GET",
      status: res.status,
      bytes,
      sha256: createHash("sha256").update(res.body).digest("hex"),
      captured_at,
      user_agent: USER_AGENT,
      app_token_used: false,
      outcome: "ok",
      blocked_reason: null,
    };
    this.receipts.push(receipt);
    if (res.status === 403 || challengeSignal(res)) {
      receipt.outcome = "blocked";
      receipt.blocked_reason = res.status === 403 ? "http-403" : "challenge";
      throw new StopError(`blocked (${receipt.blocked_reason}) at ${url}`, receipt);
    }
    if (res.status < 200 || res.status > 299) {
      receipt.outcome = "failed";
      throw new StopError(`HTTP ${res.status} at ${url}`, receipt);
    }
    const data: unknown = JSON.parse(res.body);
    if (!Array.isArray(data)) {
      receipt.outcome = "failed";
      throw new StopError(`unexpected body (not a JSON array) at ${url}`, receipt);
    }
    return data as Record<string, unknown>[];
  }

  async count(where?: string): Promise<number> {
    const rows = await this.query(
      where ? { $select: "count(*) AS n", $where: where } : { $select: "count(*) AS n" },
    );
    const n = Number(rows[0]?.["n"]);
    if (!Number.isInteger(n)) throw new Error("count query returned no integer");
    return n;
  }

  /** Key-paged select ordered by permit_number (keyset, not offset). */
  async fetchAllKeyed(
    select: string,
    where: string,
    pageSize: number,
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let last: string | null = null;
    for (;;) {
      const w: string =
        last === null ? where : `${where} AND permit_number > '${last.replace(/'/g, "''")}'`;
      const page = await this.query({
        $select: select,
        $where: w,
        $order: "permit_number",
        $limit: String(pageSize),
      });
      out.push(...page);
      if (page.length < pageSize) return out;
      const key = page[page.length - 1]?.["permit_number"];
      if (typeof key !== "string") throw new Error("page row without permit_number");
      last = key;
    }
  }

  queryUrls(): string[] {
    return [...new Set(this.receipts.map((r) => r.url))];
  }
}
