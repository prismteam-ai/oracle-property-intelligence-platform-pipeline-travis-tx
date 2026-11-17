import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type DuckDBAppender, type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
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
} from "../application/lead-build-ports.js";
import type { BbbMatch } from "../domain/bbb-match.js";
import { type BbbProfile, bbbRatingOf } from "../domain/bbb-profile.js";
import { Confidence } from "../domain/confidence.js";
import { CoordinateSource } from "../domain/coordinate-source.js";
import {
  AGED_ROOF_YEARS,
  LONG_OPEN_PERMIT_YEARS,
  LONG_OWNERSHIP_YEARS,
} from "../domain/lead-thresholds.js";
import { PermitLinkStatus } from "../domain/permit-link.js";
import { PermitState } from "../domain/permit-state.js";
import { ROOF_AGE_EVIDENCE, ROOFING_WORK, type RoofWork } from "../domain/roof-work.js";
import { SourceId } from "../domain/source-id.js";
import { DAMAGING_HAIL_INCHES } from "../domain/storm-events.js";
import { MAX_ADDRESS_POINT_SPREAD_DEGREES, STREET_TYPE_ALIASES } from "../domain/street-address.js";
import {
  TCAD_MAIN_FLOOR_DETAIL,
  TCAD_REAL_PROPERTY_TYPES,
  TCAD_ROOF_COVERING_ATTRIBUTE,
  TCAD_ROOF_STYLE_ATTRIBUTE,
  TcadTable,
} from "../domain/tcad-export-layout.js";
import {
  ACTIVE_RIGHT_TO_TRANSACT,
  CONTRACTOR_LICENSE_SUFFIX,
  INSIDE_CITY_LIMITS,
  TRAVIS_COUNTY_COMPTROLLER_CODE,
} from "../domain/texas-registry.js";
import { TRAVIS_COUNTY_BOUNDS } from "../domain/travis-county.js";

type Row = Record<string, unknown>;

const BUILDING_PERMIT = "BP";
const CANDIDATE_WORK_CLASSES = ["new", "roof"];
const RAW_RUN_ID = String.raw`/(\d{8}T\d{6}Z)/page-`;
const ISO_DATE = "%Y-%m-%d";
const LICENSE_EXPIRATION_DATE = "%m/%d/%Y";
const ZIP_LENGTH = 5;
const BUSINESS_ID_SEPARATOR = "-";
const ISO_DATE_LENGTH = "YYYY-MM-DD".length;
const COVERAGE_FILE = "coverage.json";
const SAMPLES_DIR = "samples";
const LONG_OPEN_SAMPLE_FILE = "long-open-roofing-permits.csv";
const AGED_ROOFS_SAMPLE_FILE = "aged-roofs.csv";
const SAMPLE_ROWS = 100;
const PROVENANCE_COLUMNS = ["source_run_id"];
const STAGING_SUFFIX = ".staging.parquet";
const CONFIDENCE_ORDER = [Confidence.High, Confidence.Medium, Confidence.Low]
  .map((confidence, rank) => `WHEN '${confidence}' THEN ${rank}`)
  .join(" ");
const WHOLE_RAW_PAGE_JSON_BUFFER_BYTES = 134_217_728;
const WAREHOUSE_CONFIG = { memory_limit: "8GB", preserve_insertion_order: "false" };

enum ExportTable {
  Permits = "permits",
  RoofingPermits = "roofing_permits",
  Properties = "properties",
  Contractors = "contractors",
  Businesses = "businesses",
  HailEvents = "hail_events",
  Owners = "owners",
}

const EXPORT_KEYS: Record<ExportTable, string> = {
  [ExportTable.Permits]: "permit_number",
  [ExportTable.RoofingPermits]: "permit_number",
  [ExportTable.Properties]: "prop_id",
  [ExportTable.Contractors]: "contractor_key",
  [ExportTable.Businesses]: "business_id",
  [ExportTable.HailEvents]: "event_id",
  [ExportTable.Owners]: "owner_key",
};

const PERMIT_COLUMNS = {
  permit_number: "VARCHAR",
  permittype: "VARCHAR",
  permit_class_mapped: "VARCHAR",
  permit_class: "VARCHAR",
  work_class: "VARCHAR",
  description: "VARCHAR",
  status_current: "VARCHAR",
  applieddate: "VARCHAR",
  issue_date: "VARCHAR",
  statusdate: "VARCHAR",
  completed_date: "VARCHAR",
  expiresdate: "VARCHAR",
  original_address1: "VARCHAR",
  original_city: "VARCHAR",
  original_zip: "VARCHAR",
  tcad_id: "VARCHAR",
  latitude: "VARCHAR",
  longitude: "VARCHAR",
  contractor_trade: "VARCHAR",
  contractor_company_name: "VARCHAR",
  contractor_full_name: "VARCHAR",
  contractor_phone: "VARCHAR",
  contractor_address1: "VARCHAR",
  contractor_city: "VARCHAR",
  contractor_zip: "VARCHAR",
  project_id: "VARCHAR",
  masterpermitnum: "VARCHAR",
  jurisdiction: "VARCHAR",
  total_job_valuation: "VARCHAR",
  link: "STRUCT(url VARCHAR)",
};

const columnsOf = (...names: string[]) =>
  Object.fromEntries(names.map((name) => [name, "VARCHAR"]));
const SALES_TAX_COLUMNS = columnsOf(
  "taxpayer_number",
  "taxpayer_name",
  "taxpayer_organization_type",
  "taxpayer_zip_code",
  "outlet_number",
  "outlet_name",
  "outlet_address",
  "outlet_city",
  "outlet_zip_code",
  "outlet_naics_code",
  "outlet_inside_outside_city_limits_indicator",
  "outlet_permit_issue_date",
  "outlet_first_sales_date",
);
const FRANCHISE_COLUMNS = columnsOf(
  "taxpayer_number",
  "taxpayer_name",
  "taxpayer_organizational_type",
  "taxpayer_zip",
  "taxpayer_county_code",
  "secretary_of_state_sos_or_coa_file_number",
  "sos_charter_date",
  "right_to_transact_business_code",
);
const LICENSE_COLUMNS = columnsOf(
  "license_type",
  "license_number",
  "license_expiration_date_mmddccyy",
  "business_name",
  "owner_telephone",
  "business_telephone",
);

const HAIL_REPORT_COLUMNS = {
  ...columnsOf(
    "event_id",
    "episode_id",
    "event_date",
    "begin_time",
    "timezone",
    "county",
    "location",
    "report_source",
  ),
  magnitude_inches: "DOUBLE",
  latitude: "DOUBLE",
  longitude: "DOUBLE",
};
const NCEI_EVENT_URL = "https://www.ncei.noaa.gov/access/storm-events-database/?id=";

const COORDINATE_DECIMALS = 7;
const ADDRESS_POINT_FEATURES =
  "STRUCT(attributes STRUCT(ADDRESS BIGINT, PREFIX_DIRECTION VARCHAR, STREET_NAME VARCHAR, STREET_TYPE VARCHAR), geometry STRUCT(x DOUBLE, y DOUBLE))[]";
const BBB_PROFILE =
  "STRUCT(profileId VARCHAR, name VARCHAR, alternateNames VARCHAR[], phones VARCHAR[], city VARCHAR, state VARCHAR, zip VARCHAR, rating VARCHAR, accredited BOOLEAN, accreditedSince VARCHAR, outOfBusiness BOOLEAN, profileUrl VARCHAR, snapshotUrl VARCHAR, snapshotAt VARCHAR)";
const PARCEL_FEATURES =
  "STRUCT(attributes STRUCT(PROP_ID BIGINT, PID_10 VARCHAR, Shape__Area DOUBLE), centroid STRUCT(x DOUBLE, y DOUBLE))[]";

