// A-11 T016 (US2, G-RUN wave 1): per-source watermark + content-digest delta computation.
// Must fail before src/incremental/delta.ts (T017) exists, then pass against it.
//
// Core claim under test: a 100%-of-window bulk re-stamp (A-04's 2026-10-19 Austin event, every
// row's `:updated_at` moves within a short span, content digests do not) must produce a delta
// computed from content digests, never from the timestamp field — i.e. zero real `changed` rows
// when nothing actually changed, and exactly the changed count when a few rows truly did,
// regardless of every row's timestamp having moved. The re-stamp rule reused from A-04
// (restamp.ts, imported through delta.ts, never re-derived here): window >= 50% of the source
// total, OR >= 90% of the window within one 6h span.
import { describe, expect, it } from "vitest";
import {
  commitDelta,
  computeSourceDelta,
  contentDigest,
  INCREMENTAL_SOURCES,
  NO_NEWER_EXPORT,
  pendingDelta,
  RESTAMP_LIMITATION,
  toSourceRecord,
  type HourCount,
  type SourceRecord,
} from "../src/incremental/delta.js";

/** A synthetic Austin-shaped permit row; `permit_number` is the key, everything else is content. */
function permitRow(i: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    permit_number: `2026-${String(i).padStart(6, "0")} BP`,
    status_current: "Active",
    description: `permit ${i}`,
    ...overrides,
  };
}

const VOLATILE_FIELDS: readonly string[] = ["issued_in_last_30_days", "day_issued"];

/** One hour bucket holding every row, so the window is 100% concentrated (re-stamp by concentration or share). */
function singleHourBucket(hour: string, n: number): HourCount[] {
  return [{ hour, n }];
}

