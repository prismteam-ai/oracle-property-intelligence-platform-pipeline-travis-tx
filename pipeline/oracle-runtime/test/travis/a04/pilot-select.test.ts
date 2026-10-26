// A-04 T027: the 25-parcel pilot selection (FR-001, D-4). Synthetic test input only: every
// record below is invented and shaped like the export.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { a04Record, writeExportZip } from "../../fixtures/a04/tcad/export.js";
import { streamExportRecords } from "../../../travis/tcad/export-stream.js";
import {
  PILOT_REASONS,
  PILOT_SIZE,
  PRIMARY_ANCHOR_GEOID,
  selectPilot,
  writePilotSeed,
} from "../../../travis/tcad/pilot-select.js";
import { parseSeedCsv } from "../../../travis/pilot/build-seed.js";

function exportRecords(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    a04Record({ pID: 221829, geoID: PRIMARY_ANCHOR_GEOID, yearBuilt: 1941 }),
    a04Record({ pID: 500001, geoID: "0999000001" }), // candidate 1: shared by two R accounts → ambiguous
    a04Record({ pID: 500002, geoID: "0999000001" }),
    a04Record({ pID: 500003, geoID: "0999000002" }), // candidate 2: one R account → second anchor
    a04Record({ pID: 600001, geoID: "", propType: "P", geometry: "[null, null]" }),
    a04Record({ pID: 600002, geoID: "0600000002", propType: "MH", geometry: "[null, null]" }),
    a04Record({ pID: 600003, geoID: "0600000003", propType: "MN", geometry: "[null, null]" }),
    a04Record({ pID: 600004, geoID: "0600000004", confidentialCode: "Q" }),
    a04Record({
      pID: 600005,
      geoID: "0600000005",
      yearBuilt: 0,
      improvements: [
        { stateCd: "A1", livingArea: 1000, actualYearBuilt: 1970 },
        { stateCd: "A1", livingArea: 500, actualYearBuilt: 1990 },
      ],
    }),
    a04Record({ pID: 600006, geoID: "0600000006", noSales: true }),
    a04Record({ pID: 600007, geoID: "0600000007", yearBuilt: 0 }),
    a04Record({ pID: 600008, geoID: "0600000008", addrZip: "10001" }),
    a04Record({ pID: 600009, geoID: "0600000009", addrZip: "78665" }),
    a04Record({ pID: 600010, geoID: "0600000010", addrCountry: "CANADA", addrZip: null }),
    a04Record({ pID: 600011, geoID: "0600000011" }),
    a04Record({ pID: 600012, geoID: "0600000011" }), // the second R account on one geoID
  ];
  for (let i = 0; i < 20; i += 1)
    out.push(
      a04Record({
        pID: 700000 + i,
        geoID: `07000000${String(i).padStart(2, "0")}`,
        addrZip: "78701",
      }),
    );
  return out;
}

