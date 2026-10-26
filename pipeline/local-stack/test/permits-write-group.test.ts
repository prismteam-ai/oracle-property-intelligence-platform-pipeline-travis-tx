// A-11 T031 (Stage 5 S5.2): writeGroupWith pages the Query DB's reconciled permit rows into the
// Property Improvement group. Fake Query DB only (small fixture, not the 2,381,226-row full
// roll -- that is the background run started separately); no database, no network.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { linkedPidPages, writeGroupWith, type PermitsWriteGroupDeps } from "../services/workflows/permits-backbone.js";
import { tcadRecord } from "../../oracle-runtime/test/fixtures/tcad-records.js";
import { slimPayload } from "../../oracle-runtime/travis/tcad/fields.js";
import type { ProfileApi } from "../../oracle-runtime/travis/transforms/austin-property-improvement.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};
const SHA = "e".repeat(64);

const STUB: ProfileApi = {
  PROFILE: { name: "travis-austin", version: "1.0.0", sha256: SHA },
  classifyPermit: (row) => ({
    roofing: row.permittype === "BP" ? "roofing" : "not_roofing",
    reason: row.permittype === "BP" ? "include" : "trade_permit",
    improvement_type: row.permittype === "BP" ? "Roofing" : null,
    improvement_action: row.permittype === "BP" ? "Replacement" : null,
    sha256: SHA,
  }),
  classifyStatus: (word) => ({
    ...(word === "Active"
      ? { class: "open" as const, improvement_status: "Permitted" }
      : { class: "needs_review" as const, improvement_status: null }),
    sha256: SHA,
  }),
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

const parcelPayload = (pID: number, geoID: string) => slimPayload(tcadRecord({ pID, geoID }), false);
/** The parcels columns parcelsFor selects beside payload_redacted (0101_tcad.sql, 0201_gis.sql). */
const ASSEMBLED = {
  property_structure_built_year: 1985,
  export_point_lat: 30.2545186553,
  export_point_lon: -97.7620645363,
  export_point_kind: "real",
  latitude: 30.2545186553,
  longitude: -97.7620645363,
  coordinate_source: "gis_centroid",
} as const;
const permitPayload = (permitNumber: string) => ({
  permit_number: permitNumber,
  permittype: "BP",
  work_class: "Remodel",
  status_current: "Active",
  description: "REROOF SFR",
  issue_date: "2026-09-02T00:00:00.000",
  completed_date: null,
  tcad_id: "0100030105",
});

/** 7001 has one linked permit and a parcel; 7002 has a parcel but no linked permit;
 *  7003 has a linked permit but no parcel row (data gap, not emitted either). */
function store() {
  return fake((text) => {
    if (text.includes("FROM parcels")) {
      return [
        { request_identifier: "7001", geo_id: "0700000001", payload_redacted: parcelPayload(7001, "0700000001"), ...ASSEMBLED },
        { request_identifier: "7002", geo_id: "0700000002", payload_redacted: parcelPayload(7002, "0700000002"), ...ASSEMBLED },
      ];
    }
    if (text.includes("JOIN permit_source_rows")) {
      return [
        {
          request_identifier: "7001",
          permit_number: "2026-100001 BP",
          payload: permitPayload("2026-100001 BP"),
          content_sha256: SHA,
          captured_at: "2026-10-21T22:32:10.129Z",
        },
        {
          request_identifier: "7003",
          permit_number: "2026-100003 BP",
          payload: permitPayload("2026-100003 BP"),
          content_sha256: SHA,
          captured_at: "2026-10-21T22:32:10.129Z",
        },
      ];
    }
    return [];
  });
}

const deps = (sql: postgres.Sql, defaultDir: string): PermitsWriteGroupDeps => ({
  sql,
  cids: CIDS,
  profile: STUB,
  defaultDir,
});

describe("writeGroupWith (property improvement, explicit pids)", () => {
  it("writes a group only for a pID with both a parcel and a linked permit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-grp-"));
    const f = store();
    const out = await writeGroupWith(deps(f.sql, dir), "travis-a11-20261023000000", {
      pids: ["7001", "7002", "7003"],
    });
    expect(out.groups).toBe(1);
    expect(out.permits).toBe(1);
    expect(readdirSync(dir)).toEqual(["7001"]);
    const pi = JSON.parse(readFileSync(join(dir, "7001", "data", "property_improvement_1.json"), "utf8"));
    expect(pi.permit_number).toBe("2026-100001 BP");
    // 7002 has no linked permit, 7003 has no parcel row: both are reported missing, neither written
    expect(out.missing_pids?.sort()).toEqual(["7002", "7003"]);
  });

  it("rewrites only the requested pIDs into a given --out dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-grp-"));
    const outDir = mkdtempSync(join(tmpdir(), "pi-regen-"));
    const f = store();
    const out = await writeGroupWith(deps(f.sql, dir), "travis-a11-20261023000000", {
      pids: ["7001"],
      out: outDir,
    });
    expect(out.groups).toBe(1);
    expect(readdirSync(outDir)).toEqual(["7001"]);
    expect(readdirSync(dir)).toEqual([]);
    expect(out.missing_pids).toEqual([]);
  });
});

describe("linkedPidPages", () => {
  it("chunks an explicit pID list to batchSize without touching the Query DB", async () => {
    const f = fake(() => {
      throw new Error("should not query the DB for an explicit pID list");
    });
    const pages: string[][] = [];
    for await (const page of linkedPidPages(f.sql, 2, ["9", "1", "5", "3"])) pages.push(page);
    expect(pages).toEqual([["1", "3"], ["5", "9"]]);
  });

  it("pages every distinct linked pID by keyset until an empty page ends the scan", async () => {
    let call = 0;
    const f = fake(() => {
      call += 1;
      if (call === 1) return [{ request_identifier: "1" }, { request_identifier: "2" }];
      if (call === 2) return [{ request_identifier: "3" }];
      return [];
    });
    const pages: string[][] = [];
    for await (const page of linkedPidPages(f.sql, 2, null)) pages.push(page);
    expect(pages).toEqual([["1", "2"], ["3"]]);
    expect(call).toBe(3);
  });
});
