import { sqlString } from "../core/db.js";
import { fetchJson } from "../core/http.js";
import { hashExpr, mergeSnapshot } from "../core/merge.js";
import type { RunContext, SourceAdapter, SourceOutcome } from "../core/run.js";
import { nameKeySql } from "../model/names.js";
import { CENSUS_BOUNDARY_ID } from "./census-boundary.js";

export const OVERTURE_PLACES_ID = "overture_places";
const BLOCKED_SOURCE_DATASETS = ["osm"];

export const overturePlaces: SourceAdapter = {
  id: OVERTURE_PLACES_ID,
  name: "Overture Maps places (county-clipped)",
  provides: ["places"],
  dependsOn: [CENSUS_BOUNDARY_ID],
  async run(ctx: RunContext): Promise<SourceOutcome> {
    const release =
      ctx.config.overtureRelease ??
      (await fetchJson<{ latest: string }>("https://stac.overturemaps.org/catalog.json", ctx.http))
        .latest;
    const s3 = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;
    await ctx.db.exec(`SET s3_region = 'us-west-2'`);
    const bbox = await ctx.db.one<{ xmin: number; ymin: number; xmax: number; ymax: number }>(`
      SELECT ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax
      FROM county_boundary WHERE geoid = ${sqlString(ctx.config.fips)}`);
    if (!bbox) throw new Error("county boundary must be loaded before Overture places");

    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE _ov AS
      SELECT * FROM read_parquet(${sqlString(s3)}, hive_partitioning = 1)
      WHERE bbox.xmin BETWEEN ${bbox.xmin} AND ${bbox.xmax} AND bbox.ymin BETWEEN ${bbox.ymin} AND ${bbox.ymax}`);
    const bboxCount = Number(await ctx.db.scalar(`SELECT count(*) FROM _ov`));

    const business = [
      "place_id",
      "name",
      "taxonomy_primary",
      "taxonomy_hierarchy",
      "basic_category",
      "confidence",
      "latitude",
      "longitude",
      "address",
      "locality",
      "postcode",
      "phone",
      "website",
      "source_datasets",
    ];
    await ctx.db.exec(`CREATE OR REPLACE TEMP TABLE stg_places AS
      WITH c AS (SELECT geom FROM county_boundary WHERE geoid = ${sqlString(ctx.config.fips)}),
      b AS (
        SELECT o.id AS place_id,
          o.names.primary AS name,
          o.taxonomy.primary AS taxonomy_primary,
          o.taxonomy.hierarchy AS taxonomy_hierarchy,
          o.basic_category AS basic_category,
          o.confidence AS confidence,
          ST_Y(o.geometry) AS latitude,
          ST_X(o.geometry) AS longitude,
          o.addresses[1].freeform AS address,
          o.addresses[1].locality AS locality,
          o.addresses[1].postcode AS postcode,
          o.phones[1] AS phone,
          o.websites[1] AS website,
          list_distinct([lower(s.dataset) FOR s IN o.sources]) AS source_datasets
        FROM _ov o, c
        WHERE ST_Within(o.geometry, c.geom)
      )
      SELECT ${business.join(", ")}, ${nameKeySql("name")} AS name_key, ${sqlString(release)} AS overture_release,
        ${sqlString(OVERTURE_PLACES_ID)} AS source_id, place_id AS source_record_id,
        ${sqlString(s3)} AS source_url, NULL::VARCHAR AS raw_sha256, now() AS collected_at,
        ${hashExpr(business)} AS record_hash
      FROM b
      WHERE NOT list_has_any(source_datasets, [${BLOCKED_SOURCE_DATASETS.map(sqlString).join(", ")}])`);
    const excludedByLicence = Number(
      await ctx.db
        .scalar(`SELECT count(*) FROM _ov o, (SELECT geom FROM county_boundary WHERE geoid = ${sqlString(ctx.config.fips)}) c
        WHERE ST_Within(o.geometry, c.geom) AND list_has_any(list_distinct([lower(s.dataset) FOR s IN o.sources]), [${BLOCKED_SOURCE_DATASETS.map(sqlString).join(", ")}])`),
    );
    const counts = await mergeSnapshot(ctx.db, {
      target: "places",
      staging: "stg_places",
      key: "place_id",
      runId: ctx.runId,
      fullSnapshot: true,
    });
    await ctx.db.exec(`DROP TABLE IF EXISTS _ov; DROP TABLE IF EXISTS stg_places;`);
    return {
      status: "ok",
      counts,
      outOfScope: bboxCount - counts.recordsSeen - excludedByLicence,
      limitation:
        "Overture supplies business locations/categories only (numerator, no authoritative denominator). Rows sourced from OSM are excluded at the licence gate.",
      detail: { release, bboxCount, excludedByLicence },
    };
  },
};
