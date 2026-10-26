// A-04 T053 + T056: the `permits` Loader track, migration 0301_permits.sql and the `permits` /
// `jurisdictions` report sections. A scripted stand-in for postgres.js records every statement
// (synthetic test input; no database). Query DB integration runs only with QDB_TEST_URL.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { runMerge } from "../../services/loader.js";
import { situsOf, track } from "../../services/tracks/permits.js";
import { situsSignature } from "../../../oracle-runtime/travis/permits/link.js";
import {
  assembleJurisdictionsSection,
  assemblePermitsSection,
  jurisdictionsSection,
  section,
} from "../../services/report-sections/permits.js";
import { contentDigest } from "../../../oracle-runtime/travis/permits/content-digest.js";
import { AUSTIN_PAGES } from "../../../oracle-runtime/travis/adapters/socrata/austin-3syk-w9eu.js";
import { inputDigest } from "../../../oracle-runtime/travis/permits/merge-input.js";

const MIGRATION = readFileSync(new URL("../../migrations/0301_permits.sql", import.meta.url), "utf8");
const JOB = "travis-a04-permits-backfill-202610220300";
const LINK_JOB = "travis-a04-permits-link-202610220400";

interface Query {
  text: string;
  values: unknown[];
  tx: number;
}

/** A scripted postgres.js stand-in: `answer` decides each statement's rows. */
function fakeTx(answer: (text: string, values: unknown[]) => unknown[] = () => [], tx = 1) {
  const queries: Query[] = [];
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$?").replace(/\s+/g, " ").trim();
    queries.push({ text, values, tx });
    return answer(text, values);
  }) as unknown as postgres.TransactionSql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return { tx: fn, queries };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function row(i: number, over: Record<string, string> = {}): Record<string, string> {
  return {
    ":id": `row-${i}`,
    ":updated_at": "2026-10-01T00:00:00.000Z",
    permit_number: `2026-00000${i} BP`,
    permittype: "BP",
    work_class: "Remodel",
    description: "SYNTHETIC TEST INPUT",
    status_current: "Active",
    issue_date: "2026-09-01T00:00:00.000",
    expiresdate: "2027-03-01T00:00:00.000",
    tcad_id: "0100000001",
    original_address1: `${i} SYNTHETIC ST`,
    original_zip: "78701",
    original_state: "TX",
    jurisdiction: "LAKEWAY FULL PURPOSE",
    latitude: "30.1",
    longitude: "-97.7",
    contractor_company_name: "SYNTHETIC CONTRACTOR",
    ...over,
  };
}

function pageArtifact(rows: Record<string, string>[]) {
  const dir = mkdtempSync(join(tmpdir(), "a04-permits-track-"));
  dirs.push(dir);
  const body = Buffer.from(JSON.stringify(rows));
  const sha = createHash("sha256").update(body).digest("hex");
  mkdirSync(join(dir, "raw", "pages"), { recursive: true });
  const path = join(dir, "raw", "pages", "page-000001.json.gz");
  writeFileSync(path, gzipSync(body));
  const receipt = {
    source: "austin-3syk-w9eu",
    kind: "page",
    page_index: 1,
    url: "https://data.austintexas.gov/resource/3syk-w9eu.json?%24select=*",
    method: "GET",
    http_status: 200,
    bytes: body.length,
    sha256: sha,
    captured_at: "2026-10-22T03:00:01.000Z",
    outcome: "ok",
    blocked_reason: null,
    blocked_at: null,
    attempts: 1,
    ua: "oracle-travis-discovery/0.1",
    app_token_used: false,
    rows: rows.length,
    last_id: rows[rows.length - 1]?.[":id"] ?? null,
    file: "raw/pages/page-000001.json.gz",
  };
  const receiptsPath = join(dir, "receipts.jsonl");
  writeFileSync(receiptsPath, `${JSON.stringify(receipt)}\n`);
  return { dir, path, sha, receiptsPath };
}

