import { sqlString } from "../core/db.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";

export const CENSUS_BOUNDARY_ID = "census_tiger_county";

export const censusBoundary: SourceAdapter = {
  id: CENSUS_BOUNDARY_ID,
  name: "US Census TIGERweb county boundary",
  provides: ["county_boundary"],
  async run(ctx: RunContext): Promise<SourceOutcome> {
    const { fips } = ctx.config;
    const url =
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query" +
      `?where=GEOID%3D%27${fips}%27&outFields=GEOID,NAME&returnGeometry=true&outSR=4326&f=geojson`;
    const dl = await ctx.download(CENSUS_BOUNDARY_ID, url, `county-${fips}.geojson`);
    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_county_boundary AS
      WITH f AS (SELECT * FROM ST_Read(${sqlString(dl.filePath)}))
      SELECT GEOID AS geoid, NAME AS name, geom,
        ${sqlString(CENSUS_BOUNDARY_ID)} AS source_id, GEOID AS source_record_id,
        ${sqlString(url)} AS source_url, ${sqlString(dl.sha256)} AS raw_sha256,
        ${sqlString(dl.fetchedAt)}::TIMESTAMPTZ AS collected_at,
        ${hashExpr(["GEOID", "NAME", "ST_AsText(geom)"])} AS record_hash
      FROM f`);
    const counts = await mergeSnapshot(ctx.db, {
      target: "county_boundary",
      staging: "stg_county_boundary",
      key: "geoid",
      runId: ctx.runId,
      fullSnapshot: false,
    });
    if (counts.recordsSeen !== 1)
      throw new Error(`expected exactly one county polygon for ${fips}, got ${counts.recordsSeen}`);
    return { status: "ok", counts, detail: { url, sha256: dl.sha256 } };
  },
};
