import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sqlString } from "../core/db.js";
import { fetchJson } from "../core/http.js";
import { log } from "../core/log.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";

const run = promisify(execFile);

export const STRATMAP_ID = "txgio_stratmap_parcels";

type TxgioCollection = { collection_id: string; name: string; acquisition_date: string };
type TxgioResource = { resource: string; filesize: number; area_type_name: string };

const API = "https://api.tnris.org/api/v1";

export async function resolveLatestParcelResource(
  ctx: RunContext,
  countyName: string,
): Promise<{ url: string; collectionId: string; acquisitionDate: string; filesize: number }> {
  const cols = await fetchJson<{ results: TxgioCollection[] }>(
    `${API}/collections/?search=stratmap%20land%20parcels`,
    ctx.http,
  );
  const sorted = cols.results
    .filter((c) => c.name === "Land Parcels")
    .sort((a, b) => b.acquisition_date.localeCompare(a.acquisition_date));
  for (const c of sorted) {
    const res = await fetchJson<{ results: TxgioResource[] }>(
      `${API}/resources/?collection_id=${c.collection_id}&limit=500`,
      ctx.http,
    );
    const hit = res.results.find(
      (r) => r.area_type_name.toLowerCase() === countyName.toLowerCase(),
    );
    if (hit)
      return {
        url: hit.resource,
        collectionId: c.collection_id,
        acquisitionDate: c.acquisition_date,
        filesize: hit.filesize,
      };
  }
  throw new Error(`no StratMap land-parcel resource found for ${countyName}`);
}

const businessColumns = [
  "prop_id",
  "geo_id",
  "owner_name",
  "owner_care_of",
  "legal_description",
  "land_use_state_code",
  "land_use_local_code",
  "land_value",
  "improvement_value",
  "market_value",
  "situs_address",
  "situs_number",
  "situs_street",
  "situs_city",
  "situs_state",
  "situs_zip",
  "mail_address",
  "mail_line1",
  "mail_line2",
  "mail_city",
  "mail_state",
  "mail_zip",
  "legal_area",
  "legal_area_unit",
  "gis_area",
  "gis_area_unit",
  "tax_year",
  "year_built",
  "latitude",
  "longitude",
];

