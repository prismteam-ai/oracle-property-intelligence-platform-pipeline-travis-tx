import { sqlString } from "../core/db.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";
import { CENSUS_BOUNDARY_ID } from "./census-boundary.js";

export const CENSUS_PLACES_ID = "census_tiger_places";
const LAYER_BASE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer";
const LAYERS: { id: number; kind: string }[] = [
  { id: 4, kind: "incorporated_place" },
  { id: 5, kind: "census_designated_place" },
];

export const censusPlaces: SourceAdapter = {
  id: CENSUS_PLACES_ID,
  name: "US Census TIGERweb places (city/CDP centroids for geocoding)",
  provides: ["geo_places"],
  dependsOn: [CENSUS_BOUNDARY_ID],
  async run(ctx: RunContext): Promise<SourceOutcome> {
    const bbox = await ctx.db.one<{ xmin: number; ymin: number; xmax: number; ymax: number }>(`
      SELECT ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax
      FROM county_boundary WHERE geoid = ${sqlString(ctx.config.fips)}`);
    if (!bbox) throw new Error("county boundary must be loaded before census places");
    const stateFips = ctx.config.fips.slice(0, 2);
    const parts: string[] = [];
    for (const layer of LAYERS) {
      const url =
        `${LAYER_BASE}/${layer.id}/query?where=STATE%3D%27${stateFips}%27` +
        `&geometry=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}&geometryType=esriGeometryEnvelope&inSR=4326` +
        `&spatialRel=esriSpatialRelIntersects&outFields=GEOID,NAME,BASENAME,INTPTLAT,INTPTLON&returnGeometry=false&f=json`;
      const dl = await ctx.download(CENSUS_PLACES_ID, url, `layer-${layer.id}.json`);
      parts.push(`SELECT f.attributes.GEOID::VARCHAR AS geoid, f.attributes.NAME::VARCHAR AS name,
          f.attributes.BASENAME::VARCHAR AS basename, ${sqlString(layer.kind)} AS place_kind,
          try_cast(f.attributes.INTPTLAT AS DOUBLE) AS latitude, try_cast(f.attributes.INTPTLON AS DOUBLE) AS longitude,
          ${sqlString(url)} AS source_url, ${sqlString(dl.sha256)} AS raw_sha256,
          ${sqlString(dl.fetchedAt)}::TIMESTAMPTZ AS collected_at
        FROM (SELECT unnest(features) AS f FROM read_json(${sqlString(dl.filePath)},
          columns = {features: 'STRUCT(attributes STRUCT(GEOID VARCHAR, NAME VARCHAR, BASENAME VARCHAR, INTPTLAT VARCHAR, INTPTLON VARCHAR))[]'}))`);
    }
    const business = ["geoid", "name", "basename", "place_kind", "latitude", "longitude"];
    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_geo_places AS
      SELECT *, ${sqlString(CENSUS_PLACES_ID)} AS source_id, geoid AS source_record_id, ${hashExpr(business)} AS record_hash
      FROM (${parts.join(" UNION ALL ")})`);
    const counts = await mergeSnapshot(ctx.db, {
      target: "geo_places",
      staging: "stg_geo_places",
      key: "geoid",
      runId: ctx.runId,
      fullSnapshot: true,
    });
    await ctx.db.exec(`DROP TABLE IF EXISTS stg_geo_places`);
    return { status: "ok", counts };
  },
};
