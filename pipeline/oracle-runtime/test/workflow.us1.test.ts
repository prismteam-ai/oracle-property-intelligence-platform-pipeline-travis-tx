// Supporting tests for T025: the US1 probe steps run through the workflow and assemble the
// `sources` and `parcel` blocks. This is the US1 independent test on synthetic probe
// output: the assembled catalog passes checker rules 1-5 and 8. Synthetic responses only
// (test-only); an injected fetch answers every host, nothing real is called.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { USER_AGENT, createSourceClient, type FetchLike } from "../travis/lib/source-client.js";
import { CatalogSchema, SOURCE_KEYS } from "../travis/discovery/catalog.schema.js";
import { checkCatalog } from "../travis/discovery/check-catalog.js";
import {
  buildUs1Catalog,
  createUs1Probes,
  runSourceDiscovery,
  type DiscoveryIO,
  type RunRecord,
} from "../travis/discovery/workflow.js";
import { OVERTURE_MISSING_REASON } from "../travis/discovery/probes/evidence.js";
import {
  fakeHttp,
  hangUntilAborted,
  json,
  silent,
  steppingClock,
  text,
  type Route,
} from "./fixtures/fake-http.js";
import { must } from "./helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");
const FULL_PAGE = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ id: i })));
const LANDING = `<html><body><p>Certified on July 25, 2026.</p>
<a href="/files/2026-special-export.json">2026 Certified Special Export (JSON)</a>
<a href="/files/layouts.zip">Export Layouts</a>
<a href="/files/supp-1.zip">2026 Supplemental Appraisal Roll Export 1</a></body></html>`;
const EXPORT = JSON.stringify([{ prop_id: 1, deed_date: "2020-01-01" }, { prop_id: 2 }]);

