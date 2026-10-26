// A-04 review round E1 (F2): OR-M2 failed count-at-watermark, CR-8 structural page guards,
// OR-m5 cursor --fresh and profile/code check. Synthetic test input only (fake Socrata, fake
// journal, fake Loader; no network).
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceClient } from "../../../travis/lib/source-client.js";
import { runAustinPermits, type PermitsDeps } from "../../../travis/permits/workflow.js";
import { CURSOR_FILE } from "../../../travis/permits/backfill-cursor.js";
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

function harness(
  rows: () => readonly Row[],
  opts: { pageSize?: number; onCall?: (url: URL) => void; root?: string } = {},
) {
  const time = fakeTime();
  const rng = seededRandom(7);
  const server = fakeSocrata({
    rows,
    clock: time.clock,
    fault: (url) => {
      opts.onCall?.(url);
      return null;
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
    log: () => undefined,
  });
  const root = opts.root ?? mkdtempSync(join(tmpdir(), "a04-permits-f2-"));
  if (opts.root === undefined) dirs.push(root);
  const loader = new FakeLoader();
  const deps: PermitsDeps = {
    client,
    artifactsRoot: root,
    readWatermark: async () => null,
    limitations: () => [],
    ...(opts.pageSize !== undefined ? { pageSize: opts.pageSize } : {}),
  };
  return { server, root, loader, deps };
}

const pageCalls = (calls: { url: URL }[]) =>
  calls.filter((c) => (c.url.searchParams.get("$select") ?? "").startsWith("*,"));

describe("OR-M2 a failed count-at-watermark check never advances the watermark", () => {
  function midRunChange() {
    const rows: Row[] = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
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
    return h;
  }

  it("a failed check ends the run failed (numbers in the message), no watermark, run row failed, cursor kept", async () => {
    const h = midRunChange();
    const job = "travis-a04-permits-backfill-202610220310";
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: job, mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.reason).toMatch(/26/);
    expect(result.reason).toMatch(/25/);
    expect(result.reason).toMatch(/count at/i);
    expect(h.loader.watermark).toBeNull();
    expect(h.loader.runs.get(job)?.status).toBe("failed");
    const cursor = JSON.parse(readFileSync(join(h.root, CURSOR_FILE), "utf8")) as {
      complete: boolean;
      nextIndex: number;
    };
    expect(cursor.complete).toBe(false);
    expect(cursor.nextIndex).toBeGreaterThan(1);
    // keys must not have been applied to the Loader: no tombstoning from a suspect pass
    expect(h.loader.tombstones).toHaveLength(0);
  });

  it("a clean pass still completes and writes the watermark", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, { pageSize: 10 });
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220311", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(h.loader.watermark).not.toBeNull();
  });
});

describe("CR-8 structural page guards stop the run instead of being retried forever", () => {
  it("a repeated :id in a page ends the run failed after exactly one page request", async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => synthRow(i + 1));
    rows[3] = { ...(rows[3] as Row), ":id": (rows[1] as Row)[":id"] as string };
    const h = harness(() => rows, { pageSize: 10 });
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220312", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/duplicate/);
    expect(pageCalls(h.server.calls)).toHaveLength(1);
    expect(h.loader.watermark).toBeNull();
  });

  it("an empty :id ends the run failed", async () => {
    const rows: Row[] = Array.from({ length: 3 }, (_, i) => synthRow(i + 1));
    rows[1] = { ...(rows[1] as Row), ":id": "" };
    const h = harness(() => rows, { pageSize: 10 });
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220313", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("failed");
    expect(pageCalls(h.server.calls)).toHaveLength(1);
  });
});

describe("OR-m5 backfill cursor: profile/code check and --fresh", () => {
  const staleCursor = (over: Record<string, unknown>) => ({
    originJobId: "travis-a04-permits-backfill-202610220300",
    complete: false,
    lastId: synthId(10),
    nextIndex: 2,
    pages: [],
    rows: 10,
    written: 10,
    maxUpdatedAt: "2026-10-01T00:00:00.000Z",
    pending: null,
    ...over,
  });

  it("refuses to resume a cursor whose profile or code SHA differs (failed, no page request)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, { pageSize: 10 });
    writeFileSync(
      join(h.root, CURSOR_FILE),
      JSON.stringify(staleCursor({ profileSha256: "0".repeat(64), codeSha: "1".repeat(64) })),
    );
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220314", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/--fresh/);
    expect(pageCalls(h.server.calls)).toHaveLength(0);
  });

  it("fresh: true archives the old cursor and starts at page 1", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, { pageSize: 10 });
    writeFileSync(
      join(h.root, CURSOR_FILE),
      JSON.stringify(staleCursor({ profileSha256: "0".repeat(64), codeSha: "1".repeat(64) })),
    );
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220315", mode: "backfill", fresh: true },
      h.deps,
    );
    expect(result.status).toBe("complete");
    expect(pageCalls(h.server.calls)[0]?.url.searchParams.get("$where")).toBeNull();
    const archived = readdirSync(h.root).filter((f) => /^backfill-cursor\..+\.json$/.test(f));
    expect(archived).toHaveLength(1);
    expect(existsSync(join(h.root, CURSOR_FILE))).toBe(true);
  });

  it("a legacy cursor with no recorded SHAs still resumes (the live backfill predates the check)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => synthRow(i + 1));
    const h = harness(() => rows, { pageSize: 10 });
    writeFileSync(
      join(h.root, CURSOR_FILE),
      JSON.stringify(staleCursor({ rows: 0, lastId: null, nextIndex: 1 })),
    );
    const result = await runAustinPermits(
      fakeIO(h.loader),
      { jobId: "travis-a04-permits-backfill-202610220316", mode: "backfill" },
      h.deps,
    );
    expect(result.status).toBe("complete");
  });
});
