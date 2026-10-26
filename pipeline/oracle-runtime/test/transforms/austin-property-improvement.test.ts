// T037: the Property Improvement data group for one property's Austin permits. Written
// first; the implementation is T049 (travis/transforms/austin-property-improvement.ts),
// which takes classifyPermit/classifyStatus/PROFILE from profiles/travis-austin@1.0.0.
//
// Interface this test fixes for T049:
//   transformAustinPropertyImprovement({ record, seed, cids, permits, profile })
//     → { pID, dir, files, counts: { emitted, excluded, needs_review, by_class }, ledger }
//   assertEmittedClasses(ledger)  throws unless every emitted class ∈ {open, stalled, closed}
// `profile` is injected (the run passes the real profile module); here a stub with the
// profile contract's shape (contracts/profile.md) keeps the test about the transform.
import { describe, expect, it } from "vitest";
import { buildCrosswalkIndex } from "../../travis/identity/crosswalk.js";
import type { RegistryRecord } from "../../travis/identity/resolver.js";
import { buildSeedRow } from "../../travis/pilot/build-seed.js";
import { buildSharedFiles, parseTcadRecord } from "../../travis/transforms/shared-seed.js";
import { transformTcadCounty } from "../../travis/transforms/tcad-county.js";
import {
  AUSTIN_DATASET_URL,
  assertEmittedClasses,
  transformAustinPropertyImprovement,
  type AustinPermitCapture,
  type ContractorIdentityInput,
  type ProfileApi,
} from "../../travis/transforms/austin-property-improvement.js";
import { tcadRecord } from "../fixtures/tcad-records.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};
const SHA = "d".repeat(64);

/** Stub of the profile contract. Status and type words are fixtures, not the profile. */
const STUB: ProfileApi = {
  PROFILE: { name: "travis-austin", version: "1.0.0", sha256: SHA },
  classifyPermit: (row) => {
    if (row.permittype !== "BP") {
      return {
        roofing: "not_roofing",
        reason: "trade_permit",
        improvement_type: "Electrical",
        improvement_action: "Alteration",
        sha256: SHA,
      };
    }
    if (/SOLAR/i.test(row.description ?? "")) {
      return {
        roofing: "not_roofing",
        reason: "solar_pv",
        improvement_type: null,
        improvement_action: null,
        sha256: SHA,
      };
    }
    if (row.work_class === "Roof" && !/ROOF/.test(row.description ?? "")) {
      return {
        roofing: "needs_review",
        reason: "needs_review",
        improvement_type: null,
        improvement_action: null,
        sha256: SHA,
      };
    }
    return {
      roofing: "roofing",
      reason: "include",
      improvement_type: "Roofing",
      improvement_action: "Replacement",
      sha256: SHA,
    };
  },
  classifyStatus: (word) => {
    const table: Record<
      string,
      {
        class: "open" | "stalled" | "closed" | "exclude" | "needs_review";
        improvement_status: string | null;
      }
    > = {
      Active: { class: "open", improvement_status: "Permitted" },
      Expired: { class: "stalled", improvement_status: null },
      Final: { class: "closed", improvement_status: "Completed" },
      VOID: { class: "exclude", improvement_status: null },
    };
    return { ...(table[word] ?? { class: "needs_review", improvement_status: null }), sha256: SHA };
  },
};

function capture(n: string, over: Record<string, string | null> = {}): AustinPermitCapture {
  return {
    row: {
      permit_number: n,
      permittype: "BP",
      work_class: "Remodel",
      status_current: "Active",
      description: "REROOF SFR, CONTRACTOR ACME ROOFING",
      issue_date: "2026-09-02T00:00:00.000",
      completed_date: null,
      expiresdate: "2027-03-01T00:00:00.000",
      contractor_company_name: "ACME ROOFING LLC",
      tcad_id: "0100030105",
      ...over,
    },
    receipt: {
      url: `${AUSTIN_DATASET_URL}?permit_number=${encodeURIComponent(n)}`,
      method: "GET",
      multiValueQueryString: { permit_number: [n] },
      status: 200,
      sha256: SHA,
      captured_at: "2026-10-20T22:00:00.000Z",
    },
  };
}

