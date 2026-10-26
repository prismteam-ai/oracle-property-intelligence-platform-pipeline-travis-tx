// T004 (A-14, data-model.md, agent-design.md § 2): the six tool input schemas plus the shared
// RunRef/AreaInput/EmptyReason shapes. Every object schema is .strict() (P0-13): an unknown key
// must be rejected, never silently dropped. permit_number takes a closed regex so a free-form
// string (the edge case: "a SQL-looking string as an argument") is a Zod rejection, never SQL text.
import { describe, expect, it } from "vitest";
import {
  AreaInput,
  EmptyReason,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  RunRef,
  SearchPropertiesInput,
} from "../src/tools/schemas.js";

describe("AreaInput", () => {
  it("accepts a place name", () => {
    expect(AreaInput.parse({ place: "Pflugerville" })).toEqual({ place: "Pflugerville" });
  });

  it("accepts a global lat/lon, including a point outside Travis County (AC-11: not a Zod error)", () => {
    expect(AreaInput.parse({ lat: 51.5, lon: -0.1 })).toEqual({ lat: 51.5, lon: -0.1 });
  });

  it("rejects lat/lon outside the global range", () => {
    expect(() => AreaInput.parse({ lat: 91, lon: 0 })).toThrow();
    expect(() => AreaInput.parse({ lat: 0, lon: 181 })).toThrow();
  });

  it("rejects an unknown key on either branch (.strict())", () => {
    expect(() => AreaInput.parse({ place: "Pflugerville", extra: 1 })).toThrow();
    expect(() => AreaInput.parse({ lat: 1, lon: 1, extra: 1 })).toThrow();
  });

  it("rejects mixing both branches' fields", () => {
    expect(() => AreaInput.parse({ place: "Pflugerville", lat: 1, lon: 1 })).toThrow();
  });
});

describe("RunRef", () => {
  it("manifest_cid is optional", () => {
    expect(RunRef.parse({})).toEqual({});
  });

  it("rejects an unknown key", () => {
    expect(() => RunRef.parse({ manifest_cid: undefined, extra: 1 })).toThrow();
  });
});

describe("SearchPropertiesInput", () => {
  const base = { area: { place: "Pflugerville" }, radius_mi: 5 };

  it("applies defaults: sort = nearest, limit = 50", () => {
    expect(SearchPropertiesInput.parse(base)).toMatchObject({ sort: "nearest", limit: 50 });
  });

  it.each([
    ["radius_mi", 0.24],
    ["radius_mi", 25.01],
  ])("rejects %s out of [0.25, 25]: %d", (field, value) => {
    expect(() => SearchPropertiesInput.parse({ ...base, [field]: value })).toThrow();
  });

  it("radius_mi accepts the bounds 0.25 and 25", () => {
    expect(SearchPropertiesInput.parse({ ...base, radius_mi: 0.25 }).radius_mi).toBe(0.25);
    expect(SearchPropertiesInput.parse({ ...base, radius_mi: 25 }).radius_mi).toBe(25);
  });

  it.each([-1, 121, 15.5])("rejects roof_age_years_min out of [0, 120] or non-integer: %d", (v) => {
    expect(() => SearchPropertiesInput.parse({ ...base, roof_age_years_min: v })).toThrow();
  });
  it("accepts roof_age_years_min at the bounds 0 and 120", () => {
    expect(SearchPropertiesInput.parse({ ...base, roof_age_years_min: 0 }).roof_age_years_min).toBe(
      0,
    );
    expect(
      SearchPropertiesInput.parse({ ...base, roof_age_years_min: 120 }).roof_age_years_min,
    ).toBe(120);
  });

  it.each([0, 101, 5.5])("rejects tenure_years_min out of [1, 100] or non-integer: %d", (v) => {
    expect(() => SearchPropertiesInput.parse({ ...base, tenure_years_min: v })).toThrow();
  });
  it("accepts tenure_years_min at the bounds 1 and 100", () => {
    expect(SearchPropertiesInput.parse({ ...base, tenure_years_min: 1 }).tenure_years_min).toBe(1);
    expect(SearchPropertiesInput.parse({ ...base, tenure_years_min: 100 }).tenure_years_min).toBe(
      100,
    );
  });

  it.each([-1, 61])("rejects open_years_min out of [0, 60]: %d", (v) => {
    expect(() => SearchPropertiesInput.parse({ ...base, open_years_min: v })).toThrow();
  });

  it.each([0, 1001, 0.5])("rejects limit out of [1, 1000] or non-integer: %d", (v) => {
    expect(() => SearchPropertiesInput.parse({ ...base, limit: v })).toThrow();
  });

  it("owner_is_out_of_area only accepts literal true", () => {
    expect(
      SearchPropertiesInput.parse({ ...base, owner_is_out_of_area: true }).owner_is_out_of_area,
    ).toBe(true);
    expect(() => SearchPropertiesInput.parse({ ...base, owner_is_out_of_area: false })).toThrow();
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() => SearchPropertiesInput.parse({ ...base, extra: 1 })).toThrow();
  });

  it("rejects a SQL-looking string anywhere a typed field is expected", () => {
    expect(() =>
      SearchPropertiesInput.parse({ ...base, status_class: "open'; DROP TABLE v_property; --" }),
    ).toThrow();
  });
});

