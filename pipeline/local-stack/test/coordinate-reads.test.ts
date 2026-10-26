// A-04 T045: postgresCoordinateReads (report-sections/gis.ts) over a fake read-only client. Each
// query is answered by its SQL text; the test proves what is asked of the Query DB (always the
// run's job id, GIS watermark by track) and how the answers are folded into CoordinateReads and
// the coordinates / gis report sections.
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  ANCHOR_GEO_IDS,
  buildCoordinatesSection,
  gisSection,
  postgresCoordinateReads,
  section,
} from "../services/report-sections/gis.js";

const JOB = "travis-a04-202610220100";
const GIS_JOB = "travis-a04-coords-202610220500";
const ASM_JOB = "travis-a04-coords-202610220600";

function fake(opts: {
  marks: Array<{ source_key: string; value: unknown }>;
  anchorsOnRoll: string[];
}) {
  const log: Array<{ text: string; values: unknown[] }> = [];
  const answer = (text: string, values: unknown[]): unknown[] => {
    if (text.includes("count(*) FILTER (WHERE prop_type = 'R')::int AS denominator_r"))
      return [{ denominator_r: 10, with_point_r: 8, non_land_account: 1, roll_count: 12 }];
    if (text.includes("coordinate_source AS k"))
      return [
        { k: "gis_centroid", n: 7 },
        { k: "none", n: 2 },
        { k: null, n: 3 },
      ];
    if (text.includes("coordinate_rule AS k"))
      return [
        { k: "centroid", n: 7 },
        { k: null, n: 5 },
      ];
    if (text.includes("coordinate_reason AS k")) return [{ k: "no_gis_feature", n: 2 }];
    if (text.includes("SELECT request_identifier, coordinate_source FROM parcels")) {
      const geo = String(values[1]);
      return opts.anchorsOnRoll.includes(geo)
        ? [{ request_identifier: `R-${geo}`, coordinate_source: "gis_centroid" }]
        : [];
    }
    if (text.includes("FROM watermarks WHERE track = 'gis'")) return opts.marks;
    throw new Error(`fake db: unexpected query ${text}`);
  };
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?").replace(/\s+/g, " ").trim();
      log.push({ text, values });
      return answer(text, values);
    },
    {
      unsafe: async (text: string, values: unknown[]) => {
        log.push({ text, values });
        return [{ coverage_r: "0.8" }];
      },
    },
  ) as unknown as postgres.Sql;
  return { sql, log };
}

const gisMark = {
  job_id: GIS_JOB,
  artifact_run_id: "39400000000",
  status: "complete",
  pages: 4,
  source_count: 20,
  duration_s: 10,
  features_per_s: 2,
  started_at: "2026-10-22T03:00:00Z",
  finished_at: "2026-10-22T03:00:10Z",
  concurrency: 2,
  layer_last_edit_date: null,
  blocked_at: null,
};

describe("postgresCoordinateReads", () => {
  it("scopes every roll read to the job, drops null groups, and finds the anchors on the roll", async () => {
    const f = fake({ marks: [], anchorsOnRoll: [ANCHOR_GEO_IDS[0]] });
    const r = await postgresCoordinateReads(f.sql, JOB);
    expect(r.coverage).toEqual({
      denominator_r: 10,
      with_point_r: 8,
      coverage_r: 0.8,
      non_land_account: 1,
      roll_count: 12,
    });
    expect(r.bySource).toEqual({ gis_centroid: 7, none: 2 });
    expect(r.byRule).toEqual({ centroid: 7 });
    expect(r.gapByReason).toEqual({ no_gis_feature: 2 });
    expect(r.anchors).toEqual([
      {
        geo_id: ANCHOR_GEO_IDS[0],
        request_identifier: `R-${ANCHOR_GEO_IDS[0]}`,
        on_roll: true,
        coordinate_source: "gis_centroid",
      },
      {
        geo_id: ANCHOR_GEO_IDS[1],
        request_identifier: null,
        on_roll: false,
        coordinate_source: null,
      },
    ]);
    expect(r.gis).toBeNull();
    expect(r.assembly).toBeNull();
    // coverage goes through the parameterised unsafe call, the rest bind the job id
    expect(f.log[0]?.values).toEqual([JOB]);
    for (const l of f.log.filter((x) => x.text.includes("FROM parcels")))
      expect(l.values).toContain(JOB);
  });

  it("reads the GIS run and assembly watermarks and feeds both report sections", async () => {
    const stats = {
      multi_feature: { pids: 1, extra_features: 2, rule: "largest_area" },
      condo_building_point: { accounts: 0, buildings: 0, rule: "condo_building_point" },
      gis_features_without_roll_account: 3,
      permit_far_from_gis: 4,
      interior_point: 5,
    };
    const f = fake({
      marks: [
        { source_key: "tcad_gis", value: gisMark },
        { source_key: "coords_assembly", value: { job_id: ASM_JOB, stats } },
      ],
      anchorsOnRoll: [],
    });
    const r = await postgresCoordinateReads(f.sql, JOB);
    expect(r.gis?.job_id).toBe(GIS_JOB);
    expect(r.assembly?.job_id).toBe(ASM_JOB);
    const coords = (await section.build(f.sql, JOB)) as Record<string, unknown>;
    expect(coords).toMatchObject({
      gis_feature_count: 20,
      roll_count: 12,
      gis_minus_roll: 8,
      permit_far_from_gis: 4,
      by_source: { gis_centroid: 7, permit_point: 0, none: 2 },
      source_jobs: [GIS_JOB, ASM_JOB],
    });
    const gis = (await gisSection.build(f.sql, JOB)) as Record<string, unknown>;
    expect(gis).toMatchObject({ complete: true, limitation: null, source_jobs: [GIS_JOB] });
    expect(buildCoordinatesSection(r).gis).toEqual(gis);
  });

  it("with no GIS run recorded, the gap is unknown and no GIS limitation is invented", async () => {
    const f = fake({ marks: [], anchorsOnRoll: [] });
    const coords = (await section.build(f.sql, JOB)) as Record<string, unknown>;
    expect(coords).toMatchObject({
      gis_feature_count: null,
      gis_minus_roll: null,
      gap_pct: "unknown",
      source_jobs: [],
    });
    expect(await gisSection.build(f.sql, JOB)).toMatchObject({
      complete: false,
      pages: 0,
      limitation: "gis: no runner artifact imported",
    });
  });
});
