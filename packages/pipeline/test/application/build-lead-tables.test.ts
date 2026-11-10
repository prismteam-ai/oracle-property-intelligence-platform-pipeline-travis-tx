import { describe, expect, it } from "vitest";
import { buildLeadTables } from "../../src/application/build-lead-tables.js";
import type {
  BuildInputs,
  BusinessAddress,
  BusinessAddressKey,
  ClassifiedPermit,
  ContractorKey,
  ContractorLicense,
  ContractorName,
  LeadWarehouse,
  LicenseMatch,
  OwnerFacts,
  OwnerSignals,
  PermitCandidate,
  PropertyRoofAge,
  PropertyRoofEvidence,
  RegistryMatch,
  RegistryTaxpayer,
  TableSummary,
} from "../../src/application/lead-build-ports.js";
import { type BbbMatch, BbbMatchMethod } from "../../src/domain/bbb-match.js";
import { type BbbProfile, BbbRating } from "../../src/domain/bbb-profile.js";
import { Confidence } from "../../src/domain/confidence.js";
import { IdentityMatchMethod } from "../../src/domain/identity-match.js";
import { OwnerLocality } from "../../src/domain/owner-signals.js";
import { PermitState } from "../../src/domain/permit-state.js";
import { RoofAnchor } from "../../src/domain/roof-age.js";
import { RoofWork } from "../../src/domain/roof-work.js";

const AS_OF = "2026-10-27";
const INPUTS: BuildInputs = {
  permitPages: "/data/raw/austin-permits/*/page-*.json.gz",
  appraisalTablesDir: "/data/tables/tcad-appraisal-export/20261027T100000Z",
  parcelPages: "/data/raw/tcad-parcels/20261027T110000Z/page-*.json.gz",
};

const candidate = (overrides: Partial<PermitCandidate>): PermitCandidate => ({
  permitNumber: "2016-023376 BP",
  permitType: "BP",
  workClass: "Repair",
  permitClass: "R- 434 Addition & Alterations",
  description: "Replace roof shingles on sf res.",
  status: "Active",
  appliedDate: "2016-03-01",
  issueDate: "2016-03-03",
  completedDate: undefined,
  expiresDate: "2017-01-02",
  ...overrides,
});

class FakeWarehouse implements LeadWarehouse {
  loadedFrom: BuildInputs | undefined;
  classified: readonly ClassifiedPermit[] = [];
  roofAges: readonly PropertyRoofAge[] = [];
  bbbMatches: readonly BbbMatch[] = [];
  ownerSignals: readonly OwnerSignals[] = [];
  contractorKeys: readonly ContractorKey[] = [];
  registryMatches: readonly RegistryMatch[] = [];
  licenseMatches: readonly LicenseMatch[] = [];
  businessAddressKeys: readonly BusinessAddressKey[] = [];
  exportedTo: { outputDir: string; previousDir: string | undefined } | undefined;

