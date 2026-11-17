import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DuckDBInstance } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";
import { type BuildResult, buildLeadTables } from "../../src/application/build-lead-tables.js";
import type { BuildInputs } from "../../src/application/lead-build-ports.js";
import { DuckDbLeadWarehouse } from "../../src/infrastructure/duckdb-lead-warehouse.js";

const AS_OF = "2026-10-27";
const OLDER_RUN = "20261026T000000Z";
const LATEST_RUN = "20261027T000000Z";
const APPRAISAL_RUN = "20261027T100000Z";
const PARCEL_RUN = "20261027T110000Z";
const REGISTRY_RUN = "20261027T120000Z";

type Row = Record<string, unknown>;

const permit = (fields: Row): Row => ({
  permittype: "BP",
  work_class: "Remodel",
  permit_class: "R- 434 Addition & Alterations",
  link: { url: `https://abc.austintexas.gov/permit/${fields.permit_number}` },
  ...fields,
});

const RELIABLE = {
  contractor_company_name: "RELIABLE ROOFING OF TEXAS INC",
  contractor_phone: "(512) 555-0142",
};

const OLDER_PERMITS = [
  permit({
    permit_number: "2010-000002 BP",
    description: "Re-roof residence",
    status_current: "Final",
    issue_date: "2010-09-01T00:00:00.000",
    completed_date: "2010-10-28T00:00:00.000",
    tcad_id: "0100000001",
    latitude: "30.2601",
    longitude: "-97.7501",
    ...RELIABLE,
  }),
  permit({
    permit_number: "2016-023376 BP",
    description: "Replace roof shingles on sf res.",
    status_current: "Active",
    issue_date: "2016-03-03T00:00:00.000",
    tcad_id: "0100000001",
    contractor_company_name: "Reliable Roofing, Inc.",
  }),
];

const LATEST_PERMITS = [
  permit({
    permit_number: "2016-023376 BP",
    description: "Replace roof shingles on sf res.",
    status_current: "Expired",
    applieddate: "2016-03-01T00:00:00.000",
    issue_date: "2016-03-03T00:00:00.000",
    expiresdate: "2017-01-02T00:00:00.000",
    tcad_id: "0100000001",
    contractor_company_name: "Reliable Roofing, Inc.",
  }),
  permit({
    permit_number: "2020-000005 BP",
    description: "Re-roof",
    status_current: "Active",
    issue_date: "2020-05-05T00:00:00.000",
    tcad_id: "0100000003",
    latitude: "30.3001",
    longitude: "-97.6001",
  }),
  permit({
    permit_number: "2021-000006 EP",
    permittype: "EP",
    description: "Re-roof residence",
    status_current: "Active",
    tcad_id: "0100000001",
  }),
  permit({
    permit_number: "2022-000007 BP",
    description: "Kitchen remodel",
    status_current: "Final",
    issue_date: "2022-02-02T00:00:00.000",
    tcad_id: "0100000002",
    contractor_trade: "General Contractor",
    contractor_company_name: "Best Homes LLC",
  }),
  permit({
    permit_number: "2001-000009 BP",
    work_class: "New",
    permit_class: "R- 101 Single Family Houses",
    description: "New single family residence",
    status_current: "Final",
    completed_date: "2001-06-01T00:00:00.000",
    tcad_id: "0100000002",
  }),
  permit({
    permit_number: "2023-000010 BP",
    description: "Kitchen remodel",
    status_current: "Final",
    tcad_id: "0100000004",
    latitude: "30.2901",
    longitude: "-97.7301",
  }),
];

const parcelPage = (features: Row[]) => ({ features, exceededTransferLimit: false });
const PARCELS = parcelPage([
  {
    attributes: { PROP_ID: 100008, PID_10: "0100000001", Shape__Area: 50 },
    centroid: { x: -97.0, y: 30.0 },
  },
  {
    attributes: { PROP_ID: 100008, PID_10: "0100000001", Shape__Area: 9000 },
    centroid: { x: -97.75, y: 30.26 },
  },
  {
    attributes: { PROP_ID: 100012, PID_10: "0100000002", Shape__Area: 7000 },
    centroid: { x: -97.7, y: 30.3 },
  },
  {
    attributes: { PROP_ID: 999999, PID_10: "0100000003", Shape__Area: 20000 },
    centroid: { x: -97.65, y: 30.25 },
  },
]);

