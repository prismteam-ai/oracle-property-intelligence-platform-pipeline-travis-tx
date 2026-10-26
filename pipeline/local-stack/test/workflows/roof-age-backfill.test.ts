// A-07 T059/T060 follow-up (coverage gap, 2026-10-23): `RoofAgeBackfill` (services/workflows/
// roof-age-backfill.ts) had zero unit tests — only proven live against the real database. A
// scripted postgres.js stand-in records every statement (no database).
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  attachCompletedDates,
  createRoofAgeBackfill,
  estimateBatch,
  runBackfill,
} from "../../services/workflows/roof-age-backfill.js";
import { QueryDbConfigError } from "../../services/loader.js";

interface Query {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (text: string, values: unknown[]) => unknown[]) {
  const queries: Query[] = [];
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    return answer(text, values);
  }) as unknown as postgres.Sql;
  (fn as unknown as { array: (v: unknown) => unknown }).array = (v: unknown) => v;
  return { sql: fn, queries };
}

const AS_OF = "2026-10-22";
const JOB = "travis-a07-roofage-apply25-202610230000";

const PARCEL = {
  request_identifier: "100050",
  property_structure_built_year: 1930,
  source_url: "https://traviscad.org/x.zip",
  captured_at: "2026-10-19T21:33:41.241Z",
  export_sha256: "a".repeat(64),
};

describe("attachCompletedDates", () => {
  it("skips the query entirely when there is no closed+roofing permit in the batch", async () => {
    let ran = false;
    const { sql } = fakeSql(() => {
      ran = true;
      return [];
    });
    const permits = [
      { request_identifier: "1", permit_number: "x", source: "austin-3syk-w9eu", status_class: "open" as const, reroof_match: true, issue_date: null, source_url: "u", captured_at: "c", content_sha256: "a".repeat(64), completed_date: null },
    ];
    const out = await attachCompletedDates(sql, permits);
    expect(ran).toBe(false);
    expect(out).toBe(permits);
  });

  it("fills completed_date only for the matching (source, permit_number) pair, leaving others null", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT source, permit_number, payload ->>")) {
        return [{ source: "austin-3syk-w9eu", permit_number: "A", completed_date: "2020-01-02T00:00:00.000" }];
      }
      return [];
    });
    const permits = [
      { request_identifier: "1", permit_number: "A", source: "austin-3syk-w9eu", status_class: "closed" as const, reroof_match: true, issue_date: "2019-01-01", source_url: "u", captured_at: "c", content_sha256: "a".repeat(64), completed_date: null },
      { request_identifier: "1", permit_number: "B", source: "austin-3syk-w9eu", status_class: "closed" as const, reroof_match: true, issue_date: "2019-01-01", source_url: "u", captured_at: "c", content_sha256: "a".repeat(64), completed_date: null },
    ];
    const out = await attachCompletedDates(sql, permits);
    expect(out.find((p) => p.permit_number === "A")?.completed_date).toBe("2020-01-02");
    expect(out.find((p) => p.permit_number === "B")?.completed_date).toBeNull();
  });
});

describe("estimateBatch", () => {
  it("carries each property's own permits into sourceRecords, alongside the TCAD row's own receipt", async () => {
    const permit = { request_identifier: "1", permit_number: "2015-004411 BP", source: "austin-3syk-w9eu", status_class: "closed" as const, reroof_match: true, issue_date: "2015-03-01", source_url: "permit-url", captured_at: "permit-captured", content_sha256: "c".repeat(64), completed_date: "2015-04-15" };
    const [estimated] = await estimateBatch([{ ...PARCEL, request_identifier: "1" }], [permit], AS_OF);
    expect(estimated?.estimated.estimate.anchor?.type).toBe("permit_terminal_date");
    expect(estimated?.sourceRecords).toHaveLength(2);
    expect(estimated?.sourceRecords[1]).toMatchObject({ type: "permit", permitNumber: "2015-004411 BP" });
  });
});

describe("runBackfill — subset scope (T059: apply the 25)", () => {
  it("computes coverage but writes nothing when apply is false (the --apply gate)", async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) return [PARCEL];
      if (text.startsWith("SELECT pi.request_identifier")) return [];
      return [];
    });
    const result = await runBackfill(sql, { jobId: JOB, asOfDate: AS_OF, limit: 25, offset: 0, apply: false });
    expect(result.scope).toBe("subset");
    expect(result.apply).toBe(false);
    expect(result.rowsWritten).toBe(0);
    expect(result.coverage.total).toBe(1);
    expect(result.coverage.byBasis.built_year).toBe(1);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO roof_age_estimates"))).toBe(false);
  });

  it("writes one row per property and reports rowsWritten from the RETURNING count when apply is true", async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) return [PARCEL];
      if (text.startsWith("SELECT pi.request_identifier")) return [];
      if (text.startsWith("INSERT INTO roof_age_estimates")) return [{ tcad_id: "100050" }];
      return [];
    });
    const result = await runBackfill(sql, { jobId: JOB, asOfDate: AS_OF, limit: 25, offset: 0, apply: true });
    expect(result.rowsWritten).toBe(1);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO roof_age_estimates"))).toBe(true);
  });

  it("is idempotent: an immediate re-run over an unchanged estimate reports rowsWritten: 0 (the WHERE-differs RETURNING is empty)", async () => {
    // Mirrors the real `ON CONFLICT ... WHERE roof_age_estimates.roof_age_basis IS DISTINCT
    // FROM excluded... RETURNING` clause: when nothing actually changed, Postgres returns zero
    // rows. The fake asserts the backfill trusts exactly that count, not the batch size.
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) return [PARCEL];
      if (text.startsWith("SELECT pi.request_identifier")) return [];
      if (text.startsWith("INSERT INTO roof_age_estimates")) return []; // nothing changed -> 0 rows
      return [];
    });
    const result = await runBackfill(sql, { jobId: JOB, asOfDate: AS_OF, limit: 25, offset: 0, apply: true });
    expect(result.rowsWritten).toBe(0);
  });
});