export class DuckDbLeadWarehouse implements LeadWarehouse {
  private appraisalRunId = "";

  private constructor(private readonly connection: DuckDBConnection) {}

  static async open(): Promise<DuckDbLeadWarehouse> {
    const instance = await DuckDBInstance.create(":memory:", WAREHOUSE_CONFIG);
    return new DuckDbLeadWarehouse(await instance.connect());
  }

  close(): void {
    this.connection.closeSync();
  }

  async load({
    permitPages,
    appraisalTablesDir,
    parcelPages,
    addressPointPages,
    bbbProfiles,
    salesTaxPages,
    franchisePages,
    licensePages,
    hailPages,
  }: BuildInputs) {
    this.appraisalRunId = basename(appraisalTablesDir);
    const tcad = (table: TcadTable) => literal(join(appraisalTablesDir, `${table}.parquet`));

    await this.connection.run(`
      CREATE TABLE permits AS
      WITH raw AS (
        SELECT *, regexp_extract(filename, ${literal(RAW_RUN_ID)}, 1) AS source_run_id
        FROM read_json(${literal(permitPages)}, format = 'array', filename = true, maximum_object_size = ${WHOLE_RAW_PAGE_JSON_BUFFER_BYTES}, columns = ${structLiteral(PERMIT_COLUMNS)})
      )
      SELECT
        permit_number, permittype AS permit_type, permit_class_mapped AS permit_class_group, permit_class,
        work_class, description, status_current AS status,
        ${date("applieddate")} AS applied_date, ${date("issue_date")} AS issue_date,
        ${date("statusdate")} AS status_date, ${date("completed_date")} AS completed_date,
        ${date("expiresdate")} AS expires_date,
        original_address1 AS address, original_city AS city, original_zip AS zip, tcad_id AS geo_id,
        TRY_CAST(latitude AS DOUBLE) AS latitude, TRY_CAST(longitude AS DOUBLE) AS longitude,
        contractor_trade, contractor_company_name, contractor_full_name, contractor_phone,
        contractor_address1, contractor_city, contractor_zip,
        project_id, masterpermitnum AS master_permit_number, jurisdiction,
        TRY_CAST(total_job_valuation AS DOUBLE) AS job_valuation,
        link.url AS source_url, source_run_id
      FROM raw
      WHERE permit_number IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY permit_number ORDER BY source_run_id DESC) = 1;

      CREATE TABLE tcad_property_rows AS
        SELECT * FROM read_parquet(${tcad(TcadTable.Properties)})
        WHERE prop_type_cd IN (${list(TCAD_REAL_PROPERTY_TYPES)});
      CREATE TABLE tcad_owners AS
        SELECT prop_id, list(py_owner_name ORDER BY py_owner_id, py_owner_name) AS owner_names, count(*) AS owner_count
        FROM tcad_property_rows GROUP BY prop_id;
      CREATE TABLE tcad_properties AS
        SELECT * FROM tcad_property_rows
        QUALIFY row_number() OVER (PARTITION BY prop_id ORDER BY py_owner_id, py_owner_name) = 1;
      CREATE TABLE tcad_improvements AS SELECT * FROM read_parquet(${tcad(TcadTable.Improvements)});
      CREATE TABLE tcad_improvement_details AS
        SELECT * FROM read_parquet(${tcad(TcadTable.ImprovementDetails)})
        WHERE imprv_det_type_desc = ${literal(TCAD_MAIN_FLOOR_DETAIL)} AND yr_built > 0;
      CREATE TABLE tcad_roof_attributes AS
        SELECT * FROM read_parquet(${tcad(TcadTable.ImprovementAttributes)})
        WHERE imprv_attr_desc IN (${list([TCAD_ROOF_COVERING_ATTRIBUTE, TCAD_ROOF_STYLE_ATTRIBUTE])});

      CREATE TABLE parcel_features AS
      WITH features AS (
        SELECT unnest(features) AS feature
        FROM read_json(${literal(parcelPages)}, columns = {'features': '${PARCEL_FEATURES}'})
      )
      SELECT feature.attributes.PROP_ID AS prop_id, feature.attributes.PID_10 AS geo_id,
        feature.attributes.Shape__Area AS area, feature.centroid.y AS latitude, feature.centroid.x AS longitude
      FROM features
      WHERE feature.centroid IS NOT NULL;

      CREATE TABLE parcels AS
        SELECT prop_id, latitude, longitude FROM parcel_features WHERE prop_id IS NOT NULL
        QUALIFY row_number() OVER (PARTITION BY prop_id ORDER BY area DESC NULLS LAST, latitude, longitude) = 1;

      CREATE TABLE parcels_by_geo AS
        SELECT geo_id, latitude, longitude FROM parcel_features WHERE geo_id IS NOT NULL
        QUALIFY row_number() OVER (PARTITION BY geo_id ORDER BY area DESC NULLS LAST, latitude, longitude) = 1;

      CREATE TABLE main_improvement AS
        SELECT prop_id, imprv_id FROM tcad_improvements
        QUALIFY row_number() OVER (PARTITION BY prop_id ORDER BY imprv_val DESC NULLS LAST, imprv_id) = 1;

      CREATE TABLE property_year_built AS
      WITH main_floor AS (
        SELECT d.prop_id, min(d.yr_built) AS year_built
        FROM tcad_improvement_details d JOIN main_improvement m USING (prop_id, imprv_id)
        GROUP BY 1
      ), any_floor AS (
        SELECT prop_id, min(yr_built) AS year_built FROM tcad_improvement_details GROUP BY 1
      )
      SELECT p.prop_id, coalesce(main_floor.year_built, any_floor.year_built) AS year_built
      FROM tcad_properties p
      LEFT JOIN main_floor USING (prop_id)
      LEFT JOIN any_floor USING (prop_id);

      CREATE TABLE permit_links AS
      WITH geo_properties AS (
        SELECT geo_id, list(prop_id) AS prop_ids FROM tcad_properties WHERE geo_id IS NOT NULL GROUP BY 1
      )
      SELECT p.permit_number,
        CASE WHEN len(g.prop_ids) = 1 THEN g.prop_ids[1] END AS prop_id,
        CASE
          WHEN p.geo_id IS NULL THEN ${literal(PermitLinkStatus.MissingParcelId)}
          WHEN g.geo_id IS NULL THEN ${literal(PermitLinkStatus.ParcelNotInRoll)}
          WHEN len(g.prop_ids) > 1 THEN ${literal(PermitLinkStatus.AmbiguousParcel)}
          ELSE ${literal(PermitLinkStatus.Linked)}
        END AS link_status
      FROM permits p LEFT JOIN geo_properties g USING (geo_id);
    `);

    await this.loadCoordinates(addressPointPages);
    await this.loadBbbProfiles(bbbProfiles);
    await this.loadRegistries(salesTaxPages, franchisePages, licensePages);
    await this.connection.run(`
      CREATE TABLE hail_reports AS
      SELECT * FROM (${snapshotRows(hailPages, HAIL_REPORT_COLUMNS)})
      WHERE event_id IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY event_id ORDER BY source_run_id DESC) = 1;
    `);

    return {
      permits: await this.count("permits"),
      properties: await this.count("tcad_properties"),
      parcels: await this.count("parcels"),
      addressPoints: await this.count("address_points"),
      bbbProfiles: await this.count("bbb_profiles"),
      salesTaxOutlets: await this.count("sales_tax_outlets"),
      franchiseTaxpayers: await this.count("franchise_taxpayers"),
      contractorLicenses: await this.count("contractor_licenses"),
      hailReports: await this.count("hail_reports"),
    };
  }

