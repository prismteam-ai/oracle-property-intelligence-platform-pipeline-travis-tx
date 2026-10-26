// A-04 live finding: `elephant-cli validate` rejected company mailing addresses whose city was
// mixed case or carried digits. Owner mailing addresses are normalised, and an address that
// still breaks a lexicon pattern is written in the `unnormalized_address` form.
import { describe, expect, it } from "vitest";
import { buildSeedRow } from "../../travis/pilot/build-seed.js";
import { parseTcadRecord } from "../../travis/transforms/shared-seed.js";
import { transformTcadCounty } from "../../travis/transforms/tcad-county.js";
import { tcadRecord } from "../fixtures/tcad-records.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

type Json = Record<string, unknown>;

interface Owner {
  addrDeliveryLine?: string | null;
  addrUnitDesignator?: string | null;
  addrCity?: string | null;
  addrState?: string | null;
  addrZip?: string | null;
  addrCountry?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string;
}

function run(owner: Owner) {
  const raw = tcadRecord({ pID: 100008, geoID: "0100030105" });
  Object.assign((raw.owners as Json[])[0] as Json, owner);
  const record = parseTcadRecord(raw);
  const out = transformTcadCounty({
    record,
    seed: buildSeedRow(record, "0100030105"),
    cids: CIDS,
    roofAge: null,
  });
  const file = out.files["mailing_address_1.json"];
  return { out, address: file === undefined ? null : (JSON.parse(file) as Json) };
}