/** Rules 1-5 and 8 only: the US1 catalog has no permits block yet (rules 6-7 are US2). */
function us1Rules(catalog: Parameters<typeof checkCatalog>[0]): string[] {
  return checkCatalog(catalog).filter((l) => !/^FAIL rule [67]:/.test(l));
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function socrata(host: string, counts: Record<string, string>): Route[] {
  return [
    {
      match: (u) => u.host === host && u.searchParams.get("$group") === "jurisdiction",
      respond: () =>
        json([
          { jurisdiction: "AUSTIN FULL PURPOSE", count: "100" },
          { jurisdiction: "LAKEWAY FULL PURPOSE", count: "7" },
        ]),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$order") === ":id",
      respond: () => new Response(FULL_PAGE, { headers: { "content-type": "application/json" } }),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$select") === "count(*)",
      respond: (u) => json([{ count: counts[u.searchParams.get("$where") ?? ""] ?? "0" }]),
    },
  ];
}

interface Scenario {
  tcadBlocked?: boolean;
  gisHang?: boolean;
  bbbBlocked?: boolean;
}

function routes(opts: Scenario = {}): Route[] {
  return [
    ...socrata("data.austintexas.gov", { "": "2400000", "tcad_id IS NULL": "1234" }),
    ...socrata("data.texas.gov", { "": "90000", "taxpayer_county_code='227'": "3000" }),
    {
      match: (u) => u.host === "traviscad.org",
      respond: (u) => {
        if (opts.tcadBlocked) return text("Forbidden", 403);
        if (u.pathname === "/publicinformation") return text(LANDING);
        if (u.pathname === "/files/layouts.zip")
          return new Response("PK", { headers: { "content-type": "application/zip" } });
        return new Response(EXPORT, { headers: { "content-type": "application/json" } });
      },
    },
    {
      match: (u) => u.host === "gis.traviscountytx.gov",
      respond: (_u, init) => (opts.gisHang ? hangUntilAborted(init) : json({ count: 2 })),
    },
    {
      match: (u) => u.host.endsWith("bbb.org"),
      respond: () =>
        opts.bbbBlocked
          ? text("<html>Just a moment...</html>", 403)
          : text("<html>synthetic listing page</html>"),
    },
    { match: () => true, respond: () => text("<html>synthetic evidence page</html>") },
  ];
}

function fakeIO(): { io: DiscoveryIO; journal: string[]; saved: RunRecord[] } {
  const journal: string[] = [];
  const saved: RunRecord[] = [];
  return {
    journal,
    saved,
    io: {
      now: async () => FIXED,
      run: async (name, fn) => {
        journal.push(name);
        return fn();
      },
      save: (r) => {
        saved.push(structuredClone(r));
      },
    },
  };
}

async function run(opts: Scenario = {}) {
  const rawDir = mkdtempSync(join(tmpdir(), "us1-raw-"));
  tmpDirs.push(rawDir);
  const { fetch } = fakeHttp(routes(opts));
  const probes = createUs1Probes({
    client: createSourceClient({
      fetch: fetch as FetchLike,
      sleep: async () => undefined,
      random: () => 0,
      now: () => FIXED,
      log: silent,
    }),
    now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    rawDir,
    gisTimeoutMs: 20,
  });
  const { io, journal, saved } = fakeIO();
  const out = await runSourceDiscovery(io, "run-us1", probes);
  const catalog = buildUs1Catalog(out.blocks, FIXED.toISOString().replace(".000Z", "Z"), 0);
  return { out, catalog, journal, saved };
}

describe("US1 discovery on synthetic probe output", () => {
  it("all sources reachable: READY, 9 rows in order, catalog passes rules 1-5 and 8", async () => {
    const { out, catalog, journal } = await run();
    expect(out.record.state).toBe("READY");
    expect(out.record.auto_advance_to_seed).toBe(false);
    expect(journal.every((k) => /^[a-z_]+:[a-z_]+:2026-01-01$/.test(k))).toBe(true);
    expect(catalog.sources.map((s) => s.key)).toEqual([...SOURCE_KEYS]);
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
    expect(us1Rules(catalog)).toEqual([]);

    const austin = must(catalog.sources.find((s) => s.key === "austin_permits"));
    expect(austin.denominator.value).toBe(2_400_000);
    expect(must(austin.tcad_id_null_count).value).toBe(1234);
    expect(austin.decision).toBe("ingest");
    expect(austin.projected_full_capture_hours).toBeCloseTo(0.4, 5);

    const comptroller = must(catalog.sources.find((s) => s.key === "tx_comptroller"));
    expect(comptroller.denominator.value).toBe(must(comptroller.travis_coded_rows).value);

    const overture = must(catalog.sources.find((s) => s.key === "overture"));
    expect(overture.denominator.missing_reason).toBe(OVERTURE_MISSING_REASON);

    const licensing = must(catalog.sources.find((s) => s.key === "contractor_licensing"));
    expect(licensing.decision_reason).toContain("no statewide roofing licence");

    const parcel = must(catalog.parcel);
    expect(parcel.canonical_source).toBe("TCAD 2026 certified roll");
    expect(parcel.assessed_parcel_count).toBe(2);
    expect(parcel.gis_feature_count).toBe(2);
    expect(parcel.gap_pct).toBe(0);
    expect(parcel.roll_year).toBe(2026);
    expect(parcel.certification_date).toBe("2026-07-25");
    expect(parcel.identifier_name).toBe("prop_id");
    expect(parcel.deed_or_sale_dates_present).toBe(true);
    expect(must(parcel.export_receipt).bytes).toBe(Buffer.byteLength(EXPORT));
  });

  it("a BBB challenge alone is a blocked source: WAITING_HUMAN, enrichment.bbb blocked", async () => {
    const { out, catalog } = await run({ bbbBlocked: true });
    expect(out.record.state).toBe("WAITING_HUMAN");
    expect(out.record.blockers.map((b) => b.source_key)).toEqual(["bbb"]);
    const bbb = must(catalog.sources.find((s) => s.key === "bbb"));
    expect(bbb.status).toBe("blocked");
    expect(must(bbb.blocked_evidence).attempts).toBe(1);
    expect(must(catalog.enrichment).bbb.status).toBe("blocked");
    expect(us1Rules(catalog)).toEqual([]);
  });

  it("TCAD 403 + GIS timeout: WAITING_HUMAN, roll null with reason, gap unknown, never GIS as denominator", async () => {
    const { out, catalog } = await run({ tcadBlocked: true, gisHang: true, bbbBlocked: true });
    expect(out.record.state).toBe("WAITING_HUMAN");
    expect(out.record.blockers.map((b) => b.source_key)).toEqual(
      expect.arrayContaining(["tcad_certified", "tcad_supplemental", "tcad_gis", "bbb"]),
    );
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
    expect(us1Rules(catalog)).toEqual([]);

    const parcel = must(catalog.parcel);
    expect(parcel.assessed_parcel_count).toBeNull();
    expect(parcel.assessed_parcel_count_measurement.missing_reason).toMatch(/403/);
    expect(parcel.gis_feature_count).toBeNull();
    expect(parcel.gap_pct).toBe("unknown");
    expect(must(parcel.gap_reason).length).toBeGreaterThan(0);

    const tcad = must(catalog.sources.find((s) => s.key === "tcad_certified"));
    expect(tcad.status).toBe("blocked");
    expect(must(tcad.blocked_evidence)).toMatchObject({
      http_status: 403,
      attempts: 1,
      user_agent: USER_AGENT,
      outcome: "blocked",
      geo_signal: "none",
    });
    const gis = must(catalog.sources.find((s) => s.key === "tcad_gis"));
    expect(gis.status).toBe("blocked");
    expect(must(must(gis.blocked_evidence).timeout_ms)).toBeGreaterThan(0);
    for (const s of [tcad, gis]) expect(must(s.anti_bot).length).toBeGreaterThan(0);
  });
});
