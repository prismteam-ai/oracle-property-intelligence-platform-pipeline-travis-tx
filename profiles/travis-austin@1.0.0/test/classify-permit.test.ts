// T013: classifyPermit() on real Austin `3syk-w9eu` rows (oracle § E.1; descriptions
// copied verbatim from data.austintexas.gov on 2026-10-21).
import { describe, expect, it } from "vitest";
import { PROFILE, classifyPermit, type PermitRow } from "../index.js";

const row = (r: Partial<PermitRow> & { permit_number: string }): PermitRow => ({
  permittype: "BP",
  work_class: "Remodel",
  status_current: "Final",
  description: null,
  ...r,
});

describe("classifyPermit: include terms on BP", () => {
  it.each([
    [
      "2025-154684 BP",
      "Reroof using like-for-like materials. Replace flashing and any affected siding portions.",
    ],
    ["2024-018570 BP", "New Duro Last PVC single ply membrane re-roof on building"],
    ["2024-135846 BP", "Roof Replacement -new Duro Last PVC Single Ply"],
  ])("%s → Roofing / Replacement", (permit_number, description) => {
    const r = classifyPermit(row({ permit_number, description }));
    expect(r.roofing).toBe("roofing");
    expect(r.reason).toBe("include_term");
    expect(r.improvement_type).toBe("Roofing");
    expect(r.improvement_action).toBe("Replacement");
    expect(r.profile_sha256).toBe(PROFILE.sha256);
  });
});

describe("classifyPermit: excludes carry a reason id", () => {
  it("work_class Auxiliary Power is never roofing, even with ROOF in the text", () => {
    const r = classifyPermit(
      row({
        permit_number: "2021-068116 EP",
        permittype: "EP",
        work_class: "Auxiliary Power",
        description:
          "Removal and Reinstallation of existing Solar Electric PV array so that building can be reroofed.",
      }),
    );
    expect(r.roofing).toBe("not_roofing");
    expect(r.reason).toBe("aux_power");
    expect(r.improvement_type).toBeNull();
  });

  it.each([
    ["2019-030807 BP", "Repair", "reroof mounted solar", "solar_pv"],
    [
      "2009-018702 BP",
      "Remodel",
      "Remodel to reinstall PV System after Re-Roof for existing Religious Assembly",
      "solar_pv",
    ],
    [
      "2025-115893 BP",
      "Remodel",
      "Install an 80 kW AC roof-mounted solar photovoltaic system or existing commercial building meter 6156331",
      "solar_pv",
    ],
    [
      "2013-054871 BP",
      "Remodel",
      "Nonstructural Reroof to existing Religious Assembly Bldg: Child Development & My Friends House Building  *MUST COMPLY W/2009 IECC*\nNOTE:  RTUs may need to be temporarily moved to complet reroof work.",
      "rtu",
    ],
    [
      "2010-013218 BP",
      "Remodel",
      "Non-Structural Reroof and RTU Change Out to existing Restaurant  *MUST COMPLY WITH THE 2006 IECC*",
      "rtu",
    ],
    [
      "2002-005063 BP",
      "Remodel",
      "Non-Structural Reroof Of Existing Restaurant (Reseal Around RtuS)",
      "rtu",
    ],
    [
      "2025-123881 BP",
      "Remodel",
      "AISD PROJECT - Addition of high-pile rack storage system to existing warehouse. Demolition of roof-mounted ventilation fans and skylights. Roofing repairs and new roof overlay.",
      "roof_mounted",
    ],
    [
      "2013-094706 BP",
      "Addition and Remodel",
      "Re-permit/include work from expired permit: 84-023403 BP which was a repair to existing residence - reroof.  Addition/remodel includes:  removing and replacing existing asphalt roof with new standing seam metal roof (no change in roof lines) adding a 550sf roof top deck on the second floor remodel of existing kitchen laundry room butlers pantry family room master bedroom and bathroom on the first floor with partial demolition of non-load bearing interior partitions as shown on plans adding a new roof deck over  existing low slope roof",
      "roof_deck",
    ],
  ])("%s → excluded (%s)", (permit_number, work_class, description, id) => {
    const r = classifyPermit(row({ permit_number, work_class, description }));
    expect(r.roofing).toBe("not_roofing");
    expect(r.reason).toBe(id);
    expect(r.improvement_type).toBeNull();
    expect(r.improvement_action).toBeNull();
  });

  it('"OPPORTUNITY" is not RTU', () => {
    const r = classifyPermit(
      row({
        permit_number: "2025-154701 BP",
        description:
          "Reroof using like-for-like materials. Replace flashing and any affected siding portions. Take this opportunity to replace deteriorated window trim throughout the existing multi-family complex.\n29 Applications",
      }),
    );
    expect(r.roofing).toBe("roofing");
  });

  it('"roof decking" inside a reroof is not a roof deck', () => {
    for (const [permit_number, description] of [
      [
        "2024-010050 BP",
        "Express: Residential roof replacement-Roof decking replacement (not going past roof decking)",
      ],
      [
        "2024-097284 BP",
        "Roof Replacement - Tear-off existing roof system to existing roof deck Install new R-30 roof insulation coverboard 1 Modified Bitumen base ply and 1 ply Modified Bitumen bright white cap sheet (SRI 85).",
      ],
      ["2017-085883 BP", "Reroof and roof deck replacement  to Educational Facility"],
      ["2013-034365 BP", "New rafter tails new facia new roof decking and re-roof."],
      ["1990-009406 BP", "Reroof Decking To Residence"],
    ] as const) {
      expect(classifyPermit(row({ permit_number, description })).roofing, permit_number).toBe(
        "roofing",
      );
    }
  });

  it('"PVC" membrane is not PV', () => {
    const r = classifyPermit(
      row({
        permit_number: "2022-076553 BP",
        description: "Roof membrane Re-roof- white PVC membrane overlay.",
      }),
    );
    expect(r.roofing).toBe("roofing");
  });
});

