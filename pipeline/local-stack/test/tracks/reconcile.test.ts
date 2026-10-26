// A-07 T056/T057 follow-up (coverage gap, 2026-10-23): the Loader `reconcile` track
// (services/tracks/reconcile.ts) had zero unit tests — only proven live against the real
// database. A scripted postgres.js stand-in records every statement (no database), following
// Track A's comptroller track test pattern (test/tracks/comptroller.test.ts, T016).
import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { clustersFromLoadedRows, track } from "../../services/tracks/reconcile.js";

const JOB = "travis-a07-reconcile-202610230000";

interface Query {
  text: string;
  values: unknown[];
}

function fakeTx(answer: (text: string, values: unknown[]) => unknown[] = () => []) {
  const queries: Query[] = [];
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    return answer(text, values);
  }) as unknown as postgres.TransactionSql;
  // tx(batch, "col1", ...) is called as a plain function inside a template interpolation when
  // building a bulk INSERT; the real postgres.js turns it into a VALUES fragment, so the fake
  // only needs to return a stable marker that becomes one of the outer call's `values`.
  (fn as unknown as { array: (v: unknown) => unknown }).array = (v: unknown) => v;
  return { tx: fn, queries };
}

describe("reconcile track", () => {
  it("registers the reconcile track by name", () => {
    expect(track.name).toBe("reconcile");
  });

  it("clusters 'loaded' rows strictly by TCAD id (one cluster per request_identifier)", () => {
    const rows = [
      { job_id: "travis-a04-20261001000000", record_ordinal: "1", request_identifier: "1000000" },
      { job_id: "travis-a04-20261015000000", record_ordinal: "1", request_identifier: "1000000" },
      { job_id: "travis-a04-20261001000000", record_ordinal: "2", request_identifier: "2000000" },
    ];
    const clusters = clustersFromLoadedRows(rows);
    expect(clusters).toHaveLength(2);
    const byId = Object.fromEntries(clusters.map((c) => [c.clusterId, c.records.length]));
    expect(byId["1000000"]).toBe(2);
    expect(byId["2000000"]).toBe(1);
  });

  it("merges the property entity type, writing one reconcile_merges row per TCAD id", async () => {
    const loadedRows = [
      { job_id: "travis-a04-j1", record_ordinal: "1", request_identifier: "1000000" },
      { job_id: "travis-a04-j2", record_ordinal: "1", request_identifier: "1000000" },
      { job_id: "travis-a04-j1", record_ordinal: "2", request_identifier: "2000000" },
    ];
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("SELECT job_id, record_ordinal")) return loadedRows;
      return [];
    });
    const input = {
      kind: "merge" as const,
      jobId: JOB,
      artifactPath: "query-db://roll_reconciliation+parcels/property",
      artifactSha256: "a".repeat(64),
      entityType: "property" as const,
    };
    const outcome = await track.merge(tx, input);
    expect(outcome.rowsWritten).toBe(2); // two distinct TCAD ids -> two canonical merges
    expect(queries.some((q) => q.text.startsWith("INSERT INTO reconcile_merges"))).toBe(true);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO reconcile_merge_refusals"))).toBe(false);
  });

  it("merges the owner entity type through the same loaded-rows query", async () => {
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("SELECT job_id, record_ordinal")) {
        return [{ job_id: "travis-a04-j1", record_ordinal: "1", request_identifier: "3000000" }];
      }
      return [];
    });
    const input = {
      kind: "merge" as const,
      jobId: JOB,
      artifactPath: "query-db://roll_reconciliation+parcels/owner",
      artifactSha256: "b".repeat(64),
      entityType: "owner" as const,
    };
    const outcome = await track.merge(tx, input);
    expect(outcome.rowsWritten).toBe(1);
    const insert = queries.find((q) => q.text.startsWith("INSERT INTO reconcile_merges"));
    expect(insert).toBeDefined();
  });

  it("never queries the Query DB for the contractor entity type (T057 not built this pass)", async () => {
    const select = vi.fn(() => []);
    const { tx } = fakeTx(select);
    const input = {
      kind: "merge" as const,
      jobId: JOB,
      artifactPath: "query-db://contractor-clusters/contractor",
      artifactSha256: "c".repeat(64),
      entityType: "contractor" as const,
    };
    const outcome = await track.merge(tx, input);
    expect(outcome.rowsWritten).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it("writes a refused cross-TCAD-id merge to reconcile_merge_refusals, never to reconcile_merges, when the merge rule reports one", async () => {
    // merge.ts's own pure-function tests (test/travis/a07/reconcile/merge.test.ts) already prove
    // mergeEntityClusters refuses a cluster spanning two TCAD ids; the real `roll_reconciliation`
    // query can never itself produce such a cluster (clustersFromLoadedRows keys strictly by
    // request_identifier), so this proves the track's WRITE path for a refusal, with the
    // dispatch mocked to force one.
    vi.resetModules();
    vi.doMock("../../../oracle-runtime/travis/reconcile/merge.js", () => ({
      mergeEntityClusters: () => ({
        entityType: "property",
        merges: [],
        refused: [{ clusterId: "bad-cluster", tcadIds: ["1", "2"], reason: "cross_tcad_id" }],
      }),
    }));
    const { track: mockedTrack } = await import("../../services/tracks/reconcile.js");
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("SELECT job_id, record_ordinal")) {
        return [{ job_id: "travis-a04-j1", record_ordinal: "1", request_identifier: "1" }];
      }
      return [];
    });
    const input = {
      kind: "merge" as const,
      jobId: JOB,
      artifactPath: "query-db://roll_reconciliation+parcels/property",
      artifactSha256: "d".repeat(64),
      entityType: "property" as const,
    };
    const outcome = await mockedTrack.merge(tx, input);
    expect(outcome.rowsWritten).toBe(0);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO reconcile_merges"))).toBe(false);
    const refusal = queries.find((q) => q.text.startsWith("INSERT INTO reconcile_merge_refusals"));
    expect(refusal).toBeDefined();
    expect(refusal?.values).toContain("cross_tcad_id");
    vi.doUnmock("../../../oracle-runtime/travis/reconcile/merge.js");
  });
});