describe("0301_permits.sql (data-model.md § 0301)", () => {
  it("creates permit_source_rows with PK (source, row_id) and every source column", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS permit_source_rows/);
    for (const col of ["source", "row_id", "permit_number", "page_sha256", "row_index", "content_sha256", "updated_at", "captured_at", "job_id", "payload"]) {
      expect(MIGRATION).toMatch(new RegExp(`\\n\\s+${col} `));
    }
    expect(MIGRATION).toMatch(/PRIMARY KEY \(source, row_id\)/);
  });

  it("creates property_improvements with PK (permit_number, issuing_jurisdiction) and the closed value lists", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS property_improvements/);
    expect(MIGRATION).toMatch(/PRIMARY KEY \(permit_number, issuing_jurisdiction\)/);
    expect(MIGRATION).toMatch(/unmatched_reason IN \('no_tcad_id', 'no_tcad_geoid', 'address_unmatched', 'ambiguous_geoid', 'ambiguous_address'\)/);
    expect(MIGRATION).toMatch(/open_days_reason IN \('no_issue_date', 'not_open'\)/);
    expect(MIGRATION).toMatch(/link_method IN \('tcad_id', 'address_hash'\)/);
    expect(MIGRATION).toMatch(/link_rule IN \('geoid_unique_r', 'geoid_plus_address', 'address_sig_v1'\)/);
    expect(MIGRATION).toMatch(/status_class IN \('open', 'stalled', 'closed', 'exclude', 'needs_review'\)/);
    expect(MIGRATION).toMatch(/coordinate_review_flag IN \('permit_far_from_gis'\)/);
    expect(MIGRATION).toMatch(/tombstoned boolean NOT NULL DEFAULT false/);
    for (const col of ["located_jurisdiction", "in_travis", "source_row_id", "tcad_id", "request_identifier", "link_confidence", "reroof_match", "status_raw", "profile_sha256", "issue_date", "expiry_date", "open_days", "latitude", "longitude", "payload_sha256", "previous_content_sha256", "updated_in_job", "source_url"]) {
      expect(MIGRATION).toMatch(new RegExp(`\\n\\s+${col} `));
    }
  });

  it("contractor fields stay in permit_source_rows.payload only; no regex in SQL; mode 'link' allowed on backbone_runs", () => {
    const pi = MIGRATION.slice(MIGRATION.indexOf("CREATE TABLE IF NOT EXISTS property_improvements"));
    expect(pi).not.toMatch(/contractor/i);
    expect(MIGRATION).not.toMatch(/~\*?\s*'|SIMILAR TO|regexp_/i);
    expect(MIGRATION).toMatch(/backbone_runs_mode_check CHECK \(mode IN \('pilot', 'full', 'backfill', 'incremental', 'coords', 'link'\)\)/);
  });
});

