// A-04 T054 (A-04-TC-044, A-04-TC-049, AD-16): linking an Austin permit to a TCAD account.
// `tcad_id` carries the TCAD geoID; the property key is the pID (request_identifier). The
// address signature is the vendored kit `address:v1` (no ROAD→RD expansion); it is the link when
// `tcad_id` is null and the fallback when the `tcad_id` is on no roll account (retired geoID). Synthetic test input: invented parcels, situses and permits.
import { describe, expect, it } from "vitest";
import {
  ISSUING_JURISDICTION,
  buildLinkIndex,
  issuingJurisdiction,
  linkPermit,
  permitAddress,
  situsSignature,
  type ParcelCandidate,
} from "../../../travis/permits/link.js";

const situs = (
  num: string,
  name: string,
  suffix: string,
  zip = "78701",
  secondary: string | null = null,
) => ({
  streetNum: num,
  streetPrefix: null,
  streetName: name,
  streetSuffix: suffix,
  streetSecondary: secondary,
  city: "AUSTIN",
  state: "TX",
  zip,
});

const PARCELS: ParcelCandidate[] = [
  // a geoID with one R account
  {
    requestIdentifier: "221829",
    geoId: "0223120506",
    propType: "R",
    situs: situs("100", "ALPHA", "ST"),
  },
  // a shared geoID (condo units): three R accounts
  {
    requestIdentifier: "500001",
    geoId: "0300000001",
    propType: "R",
    situs: situs("200", "BETA", "AVE", "78702", "UNIT 1"),
  },
  {
    requestIdentifier: "500002",
    geoId: "0300000001",
    propType: "R",
    situs: situs("200", "BETA", "AVE", "78702", "UNIT 2"),
  },
  {
    requestIdentifier: "500003",
    geoId: "0300000001",
    propType: "R",
    situs: situs("201", "BETA", "AVE", "78702"),
  },
  // a geoID that only a P (business personal property) account carries: not an R geoID
  {
    requestIdentifier: "600001",
    geoId: "0400000001",
    propType: "P",
    situs: situs("300", "GAMMA", "RD"),
  },
  // address-only targets
  {
    requestIdentifier: "700001",
    geoId: "0500000001",
    propType: "R",
    situs: situs("400", "DELTA", "RD", "78704"),
  },
  {
    requestIdentifier: "700002",
    geoId: "0500000002",
    propType: "R",
    situs: situs("500", "EPSILON", "LN", "78704"),
  },
  {
    requestIdentifier: "700003",
    geoId: "0500000003",
    propType: "R",
    situs: situs("500", "EPSILON", "LN", "78704"),
  },
];

const index = buildLinkIndex(PARCELS);

