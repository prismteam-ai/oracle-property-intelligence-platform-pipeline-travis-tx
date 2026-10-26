// A-04 T052 (A-04-TC-051, A-04-TC-055, A-04-TC-056): content digest, re-stamp detector and
// key-set diff. Synthetic test input only (fake Socrata server, fake clock, journaling fake
// context, in-memory fake Loader); the re-stamp fixture is modelled on the 2026-10-19
// 12:22–12:43 UTC event (every row re-stamped within 21 minutes, a few with new content).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUSTIN_PAGES } from "../../../travis/adapters/socrata/austin-3syk-w9eu.js";
import { createSourceClient } from "../../../travis/lib/source-client.js";
import { contentDigest, jcs } from "../../../travis/permits/content-digest.js";
import { RESTAMP_LIMITATION, detectRestamp } from "../../../travis/permits/restamp.js";
import { diffKeySets, planPageMerge } from "../../../travis/permits/keyset-diff.js";
import { classifyRun } from "../../../travis/permits/classify-run.js";
import {
  runAustinPermits,
  type AustinWatermark,
  type PermitsDeps,
} from "../../../travis/permits/workflow.js";
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

function harness(rows: () => readonly Row[], loader = new FakeLoader(), pageSize = 100) {
  const time = fakeTime();
  const server = fakeSocrata({ rows, clock: time.clock });
  const client = createSourceClient({
    fetch: server.fetch,
    sleep: time.sleep,
    clock: time.clock,
    now: time.now,
    random: seededRandom(3).random,
    hostSpacing: true,
    appToken: "",
    log: () => undefined,
  });
  const root = mkdtempSync(join(tmpdir(), "a04-permits-inc-"));
  dirs.push(root);
  const deps: PermitsDeps = {
    client,
    artifactsRoot: root,
    readWatermark: async () => loader.watermark as AustinWatermark | null,
    limitations: () => [],
    pageSize,
  };
  return { server, loader, deps, root };
}

const pageCalls = (calls: { url: URL }[]) =>
  calls.filter((c) => (c.url.searchParams.get("$select") ?? "").startsWith("*,"));

