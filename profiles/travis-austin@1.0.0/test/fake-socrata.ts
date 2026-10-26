// Test helper: an in-memory stand-in for the Socrata `3syk-w9eu` endpoint. It answers
// only the query shapes the measure and sample scripts send (count, key-paged select,
// `permit_number in (...)`), so a new query shape fails loudly.
import type { HttpGet, HttpResponse } from "../scripts/socrata.js";
import type { PermitRow } from "../index.js";

export interface FakeOptions {
  /** Rows the endpoint holds; `predicates` decides membership per base `$where`. */
  rows: PermitRow[];
  predicates: Record<string, (r: PermitRow) => boolean>;
  /** Override the count answer for a base `$where` (key "" = whole dataset), per call. */
  countOverride?: (where: string, call: number) => number | undefined;
  /** Return this status (e.g. 403) for the n-th request (1-based). */
  failOn?: { request: number; status: number; body?: string; contentType?: string };
}

const ok = (body: unknown): HttpResponse => ({
  status: 200,
  headers: { "content-type": "application/json;charset=utf-8" },
  body: JSON.stringify(body),
});

export function fakeSocrata(opts: FakeOptions): { get: HttpGet; urls: string[] } {
  const urls: string[] = [];
  const countCalls = new Map<string, number>();
  const get: HttpGet = async (url) => {
    urls.push(url);
    if (opts.failOn && urls.length === opts.failOn.request) {
      return {
        status: opts.failOn.status,
        headers: { "content-type": opts.failOn.contentType ?? "text/html" },
        body: opts.failOn.body ?? "<html>Forbidden</html>",
      };
    }
    const p = new URL(url).searchParams;
    const select = p.get("$select") ?? "";
    let where = p.get("$where") ?? "";
    const inMatch = /^permit_number in \((.*)\)$/.exec(where);
    if (inMatch?.[1] !== undefined) {
      const wanted = new Set(
        [...inMatch[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => (m[1] ?? "").replace(/''/g, "'")),
      );
      return ok(opts.rows.filter((r) => wanted.has(r.permit_number)));
    }
    let after: string | null = null;
    const keyset = /^(.*) AND permit_number > '((?:[^']|'')*)'$/.exec(where);
    if (keyset?.[1] !== undefined && keyset[2] !== undefined) {
      where = keyset[1];
      after = keyset[2].replace(/''/g, "'");
    }
    const pred = where === "" ? () => true : opts.predicates[where];
    if (!pred) throw new Error(`fake socrata: unknown $where ${where}`);
    const members = opts.rows
      .filter(pred)
      .sort((a, b) => (a.permit_number < b.permit_number ? -1 : 1));
    if (select.startsWith("count(")) {
      const call = (countCalls.get(where) ?? 0) + 1;
      countCalls.set(where, call);
      const n = opts.countOverride?.(where, call) ?? members.length;
      return ok([{ n: String(n) }]);
    }
    const limit = Number(p.get("$limit") ?? "1000");
    const page = members.filter((r) => after === null || r.permit_number > after).slice(0, limit);
    const fields = select.split(",").map((s) => s.trim());
    return ok(
      page.map((r) =>
        Object.fromEntries(fields.map((f) => [f, (r as unknown as Record<string, unknown>)[f]])),
      ),
    );
  };
  return { get, urls };
}
