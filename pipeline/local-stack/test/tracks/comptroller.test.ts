// A-07 T016 (Track A): the Loader `comptroller` track (migration 0401_comptroller_registry.sql)
// and the `identity` report section. A scripted postgres.js stand-in records every statement
// (synthetic test input; no database), following the permits track test's pattern. Must fail
// before T017 (services/tracks/comptroller.ts, services/report-sections/identity.ts) lands.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { COMPTROLLER_SOURCE_KEY, track } from "../../services/tracks/comptroller.js";
import { assembleIdentitySection, section } from "../../services/report-sections/identity.js";

const JOB = "travis-a07-identity-registry-202610220900";

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
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return { tx: fn, queries };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function stagedArtifact(rows: Record<string, unknown>[]): { path: string; sha256: string } {
  const dir = mkdtempSync(join(tmpdir(), "a07-comptroller-track-"));
  dirs.push(dir);
  const path = join(dir, "registry-rows.json");
  const body = Buffer.from(JSON.stringify({ mappingVersion: "tx-comptroller-mapping@1.1.0", rows }));
  writeFileSync(path, body);
  return { path, sha256: createHash("sha256").update(body).digest("hex") };
}

describe("comptroller track: load_registry", () => {
  it("registers the comptroller track by name", () => {
    expect(track.name).toBe("comptroller");
  });

  it("upserts staged rows into comptroller_registry and records a load row, returning the watermark", async () => {
    const artifact = stagedArtifact([
      { taxpayerNumber: "32000000001", legalName: "SYNTHETIC ROOFING 1 CO", sosStatusCode: "ACTIVE", mailingAddress: null, sosFileNumber: "SOS-1" },
      { taxpayerNumber: "32000000002", legalName: "SYNTHETIC ROOFING 2 CO", sosStatusCode: "ACTIVE", mailingAddress: null, sosFileNumber: "SOS-2" },
    ]);
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("INSERT INTO comptroller_registry")) {
        return [{ taxpayer_number: "32000000001" }, { taxpayer_number: "32000000002" }];
      }
      return [];
    });
    const input = {
      kind: "load_registry" as const,
      jobId: JOB,
      artifactPath: artifact.path,
      artifactSha256: artifact.sha256,
      scope: "travis" as const,
      watermark: "2026-10-19T21:00:00.000Z",
      sourceUrl: "https://data.texas.gov/resource/9cir-efmm.json",
      capturedAt: "2026-10-19T21:00:38.000Z",
    };
    const outcome = await track.merge(tx, input);
    expect(outcome.rowsWritten).toBe(2);
    expect(outcome.watermark?.sourceKey).toBe(COMPTROLLER_SOURCE_KEY);
    expect((outcome.watermark?.value as { rowCount: number }).rowCount).toBe(2);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO comptroller_registry"))).toBe(true);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO comptroller_registry_loads"))).toBe(true);
  });

  it("refuses an artifact whose body does not match its declared sha256", async () => {
    const artifact = stagedArtifact([
      { taxpayerNumber: "32000000003", legalName: "X", sosStatusCode: "ACTIVE", mailingAddress: null, sosFileNumber: null },
    ]);
    const { tx } = fakeTx();
    const input = {
      kind: "load_registry" as const,
      jobId: JOB,
      artifactPath: artifact.path,
      artifactSha256: "f".repeat(64),
      scope: "travis" as const,
      watermark: null,
      sourceUrl: "https://data.texas.gov/resource/9cir-efmm.json",
      capturedAt: "2026-10-19T21:00:38.000Z",
    };
    await expect(track.merge(tx, input)).rejects.toThrow(/sha256/);
  });
});

