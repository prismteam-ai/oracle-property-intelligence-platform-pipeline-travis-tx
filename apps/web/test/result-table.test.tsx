// The Explore results table (Explore1440 board): every field the hosted cases read inside a
// `[data-result-row]` is a cell of the table row too (A-13 TC-009, TC-026, TC-033, TC-036), so
// the 1440 table and the compact cards answer the same checks. Unit tests have no matchMedia and
// render the cards through Explore, so the table is rendered directly here.
import type { ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultTable } from "../src/components/ResultTable";

afterEach(cleanup);

const CID = "baguqeeraexampleexampleexampleexampleexampleexampleexample";
const TABLE = "bafkreiexampleexampleexampleexampleexampleexampleexample";

const row = (over: Partial<ExploreRow>): ExploreRow => ({
  property_cid: CID,
  address: "1509 NORTHWOOD RD, AUSTIN, TX 78703",
  dist_mi: 0.012,
  bearing: "NE",
  lat: 30.29878,
  lon: -97.75405,
  roof_age_years: 39,
  roof_age_basis: "permit",
  roof_age_confidence: "high",
  permit: {
    cid: CID,
    number: "2001-000552 BP",
    status_raw: null,
    status_class: "stalled",
    open_years: 25.5,
    open_days: 9322,
    table_cid: TABLE,
    contractor_name_as_printed: "Steve Moore",
  },
  contractor: { name_as_printed: "Steve Moore", resolution: "unresolved", company_cid: null },
  bbb_status: "blocked",
  bbb_status_reason: "bbb_blocked",
  tenure_years: 29,
  tenure_basis: "deed_date",
  owner_area_class: "in_county",
  owner_name: "William Smith",
  provenance: {
    cid: CID,
    source_url: "https://traviscad.org/publicinformation",
    captured_at: "2026-10-22T05:48:41.000Z",
    table: "county/property",
    table_cid: TABLE,
    run_id: "travis-full-run3-1-20261025",
    manifest_cid: TABLE,
    as_of: "2026-10-25",
  },
  missing: [],
  ...over,
});

const cell = (field: string): string =>
  document.querySelector(`[data-result-row] [data-field="${field}"]`)?.textContent ?? "";

describe("ResultTable", () => {
  it("has a cell for every field the hosted row checks read, none blank", () => {
    render(<ResultTable rows={[row({})]} first={1} onSelect={() => undefined} selected={null} />);
    for (const field of [
      "address",
      "lat_lon",
      "roof_age_years",
      "roof_age_basis",
      "roof_age_confidence",
      "permit",
      "contractor_name",
      "bbb",
      "owner_name",
      "tenure_years",
      "tenure_basis",
      "owner_area_class",
      "distance",
    ]) {
      expect(cell(field).trim(), field).not.toBe("");
    }
    expect(cell("address")).toBe("1509 NORTHWOOD RD, AUSTIN, TX 78703");
    expect(cell("contractor_name")).toBe("Steve Moore");
    expect(cell("roof_age_basis")).toBe("reroof permit");
    expect(cell("tenure_years")).toBe("Owned 29 yrs");
    expect(document.querySelector("[data-result-row] [data-provenance]")?.textContent).toContain(
      "travis-full-run3-1-20261025",
    );
  });

  it("labels TCAD's placeholder built year 1900 as approximate", () => {
    render(
      <ResultTable
        rows={[row({ roof_age_basis: "built_year", roof_age_years: 126, year_built: 1900 })]}
        first={1}
        onSelect={() => undefined}
        selected={null}
      />,
    );
    expect(cell("roof_age_basis")).toBe("year built 1900 (approx.)");
  });

  it("a property without a permit shows a dash for the contractor, not a blank", () => {
    render(
      <ResultTable
        rows={[row({ permit: null, contractor: null, bbb_status: null })]}
        first={1}
        onSelect={() => undefined}
        selected={null}
      />,
    );
    expect(document.querySelector('[data-result-row] [data-field="contractor_name"]')).toBeNull();
    expect(document.querySelector("[data-result-row]")?.textContent).toContain("—");
  });

  it("a permit with no printed contractor shows only a dash; the reasons stay for screen readers", () => {
    render(
      <ResultTable
        rows={[
          row({
            permit: {
              ...(row({}).permit as NonNullable<ExploreRow["permit"]>),
              contractor_name_as_printed: null,
            },
            contractor: { name_as_printed: null, resolution: "unresolved", company_cid: null },
            bbb_status: "not_checked",
            bbb_status_reason: "BBB lookups are not run for this county yet",
          }),
        ]}
        first={1}
        onSelect={() => undefined}
        selected={null}
      />,
    );
    const name = document.querySelector('[data-result-row] [data-field="contractor_name"]');
    expect(name?.className).toMatch(/dash/);
    expect(name?.getAttribute("title")).toBe(EXPLORE_TEXTS.contractorNotPrinted);
    expect(name?.textContent).toBe(EXPLORE_TEXTS.contractorNotPrinted);
    expect(name?.querySelector("[data-status]")).toBeNull(); // no chip
    expect(document.querySelector('[data-result-row] [data-field="bbb"]')?.className).toMatch(
      /srOnly/,
    );
  });
});