export const stratmapParcels: SourceAdapter = {
  id: STRATMAP_ID,
  name: "TxGIO StratMap Land Parcels (TCAD-contributed)",
  provides: ["parcels", "parcel_geometries"],
  async run(ctx: RunContext): Promise<SourceOutcome> {
    const countyName = ctx.config.county.charAt(0).toUpperCase() + ctx.config.county.slice(1);
    const resource = await resolveLatestParcelResource(ctx, countyName);
    const prev = await ctx.previousArtifact(STRATMAP_ID, resource.url);
    const zipName = path.basename(new URL(resource.url).pathname);
    const dl = await ctx.download(STRATMAP_ID, resource.url, zipName, {
      referer: "https://data.geographic.texas.gov/",
    });
    const detail = {
      url: resource.url,
      acquisitionDate: resource.acquisitionDate,
      sha256: dl.sha256,
      bytes: dl.bytes,
    };
    if (prev && prev.sha256 === dl.sha256 && ctx.mode === "incremental") {
      log.info("stratmap_unchanged", detail);
      await ctx.db.exec(
        `UPDATE parcels SET last_seen_run = ${sqlString(ctx.runId)} WHERE NOT is_deleted`,
      );
      const seen = Number(await ctx.db.scalar(`SELECT count(*) FROM parcels WHERE NOT is_deleted`));
      return {
        status: "unchanged",
        counts: { recordsSeen: seen, inserted: 0, updated: 0, unchanged: seen, deleted: 0 },
        detail,
      };
    }

    const extractDir = path.join(path.dirname(dl.filePath), "extract");
    await run("unzip", [
      "-o",
      "-q",
      dl.filePath,
      "*.shp",
      "*.shx",
      "*.dbf",
      "*.prj",
      "*.cpg",
      "-d",
      extractDir,
    ]);
    const shp = await findFile(extractDir, ".shp");
    const src = sqlString(STRATMAP_ID);

    await ctx.db.exec(
      `CREATE OR REPLACE TEMP TABLE _sm AS SELECT * FROM ST_Read(${sqlString(shp)})`,
    );
    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_parcels AS
      WITH b AS (
        SELECT
          trim(PROP_ID) AS prop_id,
          nullif(trim(GEO_ID), '') AS geo_id,
          nullif(trim(OWNER_NAME), '') AS owner_name,
          nullif(trim(NAME_CARE), '') AS owner_care_of,
          nullif(trim(LEGAL_DESC), '') AS legal_description,
          nullif(trim(STAT_LAND_), '') AS land_use_state_code,
          nullif(trim(LOC_LAND_U), '') AS land_use_local_code,
          LAND_VALUE AS land_value,
          IMP_VALUE AS improvement_value,
          try_cast(MKT_VALUE AS DOUBLE) AS market_value,
          nullif(trim(SITUS_ADDR), '') AS situs_address,
          nullif(trim(SITUS_NUM), '') AS situs_number,
          nullif(trim(concat_ws(' ', nullif(trim(SITUS_STRE), ''), nullif(trim(SITUS_ST_1), ''), nullif(trim(SITUS_ST_2), ''))), '') AS situs_street,
          nullif(trim(SITUS_CITY), '') AS situs_city,
          nullif(trim(SITUS_STAT), '') AS situs_state,
          nullif(trim(SITUS_ZIP), '') AS situs_zip,
          nullif(trim(MAIL_ADDR), '') AS mail_address,
          nullif(trim(MAIL_LINE1), '') AS mail_line1,
          nullif(trim(MAIL_LINE2), '') AS mail_line2,
          nullif(trim(MAIL_CITY), '') AS mail_city,
          nullif(upper(trim(MAIL_STAT)), '') AS mail_state,
          nullif(trim(MAIL_ZIP), '') AS mail_zip,
          LEGAL_AREA AS legal_area,
          nullif(trim(LGL_AREA_U), '') AS legal_area_unit,
          GIS_AREA AS gis_area,
          nullif(trim(GIS_AREA_U), '') AS gis_area_unit,
          nullif(trim(TAX_YEAR), '') AS tax_year,
          CASE WHEN try_cast(YEAR_BUILT AS INTEGER) BETWEEN 1800 AND 2100 THEN try_cast(YEAR_BUILT AS INTEGER) END AS year_built,
          ST_Y(ST_PointOnSurface(geom)) AS latitude,
          ST_X(ST_PointOnSurface(geom)) AS longitude,
          geom
        FROM _sm
        WHERE nullif(trim(PROP_ID), '') IS NOT NULL
      )
      SELECT * EXCLUDE (geom),
        ${src} AS source_id, prop_id AS source_record_id,
        ${sqlString(resource.url)} AS source_url, ${sqlString(dl.sha256)} AS raw_sha256,
        ${sqlString(dl.fetchedAt)}::TIMESTAMPTZ AS collected_at,
        ${hashExpr(businessColumns)} AS record_hash,
        geom
      FROM b
      QUALIFY row_number() OVER (PARTITION BY prop_id ORDER BY ST_Area(geom) DESC) = 1`);

    await ctx.db.exec(
      `CREATE OR REPLACE TEMP TABLE stg_parcels_only AS SELECT * EXCLUDE (geom) FROM stg_parcels`,
    );
    const counts = await mergeSnapshot(ctx.db, {
      target: "parcels",
      staging: "stg_parcels_only",
      key: "prop_id",
      runId: ctx.runId,
      fullSnapshot: true,
    });
    await ctx.db.exec(`CREATE OR REPLACE TABLE parcel_geometries AS
      SELECT prop_id, geom, md5(ST_AsText(geom)) AS record_hash FROM stg_parcels`);
    const rawRows = Number(await ctx.db.scalar(`SELECT count(*) FROM _sm`));
    await ctx.db.exec(
      `DROP TABLE IF EXISTS _sm; DROP TABLE IF EXISTS stg_parcels; DROP TABLE IF EXISTS stg_parcels_only;`,
    );
    await rm(extractDir, { recursive: true, force: true });
    return {
      status: "ok",
      counts,
      limitation:
        "StratMap Travis export carries no year_built, deed/sale date or improvement detail; those require the TCAD appraisal export (US egress).",
      detail: { ...detail, rawRows, duplicatePropIdsCollapsed: rawRows - counts.recordsSeen },
    };
  },
};

async function findFile(dir: string, ext: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith(ext));
  if (!hit) throw new Error(`no ${ext} file under ${dir}`);
  return path.join(hit.parentPath, hit.name);
}
