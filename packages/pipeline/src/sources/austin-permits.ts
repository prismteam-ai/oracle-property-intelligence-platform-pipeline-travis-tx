import { sqlString } from "../core/db.js";
import { log } from "../core/log.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";

export const AUSTIN_PERMITS_ID = "austin_issued_construction_permits";
const DATASET = "3syk-w9eu";
const BASE = `https://data.austintexas.gov/resource/${DATASET}.csv`;
const PAGE_SIZE = 250_000;
const DEFAULT_LOOKBACK_DAYS = 14;

const fields = [
  "permittype",
  "permit_type_desc",
  "permit_number",
  "permit_class_mapped",
  "permit_class",
  "work_class",
  "description",
  "tcad_id",
  "applieddate",
  "issue_date",
  "status_current",
  "statusdate",
  "expiresdate",
  "completed_date",
  "total_job_valuation",
  "original_address1",
  "original_city",
  "original_zip",
  "jurisdiction",
  "link",
  "project_id",
  "masterpermitnum",
  "latitude",
  "longitude",
  "contractor_trade",
  "contractor_company_name",
  "contractor_full_name",
  "contractor_phone",
  "contractor_address1",
  "contractor_city",
  "contractor_zip",
  "applicant_org",
];

export const OPEN_STATUSES = [
  "Active",
  "Pending",
  "On Hold",
  "Pending Permit",
  "Re Review",
  "Inactive Pending Revision",
];

const STRONG_ROOF =
  "RE-?ROOF|REROOF|ROOF (REPLACEMENT|REPLACE)|REPLACE (THE |EXISTING |ENTIRE |RESIDENTIAL |COMMERCIAL )*ROOF|ROOF TEAR|TEAR[- ]?OFF|NEW ROOF( COVERING)?|SHINGLE (REPLACEMENT|ROOF)|(REMOVE|REPLACE)[A-Z ]{0,30}SHINGLES|ROOF COVERING|TPO (ROOF|MEMBRANE)|METAL ROOF|MODIFIED BITUMEN|BUILT-UP ROOF";
const WEAK_ROOF =
  "ROOFING|ROOF REPAIR|REPAIR (THE )?ROOF|ROOF DECKING|ROOF STRUCTURE|ROOF FRAMING|SHINGLES?";
const EXCLUDE_ONLY =
  "SOLAR|PHOTOVOLTAIC|\\bPV\\b|ROOF ?TOP DECK|ROOFTOP DECK|ROOF DECK\\b|ROOF ?TOP (UNIT|HVAC|EQUIPMENT)|RTU";

export function roofingClassifierSql(
  desc: string,
  permitType: string,
  workClass: string,
): { isRoofing: string; match: string } {
  const d = `upper(coalesce(${desc}, ''))`;
  const roofText = `regexp_replace(${d}, 'ROOF[ -]?TOPS?', ' RTOP ', 'g')`;
  const strong = `regexp_matches(${roofText}, '${STRONG_ROOF}')`;
  const weak = `regexp_matches(${roofText}, '${WEAK_ROOF}')`;
  const excl = `regexp_matches(${d}, '${EXCLUDE_ONLY}')`;
  const match = `CASE
    WHEN ${workClass} = 'Roof' THEN 'work_class_roof'
    WHEN ${permitType} <> 'BP' THEN NULL
    WHEN ${strong} THEN 'roof_replacement'
    WHEN ${weak} AND NOT ${excl} THEN 'roof_work'
    ELSE NULL END`;
  return { isRoofing: `(${match}) IS NOT NULL`, match };
}

function socrataDate(col: string): string {
  return `try_cast(nullif(${col}, '') AS TIMESTAMP)::DATE`;
}