describe("T027 pilot selection", () => {
  it("25 rows: 221829, the second anchor from the Austin list, one of each case, a reason per row", async () => {
    const zip = writeExportZip(exportRecords());
    const out = await selectPilot(streamExportRecords(zip), {
      anchorCandidates: ["0999000001", "0999000002", "0999000003"],
      asOf: "2026-10-22",
    });
    expect(PILOT_SIZE).toBe(25);
    expect(out.rows).toHaveLength(25);
    expect(out.anchor2).toEqual({ geo_id: "0999000002", pID: "500003" });
    expect(out.rows[0]).toMatchObject({ pID: "221829", reason: "primary_anchor" });
    expect(out.rows[1]).toMatchObject({ pID: "500003", reason: "second_anchor" });
    const byReason = new Map(out.rows.map((r) => [r.reason, r.pID]));
    for (const reason of PILOT_REASONS) expect(byReason.has(reason)).toBe(true);
    expect(byReason.get("prop_type_P")).toBe("600001");
    expect(byReason.get("prop_type_MH")).toBe("600002");
    expect(byReason.get("prop_type_MN")).toBe("600003");
    expect(byReason.get("coded_confidential")).toBe("600004");
    expect(byReason.get("shared_geoid")).toBe("600012");
    expect(byReason.get("several_improvements")).toBe("600005");
    expect(byReason.get("no_dated_sale")).toBe("600006");
    expect(byReason.get("no_year_built")).toBe("600007");
    expect(byReason.get("owner_out_of_area")).toBe("600008");
    expect(byReason.get("owner_regional")).toBe("600009");
    expect(byReason.get("owner_foreign_mailing")).toBe("600010");
    expect(new Set(out.rows.map((r) => r.pID)).size).toBe(25);
    expect(out.rows.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("writes the seed CSV (county-seed-data columns + reason); no owner field", async () => {
    const zip = writeExportZip(exportRecords());
    const out = await selectPilot(streamExportRecords(zip), {
      anchorCandidates: ["0999000002"],
      asOf: "2026-10-22",
    });
    const path = join(mkdtempSync(join(tmpdir(), "a04-seed-")), "travis-a04-pilot.csv");
    writePilotSeed(path, out.rows);
    const text = readFileSync(path, "utf8");
    expect(text.split("\n")[0]).toBe(
      "parcel_id,source_identifier,situs_address,geo_id,county,latitude,longitude,method,url,reason",
    );
    expect(text.trim().split("\n")).toHaveLength(26);
    expect(text).toMatch(/^221829,/m);
    expect(text).not.toContain("SAMPLE OWNER");
    expect(parseSeedCsv(text).map((r) => r.parcel_id)).toHaveLength(25);
  });

  it("without a resolvable second anchor the selection stops (D-4 needs a real one)", async () => {
    const zip = writeExportZip(exportRecords());
    await expect(
      selectPilot(streamExportRecords(zip), {
        anchorCandidates: ["0999000001"],
        asOf: "2026-10-22",
      }),
    ).rejects.toThrow(/second anchor/);
  });
});

describe("T027 backbone pilot verb", () => {
  it("starts TcadBackbone with the seed's pIDs and prints the validate command", async () => {
    const { command } = await import("../../../travis/backbone/commands/pilot.js");
    const { createRunContext } = await import("../../../travis/backbone/run-context.js");
    const zip = writeExportZip(exportRecords());
    const out = await selectPilot(streamExportRecords(zip), {
      anchorCandidates: ["0999000002"],
      asOf: "2026-10-22",
    });
    const seed = join(mkdtempSync(join(tmpdir(), "a04-seed-")), "seed.csv");
    writePilotSeed(seed, out.rows);
    const sent: unknown[] = [];
    const printed: string[] = [];
    const ctx = createRunContext({
      ingress: {
        call: async <T>() => ({ status: "complete", records: 25, loaded: 25 }) as T,
        send: async (_s, _k, _h, body) => {
          sent.push(body);
          return { invocationId: "inv_synthetic" };
        },
        callLong: async <T>() => null as T,
        get: async <T>() => null as T,
      },
      now: () => new Date("2026-10-22T05:06:00Z"),
      freeBytes: () => 50 * 1024 ** 3,
      print: (l) => printed.push(l),
    });
    const r = await command.run(ctx, { seed, pollMs: 0 });
    expect(r).toEqual({ jobId: "travis-a04-pilot-20261022050600", exitCode: 0 });
    expect(sent[0]).toMatchObject({
      jobId: "travis-a04-pilot-20261022050600",
      mode: "pilot",
      seedPids: out.rows.map((x) => x.pID),
    });
    expect(printed.at(-1)).toBe(
      "validate: ~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli validate pipeline/data/runs/travis-a04-pilot-20261022050600/groups/county",
    );
    expect(command.args.safeParse({ select: true, seed: "x" }).success).toBe(false);
  });
});
