import { execFile } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sqlString, type Db } from "../core/db.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceOutcome } from "../core/run.js";

const run = promisify(execFile);

export const TCAD_ID = "tcad_appraisal_roll";

/**
 * Field positions follow the True Automation/True Prodigy "Appraisal Export Layout" 8.0.x
 * (1-based start, length). TCAD publishes a "Legacy8.0.25" variant of the same layout.
 */
export const PROP_FIELDS: Record<string, [number, number]> = {
  prop_id: [1, 12],
  prop_type_cd: [13, 5],
  prop_val_yr: [18, 5],
  sup_num: [23, 12],
  geo_id: [547, 50],
  py_owner_id: [597, 12],
  py_owner_name: [609, 70],
  py_addr_line1: [694, 60],
  py_addr_line2: [754, 60],
  py_addr_line3: [814, 60],
  py_addr_city: [874, 50],
  py_addr_state: [924, 50],
  py_addr_zip: [979, 5],
  situs_street_prefx: [1040, 10],
  situs_street: [1050, 50],
  situs_street_suffix: [1100, 10],
  situs_city: [1110, 30],
  situs_zip: [1140, 10],
  legal_desc: [1150, 255],
  legal_acreage: [1660, 16],
  appraised_val: [1916, 15],
  assessed_val: [1946, 15],
  deed_book_id: [1994, 20],
  deed_book_page: [2014, 20],
  deed_dt: [2034, 25],
};

export const IMP_DET_FIELDS: Record<string, [number, number]> = {
  prop_id: [1, 12],
  prop_val_yr: [13, 4],
  imprv_id: [17, 12],
  imprv_det_id: [29, 12],
  imprv_det_type_cd: [41, 10],
  imprv_det_type_desc: [51, 25],
  imprv_det_class_cd: [76, 10],
  yr_built: [86, 4],
  depreciation_yr: [90, 4],
  imprv_det_area: [94, 15],
};

export const IMP_ATR_FIELDS: Record<string, [number, number]> = {
  prop_id: [1, 12],
  prop_val_yr: [13, 4],
  imprv_id: [17, 12],
  imprv_det_id: [29, 12],
  imprv_attr_id: [41, 12],
  imprv_attr_desc: [53, 25],
  imprv_attr_cd: [78, 10],
};

const FILE_NAMES = {
  prop: ["APPRAISAL_INFO.TXT", "PROP.TXT"],
  impDet: ["APPRAISAL_IMPROVEMENT_DETAIL.TXT", "IMP_DET.TXT"],
  impAtr: ["APPRAISAL_IMPROVEMENT_DETAIL_ATTR.TXT", "IMP_ATR.TXT"],
};

export function fixedWidthSelect(fields: Record<string, [number, number]>, col = "line"): string {
  return Object.entries(fields)
    .map(([name, [start, len]]) => `nullif(trim(substr(${col}, ${start}, ${len})), '') AS ${name}`)
    .join(",\n      ");
}

export function readLinesSql(file: string): string {
  return `read_csv(${sqlString(file)}, columns = {'line': 'VARCHAR'}, header = false, delim = '\u0001',
    quote = '', escape = '', encoding = 'latin-1', strict_mode = false, null_padding = true)`;
}

/** Improvement-detail type codes for building floors ("1ST", "2ND", "3RD", ...): the main living/commercial area. */
export const FLOOR_DETAIL_TYPE = "[0-9]+(ST|ND|RD|TH)";

const NEEDED_FILES = [...FILE_NAMES.prop, ...FILE_NAMES.impDet, ...FILE_NAMES.impAtr];

