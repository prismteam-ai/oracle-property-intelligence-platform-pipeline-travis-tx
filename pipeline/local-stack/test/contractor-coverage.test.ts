// ERR-73: five-state contractor totals over the published permits. No DB, no network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  contractorCoverage,
  loadRegistry,
  parseArgs,
  readPublishedPermits,
  writeCoverageReport,
  type Sql,
} from "../scripts/contractor-coverage.js";

const reg = (taxpayerNumber: string, legalName: string, sosStatusCode = "active") => ({
  taxpayerNumber,
  legalName,
  sosStatusCode,
  mailingAddress: null,
  sosFileNumber: null,
});
const ON = "2026-10-26T00:00:00.000Z";

describe("contractorCoverage", () => {
  it("counts each published permit once in exactly one of the five states", () => {
    const cov = contractorCoverage(
      [
        { pid: "1", permitNumber: "P1", name: "Alpha Roofing LLC" },
        { pid: "1", permitNumber: "P2", name: "Beta Roofing" },
        { pid: "2", permitNumber: "P3", name: "Gamma Roofing" },
        { pid: "2", permitNumber: "P4", name: "Nobody Known" },
        { pid: "3", permitNumber: "P5", name: null },
      ],
      [
        reg("1", "ALPHA ROOFING LLC"),
        reg("2", "Beta Roofing"),
        reg("3", "BETA ROOFING"),
        reg("4", "Gamma Roofing", "forfeited"),
      ],
      ON,
    );
    expect(cov.byState).toEqual({
      resolved: 0,
      candidate: 1,
      ambiguous: 1,
      conflicting: 1,
      unresolved: 2,
    });
    expect(cov.unresolvedBy).toEqual({ contractor_not_printed: 1, no_match: 1 });
    expect(cov.permits).toBe(5);
    expect(cov.named).toBe(4);
    expect(cov.registryRows).toBe(4);
  });

  it("reports registry_unavailable for every permit when the registry is empty", () => {
    const cov = contractorCoverage([{ pid: "1", permitNumber: "P1", name: "Alpha" }], [], ON);
    expect(cov.byState.unresolved).toBe(1);
    expect(cov.unresolvedBy).toEqual({ registry_unavailable: 1 });
  });
});

describe("readPublishedPermits", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("pairs property_improvement_N with company_N and skips folders without data", () => {
    dir = mkdtempSync(join(tmpdir(), "contractor-coverage-"));
    const data = join(dir, "100", "data");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(dir, "101"));
    writeFileSync(
      join(data, "property_improvement_1.json"),
      JSON.stringify({ permit_number: "A" }),
    );
    writeFileSync(
      join(data, "property_improvement_2.json"),
      JSON.stringify({ permit_number: "B" }),
    );
    writeFileSync(join(data, "company_2.json"), JSON.stringify({ name: "Beta" }));
    writeFileSync(join(data, "property.json"), "{}");
    const got = readPublishedPermits(dir).sort((a, b) =>
      a.permitNumber.localeCompare(b.permitNumber),
    );
    expect(got).toEqual([
      { pid: "100", permitNumber: "A", name: null },
      { pid: "100", permitNumber: "B", name: "Beta" },
    ]);
  });
});

describe("loadRegistry / writeCoverageReport (fake SQL, no DB)", () => {
  const fakeSql = (registry: unknown[], loads: unknown[]): Sql =>
    (async (strings: TemplateStringsArray) =>
      strings.join("?").includes("comptroller_registry_loads") ? loads : registry) as Sql;
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("maps registry rows (null status -> unknown) and the latest load", async () => {
    const at = new Date("2026-10-22T18:46:53.171Z");
    const r = await loadRegistry(
      fakeSql(
        [
          {
            taxpayer_number: "1",
            legal_name: "A",
            sos_status_code: null,
            mailing_address: null,
            sos_file_number: null,
          },
        ],
        [{ job_id: "j", loaded_at: at, source_url: "u", watermark: "w" }],
      ),
    );
    expect(r.registry).toEqual([
      {
        taxpayerNumber: "1",
        legalName: "A",
        sosStatusCode: "unknown",
        mailingAddress: null,
        sosFileNumber: null,
      },
    ]);
    expect(r.load).toEqual({
      job_id: "j",
      loaded_at: at.toISOString(),
      source_url: "u",
      watermark: "w",
    });
    expect((await loadRegistry(fakeSql([], []))).load).toBeNull();
  });

  it("writes the report for a built group dir", async () => {
    dir = mkdtempSync(join(tmpdir(), "contractor-coverage-"));
    const data = join(dir, "100", "data");
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "property_improvement_1.json"),
      JSON.stringify({ permit_number: "A" }),
    );
    writeFileSync(join(data, "company_1.json"), JSON.stringify({ name: "Alpha Roofing" }));
    const out = join(dir, "report.json");
    const cov = await writeCoverageReport(
      fakeSql(
        [
          {
            taxpayer_number: "1",
            legal_name: "ALPHA ROOFING",
            sos_status_code: "active",
            mailing_address: null,
            sos_file_number: null,
          },
        ],
        [],
      ),
      { group: dir, out },
      ON,
    );
    expect(cov.byState.candidate).toBe(1);
    const report = JSON.parse(readFileSync(out, "utf8")) as {
      permits: number;
      effectiveOn: string;
      registryLoad: null;
    };
    expect(report).toMatchObject({ permits: 1, effectiveOn: ON, registryLoad: null });
  });

  it("parseArgs needs --group and --out", () => {
    expect(parseArgs(["--group", "g", "--out", "o"])).toEqual({ group: "g", out: "o" });
    expect(() => parseArgs(["--group", "g"])).toThrow(/--group and --out/);
    expect(() => parseArgs(["group"])).toThrow(/bad argument/);
  });
});
