// T034: the fixed Austin pilot slice (PO D-3) and its per-permit captures. Written first;
// the implementation is T045 (travis/pilot/capture-austin.ts), which takes the include
// predicate from profiles/travis-austin@1.0.0 toSoqlInclude() (no term literal in that file).
//
// Interface this test fixes for T045:
//   buildSliceQueries({ include }) → SliceQuery[]  (september, expired, older_final)
//   captureAustin({ include, outDir, fetch, sleep, now, log, expectedCounts? })
//     → { status: "ok" | "blocked" | "failed", reason?, slices, permits, receipts }
//   files: <outDir>/<safe permit>.json, <outDir>/receipts.jsonl, <outDir>/slice.json
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUSTIN_DATASET_URL,
  D3_EXPECTED_COUNTS,
  buildSliceQueries,
  captureAustin,
} from "../../travis/pilot/capture-austin.js";
import { fakeHttp, json, silent, text } from "../fixtures/fake-http.js";

// A stand-in for toSoqlInclude(): tests are outside the FR-009 term scan.
const INCLUDE =
  "(upper(description) like '%REROOF%' OR upper(description) like '%RE-ROOF%' OR upper(description) like '%ROOF REPLACE%')";

type Row = Record<string, string | null>;

function row(n: string, over: Partial<Row> = {}): Row {
  return {
    permit_number: n,
    permittype: "BP",
    work_class: "Remodel",
    status_current: "Active",
    description: "Reroof",
    issue_date: "2026-09-02T00:00:00.000",
    completed_date: null,
    tcad_id: "0100030105",
    ":updated_at": "2026-10-20T12:36:38.000Z",
    ...over,
  };
}

const SEPT = Array.from({ length: 42 }, (_, i) => row(`2026-1${String(i).padStart(5, "0")} BP`));
const EXPIRED = Array.from({ length: 5 }, (_, i) =>
  row(`2026-02${String(i).padStart(4, "0")} BP`, {
    status_current: "Expired",
    issue_date: "2026-03-10T00:00:00.000",
  }),
);
const FINAL = Array.from({ length: 3 }, (_, i) =>
  row(`2014-00${String(i).padStart(4, "0")} BP`, {
    status_current: "Final",
    issue_date: "2014-04-01T00:00:00.000",
    completed_date: "2014-05-01T00:00:00.000",
  }),
);

/** A virtual clock: sleep advances it, fetch records the time of every call. */
function clock() {
  let t = Date.parse("2026-10-20T22:00:00.000Z");
  const times: number[] = [];
  return {
    now: () => new Date(t),
    sleep: async (ms: number) => {
      t += ms;
    },
    mark: () => times.push(t),
    times,
  };
}

function slice(url: URL): "september" | "expired" | "older_final" | null {
  const where = url.searchParams.get("$where") ?? "";
  if (url.searchParams.has("permit_number")) return null;
  if (where.includes("'Expired'")) return "expired";
  if (where.includes("'Final'")) return "older_final";
  return "september";
}

function routes(
  c: ReturnType<typeof clock>,
  opts: { blockPermit?: string; septCount?: number } = {},
) {
  const all = new Map([...SEPT, ...EXPIRED, ...FINAL].map((r) => [r.permit_number as string, r]));
  return fakeHttp([
    {
      match: (u) => u.href.startsWith(AUSTIN_DATASET_URL),
      respond: (u) => {
        c.mark();
        const s = slice(u);
        if (s === "september") return json(SEPT.slice(0, opts.septCount ?? 42));
        if (s === "expired") return json(EXPIRED);
        if (s === "older_final") return json(FINAL);
        const n = u.searchParams.get("permit_number") as string;
        if (n === opts.blockPermit) return text("<html>Access denied</html>", 403);
        const r = all.get(n);
        return json(r ? [r] : []);
      },
    },
  ]);
}

describe("buildSliceQueries (D-3)", () => {
  const queries = buildSliceQueries({ include: INCLUDE });

  it("has the three slices in order, each carrying the profile's include predicate", () => {
    expect(queries.map((q) => q.slice)).toEqual(["september", "expired", "older_final"]);
    for (const q of queries) expect(q.params.$where).toContain(INCLUDE);
  });

  it("september: issued 2026-09-01…30", () => {
    const q = at(queries, 0);
    expect(q.params.$where).toContain("issue_date >= '2026-09-01T00:00:00'");
    expect(q.params.$where).toContain("issue_date < '2026-10-01T00:00:00'");
    expect(q.params.$order).toBe("permit_number");
  });

  it("expired: oracle § B's rule, newest five", () => {
    const q = at(queries, 1);
    expect(q.params.$where).toContain("status_current='Expired'");
    expect(q.params.$where).toContain("permittype='BP'");
    expect(q.params.$where).toContain("tcad_id IS NOT NULL");
    expect(q.params.$order).toBe("issue_date DESC, permit_number");
    expect(q.params.$limit).toBe("5");
  });

  it("older_final: the same rule on Final before 2025-10-20, three rows", () => {
    const q = at(queries, 2);
    expect(q.params.$where).toContain("status_current='Final'");
    expect(q.params.$where).toContain("permittype='BP'");
    expect(q.params.$where).toContain("tcad_id IS NOT NULL");
    expect(q.params.$where).toContain("issue_date < '2025-10-20T00:00:00'");
    expect(q.params.$order).toBe("issue_date DESC, permit_number");
    expect(q.params.$limit).toBe("3");
  });

  it("the D-3 counts are 42 + 5 + 3", () => {
    expect(D3_EXPECTED_COUNTS).toEqual({ september: 42, expired: 5, older_final: 3 });
  });
});

