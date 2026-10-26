// A-07 T056/T057 follow-up (coverage gap, 2026-10-23): `ReconcileReport` (services/workflows/
// reconcile-report.ts) had zero unit tests. A scripted postgres.js stand-in records every
// statement (no database).
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createReconcileReport, loadReconcileSummary } from "../../services/workflows/reconcile-report.js";
import { QueryDbConfigError } from "../../services/loader.js";

function fakeSql(answer: (text: string, values: unknown[]) => unknown[]) {
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$?").replace(/\s+/g, " ").trim();
    return answer(text, values);
  }) as unknown as postgres.Sql;
  return fn;
}

describe("loadReconcileSummary", () => {
  it("reads the current merge/refusal state per entity type, keeping job_id/counts separate per type", async () => {
    const sql = fakeSql((text) => {
      if (text.startsWith("SELECT entity_type, min(job_id)")) {
        return [
          { entity_type: "property", job_id: "travis-a07-reconcile-j1", canonical: 493_246, input_records: 1_001_321 },
          { entity_type: "owner", job_id: "travis-a07-reconcile-j2", canonical: 493_246, input_records: 1_001_321 },
        ];
      }
      if (text.startsWith("SELECT entity_type, cluster_id")) return [];
      return [];
    });
    const summary = await loadReconcileSummary(sql);
    expect(summary.property).toEqual({ jobId: "travis-a07-reconcile-j1", inputRecords: 1_001_321, canonical: 493_246, refused: 0 });
    expect(summary.owner).toEqual({ jobId: "travis-a07-reconcile-j2", inputRecords: 1_001_321, canonical: 493_246, refused: 0 });
    // contractor never merged this pass (no resolved companies yet): the empty default, not a crash.
    expect(summary.contractor).toEqual({ jobId: null, inputRecords: 0, canonical: 0, refused: 0 });
    expect(summary.refusedMerges).toEqual([]);
  });

  it("counts refusals per entity type and lists each one's TCAD ids and reason", async () => {
    const sql = fakeSql((text) => {
      if (text.startsWith("SELECT entity_type, min(job_id)")) return [];
      if (text.startsWith("SELECT entity_type, cluster_id")) {
        return [
          { entity_type: "property", cluster_id: "bad-1", tcad_ids: ["1", "2"], reason: "cross_tcad_id", job_id: "j1", n: 1 },
          { entity_type: "property", cluster_id: "bad-2", tcad_ids: ["3", "4"], reason: "cross_tcad_id", job_id: "j1", n: 1 },
        ];
      }
      return [];
    });
    const summary = await loadReconcileSummary(sql);
    expect(summary.property.refused).toBe(2);
    expect(summary.owner.refused).toBe(0);
    expect(summary.refusedMerges).toEqual([
      { entityType: "property", clusterId: "bad-1", tcadIds: ["1", "2"], reason: "cross_tcad_id" },
      { entityType: "property", clusterId: "bad-2", tcadIds: ["3", "4"], reason: "cross_tcad_id" },
    ]);
  });
});

describe("createReconcileReport (Restate wiring)", () => {
  it("names the service ReconcileReport and the summary handler reaches loadReconcileSummary", async () => {
    const sql = fakeSql(() => []);
    const def = createReconcileReport(restate, { sql: () => sql });
    expect(def.name).toBe("ReconcileReport");
    const handler = (def as unknown as { service: { summary: (c: unknown) => Promise<unknown> } }).service.summary;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const result = await handler(ctx);
    expect(result).toMatchObject({ property: { jobId: null, canonical: 0 } });
  });

  it("turns a missing DATABASE_URL into a TerminalError, not a crash", async () => {
    const def = createReconcileReport(restate, {
      sql: () => {
        throw new QueryDbConfigError("DATABASE_URL is not set");
      },
    });
    const handler = (def as unknown as { service: { summary: (c: unknown) => Promise<unknown> } }).service.summary;
    const ctx = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const err = await handler(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(restate.TerminalError);
  });
});
