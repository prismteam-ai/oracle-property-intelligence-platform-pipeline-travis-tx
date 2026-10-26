// PO 2026-10-26 (found by the Roofing CRM team): status_class_of guesses a permit with no City
// status word from its issue date, so an old permit the City never closed read as stalled even
// when a later roofing permit on the same property finished (2904 Guadalupe St: a 1982 permit
// "stalled 44.6 yrs" beside a roof replaced two years ago). That guess is now closed, with the
// final_date reason superseded_by_later_permit; a City status word is never overridden, and a
// finished permit issued earlier (or the same day) supersedes nothing.
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
const Q = "baguqeeraprop2";
const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });

function permit(cid: string, o: Partial<Record<string, string | null>>): Row {
  return {
    cid,
    request_identifier: `${cid} BP`,
    permit_number: `${cid} BP`,
    improvement_type: "Roofing",
    improvement_action: "Replacement",
    improvement_status: o.improvement_status ?? null,
    permit_issue_date: o.permit_issue_date ?? "1982-05-01",
    completion_date: o.completion_date ?? null,
    permit_close_date: null,
    source_http_request: austinRequest(`${cid} BP`, AUSTIN_URL),
  };
}

const TABLES: FixtureTables = {
  county: { property: [propertyRows(P, 1950), propertyRows(Q, 1950)] },
  property_improvement: {
    property_improvement: [
      // P: a 1982 permit the City never closed, then a roof replaced in 2024 that finished
      permit("s1", {}),
      permit("s2", { permit_issue_date: "2024-03-01", completion_date: "2024-04-15" }),
      // P: a City status word on an old permit is never overridden
      permit("s3", { improvement_status: "Permitted", permit_issue_date: "1990-01-01" }),
      // Q: the finished permit is the older one, so the later unfinished one stays a lead
      permit("t1", { permit_issue_date: "1980-01-01", completion_date: "1980-03-01" }),
      permit("t2", { permit_issue_date: "1995-06-01" }),
    ],
    property_has_property_improvement: [
      [edge(P, "s1"), edge(P, "s2"), edge(P, "s3"), edge(Q, "t1"), edge(Q, "t2")],
    ],
  },
};

type Missing = { field: string; reason: string }[];
let fx: Fixture;
let rows: Record<string, unknown>[];
const row = (n: string): Record<string, unknown> | undefined =>
  rows.find((r) => r.permit_cid === n);
const reasonOf = (n: string, field: string): string | undefined =>
  (row(n)?.missing as Missing).find((m) => m.field === field)?.reason;

beforeAll(async () => {
  fx = await bindFixture(TABLES, (m: ManifestJson) => {
    m.coverage = Object.fromEntries(
      Object.entries(m.coverage).filter(([k]) => !k.startsWith("owner_")),
    );
  });
  rows = await fx.rows("SELECT * FROM v_roofing_permit ORDER BY permit_cid");
});
afterAll(() => fx.close());

describe("a date-guessed permit superseded by a later finished roofing permit (PO 2026-10-26)", () => {
  it("is closed, not open, with no open interval, and says why its final date is empty", () => {
    expect(row("s1")).toMatchObject({ status_class: "closed", is_open: false, final_date: null });
    expect(row("s1")?.open_days).toBeNull();
    expect(reasonOf("s1", "final_date")).toBe("superseded_by_later_permit");
    expect(reasonOf("s1", "open_days")).toBe("not_open");
  });

  it("keeps the status reason of the original guess (no City status word)", () => {
    expect(reasonOf("s1", "improvement_status")).toBe("enum_lacks_value");
  });

  it("the finishing permit itself is closed by its completion date", () => {
    expect(row("s2")).toMatchObject({ status_class: "closed", final_date: "2024-04-15" });
    expect(reasonOf("s2", "final_date")).toBeUndefined();
  });

  it("never overrides a City status word", () => {
    expect(row("s3")).toMatchObject({ status_class: "open", is_open: true });
  });

  it("an earlier finished permit supersedes nothing: the later unfinished one stays stalled", () => {
    expect(row("t2")).toMatchObject({ status_class: "stalled" });
    expect(Number(row("t2")?.open_days)).toBeGreaterThan(10000);
    expect(reasonOf("t2", "final_date")).toBe("not_closed");
  });
});