describe("ListPermitsInput", () => {
  it("area is optional (AC-10: county-wide)", () => {
    expect(ListPermitsInput.parse({})).toMatchObject({ sort: "open_desc", limit: 50 });
  });

  it("requires radius_mi when area is given", () => {
    expect(() => ListPermitsInput.parse({ area: { place: "Manor" } })).toThrow();
    expect(ListPermitsInput.parse({ area: { place: "Manor" }, radius_mi: 5 })).toMatchObject({
      radius_mi: 5,
    });
  });

  it("permit_number matches the printed format exactly (e.g. 1982-012866 BP)", () => {
    expect(ListPermitsInput.parse({ permit_number: "1982-012866 BP" }).permit_number).toBe(
      "1982-012866 BP",
    );
  });

  it("rejects a free-form SQL string as permit_number (edge case)", () => {
    expect(() => ListPermitsInput.parse({ permit_number: "1' OR '1'='1" })).toThrow();
    expect(() => ListPermitsInput.parse({ permit_number: "1982-012866" })).toThrow();
  });

  it.each([-1, 61])("rejects open_years_min out of [0, 60]: %d", (v) => {
    expect(() => ListPermitsInput.parse({ open_years_min: v })).toThrow();
  });

  it.each([0, 1001])("rejects limit out of [1, 1000]: %d", (v) => {
    expect(() => ListPermitsInput.parse({ limit: v })).toThrow();
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() => ListPermitsInput.parse({ extra: 1 })).toThrow();
  });
});

describe("GetPropertyInput", () => {
  it("accepts exactly one of property_cid or request_identifier", () => {
    expect(() =>
      GetPropertyInput.parse({
        property_cid: "bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka",
      }),
    ).not.toThrow();
    expect(GetPropertyInput.parse({ request_identifier: "123456" }).request_identifier).toBe(
      "123456",
    );
  });

  it("rejects neither or both given", () => {
    expect(() => GetPropertyInput.parse({})).toThrow();
    expect(() =>
      GetPropertyInput.parse({
        property_cid: "bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka",
        request_identifier: "123456",
      }),
    ).toThrow();
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() => GetPropertyInput.parse({ request_identifier: "123456", extra: 1 })).toThrow();
  });
});

describe("ListRunsInput / GetSchemaInput", () => {
  it("ListRunsInput defaults limit to 20 and rejects an unknown key", () => {
    expect(ListRunsInput.parse({}).limit).toBe(20);
    expect(() => ListRunsInput.parse({ extra: 1 })).toThrow();
  });

  it("GetSchemaInput's view is one of the four contract views, and an unknown key is rejected", () => {
    expect(GetSchemaInput.parse({ view: "v_roofing_permit" }).view).toBe("v_roofing_permit");
    expect(() => GetSchemaInput.parse({ view: "v_nope" })).toThrow();
    expect(() => GetSchemaInput.parse({ extra: 1 })).toThrow();
  });
});

describe("EmptyReason", () => {
  it("is the closed six-value enum", () => {
    expect(EmptyReason.options).toEqual([
      "out_of_scope",
      "not_found",
      "no_match",
      "field_not_published",
      "field_unknown",
      "run_not_found",
    ]);
  });
});
