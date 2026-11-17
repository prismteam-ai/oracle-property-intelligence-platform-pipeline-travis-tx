import { describe, expect, it } from "vitest";
import { classifyRoofWork, type PermitFacts, RoofWork } from "../../src/domain/roof-work.js";

const remodel = (description: string, overrides: Partial<PermitFacts> = {}): PermitFacts => ({
  permitType: "BP",
  workClass: "Remodel",
  permitClass: "R- 434 Addition & Alterations",
  description,
  ...overrides,
});

describe("classifyRoofWork", () => {
  it.each([
    "RE-ROOF RESIDENCE",
    "Re roof existing residence",
    "REROOFING EXIST RES",
    "Structural re-roof to existing single family residence",
    "NONSTRUCTURAL REROOF TO EXISTING COMMERCIAL",
    "Replace roof shingles on sf res.",
    "REPLACE ROOFING ON EXISTING DUPLEX",
    "Roof replacement - composition",
    "Reshingle roof",
    "Tear off and replace roof",
    "Change flat roof to pitched roof",
    "Replacement of TPO roof system. New system to meet IECC minimum requirements",
    "Replace shingles on roof",
    "Remove roof shingles. Replace toilets",
    "Remodel interior & raise roof to pitch",
    "Repitch existing roof/attic for water run off",
    "Express: install Tesla SolarGlass solar roofing",
    "Install 206 Timberline Solar Shingles powered by a single phase inverter",
  ])("treats %s as a roof replacement", (description) => {
    expect(classifyRoofWork(remodel(description)).work).toBe(RoofWork.Replacement);
  });

  it("records the words that decided the class", () => {
    expect(classifyRoofWork(remodel("Re-roof existing residence")).basis).toBe("RE-ROOF");
  });

  it("treats a new roof on an existing building as a replacement", () => {
    expect(classifyRoofWork(remodel("New roof on existing residence")).work).toBe(
      RoofWork.Replacement,
    );
  });

  it.each(["Repair roof due to storm damage", "ROOF REPAIR", "repair of existing roof"])(
    "treats %s as a repair",
    (description) => {
      expect(classifyRoofWork(remodel(description)).work).toBe(RoofWork.Repair);
    },
  );

  it.each([
    "New patio cover with metal roof",
    "Add pergola",
    "Roof deck on existing garage",
    "New roof over rear porch",
    "Replace patio roof",
  ])("treats %s as an accessory roof that does not touch the main roof", (description) => {
    expect(classifyRoofWork(remodel(description)).work).toBe(RoofWork.Accessory);
  });

  it.each([
    "Install roof mounted solar PV system 8.2 kW",
    "Replace rooftop unit RTU-3",
    "Roof top unit change out",
    "Replace existing roof top unit",
    "Solar rooftop array 12 kW",
    "Install solar roof mounted panels",
  ])("does not count %s as roofing work", (description) => {
    expect(classifyRoofWork(remodel(description)).work).toBe(RoofWork.Unrelated);
  });

  it("keeps a reroof even when solar is installed in the same job", () => {
    expect(classifyRoofWork(remodel("Reroof and install solar panels")).work).toBe(
      RoofWork.Replacement,
    );
  });

  it("ignores electrical, mechanical and plumbing permits filed with the same description", () => {
    expect(classifyRoofWork(remodel("RE-ROOF RESIDENCE", { permitType: "EP" })).work).toBe(
      RoofWork.Unrelated,
    );
  });

  it("treats a new primary building as new construction", () => {
    const newHouse = remodel("New single family residence with asphalt roof", {
      workClass: "New",
      permitClass: "R- 101 Single Family Houses",
    });

    expect(classifyRoofWork(newHouse)).toEqual({
      work: RoofWork.NewConstruction,
      basis: "R- 101 Single Family Houses",
    });
  });

  it.each(["R- 438 Residential Garage/Carport Addn", "R- 329 Res Structures Other Than Bldg"])(
    "does not treat a new %s as a new primary building",
    (permitClass) => {
      expect(
        classifyRoofWork(remodel("New detached garage", { workClass: "New", permitClass })).work,
      ).not.toBe(RoofWork.NewConstruction);
    },
  );

  it("flags other roof mentions for review instead of guessing", () => {
    expect(classifyRoofWork(remodel("Wall and roof structure to existing")).work).toBe(
      RoofWork.NeedsReview,
    );
  });

  it("leaves permits that never mention a roof unrelated", () => {
    expect(classifyRoofWork(remodel("Kitchen remodel")).work).toBe(RoofWork.Unrelated);
  });
});
