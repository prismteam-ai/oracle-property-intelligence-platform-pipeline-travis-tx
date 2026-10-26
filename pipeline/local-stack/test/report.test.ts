// A-04 T009: BackboneReport combines every report-sections/*.ts into BackboneReportV1
// (contracts/report.md) with job_id, as_of and limitations[] from source_limitations; refuses
// private keys; `running` answers the running job or null (FR-025). Synthetic store only.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  BackboneReportV1,
  buildReport,
  findForbiddenKey,
  loadSections,
  SECTIONS_DIR,
  runningJob,
  type ReportStore,
} from "../services/report.js";

const SECTIONS = fileURLToPath(new URL("./fixtures/report-sections/", import.meta.url));
const MULTI = fileURLToPath(new URL("./fixtures/report-sections-multi/", import.meta.url));
const BAD = fileURLToPath(new URL("./fixtures/report-sections-bad/", import.meta.url));
const JOB = "travis-a04-202610220100";
const noSql = {} as postgres.Sql;

function store(over: Partial<ReportStore> = {}): ReportStore {
  return {
    run: async (jobId) => (jobId === JOB ? { as_of: "2026-10-22", code_sha: "abc1234" } : null),
    limitations: async (jobIds: string[]) =>
      [
        "Confidential owner records redacted (Texas Tax Code §25.025): 3",
        "gis: blocked at 2026-10-22T03:00:00Z; coverage not complete",
      ].map((text) => ({ job_id: jobIds[0] ?? JOB, text })),
    running: async () => null,
    ...over,
  };
}

describe("A-04 BackboneReport", () => {
  it("combines every section into BackboneReportV1 with job_id, as_of and limitations", async () => {
    const report = await buildReport(store(), noSql, await loadSections(SECTIONS), JOB);
    expect(BackboneReportV1.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      job_id: JOB,
      as_of: "2026-10-22",
      code_sha: "abc1234",
      roll: { n: 3, loaded: 3, source_job: JOB },
      permits: { linked: 2 },
    });
    expect(report.limitations).toEqual([
      "Confidential owner records redacted (Texas Tax Code §25.025): 3",
      "gis: blocked at 2026-10-22T03:00:00Z; coverage not complete",
    ]);
  });

  it("loads every `section`, `sections` and `*Section` export once per key", async () => {
    const loaded = await loadSections(MULTI);
    expect([...loaded.keys()].sort()).toEqual(["coordinates", "gis", "jurisdictions"]);
  });

  it("the bundled report-sections load all seven keys (TCAD, GIS, permits, A-07 identity)", async () => {
    const loaded = await loadSections(SECTIONS_DIR);
    expect([...loaded.keys()].sort()).toEqual(
      ["confidentiality", "coordinates", "gis", "identity", "jurisdictions", "permits", "roll"],
    );
  });

  it("limitations include every job in source_jobs, keeping each job id", async () => {
    const seen: string[][] = [];
    const sections = new Map([
      ["permits" as const, { key: "permits" as const, build: async () => ({ source_jobs: [JOB, "travis-a04-permits-incremental-1"] }) }],
      ["coordinates" as const, { key: "coordinates" as const, build: async () => ({ source_jobs: ["travis-a04-coords-1", JOB] }) }],
    ]);
    const report = await buildReport(
      store({
        limitations: async (jobIds: string[]) => {
          seen.push(jobIds);
          return jobIds.map((job_id) => ({ job_id, text: `limit from ${job_id}` }));
        },
      }),
      noSql,
      sections,
      JOB,
    );
    expect(seen[0]).toEqual([JOB, "travis-a04-coords-1", "travis-a04-permits-incremental-1"]);
    expect(report.limitations).toEqual(seen[0]!.map((j) => `limit from ${j}`));
    expect(report.limitation_jobs).toEqual(seen[0]!.map((job_id) => ({ job_id, text: `limit from ${job_id}` })));
  });

  it("refuses an unknown job", async () => {
    await expect(buildReport(store(), noSql, new Map(), "travis-a04-nope")).rejects.toThrow(/unknown job/);
  });

  it("rejects any key matching owner_name, mailing or payload", async () => {
    await expect(buildReport(store(), noSql, await loadSections(BAD), JOB)).rejects.toThrow(
      /owner_name/,
    );
    expect(findForbiddenKey({ a: [{ b: { mailing_city: 1 } }] })).toBe("a[0].b.mailing_city");
    expect(findForbiddenKey({ source_payload: 1 })).toBe("source_payload");
    expect(findForbiddenKey({ redacted: 1, rule: "sales_confidential_code" })).toBeNull();
  });

  it("running returns the running job, or null (FR-025)", async () => {
    expect(await runningJob(store())).toBeNull();
    const r = await runningJob(
      store({
        running: async () => ({ job_id: JOB, track: "appraisal", mode: "full", started_at: "2026-10-22T01:00:00Z" }),
      }),
    );
    expect(r).toEqual({ job_id: JOB, track: "appraisal", mode: "full", started_at: "2026-10-22T01:00:00Z" });
  });
});