  async load(inputs: BuildInputs) {
    this.loadedFrom = inputs;
    return { permits: 3, properties: 2, parcels: 2 };
  }
  async permitCandidates(): Promise<PermitCandidate[]> {
    return [
      candidate({}),
      candidate({
        permitNumber: "2010-000002 BP",
        description: "Re-roof residence",
        status: "Final",
        completedDate: "2010-10-28",
      }),
      candidate({ permitNumber: "2020-000003 BP", description: "Kitchen remodel" }),
    ];
  }
  async saveClassifiedPermits(rows: readonly ClassifiedPermit[]) {
    this.classified = rows;
  }
  async roofEvidence(): Promise<PropertyRoofEvidence[]> {
    return [
      {
        propId: 100008,
        yearBuilt: 1984,
        permits: [
          {
            permitNumber: "2010-000002 BP",
            work: RoofWork.Replacement,
            state: PermitState.Completed,
            completedDate: "2010-10-28",
          },
        ],
      },
      { propId: 100012, yearBuilt: undefined, permits: [] },
    ];
  }
  async saveRoofAges(rows: readonly PropertyRoofAge[]) {
    this.roofAges = rows;
  }
  async ownerFacts(): Promise<OwnerFacts[]> {
    return [
      {
        propId: 100008,
        name: "DJB INVESTMENT PROPERTY, LLC",
        mailing: { state: "CA", zip: "94105", country: undefined, line: "1 Market St." },
        deedDate: "2011-11-22",
      },
    ];
  }
  async saveOwnerSignals(rows: readonly OwnerSignals[]) {
    this.ownerSignals = rows;
  }
  async contractorNames(): Promise<ContractorName[]> {
    return [
      { name: "RELIABLE ROOFING OF TEXAS INC", phone: "(512) 555-0142", company: true },
      { name: "  ", phone: undefined, company: false },
      { name: "HEATHER SMITH", phone: undefined, company: false },
      { name: "Lone Star Roofing LLC", phone: undefined, company: true },
    ];
  }
  async saveContractorKeys(rows: readonly ContractorKey[]) {
    this.contractorKeys = rows;
  }
  async bbbProfiles(): Promise<BbbProfile[]> {
    return [
      {
        profileId: "0825-1",
        name: "Reliable Roofing, Inc.",
        alternateNames: [],
        phones: ["512.555.0142"],
        city: "Austin",
        state: "TX",
        zip: "78704",
        rating: BbbRating.APlus,
        accredited: true,
        accreditedSince: "2014-05-20",
        outOfBusiness: false,
        profileUrl:
          "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/reliable-roofing-0825-1",
        snapshotUrl: "https://web.archive.org/web/20260710203309/https://www.bbb.org/x",
        snapshotAt: "2026-07-10T20:33:09Z",
      },
    ];
  }
  async saveBbbMatches(rows: readonly BbbMatch[]) {
    this.bbbMatches = rows;
  }
  async *registryTaxpayers(): AsyncIterable<RegistryTaxpayer[]> {
    yield [
      {
        taxpayerNumber: "32042636673",
        names: ["RELIABLE ROOFING OF TEXAS, INC.", "RELIABLE ROOFING"],
        zips: ["78704"],
        inTravisCounty: true,
      },
      {
        taxpayerNumber: "17000000001",
        names: ["HEATHER SMITH"],
        zips: ["78745"],
        inTravisCounty: true,
      },
    ];
    yield [
      {
        taxpayerNumber: "32000000002",
        names: ["LONE STAR ROOFING, LLC"],
        zips: ["75201"],
        inTravisCounty: false,
      },
      {
        taxpayerNumber: "32000000003",
        names: ["Lone Star Roofing Inc"],
        zips: ["78660"],
        inTravisCounty: false,
      },
      {
        taxpayerNumber: "32000000004",
        names: ["UNRELATED HOLDINGS LLC"],
        zips: ["78701"],
        inTravisCounty: true,
      },
    ];
  }
  async saveRegistryMatches(rows: readonly RegistryMatch[]) {
    this.registryMatches = rows;
  }
  async contractorLicenses(): Promise<ContractorLicense[]> {
    return [
      {
        licenseType: "A/C Contractor",
        licenseNumber: "136",
        businessName: "RELIABLE ROOFING INC",
        phones: ["512-555-0142"],
      },
      {
        licenseType: "Electrical Contractor",
        licenseNumber: "900",
        businessName: "Reliable Roofing",
        phones: [],
      },
      { licenseType: "A/C Contractor", licenseNumber: "771", businessName: undefined, phones: [] },
    ];
  }
  async saveLicenseMatches(rows: readonly LicenseMatch[]) {
    this.licenseMatches = rows;
  }
  async businessAddresses(): Promise<BusinessAddress[]> {
    return [
      { businessId: "32042636673-00001", address: "1234 W MAIN ST STE 100" },
      { businessId: "32042636673-00002", address: "PO BOX 5" },
    ];
  }
  async saveBusinessAddressKeys(rows: readonly BusinessAddressKey[]) {
    this.businessAddressKeys = rows;
  }
  async exportTables(outputDir: string, previousDir: string | undefined): Promise<TableSummary[]> {
    this.exportedTo = { outputDir, previousDir };
    return [{ table: "properties", rows: 2, added: 2, changed: 0, removed: 0 }];
  }
}

async function build(warehouse = new FakeWarehouse()) {
  const result = await buildLeadTables(warehouse, {
    buildId: "20261027T120000Z",
    asOf: AS_OF,
    inputs: INPUTS,
    outputDir: "/data/build/20261027T120000Z",
    previousDir: "/data/build/20261026T120000Z",
  });
  return { warehouse, result };
}

