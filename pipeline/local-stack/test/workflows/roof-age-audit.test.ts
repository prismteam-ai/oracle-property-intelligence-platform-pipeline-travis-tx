// A-07 T058 follow-up (coverage gap, 2026-10-23): `RoofAgeAudit` (services/workflows/
// roof-age-audit.ts) had zero unit tests — only proven live against the real database. A
// scripted postgres.js stand-in records every statement (no database). Mirrors Track A's
// comptroller track test pattern.
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  auditOne,
  candidateTcadIds,
  completedDateFor,
  createRoofAgeAudit,
  permitsFor,
  roofing,
  runAudit,
} from "../../services/workflows/roof-age-audit.js";
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
  return { sql: fn, queries };
}

const AS_OF = "2026-10-22";

describe("roofing()", () => {
  it("maps reroof_match to the estimator's roofing verdict", () => {
    expect(roofing(true)).toBe("roofing");
    expect(roofing(false)).toBe("not_roofing");
    expect(roofing(null)).toBe("needs_review");
  });
});

describe("candidateTcadIds", () => {
  it("pages the permit-having property filter with the given limit/offset", async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) {
        return [{ request_identifier: "100050", property_structure_built_year: 1930 }];
      }
      return [];
    });
    const rows = await candidateTcadIds(sql, 25, 0);
    expect(rows).toEqual([{ request_identifier: "100050", property_structure_built_year: 1930 }]);
    const query = queries.find((q) => q.text.startsWith("SELECT DISTINCT p.request_identifier"));
    expect(query?.values).toEqual([25, 0]);
  });
});

describe("permitsFor", () => {
  it("reads every non-tombstoned permit linked to one TCAD id", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT permit_number, source, status_class")) {
        return [{ permit_number: "2015-004411 BP", source: "austin-3syk-w9eu", status_class: "closed", reroof_match: true, issue_date: "2015-03-01" }];
      }
      return [];
    });
    const rows = await permitsFor(sql, "221829");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.permit_number).toBe("2015-004411 BP");
  });
});

describe("completedDateFor", () => {
  it("extracts only the completed_date field from the raw capture, trimmed to a day", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT payload ->> 'completed_date'")) {
        return [{ completed_date: "2015-04-15T00:00:00.000" }];
      }
      return [];
    });
    const date = await completedDateFor(sql, "austin-3syk-w9eu", "2015-004411 BP");
    expect(date).toBe("2015-04-15");
  });

  it("returns null when the raw capture has no completed_date", async () => {
    const { sql } = fakeSql(() => [{ completed_date: null }]);
    const date = await completedDateFor(sql, "austin-3syk-w9eu", "2026-999999 BP");
    expect(date).toBeNull();
  });
});