// The lexicon address constraints (schema oneOf), written out for the check below.
const STRUCTURED_REQUIRED = [
  "source_http_request",
  "request_identifier",
  "city_name",
  "country_code",
  "plus_four_postal_code",
  "postal_code",
  "state_code",
  "street_name",
  "street_post_directional_text",
  "street_pre_directional_text",
  "street_number",
  "street_suffix_type",
  "unit_identifier",
  "route_number",
  "township",
  "range",
  "section",
  "block",
];
const UNNORMALIZED_ALLOWED = new Set([
  "source_http_request",
  "request_identifier",
  "unnormalized_address",
  "city_name",
  "country_code",
  "plus_four_postal_code",
  "postal_code",
  "state_code",
  "block",
  "lot",
  "range",
  "route_number",
  "section",
  "township",
  "unit_identifier",
  "municipality_name",
  "county_name",
  "latitude",
  "longitude",
]);
const PATTERNS: Record<string, RegExp> = {
  city_name: /^[A-Z\s\-']+$/,
  state_code: /^[A-Z]{2}$/,
  postal_code: /^\d{5}$/,
  plus_four_postal_code: /^\d{4}$/,
};

function lexiconViolations(a: Json): string[] {
  const bad: string[] = [];
  const structured = !("unnormalized_address" in a);
  if (structured) {
    for (const k of STRUCTURED_REQUIRED) if (!(k in a)) bad.push(`missing ${k}`);
  } else {
    for (const k of Object.keys(a)) if (!UNNORMALIZED_ALLOWED.has(k)) bad.push(`unexpected ${k}`);
    if (typeof a.unnormalized_address !== "string" || a.unnormalized_address === "")
      bad.push("unnormalized_address empty");
  }
  for (const [k, v] of Object.entries(a)) {
    if (k === "source_http_request" || k === "latitude" || k === "longitude") continue;
    if (v === null) continue;
    if (typeof v !== "string" || v.length < 1) bad.push(`${k} not a non-empty string`);
    else if (PATTERNS[k] && !PATTERNS[k].test(v)) bad.push(`${k} breaks its pattern`);
  }
  return bad;
}

describe("owner mailing address normalisation", () => {
  it("upper-cases a mixed-case city (Austin) and stays structured", () => {
    const { address, out } = run({ addrCity: "Austin", addrState: "TX", addrZip: "78704" });
    expect(address).toMatchObject({ city_name: "AUSTIN", state_code: "TX", postal_code: "78704" });
    expect(address).not.toHaveProperty("unnormalized_address");
    expect(out.counts.mailing_address_fallback).toBe(0);
  });

  it("upper-cases Wilmington", () => {
    const { address } = run({ addrCity: "Wilmington", addrState: "de", addrZip: "19801" });
    expect(address).toMatchObject({ city_name: "WILMINGTON", state_code: "DE" });
  });

  it("falls back to unnormalized_address when the city carries digits", () => {
    const { address, out } = run({
      addrDeliveryLine: "PO BOX 12",
      addrCity: "POTOSI SAN LUIS 78153",
      addrState: "SL",
      addrZip: "78153",
      addrCountry: "MX",
    });
    expect(address).toEqual({
      source_http_request: expect.any(Object),
      request_identifier: "100008",
      unnormalized_address: "PO BOX 12, POTOSI SAN LUIS 78153, SL, 78153, MX",
    });
    expect(out.counts.mailing_address_fallback).toBe(1);
    expect(lexiconViolations(address as Json)).toEqual([]);
  });

  it("falls back for an unusable state or zip rather than dropping it", () => {
    const { address } = run({ addrCity: "Toronto", addrState: "ONT", addrZip: "M5V 3A8" });
    expect(address?.unnormalized_address).toBe("41 SAMPLE DR, Toronto, ONT, M5V 3A8");
  });

  it("leaves a clean upper-case address exactly as before", () => {
    const { address, out } = run({});
    expect(address).toEqual({
      source_http_request: expect.any(Object),
      request_identifier: "100008",
      street_number: null,
      street_pre_directional_text: null,
      street_name: null,
      street_suffix_type: null,
      street_post_directional_text: null,
      unit_identifier: null,
      city_name: "WOODCREEK",
      state_code: "TX",
      postal_code: "78676",
      plus_four_postal_code: "2530",
      country_code: null,
      route_number: null,
      block: null,
      lot: null,
      section: null,
      township: null,
      range: null,
    });
    expect(Object.keys(address as Json)).toEqual([
      "source_http_request",
      "request_identifier",
      "street_number",
      "street_pre_directional_text",
      "street_name",
      "street_suffix_type",
      "street_post_directional_text",
      "unit_identifier",
      "city_name",
      "state_code",
      "postal_code",
      "plus_four_postal_code",
      "country_code",
      "route_number",
      "block",
      "lot",
      "section",
      "township",
      "range",
    ]);
    expect(out.counts.mailing_address_fallback).toBe(0);
  });

  it("writes no address when no city, state or zip is printed", () => {
    const { address } = run({ addrCity: " ", addrState: null, addrZip: "" });
    expect(address).toBeNull();
  });

  it("always satisfies the lexicon patterns over odd inputs", () => {
    const cities = [
      "ST. PAUL",
      "Sao Paulo",
      "SÃO PAULO",
      "Zürich",
      "O'Fallon",
      "",
      "  ",
      "12345",
      "A  B",
      "Ft.Worth",
      "NEW-YORK",
      "LA CAÑADA",
      "City, ST",
      "N/A",
      "ÅÄÖ",
    ];
    const states = ["TX", "tx", "Texas", "", "T", "T1", "ONT", " ca "];
    const zips = [
      "78704",
      "78704-1234",
      "787041234",
      "7870",
      "M5V 3A8",
      "",
      "abcde",
      "78704-12",
      " 78704 ",
    ];
    const countries = [null, "", "us", "United States", "MX"];
    let n = 0;
    for (const addrCity of cities)
      for (const addrState of states)
        for (const addrZip of zips)
          for (const addrCountry of countries) {
            const { address } = run({
              addrDeliveryLine: "1 MAIN ST",
              addrCity,
              addrState,
              addrZip,
              addrCountry,
            });
            n += 1;
            if (address !== null)
              expect(
                lexiconViolations(address),
                JSON.stringify({ addrCity, addrState, addrZip, addrCountry }),
              ).toEqual([]);
          }
    expect(n).toBeGreaterThan(1000);
  });
});
