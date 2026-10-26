// A-11 Run 3: scripts/incremental-facts.ts. No DB: the SQL tag is a recorder that answers from a
// script, so the tests check which counts become which fact and that the queries are read-only.
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  buildFacts,
  jobCounts,
  jobPids,
  permitLinkTotals,
  readWatermark,
} from "../scripts/incremental-facts.js";

type Answer = unknown[];

/** A tagged-template stand-in for `postgres`: answers the queries in order, records their text. */
function fakeSql(answers: Answer[]): { sql: postgres.Sql; queries: string[] } {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return Promise.resolve(answers.shift() ?? []);
  }) as unknown as postgres.Sql;
  return { sql, queries };
}

const JOB = "travis-a04-permits-incremental-20261026010203";
const WM = {
  maxUpdatedAt: "2026-10-24T14:51:37.805Z",
  endTotal: 2381886,
  rows: 2381886,
  mode: "incremental",
  jobId: JOB,
  finishedAt: "2026-10-26T01:30:00.000Z",
  watermarkCheck: "pass",
  restamp: { detected: true },
};
const LINK = {
  linkedPermits: 2381678,
  permits_no_tcad_geoid: 110,
  permits_no_tcad_id: 21,
  permits_ambiguous_geoid: 31,
  permits_address_unmatched: 41,
  permits_ambiguous_address: 5,
};
const BASE = { watermark: "2026-10-21T14:42:23.154Z", records: 2381226 };

describe("jobCounts", () => {
  it("splits the job's stored permits by previous digest and counts its tombstones", async () => {
    const { sql, queries } = fakeSql([[{ added: "660", changed: "3" }], [{ n: "2" }]]);
    expect(await jobCounts(sql, JOB)).toEqual({ added: 660, changed: 3, removed: 2 });
    expect(queries.join("\n")).toMatch(/previous_content_sha256 IS NULL/);
    expect(queries.every((q) => /^\s*SELECT/i.test(q))).toBe(true);
  });
});

describe("jobPids", () => {
  it("returns the linked pIDs of the job's rows and tombstones, dropping anything that is not a pID", async () => {
    const { sql, queries } = fakeSql([
      [{ request_identifier: "100027" }, { request_identifier: "0123" }, { request_identifier: "x" }],
    ]);
    expect(await jobPids(sql, JOB)).toEqual(["100027"]);
    expect(queries[0]).toMatch(/source_tombstones/);
  });
});

describe("permitLinkTotals", () => {
  const row = {
    linked: "2381678",
    no_tcad_geoid: "110",
    no_tcad_id: "21",
    ambiguous_geoid: "31",
    address_unmatched: "41",
    ambiguous_address: "5",
    unclassified: "0",
  };
  it("reads the five exclusion reasons and the linked total of live permits", async () => {
    const { sql, queries } = fakeSql([[row]]);
    expect(await permitLinkTotals(sql)).toEqual(LINK);
    expect(queries[0]).toMatch(/NOT tombstoned/);
  });
  it("refuses to count before the link step has run over every permit", async () => {
    const { sql } = fakeSql([[{ ...row, unclassified: "660" }]]);
    await expect(permitLinkTotals(sql)).rejects.toThrow(/run "backbone permits --link" first/);
  });
});

describe("readWatermark", () => {
  it("refuses when no Austin watermark exists", async () => {
    const { sql } = fakeSql([[]]);
    await expect(readWatermark(sql)).rejects.toThrow(/no Austin permits watermark/);
  });
});

describe("buildFacts", () => {
  const counts = { added: 660, changed: 3, removed: 0 };
  it("turns the watermark, the job counts and the link totals into the facts", () => {
    const f = buildFacts({ job: JOB, base: BASE, wm: WM, counts, permitLink: LINK });
    expect(f).toMatchObject({
      watermarkUsed: BASE.watermark,
      watermarkNew: WM.maxUpdatedAt,
      recordsRead: 2381886,
      totalBefore: 2381226,
      totalAfter: 2381886,
      mode: "full_pass",
      restampDetected: true,
      removalDetection: "keyset_diff",
      unchanged: 2381223,
      delta: counts,
    });
  });
  it("a narrow window did not look for removals", () => {
    const f = buildFacts({
      job: JOB,
      base: BASE,
      wm: { ...WM, restamp: { detected: false }, rows: 700, endTotal: 2381886 },
      counts,
      permitLink: LINK,
    });
    expect(f).toMatchObject({ mode: "window", removalDetection: "not_checked", unchanged: 37 });
  });
  it("refuses a watermark written by another job, a failed check and a pilot", () => {
    const t = (wm: object) => () =>
      buildFacts({ job: JOB, base: BASE, wm: { ...WM, ...wm }, counts, permitLink: LINK });
    expect(t({ jobId: "travis-a04-permits-backfill-1" })).toThrow(/not by/);
    expect(t({ watermarkCheck: "fail" })).toThrow(/count check failed/);
    expect(t({ mode: "pilot" })).toThrow(/pilot/);
    expect(t({ maxUpdatedAt: null })).toThrow(/no maxUpdatedAt/);
  });
  it("refuses a base with no watermark", () => {
    expect(() =>
      buildFacts({
        job: JOB,
        base: { watermark: null, records: 1 },
        wm: WM,
        counts,
        permitLink: LINK,
      }),
    ).toThrow(/no Austin watermark/);
  });
});