function setup(permits: AustinPermitCapture[]) {
  const record = parseTcadRecord(tcadRecord({ pID: 100008, geoID: "0100030105" }));
  const seed = buildSeedRow(record, "0100030105");
  return { record, seed, cids: CIDS, permits, profile: STUB };
}

type Json = Record<string, unknown>;
const parse = (files: Record<string, string>, name: string): Json =>
  JSON.parse(files[name] as string) as Json;

describe("transformAustinPropertyImprovement", () => {
  it("emits Roofing/Replacement with the status from the profile only", () => {
    const out = transformAustinPropertyImprovement(setup([capture("2026-100001 BP")]));
    expect(parse(out.files, "property_improvement_1.json")).toMatchObject({
      permit_number: "2026-100001 BP",
      improvement_type: "Roofing",
      improvement_action: "Replacement",
      improvement_status: "Permitted",
      permit_issue_date: "2026-09-02",
      completion_date: null,
    });
  });

  it("an Expired permit is emitted with improvement_status null (D-4a), never Completed or Cancelled", () => {
    const out = transformAustinPropertyImprovement(
      setup([capture("2026-034767 BP", { status_current: "Expired" })]),
    );
    const pi = parse(out.files, "property_improvement_1.json");
    expect(pi.improvement_status).toBeNull();
    expect(out.counts.by_class).toMatchObject({ stalled: 1 });
  });

  it("a Final permit carries completion_date from completed_date", () => {
    const out = transformAustinPropertyImprovement(
      setup([
        capture("2014-000001 BP", {
          status_current: "Final",
          completed_date: "2014-05-01T00:00:00.000",
        }),
      ]),
    );
    expect(parse(out.files, "property_improvement_1.json")).toMatchObject({
      improvement_status: "Completed",
      completion_date: "2014-05-01",
    });
  });

  it("a BP + EP + PP + MP project emits only the BP; the trade sub-permits stay in the ledger (D-4b, PO 2026-10-24)", () => {
    const out = transformAustinPropertyImprovement(
      setup([
        capture("2003-012717 BP"),
        capture("2003-012717 EP", { permittype: "EP" }),
        capture("2003-012717 MP", { permittype: "MP" }),
        capture("2003-012717 PP", { permittype: "PP" }),
      ]),
    );
    const permitFiles = Object.keys(out.files).filter((n) =>
      /^property_improvement_\d+\.json$/.test(n),
    );
    expect(permitFiles).toEqual(["property_improvement_1.json"]);
    expect(parse(out.files, "property_improvement_1.json")).toMatchObject({
      permit_number: "2003-012717 BP",
      improvement_type: "Roofing",
    });
    expect(
      Object.keys(out.files).filter((n) =>
        /^relationship_property_has_property_improvement_/.test(n),
      ),
    ).toEqual(["relationship_property_has_property_improvement_1.json"]);
    expect(Object.values(out.files).join("")).not.toContain("2003-012717 EP");
    expect(out.counts).toMatchObject({
      emitted: 1,
      excluded: 3,
      needs_review: 0,
      by_skip: { trade_sub_permit: 3 },
    });
    expect(out.ledger.map((l) => [l.permit_number, l.emitted, l.skip_reason])).toEqual([
      ["2003-012717 BP", true, null],
      ["2003-012717 EP", false, "trade_sub_permit"],
      ["2003-012717 MP", false, "trade_sub_permit"],
      ["2003-012717 PP", false, "trade_sub_permit"],
    ]);
    // the internal ledger keeps the trade type the profile adapter assigned
    expect(out.ledger[1]).toMatchObject({ improvement_type: "Electrical", reason: "trade_permit" });
  });

  it("a property whose only permit is a trade sub-permit emits nothing (counted as excluded)", () => {
    const out = transformAustinPropertyImprovement(
      setup([capture("2026-100002 EP", { permittype: "EP" })]),
    );
    expect(out.files).toEqual({});
    expect(out.counts).toMatchObject({
      emitted: 0,
      excluded: 1,
      needs_review: 0,
      by_skip: { trade_sub_permit: 1 },
    });
    expect(out.ledger[0]).toMatchObject({ emitted: false, skip_reason: "trade_sub_permit" });
  });

  it("a trade sub-permit is skipped as trade_sub_permit whatever its status word", () => {
    const out = transformAustinPropertyImprovement(
      setup([
        capture("2026-100007 EP", { permittype: "EP", status_current: "VOID" }),
        capture("2026-100008 PP", { permittype: "PP", status_current: "Archived" }),
      ]),
    );
    expect(out.counts).toMatchObject({ emitted: 0, excluded: 2, needs_review: 0 });
    expect(out.counts.by_skip).toEqual({ trade_sub_permit: 2 });
  });

  it("excluded and needs_review permits are not emitted and are counted", () => {
    const out = transformAustinPropertyImprovement(
      setup([
        capture("2026-100003 BP", { status_current: "VOID" }),
        capture("2026-100004 BP", { status_current: "Archived" }),
        capture("2026-100005 BP", { work_class: "Roof", description: "repair" }),
        capture("2026-100006 BP"),
      ]),
    );
    expect(
      Object.keys(out.files).filter((n) => /^property_improvement_\d+\.json$/.test(n)),
    ).toEqual(["property_improvement_1.json"]);
    expect(parse(out.files, "property_improvement_1.json").permit_number).toBe("2026-100006 BP");
    expect(out.counts).toMatchObject({ emitted: 1, excluded: 1, needs_review: 2 });
  });

  it("request_identifier is permit_number as printed; source_http_request is the per-permit GET", () => {
    const out = transformAustinPropertyImprovement(setup([capture("2026-100001 BP")]));
    expect(parse(out.files, "property_improvement_1.json")).toMatchObject({
      request_identifier: "2026-100001 BP",
      source_http_request: {
        method: "GET",
        url: AUSTIN_DATASET_URL,
        multiValueQueryString: { permit_number: ["2026-100001 BP"] },
      },
    });
  });

  it("links property_has_property_improvement from the same property.json as the County group", () => {
    const s = setup([capture("2026-100001 BP"), capture("2026-100007 BP")]);
    const out = transformAustinPropertyImprovement(s);
    const county = transformTcadCounty({
      record: s.record,
      seed: s.seed,
      cids: CIDS,
      roofAge: null,
    });
    expect(out.files["property.json"]).toBe(county.files["property.json"]);
    for (const name of Object.keys(
      buildSharedFiles({ record: s.record, seed: s.seed, seedCid: CIDS.seed }),
    )) {
      expect(out.files[name], name).toBe(county.files[name]);
    }
    const root = parse(out.files, `${CIDS.propertyImprovement}.json`);
    expect(root).toEqual({
      label: "Property Improvement",
      relationships: {
        property_has_property_improvement: [
          { "/": "./relationship_property_has_property_improvement_1.json" },
          { "/": "./relationship_property_has_property_improvement_2.json" },
        ],
        // the fixture permits print "ACME ROOFING LLC" (ERR-66: published as company.name)
        property_improvement_has_contractor: [
          { "/": "./relationship_property_improvement_has_contractor_1.json" },
          { "/": "./relationship_property_improvement_has_contractor_2.json" },
        ],
      },
    });
    expect(parse(out.files, "relationship_property_has_property_improvement_1.json")).toEqual({
      from: { "/": "./property.json" },
      to: { "/": "./property_improvement_1.json" },
    });
  });

  it("writes no description, work class, status word or expiry on the permit record (the contractor is a separate company file, ERR-66)", () => {
    const out = transformAustinPropertyImprovement(
      setup([capture("2026-100001 BP"), capture("2026-034767 BP", { status_current: "Expired" })]),
    );
    // The permit files only: the shared property.json legitimately carries TCAD's
    // `property_legal_description_text`, which is not a permit description.
    const all = Object.entries(out.files)
      .filter(
        ([name]) => /property_improvement/.test(name) || name.startsWith(CIDS.propertyImprovement),
      )
      .map(([, text]) => text)
      .join("\n");
    expect(all).toContain("property_improvement_1.json");
    for (const banned of [
      "REROOF SFR",
      "ACME",
      "Remodel",
      '"Active"',
      '"Expired"',
      "2027-03-01",
      "description",
      "work_class",
      "expires",
    ]) {
      expect(all, banned).not.toContain(banned);
    }
  });

  it("stamps the profile on every ledger row", () => {
    const out = transformAustinPropertyImprovement(
      setup([capture("2026-100001 BP"), capture("2026-100003 BP", { status_current: "VOID" })]),
    );
    expect(out.ledger).toHaveLength(2);
    for (const row of out.ledger)
      expect(row).toMatchObject({ profile_version: "travis-austin@1.0.0", profile_sha256: SHA });
  });
});

