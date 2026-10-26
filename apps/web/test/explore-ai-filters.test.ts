// @vitest-environment node
// PO 2026-10-26: the AI tab keeps the results list under the answer; an answer writes the filters
// it applied into the Explore URL so the list shows the same search, every older filter cleared.
import { describe, expect, it } from "vitest";
import { answerFilterParams } from "../src/routes/ExploreAi.state";

describe("answerFilterParams", () => {
  it("maps the README's permit question to the list's filters", () => {
    expect(
      answerFilterParams({
        area: { place: "Austin" },
        radius_mi: 5,
        status_class: "open_or_stalled",
        open_years_min: 5,
        sort: "open_desc",
        limit: 50,
      }),
    ).toEqual({
      place: "Austin",
      at: null,
      r: "5",
      roof: null,
      permit: "open_stalled",
      openYrs: "5",
      tenure: null,
      ooa: null,
      sort: "open_desc",
      page: null,
      sel: null,
    });
  });

  it("maps a point area, roof age, tenure and out-of-area owners", () => {
    expect(
      answerFilterParams({
        area: { lat: 30.3, lon: -97.75 },
        radius_mi: 2,
        roof_age_years_min: 20,
        tenure_years_min: 10,
        owner_is_out_of_area: true,
        sort: "nearest",
      }),
    ).toMatchObject({ place: null, at: "30.3,-97.75", roof: "20", tenure: "10", ooa: "1" });
  });
});