const ADDRESS_POINTS = parcelPage([
  {
    attributes: {
      OBJECTID: 1,
      ADDRESS: 500,
      PREFIX_DIRECTION: " ",
      STREET_NAME: "ELM",
      STREET_TYPE: "TER",
    },
    geometry: { x: -97.71, y: 30.31 },
  },
  {
    attributes: {
      OBJECTID: 2,
      ADDRESS: 77,
      PREFIX_DIRECTION: null,
      STREET_NAME: "PINE",
      STREET_TYPE: "ST",
    },
    geometry: { x: -97.73, y: 30.29 },
  },
  {
    attributes: {
      OBJECTID: 3,
      ADDRESS: 77,
      PREFIX_DIRECTION: null,
      STREET_NAME: "PINE",
      STREET_TYPE: "ST",
    },
    geometry: { x: -97.9, y: 30.5 },
  },
]);

const RELIABLE_PROFILE_URL =
  "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/reliable-roofing-0825-1";
const bbbRecord = (timestamp: string, rating: string | null) => ({
  profileId: "0825-1",
  capture: { profileId: "0825-1", originalUrl: RELIABLE_PROFILE_URL, timestamp },
  profile:
    rating === null
      ? null
      : {
          profileId: "0825-1",
          name: "Reliable Roofing, Inc.",
          alternateNames: [],
          phones: ["(512) 555-0142"],
          city: "Austin",
          state: "TX",
          zip: "78704",
          rating,
          accredited: true,
          accreditedSince: "2014-05-20",
          outOfBusiness: false,
          profileUrl: RELIABLE_PROFILE_URL,
          snapshotUrl: `https://web.archive.org/web/${timestamp}/${RELIABLE_PROFILE_URL}`,
          snapshotAt: `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T00:00:00Z`,
        },
});
const BBB_RECORDS = [
  bbbRecord("20190101000000", "B"),
  bbbRecord("20260710000000", "A+"),
  bbbRecord("20260801000000", null),
];

const outlet = (fields: Row): Row => ({
  taxpayer_state: "TX",
  outlet_state: "TX",
  outlet_county_code: "227",
  outlet_inside_outside_city_limits_indicator: "Y",
  outlet_number: "00001",
  ...fields,
});
const SALES_TAX_OUTLETS = [
  outlet({
    ":id": "row-1",
    taxpayer_number: "32042636673",
    taxpayer_name: "RELIABLE ROOFING OF TEXAS, INC.",
    taxpayer_organization_type: "CT",
    taxpayer_zip_code: "78704",
    outlet_name: "RELIABLE ROOFING",
    outlet_address: "1201 LAMAR BLVD STE 200",
    outlet_city: "AUSTIN",
    outlet_zip_code: "78704",
    outlet_naics_code: "238160",
    outlet_permit_issue_date: "2015-08-04T00:00:00.000",
    outlet_first_sales_date: "2015-08-01T00:00:00.000",
  }),
  outlet({
    ":id": "row-2",
    taxpayer_number: "17000000001",
    taxpayer_name: "PINE CAFE LLC",
    outlet_name: "PINE CAFE",
    outlet_address: "77 Pine Street",
    outlet_zip_code: "78703",
  }),
  outlet({
    ":id": "row-3",
    taxpayer_number: "17000000002",
    taxpayer_name: "ELM SALON",
    outlet_address: "5 ELM ST UNIT 101",
    outlet_zip_code: "78701",
  }),
  outlet({
    ":id": "row-4",
    taxpayer_number: "17000000003",
    taxpayer_name: "ELM TERRACE GOODS",
    outlet_address: "500 ELM TER",
    outlet_zip_code: "78702",
    outlet_inside_outside_city_limits_indicator: "N",
  }),
  outlet({
    ":id": "row-5",
    taxpayer_number: "17000000004",
    taxpayer_name: "MAILBOX ONLY",
    outlet_address: "PO BOX 5",
    outlet_zip_code: "78701",
  }),
];
const FRANCHISE_TAXPAYERS = [
  {
    ":id": "row-1",
    taxpayer_number: "32042636673",
    taxpayer_name: "RELIABLE ROOFING OF TEXAS, INC.",
    taxpayer_organizational_type: "CT",
    taxpayer_zip: "78704",
    taxpayer_county_code: "227",
    secretary_of_state_sos_or_coa_file_number: "0801318566",
    sos_charter_date: "2010-09-15T00:00:00.000",
    right_to_transact_business_code: "A ",
  },
  {
    ":id": "row-2",
    taxpayer_number: "32000000099",
    taxpayer_name: "BEST HOMES, LLC",
    taxpayer_organizational_type: "CL",
    taxpayer_zip: "75201",
    taxpayer_county_code: "057",
    right_to_transact_business_code: "N",
  },
];
const TDLR_LICENSES = [
  {
    ":id": "row-1",
    license_type: "A/C Contractor",
    license_number: "136",
    license_expiration_date_mmddccyy: "04/27/2027",
    business_name: "RELIABLE ROOFING INC",
    owner_name: "DOE, JOHN",
    business_telephone: "512-555-0142",
    business_county: "TRAVIS",
  },
  {
    ":id": "row-2",
    license_type: "Apprentice Electrician",
    license_number: "990001",
    license_expiration_date_mmddccyy: "01/31/2027",
    owner_name: "ROE, RICHARD",
    business_county: "TRAVIS",
  },
];