describe("comptroller track: resolve_permits (T020, Wave 3)", () => {
  it("resolves every candidate permit against the registry and batch-inserts the ledger", async () => {
    const candidates = [
      { permit_key: "2026-000001 BP", raw_contractor_name: "Roofing Co." }, // candidate
      { permit_key: "2026-000002 BP", raw_contractor_name: null }, // unresolved/contractor_not_printed
      { permit_key: "2026-000003 BP", raw_contractor_name: "Nobody Matches LLC" }, // unresolved
    ];
    const registry = [
      { taxpayer_number: "32000000001", legal_name: "ROOFING COMPANY", sos_status_code: "ACTIVE", mailing_address: null, sos_file_number: null },
    ];
    let ledgerInsertValues: unknown[] | undefined;
    const { tx } = fakeTx((text, values) => {
      if (text.startsWith("SELECT pi.permit_number")) return candidates;
      if (text.startsWith("SELECT taxpayer_number, legal_name")) return registry;
      if (text.startsWith("INSERT INTO contractor_resolution_ledger")) {
        ledgerInsertValues = values;
        return candidates.map((c) => ({ permit_key: c.permit_key }));
      }
      return [];
    });
    const input = {
      kind: "resolve_permits" as const,
      jobId: "travis-a07-identity-resolve-202610221900",
      artifactPath: "query-db://property_improvements+comptroller_registry/austin-roofing-permits",
      artifactSha256: "e".repeat(64),
      scope: "austin-roofing-permits" as const,
      effectiveOn: "2026-10-22T19:00:00.000Z",
    };
    const outcome = await track.merge(tx, input);
    expect(outcome.rowsWritten).toBe(3);
    const totals = (outcome.watermark?.value as { fiveStateTotals: Record<string, number> }).fiveStateTotals;
    expect(totals.candidate).toBe(1);
    expect(totals.unresolved).toBe(2);
    expect(totals.resolved).toBe(0);
    expect(totals.ambiguous).toBe(0);
    expect(totals.conflicting).toBe(0);
    expect(ledgerInsertValues).toBeDefined();
    // the state array (one of the unnest columns) carries exactly 1 "candidate" and 2
    // "unresolved" entries, wherever it lands among the insert's parameter arrays.
    const flattened = (ledgerInsertValues ?? []).flat(Infinity) as unknown[];
    expect(flattened.filter((v) => v === "candidate").length).toBe(1);
    expect(flattened.filter((v) => v === "unresolved").length).toBe(2);
    expect(flattened.filter((v) => v === "2026-000001 BP").length).toBe(1);
  });
});

describe("identity report section", () => {
  it("has the key 'identity'", () => {
    expect(section.key).toBe("identity");
  });

  it("assembles the manifest-coverage shape from the loaded-registry data", () => {
    const result = assembleIdentitySection({
      registryLoaded: true,
      rowCount: 342_334,
      watermark: "2026-10-19T21:00:38.000Z",
      snapshotDigest: "a".repeat(64),
      sourceUrl: "https://data.texas.gov/resource/9cir-efmm.json",
      fiveStateTotals: { resolved: 0, candidate: 12, ambiguous: 1, conflicting: 0, unresolved: 22_071 },
      permitTotal: 22_084,
    });
    expect(result.registry_row_count).toBe(342_334);
    expect(result.five_state_totals).toEqual({ resolved: 0, candidate: 12, ambiguous: 1, conflicting: 0, unresolved: 22_071 });
    expect(result.five_state_sum_matches_permit_total).toBe(true);
    expect(result.derivation).toBe("aggregate_match");
  });

  it("section.build loads the latest registry load and the live five-state counts from Postgres", async () => {
    const { tx } = fakeTx((text) => {
      if (text.startsWith("SELECT row_count, watermark, snapshot_digest, source_url")) {
        return [{ row_count: 342_333, watermark: "2026-10-17T10:35:22.788Z", snapshot_digest: "b".repeat(64), source_url: "https://data.texas.gov/resource/9cir-efmm.json" }];
      }
      if (text.startsWith("SELECT state, count(*)")) {
        return [
          { state: "candidate", n: 311 },
          { state: "conflicting", n: 78 },
          { state: "unresolved", n: 21_695 },
        ];
      }
      if (text.startsWith("SELECT count(*)::int AS n FROM contractor_resolution_current")) {
        return [{ n: 22_084 }];
      }
      return [];
    });
    const result = await section.build(tx as unknown as postgres.Sql);
    expect(result).toMatchObject({
      registry_row_count: 342_333,
      five_state_totals: { resolved: 0, candidate: 311, ambiguous: 0, conflicting: 78, unresolved: 21_695 },
      five_state_sum: 22_084,
      permit_total: 22_084,
      five_state_sum_matches_permit_total: true,
      limitation: null,
    });
  });

  it("section.build reports 'registry not loaded' when no registry load row exists yet", async () => {
    const { tx } = fakeTx(() => []);
    const result = await section.build(tx as unknown as postgres.Sql);
    expect(result.registry_loaded).toBe(false);
    expect(result.limitation).toBe("registry not loaded");
  });
});
