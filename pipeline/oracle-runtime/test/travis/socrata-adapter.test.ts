// T025: the generic Socrata permit adapter (county-permit-adapter contract) and its Austin
// 3syk-w9eu configuration. Written first; the implementation is T035
// (travis/adapters/socrata/{socrata,austin-3syk-w9eu}.ts).
//
// Interface this test fixes for T035:
//   socrata.ts
//     buildListQuery({ source, window, include, pageSize? }) → { name, url, params }
//     permitUrl(source, value) · safePermitName(value) · datasetUrl(source)
//     captureSocrata({ source, window, include, jobDir, fetch, sleep, now, random, log, pageSize? })
//       → { status: "ok" | "blocked" | "error", reason?, listed, captured, skipped, receipts, watermark }
//     files under jobDir: permit-lists/<name>.json (+ .receipt.json), raw/<key>.json,
//       extracted/<key>.json, status/<key>.json, receipts.jsonl, job.json
//     POLITENESS, MAX_PAGE_SIZE, MIN_REQUEST_GAP_MS, backoffDelayMs, exitCodeFor(status)
//   austin-3syk-w9eu.ts
//     AUSTIN_3SYK_W9EU (source) · monthWindow("2026-09") · austinInclude()
//
// Politeness (A6, oracle § 1): identified User-Agent, no app token, at most one request per
// second to the host including retries, backoff only on 429/5xx (1 s base, 60 s cap, 5
// attempts, full jitter), and the first 403 or challenge writes a `blocked` receipt and
// stops the run (exit 2). The list query never carries `tcad_id IS NOT NULL`: the permit
// with no TCAD id must be captured so it can be counted.
//
// The include predicate is a stand-in here (tests are outside the adapter term gate); the
// adapter files themselves must not contain any classification term.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RULES, toSoqlInclude } from "../../../../profiles/travis-austin@1.0.0/index.js";
import {
  AUSTIN_3SYK_W9EU,
  austinInclude,
  monthWindow,
} from "../../travis/adapters/socrata/austin-3syk-w9eu.js";
import {
  MAX_PAGE_SIZE,
  MIN_REQUEST_GAP_MS,
  POLITENESS,
  backoffDelayMs,
  buildListQuery,
  captureSocrata,
  datasetUrl,
  exitCodeFor,
  loadCaptures,
  permitUrl,
  safePermitName,
  type SocrataSource,
} from "../../travis/adapters/socrata/socrata.js";
import type { FetchLike } from "../../travis/lib/source-client.js";
import { fakeHttp, json, silent, text, type RecordedCall } from "../fixtures/fake-http.js";

// A stand-in for the profile's toSoqlInclude(): the test is outside the adapter term gate.
const INCLUDE = "(upper(description) like '%STAND-IN TERM%')";

/** A generic source for the adapter tests (no dependency on the Austin configuration). */
const SOURCE: SocrataSource = {
  name: "test-src1-abcd",
  domain: "data.example.test",
  dataset: "src1-abcd",
  key: "permit_number",
  dateField: "issue_date",
  watermarkField: ":updated_at",
};
const WINDOW = { from: "2026-09-01T00:00:00", to: "2026-10-01T00:00:00" };
const BASE = `https://${SOURCE.domain}/resource/${SOURCE.dataset}.json`;

type Row = Record<string, string | null>;

function row(n: string, over: Partial<Row> = {}): Row {
  return {
    permit_number: n,
    permittype: "BP",
    work_class: "Remodel",
    status_current: "Active",
    description: "Stand-in description",
    issue_date: "2026-09-02T00:00:00.000",
    completed_date: null,
    tcad_id: "0100030105",
    ":updated_at": "2026-10-20T12:36:38.000Z",
    ...over,
  };
}

const ROWS: Row[] = [
  row("2026-100001 BP"),
  row("2026-100002 BP", { tcad_id: null, ":updated_at": "2026-10-21T01:02:03.000Z" }),
  row("2026-100003 EP", { permittype: "EP" }),
];