async function extractNeeded(zipPath: string, outDir: string): Promise<void> {
  const { stdout } = await run("unzip", ["-Z1", zipPath], { maxBuffer: 16 * 1024 * 1024 });
  const wanted = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => NEEDED_FILES.some((n) => l.toUpperCase().endsWith(n)));
  if (!wanted.length)
    throw new Error(`TCAD export ${zipPath} contains none of ${NEEDED_FILES.join(", ")}`);
  await run("unzip", ["-o", "-q", zipPath, ...wanted, "-d", outDir], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

export const deedDateSql = (col: string) => `coalesce(
    try_strptime(${col}, '%Y-%m-%d %H:%M:%S.%g')::DATE,
    try_strptime(${col}, '%Y-%m-%d %H:%M:%S')::DATE,
    try_strptime(${col}, '%m/%d/%Y %H:%M:%S %p')::DATE,
    try_strptime(${col}, '%m/%d/%Y')::DATE,
    try_strptime(${col}, '%m-%d-%Y')::DATE,
    try_strptime(${col}, '%b %d %Y %I:%M%p')::DATE,
    try_cast(${col} AS DATE))`;

/** Deed dates outside 1836 (Republic of Texas) .. today are source typos (e.g. year 0021 or 2202); keep them only as raw text. */
export const plausibleDeedDateSql = (
  col: string,
) => `(CASE WHEN ${deedDateSql(col)} BETWEEN DATE '1836-01-01' AND current_date
    THEN ${deedDateSql(col)} END)`;

async function findExportFile(dir: string, names: string[]): Promise<string | undefined> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const n of names) {
    const hit = entries.find((e) => e.isFile() && e.name.toUpperCase().endsWith(n));
    if (hit) return path.join(hit.parentPath, hit.name);
  }
  return undefined;
}

export async function stageTcadExport(
  db: Db,
  dir: string,
): Promise<{ prop: string; impDet?: string; impAtr?: string }> {
  const prop = await findExportFile(dir, FILE_NAMES.prop);
  if (!prop) throw new Error(`TCAD export at ${dir} has no APPRAISAL_INFO.TXT / PROP.TXT`);
  const impDet = await findExportFile(dir, FILE_NAMES.impDet);
  const impAtr = await findExportFile(dir, FILE_NAMES.impAtr);
  await db.exec(
    `CREATE OR REPLACE TEMP TABLE _tcad_prop AS SELECT ${fixedWidthSelect(PROP_FIELDS)} FROM ${readLinesSql(prop)}`,
  );
  await db.exec(`CREATE OR REPLACE TEMP TABLE _tcad_imp AS
    SELECT prop_id,
      min(try_cast(yr_built AS INTEGER)) FILTER (WHERE try_cast(yr_built AS INTEGER) BETWEEN 1800 AND 2100
        AND regexp_full_match(coalesce(imprv_det_type_cd, ''), '${FLOOR_DETAIL_TYPE}')) AS year_built,
      max(try_cast(yr_built AS INTEGER)) FILTER (WHERE try_cast(yr_built AS INTEGER) BETWEEN 1800 AND 2100) AS latest_improvement_year
    FROM (${impDet ? `SELECT ${fixedWidthSelect(IMP_DET_FIELDS)} FROM ${readLinesSql(impDet)}` : "SELECT NULL::VARCHAR AS prop_id, NULL::VARCHAR AS yr_built, NULL::VARCHAR AS imprv_det_type_cd WHERE false"})
    GROUP BY prop_id`);
  await db.exec(`CREATE OR REPLACE TEMP TABLE _tcad_roof AS
    SELECT prop_id, list_distinct(list(imprv_attr_desc || coalesce(': ' || imprv_attr_cd, ''))) AS roof_attributes
    FROM (${impAtr ? `SELECT ${fixedWidthSelect(IMP_ATR_FIELDS)} FROM ${readLinesSql(impAtr)}` : "SELECT NULL::VARCHAR AS prop_id, NULL::VARCHAR AS imprv_attr_desc, NULL::VARCHAR AS imprv_attr_cd WHERE false"})
    WHERE upper(imprv_attr_desc) LIKE '%ROOF%'
    GROUP BY prop_id`);
  return { prop, impDet, impAtr };
}

const business = [
  "prop_id",
  "geo_id",
  "prop_type_cd",
  "prop_val_yr",
  "owner_name",
  "mail_line1",
  "mail_line2",
  "mail_line3",
  "mail_city",
  "mail_state",
  "mail_zip",
  "situs_address",
  "situs_city",
  "situs_zip",
  "legal_description",
  "legal_acreage",
  "appraised_value",
  "assessed_value",
  "deed_book",
  "deed_page",
  "deed_date",
  "deed_date_raw",
  "year_built",
  "latest_improvement_year",
  "roof_attributes",
];