describe("auditOne (view-side derivation)", () => {
  it("agrees with the estimator when the chosen permit anchor passes the chronology gate", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT permit_number, source, status_class")) {
        return [{ permit_number: "2015-004411 BP", source: "austin-3syk-w9eu", status_class: "closed", reroof_match: true, issue_date: "2015-03-01" }];
      }
      if (text.startsWith("SELECT payload ->> 'completed_date'")) return [{ completed_date: "2015-04-15" }];
      return [];
    });
    const row = await auditOne(sql, { request_identifier: "221829", property_structure_built_year: 1975 }, AS_OF);
    expect(row.agree).toBe(true);
    expect(row.estimator.basis).toBe("permit");
    expect(row.viewSide.basis).toBe("permit");
    expect(row.viewSideCaveat).toBeNull();
  });

  it("falls back to the built-year basis on both sides when the only closed+roofing permit's completed date fails the chronology gate (TCAD 100050 regression)", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT permit_number, source, status_class")) {
        return [{ permit_number: "1981-010735 BP", source: "austin-3syk-w9eu", status_class: "closed", reroof_match: true, issue_date: "1981-06-01" }];
      }
      // completed_date (1920) is before the permit's own issue_date (1981): chronologically
      // impossible. terminalDateAccepted must reject it on the view side, exactly like the
      // real estimator's chronologyStartDate guard rejects it on the estimator side.
      if (text.startsWith("SELECT payload ->> 'completed_date'")) return [{ completed_date: "1920-10-23" }];
      return [];
    });
    const row = await auditOne(sql, { request_identifier: "100050", property_structure_built_year: 1930 }, AS_OF);
    expect(row.agree).toBe(true);
    expect(row.estimator.basis).toBe("built_year");
    expect(row.viewSide.basis).toBe("built_year");
    expect(row.viewSide.roofAgeYears).toBe(96);
  });

  it("picks the latest of two qualifying closed+roofing permits on the view side too (two finals -> latest wins)", async () => {
    // completedDateFor is called once per permit with its own (source, permit_number) bound
    // values; answer by inspecting those rather than the static query text, so each permit
    // gets its own distinct completed_date.
    const { sql } = fakeSql((text, values) => {
      if (text.startsWith("SELECT permit_number, source, status_class")) {
        return [
          { permit_number: "2010-000111 BP", source: "austin-3syk-w9eu", status_class: "closed", reroof_match: true, issue_date: "2010-01-01" },
          { permit_number: "2019-000222 BP", source: "austin-3syk-w9eu", status_class: "closed", reroof_match: true, issue_date: "2019-01-01" },
        ];
      }
      if (text.startsWith("SELECT payload ->> 'completed_date'")) {
        const permitNumber = values[1] as string;
        return [{ completed_date: permitNumber === "2010-000111 BP" ? "2010-02-01" : "2019-02-01" }];
      }
      return [];
    });
    const row = await auditOne(sql, { request_identifier: "221829", property_structure_built_year: null }, AS_OF);
    expect(row.viewSide.basis).toBe("permit");
    expect(row.viewSide.roofAgeYears).toBe(7); // 2026 - 2019
    expect(row.agree).toBe(true);
  });

  it("falls back to unknown on both sides with no permits and no built year", async () => {
    const { sql } = fakeSql(() => []);
    const row = await auditOne(sql, { request_identifier: "999999", property_structure_built_year: null }, AS_OF);
    expect(row.agree).toBe(true);
    expect(row.estimator.basis).toBe("unknown");
    expect(row.viewSide.roofAgeYears).toBeNull();
  });
});

describe("runAudit", () => {
  it("assembles the audit result over every candidate property, with correct 25/25 agreement flagging", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) {
        return [{ request_identifier: "1", property_structure_built_year: null }];
      }
      return [];
    });
    const result = await runAudit(sql, { limit: 25, offset: 0, asOfDate: AS_OF });
    expect(result.total).toBe(1);
    expect(result.agreeAll25).toBe(false); // only 1 row, not 25
    expect(result.rows[0]?.tcadId).toBe("1");
  });
});

describe("createRoofAgeAudit (Restate wiring)", () => {
  it("names the service RoofAgeAudit and refuses a malformed request with a TerminalError", async () => {
    const def = createRoofAgeAudit(restate, { sql: () => fakeSql(() => []).sql });
    expect(def.name).toBe("RoofAgeAudit");
    const handler = (def as unknown as { service: { run: (c: unknown, r: unknown) => Promise<unknown> } }).service.run;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const err = await handler(ctx, { limit: -1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
  });

  it("runs the audit end to end through the wired handler on a valid request", async () => {
    const { sql } = fakeSql((text) => {
      if (text.startsWith("SELECT DISTINCT p.request_identifier")) {
        return [{ request_identifier: "1", property_structure_built_year: null }];
      }
      return [];
    });
    const def = createRoofAgeAudit(restate, { sql: () => sql });
    const handler = (def as unknown as { service: { run: (c: unknown, r: unknown) => Promise<unknown> } }).service.run;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const result = (await handler(ctx, { limit: 25, offset: 0, asOfDate: AS_OF })) as { total: number };
    expect(result.total).toBe(1);
  });

  it("turns a missing DATABASE_URL into a TerminalError", async () => {
    const def = createRoofAgeAudit(restate, {
      sql: () => {
        throw new QueryDbConfigError("DATABASE_URL is not set");
      },
    });
    const handler = (def as unknown as { service: { run: (c: unknown, r: unknown) => Promise<unknown> } }).service.run;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const err = await handler(ctx, { limit: 25, offset: 0, asOfDate: AS_OF }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
  });
});