describe("content digest (SHA-256 of JCS without system, computed and calendar fields)", () => {
  it("A-04-TC-051 ignores :-fields, :@computed_region_*, issued_in_last_30_days and day_issued; key order is irrelevant", () => {
    const a = synthRow(1);
    const b: Row = {
      ...Object.fromEntries(Object.entries(a).reverse()),
      ":id": "row-999999",
      ":updated_at": "2026-10-19T12:30:00.000Z",
      ":created_at": "2020-01-01T00:00:00.000Z",
      ":@computed_region_abcd_1234": "9",
      issued_in_last_30_days: "Yes",
      day_issued: "FRIDAY",
    };
    expect(contentDigest(b, AUSTIN_PAGES.volatileFields)).toBe(
      contentDigest(a, AUSTIN_PAGES.volatileFields),
    );
    expect(contentDigest({ ...a, status_current: "Final" }, AUSTIN_PAGES.volatileFields)).not.toBe(
      contentDigest(a, AUSTIN_PAGES.volatileFields),
    );
    // absent stays absent: a missing field is not the same as an empty one
    const { description: _d, ...noDescription } = a;
    expect(contentDigest(noDescription, AUSTIN_PAGES.volatileFields)).not.toBe(
      contentDigest({ ...a, description: "" }, AUSTIN_PAGES.volatileFields),
    );
    expect(contentDigest(a, AUSTIN_PAGES.volatileFields)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("JCS sorts keys recursively and serialises like RFC 8785 for strings, numbers and nesting", () => {
    expect(jcs({ b: 1, a: { d: [3, "x"], c: null }, é: " " })).toBe(
      '{"a":{"c":null,"d":[3,"x"]},"b":1,"é":" "}',
    );
  });
});

describe("re-stamp detector", () => {
  it("A-04-TC-051 window ≥ 50% of the total → re-stamp", () => {
    const r = detectRestamp({
      total: 1000,
      windowCount: 500,
      hours: [{ hour: "2026-10-19T12:00:00.000", n: 500 }],
    });
    expect(r.detected).toBe(true);
    expect(r.reasons).toContain("window_share");
  });

  it("A-04-TC-051 ≥ 90% of the window rows inside 6 h → re-stamp, even when the window is small", () => {
    const hours = [
      { hour: "2026-10-19T12:00:00.000", n: 900 },
      { hour: "2026-10-19T17:00:00.000", n: 20 },
      { hour: "2026-10-20T09:00:00.000", n: 80 },
    ];
    const r = detectRestamp({ total: 100_000, windowCount: 1000, hours });
    expect(r.detected).toBe(true);
    expect(r.reasons).toEqual(["window_concentrated"]);
    expect(r.maxShareIn6h).toBeCloseTo(0.92, 5);
  });

  it("a small window spread over days is not a re-stamp; an empty window is not one", () => {
    const hours = [
      { hour: "2026-10-19T08:00:00.000", n: 1 },
      { hour: "2026-10-20T08:00:00.000", n: 1 },
      { hour: "2026-10-21T08:00:00.000", n: 1 },
    ];
    expect(detectRestamp({ total: 1000, windowCount: 3, hours }).detected).toBe(false);
    expect(detectRestamp({ total: 1000, windowCount: 0, hours: [] }).detected).toBe(false);
    expect(RESTAMP_LIMITATION).toBe("source bulk re-stamp; delta by content digest");
  });
});

describe("A-04-TC-051 bulk re-stamp → full page-through, only content-changed rows written", () => {
  it("A-04-TC-051 1,000 rows re-stamped in 21 minutes, 3 with new content: 3 written, delta added 0 changed 3 removed 0, the limitation", async () => {
    const rows: Row[] = Array.from({ length: 1000 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows);
    const backfill = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610190000", mode: "backfill" },
      h.deps,
    );
    expect(backfill.status).toBe("complete");
    expect(h.loader.current.size).toBe(1000);

    const start = Date.parse("2026-10-19T12:22:00.000Z");
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i] as Row;
      rows[i] = {
        ...r,
        ":updated_at": new Date(start + Math.floor((i * 21 * 60_000) / rows.length)).toISOString(),
        ":@computed_region_abcd_1234": "8",
        issued_in_last_30_days: "Yes",
        day_issued: "SUNDAY",
        ...(i === 10 || i === 500 || i === 990 ? { status_current: "Final" } : {}),
      };
    }
    const before = h.server.calls.length;
    const jobId = "travis-a04-permits-incremental-202610191300";
    const result = await runAustinPermits(fakeIO(h.loader), { jobId, mode: "incremental" }, h.deps);
    expect(result.status).toBe("complete");
    expect(result.restamp?.detected).toBe(true);
    const pages = pageCalls(h.server.calls.slice(before));
    // full page-through by :id, no :updated_at filter: 10 full pages + the empty page that ends
    // a keyset pass whose last page is exactly full
    expect(pages).toHaveLength(11);
    for (const p of pages)
      expect(p.url.searchParams.get("$where") ?? "").not.toMatch(/:updated_at/);
    expect(result.rows).toBe(1000); // 1,000 digests compared
    expect(result.written).toBe(3);
    const mine = [...h.loader.current.values()].filter((c) => c.updatedInJob === jobId);
    expect({
      added: mine.filter((c) => c.previousContentSha256 === null).length,
      changed: mine.filter((c) => c.previousContentSha256 !== null).length,
      removed: result.tombstones,
    }).toEqual({ added: 0, changed: 3, removed: 0 });
    expect(h.loader.limitations.filter((l) => l.jobId === jobId).map((l) => l.text)).toContain(
      "source bulk re-stamp; delta by content digest",
    );
  });

  it("a normal incremental window pages only :updated_at > W and writes the changed rows", async () => {
    const rows: Row[] = Array.from({ length: 300 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows);
    await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610190001", mode: "backfill" },
      h.deps,
    );
    rows[4] = {
      ...(rows[4] as Row),
      ":updated_at": "2026-10-19T08:00:00.000Z",
      status_current: "Final",
    };
    rows[200] = {
      ...(rows[200] as Row),
      ":updated_at": "2026-10-21T08:00:00.000Z",
      status_current: "Expired",
    };
    const before = h.server.calls.length;
    const jobId = "travis-a04-permits-incremental-202610211200";
    const result = await runAustinPermits(fakeIO(h.loader), { jobId, mode: "incremental" }, h.deps);
    expect(result.restamp?.detected).toBe(false);
    const pages = pageCalls(h.server.calls.slice(before));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.url.searchParams.get("$where")).toBe(
      ":updated_at > '2026-10-01T00:00:00.000Z'",
    );
    expect(result.written).toBe(2);
    expect(result.watermark).toBe("2026-10-21T08:00:00.000Z");
    expect(h.loader.limitations.filter((l) => l.jobId === jobId)).toHaveLength(0);
  });

  it("an incremental run with no backfill watermark fails without a request", async () => {
    const h = harness(() => [synthRow(1)]);
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-incremental-202610211201", mode: "incremental" },
      h.deps,
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/no backfill watermark/);
    expect(h.server.calls).toHaveLength(0);
  });
});

