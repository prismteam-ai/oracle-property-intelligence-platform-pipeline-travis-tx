// A-04: writeGroupWith rewrites only the requested pIDs' zips into the given directory.
// Fake Query DB and an in-memory export; no database, no network.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { coordinateRows, roofAgeLedgerFor, writeGroupWith } from "../services/workflows/tcad-backbone.js";
import { a04Record } from "../../oracle-runtime/test/fixtures/a04/tcad/export.js";
import { sha256Text, type ExportRecordText } from "../../oracle-runtime/travis/tcad/export-stream.js";

const JOB = "travis-a04-20261022040000";
const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

function fake(answer: (text: string, values: unknown[]) => unknown) {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray | unknown[], ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in strings)) return { helper: strings };
    const text = (strings as unknown as string[]).join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    return Promise.resolve(answer(text, values));
  }) as unknown as postgres.Sql;
  return { sql, queries };
}

const PIDS = [7001, 7002, 7003];
const rec = (pID: number, i: number): ExportRecordText => {
  const t = JSON.stringify(a04Record({ pID, geoID: `07000000${i}`, ownerName: "Sample Owner LLC" }), null, 1);
  return { ordinal: i, text: t, sha256: sha256Text(t), bytes: Buffer.byteLength(t) };
};

// roof_age_estimates rows for the fixture pIDs: built_year, permit, and no row at all.
const LEDGER = [
  { tcad_id: "7001", roof_age_basis: "built_year", roof_age_years: 39, as_of_date: "2026-10-22" },
  { tcad_id: "7002", roof_age_basis: "permit", roof_age_years: 2, as_of_date: "2026-10-22" },
];

const store = () =>
  fake((text) => {
    if (text.includes("roof_age_estimates")) return LEDGER;
    if (text.includes("coordinate_source")) {
      return PIDS.map((p) => ({
        request_identifier: String(p),
        latitude: 30.3,
        longitude: -97.7,
        coordinate_source: "gis_centroid",
      }));
    }
    if (text.includes("as_of")) return [{ as_of: "2026-10-20" }];
    return [{ n: 0 }];
  });
const deps = (sql: postgres.Sql, defaultDir: string) => ({
  sql,
  cids: CIDS,
  records: async function* () {
    for (const [i, p] of PIDS.entries()) yield rec(p, i);
  },
  receipt: { sha256: "0".repeat(64), captured_at: "2026-10-20T00:00:00Z" },
  defaultDir,
});

describe("writeGroupWith", () => {
  it("writes the whole group into the default dir when no pIDs are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const out = await writeGroupWith(deps(store().sql, dir), JOB);
    expect(out.zips).toBe(3);
    expect(readdirSync(dir).sort()).toEqual(["7001.zip", "7002.zip", "7003.zip"]);
    expect(out.mailing_address_fallback).toBe(0);
    // A-11: the owner reader tally covers every owner entry of the three records
    const o = out.owners;
    expect(o.persons + o.companies + o.unparsed).toBeGreaterThanOrEqual(3);
    expect(out).not.toHaveProperty("missing_pids");
  });

  it("with pIDs and an out dir writes only those zips there, and names the missing ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const outDir = mkdtempSync(join(tmpdir(), "regen-"));
    const f = store();
    const out = await writeGroupWith(deps(f.sql, dir), JOB, { pids: ["7002", "9999"], out: outDir });
    expect(out.zips).toBe(1);
    expect(readdirSync(outDir)).toEqual(["7002.zip"]);
    expect(readdirSync(dir)).toEqual([]);
    expect(out.missing_pids).toEqual(["9999"]);
    // the pID filter reaches the SQL, and the whole-run non-R count is not run
    expect(f.queries.some((q) => q.includes("request_identifier IN"))).toBe(true);
    expect(f.queries.some((q) => q.includes("prop_type <> 'R'"))).toBe(false);
  });

  it("counts the mailing addresses that took the unnormalized fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const d = deps(store().sql, dir);
    d.records = async function* () {
      const raw = a04Record({ pID: 7001, geoID: "070000000" });
      ((raw.owners as Record<string, unknown>[])[0] as Record<string, unknown>).addrCity = "POTOSI SAN LUIS 78153";
      const t = JSON.stringify(raw, null, 1);
      yield { ordinal: 0, text: t, sha256: sha256Text(t), bytes: Buffer.byteLength(t) };
    };
    const out = await writeGroupWith(d, JOB);
    expect(out.mailing_address_fallback).toBe(1);
  });
});

describe("roof-age ledger in the County group", () => {
  it("reads the ledger once per batch and counts built-year, no-date and missing rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const f = store();
    const out = await writeGroupWith(deps(f.sql, dir), JOB);
    expect(f.queries.filter((q) => q.includes("roof_age_estimates"))).toHaveLength(1);
    expect(out.roof_age).toEqual({
      built_year: 1,
      no_tcad_date: 1,
      missing_ledger_row: 1,
      ledger_table_missing: false,
    });
  });

  it("maps a built_year row to a YYYY entry and every other basis to no TCAD date", async () => {
    const f = fake(() => LEDGER);
    const { available, entries } = await roofAgeLedgerFor(f.sql, ["7001", "7002", "7003"]);
    expect(available).toBe(true);
    expect(entries.get("7001")).toEqual({ pID: "7001", roof_date: "1987", anchor: "property_built_year" });
    expect(entries.get("7002")).toEqual({ pID: "7002", roof_date: null, anchor: null });
    expect(entries.has("7003")).toBe(false);
  });

  it("reports a database without the table and rethrows any other error", async () => {
    const missing = fake(() => {
      throw Object.assign(new Error("no table"), { code: "42P01" });
    });
    expect((await roofAgeLedgerFor(missing.sql, ["1"])).available).toBe(false);
    const broken = fake(() => {
      throw Object.assign(new Error("down"), { code: "57P01" });
    });
    await expect(roofAgeLedgerFor(broken.sql, ["1"])).rejects.toThrow("down");
  });
});

describe("coordinateRows with pIDs", () => {
  it("adds the IN filter only when pIDs are given", async () => {
    const a = fake(() => []);
    await coordinateRows(a.sql, JOB);
    expect(a.queries[0]).not.toContain("IN");
    const b = fake(() => []);
    await coordinateRows(b.sql, JOB, ["1"]);
    expect(b.queries[0]).toContain("request_identifier IN");
  });
});