describe("A-04-TC-044 no tcad_id → address-hash fallback (AD-16); shared geoID rule", () => {
  it("A-04-TC-044 (a) tcad_id null, address:v1 signature equal to exactly one R situs → address_hash / address_sig_v1", () => {
    const r = linkPermit(index, {
      tcadId: null,
      address1: "400 DELTA RD",
      zip: "78704",
      state: "TX",
    });
    expect(r).toMatchObject({
      requestIdentifier: "700001",
      linkMethod: "address_hash",
      linkRule: "address_sig_v1",
      unmatchedReason: null,
      inTravis: true,
    });
    expect(r.linkConfidence).toBeGreaterThan(0);
  });

  it("A-04-TC-044 (a') the kit signature does not expand ROAD → RD: '400 DELTA ROAD' does not match '400 DELTA RD'", () => {
    const r = linkPermit(index, {
      tcadId: null,
      address1: "400 DELTA ROAD",
      zip: "78704",
      state: "TX",
    });
    expect(r.unmatchedReason).toBe("address_unmatched");
  });

  it("A-04-TC-044 (b) two R situs with that signature → unmatched ambiguous_address", () => {
    const r = linkPermit(index, {
      tcadId: null,
      address1: "500 EPSILON LN",
      zip: "78704",
      state: "TX",
    });
    expect(r).toMatchObject({
      requestIdentifier: null,
      linkMethod: null,
      linkRule: null,
      unmatchedReason: "ambiguous_address",
    });
  });

  it("A-04-TC-044 (c) no matching situs → address_unmatched", () => {
    const r = linkPermit(index, {
      tcadId: null,
      address1: "999 NOWHERE ST",
      zip: "78701",
      state: "TX",
    });
    expect(r).toMatchObject({
      requestIdentifier: null,
      unmatchedReason: "address_unmatched",
      inTravis: true,
    });
  });

  it("A-04-TC-044 (d) no usable address → no_tcad_id", () => {
    expect(
      linkPermit(index, { tcadId: null, address1: null, zip: "78701", state: "TX" })
        .unmatchedReason,
    ).toBe("no_tcad_id");
    expect(
      linkPermit(index, { tcadId: "  ", address1: "1 A ST", zip: null, state: "TX" })
        .unmatchedReason,
    ).toBe("no_tcad_id");
  });

  it("A-04-TC-044 (e) tcad_id = one R geoID → tcad_id / geoid_unique_r (leading zeros kept)", () => {
    const r = linkPermit(index, {
      tcadId: "0223120506",
      address1: "1 SOMEWHERE ELSE",
      zip: "78701",
      state: "TX",
    });
    expect(r).toMatchObject({
      requestIdentifier: "221829",
      linkMethod: "tcad_id",
      linkRule: "geoid_unique_r",
      unmatchedReason: null,
      inTravis: true,
    });
    expect(
      linkPermit(index, { tcadId: "223120506", address1: null, zip: null, state: null })
        .unmatchedReason,
    ).toBe("no_tcad_geoid");
  });

  it("A-04-TC-044 (f) shared geoID: exactly one situs match → geoid_plus_address; zero or several → ambiguous_geoid (never silently linked)", () => {
    const one = linkPermit(index, {
      tcadId: "0300000001",
      address1: "201 BETA AVE",
      zip: "78702",
      state: "TX",
    });
    expect(one).toMatchObject({
      requestIdentifier: "500003",
      linkMethod: "tcad_id",
      linkRule: "geoid_plus_address",
    });
    const none = linkPermit(index, {
      tcadId: "0300000001",
      address1: "202 BETA AVE",
      zip: "78702",
      state: "TX",
    });
    expect(none).toMatchObject({
      requestIdentifier: null,
      linkMethod: null,
      unmatchedReason: "ambiguous_geoid",
    });
    const unit = linkPermit(index, {
      tcadId: "0300000001",
      address1: "200 BETA AVE",
      zip: "78702",
      state: "TX",
      unit: "UNIT 2",
    });
    expect(unit).toMatchObject({ requestIdentifier: "500002", linkRule: "geoid_plus_address" });
    const noAddress = linkPermit(index, {
      tcadId: "0300000001",
      address1: null,
      zip: null,
      state: null,
    });
    expect(noAddress.unmatchedReason).toBe("ambiguous_geoid");
  });

  it("A-04-TC-044 (g) tcad_id 0208011301 is not on the roll and its address matches no account → no_tcad_geoid", () => {
    const r = linkPermit(index, {
      tcadId: "0208011301",
      address1: "700 NOWHERE RD",
      zip: "78704",
      state: "TX",
    });
    expect(r).toMatchObject({
      requestIdentifier: null,
      linkMethod: null,
      linkRule: null,
      unmatchedReason: "no_tcad_geoid",
      staleTcadId: false,
    });
    // a geoID carried only by a non-R account is not an R geoID either
    expect(
      linkPermit(index, {
        tcadId: "0400000001",
        address1: "300 GAMMA RD",
        zip: "78701",
        state: "TX",
      }).unmatchedReason,
    ).toBe("no_tcad_geoid");
  });

  it("A-04-TC-044 (g2) retired tcad_id (on no roll account): a unique address match links by address_hash and flags stale_tcad_id", () => {
    const r = linkPermit(index, {
      tcadId: "0999999999",
      address1: "100 ALPHA ST",
      zip: "78701",
      state: "TX",
    });
    expect(r).toMatchObject({
      requestIdentifier: "221829",
      linkMethod: "address_hash",
      linkRule: "address_sig_v1",
      unmatchedReason: null,
      staleTcadId: true,
    });
  });

  it("A-04-TC-044 (g3) a retired tcad_id never falls back to an ambiguous or empty address match, and a successful tcad_id match is never overridden", () => {
    // several accounts carry this address (shared geoID units 1 and 2 print the same street)
    const ambiguous = linkPermit(index, {
      tcadId: "0999999999",
      address1: "200 BETA AVE",
      zip: "78702",
      state: "TX",
    });
    expect(ambiguous).toMatchObject({ requestIdentifier: null, staleTcadId: false });
    expect(["no_tcad_geoid", "ambiguous_address"]).toContain(ambiguous.unmatchedReason);
    const none = linkPermit(index, {
      tcadId: "0999999999",
      address1: "9 NOWHERE ST",
      zip: "78701",
      state: "TX",
    });
    expect(none).toMatchObject({ requestIdentifier: null, unmatchedReason: "no_tcad_geoid" });
    // tcad_id resolves: the permit's (different) address is ignored and no stale flag is set
    expect(
      linkPermit(index, {
        tcadId: "0223120506",
        address1: "201 BETA AVE",
        zip: "78702",
        state: "TX",
      }),
    ).toMatchObject({ requestIdentifier: "221829", linkMethod: "tcad_id", staleTcadId: false });
    // no street number: nothing to match
    expect(
      linkPermit(index, { tcadId: null, address1: "ALPHA ST", zip: "78701", state: "TX" }),
    ).toMatchObject({ requestIdentifier: null, staleTcadId: false });
  });

  it("A-04-TC-044 (h) unmatched with original_zip outside the Travis ZCTAs → in_travis = false, kept (counted, not dropped)", () => {
    const r = linkPermit(index, {
      tcadId: null,
      address1: "1 FAR AWAY ST",
      zip: "10001",
      state: "NY",
    });
    expect(r).toMatchObject({
      requestIdentifier: null,
      unmatchedReason: "address_unmatched",
      inTravis: false,
    });
    expect(
      linkPermit(index, { tcadId: "0999999999", address1: null, zip: null, state: null }).inTravis,
    ).toBe(false);
  });

  it("situs signature uses streetSecondary as the unit and defaults a missing situs state to TX", () => {
    expect(situsSignature({ ...situs("1", "A", "ST"), state: null })).toBe(
      situsSignature(situs("1", "A", "ST")),
    );
    expect(situsSignature(situs("1", "A", "ST", "78701", "UNIT 1"))).not.toBe(
      situsSignature(situs("1", "A", "ST")),
    );
    expect(situsSignature(null)).toBeNull();
  });
});

describe("A-04-TC-049 Austin-issued permits located elsewhere stay Austin-issued", () => {
  it("A-04-TC-049 a permit located in Lakeway, Bee Cave or Pflugerville keeps issuing_jurisdiction = austin", () => {
    expect(ISSUING_JURISDICTION).toBe("austin");
    for (const located of [
      "LAKEWAY FULL PURPOSE",
      "BEE CAVE FULL PURPOSE",
      "PFLUGERVILLE FULL PURPOSE",
      "PFLUGERVILLE ETJ",
      undefined,
    ]) {
      expect(issuingJurisdiction(located === undefined ? {} : { jurisdiction: located })).toBe(
        "austin",
      );
    }
    expect(
      permitAddress({
        original_address1: "1 A ST",
        original_zip: "78734",
        original_state: "TX",
        jurisdiction: "LAKEWAY FULL PURPOSE",
        tcad_id: "0100000001",
      }),
    ).toEqual({
      tcadId: "0100000001",
      address1: "1 A ST",
      zip: "78734",
      state: "TX",
      unit: null,
    });
  });
});
