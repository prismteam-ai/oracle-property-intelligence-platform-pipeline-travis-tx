// SYNTHETIC TEST INPUT (test-only). A fake Socrata `3syk-w9eu` endpoint for the A-04 permit
// tests: keyset pages by `:id`, `count(*)` with an optional `:updated_at` bound and the hourly
// `:updated_at` histogram. Every row here is invented; no owner or contractor data.
import type { FetchLike } from "../../../../travis/lib/source-client.js";

export type Row = Record<string, string>;

export const BASE = "https://data.austintexas.gov/resource/3syk-w9eu.json";

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const tok = (n: number, len: number): string => {
  let x = n >>> 0;
  let out = "";
  for (let k = 0; k < len; k += 1) {
    out += B36[x % 36];
    x = Math.floor(x / 36) + 7;
  }
  return out;
};

/**
 * A Socrata-style `:id` for row `i` (`row-xxxx-xxxx`, with `.`/`_`/`~` separators on some).
 * Deliberately NOT lexicographic in `i`: the fixture's own array order is the server order.
 */
export function synthId(i: number): string {
  const sep = [".", "-", "_", "~"][i % 4] as string;
  return `row-${tok(i * 2654435761, 4)}${sep}${tok(i * 40503 + 17, 4)}`;
}

/** A synthetic Austin row; `i` fixes its position in the fixture's (server) order. */
export function synthRow(i: number, over: Partial<Row> = {}): Row {
  return {
    ":id": synthId(i),
    ":created_at": "2026-01-01T00:00:00.000Z",
    ":updated_at": "2026-10-01T00:00:00.000Z",
    ":@computed_region_abcd_1234": "7",
    permit_number: `2026-${pad(i, 6)} BP`,
    permittype: "BP",
    work_class: "Remodel",
    description: "SYNTHETIC TEST INPUT",
    status_current: "Active",
    issue_date: "2026-09-01T00:00:00.000",
    expiresdate: "2027-03-01T00:00:00.000",
    tcad_id: "0100000001",
    original_address1: `${i} SYNTHETIC ST`,
    original_city: "AUSTIN",
    original_state: "TX",
    original_zip: "78701",
    jurisdiction: "AUSTIN FULL PURPOSE",
    issued_in_last_30_days: "No",
    day_issued: "MONDAY",
    ...over,
  };
}

export interface Call {
  url: URL;
  t: number;
  headers: Record<string, string>;
}

export interface FakeSocrataOptions {
  rows: () => readonly Row[];
  /** Status to answer instead of the body, by call; null = answer normally. */
  fault?: (url: URL, call: number) => number | null;
  /** Throw (a killed process) instead of answering. */
  crash?: (url: URL, call: number) => boolean;
  /** Never answer: the promise rejects only when the request's AbortSignal fires (a timeout). */
  hang?: (url: URL, call: number) => boolean;
  /** Fail with no HTTP response (a reset connection). */
  drop?: (url: URL, call: number) => boolean;
  clock: () => number;
}

/** The SoQL functions the live Austin dataset knows (date_trunc_ymdh does NOT exist there). */
const KNOWN_FUNCTIONS = new Set([
  "count",
  "date_trunc_ymd",
  "date_extract_hh",
  "to_floating_timestamp",
]);
const FLOATING_ONLY = new Set(["date_trunc_ymd", "date_extract_hh"]);

/** The live 400 body for an unknown function (captured 2026-10-22, trimmed to its stable parts). */
export const NO_SUCH_FUNCTION_BODY = (fn: string, arity: number): string =>
  JSON.stringify({
    message: `Query coordinator error: query.soql.no-such-function; No such function '${fn}'; arity=${arity}`,
    errorCode: "query.soql.no-such-function",
    data: { function: fn, arity, dataset: "foxtrot.36379" },
  });

export const TYPE_MISMATCH_BODY = (fn: string): string =>
  JSON.stringify({
    message: `Query coordinator error: query.soql.type-mismatch; Type mismatch for ${fn}; is fixed_timestamp`,
    errorCode: "query.soql.type-mismatch",
    data: { function: fn },
  });

