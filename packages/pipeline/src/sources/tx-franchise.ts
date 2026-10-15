import { sqlString } from "../core/db.js";
import { log } from "../core/log.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";
import { nameKeySql } from "../model/names.js";

export const TX_FRANCHISE_ID = "tx_comptroller_active_franchise_taxpayers";
const BASE = "https://data.texas.gov/resource/9cir-efmm.csv";
const PAGE_SIZE = 200_000;
export const TRAVIS_COMPTROLLER_COUNTY_CODE = "227";

export const txFranchise: SourceAdapter = {
  id: TX_FRANCHISE_ID,
  name: "Texas Comptroller Active Franchise Taxpayers (data.texas.gov 9cir-efmm)",
  provides: ["businesses"],
  async run(ctx: RunContext): Promise<SourceOutcome> {
    const where = encodeURIComponent(`taxpayer_county_code='${TRAVIS_COMPTROLLER_COUNTY_CODE}'`);
    const headers: Record<string, string> = ctx.config.socrataAppToken
      ? { "x-app-token": ctx.config.socrataAppToken }
      : {};
    const pages: { url: string; path: string; sha256: string }[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const url = `${BASE}?$where=${where}&$order=taxpayer_number&$limit=${PAGE_SIZE}&$offset=${offset}`;
      const dl = await ctx.download(
        TX_FRANCHISE_ID,
        url,
        `page-${String(offset / PAGE_SIZE).padStart(4, "0")}.csv`,
        headers,
      );
      const rows = Number(
        await ctx.db.scalar(
          `SELECT count(*) FROM read_csv(${sqlString(dl.filePath)}, header = true, all_varchar = true)`,
        ),
      );
      log.info("franchise_page", { offset, rows });
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
    const business = [
      "taxpayer_number",
      "name",
      "address",
      "city",
      "state",
      "zip",
      "county_code",
      "organization_type",
      "sos_file_number",
      "sos_charter_date",
      "sos_status_code",
      "right_to_transact_code",
      "responsibility_begin_date",
    ];
    const d = (c: string) => `try_cast(nullif(${c}, '') AS TIMESTAMP)::DATE`;
    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_businesses AS
      WITH b AS (
        SELECT trim(taxpayer_number) AS taxpayer_number,
          nullif(trim(taxpayer_name), '') AS name,
          nullif(trim(taxpayer_address), '') AS address,
          nullif(trim(taxpayer_city), '') AS city,
          nullif(trim(taxpayer_state), '') AS state,
          nullif(trim(taxpayer_zip), '') AS zip,
          nullif(trim(taxpayer_county_code), '') AS county_code,
          nullif(trim(taxpayer_organizational_type), '') AS organization_type,
          nullif(trim(secretary_of_state_sos_or_coa_file_number), '') AS sos_file_number,
          ${d("sos_charter_date")} AS sos_charter_date,
          nullif(trim(sos_status_code), '') AS sos_status_code,
          nullif(trim(right_to_transact_business_code), '') AS right_to_transact_code,
          ${d("responsibility_beginning_date")} AS responsibility_begin_date,
          CASE ${shaByFile} END AS raw_sha256,
          CASE ${urlByFile} END AS source_url
        FROM read_csv(${files}, header = true, all_varchar = true, filename = true, union_by_name = true)
        WHERE nullif(trim(taxpayer_number), '') IS NOT NULL
      )
      SELECT ${business.join(", ")}, ${nameKeySql("name")} AS name_key,
        ${sqlString(TX_FRANCHISE_ID)} AS source_id, taxpayer_number AS source_record_id,
        source_url, raw_sha256, now() AS collected_at, ${hashExpr(business)} AS record_hash
      FROM b`);
    const counts = await mergeSnapshot(ctx.db, {
      target: "businesses",
      staging: "stg_businesses",
      key: "taxpayer_number",
      runId: ctx.runId,
      fullSnapshot: true,
    });
    await ctx.db.exec(`DROP TABLE IF EXISTS stg_businesses`);
    return {
      status: "ok",
      counts,
      limitation:
        "Active franchise taxpayers only (county code 227 = Travis). Sole proprietors and inactive entities are not in this dataset; Texas has no statewide roofing-contractor license registry.",
      detail: { pages: pages.length },
    };
  },
};