  private async loadRegistries(
    salesTaxPages: string | undefined,
    franchisePages: string | undefined,
    licensePages: string | undefined,
  ): Promise<void> {
    await this.connection.run(`
      CREATE TABLE sales_tax_outlets AS
      SELECT taxpayer_number || ${literal(BUSINESS_ID_SEPARATOR)} || outlet_number AS business_id, *
      FROM (${snapshotRows(salesTaxPages, SALES_TAX_COLUMNS)})
      WHERE taxpayer_number IS NOT NULL AND outlet_number IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY taxpayer_number, outlet_number ORDER BY source_run_id DESC) = 1;

      CREATE TABLE sales_taxpayers AS
      SELECT taxpayer_number, min(taxpayer_name) AS taxpayer_name,
        min(taxpayer_organization_type) AS organization_type, count(*) AS travis_outlets
      FROM sales_tax_outlets GROUP BY 1;

      CREATE TABLE franchise_taxpayers AS
      SELECT taxpayer_number, taxpayer_name, taxpayer_organizational_type AS organization_type,
        taxpayer_zip AS zip, taxpayer_county_code AS county_code,
        secretary_of_state_sos_or_coa_file_number AS sos_file_number,
        ${date("sos_charter_date")} AS charter_date,
        nullif(regexp_replace(right_to_transact_business_code, '[[:space:]]+', '', 'g'), '') AS right_to_transact
      FROM (${snapshotRows(franchisePages, FRANCHISE_COLUMNS)})
      WHERE taxpayer_number IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY taxpayer_number ORDER BY taxpayer_name, right_to_transact) = 1;

      CREATE TABLE contractor_licenses AS
      SELECT license_type, license_number, business_name,
        list_filter([business_telephone, owner_telephone], lambda phone: phone IS NOT NULL) AS phones,
        CAST(TRY_STRPTIME(license_expiration_date_mmddccyy, ${literal(LICENSE_EXPIRATION_DATE)}) AS DATE) AS expiration_date
      FROM (${snapshotRows(licensePages, LICENSE_COLUMNS)})
      WHERE license_type LIKE ${literal(`%${CONTRACTOR_LICENSE_SUFFIX}`)} AND license_number IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY license_type, license_number ORDER BY source_run_id DESC) = 1;
    `);
  }

  private async loadBbbProfiles(bbbProfiles: string | undefined): Promise<void> {
    const records = bbbProfiles
      ? `SELECT profile FROM read_json(${literal(bbbProfiles)}, format = 'newline_delimited', columns = {'profile': '${BBB_PROFILE}'})`
      : `SELECT CAST(NULL AS ${BBB_PROFILE}) AS profile WHERE false`;
    await this.connection.run(`
      CREATE TABLE bbb_profiles AS
      SELECT profile.profileId AS profile_id, profile.name AS business_name,
        profile.alternateNames AS alternate_names, profile.phones AS phones,
        profile.city AS city, profile.state AS state, profile.zip AS zip, profile.rating AS rating,
        profile.accredited AS accredited, profile.accreditedSince AS accredited_since,
        profile.outOfBusiness AS out_of_business, profile.profileUrl AS profile_url,
        profile.snapshotUrl AS snapshot_url, profile.snapshotAt AS snapshot_at
      FROM (${records})
      WHERE profile IS NOT NULL
      QUALIFY row_number() OVER (PARTITION BY profile.profileId ORDER BY profile.snapshotAt DESC) = 1;
    `);
  }

  private async loadCoordinates(addressPointPages: string | undefined): Promise<void> {
    const aliases = Object.entries(STREET_TYPE_ALIASES)
      .map(([variant, canonical]) => `(${literal(variant)}, ${literal(canonical)})`)
      .join(", ");
    const points = addressPointPages
      ? `SELECT unnest(features) AS point FROM read_json(${literal(addressPointPages)}, columns = {'features': '${ADDRESS_POINT_FEATURES}'})`
      : `SELECT CAST(NULL AS ${ADDRESS_POINT_FEATURES.slice(0, -2)}) AS point WHERE false`;
    const { south, north, west, east } = TRAVIS_COUNTY_BOUNDS;
    const spread = (latitude: string, longitude: string) =>
      `max(${latitude}) - min(${latitude}) + max(${longitude}) - min(${longitude}) < ${MAX_ADDRESS_POINT_SPREAD_DEGREES}`;

    await this.connection.run(`
      CREATE TABLE street_type_aliases (variant VARCHAR, canonical VARCHAR);
      INSERT INTO street_type_aliases VALUES ${aliases};

      CREATE TABLE address_points AS
      SELECT point.attributes.ADDRESS AS number, point.attributes.PREFIX_DIRECTION AS prefix,
        point.attributes.STREET_NAME AS street, point.attributes.STREET_TYPE AS street_type,
        point.geometry.y AS latitude, point.geometry.x AS longitude
      FROM (${points})
      WHERE point.attributes.ADDRESS IS NOT NULL AND point.attributes.STREET_NAME IS NOT NULL AND point.geometry IS NOT NULL;

      CREATE TABLE address_point_keys AS
      SELECT ${addressKey("CAST(a.number AS VARCHAR)", "a.prefix", "a.street", "a.street_type")} AS address_key,
        round(avg(a.latitude), ${COORDINATE_DECIMALS}) AS latitude,
        round(avg(a.longitude), ${COORDINATE_DECIMALS}) AS longitude
      FROM address_points a LEFT JOIN street_type_aliases alias ON alias.variant = upper(trim(a.street_type))
      GROUP BY 1
      HAVING ${spread("a.latitude", "a.longitude")};

      CREATE TABLE property_address_keys AS
      SELECT p.prop_id,
        ${addressKey("p.situs_num", "p.situs_street_prefx", "p.situs_street", "p.situs_street_suffix")} AS address_key
      FROM tcad_properties p LEFT JOIN street_type_aliases alias ON alias.variant = upper(trim(p.situs_street_suffix))
      WHERE p.situs_num IS NOT NULL AND p.situs_street IS NOT NULL;

      CREATE TABLE permit_coordinates AS
      SELECT geo_id, round(avg(latitude), ${COORDINATE_DECIMALS}) AS latitude,
        round(avg(longitude), ${COORDINATE_DECIMALS}) AS longitude
      FROM permits
      WHERE geo_id IS NOT NULL
        AND latitude BETWEEN ${south} AND ${north} AND longitude BETWEEN ${west} AND ${east}
      GROUP BY 1
      HAVING ${spread("latitude", "longitude")};

      CREATE TABLE property_coordinates AS
      SELECT p.prop_id,
        coalesce(own.latitude, shared.latitude, point.latitude, permit.latitude) AS latitude,
        coalesce(own.longitude, shared.longitude, point.longitude, permit.longitude) AS longitude,
        CASE
          WHEN own.latitude IS NOT NULL THEN ${literal(CoordinateSource.ParcelCentroid)}
          WHEN shared.latitude IS NOT NULL THEN ${literal(CoordinateSource.SharedParcelCentroid)}
          WHEN point.latitude IS NOT NULL THEN ${literal(CoordinateSource.AddressPoint)}
          WHEN permit.latitude IS NOT NULL THEN ${literal(CoordinateSource.Permit)}
        END AS coordinate_source
      FROM tcad_properties p
      LEFT JOIN parcels own USING (prop_id)
      LEFT JOIN parcels_by_geo shared ON shared.geo_id = p.geo_id
      LEFT JOIN property_address_keys keys USING (prop_id)
      LEFT JOIN address_point_keys point ON point.address_key = keys.address_key
      LEFT JOIN permit_coordinates permit ON permit.geo_id = p.geo_id;
    `);
  }

