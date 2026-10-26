// T028 profile tests. The curated Travis profile is checked for the extras each status needs;
// the set comparison against the Census list runs on synthetic places (test-only).
import { describe, expect, it } from "vitest";
import { RecordsRequestSchema } from "../../travis/discovery/catalog.schema.js";
import type { CensusPlace } from "../../travis/discovery/probes/census.js";
import { mapStatus, resolveJurisdictionStatus } from "../../travis/discovery/status-map.js";
import {
  TRAVIS_JURISDICTION_PROFILE,
  compareProfileToCensus,
  profileProblems,
  type JurisdictionProfileEntry,
} from "../../travis/profiles/jurisdictions.js";

const LEADS = [
  "Travis County",
  "Austin",
  "Pflugerville",
  "Lakeway",
  "Bee Cave",
  "West Lake Hills",
  "Manor",
  "Sunset Valley",
  "Rollingwood",
  "Lago Vista",
  "Jonestown",
  "Briarcliff",
  "Creedmoor",
  "Mustang Ridge",
  "Webberville",
  "Cedar Park",
  "Leander",
  "Round Rock",
];

const REQUEST = {
  recipient_office: "Synthetic City Secretary",
  system_scope: "synthetic permits, 2000 to present",
  route: "records-first" as const,
  request_portal_url: "https://synthetic.test/records",
};

function entry(over: Partial<JurisdictionProfileEntry> = {}): JurisdictionProfileEntry {
  return {
    key: "synthetic",
    jurisdiction: "Synthetic",
    census_placefp: "00001",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://synthetic.test/permits",
    records_request: REQUEST,
    ...over,
  };
}

function place(placefp: string, name: string): CensusPlace {
  return { placefp, census_name: `${name} city`, name, classfp: "C1", land_area_sqm: null };
}

describe("the curated Travis profile", () => {
  const profile = TRAVIS_JURISDICTION_PROFILE;

  it("every entry has a class, an evidence URL and the extras its status needs", () => {
    for (const e of profile) {
      expect({ key: e.key, problems: profileProblems(e) }).toEqual({ key: e.key, problems: [] });
    }
  });

  it("every class + case resolves through the R3 status map (intake portals never historical)", () => {
    for (const e of profile) {
      const input =
        e.portal_kind === undefined
          ? { spec_class: e.spec_class, case: e.case }
          : { spec_class: e.spec_class, case: e.case, portal_kind: e.portal_kind };
      expect(() => resolveJurisdictionStatus(input)).not.toThrow();
    }
  });

  it("keys and Census place codes are unique; exactly one unincorporated entry", () => {
    const keys = profile.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const codes = profile.map((e) => e.census_placefp).filter((c): c is string => c !== null);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^\d{5}$/.test(c))).toBe(true);
    expect(profile.filter((e) => e.census_placefp === null)).toHaveLength(1);
  });

  it("contains all 18 named leads", () => {
    const missing = LEADS.filter((n) => !profile.some((e) => e.jurisdiction.includes(n)));
    expect(missing).toEqual([]);
  });

  it("every entry carries a complete records request (the lawful route if its evidence is blocked)", () => {
    for (const e of profile) {
      expect({ key: e.key, ok: RecordsRequestSchema.safeParse(e.records_request).success }).toEqual(
        {
          key: e.key,
          ok: true,
        },
      );
    }
  });

  it("evidence and portal URLs are https and never on traviscad.org or bbb.org", () => {
    for (const e of profile) {
      for (const u of [e.evidence_url, e.portal].filter((x): x is string => x !== undefined)) {
        const url = new URL(u);
        expect(url.protocol).toBe("https:");
        expect(url.host).not.toMatch(/traviscad\.org$|bbb\.org$/);
      }
    }
  });

  it("no city's evidence rests on the Austin permits dataset (FR-004c)", () => {
    for (const e of profile.filter((x) => x.key !== "austin")) {
      expect(e.evidence_url).not.toMatch(/data\.austintexas\.gov/);
    }
  });
});

