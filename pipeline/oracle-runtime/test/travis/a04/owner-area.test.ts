// A-04 T023 (AC-3, FR-003): owner area from the mailing ZIP through the travis-places@1.0.0
// gazetteer (ownerArea + GAZETTEER_SHA256), Query DB only (public v1 stays not_in_export).
// Synthetic test input: mailing fields only, no owner names.
import { describe, expect, it } from "vitest";
import { ownerAreaOf } from "../../../travis/tcad/owner-area.js";

const DIGEST = "0f4c08a8bda573737adecc7d62e84d629aadc5005b987f2f787e4fd31ab5d17f";
const mail = (o: {
  zip?: string | null;
  country?: string | null;
  intl?: unknown;
  redacted?: boolean;
}) =>
  ownerAreaOf({
    redacted: o.redacted ?? false,
    addrZip: o.zip ?? null,
    addrCountry: o.country ?? null,
    addrInternational: o.intl ?? null,
  });

describe("A-04-TC-010 out-of-area owner: regional / out_of_area with list SHA-256", () => {
  it("A-04-TC-010 Travis ZCTA → in_county, regional ZCTA → regional, other US ZCTA → out_of_area", () => {
    // 78665 (Williamson) is on the gazetteer's regional list; the test plan's 78664 is a
    // Travis ZCTA in travis-places@1.0.0 (owner-area.json travis_zctas), so it reads in_county.
    expect(mail({ zip: "78701" })).toEqual({
      owner_area_class: "in_county",
      owner_is_out_of_area: false,
      owner_area_evidence: "travis_zcta",
      area_list_sha256: DIGEST,
    });
    expect(mail({ zip: "78665-1234" })).toMatchObject({
      owner_area_class: "regional",
      owner_is_out_of_area: true,
      owner_area_evidence: "regional_zcta",
    });
    expect(mail({ zip: "10001" })).toMatchObject({
      owner_area_class: "out_of_area",
      owner_is_out_of_area: true,
      owner_area_evidence: "us_zcta_outside",
    });
    expect(mail({ zip: "78664" }).owner_area_class).toBe("in_county");
  });

  it("A-04-TC-010 every row carries area_list_sha256 = GAZETTEER_SHA256", () => {
    for (const o of [{ zip: "78701" }, { zip: null }, { redacted: true }, { country: "CANADA" }]) {
      expect(mail(o).area_list_sha256).toBe(DIGEST);
    }
  });
});

describe("A-04-TC-011 abroad or missing ZIP → out_of_area only with evidence, else unknown", () => {
  it("A-04-TC-011 (a) a non-US addrCountry → out_of_area with foreign_mailing", () => {
    expect(mail({ country: "CANADA" })).toMatchObject({
      owner_area_class: "out_of_area",
      owner_is_out_of_area: true,
      owner_area_evidence: "foreign_mailing",
    });
    expect(mail({ intl: "Y" }).owner_area_evidence).toBe("foreign_mailing");
    expect(mail({ zip: "78701", country: "USA" }).owner_area_class).toBe("in_county");
  });

  it("A-04-TC-011 (b) no ZIP, no country → unknown, owner_is_out_of_area null, no_zip", () => {
    expect(mail({})).toMatchObject({
      owner_area_class: "unknown",
      owner_is_out_of_area: null,
      owner_area_evidence: "no_zip",
    });
  });

  it("A-04-TC-011 (c) ZIP ABCDE → unknown, zip_not_zcta", () => {
    expect(mail({ zip: "ABCDE" })).toMatchObject({
      owner_area_class: "unknown",
      owner_is_out_of_area: null,
      owner_area_evidence: "zip_not_zcta",
    });
  });

  it("A-04-TC-011 (d) a redacted owner → unknown", () => {
    expect(mail({ zip: "10001", redacted: true })).toMatchObject({
      owner_area_class: "unknown",
      owner_is_out_of_area: null,
      owner_area_evidence: null,
    });
  });
});
