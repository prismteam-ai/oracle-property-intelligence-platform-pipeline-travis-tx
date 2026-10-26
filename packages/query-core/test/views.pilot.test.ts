// T058 (A-02, FR-002 / FR-007, AC-2 / AC-7): the four views over the real pilot export.
// Gated on PILOT_DIR (skipped with an explicit message when it is absent).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNCARRIED, VIEWS, rowSchema, type ViewName } from "@countylens/contract";
import { rawCid } from "../src/raw-cid.js";
import { PILOT_DIR, SKIP_MESSAGE, bindPilot, type Pilot } from "./helpers/pilot.js";

type Missing = { field: string; reason: string }[];
const EXPIRED = ["2026-029405 BP", "2026-022834 BP", "2026-022879 BP"];
const NEVER_NULL = ["cid", "table", "table_cid", "run_id", "manifest_cid", "as_of"];

if (!PILOT_DIR) {
  describe("views over the pilot export (T058)", () => {
    it.skip(SKIP_MESSAGE, () => undefined);
  });
} else {
  const pilotDir = PILOT_DIR;
  let pilot: Pilot;
  const rows: Partial<Record<ViewName, Record<string, unknown>[]>> = {};
  const viewRows = (v: ViewName): Record<string, unknown>[] => rows[v] ?? [];

  beforeAll(async () => {
    pilot = await bindPilot();
    for (const view of Object.keys(VIEWS) as ViewName[]) {
      rows[view] = await pilot.db.all(`SELECT * FROM ${view}`);
    }
  });
  afterAll(() => pilot.db.close());

  describe("views over the pilot export (T058)", () => {
    it("every view row parses with the Zod row schemas", () => {
      for (const view of Object.keys(VIEWS) as ViewName[]) {
        const schema = rowSchema(view);
        for (const row of viewRows(view)) {
          const parsed = schema.safeParse(row);
          expect(parsed.success, `${view}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
        }
      }
      expect(viewRows("v_property").length).toBe(22);
      expect(viewRows("v_roofing_permit").length).toBe(41);
      expect(viewRows("v_run").length).toBe(1);
    });

    it("0 nulls in cid, table, table_cid, run_id, manifest_cid, as_of", () => {
      for (const view of ["v_property", "v_roofing_permit", "v_contractor"] as const) {
        for (const row of viewRows(view)) {
          for (const c of NEVER_NULL) expect(row[c], `${view}.${c}`).not.toBeNull();
        }
      }
    });

    it("every null nullable column has a missing entry (SC-007), and every uncarried field is listed", () => {
      for (const view of Object.keys(VIEWS) as ViewName[]) {
        const uncarried = view === "v_run" ? [] : UNCARRIED[view];
        for (const row of viewRows(view)) {
          const missing = new Map((row.missing as Missing).map((m) => [m.field, m.reason]));
          for (const col of VIEWS[view]) {
            if (row[col.name] !== null) continue;
            expect(col.nullable, `${view}.${col.name} is never null`).toBe(true);
            expect(missing.has(col.name), `${view}.${col.name}`).toBe(true);
          }
          for (const u of uncarried) expect(missing.get(u.field), u.field).toBe(u.reason);
        }
      }
    });

    it("v_run.limitations equals the pilot manifest's top-level limitations[] (T070)", () => {
      const manifest = JSON.parse(
        readFileSync(new URL("../../../contract/v1/pilot-manifest.json", import.meta.url), "utf8"),
      ) as { limitations: string[] };
      expect(manifest.limitations.length).toBeGreaterThan(0);
      expect(viewRows("v_run")[0]?.limitations).toEqual(manifest.limitations);
    });

    it("v_run of the first pilot run lists previous_manifest_cid as first_run (T069)", () => {
      const run = viewRows("v_run")[0];
      expect(run?.previous_manifest_cid).toBeNull();
      expect(run?.missing).toEqual([{ field: "previous_manifest_cid", reason: "first_run" }]);
    });

    it("v_property count = distinct cid in the county property table (mew M4)", async () => {
      const file = join(pilotDir, "tables/county/property/*.parquet");
      const n = await pilot.db.all(`SELECT count(DISTINCT cid)::INTEGER AS n FROM '${file}'`);
      expect(viewRows("v_property").length).toBe(n[0]?.n);
      const keys = new Set(viewRows("v_property").map((r) => r.property_cid));
      expect(keys.size).toBe(viewRows("v_property").length);
    });

    it("contractor_company_cid is non-null iff contractor_resolution = resolved", () => {
      for (const row of viewRows("v_roofing_permit")) {
        expect(row.contractor_company_cid !== null).toBe(row.contractor_resolution === "resolved");
      }
      expect(viewRows("v_contractor")).toEqual([]);
    });

    it("every v_roofing_permit row has bbb_status not_checked with a reason", () => {
      for (const row of viewRows("v_roofing_permit")) {
        expect(row.bbb_status).toBe("not_checked");
        expect(["contractor_unresolved", "no_lexicon_carrier"]).toContain(row.bbb_status_reason);
      }
    });

    it("each Expired pilot permit is stalled, never Completed or Cancelled, with status_raw/no_lexicon_carrier and improvement_status/enum_lacks_value", () => {
      for (const number of EXPIRED) {
        const row = viewRows("v_roofing_permit").find((r) => r.permit_number === number);
        expect(row, number).toBeDefined();
        expect(row?.status_class).toBe("stalled");
        expect(row?.improvement_status).toBeNull();
        expect(row?.missing).toEqual(
          expect.arrayContaining([
            { field: "status_raw", reason: "no_lexicon_carrier" },
            { field: "expiry_date", reason: "no_lexicon_carrier" },
            { field: "improvement_status", reason: "enum_lacks_value" },
          ]),
        );
      }
    });

    it("no trade sub-permit is in v_roofing_permit", () => {
      for (const row of viewRows("v_roofing_permit")) {
        expect(row.improvement_type).toBe("Roofing");
        expect(row.improvement_action).toBe("Replacement");
      }
      const numbers = viewRows("v_roofing_permit").map((r) => r.permit_number);
      expect(numbers).not.toContain("2026-038825 MP");
      expect(numbers).not.toContain("2026-089033 EP");
    });

    it("roof_date, roof_age_years, basis and confidence agree with the estimator ledger for every pilot property (oracle F1)", () => {
      const ledger = readFileSync(join(pilotDir, "ledger/roof-age.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map(
          (l) =>
            JSON.parse(l) as {
              pID: string;
              roof_date: string | null;
              estimate: {
                anchor: { type: string } | null;
                confidence: string;
                estimatedAgeYears: number | null;
              };
            },
        );
      const basisOf = (e: (typeof ledger)[number]["estimate"]): string =>
        e.anchor === null
          ? "unknown"
          : e.anchor.type === "property_built_year"
            ? "built_year"
            : e.confidence === "high"
              ? "permit"
              : "new_construction";
      const props = viewRows("v_property");
      expect(ledger.length).toBe(props.length);
      let agree = 0;
      for (const l of ledger) {
        const row = props.find((r) => r.request_identifier === l.pID);
        expect(row, l.pID).toBeDefined();
        expect(
          {
            roof_date: row?.roof_date,
            roof_age_years: row?.roof_age_years,
            roof_age_basis: row?.roof_age_basis,
            roof_age_confidence: row?.roof_age_confidence,
          },
          l.pID,
        ).toEqual({
          roof_date: l.roof_date,
          roof_age_years: l.estimate.estimatedAgeYears,
          roof_age_basis: basisOf(l.estimate),
          roof_age_confidence: l.estimate.anchor === null ? "none" : l.estimate.confidence,
        });
        agree += 1;
      }
      expect(agree).toBe(props.length);
    });

    it("structure.roof_date carries only the TCAD built year, never a permit date (oracle F1)", async () => {
      const rows = await pilot.db.all(`SELECT s.roof_date, p.property_structure_built_year AS built
        FROM county.structure s
        JOIN (SELECT DISTINCT from_cid, to_cid FROM county.property_has_structure) ps ON ps.to_cid = s.cid
        JOIN county.property p ON p.cid = ps.from_cid
        WHERE s.roof_date IS NOT NULL`);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(String(r.roof_date)).toBe(String(r.built));
      const permitBasis = viewRows("v_property").filter((r) => r.roof_age_basis === "permit");
      expect(permitBasis.length).toBeGreaterThan(0);
      expect(rows.length + permitBasis.length).toBe(viewRows("v_property").length);
    });

    it("table_cid equals the re-derived raw-leaves CID of its part", async () => {
      const parts = new Map<string, string>();
      for (const view of ["v_property", "v_roofing_permit"] as const) {
        for (const row of viewRows(view)) parts.set(String(row.table), String(row.table_cid));
      }
      expect([...parts.keys()].sort()).toEqual(["property", "property_improvement"]);
      const group = { property: "county", property_improvement: "property_improvement" };
      for (const [table, cid] of parts) {
        const g = group[table as keyof typeof group];
        const bytes = readFileSync(join(pilotDir, "tables", g, table, "part-00000.parquet"));
        expect(await rawCid(bytes), table).toBe(cid);
      }
    });
  });
}