  async permitCandidates(): Promise<PermitCandidate[]> {
    const rows = await this.rows(`
      SELECT permit_number, permit_type, work_class, permit_class, description, status,
        ${isoDate("applied_date")} AS applied_date, ${isoDate("issue_date")} AS issue_date,
        ${isoDate("completed_date")} AS completed_date, ${isoDate("expires_date")} AS expires_date
      FROM permits
      WHERE upper(permit_type) = ${literal(BUILDING_PERMIT)}
        AND (description ILIKE '%roof%' OR lower(work_class) IN (${list(CANDIDATE_WORK_CLASSES)}))
    `);
    return rows.map((row) => ({
      permitNumber: String(row.permit_number),
      permitType: text(row.permit_type),
      workClass: text(row.work_class),
      permitClass: text(row.permit_class),
      description: text(row.description),
      status: text(row.status),
      appliedDate: text(row.applied_date),
      issueDate: text(row.issue_date),
      completedDate: text(row.completed_date),
      expiresDate: text(row.expires_date),
    }));
  }

  async saveClassifiedPermits(rows: readonly ClassifiedPermit[]): Promise<void> {
    await this.connection.run(`
      CREATE OR REPLACE TABLE permit_roof_work (
        permit_number VARCHAR, roof_work VARCHAR, roof_work_basis VARCHAR, permit_state VARCHAR,
        unfinished BOOLEAN, open_since VARCHAR, years_open INTEGER, past_expiry BOOLEAN
      )`);
    await this.append("permit_roof_work", rows, (appender, row) => {
      appender.appendVarchar(row.permitNumber);
      appender.appendVarchar(row.roofWork);
      appender.appendVarchar(row.roofWorkBasis);
      appender.appendVarchar(row.state);
      appender.appendBoolean(row.unfinished);
      appendOptionalVarchar(appender, row.openSince);
      appendOptionalInteger(appender, row.yearsOpen);
      appender.appendBoolean(row.pastExpiry);
    });
  }

  async roofEvidence(): Promise<PropertyRoofEvidence[]> {
    const rows = await this.rows(`
      WITH evidence AS (
        SELECT l.prop_id, list({
          'permitNumber': w.permit_number,
          'work': w.roof_work,
          'state': w.permit_state,
          'completedDate': ${isoDate("p.completed_date")}
        } ORDER BY w.permit_number) AS permits
        FROM permit_roof_work w
        JOIN permit_links l USING (permit_number)
        JOIN permits p USING (permit_number)
        WHERE l.prop_id IS NOT NULL AND w.roof_work IN (${list(ROOF_AGE_EVIDENCE)})
        GROUP BY 1
      )
      SELECT y.prop_id, y.year_built, coalesce(e.permits, []) AS permits
      FROM property_year_built y LEFT JOIN evidence e USING (prop_id)
    `);
    return rows.map((row) => ({
      propId: Number(row.prop_id),
      yearBuilt: row.year_built === null ? undefined : Number(row.year_built),
      permits: (row.permits as Row[]).map((permit) => ({
        permitNumber: String(permit.permitNumber),
        work: permit.work as RoofWork,
        state: permit.state as PermitState,
        completedDate: text(permit.completedDate),
      })),
    }));
  }

  async saveRoofAges(rows: readonly PropertyRoofAge[]): Promise<void> {
    await this.connection.run(`
      CREATE OR REPLACE TABLE property_roof_age (
        prop_id BIGINT, roof_age_anchor VARCHAR, roof_age_anchor_date VARCHAR,
        roof_age_anchor_permit VARCHAR, roof_age_years INTEGER, roof_age_confidence VARCHAR
      )`);
    await this.append("property_roof_age", rows, (appender, row) => {
      appender.appendBigInt(BigInt(row.propId));
      appender.appendVarchar(row.anchor);
      appender.appendVarchar(row.anchorDate);
      appendOptionalVarchar(appender, row.anchorPermitNumber);
      appender.appendInteger(row.estimatedAgeYears);
      appender.appendVarchar(row.confidence);
    });
  }

  async ownerFacts(): Promise<OwnerFacts[]> {
    const rows = await this.rows(`
      SELECT prop_id, py_owner_name, py_addr_line1, py_addr_state, py_addr_zip, py_addr_country,
        ${isoDate("deed_dt")} AS deed_date
      FROM tcad_properties
    `);
    return rows.map((row) => ({
      propId: Number(row.prop_id),
      name: text(row.py_owner_name),
      mailing: {
        line: text(row.py_addr_line1),
        state: text(row.py_addr_state),
        zip: text(row.py_addr_zip),
        country: text(row.py_addr_country),
      },
      deedDate: text(row.deed_date),
    }));
  }

  async saveOwnerSignals(rows: readonly OwnerSignals[]): Promise<void> {
    await this.connection.run(
      "CREATE OR REPLACE TABLE owner_signals (prop_id BIGINT, owner_locality VARCHAR, ownership_years INTEGER, owner_key VARCHAR)",
    );
    await this.append("owner_signals", rows, (appender, row) => {
      appender.appendBigInt(BigInt(row.propId));
      appender.appendVarchar(row.locality);
      appendOptionalInteger(appender, row.ownershipYears);
      appendOptionalVarchar(appender, row.ownerKey);
    });
  }

  async contractorNames(): Promise<ContractorName[]> {
    const rows = await this.rows(`
      SELECT coalesce(contractor_company_name, contractor_full_name) AS name, contractor_phone AS phone,
        bool_or(contractor_company_name IS NOT NULL) AS company
      FROM permits
      WHERE coalesce(contractor_company_name, contractor_full_name) IS NOT NULL
      GROUP BY 1, 2
    `);
    return rows.map((row) => ({
      name: text(row.name),
      phone: text(row.phone),
      company: row.company === true,
    }));
  }

  async saveContractorKeys(rows: readonly ContractorKey[]): Promise<void> {
    await this.connection.run(
      "CREATE OR REPLACE TABLE contractor_keys (name VARCHAR, phone VARCHAR, contractor_key VARCHAR, phone_key VARCHAR)",
    );
    await this.append("contractor_keys", rows, (appender, row) => {
      appendOptionalVarchar(appender, row.name);
      appendOptionalVarchar(appender, row.phone);
      appender.appendVarchar(row.contractorKey);
      appendOptionalVarchar(appender, row.phoneKey);
    });
  }

  async bbbProfiles(): Promise<BbbProfile[]> {
    const rows = await this.rows("SELECT * FROM bbb_profiles ORDER BY profile_id");
    return rows.map((row) => ({
      profileId: String(row.profile_id),
      name: String(row.business_name),
      alternateNames: (row.alternate_names as string[] | null) ?? [],
      phones: (row.phones as string[] | null) ?? [],
      city: text(row.city),
      state: text(row.state),
      zip: text(row.zip),
      rating: bbbRatingOf(text(row.rating)),
      accredited: row.accredited === true,
      accreditedSince: text(row.accredited_since),
      outOfBusiness: row.out_of_business === true,
      profileUrl: String(row.profile_url),
      snapshotUrl: String(row.snapshot_url),
      snapshotAt: String(row.snapshot_at),
    }));
  }

  async saveBbbMatches(rows: readonly BbbMatch[]): Promise<void> {
    await this.connection.run(
      "CREATE OR REPLACE TABLE bbb_matches (contractor_key VARCHAR, profile_id VARCHAR, match_method VARCHAR, match_confidence VARCHAR)",
    );
    await this.append("bbb_matches", rows, (appender, row) => {
      appender.appendVarchar(row.contractorKey);
      appender.appendVarchar(row.profileId);
      appender.appendVarchar(row.method);
      appender.appendVarchar(row.confidence);
    });
  }