describe("profileProblems", () => {
  it("a valid custodian-only entry has no problems", () => {
    expect(profileProblems(entry())).toEqual([]);
  });

  it("custodian-only, manual-only and blocked need a complete records_request", () => {
    for (const c of ["custodian-only", "intake-or-no-history", "portal-blocked"] as const) {
      const { records_request: _drop, ...rest } = entry({ case: c });
      expect(profileProblems(rest as JurisdictionProfileEntry).join(" ")).toMatch(
        /records_request/,
      );
    }
    const incomplete = entry({
      records_request: { ...REQUEST, request_portal_url: undefined } as unknown as typeof REQUEST,
    });
    expect(profileProblems(incomplete).join(" ")).toMatch(/records_request/);
  });

  it("delegated needs issued_by", () => {
    const e = entry({ spec_class: "no public history", case: "issued-by-other-body" });
    expect(profileProblems(e).join(" ")).toMatch(/issued_by/);
    expect(profileProblems({ ...e, issued_by: "Synthetic County" })).toEqual([]);
  });

  it("supported needs earliest_record_date", () => {
    const e = entry({ spec_class: "supported", case: "history-online" });
    expect(profileProblems(e).join(" ")).toMatch(/earliest_record_date/);
    expect(profileProblems({ ...e, earliest_record_date: "1990-01-01" })).toEqual([]);
  });

  it("a class + case that is not an R3 row is a problem", () => {
    const e = entry({ spec_class: "supported", case: "custodian-only" });
    expect(profileProblems(e).join(" ")).toMatch(/R3/);
    expect(() => mapStatus("supported", "custodian-only")).toThrow();
  });

  it("a supported row on an intake portal is a problem", () => {
    const e = entry({
      spec_class: "supported",
      case: "history-online",
      earliest_record_date: "2000-01-01",
      portal_kind: "application-intake",
    });
    expect(profileProblems(e).join(" ")).toMatch(/intake/);
  });

  it("an entry without evidence_url is a problem", () => {
    expect(profileProblems(entry({ evidence_url: "" })).join(" ")).toMatch(/evidence_url/);
  });
});

describe("compareProfileToCensus", () => {
  const places = [place("00001", "Alpha"), place("00002", "Beta")];
  const unincorporated = entry({
    key: "uninc",
    jurisdiction: "Synthetic County unincorporated",
    census_placefp: null,
  });
  const alpha = entry({ key: "alpha", jurisdiction: "Alpha", census_placefp: "00001" });
  const beta = entry({ key: "beta", jurisdiction: "Beta", census_placefp: "00002" });

  it("equal sets: nothing missing or extra", () => {
    expect(compareProfileToCensus([alpha, beta, unincorporated], places)).toEqual({
      missing: [],
      extra: [],
      unincorporated: 1,
      ok: true,
    });
  });

  it("a Census place without a profile entry is missing", () => {
    const r = compareProfileToCensus([alpha, unincorporated], places);
    expect(r.ok).toBe(false);
    expect(r.missing.map((p) => p.placefp)).toEqual(["00002"]);
  });

  it("a profile entry that is not in the Census list is extra", () => {
    const gamma = entry({ key: "gamma", jurisdiction: "Gamma", census_placefp: "00009" });
    const r = compareProfileToCensus([alpha, beta, gamma, unincorporated], places);
    expect(r.ok).toBe(false);
    expect(r.extra.map((e) => e.key)).toEqual(["gamma"]);
  });

  it("no unincorporated entry, or two, fails", () => {
    expect(compareProfileToCensus([alpha, beta], places).ok).toBe(false);
    const second = { ...unincorporated, key: "uninc2" };
    expect(compareProfileToCensus([alpha, beta, unincorporated, second], places).ok).toBe(false);
  });
});