describe("A-04-TC-055 upstream delete → source_removed tombstone; a re-key is not one", () => {
  it("A-04-TC-055 a dropped :id + permit number is tombstoned (kept, not deleted); a permit under a new :id is re-keyed", async () => {
    let rows: Row[] = Array.from({ length: 20 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, new FakeLoader(), 10);
    await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610200000", mode: "backfill" },
      h.deps,
    );
    const gone = rows[4] as Row;
    const moved = rows[6] as Row;
    rows = rows.filter((r) => r !== gone && r !== moved);
    rows.push({ ...moved, ":id": synthId(100) });
    const jobId = "travis-a04-permits-backfill-202610210000";
    const result = await runAustinPermits(fakeIO(h.loader), { jobId, mode: "backfill" }, h.deps);
    expect(result.tombstones).toBe(1);
    expect(h.loader.tombstones).toEqual([
      { rowKey: gone[":id"], permitNumber: gone.permit_number, reason: "source_removed", jobId },
    ]);
    const kept = h.loader.current.get(gone.permit_number as string);
    expect(kept?.tombstoned).toBe(true); // downgraded, never deleted
    expect(h.loader.current.get(moved.permit_number as string)?.tombstoned).toBe(false);
  });

  it("diffKeySets: removed only when the :id and the permit number are both gone", () => {
    const existing = [
      { rowId: "r1", permitNumber: "A" },
      { rowId: "r2", permitNumber: "B" },
      { rowId: "r3", permitNumber: "C" },
    ];
    const seen = [
      { rowId: "r1", permitNumber: "A" },
      { rowId: "r9", permitNumber: "C" },
    ];
    const d = diffKeySets(existing, seen);
    expect(d.removed).toEqual([{ rowId: "r2", permitNumber: "B" }]);
    expect(d.rekeyed).toEqual([{ permitNumber: "C", fromRowId: "r3" }]);
  });
});

describe("A-04-TC-056 new status on a later page → one row per (permit_number, issuing_jurisdiction)", () => {
  it("A-04-TC-056 Active on page 2, Final on page 7: one current row (Final, closed), previous digest = page-2 row, both source rows and page digests kept", async () => {
    const rows: Row[] = Array.from({ length: 70 }, (_, i) => synthRow(i + 1));
    const permit = "2026-777777 BP";
    rows[14] = {
      ...(rows[14] as Row),
      permit_number: permit,
      status_current: "Active",
      ":updated_at": "2026-10-01T00:00:00.000Z",
    };
    rows[64] = {
      ...(rows[64] as Row),
      permit_number: permit,
      status_current: "Final",
      ":updated_at": "2026-10-05T00:00:00.000Z",
    };
    const h = harness(() => rows, new FakeLoader(), 10);
    const jobId = "travis-a04-permits-backfill-202610220000";
    await runAustinPermits(fakeIO(h.loader), { jobId, mode: "backfill" }, h.deps);
    const cur = h.loader.current.get(permit);
    expect(cur?.payload.status_current).toBe("Final");
    expect(classifyRun(cur?.payload ?? {}).statusClass).toBe("closed");
    expect(cur?.previousContentSha256).toBe(
      contentDigest(rows[14] as Row, AUSTIN_PAGES.volatileFields),
    );
    expect([...h.loader.sourceRows.values()].filter((r) => r.permitNumber === permit)).toHaveLength(
      2,
    );
    const receipts = readFileSync(join(h.root, jobId, "receipts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind: string; page_index: number | null; sha256: string });
    const p2 = receipts.find((r) => r.kind === "page" && r.page_index === 2);
    const p7 = receipts.find((r) => r.kind === "page" && r.page_index === 7);
    expect(p2?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(p7?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(p2?.sha256).not.toBe(p7?.sha256);
  });

  it("planPageMerge reuses pickPermitRow: identical re-capture writes nothing; a newer row with the same content writes nothing", () => {
    const row = synthRow(1);
    const digest = contentDigest(row, AUSTIN_PAGES.volatileFields);
    const existing = new Map([
      [
        row.permit_number as string,
        {
          permitNumber: row.permit_number as string,
          rowId: row[":id"] as string,
          contentSha256: digest,
          payload: row,
        },
      ],
    ]);
    const same = planPageMerge(existing, [
      {
        rowId: row[":id"] as string,
        permitNumber: row.permit_number as string,
        contentSha256: digest,
        updatedAt: row[":updated_at"] ?? null,
        payload: { ...row },
      },
    ]);
    expect(same.upserts).toHaveLength(0);
    const restamped = {
      ...row,
      ":updated_at": "2026-10-19T12:30:00.000Z",
      issued_in_last_30_days: "Yes",
    };
    const r2 = planPageMerge(existing, [
      {
        rowId: row[":id"] as string,
        permitNumber: row.permit_number as string,
        contentSha256: contentDigest(restamped, AUSTIN_PAGES.volatileFields),
        updatedAt: restamped[":updated_at"],
        payload: restamped,
      },
    ]);
    expect(r2.upserts).toHaveLength(0);
    expect(r2.unchanged).toBe(1);
  });
});