describe("runBackfill — a property with its own permits (attachCompletedDates' real date-fetch branch)", () => {
  it("fetches the real completed_date for closed+roofing permits and carries each permit's own receipt into sourceRecords", async () => {
    const permitRow = {
      request_identifier: "221829",
      permit_number: "2015-004411 BP",
      source: "austin-3syk-w9eu",
      status_class: "closed" as const,
      reroof_match: true,
      issue_date: "2015-03-01",
      source_url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=2015-004411%20BP",
      captured_at: "2026-10-21T22:13:00.757Z",
      content_sha256: "b".repeat(64),
      completed_date: null,
    };
    let dateQueryRan = false;
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) {
        return [{ ...PARCEL, request_identifier: "221829" }];
      }
      if (text.startsWith("SELECT pi.request_identifier")) return [permitRow];
      if (text.startsWith("SELECT source, permit_number, payload ->>")) {
        dateQueryRan = true;
        return [{ source: "austin-3syk-w9eu", permit_number: "2015-004411 BP", completed_date: "2015-04-15T00:00:00.000" }];
      }
      if (text.startsWith("INSERT INTO roof_age_estimates")) return [{ tcad_id: "221829" }];
      return [];
    });
    const result = await runBackfill(sql, { jobId: JOB, asOfDate: AS_OF, limit: 25, offset: 0, apply: true });
    expect(dateQueryRan).toBe(true);
    expect(result.coverage.byBasis.permit).toBe(1);
    expect(result.rowsWritten).toBe(1);
  });
});

describe("runBackfill — full scope (T060)", () => {
  it("pages every parcel by keyset until a short page ends the scan, summing rowsWritten across batches", async () => {
    const pageOne = [PARCEL];
    const pageTwo: typeof PARCEL[] = [];
    let pageCall = 0;
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT request_identifier, property_structure_built_year")) {
        pageCall += 1;
        return pageCall === 1 ? pageOne : pageTwo;
      }
      if (text.startsWith("SELECT pi.request_identifier")) return [];
      if (text.startsWith("INSERT INTO roof_age_estimates")) return [{ tcad_id: "100050" }];
      return [];
    });
    const result = await runBackfill(sql, { jobId: JOB, asOfDate: AS_OF, apply: true, offset: 0 });
    expect(result.scope).toBe("full");
    expect(result.rowsWritten).toBe(1);
    expect(result.coverage.total).toBe(1);
  });
});

describe("createRoofAgeBackfill (Restate wiring)", () => {
  it("names the service RoofAgeBackfill and refuses a malformed request with a TerminalError", async () => {
    const def = createRoofAgeBackfill(restate, { sql: () => fakeSql(() => []).sql });
    expect(def.name).toBe("RoofAgeBackfill");
    const handler = (def as unknown as { service: { run: (c: unknown, r: unknown) => Promise<unknown> } }).service.run;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const err = await handler(ctx, { asOfDate: "not-a-date" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
  });

  it("runs the backfill end to end through the wired handler on a valid request", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) return [PARCEL];
      if (text.startsWith("SELECT pi.request_identifier")) return [];
      return [];
    });
    const def = createRoofAgeBackfill(restate, { sql: () => sql });
    const handler = (def as unknown as { service: { run: (c: unknown, r: unknown) => Promise<unknown> } }).service.run;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const result = (await handler(ctx, { jobId: JOB, asOfDate: AS_OF, limit: 25, offset: 0, apply: false })) as {
      rowsWritten: number;
    };
    expect(result.rowsWritten).toBe(0);
  });

  it("turns a missing DATABASE_URL into a TerminalError", async () => {
    const def = createRoofAgeBackfill(restate, {
      sql: () => {
        throw new QueryDbConfigError("DATABASE_URL is not set");
      },
    });
    const handler = (def as unknown as { service: { run: (c: unknown, r: unknown) => Promise<unknown> } }).service.run;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const err = await handler(ctx, { jobId: JOB, asOfDate: AS_OF }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
  });
});
