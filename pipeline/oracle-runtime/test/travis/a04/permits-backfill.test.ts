// A-04 T050/T051 (A-04-TC-041, A-04-TC-053, A-04-TC-054, AC-12): Austin keyset pages and the
// AustinPermits workflow. Synthetic test input only: a fake Socrata server answers every
// request (no network), a fake clock and a seeded RNG drive spacing and jitter, a journaling
// fake context stands in for Restate and an in-memory fake Loader for the Query DB.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUSTIN_PAGES,
  AUSTIN_3SYK_W9EU,
} from "../../../travis/adapters/socrata/austin-3syk-w9eu.js";
import {
  MAX_PAGE_SIZE,
  buildPageQuery,
  pagesFor,
} from "../../../travis/adapters/socrata/socrata-pages.js";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  USER_AGENT,
  createSourceClient,
} from "../../../travis/lib/source-client.js";
import { runAustinPermits, type PermitsDeps } from "../../../travis/permits/workflow.js";
import { command } from "../../../travis/backbone/commands/permits.js";
import type { RunContext } from "../../../travis/backbone/run-context.js";
import type { RestateIngressClient } from "../../../travis/backbone/restate-client.js";
import {
  fakeSocrata,
  fakeTime,
  seededRandom,
  synthId,
  synthRow,
  type Row,
} from "../../fixtures/a04/permits/fake-socrata.js";
import { FakeLoader, fakeIO } from "../../fixtures/a04/permits/fake-io.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "a04-permits-"));
  dirs.push(d);
  return d;
};
const silent = (): void => undefined;

function harness(
  rows: () => readonly Row[],
  opts: {
    fault?: Parameters<typeof fakeSocrata>[0]["fault"];
    pageSize?: number;
    onCall?: (url: URL, n: number) => void;
  } = {},
) {
  const time = fakeTime();
  const rng = seededRandom(7);
  const server = fakeSocrata({
    rows,
    clock: time.clock,
    fault: (url, n) => {
      opts.onCall?.(url, n);
      return opts.fault?.(url, n) ?? null;
    },
  });
  const client = createSourceClient({
    fetch: server.fetch,
    sleep: time.sleep,
    clock: time.clock,
    now: time.now,
    random: rng.random,
    hostSpacing: true,
    appToken: "",
    log: silent,
  });
  const root = tmp();
  const loader = new FakeLoader();
  const deps: PermitsDeps = {
    client,
    artifactsRoot: root,
    readWatermark: async () => null,
    limitations: () => [],
    ...(opts.pageSize !== undefined ? { pageSize: opts.pageSize } : {}),
  };
  return { time, rng, server, client, root, loader, deps };
}

const pageCalls = (calls: { url: URL }[]) =>
  calls.filter((c) => (c.url.searchParams.get("$select") ?? "").startsWith("*,"));
const starts = (calls: { t: number }[]) => calls.map((c) => c.t);