export async function loadTcadRoll(ctx: RunContext): Promise<SourceOutcome | undefined> {
  let dir = ctx.config.tcadExportPath;
  let extractedDir: string | null = null;
  let sha: string | null = null;
  let sourceUrl: string | null = dir ? `file://${dir}` : null;
  const url = process.env.ORACLE_TCAD_EXPORT_URL;
  if (!dir && url) {
    const dl = await ctx.download(TCAD_ID, url, "tcad-export.zip");
    sha = dl.sha256;
    sourceUrl = url;
    dir = path.join(path.dirname(dl.filePath), "extract");
    await extractNeeded(dl.filePath, dir);
    extractedDir = dir;
  }
  if (!dir) return undefined;
  if ((await stat(dir)).isFile()) {
    const out = path.join(ctx.rawDir(TCAD_ID), "extract");
    await extractNeeded(dir, out);
    dir = out;
    extractedDir = out;
  }
  const files = await stageTcadExport(ctx.db, dir);
  await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_tcad AS
    WITH p AS (
      SELECT *, row_number() OVER (PARTITION BY prop_id ORDER BY try_cast(prop_val_yr AS INTEGER) DESC, try_cast(sup_num AS INTEGER) DESC) AS rn
      FROM _tcad_prop WHERE prop_id IS NOT NULL AND coalesce(prop_type_cd, 'R') IN ('R', 'MH')
    )
    SELECT ltrim(p.prop_id, '0') AS prop_id, p.geo_id, p.prop_type_cd, p.prop_val_yr, p.py_owner_name AS owner_name,
      p.py_addr_line1 AS mail_line1, p.py_addr_line2 AS mail_line2, p.py_addr_line3 AS mail_line3,
      p.py_addr_city AS mail_city, upper(p.py_addr_state) AS mail_state, p.py_addr_zip AS mail_zip,
      nullif(trim(concat_ws(' ', p.situs_street_prefx, p.situs_street, p.situs_street_suffix)), '') AS situs_address,
      p.situs_city, p.situs_zip, p.legal_desc AS legal_description,
      try_cast(p.legal_acreage AS DOUBLE) / 10000 AS legal_acreage,
      try_cast(p.appraised_val AS DOUBLE) AS appraised_value, try_cast(p.assessed_val AS DOUBLE) AS assessed_value,
      p.deed_book_id AS deed_book, p.deed_book_page AS deed_page, ${plausibleDeedDateSql("p.deed_dt")} AS deed_date, p.deed_dt AS deed_date_raw,
      i.year_built, i.latest_improvement_year, r.roof_attributes,
      ${sqlString(TCAD_ID)} AS source_id, p.prop_id AS source_record_id, ${sqlString(sourceUrl ?? "")} AS source_url,
      ${sha ? sqlString(sha) : "NULL::VARCHAR"} AS raw_sha256, now() AS collected_at
    FROM p LEFT JOIN _tcad_imp i ON ltrim(i.prop_id, '0') = ltrim(p.prop_id, '0')
      LEFT JOIN _tcad_roof r ON ltrim(r.prop_id, '0') = ltrim(p.prop_id, '0')
    WHERE p.rn = 1`);
  await ctx.db.exec(`ALTER TABLE stg_tcad ADD COLUMN record_hash VARCHAR`);
  await ctx.db.exec(`UPDATE stg_tcad SET record_hash = ${hashExpr(business)}`);
  const counts = await mergeSnapshot(ctx.db, {
    target: "tcad_properties",
    staging: "stg_tcad",
    key: "prop_id",
    runId: ctx.runId,
    fullSnapshot: true,
  });
  const stats = await ctx.db
    .one(`SELECT count(*) FILTER (WHERE deed_date IS NOT NULL) AS with_deed_date,
      count(*) FILTER (WHERE deed_date IS NULL AND deed_date_raw IS NOT NULL) AS unparsed_or_implausible_deed_dates,
      count(*) FILTER (WHERE year_built IS NOT NULL) AS with_year_built,
      count(*) FILTER (WHERE roof_attributes IS NOT NULL) AS with_roof_attributes FROM stg_tcad`);
  await ctx.db.exec(
    `DROP TABLE IF EXISTS stg_tcad; DROP TABLE IF EXISTS _tcad_prop; DROP TABLE IF EXISTS _tcad_imp; DROP TABLE IF EXISTS _tcad_roof;`,
  );
  if (extractedDir) await rm(extractedDir, { recursive: true, force: true });
  return {
    status: "ok",
    counts,
    limitation:
      "Parser follows the published True Prodigy 8.0.x export layout; field positions must be re-validated against each TCAD export release (unparsed or implausible deed dates are counted in detail; pre-1925 build years cluster on decades, i.e. appraiser estimates).",
    detail: {
      files,
      ...Object.fromEntries(Object.entries(stats ?? {}).map(([k, v]) => [k, Number(v)])),
    },
  };
}
