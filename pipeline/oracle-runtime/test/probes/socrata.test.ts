// T016 Socrata probe tests. Synthetic responses only (test-only): an injected fetch
// answers every request, so data.austintexas.gov and data.texas.gov are never called.
import { describe, expect, it } from "vitest";
import { createSourceClient, type FetchLike } from "../../travis/lib/source-client.js";
import {
  AUSTIN_PERMITS_RESOURCE,
  COMPTROLLER_COUNTY_FIELD,
  COMPTROLLER_RESOURCE,
  PAGE_SIZE,
  TRAVIS_COUNTY_CODE,
  probeAustinPermits,
  probeComptroller,
  soqlUrl,
} from "../../travis/discovery/probes/socrata.js";
import { MeasurementSchema } from "../../travis/discovery/catalog.schema.js";
import { fakeHttp, json, silent, steppingClock, text, type Route } from "../fixtures/fake-http.js";
import { must } from "../helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");

function client(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
    appToken: "",
  });
}

const params = (u: URL) => ({
  select: u.searchParams.get("$select"),
  where: u.searchParams.get("$where"),
  group: u.searchParams.get("$group"),
  order: u.searchParams.get("$order"),
  limit: u.searchParams.get("$limit"),
  offset: u.searchParams.get("$offset"),
});

const page = (n: number) => Array.from({ length: n }, (_, i) => ({ permit_number: `S-${i}` }));
const FULL_PAGE = JSON.stringify(page(50_000));

function austinRoutes(overrides: Partial<Record<"count" | "nullCount", () => Response>> = {}) {
  const routes: Route[] = [
    {
      match: (u) => u.pathname.endsWith("/3syk-w9eu.json") && params(u).group === "jurisdiction",
      respond: () =>
        json([
          { jurisdiction: "AUSTIN FULL PURPOSE", count: "2000000" },
          { jurisdiction: "LAKEWAY FULL PURPOSE", count: "11" },
          { jurisdiction: "BEE CAVE FULL PURPOSE", count: "22" },
          { jurisdiction: "PFLUGERVILLE FULL PURPOSE", count: "33" },
          { jurisdiction: "PFLUGERVILLE ETJ", count: "44" },
          { count: "5" },
        ]),
    },
    {
      match: (u) =>
        u.pathname.endsWith("/3syk-w9eu.json") &&
        params(u).select === "count(*)" &&
        params(u).where === "tcad_id IS NULL",
      respond: overrides.nullCount ?? (() => json([{ count: "1234" }])),
    },
    {
      match: (u) =>
        u.pathname.endsWith("/3syk-w9eu.json") &&
        params(u).select === "count(*)" &&
        params(u).where === null,
      respond: overrides.count ?? (() => json([{ count: "2400000" }])),
    },
    {
      match: (u) => u.pathname.endsWith("/3syk-w9eu.json") && params(u).order === ":id",
      respond: () =>
        new Response(FULL_PAGE, { status: 200, headers: { "content-type": "application/json" } }),
    },
  ];
  return routes;
}

describe("soqlUrl", () => {
  it("builds a readable SoQL query URL with encoded values", () => {
    const url = soqlUrl(AUSTIN_PERMITS_RESOURCE, {
      $select: "count(*)",
      $where: "tcad_id IS NULL",
    });
    expect(url).toBe(
      "https://data.austintexas.gov/resource/3syk-w9eu.json?$select=count(*)&$where=tcad_id%20IS%20NULL",
    );
    expect(new URL(url).searchParams.get("$where")).toBe("tcad_id IS NULL");
  });

  it("targets the real public resources (constants only; never called in tests)", () => {
    expect(AUSTIN_PERMITS_RESOURCE).toBe("https://data.austintexas.gov/resource/3syk-w9eu.json");
    expect(COMPTROLLER_RESOURCE).toBe("https://data.texas.gov/resource/9cir-efmm.json");
    expect(TRAVIS_COUNTY_CODE).toBe("227");
    expect(PAGE_SIZE).toBe(50_000);
  });
});