describe("A-04-TC-041 keyset pages: ≤ 50,000 rows, no app token, by :id, ≤ 1 request/s", () => {
  it("A-04-TC-041 every page asks $select=*,:id,:updated_at,:created_at, $order=:id, $limit=50000 and the next page $where=:id > last", async () => {
    // lean synthetic rows so two full-size pages stay cheap
    const rows: Row[] = Array.from({ length: MAX_PAGE_SIZE + 3 }, (_, i) => ({
      ":id": synthId(i),
      ":updated_at": "2026-10-01T00:00:00.000Z",
      permit_number: `P-${i}`,
    }));
    const h = harness(() => rows);
    const io = fakeIO(h.loader);
    const result = await runAustinPermits(
      io,
      { jobId: "travis-a04-permits-backfill-202610220300", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("complete");
    const pages = pageCalls(h.server.calls);
    expect(pages).toHaveLength(2);
    for (const c of pages) {
      expect(c.url.searchParams.get("$select")).toBe("*,:id,:updated_at,:created_at");
      expect(c.url.searchParams.get("$order")).toBe(":id");
      expect(c.url.searchParams.get("$limit")).toBe("50000");
    }
    expect(pages[0]?.url.searchParams.get("$where")).toBeNull();
    expect(pages[1]?.url.searchParams.get("$where")).toBe(`:id > '${synthId(49999)}'`);
    for (const c of h.server.calls) {
      expect(c.headers["x-app-token"]).toBeUndefined();
      expect(c.url.searchParams.has("$$app_token")).toBe(false);
      expect(c.headers["user-agent"]).toBe(USER_AGENT);
    }
    const t = starts(h.server.calls);
    for (let i = 1; i < t.length; i += 1)
      expect((t[i] ?? 0) - (t[i - 1] ?? 0)).toBeGreaterThanOrEqual(1_000);
    expect(result.rows).toBe(MAX_PAGE_SIZE + 3);
  });

  it("A-04-TC-041 the Austin page config: system fields after *, 50,000 rows, 48 pages for 2,381,226 rows", () => {
    expect(AUSTIN_PAGES.select).toBe("*,:id,:updated_at,:created_at");
    expect(AUSTIN_PAGES.pageSize).toBe(50_000);
    expect(AUSTIN_PAGES.source).toBe(AUSTIN_3SYK_W9EU);
    expect(pagesFor(2_381_226, AUSTIN_PAGES.pageSize)).toBe(48);
    const q = buildPageQuery(AUSTIN_PAGES, "row-a'b");
    expect(q.params.$where).toBe(":id > 'row-a''b'");
    expect(() => buildPageQuery({ ...AUSTIN_PAGES, pageSize: 50_001 }, null)).toThrow(/50000/);
    expect(() => buildPageQuery({ ...AUSTIN_PAGES, select: ":id,*" }, null)).toThrow(/select/);
  });
});

describe("A-04-TC-053 429 / 5xx back off on the same cursor; a 403 stops at once", () => {
  const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
  const page3 = (url: URL): boolean => url.searchParams.get("$where") === `:id > '${synthId(20)}'`;

  it("A-04-TC-053 page 3 answers 429, 503, 503 and is committed on attempt 4; waits are full jitter; starts ≥ 1 s apart; no gap", async () => {
    let page3Calls = 0;
    const h = harness(() => rows, {
      pageSize: 10,
      fault: (url) => {
        if (!page3(url)) return null;
        page3Calls += 1;
        return page3Calls === 1 ? 429 : page3Calls <= 3 ? 503 : null;
      },
    });
    const io = fakeIO(h.loader);
    const result = await runAustinPermits(
      io,
      { jobId: "travis-a04-permits-backfill-202610220301", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(result.exitCode).toBe(0);
    const p3 = h.server.calls.filter((c) => page3(c.url));
    expect(p3).toHaveLength(4); // the same cursor asked again, page 3 fetched on attempt 4
    // full jitter: gap k = max(1 s spacing, floor(r_k × min(60 s, 1 s × 2^(k−1))))
    for (let k = 1; k <= 3; k += 1) {
      const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (k - 1));
      const r = h.rng.drawn[k - 1] ?? -1;
      const delay = Math.floor(r * ceiling);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(ceiling);
      const gap = (p3[k]?.t ?? 0) - (p3[k - 1]?.t ?? 0);
      expect(gap).toBe(Math.max(1_000, delay));
    }
    const t = starts(h.server.calls);
    for (let i = 1; i < t.length; i += 1)
      expect((t[i] ?? 0) - (t[i - 1] ?? 0)).toBeGreaterThanOrEqual(1_000);
    // pages contiguous by :id, nothing skipped or doubled
    const wheres = pageCalls(h.server.calls).map((c) => c.url.searchParams.get("$where"));
    expect([...new Set(wheres)]).toEqual([
      null,
      `:id > '${synthId(10)}'`,
      `:id > '${synthId(20)}'`,
    ]);
    expect(h.loader.current.size).toBe(25);
    const receipts = readFileSync(
      join(h.root, "travis-a04-permits-backfill-202610220301", "receipts.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind: string; page_index: number | null; attempts: number });
    expect(receipts.find((r) => r.kind === "page" && r.page_index === 3)?.attempts).toBe(4);
  });

  it("A-04-TC-053 a page failing all 5 attempts stops the run failed without advancing the watermark", async () => {
    const page2 = (url: URL): boolean =>
      url.searchParams.get("$where") === `:id > '${synthId(10)}'`;
    const h = harness(() => rows, { pageSize: 10, fault: (url) => (page2(url) ? 503 : null) });
    const io = fakeIO(h.loader);
    const result = await runAustinPermits(
      io,
      { jobId: "travis-a04-permits-backfill-202610220302", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(h.server.calls.filter((c) => page2(c.url))).toHaveLength(5);
    expect(h.loader.watermark).toBeNull();
    expect(h.loader.runs.get("travis-a04-permits-backfill-202610220302")?.status).toBe("failed");
  });

  it("A-04-TC-053 a 403 makes exactly one request, a blocked receipt (http_status 403), exit 2, and no further request", async () => {
    const page2 = (url: URL): boolean =>
      url.searchParams.get("$where") === `:id > '${synthId(10)}'`;
    const h = harness(() => rows, { pageSize: 10, fault: (url) => (page2(url) ? 403 : null) });
    const io = fakeIO(h.loader);
    const jobId = "travis-a04-permits-backfill-202610220303";
    const result = await runAustinPermits(io, { jobId, mode: "backfill" }, h.deps);
    expect(result.exitCode).toBe(2);
    expect(result.status).toBe("waiting_human");
    const idx = h.server.calls.findIndex((c) => page2(c.url));
    expect(idx).toBe(h.server.calls.length - 1); // the 403 was the last request of the run
    expect(h.server.calls.filter((c) => page2(c.url))).toHaveLength(1);
    const lines = readFileSync(join(h.root, jobId, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n");
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as {
      outcome: string;
      http_status: number;
      blocked_at: string | null;
    };
    expect(last.outcome).toBe("blocked");
    expect(last.http_status).toBe(403);
    expect(last.blocked_at).not.toBeNull();
    expect(h.loader.watermark).toBeNull();
    expect(h.loader.runs.get(jobId)?.status).toBe("waiting_human");
  });

  it("A-04-TC-053 the permits verb exits 2 when the workflow stopped blocked", async () => {
    const sent: unknown[] = [];
    const ingress: RestateIngressClient = {
      call: async () => null as never,
      send: async (...args) => {
        sent.push(args);
        return { invocationId: "inv_1" };
      },
      callLong: async <T>() => null as T,
      get: async () => ({ status: "waiting_human", exitCode: 2, pages: 1, rows: 10 }) as never,
    };
    const printed: string[] = [];
    const ctx = {
      jobId: "travis-a04-202610220300",
      asOf: () => "2026-10-22",
      ingress,
      diskGuard: () => undefined,
      sourceClient: () => {
        throw new Error("the verb never fetches itself");
      },
      print: (l: string) => printed.push(l),
      jobIdFor: (kind: string | null) => `travis-a04-${kind ?? ""}-202610220300`,
    } as RunContext;
    const out = await command.run(ctx, command.args.parse({ mode: "backfill" }));
    expect(out.exitCode).toBe(2);
    expect(out.jobId).toBe("travis-a04-permits-backfill-202610220300");
    expect(sent[0]).toEqual([
      "AustinPermits",
      "austin-3syk-w9eu-backfill-202610220300",
      "run",
      { jobId: "travis-a04-permits-backfill-202610220300", mode: "backfill" },
    ]);
    expect(() => command.args.parse({})).toThrow();
    expect(() => command.args.parse({ mode: "backfill", link: true })).toThrow();
    expect(command.args.parse({ link: true })).toEqual({ link: true });
  });
});

describe("A-04-TC-054 stop → resume from the last committed page (journal replay)", () => {
  it("A-04-TC-054 a kill while page 6 is in flight: replay asks page 6 again, pages 1–5 are not refetched, 0 duplicated or skipped rows", async () => {
    const rows = Array.from({ length: 65 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, { pageSize: 10 });
    let killed = false;
    const io1 = fakeIO(h.loader, {
      kill: (name) => {
        if (name === "page-000006" && !killed) {
          killed = true;
          return true;
        }
        return false;
      },
    });
    const input = { jobId: "travis-a04-permits-backfill-202610220304", mode: "backfill" as const };
    await expect(runAustinPermits(io1, input, h.deps)).rejects.toThrow(/synthetic kill/);
    const before = h.server.calls.length;
    const io2 = fakeIO(h.loader, { journal: io1.journal });
    const result = await runAustinPermits(io2, input, h.deps);
    expect(result.status).toBe("complete");
    const after = h.server.calls.slice(before);
    expect(after[0]?.url.searchParams.get("$where")).toBe(`:id > '${synthId(50)}'`);
    const byWhere = new Map<string | null, number>();
    for (const c of pageCalls(h.server.calls)) {
      const w = c.url.searchParams.get("$where");
      byWhere.set(w, (byWhere.get(w) ?? 0) + 1);
    }
    for (const w of [
      null,
      `:id > '${synthId(10)}'`,
      `:id > '${synthId(20)}'`,
      `:id > '${synthId(30)}'`,
      `:id > '${synthId(40)}'`,
    ]) {
      expect(byWhere.get(w)).toBe(1);
    }
    expect(byWhere.get(`:id > '${synthId(50)}'`)).toBe(2); // in flight when killed, then once more
    expect(h.loader.pageWrites.filter((p) => p.pageIndex === 6)).toHaveLength(1);
    for (const s of [...io1.steps, ...io2.steps].filter((x) => x.name.startsWith("page-"))) {
      expect(Object.keys(s.value as object).sort()).toEqual([
        "lastId",
        "maxUpdatedAt",
        "rows",
        "sha256",
      ]);
    }
    expect(h.loader.current.size).toBe(65);
    expect(result.rows).toBe(65);
  });
});

describe("AC-12 count at the watermark (A-04-TC-040 logic)", () => {
  it("A-04-TC-040 W = max(:updated_at) of the captured rows; captured ≤ W = source count at W; start = end total", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      synthRow(i + 1, {
        ":updated_at": `2026-10-${String(1 + (i % 9)).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const h = harness(() => rows, { pageSize: 10 });
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220305", mode: "backfill" },
      h.deps,
    );
    expect(result.watermark).toBe("2026-10-09T00:00:00.000Z");
    expect(result.startTotal).toBe(25);
    expect(result.endTotal).toBe(25);
    expect(result.capturedAtW).toBe(25);
    expect(result.sourceCountAtW).toBe(25);
    expect(result.aboveW).toBe(0);
    expect(result.watermarkCheck).toBe("pass");
    expect(result.keysetDiffRequested).toBe(false);
    expect(h.loader.watermark).toMatchObject({
      lastId: synthId(25),
      maxUpdatedAt: "2026-10-09T00:00:00.000Z",
      sourceCountAtW: 25,
    });
    const countWhere = h.server.calls
      .filter((c) => c.url.searchParams.get("$select") === "count(*) AS n")
      .map((c) => c.url.searchParams.get("$where"));
    expect(countWhere).toEqual([null, ":updated_at <= '2026-10-09T00:00:00.000Z'", null]);
  });

  it("A-04-TC-040 a row re-stamped and a row added during paging: above W counted, check fails, key-set diff requested", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
    let changed = false;
    const h = harness(() => rows, {
      pageSize: 10,
      onCall: (url) => {
        if (!changed && url.searchParams.get("$where") === `:id > '${synthId(10)}'`) {
          changed = true;
          rows[2] = { ...(rows[2] as Row), ":updated_at": "2026-10-30T00:00:00.000Z" };
          rows.push(synthRow(99));
        }
      },
    });
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220306", mode: "backfill" },
      h.deps,
    );
    expect(result.startTotal).toBe(25);
    expect(result.endTotal).toBe(26);
    expect(result.capturedAtW).toBe(26);
    expect(result.sourceCountAtW).toBe(25);
    expect(result.aboveW).toBe(1);
    expect(result.watermarkCheck).toBe("fail");
    expect(result.keysetDiffRequested).toBe(true);
  });

  it("pilot = maxPages 1: one page request, no watermark written", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, { pageSize: 10 });
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-pilot-202610220307", mode: "pilot" },
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(pageCalls(h.server.calls)).toHaveLength(1);
    expect(result.pages).toBe(1);
    expect(h.loader.watermark).toBeNull();
    expect(h.loader.current.size).toBe(10);
  });
});