describe("buildLeadTables", () => {
  it("classifies every candidate permit's roof work and lifecycle as of the build date", async () => {
    const { warehouse } = await build();

    expect(warehouse.classified).toEqual([
      {
        permitNumber: "2016-023376 BP",
        roofWork: RoofWork.Replacement,
        roofWorkBasis: "REPLACE ROOF",
        state: PermitState.Open,
        unfinished: true,
        openSince: "2016-03-03",
        yearsOpen: 10,
        pastExpiry: true,
      },
      expect.objectContaining({
        permitNumber: "2010-000002 BP",
        roofWork: RoofWork.Replacement,
        state: PermitState.Completed,
        unfinished: false,
      }),
      expect.objectContaining({ permitNumber: "2020-000003 BP", roofWork: RoofWork.Unrelated }),
    ]);
  });

  it("estimates roof age only for properties with evidence", async () => {
    const { warehouse } = await build();

    expect(warehouse.roofAges).toEqual([
      {
        propId: 100008,
        anchor: RoofAnchor.CompletedReplacement,
        anchorDate: "2010-10-28",
        anchorPermitNumber: "2010-000002 BP",
        estimatedAgeYears: 15,
        confidence: Confidence.High,
      },
    ]);
  });

  it("derives owner locality and ownership years", async () => {
    const { warehouse } = await build();

    expect(warehouse.ownerSignals).toEqual([
      {
        propId: 100008,
        locality: OwnerLocality.OutOfState,
        ownershipYears: 14,
        ownerKey: "djb investment property|1||MARKET|ST|94105",
      },
    ]);
  });

  it("keys contractors by normalized name and phone, skipping blank names", async () => {
    const { warehouse } = await build();

    expect(warehouse.contractorKeys).toEqual([
      {
        name: "RELIABLE ROOFING OF TEXAS INC",
        phone: "(512) 555-0142",
        contractorKey: "reliable roofing",
        phoneKey: "5125550142",
      },
      {
        name: "HEATHER SMITH",
        phone: undefined,
        contractorKey: "heather smith",
        phoneKey: undefined,
      },
      {
        name: "Lone Star Roofing LLC",
        phone: undefined,
        contractorKey: "lone star roofing",
        phoneKey: undefined,
      },
    ]);
  });

  it("resolves company-named contractors to Texas Comptroller taxpayers, preferring the local one among namesakes", async () => {
    const { warehouse } = await build();

    expect(warehouse.registryMatches).toEqual([
      {
        contractorKey: "reliable roofing",
        taxpayerNumber: "32042636673",
        method: IdentityMatchMethod.Name,
        confidence: Confidence.Medium,
      },
      {
        contractorKey: "lone star roofing",
        taxpayerNumber: "32000000003",
        method: IdentityMatchMethod.LocalName,
        confidence: Confidence.Low,
      },
    ]);
  });

  it("matches contractors to every TDLR license their business holds", async () => {
    const { warehouse } = await build();

    expect(warehouse.licenseMatches).toEqual([
      {
        contractorKey: "reliable roofing",
        licenseType: "A/C Contractor",
        licenseNumber: "136",
        method: IdentityMatchMethod.NameAndPhone,
        confidence: Confidence.High,
      },
      {
        contractorKey: "reliable roofing",
        licenseType: "Electrical Contractor",
        licenseNumber: "900",
        method: IdentityMatchMethod.NameAndPhone,
        confidence: Confidence.High,
      },
    ]);
  });

  it("keys business outlet addresses so outlets can be linked to properties", async () => {
    const { warehouse } = await build();

    expect(warehouse.businessAddressKeys).toEqual([
      { businessId: "32042636673-00001", addressKey: "1234|W|MAIN|ST" },
    ]);
  });

  it("matches contractors to archived BBB profiles by name and phone", async () => {
    const { warehouse } = await build();

    expect(warehouse.bbbMatches).toEqual([
      {
        contractorKey: "reliable roofing",
        profileId: "0825-1",
        method: BbbMatchMethod.NameAndPhone,
        confidence: Confidence.High,
      },
    ]);
  });

  it("exports the tables against the previous build and reports what it built", async () => {
    const { warehouse, result } = await build();

    expect(warehouse.loadedFrom).toEqual(INPUTS);
    expect(warehouse.exportedTo).toEqual({
      outputDir: "/data/build/20261027T120000Z",
      previousDir: "/data/build/20261026T120000Z",
    });
    expect(result).toEqual({
      buildId: "20261027T120000Z",
      asOf: AS_OF,
      inputs: INPUTS,
      sourceRows: { permits: 3, properties: 2, parcels: 2 },
      roofWork: { [RoofWork.Replacement]: 2, [RoofWork.Unrelated]: 1 },
      roofAgeConfidence: { [Confidence.High]: 1 },
      ownerLocality: { [OwnerLocality.OutOfState]: 1 },
      bbbMatches: { [BbbMatchMethod.NameAndPhone]: 1 },
      registryMatches: { [IdentityMatchMethod.Name]: 1, [IdentityMatchMethod.LocalName]: 1 },
      licenseMatches: { [IdentityMatchMethod.NameAndPhone]: 2 },
      tables: [{ table: "properties", rows: 2, added: 2, changed: 0, removed: 0 }],
    });
  });
});
