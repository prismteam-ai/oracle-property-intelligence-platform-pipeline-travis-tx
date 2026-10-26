// A-04 review round E1 (F2): OR-M3 tombstone guards and reappearing permits, OR-m8 link needs a
// complete TCAD run, DP-5 page_key, OR-m3 applicant/contractor keys never leave the payload.
// A scripted postgres.js stand-in records every statement (synthetic test input; no database).
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { track } from "../../services/tracks/permits.js";
import { assemblePermitsSection } from "../../services/report-sections/permits.js";
import { inputDigest } from "../../../oracle-runtime/travis/permits/merge-input.js";

const JOB = "travis-a04-permits-backfill-202610220300";
const LINK_JOB = "travis-a04-permits-link-202610220400";
const MIGRATION_0303 = new URL("../../migrations/0303_permit_page_key.sql", import.meta.url);

interface Query {
  text: string;
  values: unknown[];
}
function fakeTx(answer: (text: string, values: unknown[]) => unknown[] = () => []) {
  const queries: Query[] = [];
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    return answer(text, values);
  }) as unknown as postgres.TransactionSql;
  return { tx: fn, queries };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "a04-permits-f2-"));
  dirs.push(d);
  return d;
};

function keysFile(rows: { row_id: string; permit_number: string }[]) {
  const dir = tmp();
  const body = rows.length === 0 ? "" : `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  const path = join(dir, "keys.ndjson");
  writeFileSync(path, body);
  return { path, sha256: createHash("sha256").update(body).digest("hex"), count: rows.length };
}

function finalizeInput(keys: ReturnType<typeof keysFile>, endTotal: number) {
  return {
    kind: "finalize" as const,
    jobId: JOB,
    mode: "backfill" as const,
    artifactPath: `run:${JOB}:finalize`,
    artifactSha256: inputDigest({ JOB, k: "f", endTotal, n: keys.count }),
    finishedAt: "2026-10-22T03:10:00.000Z",
    asOf: "2026-10-22",
    watermark: {
      lastId: "r1",
      maxUpdatedAt: "2026-10-01T00:00:00.000Z",
      sourceCountAtW: endTotal,
      capturedAtW: endTotal,
      aboveW: 0,
      startTotal: endTotal,
      endTotal,
      watermarkCheck: "pass" as const,
      pages: 1,
      rows: endTotal,
      startedAt: "2026-10-22T03:00:00.000Z",
      finishedAt: "2026-10-22T03:10:00.000Z",
      jobId: JOB,
      mode: "backfill" as const,
      restamp: null,
    },
    keys,
    limitations: [],
    receiptsPath: null,
  };
}

const answerWith = (stored: number, missing: { row_id: string; permit_number: string; permit_seen: boolean }[]) =>
  (text: string): unknown[] => {
    if (text.startsWith("SELECT count(*)")) return [{ n: stored }];
    if (text.startsWith("SELECT p.row_id")) return missing;
    if (text.startsWith("INSERT INTO source_tombstones")) return missing.map((m) => ({ row_key: m.row_id }));
    return [];
  };

const tombstoning = (q: Query[]) =>
  q.some((x) => x.text.startsWith("INSERT INTO source_tombstones") || x.text.startsWith("UPDATE property_improvements SET tombstoned = true"));

describe("OR-M3 mergeFinalize refuses an implausible key set", () => {
  it("a truncated key set (distinct keys far below endTotal) throws a TerminalError and tombstones nothing", async () => {
    const keys = keysFile([{ row_id: "r1", permit_number: "A" }]);
    const missing = [{ row_id: "r2", permit_number: "B", permit_seen: false }];
    const { tx, queries } = fakeTx(answerWith(2_000_000, missing));
    const err = await track.merge(tx, finalizeInput(keys, 2_000_000)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("TerminalError");
    expect((err as Error).message).toMatch(/1 distinct keys/);
    expect((err as Error).message).toMatch(/2000000/);
    expect(tombstoning(queries)).toBe(false);
    expect(queries.some((q) => q.text.startsWith("UPDATE backbone_runs"))).toBe(false);
  });

  it("removals above 1% of the stored rows throw a TerminalError naming the numbers", async () => {
    const keys = keysFile([{ row_id: "r1", permit_number: "A" }]);
    const missing = [
      { row_id: "r2", permit_number: "B", permit_seen: false },
      { row_id: "r3", permit_number: "C", permit_seen: false },
    ];
    const { tx, queries } = fakeTx(answerWith(100, missing));
    const err = await track.merge(tx, finalizeInput(keys, 1)).then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe("TerminalError");
    expect((err as Error).message).toMatch(/2 removals/);
    expect((err as Error).message).toMatch(/100 stored/);
    expect(tombstoning(queries)).toBe(false);
  });

  it("a plausible key set (within max(1000, 0.1%) of endTotal) and few removals still tombstones", async () => {
    const keys = keysFile([{ row_id: "r1", permit_number: "A" }]);
    const missing = [{ row_id: "r2", permit_number: "B", permit_seen: false }];
    const { tx, queries } = fakeTx(answerWith(1000, missing));
    const out = await track.merge(tx, finalizeInput(keys, 1));
    expect(out.tombstones).toBe(1);
    expect(tombstoning(queries)).toBe(true);
  });

  it("a reappearing permit clears tombstoned and its source_tombstones row in the same transaction, before any new tombstone", async () => {
    const keys = keysFile([{ row_id: "r1", permit_number: "A" }]);
    const { tx, queries } = fakeTx(answerWith(1000, []));
    await track.merge(tx, finalizeInput(keys, 1));
    const clear = queries.findIndex((q) => q.text.startsWith("UPDATE property_improvements SET tombstoned = false"));
    const del = queries.findIndex((q) => q.text.startsWith("DELETE FROM source_tombstones"));
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(queries[clear]?.text).toMatch(/permits_seen_keys/);
    expect(queries[del]?.text).toMatch(/permits_seen_keys/);
    const firstRemoval = queries.findIndex((q) => q.text.startsWith("INSERT INTO source_tombstones"));
    if (firstRemoval >= 0) expect(clear).toBeLessThan(firstRemoval);
  });
});

function pageArtifact(rows: Record<string, string>[]) {
  const dir = tmp();
  const body = Buffer.from(JSON.stringify(rows));
  const sha = createHash("sha256").update(body).digest("hex");
  mkdirSync(join(dir, "raw", "pages"), { recursive: true });
  const path = join(dir, "raw", "pages", "page-000001.json.gz");
  writeFileSync(path, gzipSync(body));
  const receipt = {
    source: "austin-3syk-w9eu", kind: "page", page_index: 1, url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
    method: "GET", http_status: 200, bytes: body.length, sha256: sha, captured_at: "2026-10-22T03:00:01.000Z", outcome: "ok",
    blocked_reason: null, blocked_at: null, attempts: 1, ua: "oracle-travis-discovery/0.1", app_token_used: false, rows: rows.length,
    last_id: rows[rows.length - 1]?.[":id"] ?? null, file: "raw/pages/page-000001.json.gz",
  };
  const receiptsPath = join(dir, "receipts.jsonl");
  writeFileSync(receiptsPath, `${JSON.stringify(receipt)}\n`);
  return { path, sha, receiptsPath };
}

const SENTINELS = {
  contractor_company_name: "SENTINEL-CONTRACTOR-CO",
  contractor_full_name: "SENTINEL-CONTRACTOR-PERSON",
  contractor_phone: "SENTINEL-5125550100",
  applicant_full_name: "SENTINEL-APPLICANT-PERSON",
  applicant_org: "SENTINEL-APPLICANT-ORG",
  applicant_address1: "SENTINEL-9 APPLICANT RD",
};
const permitRow = (i: number): Record<string, string> => ({
  ":id": `row-${i}`,
  ":updated_at": "2026-10-01T00:00:00.000Z",
  permit_number: `2026-00000${i} BP`,
  permittype: "BP",
  work_class: "Remodel",
  description: "SYNTHETIC TEST INPUT",
  status_current: "Active",
  issue_date: "2026-09-01T00:00:00.000",
  tcad_id: "0100000001",
  original_address1: `${i} SYNTHETIC ST`,
  original_zip: "78701",
  jurisdiction: "AUSTIN FULL PURPOSE",
  ...SENTINELS,
});

describe("DP-5 property_improvements.page_key", () => {
  it("migration 0303 adds page_key to property_improvements (idempotent)", () => {
    const sql = readFileSync(MIGRATION_0303, "utf8");
    expect(sql).toMatch(/ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS page_key text/);
  });

  it("the page upsert writes page_key = the page file name", async () => {
    const a = pageArtifact([permitRow(1)]);
    const { tx, queries } = fakeTx((text, values) =>
      text.startsWith("INSERT INTO property_improvements") ? ((values.find(Array.isArray) ?? []) as string[]).map((n) => ({ permit_number: n })) : [],
    );
    await track.merge(tx, { kind: "page", jobId: JOB, mode: "backfill", artifactPath: a.path, artifactSha256: a.sha, pageIndex: 1, rows: 1, receiptsPath: a.receiptsPath });
    const up = queries.find((q) => q.text.startsWith("INSERT INTO property_improvements"));
    expect(up?.text).toMatch(/page_key/);
    expect(up?.text).toMatch(/page_key = excluded\.page_key/);
    expect(JSON.stringify(up?.values)).toContain("page-000001");
  });
});

describe("page merge clears a tombstone for a permit that is served again", () => {
  it("clears tombstoned and the source_tombstones row even when the content digest is unchanged", async () => {
    const r = permitRow(1);
    const a = pageArtifact([r]);
    const { tx, queries } = fakeTx();
    await track.merge(tx, { kind: "page", jobId: JOB, mode: "incremental", artifactPath: a.path, artifactSha256: a.sha, pageIndex: 1, rows: 1, receiptsPath: a.receiptsPath });
    const clear = queries.find((q) => q.text.startsWith("UPDATE property_improvements SET tombstoned = false"));
    expect(clear?.values).toContainEqual([r.permit_number]);
    expect(queries.find((q) => q.text.startsWith("DELETE FROM source_tombstones"))?.values).toContainEqual([r[":id"]]);
  });
});

describe("OR-m8 permits --link needs a complete TCAD run", () => {
  const link = {
    kind: "link" as const, jobId: LINK_JOB, mode: "link" as const, artifactPath: `run:${LINK_JOB}:link`,
    artifactSha256: inputDigest({ l: 2 }), asOf: "2026-10-21",
  };
  const answerRuns = (runs: { job_id: string; status: string; mode: string }[]) => (text: string): unknown[] => {
    if (text.startsWith("SELECT job_id, status, mode FROM backbone_runs")) return runs;
    return [];
  };

  it("refuses when no complete TCAD run exists (TerminalError, no parcel read)", async () => {
    const { tx, queries } = fakeTx(answerRuns([]));
    const err = await track.merge(tx, link).then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe("TerminalError");
    expect((err as Error).message).toMatch(/complete TCAD/);
    expect(queries.some((q) => q.text.includes("FROM parcels"))).toBe(false);
  });

  it("refuses when parcels come from a still-running TCAD run", async () => {
    const { tx } = fakeTx(answerRuns([
      { job_id: "travis-a04-tcad-full-1", status: "complete", mode: "full" },
      { job_id: "travis-a04-tcad-full-2", status: "running", mode: "full" },
    ]));
    const err = await track.merge(tx, link).then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe("TerminalError");
    expect((err as Error).message).toMatch(/still running/);
  });

  it("links when a TCAD full run is complete and none is running", async () => {
    const { tx, queries } = fakeTx(answerRuns([{ job_id: "travis-a04-tcad-full-1", status: "complete", mode: "full" }]));
    const out = await track.merge(tx, link);
    expect(out.rowsWritten).toBe(0);
    expect(queries.some((q) => q.text.includes("FROM parcels"))).toBe(true);
  });
});

describe("OR-m3 applicant and contractor keys never leave permit_source_rows.payload", () => {
  const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(\s)\/\/.*$/gm, "$1");

  it("the track and report-section code never name an applicant or contractor field", () => {
    for (const f of ["../../services/tracks/permits.ts", "../../services/report-sections/permits.ts"]) {
      const code = strip(readFileSync(new URL(f, import.meta.url), "utf8"));
      expect(code, f).not.toMatch(/contractor|applicant/i);
    }
  });

  it("the property_improvements DDL (0301, 0302, 0303) has no applicant or contractor column", () => {
    for (const f of ["0301_permits.sql", "0302_permit_roofing_verdict.sql", "0303_permit_page_key.sql"]) {
      const sql = readFileSync(new URL(`../../migrations/${f}`, import.meta.url), "utf8");
      const pi = f.startsWith("0301") ? sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS property_improvements")) : sql;
      expect(strip(pi.replace(/^\s*--.*$/gm, "")), f).not.toMatch(/contractor|applicant/i);
    }
  });

  it("no statement of a page merge other than the permit_source_rows payload carries a sentinel value", async () => {
    const a = pageArtifact([permitRow(1), permitRow(2)]);
    const { tx, queries } = fakeTx((text, values) =>
      text.startsWith("INSERT INTO property_improvements") ? ((values.find(Array.isArray) ?? []) as string[]).map((n) => ({ permit_number: n })) : [],
    );
    await track.merge(tx, { kind: "page", jobId: JOB, mode: "backfill", artifactPath: a.path, artifactSha256: a.sha, pageIndex: 1, rows: 2, receiptsPath: a.receiptsPath });
    for (const q of queries) {
      const hit = JSON.stringify(q.values).includes("SENTINEL-");
      if (q.text.startsWith("INSERT INTO permit_source_rows")) expect(hit).toBe(true);
      else expect(hit, q.text.slice(0, 50)).toBe(false);
    }
  });

  it("the link merge never writes a sentinel, and the report section is built from counts only", async () => {
    const payload = permitRow(1);
    let served = false;
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("SELECT job_id, status, mode FROM backbone_runs")) return [{ job_id: "travis-a04-tcad-full-1", status: "complete", mode: "full" }];
      if (text.startsWith("SELECT pi.permit_number, psr.payload")) {
        if (served) return [];
        served = true;
        return [{ permit_number: payload.permit_number, payload }];
      }
      if (text.startsWith("UPDATE property_improvements AS pi")) return [{ n: 1 }];
      return [];
    });
    await track.merge(tx, { kind: "link", jobId: LINK_JOB, mode: "link", artifactPath: `run:${LINK_JOB}:link`, artifactSha256: inputDigest({ l: 3 }), asOf: "2026-10-21" });
    expect(JSON.stringify(queries.map((q) => q.values))).not.toContain("SENTINEL-");
    const section = assemblePermitsSection({
      sourceJobs: [JOB], watermark: null, capturedAtW: 0, outsideTravis: 0, candidates: 1, linked: 1,
      unmatchedByReason: {}, statusCounts: { open: 1 }, tombstones: 0, profileSha256: null,
    });
    expect(JSON.stringify(section)).not.toMatch(/SENTINEL-|contractor|applicant/i);
  });
});
