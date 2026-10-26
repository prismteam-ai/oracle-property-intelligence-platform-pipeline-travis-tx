// T015 measurement tests (synthetic page timings only).
import { describe, expect, it } from "vitest";
import {
  DECISION_THRESHOLD_HOURS,
  MAX_PAGE_SIZE,
  MIN_PAGES,
  MeasurementError,
  downloadRate,
  exceedsDecisionThreshold,
  measureThroughput,
  median,
  missingDecision,
  projectedHours,
  projectedHoursForSource,
  rowsPerMinute,
  type PageTiming,
} from "../travis/discovery/measure.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");

/** Consecutive full pages: page i starts where page i-1 ended and lasts durationsSec[i]. */
function pages(durationsSec: number[], pageSize = 50_000): PageTiming[] {
  const out: PageTiming[] = [];
  let t = T0;
  durationsSec.forEach((sec, i) => {
    const start = t;
    t += sec * 1000;
    out.push({
      offset: i * pageSize,
      rows: pageSize,
      started_at: new Date(start).toISOString(),
      ended_at: new Date(t).toISOString(),
    });
  });
  return out;
}

describe("constants", () => {
  it("fixes the clarification Q3 bounds and the 48-hour rule", () => {
    expect(MAX_PAGE_SIZE).toBe(50_000);
    expect(MIN_PAGES).toBe(3);
    expect(DECISION_THRESHOLD_HOURS).toBe(48);
  });
});

describe("median", () => {
  it("odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("rejects an empty list", () => {
    expect(() => median([])).toThrow(MeasurementError);
  });
});

describe("rowsPerMinute", () => {
  it("rows divided by elapsed minutes", () => {
    const [p] = pages([30]);
    expect(rowsPerMinute(p as PageTiming)).toBe(100_000);
  });
  it("rejects a zero or negative window", () => {
    const p: PageTiming = {
      offset: 0,
      rows: 50_000,
      started_at: "2026-01-01T00:00:00Z",
      ended_at: "2026-01-01T00:00:00Z",
    };
    expect(() => rowsPerMinute(p)).toThrow(MeasurementError);
  });
});

describe("measureThroughput", () => {
  it("is the median of at least 3 consecutive full pages of at most 50,000 rows", () => {
    // 30 s -> 100,000/min, 60 s -> 50,000/min, 20 s -> 150,000/min
    const result = measureThroughput(pages([30, 60, 20]), 50_000);
    expect(result).toEqual({
      rows_per_minute_median: 100_000,
      pages_read: 3,
      page_size: 50_000,
      window_start: "2026-01-01T00:00:00.000Z",
      window_end: "2026-01-01T00:01:50.000Z",
    });
  });

  it("uses every page when more than 3 are read", () => {
    const result = measureThroughput(pages([30, 60, 20, 15]), 50_000);
    expect(result.pages_read).toBe(4);
    expect(result.rows_per_minute_median).toBe(125_000);
  });

  it("rejects fewer than 3 pages", () => {
    expect(() => measureThroughput(pages([30, 30]), 50_000)).toThrow(MeasurementError);
  });

  it("rejects a page size above 50,000 rows", () => {
    expect(() => measureThroughput(pages([30, 30, 30], 50_001), 50_001)).toThrow(MeasurementError);
  });

  it("rejects a page that returned more rows than the page size", () => {
    const ps = pages([30, 30, 30]);
    (ps[1] as PageTiming).rows = 50_001;
    expect(() => measureThroughput(ps, 50_000)).toThrow(MeasurementError);
  });

  it("rejects a page that is not full", () => {
    const ps = pages([30, 30, 30]);
    (ps[2] as PageTiming).rows = 49_999;
    expect(() => measureThroughput(ps, 50_000)).toThrow(MeasurementError);
  });

  it("rejects pages that are not consecutive offsets", () => {
    const ps = pages([30, 30, 30]);
    (ps[2] as PageTiming).offset = 150_000;
    expect(() => measureThroughput(ps, 50_000)).toThrow(MeasurementError);
  });

  it("rejects pages read in parallel (overlapping windows)", () => {
    const ps = pages([30, 30, 30]);
    (ps[1] as PageTiming).started_at = "2026-01-01T00:00:10.000Z";
    expect(() => measureThroughput(ps, 50_000)).toThrow(MeasurementError);
  });
});

describe("projectedHours", () => {
  it("is denominator / median rows per minute / 60", () => {
    expect(projectedHours(2_400_000, 100_000)).toBeCloseTo(0.4, 10);
    expect(projectedHours(6_000_000, 1_000)).toBe(100);
  });
  it("rejects a non-positive rate", () => {
    expect(() => projectedHours(100, 0)).toThrow(MeasurementError);
  });
});

describe("the 48-hour rule", () => {
  it("only strictly above 48 h needs a decision", () => {
    expect(exceedsDecisionThreshold(48)).toBe(false);
    expect(exceedsDecisionThreshold(48.01)).toBe(true);
    expect(exceedsDecisionThreshold(null)).toBe(false);
    expect(exceedsDecisionThreshold(undefined)).toBe(false);
  });

  it("a source above 48 hours without a decision fails", () => {
    expect(missingDecision({ projected_full_capture_hours: 49 })).toBe(true);
    expect(
      missingDecision({ projected_full_capture_hours: 49, decision: "runtime retrieval" }),
    ).toBe(true);
    expect(
      missingDecision({
        projected_full_capture_hours: 49,
        decision: "runtime retrieval",
        decision_reason: "too slow to backfill",
      }),
    ).toBe(false);
    expect(missingDecision({ projected_full_capture_hours: 10 })).toBe(false);
  });
});

describe("single-file sources use download_rate", () => {
  it("downloadRate records MB (10^6 bytes) per minute", () => {
    const rate = downloadRate({
      bytes: 120_000_000,
      seconds: 60,
      source_url: "https://example.test/export.json",
      captured_at: "2026-01-01T00:00:00Z",
    });
    expect(rate).toEqual({
      megabytes_per_minute: 120,
      bytes: 120_000_000,
      seconds: 60,
      source_url: "https://example.test/export.json",
      captured_at: "2026-01-01T00:00:00Z",
    });
  });

  it("projected hours of a single file is its measured download time", () => {
    const download_rate = downloadRate({
      bytes: 600_000_000,
      seconds: 1_800,
      source_url: "https://example.test/export.json",
      captured_at: "2026-01-01T00:00:00Z",
    });
    expect(projectedHoursForSource({ download_rate })).toBe(0.5);
  });

  it("projected hours of a paged source uses its denominator and median rate", () => {
    expect(
      projectedHoursForSource({
        denominator: { value: 6_000_000 },
        throughput: { rows_per_minute_median: 1_000 },
      }),
    ).toBe(100);
  });

  it("is null when nothing was measured", () => {
    expect(projectedHoursForSource({ denominator: { value: null } })).toBeNull();
  });
});
