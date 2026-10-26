// A-03 T064 (G-C2a): `query.radius` and `query.roofAge` per contracts/api.md, the two queries
// ADR-0001 moved to the Lambda DuckDB fallback. Inputs are Zod-bounded (lat −90…90, lon
// −180…180, miles (0, 25], limit 1…1000 default 500, minYears 1…100); the SQL is exactly the
// query-core builders' text (AD-19); `as_of` is the bound manifest's finishedAt, never now();
// results are ≤ 1,000 rows (AD-21). No A-03 page calls these (the Explorer is A-13); they exist
// so the fallback is deployed and measured.
import { z } from "zod";
import { CidV1 } from "@countylens/contract";
import {
  DEFAULT_LIMIT,
  MAX_ROWS,
  radiusSql,
  roofAgeSql,
  viewsReadBy,
} from "@countylens/query-core";
import { bindOnce, timedQuery, type TimedRows } from "../engine/duckdb-node.js";
import { publicProcedure, router } from "../trpc.js";

export const RadiusInput = z.object({
  manifestCid: CidV1,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  miles: z.number().gt(0).max(25),
  limit: z.number().int().min(1).max(MAX_ROWS).default(DEFAULT_LIMIT),
});

export const RoofAgeInput = RadiusInput.extend({
  minYears: z.number().int().min(1).max(100),
});

export const queryRouter = router({
  radius: publicProcedure.input(RadiusInput).query(async ({ input }): Promise<TimedRows> => {
    const { manifestCid, ...params } = input;
    const sql = radiusSql(params);
    const bound = await bindOnce(manifestCid, viewsReadBy(sql)); // ERR-19: its views only
    return timedQuery(sql, { name: "radiusSql", manifestCid: bound.manifestCid });
  }),

  roofAge: publicProcedure.input(RoofAgeInput).query(async ({ input }): Promise<TimedRows> => {
    const { manifestCid, ...params } = input;
    // roofAgeSql's text needs as_of from the bound run; the views it reads do not depend on it.
    const views = viewsReadBy(roofAgeSql({ ...params, asOf: "1970-01-01T00:00:00.000Z" }));
    const bound = await bindOnce(manifestCid, views); // ERR-19: its views only
    return timedQuery(roofAgeSql({ ...params, asOf: bound.asOf }), {
      name: "roofAgeSql",
      manifestCid: bound.manifestCid,
    });
  }),
});
