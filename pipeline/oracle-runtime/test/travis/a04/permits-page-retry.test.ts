// A-04 (AC-17, NFR-002): a timeout or a network error with no HTTP response is retried at PAGE
// level (5 attempts, 1 s base / 60 s cap, full jitter, one receipt per attempt, the same
// cursor, the same identity), a 403 never is, and a failed run resumes from the last committed
// page. Synthetic test input only: a fake Socrata server, a fake clock, a seeded RNG, a
// journaling fake context and an in-memory fake Loader (no network, no Restate, no Query DB).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUSTIN_PAGES,
  PAGE_REQUEST_TIMEOUT_MS,
} from "../../../travis/adapters/socrata/austin-3syk-w9eu.js";
import { pageFileName } from "../../../travis/adapters/socrata/socrata-pages.js";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  USER_AGENT,
  createSourceClient,
} from "../../../travis/lib/source-client.js";
import { runAustinPermits, type PermitsDeps } from "../../../travis/permits/workflow.js";
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
  const d = mkdtempSync(join(tmpdir(), "a04-page-retry-"));
  dirs.push(d);
  return d;
};

const rows: Row[] = Array.from({ length: 65 }, (_, i) => synthRow(i + 1));
const after =
  (n: number) =>
  (url: URL): boolean =>
    url.searchParams.get("$where") === `:id > '${synthId(n)}'` &&
    (url.searchParams.get("$select") ?? "").startsWith("*,");
const pageCalls = (calls: { url: URL }[]) =>
  calls.filter((c) => (c.url.searchParams.get("$select") ?? "").startsWith("*,"));

function harness(
  opts: {
    hang?: (url: URL, n: number) => boolean;
    drop?: (url: URL, n: number) => boolean;
    fault?: (url: URL, n: number) => number | null;
    root?: string;
    loader?: FakeLoader;
  } = {},
) {
  const time = fakeTime();
  const rng = seededRandom(11);
  const server = fakeSocrata({
    rows: () => rows,
    clock: time.clock,
    ...(opts.hang ? { hang: opts.hang } : {}),
    ...(opts.drop ? { drop: opts.drop } : {}),
    ...(opts.fault ? { fault: opts.fault } : {}),
  });
  const client = createSourceClient({
    fetch: server.fetch,
    sleep: time.sleep,
    clock: time.clock,
    now: time.now,
    random: rng.random,
    hostSpacing: true,
    appToken: "",
    log: () => undefined,
  });
  const root = opts.root ?? tmp();
  const loader = opts.loader ?? new FakeLoader();
  const deps: PermitsDeps = {
    client,
    artifactsRoot: root,
    readWatermark: async () => null,
    limitations: () => [],
    pageSize: 10,
    // a 20 ms per-request limit stands in for the 5-minute Austin limit (real timers)
    config: { ...AUSTIN_PAGES, requestTimeoutMs: 20 },
    random: rng.random,
  };
  return { time, rng, server, client, root, loader, deps };
}

