// A-04 pilot fix: Socrata `:id` values are ordered by the server, not lexicographically. The
// page fetch trusts the server order and keeps only structural guards. Synthetic input only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUSTIN_PAGES } from "../../../travis/adapters/socrata/austin-3syk-w9eu.js";
import { fetchPage } from "../../../travis/adapters/socrata/socrata-pages.js";
import { createSourceClient } from "../../../travis/lib/source-client.js";
import { diffKeySets } from "../../../travis/permits/keyset-diff.js";
import { fakeTime, seededRandom } from "../../fixtures/a04/permits/fake-socrata.js";

// The order a live `$order=:id` returned (not lexicographic).
const SERVER_IDS = [
  "row-nr9h-ib26~3pq2",
  "row-r3v3.tc9p-vdtn",
  "row-q8a6-zx8x-yqsn",
  "row-9t7g_f5ia~674m",
  "row-m5pt.bug9-nfsw",
  "row-x885.d7gj_4wd3",
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function page(rows: unknown[], lastId: string | null) {
  const time = fakeTime();
  const client = createSourceClient({
    fetch: async () =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    sleep: time.sleep,
    clock: time.clock,
    now: time.now,
    random: seededRandom(1).random,
    hostSpacing: true,
    appToken: "",
    log: () => undefined,
  });
  const jobDir = mkdtempSync(join(tmpdir(), "a04-ids-"));
  dirs.push(jobDir);
  return fetchPage({ client, config: AUSTIN_PAGES, jobDir, pageIndex: 1, lastId });
}
const mk = (ids: string[]) =>
  ids.map((id, i) => ({
    ":id": id,
    permit_number: `P${i}`,
    ":updated_at": "2026-10-01T00:00:00.000Z",
  }));

describe("Socrata :id order is the server's order", () => {
  it("accepts the six live ids in server order and returns the last as received", async () => {
    const r = await page(mk(SERVER_IDS), null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.rows).toBe(6);
      expect(r.lastId).toBe("row-x885.d7gj_4wd3");
    }
  });
  it("accepts a continuation page whose ids sort below the cursor lexicographically", async () => {
    const r = await page(mk(SERVER_IDS.slice(3)), "row-q8a6-zx8x-yqsn");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.lastId).toBe("row-x885.d7gj_4wd3");
  });
  it("rejects a duplicate :id inside a page", async () => {
    await expect(page(mk(["row-a", "row-b", "row-a"]), null)).rejects.toThrow(/duplicate/);
  });
  it("rejects a page that repeats the cursor id", async () => {
    await expect(page(mk(["row-a", "row-b"]), "row-a")).rejects.toThrow(/cursor/);
  });
  it("rejects a row without a non-empty string :id", async () => {
    const r = await page(mk(["row-a", ""]), null);
    expect(r.kind).toBe("stop");
  });
  it("key-set diffs use set membership, not order", () => {
    const existing = SERVER_IDS.map((rowId, i) => ({ rowId, permitNumber: `P${i}` }));
    const seen = [...existing].reverse().slice(0, -1);
    const d = diffKeySets(existing, seen);
    expect(d.removed).toEqual([{ rowId: SERVER_IDS[0], permitNumber: "P0" }]);
    expect(d.rekeyed).toEqual([]);
  });
});