// A-11 fix: wires A-07's real resolver (resolver.ts's resolveContractor, unmodified) into the
// ledger per permit. Per ADR-0002 #6 the five-state verdict has no lexicon carrier, so it stays
// off the emitted JSON record; these tests prove each real state reaches `ledger[i]
// .contractor_resolution` and that `counts.by_contractor_state` rolls it up, never silently
// dropping a non-resolved state or defaulting one to `resolved`.
describe("contractor identity resolution (A-07/AD-05, wired via ClassificationLedgerRow)", () => {
  const REGISTRY: RegistryRecord[] = [
    { taxpayerNumber: "100", legalName: "ACME ROOFING LLC", sosStatusCode: "active" },
    { taxpayerNumber: "200", legalName: "ACME ROOFING LLC", sosStatusCode: "active" },
    { taxpayerNumber: "300", legalName: "STALE ROOFING INC", sosStatusCode: "terminated" },
  ];

  function identity(over: Partial<ContractorIdentityInput> = {}): ContractorIdentityInput {
    return {
      registry: REGISTRY,
      registryLoaded: true,
      registrySnapshotDigest: "d".repeat(64),
      effectiveOn: "2026-10-23T00:00:00.000Z",
      ...over,
    };
  }

  it("without a wired registry every emitted permit genuinely resolves unresolved (registry_unavailable), never null or resolved", () => {
    const out = transformAustinPropertyImprovement(setup([capture("2026-200001 BP")]));
    expect(out.ledger[0]?.contractor_resolution).toBe("unresolved");
    expect(out.counts.by_contractor_state).toEqual({ unresolved: 1 });
  });

  it("a legal-name match whose only registry hit is not active resolves conflicting, never candidate or resolved", () => {
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200002 BP", { contractor_company_name: "STALE ROOFING INC" })]),
      contractorIdentity: identity(),
    });
    expect(out.ledger[0]?.contractor_resolution).toBe("conflicting");
    expect(out.counts.by_contractor_state).toEqual({ conflicting: 1 });
  });

  it("an identifier crosswalk match resolves resolved (AC-2's fixture-fallback path, D-10)", () => {
    const crosswalk = buildCrosswalkIndex([{ permitKey: "2026-200003 BP", taxpayerNumber: "100" }]);
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200003 BP", { contractor_company_name: "ANYTHING" })]),
      contractorIdentity: identity({ crosswalk }),
    });
    expect(out.ledger[0]?.contractor_resolution).toBe("resolved");
    expect(out.counts.by_contractor_state).toEqual({ resolved: 1 });
  });

  it("a single active legal-name match (no crosswalk) resolves candidate", () => {
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200004 BP", { contractor_company_name: "Lone Star Roofing Co" })]),
      contractorIdentity: identity({
        registry: [
          { taxpayerNumber: "400", legalName: "LONE STAR ROOFING CO", sosStatusCode: "active" },
        ],
      }),
    });
    expect(out.ledger[0]?.contractor_resolution).toBe("candidate");
    expect(out.counts.by_contractor_state).toEqual({ candidate: 1 });
  });

  it("two active legal-name matches resolve ambiguous (all kept by the resolver, not dropped)", () => {
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200005 BP", { contractor_company_name: "ACME ROOFING LLC" })]),
      contractorIdentity: identity(),
    });
    expect(out.ledger[0]?.contractor_resolution).toBe("ambiguous");
  });

  it("no printed contractor name resolves unresolved with contractor_not_printed, never null", () => {
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200006 BP", { contractor_company_name: null })]),
      contractorIdentity: identity(),
    });
    expect(out.ledger[0]?.contractor_resolution).toBe("unresolved");
  });

  it("no match at all against a loaded registry resolves unresolved, never defaulted to resolved", () => {
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200007 BP", { contractor_company_name: "NOBODY MATCHES THIS LLC" })]),
      contractorIdentity: identity(),
    });
    expect(out.ledger[0]?.contractor_resolution).toBe("unresolved");
  });

  it("no contractor-identity field ever reaches the emitted JSON record, in any state (ADR-0002 #6: no lexicon carrier)", () => {
    const crosswalk = buildCrosswalkIndex([{ permitKey: "2026-200008 BP", taxpayerNumber: "100" }]);
    const out = transformAustinPropertyImprovement({
      ...setup([capture("2026-200008 BP")]),
      contractorIdentity: identity({ crosswalk }),
    });
    const record = parse(out.files, "property_improvement_1.json");
    expect(record).not.toHaveProperty("contractor_company_cid");
    expect(record).not.toHaveProperty("contractor_resolution");
    expect(Object.keys(record).sort()).toEqual(
      [
        "completion_date",
        "contractor_type",
        "improvement_action",
        "improvement_status",
        "improvement_type",
        "permit_issue_date",
        "permit_number",
        "request_identifier",
        "source_http_request",
      ].sort(),
    );
  });
});

