// A-04 T011 (A-04-TC-NF-01): page count, duration and throughput rows for
// docs/source-limits.md. Synthetic run figures only (test-only); nothing is measured here.
import { describe, expect, it } from "vitest";
import { throughputRow } from "../../../travis/backbone/source-limits.js";

describe("A-04-TC-NF-01 throughputRow", () => {
  it("A-04-TC-NF-01 GIS input: pages, duration_s, rows_per_s (2 decimals) and the markdown row", () => {
    const r = throughputRow({
      source: "GIS",
      pages: 187,
      rows: 373683,
      startedAt: "2026-10-22T03:00:00Z",
      finishedAt: "2026-10-22T03:12:34Z",
      concurrency: 2,
    });
    expect(r.pages).toBe(187);
    expect(r.duration_s).toBe(754);
    expect(r.rows_per_s).toBe(495.6);
    expect(r.markdown).toBe(
      "| GIS | 187 | 373683 | 754 | 495.60 | 2 | 2026-10-22T03:00:00Z | 2026-10-22T03:12:34Z |",
    );
  });

  it("A-04-TC-NF-01 Austin input", () => {
    const r = throughputRow({
      source: "Austin",
      pages: 3,
      rows: 2500,
      startedAt: "2026-10-22T04:00:00.000Z",
      finishedAt: "2026-10-22T04:00:03.000Z",
      concurrency: 1,
    });
    expect(r).toMatchObject({ pages: 3, duration_s: 3, rows_per_s: 833.33 });
    expect(r.markdown).toMatch(/^\| Austin \| 3 \| 2500 \| 3 \| 833\.33 \| 1 \|/);
  });

  it("A-04-TC-NF-01 a missing field fails naming it", () => {
    expect(() =>
      throughputRow({
        source: "GIS",
        rows: 1,
        startedAt: "2026-10-22T03:00:00Z",
        finishedAt: "2026-10-22T03:00:01Z",
        concurrency: 2,
      } as never),
    ).toThrow(/pages/);
    expect(() =>
      throughputRow({
        source: "GIS",
        pages: 1,
        rows: 1,
        startedAt: "2026-10-22T03:00:01Z",
        finishedAt: "2026-10-22T03:00:00Z",
        concurrency: 2,
      }),
    ).toThrow(/finishedAt/);
  });
});
