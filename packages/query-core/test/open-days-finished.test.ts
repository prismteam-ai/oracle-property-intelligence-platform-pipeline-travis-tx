// ERR-70, query side: open_days is an interval for a job that is still running. An open or
// stalled permit (an Expired permit is stalled) that carries a final_date is finished, so it gets
// no interval (reason not_open); a final_date before the issue date or after as_of is a
// data-quality gap (reason needs_review). v_roofing_permit also carries request_identifier.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUSTIN_URL,
  austinRequest,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

const P = "baguqeeraprop1";
const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });

function permit(cid: string, o: Partial<Record<string, string | null>>): Row {
  return {
    cid,
    request_identifier: `${cid} BP`,
    permit_number: `${cid} BP`,
    improvement_type: "Roofing",
    improvement_action: "Replacement",
    improvement_status: o.improvement_status ?? null,
    permit_issue_date: o.permit_issue_date ?? "1984-01-10",
    completion_date: o.completion_date ?? null,
    permit_close_date: null,
    source_http_request: austinRequest(`${cid} BP`, AUSTIN_URL),
  };
}

const TABLES: FixtureTables = {
  county: { property: [propertyRows(P, 1985)] },
  property_improvement: {
    property_improvement: [
      // Expired (null status) after completion: finished
      permit("x1", { completion_date: "1985-03-11" }),
      // Expired, never completed: a real long-open lead
      permit("x2", {}),
      // Permitted with a completion date: finished
      permit("x3", { improvement_status: "Permitted", completion_date: "1984-02-01" }),
      // Permitted, no completion date: still open
      permit("x4", { improvement_status: "Permitted", permit_issue_date: "2026-09-01" }),
      // completion before issue: data-quality gap
      permit("x5", { completion_date: "1983-01-01" }),
      // completion after as_of: data-quality gap
      permit("x6", { completion_date: "2030-01-01" }),
      // closed: not_open as before
      permit("x7", { improvement_status: "Completed", completion_date: "1984-02-01" }),
    ],
    property_has_property_improvement: [
      [
        edge(P, "x1"),
        edge(P, "x2"),
        edge(P, "x3"),
        edge(P, "x4"),
        edge(P, "x5"),
        edge(P, "x6"),
        edge(P, "x7"),
      ],
    ],
  },
};

type Missing = { field: string; reason: string }[];
let fx: Fixture;
let rows: Record<string, unknown>[];
const row = (n: string): Record<string, unknown> | undefined =>
  rows.find((r) => r.permit_cid === n);
const reason = (n: string): string | undefined =>
  (row(n)?.missing as Missing).find((m) => m.field === "open_days")?.reason;

beforeAll(async () => {
  fx = await bindFixture(TABLES, (m: ManifestJson) => {
    m.coverage = Object.fromEntries(
      Object.entries(m.coverage).filter(([k]) => !k.startsWith("owner_")),
    );
  });
  rows = await fx.rows("SELECT * FROM v_roofing_permit ORDER BY permit_cid");
});
afterAll(() => fx.close());

describe("open_days for finished permits (ERR-70)", () => {
  it("a permit with a plausible final_date has no interval; with no City status it is closed", () => {
    for (const n of ["x1", "x3"]) {
      expect(row(n)?.open_days, n).toBeNull();
      expect(reason(n), n).toBe("not_open");
    }
    // PO 2026-10-26: no City status word + an accepted completion date = finished (closed); a City
    // status word ("Permitted") is never overridden.
    expect(row("x1")).toMatchObject({
      status_class: "closed",
      is_open: false,
      final_date: "1985-03-11",
    });
    expect(row("x3")).toMatchObject({ status_class: "open", is_open: true });
  });

  it("a stalled permit with no final_date and an open one keep as_of − issue_date", () => {
    expect(Number(row("x2")?.open_days)).toBeGreaterThan(15000);
    expect(Number(row("x4")?.open_days)).toBeGreaterThanOrEqual(0);
    expect(reason("x2")).toBeUndefined();
  });

  it("final_date before issue_date or after as_of is a data-quality gap: null with needs_review", () => {
    for (const n of ["x5", "x6"]) {
      expect(row(n)?.open_days, n).toBeNull();
      expect(reason(n), n).toBe("needs_review");
    }
  });

  it("a closed permit still has null open_days with not_open", () => {
    expect(row("x7")?.open_days).toBeNull();
    expect(reason("x7")).toBe("not_open");
  });
});

describe("request_identifier on v_roofing_permit (Task B stable key)", () => {
  it("is the permit record's request_identifier, with no missing entry", () => {
    for (const r of rows) {
      expect(r.request_identifier).toBe(`${String(r.permit_cid)} BP`);
      expect((r.missing as Missing).some((m) => m.field === "request_identifier")).toBe(false);
    }
  });
});