  async *registryTaxpayers(): AsyncIterable<RegistryTaxpayer[]> {
    const reader = await this.connection.stream(`
      WITH names AS (
        SELECT taxpayer_number, taxpayer_name AS name, zip,
          county_code = ${literal(TRAVIS_COUNTY_COMPTROLLER_CODE)} AS in_travis_county
        FROM franchise_taxpayers
        UNION ALL SELECT taxpayer_number, taxpayer_name, taxpayer_zip_code, true FROM sales_tax_outlets
        UNION ALL SELECT taxpayer_number, outlet_name, outlet_zip_code, true FROM sales_tax_outlets
      )
      SELECT taxpayer_number,
        list(DISTINCT name) FILTER (WHERE name IS NOT NULL) AS names,
        list(DISTINCT zip) FILTER (WHERE zip IS NOT NULL) AS zips,
        coalesce(bool_or(in_travis_county), false) AS in_travis_county
      FROM names GROUP BY 1
    `);
    for await (const rows of reader.yieldRowObjectJs()) {
      yield rows.map((row) => ({
        taxpayerNumber: String(row.taxpayer_number),
        names: (row.names as string[] | null) ?? [],
        zips: (row.zips as string[] | null) ?? [],
        inTravisCounty: row.in_travis_county === true,
      }));
    }
  }

  async saveRegistryMatches(rows: readonly RegistryMatch[]): Promise<void> {
    await this.connection.run(
      "CREATE OR REPLACE TABLE registry_matches (contractor_key VARCHAR, taxpayer_number VARCHAR, match_method VARCHAR, match_confidence VARCHAR)",
    );
    await this.append("registry_matches", rows, (appender, row) => {
      appender.appendVarchar(row.contractorKey);
      appender.appendVarchar(row.taxpayerNumber);
      appender.appendVarchar(row.method);
      appender.appendVarchar(row.confidence);
    });
  }

  async contractorLicenses(): Promise<ContractorLicense[]> {
    const rows = await this.rows(
      "SELECT license_type, license_number, business_name, phones FROM contractor_licenses ORDER BY 1, 2",
    );
    return rows.map((row) => ({
      licenseType: String(row.license_type),
      licenseNumber: String(row.license_number),
      businessName: text(row.business_name),
      phones: (row.phones as string[] | null) ?? [],
    }));
  }

  async saveLicenseMatches(rows: readonly LicenseMatch[]): Promise<void> {
    await this.connection.run(
      "CREATE OR REPLACE TABLE license_matches (contractor_key VARCHAR, license_type VARCHAR, license_number VARCHAR, match_method VARCHAR, match_confidence VARCHAR)",
    );
    await this.append("license_matches", rows, (appender, row) => {
      appender.appendVarchar(row.contractorKey);
      appender.appendVarchar(row.licenseType);
      appender.appendVarchar(row.licenseNumber);
      appender.appendVarchar(row.method);
      appender.appendVarchar(row.confidence);
    });
  }

  async businessAddresses(): Promise<BusinessAddress[]> {
    const rows = await this.rows(
      "SELECT business_id, outlet_address FROM sales_tax_outlets ORDER BY business_id",
    );
    return rows.map((row) => ({
      businessId: String(row.business_id),
      address: text(row.outlet_address),
    }));
  }

  async saveBusinessAddressKeys(rows: readonly BusinessAddressKey[]): Promise<void> {
    await this.connection.run(
      "CREATE OR REPLACE TABLE business_address_keys (business_id VARCHAR, address_key VARCHAR)",
    );
    await this.append("business_address_keys", rows, (appender, row) => {
      appender.appendVarchar(row.businessId);
      appender.appendVarchar(row.addressKey);
    });
  }