/** Strict SoQL check of select/group/order: null = fine, else a 400 body like the live server's. */
export function soqlRejection(expressions: readonly string[]): string | null {
  for (const expr of expressions) {
    const re = /([a-z_]+)\(((?:[^()]|\([^()]*\))*)\)/g;
    for (let m = re.exec(expr); m !== null; m = re.exec(expr)) {
      const fn = m[1] as string;
      const arg = m[2] as string;
      if (!KNOWN_FUNCTIONS.has(fn)) {
        return NO_SUCH_FUNCTION_BODY(fn, arg.split(",").length);
      }
      if (FLOATING_ONLY.has(fn) && !arg.trim().startsWith("to_floating_timestamp(")) {
        return TYPE_MISMATCH_BODY(fn);
      }
    }
  }
  return null;
}

const CLAUSE = /^(:id|:updated_at) (>|<=) '((?:[^']|'')+)'$/;

/** `rows` is already in server order; `:id > x` means "after x in that order". */
function filterRows(rows: readonly Row[], where: string | null): Row[] {
  if (where === null || where === "") return [...rows];
  let out = [...rows];
  for (const c of where.split(" AND ")) {
    const m = CLAUSE.exec(c.trim());
    if (!m) throw new Error(`fake-socrata: unsupported clause ${c}`);
    const field = m[1] as string;
    const value = (m[3] as string).replaceAll("''", "'");
    if (field === ":id") {
      const at = out.findIndex((r) => r[":id"] === value);
      if (at < 0) throw new Error(`fake-socrata: cursor ${value} is not in the fixture`);
      out = out.slice(at + 1);
    } else {
      out = out.filter((r) =>
        m[2] === ">" ? (r[field] ?? "") > value : (r[field] ?? "") <= value,
      );
    }
  }
  return out;
}

export function fakeSocrata(options: FakeSocrataOptions): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (raw, init) => {
    const url = new URL(raw);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url, t: options.clock(), headers });
    const n = calls.length;
    if (options.crash?.(url, n)) throw new Error("synthetic crash: process killed");
    if (options.drop?.(url, n)) throw new Error("synthetic network error: ECONNRESET");
    if (options.hang?.(url, n)) {
      return new Promise<Response>((_resolve, reject) => {
        const abort = (): void => reject(new DOMException("aborted", "AbortError"));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    const status = options.fault?.(url, n) ?? null;
    if (status !== null) {
      return new Response(status === 403 ? "<html>Forbidden</html>" : "{}", {
        status,
        headers: { "content-type": status === 403 ? "text/html" : "application/json" },
      });
    }
    const p = url.searchParams;
    const select = p.get("$select") ?? "";
    const rejected = soqlRejection([select, p.get("$group") ?? "", p.get("$order") ?? ""]);
    if (rejected !== null) {
      return new Response(rejected, {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const matched = filterRows(options.rows(), p.get("$where"));
    let body: unknown;
    if (select === "count(*) AS n") {
      body = [{ n: String(matched.length) }];
    } else if (
      /^date_trunc_ymd\(.*\) AS d, date_extract_hh\(.*\) AS hh, count\(\*\) AS n$/.test(select)
    ) {
      const by = new Map<string, number>();
      for (const r of matched) {
        const u = r[":updated_at"] ?? "";
        const key = `${u.slice(0, 10)}|${u.slice(11, 13)}`;
        by.set(key, (by.get(key) ?? 0) + 1);
      }
      body = [...by.entries()].sort().map(([k, c]) => {
        const [d, hh] = k.split("|") as [string, string];
        return { d: `${d}T00:00:00.000`, hh: String(Number(hh)), n: String(c) };
      });
    } else {
      const limit = Number(p.get("$limit") ?? "1000");
      body = matched.slice(0, limit);
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

/** A fake clock + sleep: sleeping advances the clock (no real waiting). */
export function fakeTime(startIso = "2026-10-22T03:00:00.000Z") {
  const start = Date.parse(startIso);
  let t = 0;
  const sleeps: number[] = [];
  return {
    clock: () => t,
    now: () => new Date(start + t),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += Math.max(0, ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

/** A seeded RNG (mulberry32) so jitter is reproducible. */
export function seededRandom(seed: number): { random: () => number; drawn: number[] } {
  let a = seed >>> 0;
  const drawn: number[] = [];
  return {
    drawn,
    random: () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      const r = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      drawn.push(r);
      return r;
    },
  };
}