export const austinPermits: SourceAdapter = {
  id: AUSTIN_PERMITS_ID,
  name: "City of Austin Issued Construction Permits (Socrata 3syk-w9eu)",
  provides: ["permits"],
  async run(ctx: RunContext): Promise<SourceOutcome> {
    const select = `$select=${fields.join(",")}`;
    let where = "";
    let windowStart: string | undefined;
    if (ctx.mode === "incremental") {
      const wm = await ctx.getWatermark(AUSTIN_PERMITS_ID);
      windowStart = ctx.windowStart ?? (wm ? shiftDays(wm, -DEFAULT_LOOKBACK_DAYS) : undefined);
      if (!windowStart)
        throw new Error("incremental permit run needs a prior watermark or --since");
      const end = ctx.windowEnd
        ? ` AND (statusdate < '${ctx.windowEnd}' OR issue_date < '${ctx.windowEnd}' OR applieddate < '${ctx.windowEnd}')`
        : "";
      where = `&$where=${encodeURIComponent(`(statusdate >= '${windowStart}' OR issue_date >= '${windowStart}' OR applieddate >= '${windowStart}')${end}`)}`;
    }
    const headers: Record<string, string> = ctx.config.socrataAppToken
      ? { "x-app-token": ctx.config.socrataAppToken }
      : {};
    const pages: { url: string; path: string; sha256: string }[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const url = `${BASE}?${select}${where}&$order=permit_number&$limit=${PAGE_SIZE}&$offset=${offset}`;
      const dl = await ctx.download(
        AUSTIN_PERMITS_ID,
        url,
        `page-${String(offset / PAGE_SIZE).padStart(4, "0")}.csv`,
        headers,
      );
      const rows = Number(
        await ctx.db.scalar(
          `SELECT count(*) FROM read_csv(${sqlString(dl.filePath)}, header = true, all_varchar = true)`,
        ),
      );
      log.info("permit_page", { offset, rows, bytes: dl.bytes });
      pages.push({ url, path: dl.filePath, sha256: dl.sha256 });
      if (rows < PAGE_SIZE) break;
    }

    const files = `[${pages.map((p) => sqlString(p.path)).join(", ")}]`;
    const shaByFile = pages
      .map((p) => `WHEN filename = ${sqlString(p.path)} THEN ${sqlString(p.sha256)}`)
      .join(" ");
    const urlByFile = pages
      .map((p) => `WHEN filename = ${sqlString(p.path)} THEN ${sqlString(p.url)}`)
      .join(" ");
    const roof = roofingClassifierSql("description", "permit_type", "work_class");
    const business = [
      "permit_number",
      "permit_type",
      "permit_type_desc",
      "permit_class",
      "permit_class_mapped",
      "work_class",
      "description",
      "status",
      "status_date",
      "applied_date",
      "issued_date",
      "expires_date",
      "completed_date",
      "tcad_id",
      "address",
      "city",
      "zip",
      "jurisdiction",
      "latitude",
      "longitude",
      "contractor_trade",
      "contractor_company_name",
      "contractor_full_name",
      "contractor_phone",
      "contractor_address",
      "contractor_city",
      "contractor_zip",
      "applicant_org",
      "total_job_valuation",
      "project_id",
      "master_permit_number",
      "permit_link",
    ];
    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_permits AS
      WITH r AS (
        SELECT * FROM read_csv(${files}, header = true, all_varchar = true, filename = true, union_by_name = true)
      ), b AS (
        SELECT
          trim(permit_number) AS permit_number,
          nullif(trim(permittype), '') AS permit_type,
          nullif(trim(permit_type_desc), '') AS permit_type_desc,
          nullif(trim(permit_class), '') AS permit_class,
          nullif(trim(permit_class_mapped), '') AS permit_class_mapped,
          nullif(trim(work_class), '') AS work_class,
          nullif(trim(description), '') AS description,
          nullif(trim(status_current), '') AS status,
          ${socrataDate("statusdate")} AS status_date,
          ${socrataDate("applieddate")} AS applied_date,
          ${socrataDate("issue_date")} AS issued_date,
          ${socrataDate("expiresdate")} AS expires_date,
          ${socrataDate("completed_date")} AS completed_date,
          CASE WHEN regexp_full_match(trim(tcad_id), '[0-9]{10}') THEN trim(tcad_id) END AS tcad_id,
          nullif(trim(original_address1), '') AS address,
          nullif(trim(original_city), '') AS city,
          nullif(trim(original_zip), '') AS zip,
          nullif(trim(jurisdiction), '') AS jurisdiction,
          try_cast(latitude AS DOUBLE) AS latitude,
          try_cast(longitude AS DOUBLE) AS longitude,
          nullif(trim(contractor_trade), '') AS contractor_trade,
          nullif(trim(contractor_company_name), '') AS contractor_company_name,
          nullif(trim(contractor_full_name), '') AS contractor_full_name,
          nullif(trim(contractor_phone), '') AS contractor_phone,
          nullif(trim(contractor_address1), '') AS contractor_address,
          nullif(trim(contractor_city), '') AS contractor_city,
          nullif(trim(contractor_zip), '') AS contractor_zip,
          nullif(trim(applicant_org), '') AS applicant_org,
          try_cast(total_job_valuation AS DOUBLE) AS total_job_valuation,
          nullif(trim(project_id), '') AS project_id,
          nullif(trim(masterpermitnum), '') AS master_permit_number,
          nullif(trim(link), '') AS permit_link,
          CASE ${shaByFile} END AS raw_sha256,
          CASE ${urlByFile} END AS source_url
        FROM r WHERE nullif(trim(permit_number), '') IS NOT NULL
      )
      SELECT ${business.join(", ")},
        ${roof.isRoofing} AS is_roofing, ${roof.match} AS roofing_match,
        status IN (${OPEN_STATUSES.map(sqlString).join(", ")}) AS is_open,
        ${sqlString(AUSTIN_PERMITS_ID)} AS source_id, permit_number AS source_record_id,
        source_url, raw_sha256, now() AS collected_at,
        ${hashExpr(business)} AS record_hash
      FROM b`);

    const counts = await mergeSnapshot(ctx.db, {
      target: "permits",
      staging: "stg_permits",
      key: "permit_number",
      runId: ctx.runId,
      fullSnapshot: ctx.mode === "full",
    });
    const maxStatus = await ctx.db.scalar<string | null>(
      `SELECT max(greatest(status_date, issued_date, applied_date))::VARCHAR FROM stg_permits WHERE status_date <= current_date`,
    );
    if (maxStatus) await ctx.setWatermark(AUSTIN_PERMITS_ID, maxStatus);
    await ctx.db.exec(`DROP TABLE IF EXISTS stg_permits`);
    return {
      status: "ok",
      counts,
      limitation:
        "Socrata :updated_at is rewritten on every daily reload, so change detection uses per-record content hashes plus a status/issue/applied date window. Covers City of Austin full-purpose, limited-purpose and ETJ review areas only; other Travis municipalities and unincorporated county permits are separate portals.",
      detail: {
        pages: pages.length,
        windowStart: windowStart ?? null,
        windowEnd: ctx.windowEnd ?? null,
        watermark: maxStatus,
      },
    };
  },
};

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