describe("Loader track `permits` (T053)", () => {
  it("is the permits track and validates its inputs", () => {
    expect(track.name).toBe("permits");
    expect(track.input.safeParse({ kind: "page", jobId: JOB }).success).toBe(false);
  });

  it("A-04-TC-056 a page upserts by (permit_number, issuing_jurisdiction) only WHERE the content digest differs; previous digest and updated_in_job set", async () => {
    const rows = [row(1), row(2)];
    const a = pageArtifact(rows);
    const { tx, queries } = fakeTx((text, values) => {
      if (text.startsWith("INSERT INTO property_improvements")) return ((values.find(Array.isArray) ?? []) as string[]).map((n) => ({ permit_number: n }));
      return [];
    });
    const out = await track.merge(tx, {
      kind: "page", jobId: JOB, mode: "backfill", artifactPath: a.path, artifactSha256: a.sha, pageIndex: 1, rows: 2, receiptsPath: a.receiptsPath,
    });
    expect(out.rowsWritten).toBe(2);
    const upsert = queries.find((q) => q.text.startsWith("INSERT INTO property_improvements"));
    expect(upsert?.text).toMatch(/ON CONFLICT \(permit_number, issuing_jurisdiction\) DO UPDATE SET/);
    expect(upsert?.text).toMatch(/previous_content_sha256 = property_improvements\.content_sha256/);
    expect(upsert?.text).toMatch(/updated_in_job = excluded\.updated_in_job/);
    expect(upsert?.text).toMatch(/WHERE property_improvements\.content_sha256 IS DISTINCT FROM excluded\.content_sha256/);
    expect(upsert?.text).not.toMatch(/contractor/i);
    expect(upsert?.values).toContainEqual(["2026-000001 BP", "2026-000002 BP"]);
    expect(upsert?.values).toContainEqual([contentDigest(rows[0]!, AUSTIN_PAGES.volatileFields), contentDigest(rows[1]!, AUSTIN_PAGES.volatileFields)]);
    expect(upsert?.values).toContainEqual(["LAKEWAY FULL PURPOSE", "LAKEWAY FULL PURPOSE"]); // located, not issuing
    expect(upsert?.text).toMatch(/'austin'/); // issuing jurisdiction (FR-022)
    const src = queries.find((q) => q.text.startsWith("INSERT INTO permit_source_rows"));
    expect(src?.text).toMatch(/ON CONFLICT \(source, row_id\) DO UPDATE/);
    expect(JSON.stringify(src?.values)).toMatch(/SYNTHETIC CONTRACTOR/); // the raw payload keeps everything
    const receipt = queries.find((q) => q.text.startsWith("INSERT INTO capture_receipts"));
    expect(receipt?.values).toContain(a.sha);
  });

  it("an identical re-capture plans no property_improvements write", async () => {
    const r = row(1);
    const a = pageArtifact([r]);
    const { tx, queries } = fakeTx((text) =>
      text.startsWith("SELECT pi.permit_number")
        ? [{ permit_number: r.permit_number, source_row_id: r[":id"], content_sha256: contentDigest(r, AUSTIN_PAGES.volatileFields), payload: r }]
        : [],
    );
    const out = await track.merge(tx, { kind: "page", jobId: JOB, mode: "incremental", artifactPath: a.path, artifactSha256: a.sha, pageIndex: 1, rows: 1, receiptsPath: a.receiptsPath });
    expect(out.rowsWritten).toBe(0);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO property_improvements"))).toBe(false);
  });

  it("A-04-TC-055 finalize: source_removed tombstones for removed rows only, permit downgraded (never deleted), watermark returned for the same transaction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "a04-keys-"));
    dirs.push(dir);
    const keysBody = `${JSON.stringify({ row_id: "r1", permit_number: "A" })}\n`;
    const keysPath = join(dir, "keys.ndjson");
    writeFileSync(keysPath, keysBody);
    const keysSha = createHash("sha256").update(keysBody).digest("hex");
    const watermark = {
      lastId: "r1", maxUpdatedAt: "2026-10-01T00:00:00.000Z", sourceCountAtW: 1, capturedAtW: 1, aboveW: 0, startTotal: 1, endTotal: 1,
      watermarkCheck: "pass" as const, pages: 1, rows: 1, startedAt: "2026-10-22T03:00:00.000Z", finishedAt: "2026-10-22T03:10:00.000Z", jobId: JOB, mode: "backfill" as const, restamp: null,
    };
    const input = {
      kind: "finalize" as const, jobId: JOB, mode: "backfill" as const, artifactPath: `run:${JOB}:finalize`, artifactSha256: inputDigest({ JOB, k: "f" }),
      finishedAt: "2026-10-22T03:10:00.000Z", asOf: "2026-10-22", watermark, keys: { path: keysPath, sha256: keysSha, count: 1 },
      limitations: [{ sourceKey: "austin-3syk-w9eu", code: "source_bulk_restamp", text: "source bulk re-stamp; delta by content digest", count: 3, evidenceUrl: null }],
      receiptsPath: null,
    };
    const answer = (text: string): unknown[] => {
      if (text.startsWith("SELECT count(*)")) return [{ n: 1000 }];
      if (text.startsWith("SELECT p.row_id")) {
        return [
          { row_id: "r2", permit_number: "B", permit_seen: false },
          { row_id: "r3", permit_number: "A", permit_seen: true },
        ];
      }
      if (text.startsWith("INSERT INTO source_tombstones")) return [{ row_key: "r2" }];
      return [];
    };
    const { tx, queries } = fakeTx(answer);
    const out = await track.merge(tx, input);
    expect(out.tombstones).toBe(1);
    expect(out.watermark).toEqual({ sourceKey: "austin-3syk-w9eu", value: watermark });
    const tomb = queries.find((q) => q.text.startsWith("INSERT INTO source_tombstones"));
    expect(tomb?.text).toMatch(/'source_removed'/);
    expect(tomb?.values).toContainEqual(["r2"]);
    expect(tomb?.values).toContainEqual(["B"]);
    const down = queries.find((q) => q.text.startsWith("UPDATE property_improvements SET tombstoned = true"));
    expect(down?.values).toContainEqual(["B"]);
    expect(queries.some((q) => /^DELETE FROM property_improvements/.test(q.text))).toBe(false);
    expect(queries.find((q) => q.text.startsWith("INSERT INTO source_limitations"))?.values).toContain("source bulk re-stamp; delta by content digest");
    expect(queries.find((q) => q.text.startsWith("UPDATE backbone_runs"))?.values).toContain("complete");

    // through the Loader: rows, tombstones and the watermark in ONE transaction
    const all: Query[] = [];
    let begins = 0;
    const sql = {
      begin: async <T>(fn: (t: postgres.TransactionSql) => Promise<T>): Promise<T> => {
        begins += 1;
        const f = fakeTx(answer, begins);
        const res = await fn(f.tx);
        all.push(...f.queries);
        return res;
      },
    } as unknown as postgres.Sql;
    await runMerge(sql, track, input);
    expect(begins).toBe(1);
    const txOf = (prefix: string) => all.find((q) => q.text.startsWith(prefix))?.tx;
    expect(txOf("INSERT INTO source_tombstones")).toBe(1);
    expect(txOf("INSERT INTO watermarks")).toBe(1);
  });

  it("stop: the run is waiting_human and the blocked receipt (http_status 403, blocked_at) is recorded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "a04-stop-"));
    dirs.push(dir);
    const receiptsPath = join(dir, "receipts.jsonl");
    writeFileSync(
      receiptsPath,
      `${JSON.stringify({ source: "austin-3syk-w9eu", kind: "page", page_index: 2, url: "https://data.austintexas.gov/x", http_status: 403, bytes: 10, sha256: "0".repeat(64), captured_at: "2026-10-22T03:00:05.000Z", outcome: "blocked", blocked_reason: "http-403", blocked_at: "2026-10-22T03:00:05.000Z", attempts: 1, ua: "ua", rows: null })}\n`,
    );
    const { tx, queries } = fakeTx();
    await track.merge(tx, { kind: "stop", jobId: JOB, mode: "backfill", artifactPath: `run:${JOB}:stop`, artifactSha256: inputDigest({ s: 1 }), status: "waiting_human", finishedAt: "2026-10-22T03:00:06.000Z", reason: "page 2 blocked (HTTP 403)", receiptsPath });
    expect(queries.find((q) => q.text.startsWith("UPDATE backbone_runs"))?.values).toContain("waiting_human");
    const rec = queries.find((q) => q.text.startsWith("INSERT INTO capture_receipts"));
    expect(rec?.values).toContain("blocked");
    expect(rec?.values).toContain(403);
    expect(rec?.values).toContain("2026-10-22T03:00:05.000Z");
  });

  it("A-04-TC-043 A-04-TC-046 link: geoID link, no_tcad_geoid kept with open_days from issue_date, profile stamped, Austin-issued", async () => {
    const parcels = [{ request_identifier: "221829", geo_id: "0223120506", prop_type: "R", situs_address: { streetNum: "100", streetName: "ALPHA", streetSuffix: "ST", zip: "78701" } }];
    const permits = [
      { permit_number: "1982-012866 BP", payload: { permit_number: "1982-012866 BP", permittype: "BP", status_current: "Suspended", issue_date: "1982-06-23T00:00:00.000", tcad_id: "0208011301", jurisdiction: "AUSTIN FULL PURPOSE" } },
      { permit_number: "2000-000025 BP", payload: { permit_number: "2000-000025 BP", permittype: "BP", status_current: "Re Review", issue_date: "2000-01-05T00:00:00.000", tcad_id: "0223120506", original_zip: "78701" } },
    ];
    let served = false;
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("SELECT job_id, status, mode FROM backbone_runs")) return [{ job_id: "travis-a04-tcad-full-1", status: "complete", mode: "full" }];
      if (text.startsWith("SELECT request_identifier, geo_id, prop_type, situs_address FROM parcels")) return parcels;
      if (text.startsWith("SELECT g.geo_id")) return [];
      if (text.startsWith("SELECT pi.permit_number, psr.payload")) {
        if (served) return [];
        served = true;
        return permits;
      }
      if (text.startsWith("UPDATE property_improvements AS pi")) return [{ n: 1 }, { n: 1 }];
      return [];
    });
    const out = await track.merge(tx, { kind: "link", jobId: LINK_JOB, mode: "link", artifactPath: `run:${LINK_JOB}:link`, artifactSha256: inputDigest({ l: 1 }), asOf: "2026-10-21" });
    expect(out.rowsWritten).toBe(2);
    const upd = queries.find((q) => q.text.startsWith("UPDATE property_improvements AS pi"));
    expect(upd?.text).toMatch(/pi\.issuing_jurisdiction = 'austin'/);
    const [numbers, reqIds, methods, rules, , reasons, inTravis, includeTerm, statusClass, profileSha, openDays, openReason] = upd!.values as string[][];
    expect(numbers).toEqual(["1982-012866 BP", "2000-000025 BP"]);
    expect(reqIds).toEqual([null, "221829"]);
    expect(methods).toEqual([null, "tcad_id"]);
    expect(rules).toEqual([null, "geoid_unique_r"]);
    expect(reasons).toEqual(["no_tcad_geoid", null]);
    expect(inTravis).toEqual(["false", "true"]);
    expect(includeTerm).toEqual(["false", "false"]);
    expect(statusClass).toEqual(["open", "open"]);
    expect(new Set(profileSha)).toEqual(new Set(["c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6"]));
    expect(openDays).toEqual(["16191", String((Date.UTC(2026, 9, 21) - Date.UTC(2000, 0, 5)) / 864e5)]);
    expect(openReason).toEqual([null, null]);
    // the profile's verdict is stored beside reroof_match (the baseline population stays include_term)
    const [verdict, verdictReason, impType, impAction] = (upd!.values as (string | null)[][]).slice(12);
    expect(upd?.text).toMatch(/roofing_verdict = u\.roofing_verdict/);
    expect(verdict).toEqual(["not_roofing", "not_roofing"]);
    expect(verdictReason).toEqual(["no_include_term", "no_include_term"]);
    expect(impType).toEqual([null, null]);
    expect(impAction).toEqual([null, null]);
  });
});