describe("assertEmittedClasses (D-4a guard)", () => {
  it("fails if any emitted permit's class is outside {open, stalled, closed}", () => {
    expect(() =>
      assertEmittedClasses([{ permit_number: "x", emitted: true, status_class: "needs_review" }]),
    ).toThrow(/needs_review/);
    expect(() =>
      assertEmittedClasses([{ permit_number: "x", emitted: true, status_class: "exclude" }]),
    ).toThrow(/exclude/);
    expect(() =>
      assertEmittedClasses([
        { permit_number: "a", emitted: true, status_class: "open" },
        { permit_number: "b", emitted: true, status_class: "stalled" },
        { permit_number: "c", emitted: true, status_class: "closed" },
        { permit_number: "d", emitted: false, status_class: "exclude" },
      ]),
    ).not.toThrow();
  });
});

describe("excluded statuses never reach the export (the view has no status filter; donphan m6)", () => {
  it.each(["Cancelled", "Cancelled - Customer Request", "VOID", "Withdrawn"])(
    "a %s permit is classified exclude by the real profile and is not emitted",
    async (word) => {
      const travisAustin = await import("../../../../profiles/travis-austin@1.0.0/index.js");
      const { profileApi } = await import("../../travis/pilot/profile-api.js");
      const profile = profileApi(travisAustin as unknown as Parameters<typeof profileApi>[0]);
      const out = transformAustinPropertyImprovement({
        ...setup([capture("2026-100009 BP", { status_current: word })]),
        profile,
      });
      expect(out.ledger[0]).toMatchObject({ status_class: "exclude", emitted: false });
      expect(out.counts).toMatchObject({ emitted: 0, excluded: 1 });
      expect(out.files).toEqual({});
    },
  );
});