describe("classifyPermit: trade sub-permits (D-4b)", () => {
  it.each([
    ["1984-003963 PP", "PP", "Reroof Ext Duplex"],
    ["2026-131973 EP", "EP", "Addition: Re-roofing existing front porch with new porch addition."],
    ["1983-002771 MP", "MP", "Reroof Only Church"],
  ])("%s with an include term → trade_permit", (permit_number, permittype, description) => {
    const r = classifyPermit(row({ permit_number, permittype, description }));
    expect(r.roofing).toBe("not_roofing");
    expect(r.reason).toBe("trade_permit");
    expect(r.improvement_type).toBeNull();
  });
});

describe("classifyPermit: needs_review and no match", () => {
  it("work_class Roof with no include term → needs_review", () => {
    // Constructed variant: every work_class 'Roof' row on 2026-10-21 is an EP sign permit
    // (64 rows), so the real 2025-061893 EP description is used with permittype BP.
    const r = classifyPermit(
      row({
        permit_number: "2025-061893 BP",
        work_class: "Roof",
        description: "Install illuminated address 211 E Alpine on parapet/roof north elevation",
      }),
    );
    expect(r.roofing).toBe("needs_review");
    expect(r.reason).toBe("roof_work_class_no_include");
  });

  it("no include term → not_roofing / no_include_term", () => {
    const r = classifyPermit(
      row({
        permit_number: "2025-123881 BP",
        description: "Repair of sliding warehouse doors. Replacement of dock levelers. (Dry food)",
      }),
    );
    expect(r.roofing).toBe("not_roofing");
    expect(r.reason).toBe("no_include_term");
  });

  it("a null description is not roofing", () => {
    expect(
      classifyPermit(row({ permit_number: "1984-017113 DS", permittype: "BP", description: null }))
        .reason,
    ).toBe("no_include_term");
  });
});

describe("classifyPermit: precedence exclude > trade permit > include", () => {
  it("an excluded trade permit reports the exclude id", () => {
    const r = classifyPermit(
      row({
        permit_number: "2026-060952 EP",
        permittype: "EP",
        work_class: "Auxiliary Power",
        description:
          "Detach and reset for an already installed solar system due to hail damage and roof replacement.",
      }),
    );
    expect(r.reason).toBe("aux_power");
  });

  it("a trade permit with Roof work class is trade_permit, not needs_review", () => {
    const r = classifyPermit(
      row({
        permit_number: "2025-014791 EP",
        permittype: "EP",
        work_class: "Roof",
        description: "Austin Art Roof Sign",
      }),
    );
    expect(r.reason).toBe("trade_permit");
  });

  it("rejects a row that fails the Zod row schema", () => {
    expect(() => classifyPermit({ permittype: "BP" } as unknown as PermitRow)).toThrow();
  });
});
