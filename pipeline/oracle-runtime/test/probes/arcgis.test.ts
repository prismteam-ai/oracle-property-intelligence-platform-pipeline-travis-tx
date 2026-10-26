// T018 ArcGIS probe tests. Synthetic responses only (test-only); the Travis County GIS
// server is never called.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourceClient, type FetchLike } from "../../travis/lib/source-client.js";
import {
  GIS_TIMEOUT_MS,
  TCAD_GIS_LAYER_URL,
  computeGap,
  gapPercent,
  gisCountUrl,
  probeGisCount,
} from "../../travis/discovery/probes/arcgis.js";
import { MeasurementSchema, type Measurement } from "../../travis/discovery/catalog.schema.js";
import { fakeHttp, hangUntilAborted, json, silent } from "../fixtures/fake-http.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");
const AT = "2026-01-01T00:00:00Z";

function client(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
}

function m(value: number | null, reason?: string): Measurement {
  return value === null
    ? {
        value,
        missing_reason: reason ?? "synthetic",
        source_url: "https://example.test/x",
        captured_at: AT,
      }
    : { value, source_url: "https://example.test/x", captured_at: AT };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("constants", () => {
  it("names the real TCAD_PARCELS layer and a 60 s timeout", () => {
    expect(TCAD_GIS_LAYER_URL).toBe(
      "https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6",
    );
    expect(GIS_TIMEOUT_MS).toBe(60_000);
  });

  it("asks for a count only", () => {
    const u = new URL(gisCountUrl());
    expect(u.pathname.endsWith("/MapServer/6/query")).toBe(true);
    expect(u.searchParams.get("returnCountOnly")).toBe("true");
    expect(u.searchParams.get("where")).toBe("1=1");
    expect(u.searchParams.get("f")).toBe("json");
  });
});

describe("probeGisCount", () => {
  it("makes exactly one returnCountOnly=true request and records the count", async () => {
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => json({ count: 1000 }) },
    ]);
    const result = await probeGisCount({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("returnCountOnly")).toBe("true");
    expect(result.status).toBe("available");
    expect(result.gis_feature_count).toMatchObject({ value: 1000, method: "returnCountOnly" });
    expect(MeasurementSchema.safeParse(result.gis_feature_count).success).toBe(true);
  });

  it("a 60 s timeout gives gis_feature_count null, blocked evidence and one attempt", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: (_u, init) => hangUntilAborted(init) },
    ]);
    const pending = probeGisCount({ client: client(fetch), now: () => FIXED });
    await vi.advanceTimersByTimeAsync(GIS_TIMEOUT_MS);
    const result = await pending;
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("blocked");
    expect(result.receipt).toMatchObject({
      outcome: "blocked",
      blocked_reason: "timeout",
      timeout_ms: 60_000,
      attempts: 1,
    });
    expect(result.gis_feature_count.value).toBeNull();
    expect(result.gis_feature_count.missing_reason).toMatch(/timeout after 60000 ms/);
    expect(MeasurementSchema.safeParse(result.gis_feature_count).success).toBe(true);
  });

  it("an ArcGIS error body (no count) is not read as 0", async () => {
    const { fetch } = fakeHttp([
      {
        match: () => true,
        respond: () => json({ error: { code: 499, message: "Token Required" } }),
      },
    ]);
    const result = await probeGisCount({ client: client(fetch), now: () => FIXED });
    expect(result.status).toBe("blocked");
    expect(result.gis_feature_count.value).toBeNull();
  });
});

describe("computeGap (GIS is never the denominator)", () => {
  it("gap % uses the roll as the denominator", () => {
    expect(computeGap(m(1010), m(1000))).toEqual({ gap_pct: 0.99 });
    expect(computeGap(m(1000), m(1100))).toEqual({ gap_pct: 10 });
  });

  it("null GIS gives gap_pct unknown with a reason", () => {
    const gap = computeGap(m(1000), m(null, "timeout after 60000 ms at 2026-01-01T00:00:00Z"));
    expect(gap.gap_pct).toBe("unknown");
    expect(gap.gap_reason).toMatch(/GIS count missing: timeout after 60000 ms/);
  });

  it("a missing roll gives unknown too, and GIS is not substituted", () => {
    const gap = computeGap(m(null, "TCAD blocked: HTTP 403"), m(1000));
    expect(gap.gap_pct).toBe("unknown");
    expect(gap.gap_reason).toMatch(/roll count missing: TCAD blocked: HTTP 403/);
  });
});

// A-04 T004 (CR2-9): the pure gap rule G-GIS imports. Synthetic numbers only.
describe("CR2-9 gapPercent(roll, gis)", () => {
  it("is |roll - gis| / roll in percent at 3 decimals, the roll the denominator", () => {
    expect(gapPercent(493246, 373683)).toBe(24.24);
    expect(gapPercent(3, 2)).toBe(33.333);
    expect(gapPercent(100, 150)).toBe(50);
  });

  it("is unknown when the roll is 0 or negative", () => {
    expect(gapPercent(0, 10)).toBe("unknown");
    expect(gapPercent(-5, 10)).toBe("unknown");
  });

  it("computeGap uses the same rule", () => {
    const m = (value: number): Measurement => ({
      value,
      source_url: "https://gis.test/",
      captured_at: AT,
    });
    expect(computeGap(m(493246), m(373683)).gap_pct).toBe(gapPercent(493246, 373683));
  });
});