describe("probeAustinPermits (3syk-w9eu)", () => {
  it("records count, null tcad_id count, jurisdiction group-by and 3-page throughput", async () => {
    const { fetch, calls } = fakeHttp(austinRoutes());
    const result = await probeAustinPermits({
      client: client(fetch),
      now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    });

    expect(result.status).toBe("available");
    expect(result.blocked_receipt).toBeNull();

    expect(result.denominator).toMatchObject({ value: 2_400_000, method: "count(*)" });
    expect(new URL(result.denominator.source_url).searchParams.get("$select")).toBe("count(*)");
    expect(result.denominator.captured_at).toBe("2026-01-01T00:00:00.000Z");
    expect(MeasurementSchema.safeParse(result.denominator).success).toBe(true);

    expect(result.tcad_id_null_count.value).toBe(1234);
    expect(new URL(result.tcad_id_null_count.source_url).searchParams.get("$where")).toBe(
      "tcad_id IS NULL",
    );
    expect(MeasurementSchema.safeParse(result.tcad_id_null_count).success).toBe(true);

    const located = result.located_in_other_jurisdictions.map(
      (x) => `${x.jurisdiction}=${x.value}`,
    );
    expect(located).toEqual([
      "LAKEWAY FULL PURPOSE=11",
      "BEE CAVE FULL PURPOSE=22",
      "PFLUGERVILLE FULL PURPOSE=33",
      "PFLUGERVILLE ETJ=44",
    ]);
    for (const x of result.located_in_other_jurisdictions) {
      expect(new URL(x.source_url).searchParams.get("$group")).toBe("jurisdiction");
      expect(x.captured_at).toBe("2026-01-01T00:00:00.000Z");
    }

    // 3 pages read one after another, ordered by :id, 50,000 rows each, consecutive offsets
    const pageCalls = calls
      .map((c) => new URL(c.url))
      .filter((u) => u.searchParams.get("$order") === ":id");
    expect(pageCalls.map((u) => [params(u).limit, params(u).offset])).toEqual([
      ["50000", "0"],
      ["50000", "50000"],
      ["50000", "100000"],
    ]);

    // stepping clock: each page spans 30 s -> 100,000 rows/min
    expect(result.throughput).toEqual({
      rows_per_minute_median: 100_000,
      pages_read: 3,
      page_size: 50_000,
      window_start: expect.any(String),
      window_end: expect.any(String),
      app_token_used: false,
      rate_limits_observed: "none observed",
    });
    expect(result.app_token_used).toBe(false);
  });

  it("reads pages sequentially, never in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const base = fakeHttp(austinRoutes());
    const fetch: FetchLike = async (url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      try {
        return await base.fetch(url, init);
      } finally {
        inFlight -= 1;
      }
    };
    await probeAustinPermits({
      client: client(fetch),
      now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    });
    expect(maxInFlight).toBe(1);
  });

  it("reads at most 150,000 rows (measurement, not ingest)", async () => {
    const { fetch, calls } = fakeHttp(austinRoutes());
    await probeAustinPermits({
      client: client(fetch),
      now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    });
    const rowsRequested = calls
      .map((c) => new URL(c.url))
      .filter((u) => u.searchParams.get("$order") === ":id")
      .reduce((sum, u) => sum + Number(u.searchParams.get("$limit")), 0);
    expect(rowsRequested).toBeLessThanOrEqual(150_000);
  });

  it("a challenge page instead of JSON stops the source: blocked, null measurements with reasons", async () => {
    const { fetch, calls } = fakeHttp(
      austinRoutes({ count: () => text("<html>Just a moment...</html>") }),
    );
    const result = await probeAustinPermits({
      client: client(fetch),
      now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    });
    expect(result.status).toBe("blocked");
    expect(must(result.blocked_receipt).outcome).toBe("blocked");
    expect(result.denominator.value).toBeNull();
    expect(result.denominator.missing_reason).toMatch(/blocked/);
    expect(result.throughput).toBeNull();
    expect(calls).toHaveLength(1); // StopOnBlocked: nothing more is asked of that source
  });

  it("429 exhausted after 5 attempts: null with 'throttled: 5 attempts exhausted'", async () => {
    const { fetch } = fakeHttp(austinRoutes({ count: () => json({}, 429) }));
    const result = await probeAustinPermits({
      client: client(fetch),
      now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    });
    expect(result.status).toBe("blocked");
    expect(must(result.blocked_receipt).outcome).toBe("failed");
    expect(result.denominator.value).toBeNull();
    expect(result.denominator.missing_reason).toMatch(/^throttled: 5 attempts exhausted/);
  });
});

describe("probeComptroller (9cir-efmm)", () => {
  function comptrollerRoutes(): Route[] {
    return [
      {
        match: (u) =>
          u.pathname.endsWith("/9cir-efmm.json") &&
          params(u).select === "count(*)" &&
          params(u).where === `${COMPTROLLER_COUNTY_FIELD}='227'`,
        respond: () => json([{ count: "3000" }]),
      },
      {
        match: (u) =>
          u.pathname.endsWith("/9cir-efmm.json") &&
          params(u).select === "count(*)" &&
          params(u).where === null,
        respond: () => json([{ count: "90000" }]),
      },
      {
        match: (u) => u.pathname.endsWith("/9cir-efmm.json") && params(u).order === ":id",
        respond: () =>
          new Response(FULL_PAGE, { status: 200, headers: { "content-type": "application/json" } }),
      },
    ];
  }

  it("returns travis_coded_rows (county code 227) and statewide_rows, each with provenance", async () => {
    const { fetch } = fakeHttp(comptrollerRoutes());
    const result = await probeComptroller({
      client: client(fetch),
      now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    });
    expect(result.status).toBe("available");
    expect(result.travis_coded_rows).toMatchObject({ value: 3000, method: "count(*)" });
    expect(new URL(result.travis_coded_rows.source_url).searchParams.get("$where")).toBe(
      `${COMPTROLLER_COUNTY_FIELD}='227'`,
    );
    expect(result.statewide_rows).toMatchObject({ value: 90_000, method: "count(*)" });
    expect(result.statewide_rows.source_url).toContain("data.texas.gov/resource/9cir-efmm.json");
    for (const m of [result.travis_coded_rows, result.statewide_rows]) {
      expect(MeasurementSchema.safeParse(m).success).toBe(true);
    }
    expect(must(result.throughput).pages_read).toBe(3);
  });
});