describe("computeSourceDelta (FR-006: digest, never the timestamp field)", () => {
  it("INCREMENTAL_SOURCES is exactly the three D-2(c) sources, in order", () => {
    expect(INCREMENTAL_SOURCES).toEqual(["austin_permits", "tcad_supplemental", "bbb_harvest"]);
  });

  it("100%-of-window re-stamp, no real content change: restamp detected, delta is {0,0,0} from digests, RESTAMP_LIMITATION recorded, no changed rows even though every timestamp moved", () => {
    const total = 1000;
    const rows = Array.from({ length: total }, (_, i) => permitRow(i + 1));
    // Every row's timestamp moves (bulk re-stamp); no content changes.
    const previousDigests = new Map(
      rows.map((r) => [r.permit_number as string, contentDigest(r, VOLATILE_FIELDS)]),
    );
    const windowRows: SourceRecord[] = rows.map((r) =>
      toSourceRecord(r, {
        key: r.permit_number as string,
        updatedAt: "2026-10-19T12:30:00.000Z", // new timestamp for every row
        volatileFields: VOLATILE_FIELDS,
      }),
    );
    const result = computeSourceDelta({
      source: "austin_permits",
      total,
      windowRows, // window == total: a 100% re-stamp
      hours: singleHourBucket("2026-10-19T12:00:00.000", total),
      previousDigests,
      newWatermark: "2026-10-19T12:43:00.000Z",
    });

    expect(result.restamp.detected).toBe(true);
    expect(result.restamp.reasons).toEqual(
      expect.arrayContaining(["window_share", "window_concentrated"]),
    );
    // The whole point: even though every single row's timestamp changed, the digest-based delta
    // is {0,0,0} because no row's *content* actually changed.
    expect(result.delta).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(result.records).toBe(total);
    expect(result.limitations).toContain(RESTAMP_LIMITATION);
    expect(result.limitations).toContain(NO_NEWER_EXPORT);
  });

  it("100%-of-window re-stamp WITH a few real content changes: only the content-changed rows count as changed, found by digest not by the (universally moved) timestamp", () => {
    const total = 1000;
    const rows = Array.from({ length: total }, (_, i) => permitRow(i + 1));
    const previousDigests = new Map(
      rows.map((r) => [r.permit_number as string, contentDigest(r, VOLATILE_FIELDS)]),
    );
    // Re-stamp every row's timestamp; genuinely change content on 3 of them only.
    const changedKeys = new Set([
      rows[9]?.permit_number,
      rows[499]?.permit_number,
      rows[989]?.permit_number,
    ]);
    const windowRows: SourceRecord[] = rows.map((r) => {
      const key = r.permit_number as string;
      const row = changedKeys.has(key) ? { ...r, status_current: "Final" } : r;
      return toSourceRecord(row, {
        key,
        updatedAt: "2026-10-19T12:35:00.000Z",
        volatileFields: VOLATILE_FIELDS,
      });
    });
    const result = computeSourceDelta({
      source: "austin_permits",
      total,
      windowRows,
      hours: singleHourBucket("2026-10-19T12:00:00.000", total),
      previousDigests,
      newWatermark: "2026-10-19T12:43:00.000Z",
    });

    expect(result.restamp.detected).toBe(true);
    expect(result.delta).toEqual({ added: 0, changed: 3, removed: 0 });
    expect(result.limitations).toContain(RESTAMP_LIMITATION);
    expect(result.limitations).not.toContain(NO_NEWER_EXPORT);
  });

  it("a small window spread over days is NOT a re-stamp (A-04's threshold), and a timestamp-only change (no content change) still yields changed: 0", () => {
    const total = 1000;
    const rows = Array.from({ length: 3 }, (_, i) => permitRow(i + 1));
    const previousDigests = new Map(
      rows.map((r) => [r.permit_number as string, contentDigest(r, VOLATILE_FIELDS)]),
    );
    const windowRows: SourceRecord[] = rows.map((r, i) =>
      toSourceRecord(r, {
        key: r.permit_number as string,
        updatedAt: `2026-10-${19 + i}T08:00:00.000Z`,
        volatileFields: VOLATILE_FIELDS,
      }),
    );
    const hours: HourCount[] = [
      { hour: "2026-10-19T08:00:00.000", n: 1 },
      { hour: "2026-10-20T08:00:00.000", n: 1 },
      { hour: "2026-10-21T08:00:00.000", n: 1 },
    ];
    const result = computeSourceDelta({
      source: "austin_permits",
      total,
      windowRows,
      hours,
      previousDigests,
      newWatermark: "2026-10-21T08:00:00.000Z",
    });
    expect(result.restamp.detected).toBe(false);
    expect(result.delta).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(result.limitations).not.toContain(RESTAMP_LIMITATION);
    expect(result.limitations).toContain(NO_NEWER_EXPORT);
  });

  it("a key with no previous digest is added, not changed", () => {
    const row = permitRow(1);
    const result = computeSourceDelta({
      source: "tcad_supplemental",
      total: 1,
      windowRows: [
        toSourceRecord(row, {
          key: row.permit_number as string,
          updatedAt: "2026-10-19T00:00:00.000Z",
          volatileFields: VOLATILE_FIELDS,
        }),
      ],
      hours: singleHourBucket("2026-10-19T00:00:00.000", 1),
      previousDigests: new Map(),
      newWatermark: "2026-10-19",
    });
    expect(result.delta).toEqual({ added: 1, changed: 0, removed: 0 });
  });

  it("removed is only computed when currentKeys (a full keyset) is supplied; omitted it stays 0 even though a previous key vanished", () => {
    const previousDigests = new Map([
      ["kept", "digest-a"],
      ["gone", "digest-b"],
    ]);
    const windowRows: SourceRecord[] = [{ key: "kept", digest: "digest-a", updatedAt: null }];
    const withoutCurrentKeys = computeSourceDelta({
      source: "bbb_harvest",
      total: 2,
      windowRows,
      hours: [],
      previousDigests,
      newWatermark: "2026-10-19",
    });
    expect(withoutCurrentKeys.delta.removed).toBe(0);

    const withCurrentKeys = computeSourceDelta({
      source: "bbb_harvest",
      total: 2,
      windowRows,
      hours: [],
      previousDigests,
      currentKeys: new Set(["kept"]),
      newWatermark: "2026-10-19",
    });
    expect(withCurrentKeys.delta.removed).toBe(1);
  });

  it("records is the window size, and the watermark is passed through untouched", () => {
    const result = computeSourceDelta({
      source: "tcad_supplemental",
      total: 0,
      windowRows: [],
      hours: [],
      previousDigests: new Map(),
      newWatermark: null,
    });
    expect(result.records).toBe(0);
    expect(result.watermark).toBeNull();
    expect(result.limitations).toContain(NO_NEWER_EXPORT);
  });

  // T020: source_removed tombstones (a reconciliation-layer fact) count into `removed` even on a
  // narrow incremental window, where currentKeys (a full keyset read) was never supplied.
  describe("tombstones (T020): source_removed keys count into removed without a full keyset read", () => {
    it("a tombstoned key previously published counts as removed, with no currentKeys at all", () => {
      const previousDigests = new Map([
        ["kept", "digest-a"],
        ["gone", "digest-b"],
      ]);
      const result = computeSourceDelta({
        source: "bbb_harvest",
        total: 2,
        windowRows: [{ key: "kept", digest: "digest-a", updatedAt: null }],
        hours: [],
        previousDigests,
        tombstones: new Set(["gone"]),
        newWatermark: "2026-10-19",
      });
      expect(result.delta.removed).toBe(1);
    });

    it("a tombstoned key never previously published removes nothing", () => {
      const result = computeSourceDelta({
        source: "bbb_harvest",
        total: 1,
        windowRows: [],
        hours: [],
        previousDigests: new Map([["kept", "digest-a"]]),
        tombstones: new Set(["never-seen"]),
        newWatermark: "2026-10-19",
      });
      expect(result.delta.removed).toBe(0);
    });

    it("a key found removed by both currentKeys and an explicit tombstone counts once, not twice", () => {
      const previousDigests = new Map([
        ["kept", "digest-a"],
        ["gone", "digest-b"],
      ]);
      const result = computeSourceDelta({
        source: "bbb_harvest",
        total: 2,
        windowRows: [{ key: "kept", digest: "digest-a", updatedAt: null }],
        hours: [],
        previousDigests,
        currentKeys: new Set(["kept"]),
        tombstones: new Set(["gone"]),
        newWatermark: "2026-10-19",
      });
      expect(result.delta.removed).toBe(1);
    });

    it("currentKeys and tombstones can each find a different removed key, both counted", () => {
      const previousDigests = new Map([
        ["kept", "digest-a"],
        ["gone-by-keyset", "digest-b"],
        ["gone-by-tombstone", "digest-c"],
      ]);
      const result = computeSourceDelta({
        source: "austin_permits",
        total: 3,
        windowRows: [{ key: "kept", digest: "digest-a", updatedAt: null }],
        hours: [],
        previousDigests,
        currentKeys: new Set(["kept", "gone-by-tombstone"]),
        tombstones: new Set(["gone-by-tombstone"]),
        newWatermark: "2026-10-19",
      });
      expect(result.delta.removed).toBe(2);
    });
  });

  // T022: delta.ts is pure (no I/O), so no function here ever writes a manifest or an index
  // entry. pendingDelta/commitDelta make the "not yet committed" state explicit in the type a
  // caller threads between computing a delta and the enclosing run actually succeeding — the
  // run's own manifest/index write (upload.ts's publishRun, out of this module's scope) is the
  // only thing allowed to call commitDelta, and only after that write is read back from disk.
  describe("pendingDelta/commitDelta (T022): a computed delta starts uncommitted", () => {
    it("pendingDelta starts committed: false and never mutates in place", () => {
      const result = computeSourceDelta({
        source: "tcad_supplemental",
        total: 0,
        windowRows: [],
        hours: [],
        previousDigests: new Map(),
        newWatermark: "2026-10-19",
      });
      const pending = pendingDelta(result);
      expect(pending.committed).toBe(false);
      expect(pending.result).toBe(result);
      const committed = commitDelta(pending);
      expect(committed.committed).toBe(true);
      // the original pending value is untouched (a failed run's "attempt" never silently
      // becomes committed just because a later call happened to commit a *different* object)
      expect(pending.committed).toBe(false);
      expect(committed).not.toBe(pending);
    });
  });
});