const hailReport = (fields: Row): Row => ({
  episode_id: "190001",
  begin_time: "1840",
  timezone: "CST-6",
  county: "TRAVIS",
  report_source: "Public",
  ...fields,
});
const HAIL_PAGES = [
  [],
  [
    hailReport({
      event_id: "1181339",
      event_date: "2024-05-09",
      magnitude_inches: 1.75,
      latitude: 30.2601,
      longitude: -97.7501,
      location: "AUSTIN",
    }),
    hailReport({
      event_id: "1172071",
      event_date: "2024-04-09",
      magnitude_inches: 0.75,
      latitude: 30.35,
      longitude: -97.7,
      location: "MANOR",
    }),
  ],
];

async function writeGzipJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, gzipSync(JSON.stringify(value)));
}

async function writeAppraisalTables(dir: string) {
  await mkdir(dir, { recursive: true });
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  const copy = (table: string, select: string) =>
    connection.run(`COPY (${select}) TO '${join(dir, `${table}.parquet`)}' (FORMAT parquet)`);

  await copy(
    "properties",
    `SELECT * FROM (VALUES
      (100008::BIGINT, 'R', '0100000001', 'DJB INVESTMENT PROPERTY LLC', '1 MARKET ST', NULL, NULL, 'SAN FRANCISCO', 'CA', '94105', NULL, '1201', NULL, 'LAMAR', 'BLVD', NULL, 'AUSTIN', '78704', DATE '2011-11-22', 4336640::BIGINT, 4336640::BIGINT, false, 0.5398, 1::BIGINT),
      (100008::BIGINT, 'R', '0100000001', 'SECOND PARTIAL OWNER', '12 OAK ST', NULL, NULL, 'AUSTIN', 'TX', '78704', NULL, '1201', NULL, 'LAMAR', 'BLVD', NULL, 'AUSTIN', '78704', DATE '2011-11-22', 4336640::BIGINT, 4336640::BIGINT, false, 0.5398, 2::BIGINT),
      (100012::BIGINT, 'R', '0100000002', 'JANE OWNER', '12 OAK ST', NULL, NULL, 'AUSTIN', 'TX', '78704', NULL, '12', NULL, 'OAK', 'ST', NULL, 'AUSTIN', '78704', DATE '0021-04-22', 500000::BIGINT, 450000::BIGINT, true, 0.2, 3::BIGINT),
      (100020::BIGINT, 'R', '0100000003', 'CONDO OWNER A', '5 ELM', NULL, NULL, 'AUSTIN', 'TX', '78701', NULL, '5', NULL, 'ELM', 'ST', '101', 'AUSTIN', '78701', NULL, 300000::BIGINT, 300000::BIGINT, true, NULL, 4::BIGINT),
      (100021::BIGINT, 'MH', '0100000003', 'CONDO OWNER B', '5 ELM', NULL, NULL, 'AUSTIN', 'TX', '78701', NULL, '5', NULL, 'ELM', 'ST', '102', 'AUSTIN', '78701', NULL, 300000::BIGINT, 300000::BIGINT, true, NULL, 5::BIGINT),
      (100030::BIGINT, 'R', '0100000005', 'ELM OWNER', '500 ELM TER', NULL, NULL, 'AUSTIN', 'TX', '78702', NULL, '500', NULL, 'ELM', 'TERR', NULL, 'AUSTIN', '78702', NULL, 200000::BIGINT, 200000::BIGINT, true, 0.1, 7::BIGINT),
      (100040::BIGINT, 'R', '0100000004', 'JANE OWNER', '12 Oak St.', NULL, NULL, 'AUSTIN', 'TX', '78704', NULL, '77', NULL, 'PINE', 'ST', NULL, 'AUSTIN', '78703', NULL, 250000::BIGINT, 250000::BIGINT, true, 0.1, 8::BIGINT),
      (900001::BIGINT, 'P', '0100000009', 'SOME BUSINESS', '9 MAIN', NULL, NULL, 'AUSTIN', 'TX', '78701', NULL, '9', NULL, 'MAIN', 'ST', NULL, 'AUSTIN', '78701', NULL, 1000::BIGINT, 1000::BIGINT, false, NULL, 6::BIGINT)
    ) AS t(prop_id, prop_type_cd, geo_id, py_owner_name, py_addr_line1, py_addr_line2, py_addr_line3, py_addr_city, py_addr_state, py_addr_zip, py_addr_country, situs_num, situs_street_prefx, situs_street, situs_street_suffix, situs_unit, situs_city, situs_zip, deed_dt, market_value, appraised_val, hs_exempt, land_acres, py_owner_id)`,
  );
  await copy(
    "improvements",
    `SELECT * FROM (VALUES (100008::BIGINT, 1::BIGINT, 200000::BIGINT), (100008, 2, 5000), (100012, 3, 150000))
      AS t(prop_id, imprv_id, imprv_val)`,
  );
  await copy(
    "improvement_details",
    `SELECT * FROM (VALUES
      (100008::BIGINT, 1::BIGINT, '1st Floor', 1984::BIGINT),
      (100008, 2, '1st Floor', 2015),
      (100012, 3, '1st Floor', 2001)
    ) AS t(prop_id, imprv_id, imprv_det_type_desc, yr_built)`,
  );
  await copy(
    "improvement_attributes",
    `SELECT * FROM (VALUES
      (100008::BIGINT, 1::BIGINT, 'Roof Covering', 'COMPOSITIO'),
      (100008, 1, 'Roof Style', 'HIP'),
      (100008, 2, 'Roof Covering', 'METAL'),
      (100012, 3, 'Roof Covering', 'METAL'),
      (100012, 3, 'Roof Covering', 'COMPOSITIO')
    ) AS t(prop_id, imprv_id, imprv_attr_desc, imprv_attr_cd)`,
  );
}