type Line = {
  kind: string;
  page_index: number | null;
  attempts: number;
  page_attempt?: number;
  outcome: string;
  blocked_reason: string | null;
  http_status: number | null;
  bytes: number;
  rows: number | null;
  ua: string;
};
const receiptsOf = (root: string, jobId: string): Line[] =>
  readFileSync(join(root, jobId, "receipts.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Line);

describe("A-04 Austin page timeout", () => {
  it("the Austin page config names a generous per-request timeout (5 minutes)", () => {
    expect(PAGE_REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(AUSTIN_PAGES.requestTimeoutMs).toBe(PAGE_REQUEST_TIMEOUT_MS);
  });
});

describe("A-04 page-level retry of a timeout (AC-17, NFR-002)", () => {
  it("a page that times out once is fetched on attempt 2: same cursor, one receipt per attempt, bytes counted once", async () => {
    let hung = 0;
    const h = harness({
      hang: (url) => {
        if (!after(10)(url)) return false;
        hung += 1;
        return hung === 1;
      },
    });
    const io = fakeIO(h.loader);
    const jobId = "travis-a04-permits-backfill-202610220401";
    const result = await runAustinPermits(io, { jobId, mode: "backfill" }, h.deps);
    expect(result.status).toBe("complete");
    expect(result.rows).toBe(65);
    expect(h.loader.current.size).toBe(65);
    const p2 = h.server.calls.filter((c) => after(10)(c.url));
    expect(p2).toHaveLength(2);
    expect(p2[1]?.url.href).toBe(p2[0]?.url.href); // the same cursor, nothing skipped
    for (const c of h.server.calls) expect(c.headers["user-agent"]).toBe(USER_AGENT);
    const page2 = receiptsOf(h.root, jobId).filter((r) => r.kind === "page" && r.page_index === 2);
    expect(page2).toHaveLength(2);
    expect(page2[0]).toMatchObject({
      outcome: "error",
      blocked_reason: "timeout",
      http_status: null,
      page_attempt: 1,
      bytes: 0,
      rows: null,
    });
    expect(page2[1]).toMatchObject({ outcome: "ok", page_attempt: 2, rows: 10 });
    expect(page2.reduce((n, r) => n + (r.rows ?? 0), 0)).toBe(10); // rows counted once
    // one full-jitter wait before attempt 2: 0 ≤ wait ≤ 1 s base
    expect(io.sleeps).toHaveLength(1);
    expect(io.sleeps[0]).toBeGreaterThanOrEqual(0);
    expect(io.sleeps[0]).toBeLessThanOrEqual(BACKOFF_BASE_MS);
    expect(h.loader.pageWrites.filter((p) => p.pageIndex === 2)).toHaveLength(1);
  });

  it("a network error with no HTTP response is retried the same way", async () => {
    let dropped = 0;
    const h = harness({
      drop: (url) => after(20)(url) && (dropped += 1) <= 2,
    });
    const io = fakeIO(h.loader);
    const jobId = "travis-a04-permits-backfill-202610220402";
    const result = await runAustinPermits(io, { jobId, mode: "backfill" }, h.deps);
    expect(result.status).toBe("complete");
    expect(h.server.calls.filter((c) => after(20)(c.url))).toHaveLength(3);
    const page3 = receiptsOf(h.root, jobId).filter((r) => r.kind === "page" && r.page_index === 3);
    expect(page3.map((r) => [r.outcome, r.page_attempt])).toEqual([
      ["error", 1],
      ["error", 2],
      ["ok", 3],
    ]);
    expect(io.sleeps).toHaveLength(2);
  });

  it("5 timeouts end the run failed, naming the page index and a timestamp; waits are full jitter (1 s base, 60 s cap)", async () => {
    const h = harness({ hang: (url) => after(10)(url) });
    const io = fakeIO(h.loader);
    const jobId = "travis-a04-permits-backfill-202610220403";
    const result = await runAustinPermits(io, { jobId, mode: "backfill" }, h.deps);
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toMatch(/page 2/);
    expect(result.reason).toMatch(/5 attempt/);
    expect(result.reason).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(h.server.calls.filter((c) => after(10)(c.url))).toHaveLength(5);
    expect(io.sleeps).toHaveLength(4);
    io.sleeps.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** i));
    });
    expect(h.loader.watermark).toBeNull();
    expect(h.loader.runs.get(jobId)?.status).toBe("failed");
    const page2 = receiptsOf(h.root, jobId).filter((r) => r.kind === "page" && r.page_index === 2);
    expect(page2.map((r) => r.page_attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a 403 is never retried at page level: one request, no wait, waiting_human", async () => {
    const h = harness({ fault: (url) => (after(10)(url) ? 403 : null) });
    const io = fakeIO(h.loader);
    const jobId = "travis-a04-permits-backfill-202610220404";
    const result = await runAustinPermits(io, { jobId, mode: "backfill" }, h.deps);
    expect(result.status).toBe("waiting_human");
    expect(result.exitCode).toBe(2);
    expect(h.server.calls.filter((c) => after(10)(c.url))).toHaveLength(1);
    expect(io.sleeps).toHaveLength(0);
  });
});

describe("A-04 resume from the last committed page", () => {
  it("a failed run (page 4 timed out 5 times) is continued by a new run after page 3's last :id", async () => {
    const root = tmp();
    const loader = new FakeLoader();
    const h1 = harness({ root, loader, hang: (url) => after(30)(url) });
    const first = await runAustinPermits(
      fakeIO(loader),
      { jobId: "travis-a04-permits-backfill-202610220405", mode: "backfill" },
      h1.deps,
    );
    expect(first.status).toBe("failed");
    expect(loader.current.size).toBe(30);
    const h2 = harness({ root, loader });
    const second = await runAustinPermits(
      fakeIO(loader),
      { jobId: "travis-a04-permits-backfill-202610220406", mode: "backfill" },
      h2.deps,
    );
    expect(second.status).toBe("complete");
    const pages = pageCalls(h2.server.calls);
    expect(pages[0]?.url.searchParams.get("$where")).toBe(`:id > '${synthId(30)}'`);
    expect(pages.some((c) => c.url.searchParams.get("$where") === null)).toBe(false);
    expect(loader.current.size).toBe(65);
    expect(second.rows).toBe(65); // earlier pages count too
    expect(second.pages).toBe(7);
    expect(second.watermarkCheck).toBe("pass");
    expect(loader.pageWrites.map((p) => p.pageIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("a page captured but not merged is re-merged from the on-disk raw page (sha256 matches), not fetched again", async () => {
    const root = tmp();
    class FailingOnce extends FakeLoader {
      armed = true;
      override merge(raw: unknown) {
        const input = raw as { kind: string; pageIndex?: number };
        if (this.armed && input.kind === "page" && input.pageIndex === 4) {
          this.armed = false;
          throw new Error("synthetic loader outage");
        }
        return super.merge(raw);
      }
    }
    const loader = new FailingOnce();
    const h1 = harness({ root, loader });
    await expect(
      runAustinPermits(
        fakeIO(loader),
        { jobId: "travis-a04-permits-backfill-202610220407", mode: "backfill" },
        h1.deps,
      ),
    ).rejects.toThrow(/synthetic loader outage/);
    expect(loader.current.size).toBe(30); // pages 1–3 merged, page 4 captured only
    const h2 = harness({ root, loader });
    const second = await runAustinPermits(
      fakeIO(loader),
      { jobId: "travis-a04-permits-backfill-202610220408", mode: "backfill" },
      h2.deps,
    );
    expect(second.status).toBe("complete");
    const wheres = pageCalls(h2.server.calls).map((c) => c.url.searchParams.get("$where"));
    expect(wheres[0]).toBe(`:id > '${synthId(40)}'`); // page 4 came from disk
    expect(wheres).not.toContain(`:id > '${synthId(30)}'`);
    expect(loader.current.size).toBe(65);
    expect(second.rows).toBe(65);
    expect(loader.pageWrites.filter((p) => p.pageIndex === 4)).toHaveLength(1);
  });

  it("a captured page whose on-disk bytes no longer match the receipt digest is fetched again", async () => {
    const root = tmp();
    class FailingOnce extends FakeLoader {
      armed = true;
      override merge(raw: unknown) {
        const input = raw as { kind: string; pageIndex?: number };
        if (this.armed && input.kind === "page" && input.pageIndex === 4) {
          this.armed = false;
          throw new Error("synthetic loader outage");
        }
        return super.merge(raw);
      }
    }
    const loader = new FailingOnce();
    const firstJob = "travis-a04-permits-backfill-202610220409";
    const h1 = harness({ root, loader });
    await expect(
      runAustinPermits(fakeIO(loader), { jobId: firstJob, mode: "backfill" }, h1.deps),
    ).rejects.toThrow(/synthetic loader outage/);
    writeFileSync(join(root, firstJob, pageFileName(4)), "corrupt");
    const h2 = harness({ root, loader });
    const second = await runAustinPermits(
      fakeIO(loader),
      { jobId: "travis-a04-permits-backfill-202610220410", mode: "backfill" },
      h2.deps,
    );
    expect(second.status).toBe("complete");
    const wheres = pageCalls(h2.server.calls).map((c) => c.url.searchParams.get("$where"));
    expect(wheres[0]).toBe(`:id > '${synthId(30)}'`); // page 4 fetched again
    expect(loader.current.size).toBe(65);
  });

  it("a completed backfill is not resumed: the next backfill starts at page 1", async () => {
    const root = tmp();
    const loader = new FakeLoader();
    const h1 = harness({ root, loader });
    const a = await runAustinPermits(
      fakeIO(loader),
      { jobId: "travis-a04-permits-backfill-202610220411", mode: "backfill" },
      h1.deps,
    );
    expect(a.status).toBe("complete");
    const h2 = harness({ root, loader });
    const b = await runAustinPermits(
      fakeIO(loader),
      { jobId: "travis-a04-permits-backfill-202610220412", mode: "backfill" },
      h2.deps,
    );
    expect(b.status).toBe("complete");
    expect(pageCalls(h2.server.calls)[0]?.url.searchParams.get("$where")).toBeNull();
    expect(b.rows).toBe(65);
  });
});