  async exportTables(outputDir: string, previousDir: string | undefined): Promise<TableSummary[]> {
    await this.connection.run(`
      CREATE OR REPLACE VIEW export_permits AS
        SELECT p.*, l.prop_id, l.link_status, k.contractor_key
        FROM permits p
        JOIN permit_links l USING (permit_number)
        LEFT JOIN contractor_keys k
          ON k.name = coalesce(p.contractor_company_name, p.contractor_full_name)
          AND k.phone IS NOT DISTINCT FROM p.contractor_phone;

      CREATE OR REPLACE VIEW export_roofing_permits AS
      SELECT
        p.permit_number, p.permit_type, p.work_class, p.permit_class, p.description, p.status,
        w.permit_state, w.roof_work, w.roof_work_basis, w.unfinished, CAST(w.open_since AS DATE) AS open_since,
        w.years_open, w.past_expiry,
        p.applied_date, p.issue_date, p.status_date, p.completed_date, p.expires_date,
        p.address, p.city, p.zip, p.geo_id, l.prop_id, l.link_status,
        coalesce(p.latitude, located.latitude) AS latitude,
        coalesce(p.longitude, located.longitude) AS longitude,
        CASE WHEN p.latitude IS NOT NULL THEN ${literal(CoordinateSource.Permit)} ELSE located.coordinate_source END
          AS coordinate_source,
        coalesce(p.contractor_company_name, p.contractor_full_name) AS contractor_name,
        p.contractor_phone, k.contractor_key, p.contractor_trade,
        bbb.rating AS bbb_rating, bbb.profile_url AS bbb_profile_url,
        ${snapshotDate("bbb.snapshot_at")} AS bbb_snapshot_date, match.match_confidence AS bbb_match_confidence,
        p.project_id, p.master_permit_number, p.job_valuation, p.source_url,
        ${literal(SourceId.AustinPermits)} AS source, p.source_run_id
      FROM permits p
      JOIN permit_roof_work w USING (permit_number)
      JOIN permit_links l USING (permit_number)
      LEFT JOIN property_coordinates located ON located.prop_id = l.prop_id
      LEFT JOIN contractor_keys k
        ON k.name IS NOT DISTINCT FROM coalesce(p.contractor_company_name, p.contractor_full_name)
        AND k.phone IS NOT DISTINCT FROM p.contractor_phone
      LEFT JOIN bbb_matches match ON match.contractor_key = k.contractor_key
      LEFT JOIN bbb_profiles bbb ON bbb.profile_id = match.profile_id
      WHERE w.roof_work IN (${list(ROOFING_WORK)});

      CREATE OR REPLACE VIEW export_properties AS
      WITH attribute_counts AS (
        SELECT a.prop_id, a.imprv_attr_desc, a.imprv_attr_cd, count(*) AS occurrences
        FROM tcad_roof_attributes a JOIN main_improvement m USING (prop_id, imprv_id)
        WHERE a.imprv_attr_cd IS NOT NULL
        GROUP BY 1, 2, 3
      ), roof_attributes AS (
        SELECT prop_id,
          first(imprv_attr_cd ORDER BY occurrences DESC, imprv_attr_cd)
            FILTER (WHERE imprv_attr_desc = ${literal(TCAD_ROOF_COVERING_ATTRIBUTE)}) AS roof_covering,
          first(imprv_attr_cd ORDER BY occurrences DESC, imprv_attr_cd)
            FILTER (WHERE imprv_attr_desc = ${literal(TCAD_ROOF_STYLE_ATTRIBUTE)}) AS roof_style
        FROM attribute_counts
        GROUP BY 1
      ), roofing AS (
        SELECT prop_id, count(*) AS roofing_permits,
          count(*) FILTER (WHERE unfinished) AS unfinished_roofing_permits,
          max(years_open) AS max_years_open, max(issue_date) AS last_roofing_permit_issued
        FROM export_roofing_permits WHERE prop_id IS NOT NULL GROUP BY 1
      )
      SELECT
        p.prop_id, p.geo_id, p.prop_type_cd AS property_type,
        concat_ws(' ', p.situs_num, p.situs_street_prefx, p.situs_street, p.situs_street_suffix, p.situs_unit) AS situs_address,
        p.situs_city, p.situs_zip,
        p.py_owner_name AS owner_name, owners.owner_names, owners.owner_count,
        p.py_addr_line1 AS mailing_line1, p.py_addr_line2 AS mailing_line2,
        p.py_addr_line3 AS mailing_line3, p.py_addr_city AS mailing_city, p.py_addr_state AS mailing_state,
        p.py_addr_zip AS mailing_zip, p.py_addr_country AS mailing_country,
        o.owner_locality, p.deed_dt AS deed_date, o.ownership_years, o.owner_key,
        CASE WHEN o.owner_key IS NOT NULL THEN count(*) OVER (PARTITION BY o.owner_key) END AS owner_properties,
        p.market_value, p.appraised_val AS appraised_value, p.hs_exempt AS homestead, p.land_acres,
        y.year_built, ra.roof_covering, ra.roof_style,
        a.roof_age_years, a.roof_age_anchor, a.roof_age_anchor_date, a.roof_age_anchor_permit, a.roof_age_confidence,
        coalesce(r.roofing_permits, 0) AS roofing_permits,
        coalesce(r.unfinished_roofing_permits, 0) AS unfinished_roofing_permits,
        r.max_years_open, r.last_roofing_permit_issued,
        located.latitude, located.longitude, located.coordinate_source,
        ${literal(SourceId.TcadAppraisalExport)} AS source, ${literal(this.appraisalRunId)} AS source_run_id
      FROM tcad_properties p
      JOIN tcad_owners owners USING (prop_id)
      LEFT JOIN owner_signals o USING (prop_id)
      LEFT JOIN property_year_built y USING (prop_id)
      LEFT JOIN roof_attributes ra USING (prop_id)
      LEFT JOIN property_roof_age a USING (prop_id)
      LEFT JOIN roofing r USING (prop_id)
      LEFT JOIN property_coordinates located USING (prop_id);

      CREATE OR REPLACE VIEW export_contractors AS
      WITH permit_history AS (
        SELECT contractor_key,
          list(DISTINCT coalesce(contractor_company_name, contractor_full_name) ORDER BY coalesce(contractor_company_name, contractor_full_name)) AS names,
          list(DISTINCT contractor_phone ORDER BY contractor_phone) FILTER (WHERE contractor_phone IS NOT NULL) AS phones,
          list(DISTINCT contractor_trade ORDER BY contractor_trade) FILTER (WHERE contractor_trade IS NOT NULL) AS trades,
          count(*) AS permits,
          count(DISTINCT prop_id) AS properties,
          min(issue_date) AS first_issue_date, max(issue_date) AS last_issue_date
        FROM export_permits
        WHERE contractor_key IS NOT NULL
        GROUP BY 1
      ), roofing AS (
        SELECT contractor_key, count(*) AS roofing_permits,
          count(*) FILTER (WHERE unfinished) AS unfinished_roofing_permits
        FROM export_roofing_permits
        WHERE contractor_key IS NOT NULL
        GROUP BY 1
      ), licenses AS (
        SELECT m.contractor_key,
          list(m.license_type ORDER BY m.license_type, m.license_number) AS license_types,
          list(m.license_number ORDER BY m.license_type, m.license_number) AS license_numbers,
          max(l.expiration_date) AS license_expiration_date,
          min(m.match_method) AS license_match_method, min(m.match_confidence) AS license_match_confidence
        FROM license_matches m JOIN contractor_licenses l USING (license_type, license_number)
        GROUP BY 1
      )
      SELECT h.contractor_key, h.names, h.phones, h.trades, h.permits,
        coalesce(r.roofing_permits, 0) AS roofing_permits,
        coalesce(r.unfinished_roofing_permits, 0) AS unfinished_roofing_permits,
        h.properties, h.first_issue_date, h.last_issue_date,
        bbb.rating AS bbb_rating, bbb.accredited AS bbb_accredited, bbb.accredited_since AS bbb_accredited_since,
        bbb.out_of_business AS bbb_out_of_business, bbb.business_name AS bbb_business_name,
        bbb.profile_url AS bbb_profile_url, bbb.snapshot_url AS bbb_snapshot_url,
        ${snapshotDate("bbb.snapshot_at")} AS bbb_snapshot_date,
        match.match_method AS bbb_match_method, match.match_confidence AS bbb_match_confidence,
        registry.taxpayer_number AS registry_taxpayer_number,
        coalesce(franchise.taxpayer_name, sales.taxpayer_name) AS registry_name,
        coalesce(franchise.organization_type, sales.organization_type) AS registry_organization_type,
        ${rightToTransact("franchise")} AS registry_active,
        franchise.sos_file_number AS registry_sos_file_number, franchise.charter_date AS registry_charter_date,
        CASE WHEN registry.taxpayer_number IS NOT NULL THEN coalesce(sales.travis_outlets, 0) END AS registry_travis_outlets,
        registry.match_method AS registry_match_method, registry.match_confidence AS registry_match_confidence,
        licenses.license_types, licenses.license_numbers, licenses.license_expiration_date,
        licenses.license_match_method, licenses.license_match_confidence
      FROM permit_history h
      LEFT JOIN roofing r USING (contractor_key)
      LEFT JOIN bbb_matches match USING (contractor_key)
      LEFT JOIN bbb_profiles bbb ON bbb.profile_id = match.profile_id
      LEFT JOIN registry_matches registry USING (contractor_key)
      LEFT JOIN franchise_taxpayers franchise ON franchise.taxpayer_number = registry.taxpayer_number
      LEFT JOIN sales_taxpayers sales ON sales.taxpayer_number = registry.taxpayer_number
      LEFT JOIN licenses USING (contractor_key);

      CREATE OR REPLACE VIEW export_owners AS
      SELECT owner_key,
        first(owner_name ORDER BY prop_id) AS owner_name,
        first(mailing_line1 ORDER BY prop_id) AS mailing_line1,
        first(mailing_city ORDER BY prop_id) AS mailing_city,
        first(mailing_state ORDER BY prop_id) AS mailing_state,
        first(mailing_zip ORDER BY prop_id) AS mailing_zip,
        first(owner_locality ORDER BY prop_id) AS owner_locality,
        count(*) AS properties,
        list(prop_id ORDER BY market_value DESC NULLS LAST, prop_id) AS prop_ids,
        CAST(sum(market_value) AS BIGINT) AS total_market_value,
        count(*) FILTER (WHERE homestead) AS homestead_properties,
        count(*) FILTER (WHERE roof_age_years > ${AGED_ROOF_YEARS}) AS aged_roofs,
        CAST(sum(unfinished_roofing_permits) AS BIGINT) AS unfinished_roofing_permits,
        max(ownership_years) AS longest_ownership_years,
        ${literal(SourceId.TcadAppraisalExport)} AS source, ${literal(this.appraisalRunId)} AS source_run_id
      FROM export_properties
      WHERE owner_key IS NOT NULL
      GROUP BY owner_key;

      CREATE OR REPLACE VIEW export_hail_events AS
      SELECT event_id, episode_id, CAST(event_date AS DATE) AS event_date, begin_time, timezone, county,
        magnitude_inches, latitude, longitude, location, report_source,
        ${literal(NCEI_EVENT_URL)} || event_id AS source_url,
        ${literal(SourceId.NoaaStormEvents)} AS source, source_run_id
      FROM hail_reports;

      CREATE OR REPLACE VIEW export_businesses AS
      WITH situs AS (
        SELECT keys.address_key, left(p.situs_zip, ${ZIP_LENGTH}) AS zip, keys.prop_id
        FROM property_address_keys keys JOIN tcad_properties p USING (prop_id)
      ), linked AS (
        SELECT b.business_id, CASE WHEN count(DISTINCT s.prop_id) = 1 THEN min(s.prop_id) END AS prop_id
        FROM business_address_keys b
        JOIN sales_tax_outlets o USING (business_id)
        JOIN situs s ON s.address_key = b.address_key AND s.zip = left(o.outlet_zip_code, ${ZIP_LENGTH})
        GROUP BY 1
      )
      SELECT o.business_id, o.taxpayer_number, o.taxpayer_name,
        o.taxpayer_organization_type AS organization_type, o.outlet_number, o.outlet_name,
        o.outlet_address AS address, o.outlet_city AS city, left(o.outlet_zip_code, ${ZIP_LENGTH}) AS zip,
        o.outlet_naics_code AS naics_code,
        o.outlet_inside_outside_city_limits_indicator = ${literal(INSIDE_CITY_LIMITS)} AS inside_city_limits,
        ${date("o.outlet_permit_issue_date")} AS permit_issue_date,
        ${date("o.outlet_first_sales_date")} AS first_sales_date,
        ${rightToTransact("franchise")} AS registry_active,
        franchise.sos_file_number, linked.prop_id,
        coalesce(property.latitude, point.latitude) AS latitude,
        coalesce(property.longitude, point.longitude) AS longitude,
        CASE
          WHEN property.latitude IS NOT NULL THEN property.coordinate_source
          WHEN point.latitude IS NOT NULL THEN ${literal(CoordinateSource.AddressPoint)}
        END AS coordinate_source,
        ${literal(SourceId.TxSalesTaxPermits)} AS source, o.source_run_id
      FROM sales_tax_outlets o
      LEFT JOIN linked USING (business_id)
      LEFT JOIN property_coordinates property ON property.prop_id = linked.prop_id
      LEFT JOIN business_address_keys keys USING (business_id)
      LEFT JOIN address_point_keys point ON point.address_key = keys.address_key
      LEFT JOIN franchise_taxpayers franchise ON franchise.taxpayer_number = o.taxpayer_number;
    `);

    await mkdir(outputDir, { recursive: true });
    const summaries: TableSummary[] = [];
    for (const table of Object.values(ExportTable)) {
      summaries.push(await this.exportTable(table, outputDir, previousDir));
    }
    await this.exportCoverage(outputDir);
    await this.exportSamples(outputDir);
    return summaries;
  }