let dataDir: string;
let inputs: BuildInputs;
let result: BuildResult;

async function readTable(buildId: string, table: string, orderBy: string): Promise<Row[]> {
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  const reader = await connection.runAndReadAll(
    `SELECT * FROM '${join(dataDir, "build", buildId, `${table}.parquet`)}' ORDER BY ${orderBy}`,
  );
  return reader.getRowObjectsJson() as Row[];
}

async function build(buildId: string, previousBuildId?: string) {
  const warehouse = await DuckDbLeadWarehouse.open();
  try {
    return await buildLeadTables(warehouse, {
      buildId,
      asOf: AS_OF,
      inputs,
      outputDir: join(dataDir, "build", buildId),
      previousDir: previousBuildId ? join(dataDir, "build", previousBuildId) : undefined,
    });
  } finally {
    warehouse.close();
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-build-"));
  const permitsDir = join(dataDir, "raw", "austin-permits");
  await writeGzipJson(join(permitsDir, OLDER_RUN, "page-00001.json.gz"), OLDER_PERMITS);
  await writeGzipJson(join(permitsDir, LATEST_RUN, "page-00001.json.gz"), LATEST_PERMITS);
  await writeGzipJson(
    join(dataDir, "raw", "tcad-parcels", PARCEL_RUN, "page-00001.json.gz"),
    PARCELS,
  );
  await writeGzipJson(
    join(dataDir, "raw", "travis-address-points", PARCEL_RUN, "page-00001.json.gz"),
    ADDRESS_POINTS,
  );
  const appraisalTablesDir = join(dataDir, "tables", "tcad-appraisal-export", APPRAISAL_RUN);
  await writeAppraisalTables(appraisalTablesDir);
  const bbbDir = join(dataDir, "raw", "bbb-archive", PARCEL_RUN);
  await mkdir(bbbDir, { recursive: true });
  await writeFile(
    join(bbbDir, "profiles.ndjson"),
    BBB_RECORDS.map((record) => `${JSON.stringify(record)}\n`).join(""),
  );

  const registryPages = async (source: string, rows: Row[]) => {
    await writeGzipJson(join(dataDir, "raw", source, REGISTRY_RUN, "page-00001.json.gz"), rows);
    return join(dataDir, "raw", source, REGISTRY_RUN, "page-*.json.gz");
  };

  for (const [index, reports] of HAIL_PAGES.entries()) {
    await writeGzipJson(
      join(dataDir, "raw", "noaa-storm-events", REGISTRY_RUN, `page-0000${index + 1}.json.gz`),
      reports,
    );
  }

  inputs = {
    hailPages: join(dataDir, "raw", "noaa-storm-events", REGISTRY_RUN, "page-*.json.gz"),
    salesTaxPages: await registryPages("tx-sales-tax-permits", SALES_TAX_OUTLETS),
    franchisePages: await registryPages("tx-franchise-taxpayers", FRANCHISE_TAXPAYERS),
    licensePages: await registryPages("tdlr-licenses", TDLR_LICENSES),
    permitPages: join(permitsDir, "*", "page-*.json.gz"),
    appraisalTablesDir,
    parcelPages: join(dataDir, "raw", "tcad-parcels", PARCEL_RUN, "page-*.json.gz"),
    addressPointPages: join(dataDir, "raw", "travis-address-points", PARCEL_RUN, "page-*.json.gz"),
    bbbProfiles: join(dataDir, "raw", "bbb-archive", "*", "profiles.ndjson"),
  };
  result = await build("build-1");
});