/** A virtual clock: sleep advances it; fetch records the time of every call. */
function clock() {
  let t = Date.parse("2026-10-21T11:00:00.000Z");
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

interface RouteOptions {
  /** Scripted answers per permit, consumed in order; the last one repeats. */
  script?: Record<string, Array<() => Response>>;
  rows?: Row[];
}

function routes(c: ReturnType<typeof clock>, opts: RouteOptions = {}) {
  const rows = opts.rows ?? ROWS;
  const byNumber = new Map(rows.map((r) => [r.permit_number as string, r]));
  const consumed = new Map<string, number>();
  return fakeHttp([
    {
      match: (u) => u.href.startsWith(BASE),
      respond: (u) => {
        c.mark();
        const n = u.searchParams.get(SOURCE.key);
        if (n === null) {
          // the list query: key + watermark of every row in the window, capped by $limit
          const limit = Number(u.searchParams.get("$limit") ?? "1000");
          return json(
            rows
              .slice(0, limit)
              .map((r) => ({ permit_number: r.permit_number, ":updated_at": r[":updated_at"] })),
          );
        }
        const scripted = opts.script?.[n];
        if (scripted !== undefined && scripted.length > 0) {
          const i = consumed.get(n) ?? 0;
          consumed.set(n, i + 1);
          const step = scripted[Math.min(i, scripted.length - 1)] as () => Response;
          return step();
        }
        const r = byNumber.get(n);
        return json(r ? [r] : []);
      },
    },
  ]);
}

function run(c: ReturnType<typeof clock>, http: ReturnType<typeof fakeHttp>, jobDir: string) {
  return captureSocrata({
    source: SOURCE,
    window: WINDOW,
    include: INCLUDE,
    jobDir,
    fetch: http.fetch,
    sleep: c.sleep,
    now: c.now,
    random: () => 0,
    log: silent,
  });
}

const tmp = (): string => mkdtempSync(join(tmpdir(), "socrata-"));
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const permitCalls = (http: ReturnType<typeof fakeHttp>) =>
  http.calls.filter((call) => new URL(call.url).searchParams.has(SOURCE.key));
/** The permit key each permit GET asked for, in request order. */
const permitKeys = (http: ReturnType<typeof fakeHttp>) =>
  permitCalls(http).map((call) => new URL(call.url).searchParams.get(SOURCE.key));
/** The User-Agent header a recorded request carried (undefined when none). */
function userAgentOf(call: RecordedCall): string | undefined {
  const headers = (call.init.headers ?? {}) as Record<string, string>;
  const name = Object.keys(headers).find((h) => h.toLowerCase() === "user-agent");
  return name === undefined ? undefined : headers[name];
}

describe("buildListQuery", () => {
  const q = buildListQuery({ source: SOURCE, window: WINDOW, include: INCLUDE });
  const url = new URL(q.url);

  it("targets the source dataset and selects the key and the watermark field", () => {
    expect(datasetUrl(SOURCE)).toBe(BASE);
    expect(url.origin + url.pathname).toBe(BASE);
    const select = (url.searchParams.get("$select") ?? "").replace(/\s+/g, "");
    expect(select).toBe("permit_number,:updated_at");
  });

  it("carries the include predicate and the issue-date window, ordered by the key", () => {
    expect(q.params.$where).toContain(INCLUDE);
    expect(q.params.$where).toContain("issue_date >= '2026-09-01T00:00:00'");
    expect(q.params.$where).toContain("issue_date < '2026-10-01T00:00:00'");
    expect(q.params.$order).toBe("permit_number");
    expect(url.searchParams.get("$where")).toBe(q.params.$where);
  });

  it("asks for one page of at most 50,000 rows", () => {
    expect(MAX_PAGE_SIZE).toBe(50_000);
    expect(Number(q.params.$limit)).toBeLessThanOrEqual(50_000);
    expect(q.params.$limit).toBe("50000");
    expect(() =>
      buildListQuery({ source: SOURCE, window: WINDOW, include: INCLUDE, pageSize: 50_001 }),
    ).toThrow(/50,000/);
  });

  it("never filters on tcad_id (the no-TCAD permit must be captured and counted)", () => {
    expect(q.params.$where).not.toMatch(/tcad_id/i);
    expect(q.url).not.toMatch(/tcad_id/i);
  });

  it("names the window so the list file is deterministic", () => {
    expect(q.name).toBe("issue_date-2026-09-01-2026-10-01");
  });
});

describe("permit keys and URLs", () => {
  it("one GET per permit, by the key field", () => {
    expect(permitUrl(SOURCE, "2026-100001 BP")).toBe(`${BASE}?permit_number=2026-100001%20BP`);
  });

  it("safePermitName is deterministic and file-name safe", () => {
    expect(safePermitName("2026-034767 BP")).toMatch(/^2026-034767_BP-[0-9a-f]{8}$/);
    expect(safePermitName("2026-034767 BP")).toBe(safePermitName("2026-034767 BP"));
    expect(safePermitName("a/b\\c:d*e?f")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("safePermitName is collision-free for numbers that sanitise alike (CR-A-03 code-review #6)", () => {
    expect(safePermitName("2026-1 BP")).not.toBe(safePermitName("2026-1/BP"));
    expect(safePermitName("2026-1 BP").startsWith("2026-1_BP-")).toBe(true);
    expect(safePermitName("2026-1/BP").startsWith("2026-1_BP-")).toBe(true);
  });
});

describe("Austin 3syk-w9eu configuration", () => {
  it("names the profile's dataset and uses the profile's include predicate", () => {
    expect(AUSTIN_3SYK_W9EU.name).toBe("austin-3syk-w9eu");
    expect(AUSTIN_3SYK_W9EU.key).toBe("permit_number");
    expect(datasetUrl(AUSTIN_3SYK_W9EU)).toBe(RULES.dataset.url);
    expect(austinInclude()).toBe(toSoqlInclude());
  });

  it("monthWindow covers the calendar month in Socrata floating timestamps", () => {
    expect(monthWindow("2026-09")).toEqual({
      from: "2026-09-01T00:00:00",
      to: "2026-10-01T00:00:00",
    });
    expect(monthWindow("2026-12")).toEqual({
      from: "2026-12-01T00:00:00",
      to: "2027-01-01T00:00:00",
    });
    expect(() => monthWindow("2026-9")).toThrow(/YYYY-MM/);
    expect(() => monthWindow("2026-13")).toThrow(/month/i);
  });
});

describe("captureSocrata", () => {
  it("lists once, then GETs each permit once, writing raw body, extracted row, receipt and status", async () => {
    const c = clock();
    const http = routes(c);
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("ok");
    expect(result.listed).toEqual(ROWS.map((r) => r.permit_number));
    expect(result.captured).toEqual(ROWS.map((r) => r.permit_number));
    expect(result.skipped).toEqual([]);
    expect(http.calls).toHaveLength(1 + ROWS.length);
    const first = http.calls[0] as { url: string };
    expect(new URL(first.url).searchParams.has("$where")).toBe(true);
    const calls = permitCalls(http);
    expect(calls).toHaveLength(ROWS.length);
    for (const call of calls) expect(call.init.method ?? "GET").toBe("GET");

    expect(existsSync(join(jobDir, "permit-lists", "issue_date-2026-09-01-2026-10-01.json"))).toBe(
      true,
    );
    expect(
      existsSync(join(jobDir, "permit-lists", "issue_date-2026-09-01-2026-10-01.receipt.json")),
    ).toBe(true);
    for (const r of ROWS) {
      const key = safePermitName(r.permit_number as string);
      const raw = readFileSync(join(jobDir, "raw", `${key}.json`));
      expect(JSON.parse(raw.toString("utf8"))).toEqual([r]);
      expect(readJson(join(jobDir, "extracted", `${key}.json`))).toEqual(r);
      const status = readJson(join(jobDir, "status", `${key}.json`));
      expect(status).toMatchObject({
        key,
        permit_number: r.permit_number,
        state: "captured",
        captured: true,
        sha256: createHash("sha256").update(raw).digest("hex"),
        file: `raw/${key}.json`,
      });
    }
    expect(readdirSync(join(jobDir, "status")).sort()).toEqual(
      ROWS.map((r) => `${safePermitName(r.permit_number as string)}.json`).sort(),
    );
    const job = readJson(join(jobDir, "job.json"));
    expect(job).toMatchObject({ status: "ok", source: SOURCE.name, listed: 3, captured: 3 });
    // the source watermark is the max Socrata :updated_at of the listed rows
    expect(result.watermark).toBe("2026-10-21T01:02:03.000Z");
    expect(job.watermark).toBe("2026-10-21T01:02:03.000Z");
  });

  it("records url, multiValueQueryString, status, bytes, sha256, captured_at, outcome, ua and attempts per permit", async () => {
    const c = clock();
    const http = routes(c);
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    const lines = readFileSync(join(jobDir, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(ROWS.length);
    expect(result.receipts).toHaveLength(ROWS.length);
    const n = ROWS[0]?.permit_number as string;
    const first = lines[0] as Record<string, unknown>;
    expect(Object.keys(first)).toEqual(
      expect.arrayContaining([
        "url",
        "multiValueQueryString",
        "status",
        "bytes",
        "sha256",
        "captured_at",
        "outcome",
        "ua",
        "attempts",
      ]),
    );
    expect(first).toMatchObject({
      permit_number: n,
      key: safePermitName(n),
      url: permitUrl(SOURCE, n),
      method: "GET",
      multiValueQueryString: { permit_number: [n] },
      status: 200,
      outcome: "ok",
      attempts: 1,
      app_token_used: false,
    });
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.captured_at).toMatch(/^2026-10-21T/);
    expect(first.ua).toContain("oracle-property-intelligence-platform-pipeline-travis-tx");
    const body = readFileSync(join(jobDir, "raw", `${safePermitName(n)}.json`));
    expect(body.length).toBe(first.bytes);
    expect(createHash("sha256").update(body).digest("hex")).toBe(first.sha256);
  });

  it("skips keys already captured on a re-run (idempotent; only the list is re-queried)", async () => {
    const c = clock();
    const jobDir = tmp();
    await run(c, routes(c), jobDir);
    const again = routes(c);
    const result = await run(c, again, jobDir);
    expect(result.status).toBe("ok");
    expect(permitCalls(again)).toHaveLength(0);
    expect(again.calls).toHaveLength(1);
    expect(result.skipped).toEqual(ROWS.map((r) => r.permit_number));
    expect(result.captured).toEqual([]);
  });

  it("keeps at most one request per second to the host", async () => {
    const c = clock();
    const http = routes(c);
    await run(c, http, tmp());
    expect(MIN_REQUEST_GAP_MS).toBe(1_000);
    expect(c.times.length).toBe(1 + ROWS.length);
    for (let i = 1; i < c.times.length; i += 1) {
      expect(at(c.times, i) - at(c.times, i - 1)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("retries a 429 with backoff and still keeps one request per second, retries included", async () => {
    const c = clock();
    const n = ROWS[1]?.permit_number as string;
    const http = routes(c, {
      script: { [n]: [() => text("slow down", 429), () => json([ROWS[1]])] },
    });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("ok");
    expect(permitCalls(http)).toHaveLength(ROWS.length + 1);
    const receipt = result.receipts.find((r) => r.permit_number === n);
    expect(receipt).toMatchObject({ outcome: "ok", attempts: 2, status: 200 });
    for (let i = 1; i < c.times.length; i += 1) {
      expect(at(c.times, i) - at(c.times, i - 1)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("backs off only on 429/5xx: full jitter, 1 s base, 60 s cap, 5 attempts", () => {
    expect(POLITENESS).toMatchObject({
      minRequestGapMs: 1_000,
      backoffBaseMs: 1_000,
      backoffCapMs: 60_000,
      maxAttempts: 5,
      retryOn: "429 and 5xx only",
      appToken: false,
    });
    expect(backoffDelayMs(1, () => 0.5)).toBe(500);
    expect(backoffDelayMs(3, () => 0.5)).toBe(2_000);
    expect(backoffDelayMs(9, () => 0.5)).toBe(30_000);
    expect(backoffDelayMs(9, () => 0.999)).toBeLessThan(60_000);
  });

  it("gives up after 5 attempts on a persistent 5xx, with an error receipt, and stops", async () => {
    const c = clock();
    const n = ROWS[0]?.permit_number as string;
    const http = routes(c, { script: { [n]: [() => text("down", 503)] } });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(new RegExp(n.replace(" ", " ")));
    expect(permitCalls(http)).toHaveLength(5);
    const receipt = at(result.receipts, 0);
    expect(receipt).toMatchObject({ permit_number: n, outcome: "error", attempts: 5, status: 503 });
    expect(readJson(join(jobDir, "status", `${safePermitName(n)}.json`))).toMatchObject({
      state: "error",
      captured: false,
    });
    expect(existsSync(join(jobDir, "raw", `${safePermitName(n)}.json`))).toBe(false);
    expect(exitCodeFor(result.status)).toBe(1);
  });

  it("does not retry a 404: one attempt, error receipt, run stops", async () => {
    const c = clock();
    const n = ROWS[0]?.permit_number as string;
    const http = routes(c, { script: { [n]: [() => text("gone", 404)] } });
    const result = await run(c, http, tmp());
    expect(result.status).toBe("error");
    expect(permitCalls(http)).toHaveLength(1);
    expect(at(result.receipts, 0)).toMatchObject({ outcome: "error", attempts: 1, status: 404 });
  });

  it("A-03-TC-006: stops on the first 403 with a blocked receipt and makes no further request (exit 2)", async () => {
    const c = clock();
    const blocked = ROWS[1]?.permit_number as string;
    const http = routes(c, {
      script: { [blocked]: [() => text("<html>Access denied</html>", 403)] },
    });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("blocked");
    expect(exitCodeFor(result.status)).toBe(2);
    const last = at(http.calls, http.calls.length - 1);
    expect(new URL(last.url).searchParams.get(SOURCE.key)).toBe(blocked);
    expect(permitCalls(http)).toHaveLength(2);
    const lines = readFileSync(join(jobDir, "receipts.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(at(lines, lines.length - 1))).toMatchObject({
      permit_number: blocked,
      status: 403,
      outcome: "blocked",
      attempts: 1,
      blocked_reason: "http-403",
    });
    expect(readJson(join(jobDir, "status", `${safePermitName(blocked)}.json`))).toMatchObject({
      state: "blocked",
      captured: false,
    });
    expect(readJson(join(jobDir, "job.json"))).toMatchObject({ status: "blocked" });
    expect(result.captured).toEqual([ROWS[0]?.permit_number]);
  });

  it("A-03-TC-006: treats a challenge as blocked, whatever the status", async () => {
    const c = clock();
    const n = ROWS[0]?.permit_number as string;
    const http = routes(c, {
      script: { [n]: [() => json([ROWS[0]], 200, { "cf-mitigated": "challenge" })] },
    });
    const result = await run(c, http, tmp());
    expect(result.status).toBe("blocked");
    expect(at(result.receipts, 0)).toMatchObject({
      outcome: "blocked",
      blocked_reason: "challenge",
    });
    expect(permitCalls(http)).toHaveLength(1);
  });

  // T084: the assertions TC-006 names that the two cases above do not make (FR-014, A6):
  // the blocked request is attempted once, nothing is requested after it, and the same
  // identified User-Agent is on every request (no rotation), for a 403 and for a 200 page.
  it("A-03-TC-006: the first 403 is never retried; the User-Agent is identical on every request", async () => {
    const c = clock();
    const blocked = ROWS[1]?.permit_number as string;
    const http = routes(c, {
      script: { [blocked]: [() => text("<html>Access denied</html>", 403)] },
    });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("blocked");
    expect(exitCodeFor(result.status)).toBe(2);
    // the list, the first permit, the blocked permit once, and nothing after it
    expect(http.calls).toHaveLength(3);
    expect(permitKeys(http)).toEqual([ROWS[0]?.permit_number, blocked]);
    expect(permitKeys(http).filter((k) => k === blocked)).toHaveLength(1);
    const agents = new Set(http.calls.map(userAgentOf));
    expect(agents.size).toBe(1);
    const [ua] = agents;
    expect(ua).toContain("oracle-property-intelligence-platform-pipeline-travis-tx");
    for (const r of result.receipts) expect(r.ua).toBe(ua);
    expect(at(result.receipts, result.receipts.length - 1)).toMatchObject({
      permit_number: blocked,
      outcome: "blocked",
      attempts: 1,
      status: 403,
      blocked_reason: "http-403",
    });
    expect(existsSync(join(jobDir, "raw", `${safePermitName(blocked)}.json`))).toBe(false);
  });

  it("A-03-TC-006: a 200 bot-challenge page is blocked at first sight: one attempt, no further request, exit 2", async () => {
    const c = clock();
    const blocked = ROWS[1]?.permit_number as string;
    const page =
      '<html><head><title>Just a moment...</title></head><body><form id="challenge-form"></form></body></html>';
    const http = routes(c, { script: { [blocked]: [() => text(page, 200)] } });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("blocked");
    expect(exitCodeFor(result.status)).toBe(2);
    expect(http.calls).toHaveLength(3);
    expect(permitKeys(http)).toEqual([ROWS[0]?.permit_number, blocked]);
    const agents = new Set(http.calls.map(userAgentOf));
    expect(agents.size).toBe(1);
    for (const r of result.receipts) expect(r.ua).toBe([...agents][0]);
    expect(at(result.receipts, 1)).toMatchObject({
      permit_number: blocked,
      outcome: "blocked",
      attempts: 1,
      status: 200,
      blocked_reason: "challenge",
    });
    expect(readJson(join(jobDir, "status", `${safePermitName(blocked)}.json`))).toMatchObject({
      state: "blocked",
      captured: false,
    });
    expect(readJson(join(jobDir, "job.json"))).toMatchObject({ status: "blocked" });
    expect(existsSync(join(jobDir, "raw", `${safePermitName(blocked)}.json`))).toBe(false);
    expect(result.captured).toEqual([ROWS[0]?.permit_number]);
  });

  it("A-03-TC-006: stops when the list query is blocked, before any permit GET", async () => {
    const c = clock();
    const http = fakeHttp([
      {
        match: (u) => u.href.startsWith(BASE),
        respond: () => text("<html>Access denied</html>", 403),
      },
    ]);
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("blocked");
    expect(http.calls).toHaveLength(1);
    expect(readJson(join(jobDir, "job.json"))).toMatchObject({ status: "blocked" });
    expect(result.listed).toEqual([]);
  });

  it("is one pass: a full page is an error, not a second page", async () => {
    const c = clock();
    const http = routes(c);
    const result = await captureSocrata({
      source: SOURCE,
      window: WINDOW,
      include: INCLUDE,
      jobDir: tmp(),
      fetch: http.fetch,
      sleep: c.sleep,
      now: c.now,
      random: () => 0,
      log: silent,
      pageSize: 2,
    });
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/one pass/);
    expect(http.calls).toHaveLength(1);
  });

  it("exit codes: ok 0, error 1, blocked 2", () => {
    expect(exitCodeFor("ok")).toBe(0);
    expect(exitCodeFor("error")).toBe(1);
    expect(exitCodeFor("blocked")).toBe(2);
  });
});

describe("identity (A6)", () => {
  const saved = process.env.SOCRATA_APP_TOKEN;
  afterEach(() => {
    if (saved === undefined) delete process.env.SOCRATA_APP_TOKEN;
    else process.env.SOCRATA_APP_TOKEN = saved;
  });

  it("sends the identified User-Agent and never an app token, even when one is in the environment", async () => {
    process.env.SOCRATA_APP_TOKEN = "unit-test-token-never-sent";
    const c = clock();
    const http = routes(c);
    const result = await run(c, http, tmp());
    expect(result.status).toBe("ok");
    for (const call of http.calls) {
      const headers = (call.init.headers ?? {}) as Record<string, string>;
      const names = Object.keys(headers).map((h) => h.toLowerCase());
      expect(names).toContain("user-agent");
      expect(headers["user-agent"]).toContain(
        "oracle-property-intelligence-platform-pipeline-travis-tx",
      );
      expect(names).not.toContain("x-app-token");
      expect(JSON.stringify(headers)).not.toContain("unit-test-token-never-sent");
      expect(call.url).not.toContain("app_token");
    }
    for (const r of result.receipts) expect(r.app_token_used).toBe(false);
  });
});

describe("adapter files carry no classification term", () => {
  const dir = new URL("../../travis/adapters/socrata/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("has the adapter files (A-04 T050 adds the keyset-page module; A-07 T010 adds tx-comptroller)", () => {
    expect(files.sort()).toEqual([
      "austin-3syk-w9eu.ts",
      "socrata-pages.ts",
      "socrata.ts",
      "tx-comptroller.ts",
    ]);
  });

  it("mentions neither the profile's include terms nor the word they share", () => {
    for (const f of files) {
      const source = readFileSync(new URL(f, dir), "utf8");
      for (const term of RULES.roofing.include.terms) {
        expect(source.toUpperCase()).not.toContain(term.toUpperCase());
      }
      expect(source).not.toMatch(/roof/i);
    }
  });
});

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

describe("timeouts, duplicate rows and key collisions (CR-A-03 F-6, code-review #5/#6)", () => {
  const timeoutFetch =
    (http: ReturnType<typeof fakeHttp>, hit: (u: URL) => boolean) =>
    async (url: string, init: RequestInit): Promise<Response> => {
      if (hit(new URL(url))) {
        const error = new Error("the request timed out");
        error.name = "TimeoutError";
        throw error;
      }
      return http.fetch(url, init);
    };
  const runWith = (c: ReturnType<typeof clock>, fetch: FetchLike, jobDir: string) =>
    captureSocrata({
      source: SOURCE,
      window: WINDOW,
      include: INCLUDE,
      jobDir,
      fetch,
      sleep: c.sleep,
      now: c.now,
      random: () => 0,
      log: silent,
    });

  it("F-6: labels a permit GET timeout `error` (exit 1), not `blocked`, keeping blocked_reason timeout", async () => {
    const c = clock();
    const n = ROWS[1]?.permit_number as string;
    const http = routes(c);
    const jobDir = tmp();
    const result = await runWith(
      c,
      timeoutFetch(http, (u) => u.searchParams.get(SOURCE.key) === n),
      jobDir,
    );
    expect(result.status).toBe("error");
    expect(exitCodeFor(result.status)).toBe(1);
    expect(result.reason).toMatch(/timeout/);
    expect(at(result.receipts, result.receipts.length - 1)).toMatchObject({
      permit_number: n,
      outcome: "error",
      blocked_reason: "timeout",
    });
    expect(readJson(join(jobDir, "status", `${safePermitName(n)}.json`))).toMatchObject({
      state: "error",
      captured: false,
    });
    expect(readJson(join(jobDir, "job.json"))).toMatchObject({ status: "error" });
  });

  it("F-6: labels a list-query timeout `error` (exit 1), before any permit GET", async () => {
    const c = clock();
    const http = routes(c);
    const result = await runWith(
      c,
      timeoutFetch(http, (u) => !u.searchParams.has(SOURCE.key)),
      tmp(),
    );
    expect(result.status).toBe("error");
    expect(exitCodeFor(result.status)).toBe(1);
    expect(result.reason).toMatch(/^list query timeout/);
    expect(result.list?.outcome).toBe("error");
  });

  it("#5: de-duplicates identical rows of one permit number, counts it with a reason, and does not abort", async () => {
    const c = clock();
    const n = ROWS[0]?.permit_number as string;
    const http = routes(c, { script: { [n]: [() => json([ROWS[0], ROWS[0]])] } });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("ok");
    expect(result.captured).toEqual(ROWS.map((r) => r.permit_number));
    expect(result.duplicates).toEqual([{ permit_number: n, rows: 2, reason: "identical_rows" }]);
    expect(at(result.receipts, 0)).toMatchObject({
      duplicate_rows: 1,
      duplicate_reason: "identical_rows",
    });
    expect(readJson(join(jobDir, "job.json"))).toMatchObject({
      duplicates: { permits: 1, by_reason: { identical_rows: 1 } },
    });
    expect(readJson(join(jobDir, "extracted", `${safePermitName(n)}.json`))).toEqual(ROWS[0]);
    const [loaded] = loadCaptures(jobDir, SOURCE, [n]);
    expect(loaded?.row).toEqual(ROWS[0]);
  });

  it("#5: keeps the latest of differing rows of one permit number, deterministically, with a counted reason", async () => {
    const c = clock();
    const n = ROWS[0]?.permit_number as string;
    const older = row(n, { status_current: "Active", ":updated_at": "2026-10-01T00:00:00.000Z" });
    const newer = row(n, { status_current: "Final", ":updated_at": "2026-10-20T00:00:00.000Z" });
    const http = routes(c, { script: { [n]: [() => json([newer, older])] } });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("ok");
    expect(result.duplicates).toEqual([
      { permit_number: n, rows: 2, reason: "differing_rows_kept_latest" },
    ]);
    expect(readJson(join(jobDir, "extracted", `${safePermitName(n)}.json`))).toEqual(newer);
    const [loaded] = loadCaptures(jobDir, SOURCE, [n]);
    expect(loaded?.row).toEqual(newer);
    // the raw body is kept byte for byte, both rows included
    const raw = JSON.parse(readFileSync(join(jobDir, "raw", `${safePermitName(n)}.json`), "utf8"));
    expect(raw).toHaveLength(2);
  });

  it("#5: counts a permit number repeated in the list query (one GET for it)", async () => {
    const c = clock();
    const rows = [ROWS[0] as Row, ROWS[0] as Row, ROWS[1] as Row];
    const http = routes(c, { rows });
    const jobDir = tmp();
    const result = await run(c, http, jobDir);
    expect(result.status).toBe("ok");
    expect(result.listed).toEqual([ROWS[0]?.permit_number, ROWS[1]?.permit_number]);
    expect(permitCalls(http)).toHaveLength(2);
    expect(readJson(join(jobDir, "job.json"))).toMatchObject({ list_rows_repeated: 1 });
  });

  it("#6: two numbers that sanitise alike get two status files, and a resume never skips the wrong one", async () => {
    const c = clock();
    const a = row("2026-1 BP");
    const b = row("2026-1/BP");
    const jobDir = tmp();
    const first = await run(c, routes(c, { rows: [a] }), jobDir);
    expect(first.status).toBe("ok");
    const http = routes(c, { rows: [a, b] });
    const second = await run(c, http, jobDir);
    expect(second.status).toBe("ok");
    expect(second.skipped).toEqual(["2026-1 BP"]);
    expect(second.captured).toEqual(["2026-1/BP"]);
    expect(permitKeys(http)).toEqual(["2026-1/BP"]);
    const loaded = loadCaptures(jobDir, SOURCE, ["2026-1 BP", "2026-1/BP"]);
    expect(loaded.map((l) => l.row.permit_number)).toEqual(["2026-1 BP", "2026-1/BP"]);
    expect(new Set(loaded.map((l) => l.key)).size).toBe(2);
  });

  it("#6: a status file whose permit_number differs is not taken as done", async () => {
    const c = clock();
    const n = ROWS[0]?.permit_number as string;
    const jobDir = tmp();
    await run(c, routes(c, { rows: [ROWS[0] as Row] }), jobDir);
    const path = join(jobDir, "status", `${safePermitName(n)}.json`);
    const status = readJson(path);
    writeFileSync(path, JSON.stringify({ ...status, permit_number: "someone else" }));
    const http = routes(c, { rows: [ROWS[0] as Row] });
    const again = await run(c, http, jobDir);
    expect(again.skipped).toEqual([]);
    expect(again.captured).toEqual([n]);
  });
});