  private async exportCoverage(outputDir: string): Promise<void> {
    const [properties] = await this.rows(`
      SELECT count(*) AS rows, count(latitude) AS with_coordinates, count(year_built) AS with_year_built,
        count(roof_age_years) AS with_roof_age, count(roof_covering) AS with_roof_covering,
        count(*) FILTER (WHERE roof_age_years > ${AGED_ROOF_YEARS}) AS roof_older_than_${AGED_ROOF_YEARS}_years,
        count(*) FILTER (WHERE ownership_years > ${LONG_OWNERSHIP_YEARS}) AS owned_longer_than_${LONG_OWNERSHIP_YEARS}_years
      FROM export_properties`);
    const [roofing] = await this.rows(`
      SELECT count(*) AS rows, count(*) FILTER (WHERE unfinished) AS unfinished,
        count(*) FILTER (WHERE unfinished AND years_open >= ${LONG_OPEN_PERMIT_YEARS}) AS open_${LONG_OPEN_PERMIT_YEARS}_years_or_more,
        count(*) FILTER (WHERE permit_state = ${literal(PermitState.Open)} AND years_open >= ${LONG_OPEN_PERMIT_YEARS}) AS still_open_${LONG_OPEN_PERMIT_YEARS}_years_or_more,
        count(contractor_name) AS with_contractor, count(latitude) AS with_coordinates
      FROM export_roofing_permits`);
    const [permits] = await this.rows(
      "SELECT count(*) AS rows, count(geo_id) AS with_parcel_id FROM export_permits",
    );
    const coverage = {
      properties: {
        ...numbers(properties),
        roof_age_confidence: await this.histogram("export_properties", "roof_age_confidence"),
        owner_locality: await this.histogram("export_properties", "owner_locality"),
        coordinate_source: await this.histogram("export_properties", "coordinate_source"),
      },
      roofing_permits: {
        ...numbers(roofing),
        roof_work: await this.histogram("export_roofing_permits", "roof_work"),
        permit_state: await this.histogram("export_roofing_permits", "permit_state"),
        link_status: await this.histogram("export_roofing_permits", "link_status"),
      },
      permits: {
        ...numbers(permits),
        link_status: await this.histogram("export_permits", "link_status"),
      },
      contractors: {
        rows: await this.count("export_contractors"),
        with_roofing_permits: await this.countWhere("export_contractors", "roofing_permits > 0"),
        with_bbb_rating: await this.countWhere("export_contractors", "bbb_rating IS NOT NULL"),
        bbb_match_method: await this.histogram("export_contractors", "bbb_match_method"),
        with_registry_match: await this.countWhere(
          "export_contractors",
          "registry_taxpayer_number IS NOT NULL",
        ),
        registry_match_method: await this.histogram("export_contractors", "registry_match_method"),
        with_license: await this.countWhere("export_contractors", "license_types IS NOT NULL"),
        license_match_method: await this.histogram("export_contractors", "license_match_method"),
      },
      owners: {
        rows: await this.count("export_owners"),
        with_two_or_more_properties: await this.countWhere("export_owners", "properties >= 2"),
        largest_portfolio: Number(
          (await this.rows("SELECT max(properties) AS n FROM export_owners"))[0]?.n ?? 0,
        ),
      },
      hail_events: {
        rows: await this.count("export_hail_events"),
        one_inch_or_larger: await this.countWhere(
          "export_hail_events",
          `magnitude_inches >= ${DAMAGING_HAIL_INCHES}`,
        ),
        by_year: await this.histogram("export_hail_events", "year(event_date)"),
      },
      businesses: {
        rows: await this.count("export_businesses"),
        with_property: await this.countWhere("export_businesses", "prop_id IS NOT NULL"),
        with_coordinates: await this.countWhere("export_businesses", "latitude IS NOT NULL"),
        coordinate_source: await this.histogram("export_businesses", "coordinate_source"),
      },
    };
    await writeFile(join(outputDir, COVERAGE_FILE), `${JSON.stringify(coverage, null, 2)}\n`);
  }

  private async exportSamples(outputDir: string): Promise<void> {
    const samplesDir = join(outputDir, SAMPLES_DIR);
    await mkdir(samplesDir, { recursive: true });
    await this.connection.run(`
      COPY (
        SELECT permit_number, address, permit_state, roof_work, open_since, years_open, past_expiry,
          contractor_name, contractor_phone, latitude, longitude, source_url
        FROM export_roofing_permits
        WHERE unfinished
        ORDER BY years_open DESC NULLS LAST, permit_number
        LIMIT ${SAMPLE_ROWS}
      ) TO ${literal(join(samplesDir, LONG_OPEN_SAMPLE_FILE))} (HEADER, DELIMITER ',');
      COPY (
        SELECT prop_id, situs_address, situs_zip, year_built, roof_covering, roof_style, roof_age_years,
          roof_age_anchor, roof_age_anchor_date, roof_age_confidence, latitude, longitude
        FROM export_properties
        WHERE roof_age_years > ${AGED_ROOF_YEARS}
        ORDER BY CASE roof_age_confidence ${CONFIDENCE_ORDER} END, roof_age_years DESC, prop_id
        LIMIT ${SAMPLE_ROWS}
      ) TO ${literal(join(samplesDir, AGED_ROOFS_SAMPLE_FILE))} (HEADER, DELIMITER ',');
    `);
  }