describe("DuckDbLeadWarehouse", () => {
  it("counts the latest permit versions, the county's real property and its parcels", () => {
    expect(result.sourceRows).toEqual({
      permits: 7,
      properties: 6,
      parcels: 3,
      addressPoints: 3,
      bbbProfiles: 1,
      salesTaxOutlets: 5,
      franchiseTaxpayers: 2,
      contractorLicenses: 1,
      hailReports: 2,
    });
  });

  it("keeps the latest version of every permit with its source run", async () => {
    const permits = await readTable("build-1", "permits", "permit_number");

    expect(permits.map((row) => row.permit_number)).toEqual([
      "2001-000009 BP",
      "2010-000002 BP",
      "2016-023376 BP",
      "2020-000005 BP",
      "2021-000006 EP",
      "2022-000007 BP",
      "2023-000010 BP",
    ]);
    expect(permits.find((row) => row.permit_number === "2016-023376 BP")).toMatchObject({
      status: "Expired",
      source_run_id: LATEST_RUN,
      prop_id: "100008",
      link_status: "linked",
      contractor_key: "reliable roofing",
    });
  });

  it("publishes roofing permits with lifecycle, link, contractor and source", async () => {
    const roofing = await readTable("build-1", "roofing_permits", "permit_number");

    expect(roofing.map((row) => row.permit_number)).toEqual([
      "2010-000002 BP",
      "2016-023376 BP",
      "2020-000005 BP",
    ]);
    expect(roofing[1]).toMatchObject({
      roof_work: "replacement",
      permit_state: "expired",
      unfinished: true,
      open_since: "2016-03-03",
      years_open: 10,
      past_expiry: true,
      prop_id: "100008",
      latitude: 30.26,
      longitude: -97.75,
      coordinate_source: "parcel_centroid",
      contractor_name: "Reliable Roofing, Inc.",
      contractor_key: "reliable roofing",
      source: "austin-permits",
      source_url: "https://abc.austintexas.gov/permit/2016-023376 BP",
    });
    expect(roofing[2]).toMatchObject({
      prop_id: null,
      link_status: "ambiguous_parcel",
      latitude: 30.3001,
      coordinate_source: "permit",
    });
  });

  it("builds one lead row per property, keeping every partial owner, with roof, owner and location evidence", async () => {
    const properties = await readTable("build-1", "properties", "prop_id");

    expect(properties.map((row) => row.prop_id)).toEqual([
      "100008",
      "100012",
      "100020",
      "100021",
      "100030",
      "100040",
    ]);
    expect(properties[0]).toMatchObject({
      situs_address: "1201 LAMAR BLVD",
      owner_name: "DJB INVESTMENT PROPERTY LLC",
      owner_names: ["DJB INVESTMENT PROPERTY LLC", "SECOND PARTIAL OWNER"],
      owner_count: "2",
      mailing_state: "CA",
      owner_locality: "out_of_state",
      ownership_years: 14,
      year_built: "1984",
      roof_covering: "COMPOSITIO",
      roof_style: "HIP",
      roof_age_years: 15,
      roof_age_anchor: "completed_replacement",
      roof_age_anchor_date: "2010-10-28",
      roof_age_anchor_permit: "2010-000002 BP",
      roof_age_confidence: "high",
      roofing_permits: "2",
      unfinished_roofing_permits: "1",
      max_years_open: 10,
      latitude: 30.26,
      longitude: -97.75,
      coordinate_source: "parcel_centroid",
      source: "tcad-appraisal-export",
      source_run_id: APPRAISAL_RUN,
    });
    expect(properties[1]).toMatchObject({
      roof_covering: "COMPOSITIO",
      owner_locality: "local",
      ownership_years: null,
      roof_age_anchor: "new_construction",
      roof_age_years: 25,
      roof_age_confidence: "medium",
    });
  });

  it("reconciles owners by name and mailing address into owner entities with their portfolio", async () => {
    const properties = await readTable("build-1", "properties", "prop_id");
    const owned = (propId: string) => properties.find((row) => row.prop_id === propId);
    const owners = await readTable("build-1", "owners", "owner_key");

    expect(owned("100012")?.owner_key).toBe(owned("100040")?.owner_key);
    expect(owned("100012")).toMatchObject({ owner_properties: "2" });
    expect(owned("100008")).toMatchObject({ owner_properties: "1" });
    expect(owners.find((owner) => owner.owner_key === owned("100012")?.owner_key)).toMatchObject({
      owner_name: "JANE OWNER",
      mailing_zip: "78704",
      owner_locality: "local",
      properties: "2",
      prop_ids: ["100012", "100040"],
      total_market_value: "750000",
      homestead_properties: "2",
      aged_roofs: "1",
    });
  });

  it("locates properties without their own parcel through a shared parcel, an address point or a permit", async () => {
    const properties = await readTable("build-1", "properties", "prop_id");
    const located = (propId: string) => properties.find((row) => row.prop_id === propId);

    expect(located("100020")).toMatchObject({
      latitude: 30.25,
      longitude: -97.65,
      coordinate_source: "shared_parcel_centroid",
    });
    expect(located("100021")?.coordinate_source).toBe("shared_parcel_centroid");
    expect(located("100030")).toMatchObject({
      latitude: 30.31,
      longitude: -97.71,
      coordinate_source: "address_point",
    });
    expect(located("100040")).toMatchObject({
      latitude: 30.2901,
      longitude: -97.7301,
      coordinate_source: "permit",
    });
  });

  it("still builds when no address points were ingested", async () => {
    const { addressPointPages: _ignored, ...withoutAddressPoints } = inputs;
    const warehouse = await DuckDbLeadWarehouse.open();
    try {
      const built = await buildLeadTables(warehouse, {
        buildId: "build-without-points",
        asOf: AS_OF,
        inputs: withoutAddressPoints,
        outputDir: join(dataDir, "build", "build-without-points"),
        previousDir: undefined,
      });
      expect(built.sourceRows.addressPoints).toBe(0);
    } finally {
      warehouse.close();
    }
    const properties = await readTable("build-without-points", "properties", "prop_id");
    expect(properties.find((row) => row.prop_id === "100030")?.coordinate_source).toBeNull();
  });

  it("keeps every permit contractor, grouping name variants under one key", async () => {
    const contractors = await readTable("build-1", "contractors", "contractor_key");

    expect(contractors.map((row) => row.contractor_key)).toEqual([
      "best homes",
      "reliable roofing",
    ]);
    expect(contractors[1]).toMatchObject({
      contractor_key: "reliable roofing",
      permits: "2",
      roofing_permits: "2",
      unfinished_roofing_permits: "1",
      properties: "1",
    });
    expect(contractors[1]?.names).toEqual(
      expect.arrayContaining(["RELIABLE ROOFING OF TEXAS INC", "Reliable Roofing, Inc."]),
    );
    expect(contractors[0]).toMatchObject({
      permits: "1",
      roofing_permits: "0",
      trades: ["General Contractor"],
      first_issue_date: "2022-02-02",
    });
  });

  it("resolves contractors to Texas Comptroller taxpayers and TDLR licenses", async () => {
    const [bestHomes, reliable] = await readTable("build-1", "contractors", "contractor_key");

    expect(reliable).toMatchObject({
      registry_taxpayer_number: "32042636673",
      registry_name: "RELIABLE ROOFING OF TEXAS, INC.",
      registry_organization_type: "CT",
      registry_active: true,
      registry_sos_file_number: "0801318566",
      registry_charter_date: "2010-09-15",
      registry_travis_outlets: "1",
      registry_match_method: "name",
      registry_match_confidence: "medium",
      license_types: ["A/C Contractor"],
      license_numbers: ["136"],
      license_expiration_date: "2027-04-27",
      license_match_method: "name_and_phone",
      license_match_confidence: "high",
    });
    expect(bestHomes).toMatchObject({
      registry_taxpayer_number: "32000000099",
      registry_active: false,
      registry_travis_outlets: "0",
      license_types: null,
    });
  });

  it("publishes Travis County sales tax outlets as businesses linked to the property at their address", async () => {
    const businesses = await readTable("build-1", "businesses", "business_id");

    expect(businesses.map((row) => [row.business_id, row.prop_id, row.coordinate_source])).toEqual([
      ["17000000001-00001", "100040", "permit"],
      ["17000000002-00001", null, null],
      ["17000000003-00001", "100030", "address_point"],
      ["17000000004-00001", null, null],
      ["32042636673-00001", "100008", "parcel_centroid"],
    ]);
    expect(businesses[4]).toMatchObject({
      taxpayer_number: "32042636673",
      taxpayer_name: "RELIABLE ROOFING OF TEXAS, INC.",
      organization_type: "CT",
      outlet_name: "RELIABLE ROOFING",
      address: "1201 LAMAR BLVD STE 200",
      city: "AUSTIN",
      zip: "78704",
      naics_code: "238160",
      inside_city_limits: true,
      permit_issue_date: "2015-08-04",
      first_sales_date: "2015-08-01",
      registry_active: true,
      latitude: 30.26,
      longitude: -97.75,
      source: "tx-sales-tax-permits",
      source_run_id: REGISTRY_RUN,
    });
    expect(businesses[2]?.inside_city_limits).toBe(false);
  });

  it("publishes NOAA hail reports with their size, place and a link to the NCEI event", async () => {
    const hail = await readTable("build-1", "hail_events", "event_id");

    expect(hail).toEqual([
      expect.objectContaining({ event_id: "1172071", magnitude_inches: 0.75 }),
      {
        event_id: "1181339",
        episode_id: "190001",
        event_date: "2024-05-09",
        begin_time: "1840",
        timezone: "CST-6",
        county: "TRAVIS",
        magnitude_inches: 1.75,
        latitude: 30.2601,
        longitude: -97.7501,
        location: "AUSTIN",
        report_source: "Public",
        source_url: "https://www.ncei.noaa.gov/access/storm-events-database/?id=1181339",
        source: "noaa-storm-events",
        source_run_id: REGISTRY_RUN,
      },
    ]);
  });

  it("still builds without the Texas registries", async () => {
    const { salesTaxPages, franchisePages, licensePages, ...withoutRegistries } = inputs;
    const warehouse = await DuckDbLeadWarehouse.open();
    try {
      await buildLeadTables(warehouse, {
        buildId: "build-without-registries",
        asOf: AS_OF,
        inputs: withoutRegistries,
        outputDir: join(dataDir, "build", "build-without-registries"),
        previousDir: undefined,
      });
    } finally {
      warehouse.close();
    }

    expect(await readTable("build-without-registries", "businesses", "business_id")).toEqual([]);
    const contractors = await readTable(
      "build-without-registries",
      "contractors",
      "contractor_key",
    );
    expect(contractors.map((row) => row.registry_taxpayer_number)).toEqual([null, null]);
  });

  it("writes a coverage report with fill rates for the fields leads depend on", async () => {
    const coverage = JSON.parse(
      await readFile(join(dataDir, "build", "build-1", "coverage.json"), "utf8"),
    );

    expect(coverage.properties).toMatchObject({
      rows: 6,
      with_coordinates: 6,
      with_year_built: 2,
      with_roof_age: 2,
      roof_age_confidence: { high: 1, medium: 1 },
      owner_locality: { out_of_state: 1, local: 5 },
      coordinate_source: {
        address_point: 1,
        parcel_centroid: 2,
        permit: 1,
        shared_parcel_centroid: 2,
      },
    });
    expect(coverage.roofing_permits).toMatchObject({
      rows: 3,
      unfinished: 2,
      open_5_years_or_more: 2,
      still_open_5_years_or_more: 1,
      with_contractor: 2,
      link_status: { linked: 2, ambiguous_parcel: 1 },
    });
  });

  it("writes small CSV extracts of the strongest leads", async () => {
    const extract = (name: string) =>
      readFile(join(dataDir, "build", "build-1", "samples", name), "utf8");

    const longOpen = (await extract("long-open-roofing-permits.csv")).trim().split("\n");
    expect(longOpen[0]).toContain("permit_number");
    expect(longOpen[1]).toContain("2016-023376 BP");
    const agedRoofs = (await extract("aged-roofs.csv")).trim().split("\n");
    expect(agedRoofs).toHaveLength(2);
    expect(agedRoofs[1]).toContain("100012");
  });

  it("carries the latest archived BBB grade onto the contractor and its roofing permits", async () => {
    const contractors = await readTable("build-1", "contractors", "contractor_key");
    const contractor = contractors.find((row) => row.contractor_key === "reliable roofing");
    expect(contractor).toMatchObject({
      contractor_key: "reliable roofing",
      bbb_rating: "A+",
      bbb_accredited: true,
      bbb_business_name: "Reliable Roofing, Inc.",
      bbb_profile_url: RELIABLE_PROFILE_URL,
      bbb_snapshot_url: `https://web.archive.org/web/20260710000000/${RELIABLE_PROFILE_URL}`,
      bbb_snapshot_date: "2026-07-10",
      bbb_match_method: "name_and_phone",
      bbb_match_confidence: "high",
    });

    const roofing = await readTable("build-1", "roofing_permits", "permit_number");
    expect(roofing.find((row) => row.permit_number === "2016-023376 BP")).toMatchObject({
      bbb_rating: "A+",
      bbb_snapshot_date: "2026-07-10",
    });
    expect(roofing.find((row) => row.permit_number === "2020-000005 BP")?.bbb_rating).toBeNull();

    const coverage = JSON.parse(
      await readFile(join(dataDir, "build", "build-1", "coverage.json"), "utf8"),
    );
    expect(coverage.contractors).toMatchObject({
      rows: 2,
      with_roofing_permits: 1,
      with_bbb_rating: 1,
      bbb_match_method: { name_and_phone: 1 },
      with_registry_match: 2,
      registry_match_method: { name: 2 },
      with_license: 1,
      license_match_method: { name_and_phone: 1 },
    });
    expect(coverage.owners).toEqual({
      rows: 5,
      with_two_or_more_properties: 1,
      largest_portfolio: 2,
    });
    expect(coverage.hail_events).toEqual({
      rows: 2,
      one_inch_or_larger: 1,
      by_year: { "2024": 2 },
    });
    expect(coverage.businesses).toMatchObject({
      rows: 5,
      with_property: 3,
      with_coordinates: 3,
      coordinate_source: { address_point: 1, parcel_centroid: 1, permit: 1 },
    });
  });

  it("reports every row as added on the first build", () => {
    expect(result.tables).toEqual(
      expect.arrayContaining([
        { table: "properties", rows: 6, added: 6, changed: 0, removed: 0 },
        { table: "roofing_permits", rows: 3, added: 3, changed: 0, removed: 0 },
      ]),
    );
  });

  it("reports no changes when rebuilt from the same inputs", async () => {
    const rebuilt = await build("build-2", "build-1");

    for (const table of rebuilt.tables) {
      expect(table).toMatchObject({ added: 0, changed: 0, removed: 0 });
    }
  });

  it("compares against a previous build written before a column was added", async () => {
    const previousDir = join(dataDir, "build", "build-before-bbb");
    await mkdir(previousDir, { recursive: true });
    const connection = await (await DuckDBInstance.create(":memory:")).connect();
    await connection.run(
      `COPY (SELECT * EXCLUDE (bbb_rating, bbb_match_method) FROM '${join(dataDir, "build", "build-1", "contractors.parquet")}') TO '${join(previousDir, "contractors.parquet")}' (FORMAT parquet)`,
    );

    const rebuilt = await build("build-after-bbb", "build-before-bbb");

    expect(rebuilt.tables).toEqual(
      expect.arrayContaining([{ table: "contractors", rows: 2, added: 0, changed: 0, removed: 0 }]),
    );
  });

  it("does not count or publish a re-fetch of identical permits as a change", async () => {
    await writeGzipJson(
      join(dataDir, "raw", "austin-permits", "20261028T000000Z", "page-00001.json.gz"),
      LATEST_PERMITS,
    );

    const refetched = await build("build-4", "build-1");

    expect(refetched.tables).toEqual(
      expect.arrayContaining([
        { table: "permits", rows: 7, added: 0, changed: 0, removed: 0 },
        { table: "roofing_permits", rows: 3, added: 0, changed: 0, removed: 0 },
      ]),
    );
    const digest = async (buildId: string, table: string) =>
      createHash("sha256")
        .update(await readFile(join(dataDir, "build", buildId, `${table}.parquet`)))
        .digest("hex");
    for (const table of ["permits", "roofing_permits"]) {
      expect(await digest("build-4", table)).toBe(await digest("build-1", table));
    }
  });

  it("writes byte-identical tables from the same inputs, so unchanged tables keep their CIDs", async () => {
    await build("build-5");
    await build("build-6");

    for (const table of [
      "permits",
      "roofing_permits",
      "properties",
      "contractors",
      "businesses",
      "hail_events",
      "owners",
    ]) {
      const digest = async (buildId: string) =>
        createHash("sha256")
          .update(await readFile(join(dataDir, "build", buildId, `${table}.parquet`)))
          .digest("hex");
      expect(await digest("build-6")).toBe(await digest("build-5"));
    }
  });
});