describe("0302_permit_roofing_verdict.sql", () => {
  const SQL = readFileSync(new URL("../../migrations/0302_permit_roofing_verdict.sql", import.meta.url), "utf8");
  it("adds the four nullable verdict columns with a CHECK on the profile's verdict values", () => {
    for (const col of ["roofing_verdict", "roofing_reason", "improvement_type", "improvement_action"]) {
      expect(SQL).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col} text`));
    }
    expect(SQL).toMatch(/roofing_verdict IN \('roofing', 'not_roofing', 'needs_review'\)/);
    expect(SQL).not.toMatch(/NOT NULL/);
  });
});

describe("report sections permits + jurisdictions (T056, contracts/report.md)", () => {
  it("permits: counts at the watermark, status vs baseline, unmatched by reason, re-stamp, throughput via throughputRow", () => {
    const s = assemblePermitsSection({
      sourceJobs: [JOB, LINK_JOB],
      watermark: {
        lastId: "row-9", maxUpdatedAt: "2026-10-22T02:00:00.000Z", sourceCountAtW: 100, capturedAtW: 100, aboveW: 2, startTotal: 100, endTotal: 102,
        watermarkCheck: "pass", pages: 3, rows: 100, startedAt: "2026-10-22T03:00:00.000Z", finishedAt: "2026-10-22T03:00:50.000Z", jobId: JOB, mode: "backfill",
        restamp: { detected: true, rowsWritten: 3 },
      },
      capturedAtW: 100,
      outsideTravis: 4,
      candidates: 10,
      linked: 9,
      unmatchedByReason: { no_tcad_geoid: 1 },
      statusCounts: { open: 2, stalled: 3, closed: 4, exclude: 1 },
      tombstones: 1,
      profileSha256: "c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6",
    });
    expect(s).toMatchObject({
      source_jobs: [JOB, LINK_JOB],
      source_total_at_watermark: 100,
      captured_at_watermark: 100,
      above_watermark: 2,
      watermark: "2026-10-22T02:00:00.000Z",
      outside_travis: 4,
      reroof_candidates: 10,
      linked: 9,
      link_rate: 0.9,
      unmatched_by_reason: { no_tcad_geoid: 1 },
      restamp: { detected: true, rows_written: 3 },
      tombstones: 1,
      throughput: { pages: 3, duration_s: 50, rows_per_s: 2 },
    });
    expect(s.status_class_vs_baseline.open).toEqual({ run: 2, baseline: 129, delta: -127 });
    expect(Object.keys(s.status_class_vs_baseline)).toEqual(["open", "stalled", "closed", "exclude"]);
    expect(section.key).toBe("permits");
    expect(jurisdictionsSection.key).toBe("jurisdictions");
  });

  it("A-04-TC-048 A-04-TC-049 jurisdictions: Austin supported with captured/total/time; 22 absent with their limitation; Lakeway, Bee Cave, Pflugerville own_permits_captured false", () => {
    const s = assembleJurisdictionsSection({
      captured: 100,
      sourceTotal: 100,
      capturedAt: "2026-10-22T03:00:50.000Z",
      located: { "LAKEWAY FULL PURPOSE": 6827, "BEE CAVE FULL PURPOSE": 4822, "PFLUGERVILLE FULL PURPOSE": 1117, "PFLUGERVILLE ETJ": 592, "AUSTIN FULL PURPOSE": 90 },
    });
    expect(s.supported).toEqual([{ key: "austin", captured: 100, source_total: 100, captured_at: "2026-10-22T03:00:50.000Z" }]);
    expect(s.absent).toHaveLength(22);
    const byKey = Object.fromEntries(s.absent.map((a) => [a.key, a]));
    expect(byKey.lakeway).toMatchObject({ name: "Lakeway", class: "records_request", own_permits_captured: false, austin_issued_located_here: 6827 });
    expect(byKey.bee_cave?.austin_issued_located_here).toBe(4822);
    expect(byKey.pflugerville?.austin_issued_located_here).toBe(1709);
    expect(s.limitations).toHaveLength(22);
    for (const l of s.limitations) expect(l).toMatch(/^.+: no public permit history captured \(records request, not filed\); evidence https:\/\//);
  });
});

describe("situsOf tolerates both stored shapes", () => {
  const obj = { street_number: "100", street_name: "ALPHA", street_suffix: "ST", zip: "78701" };
  it("reads an object and a (legacy double-encoded) JSON string alike", () => {
    expect(situsOf(JSON.stringify(obj))).toEqual(situsOf(obj));
    expect(situsOf(obj)?.streetName).toBe("ALPHA");
    expect(situsOf("not json")).toBeNull();
    expect(situsOf('"x"')).toBeNull();
    expect(situsOf(null)).toBeNull();
  });
});

describe("parcels.situs_address as G-TCAD stores it (snake_case SitusAddress)", () => {
  it("reads the stored shape to the same address signature as the printed TCAD situs", () => {
    const stored = { text: "100 ALPHA ST, AUSTIN, TX 78701", street_number: "100", street_prefix: null, street_name: "ALPHA", street_suffix: "ST", street_secondary: null, city: "AUSTIN", state: "TX", zip: "78701" };
    const printed = { streetNum: "100", streetName: "ALPHA", streetSuffix: "ST", state: "TX", zip: "78701" };
    expect(situsSignature(situsOf(stored))).not.toBeNull();
    expect(situsSignature(situsOf(stored))).toBe(situsSignature(situsOf(printed)));
  });
});