  private async histogram(relation: string, column: string): Promise<Record<string, number>> {
    const rows = await this.rows(
      `SELECT ${column} AS key, count(*) AS n FROM ${relation} WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    return Object.fromEntries(rows.map((row) => [String(row.key), Number(row.n)]));
  }

  private async exportTable(
    table: ExportTable,
    outputDir: string,
    previousDir: string | undefined,
  ): Promise<TableSummary> {
    const key = EXPORT_KEYS[table];
    const output = join(outputDir, `${table}.parquet`);
    const previous = previousDir ? join(previousDir, `${table}.parquet`) : undefined;
    const exportTo = async (path: string) =>
      this.connection.run(
        `COPY (SELECT * FROM export_${table} ORDER BY ${key}) TO ${literal(path)} (FORMAT parquet, COMPRESSION zstd)`,
      );

    const prior = previous !== undefined && (await exists(previous)) ? previous : undefined;
    const staging = join(outputDir, `${table}${STAGING_SUFFIX}`);
    await exportTo(staging);
    await this.keepUnchangedProvenance(staging, prior, key, output);
    await rm(staging, { force: true });
    const rows = await this.count(`read_parquet(${literal(output)})`);
    if (prior === undefined) return { table, rows, added: rows, changed: 0, removed: 0 };

    const content = await this.contentFingerprint(output, prior);
    const [delta] = await this.rows(`
      WITH current AS (SELECT ${key} AS k, ${content} AS h FROM read_parquet(${literal(output)}) t),
      previous AS (SELECT ${key} AS k, ${content} AS h FROM read_parquet(${literal(prior)}) t)
      SELECT
        count(*) FILTER (WHERE previous.k IS NULL) AS added,
        count(*) FILTER (WHERE current.k IS NOT NULL AND previous.k IS NOT NULL AND current.h <> previous.h) AS changed,
        count(*) FILTER (WHERE current.k IS NULL) AS removed
      FROM current FULL OUTER JOIN previous ON current.k = previous.k
    `);
    return {
      table,
      rows,
      added: Number(delta?.added ?? 0),
      changed: Number(delta?.changed ?? 0),
      removed: Number(delta?.removed ?? 0),
    };
  }

  private async keepUnchangedProvenance(
    staging: string,
    previous: string | undefined,
    key: string,
    output: string,
  ): Promise<void> {
    const previousColumns = new Set(await this.columnsOf(previous ?? staging));
    const provenance = (await this.columnsOf(staging)).filter(
      (column) => PROVENANCE_COLUMNS.includes(column) && previousColumns.has(column),
    );
    if (provenance.length === 0) {
      await rename(staging, output);
      return;
    }
    const content = await this.contentFingerprint(staging, previous ?? staging);
    const priorRows = previous
      ? `read_parquet(${literal(previous)}) t`
      : `read_parquet(${literal(staging)}) t WHERE false`;
    const carried = provenance
      .map(
        (column) =>
          `CASE WHEN prior.content = current.content THEN prior."prior_${column}" ELSE current."${column}" END AS "${column}"`,
      )
      .join(", ");
    await this.connection.run(`
      COPY (
        WITH current AS (SELECT t.*, ${content} AS content FROM read_parquet(${literal(staging)}) t),
        prior AS (
          SELECT ${key} AS prior_key, ${content} AS content,
            ${provenance.map((column) => `t."${column}" AS "prior_${column}"`).join(", ")}
          FROM ${priorRows}
        )
        SELECT current.* EXCLUDE (content) REPLACE (${carried})
        FROM current LEFT JOIN prior ON current.${key} = prior.prior_key
        ORDER BY current.${key}
      ) TO ${literal(output)} (FORMAT parquet, COMPRESSION zstd)
    `);
  }

  private async columnsOf(parquet: string): Promise<string[]> {
    return (await this.rows(`DESCRIBE SELECT * FROM read_parquet(${literal(parquet)})`)).map(
      (row) => String(row.column_name),
    );
  }

  private async contentFingerprint(current: string, previous: string): Promise<string> {
    const previousColumns = new Set(await this.columnsOf(previous));
    const columns = (await this.columnsOf(current)).filter(
      (column) => previousColumns.has(column) && !PROVENANCE_COLUMNS.includes(column),
    );
    return `md5(CAST(struct_pack(${columns.map((column) => `"${column}" := t."${column}"`).join(", ")}) AS VARCHAR))`;
  }

  private async rows(sql: string): Promise<Row[]> {
    return (await this.connection.runAndReadAll(sql)).getRowObjectsJson() as Row[];
  }

  private async countWhere(relation: string, condition: string): Promise<number> {
    const [row] = await this.rows(`SELECT count(*) AS n FROM ${relation} WHERE ${condition}`);
    return Number(row?.n ?? 0);
  }

  private async count(relation: string): Promise<number> {
    const [row] = await this.rows(`SELECT count(*) AS n FROM ${relation}`);
    return Number(row?.n ?? 0);
  }

  private async append<T>(
    table: string,
    rows: readonly T[],
    write: (appender: DuckDBAppender, row: T) => void,
  ): Promise<void> {
    const appender = await this.connection.createAppender(table);
    for (const row of rows) {
      write(appender, row);
      appender.endRow();
    }
    appender.flushSync();
    appender.closeSync();
  }
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function list(values: readonly string[]): string {
  return values.map(literal).join(", ");
}

function structLiteral(columns: Record<string, string>): string {
  return `{${Object.entries(columns)
    .map(([name, type]) => `${literal(name)}: ${literal(type)}`)
    .join(", ")}}`;
}

function date(column: string): string {
  return `CAST(TRY_CAST(${column} AS TIMESTAMP) AS DATE)`;
}

function isoDate(column: string): string {
  return `strftime(${column}, ${literal(ISO_DATE)})`;
}

function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function appendOptionalVarchar(appender: DuckDBAppender, value: string | undefined): void {
  if (value === undefined) appender.appendNull();
  else appender.appendVarchar(value);
}

function appendOptionalInteger(appender: DuckDBAppender, value: number | undefined): void {
  if (value === undefined) appender.appendNull();
  else appender.appendInteger(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function numbers(row: Row | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]));
}

function addressKey(number: string, prefix: string, street: string, streetType: string): string {
  const part = (column: string) => `coalesce(nullif(upper(trim(${column})), ''), '')`;
  return `concat_ws('|', ${part(number)}, ${part(prefix)}, ${part(street)}, coalesce(alias.canonical, ${part(streetType)}))`;
}

function snapshotRows(pages: string | undefined, columns: Record<string, string>): string {
  if (pages === undefined) {
    const empty = Object.entries(columns).map(([name, type]) => `CAST(NULL AS ${type}) AS ${name}`);
    return `SELECT ${empty.join(", ")}, CAST(NULL AS VARCHAR) AS source_run_id WHERE false`;
  }
  return `SELECT * EXCLUDE (filename), regexp_extract(filename, ${literal(RAW_RUN_ID)}, 1) AS source_run_id
    FROM read_json(${literal(pages)}, format = 'array', filename = true, columns = ${structLiteral(columns)})`;
}

function rightToTransact(franchise: string): string {
  return `CASE WHEN ${franchise}.taxpayer_number IS NOT NULL THEN coalesce(${franchise}.right_to_transact = ${literal(ACTIVE_RIGHT_TO_TRANSACT)}, false) END`;
}

function snapshotDate(column: string): string {
  return `CAST(left(${column}, ${ISO_DATE_LENGTH}) AS DATE)`;
}