describe("captureAustin", () => {
  it("captures one GET per permit, 50 in all, and writes each body and its receipt", async () => {
    const c = clock();
    const http = routes(c);
    const out = mkdtempSync(join(tmpdir(), "austin-"));
    const result = await captureAustin({
      include: INCLUDE,
      outDir: out,
      fetch: http.fetch,
      sleep: c.sleep,
      now: c.now,
      log: silent,
    });
    expect(result.status).toBe("ok");
    expect(result.slices.september).toHaveLength(42);
    expect(result.slices.expired).toHaveLength(5);
    expect(result.slices.older_final).toHaveLength(3);
    expect(result.permits).toHaveLength(50);
    const permitCalls = http.calls.filter((call) =>
      new URL(call.url).searchParams.has("permit_number"),
    );
    expect(permitCalls).toHaveLength(50);
    for (const call of permitCalls) expect(call.init.method ?? "GET").toBe("GET");
    expect(existsSync(join(out, "receipts.jsonl"))).toBe(true);
    expect(existsSync(join(out, "slice.json"))).toBe(true);
  });

  it("keeps at most one request per second", async () => {
    const c = clock();
    const http = routes(c);
    const out = mkdtempSync(join(tmpdir(), "austin-"));
    await captureAustin({
      include: INCLUDE,
      outDir: out,
      fetch: http.fetch,
      sleep: c.sleep,
      now: c.now,
      log: silent,
    });
    for (let i = 1; i < c.times.length; i += 1) {
      expect(at(c.times, i) - at(c.times, i - 1)).toBeGreaterThanOrEqual(1000);
    }
  });

  it("records url, method, multiValueQueryString, status, bytes, sha256 and captured_at per permit", async () => {
    const c = clock();
    const http = routes(c);
    const out = mkdtempSync(join(tmpdir(), "austin-"));
    const result = await captureAustin({
      include: INCLUDE,
      outDir: out,
      fetch: http.fetch,
      sleep: c.sleep,
      now: c.now,
      log: silent,
    });
    const lines = readFileSync(join(out, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const permitReceipts = lines.filter((r) => r.permit_number !== undefined);
    expect(permitReceipts).toHaveLength(50);
    const first = permitReceipts[0];
    expect(first).toMatchObject({
      permit_number: result.permits[0],
      method: "GET",
      multiValueQueryString: { permit_number: [result.permits[0]] },
      status: 200,
      outcome: "ok",
    });
    expect(first.url).toBe(
      `${AUSTIN_DATASET_URL}?permit_number=${encodeURIComponent(at(result.permits, 0))}`,
    );
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.captured_at).toMatch(/^2026-10-20T/);
    const body = readFileSync(
      join(out, `${at(result.permits, 0).replace(/[^A-Za-z0-9_-]/g, "_")}.json`),
    );
    expect(body.length).toBe(first.bytes);
  });

  it("stops on a 403 with a blocked receipt and makes no further request", async () => {
    const c = clock();
    const blocked = at(SEPT, 3).permit_number as string;
    const http = routes(c, { blockPermit: blocked });
    const out = mkdtempSync(join(tmpdir(), "austin-"));
    const result = await captureAustin({
      include: INCLUDE,
      outDir: out,
      fetch: http.fetch,
      sleep: c.sleep,
      now: c.now,
      log: silent,
    });
    expect(result.status).toBe("blocked");
    const last = at(http.calls, http.calls.length - 1);
    expect(new URL(last.url).searchParams.get("permit_number")).toBe(blocked);
    const lines = readFileSync(join(out, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ permit_number: blocked, status: 403, outcome: "blocked" });
  });

  it("stops when a slice count differs from D-3", async () => {
    const c = clock();
    const http = routes(c, { septCount: 41 });
    const out = mkdtempSync(join(tmpdir(), "austin-"));
    const result = await captureAustin({
      include: INCLUDE,
      outDir: out,
      fetch: http.fetch,
      sleep: c.sleep,
      now: c.now,
      log: silent,
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/september/);
    expect(
      http.calls.filter((call) => new URL(call.url).searchParams.has("permit_number")),
    ).toHaveLength(0);
  });
});

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}
