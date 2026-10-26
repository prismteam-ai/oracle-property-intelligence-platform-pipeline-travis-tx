// A-11 T017 (US2, G-RUN wave 1): per-source watermark + content-digest delta computation for
// the three sources D-2(c) re-checks on an incremental run — Austin permits, the TCAD
// supplemental export, and the BBB harvest. Every other source keeps its previous CID untouched
// and is never re-checked here.
//
// Reuses (imports, never reimplements) A-04's existing re-stamp detector and content-digest
// function from pipeline/oracle-runtime/travis/permits/{restamp,content-digest}.ts, per the
// module-boundary table (docs/architecture-constitution.md § 9: "pipeline/oracle-runtime must
// not ... be reimplemented"). pnpm-workspace.yaml deliberately keeps pipeline/oracle-runtime out
// of the Turborepo/pnpm workspace graph ("its own npm project ... as provided"), so this is a
// plain relative-path import, not a package dependency — no new dependency entry is added
// anywhere. Both imported files have zero third-party dependencies (restamp.ts has none;
// content-digest.ts imports only `node:crypto`), so no cross-project `node_modules` resolution
// is ever needed to run this file or its tests. This cross-directory import is unusual enough
// that it is called out explicitly in this builder's handback for the integration check /
// reviewers to confirm, in case the team would rather promote these two functions to a shared
// package instead.
//
// FR-006: a source's delta (`added`/`changed`/`removed`) is always computed by comparing
// content digests, never by trusting a `:updated_at`-style timestamp field. The bulk-re-stamp
// rule (restamp.ts, unchanged): the incremental window is a re-stamp when it is >= 50% of the
// source's total row count, or >= 90% of the window falls inside one 6h span. When the detector
// fires, the caller is expected to have paged the FULL dataset by key (never by the timestamp
// filter) and passed every row here — exactly as A-04's workflow.ts does for Austin. This module
// does not page or fetch a source itself; it only turns rows + previous digests into a verdict.
//
// --- Shape for wave 2 (manifest.ts's ManifestSourceInput/source() wiring, T018) ---
// `computeSourceDelta(input: ComputeSourceDeltaInput): SourceDeltaResult`
//   `SourceDeltaResult` carries exactly the fields data-model.md's `SourceDelta` needs:
//   `name`, `watermark`, `records`, `delta: { added, changed, removed }`, `limitations[]` — plus
//   `restamp` (the full verdict, in case the caller wants its `reasons`/shares for evidence).
//   Wave 2 maps this 1:1 onto `ManifestSourceInput`'s new explicit `added`/`changed`/`removed`
//   fields instead of the current hardcoded "first run: everything is new" in `manifest.ts`.
//   `toSourceRecord(row, opts)` and the re-exported `contentDigest`/`jcs` let a wave-2 caller (or
//   whatever builds `windowRows`) compute each row's digest without re-deriving A-04's content-
//   digest logic either.

import {
  contentDigest,
  isSystemField,
  jcs,
} from "../../../oracle-runtime/travis/permits/content-digest.js";
import {
  detectRestamp,
  RESTAMP_LIMITATION,
  RESTAMP_LIMITATION_CODE,
  type HourCount,
  type RestampVerdict,
} from "../../../oracle-runtime/travis/permits/restamp.js";

export {
  contentDigest,
  isSystemField,
  jcs,
  detectRestamp,
  RESTAMP_LIMITATION,
  RESTAMP_LIMITATION_CODE,
};
export type { HourCount, RestampVerdict };

/** The only three sources an incremental run re-checks (D-2(c), data-model.md's SourceDelta.name). */
export const INCREMENTAL_SOURCES = ["austin_permits", "tcad_supplemental", "bbb_harvest"] as const;
export type IncrementalSource = (typeof INCREMENTAL_SOURCES)[number];

/** The reason text for a zero-delta source with no re-stamp involved (research.md's zero-delta-with-reason pattern). */
export const NO_NEWER_EXPORT = "no newer export";

/** One row as seen by this run's window/page-through, keyed and digested by the caller. */
export interface SourceRecord {
  /** The row's natural key (permit_number, parcel geoid, BBB business id, ...) — never the source's own transient `:id`. */
  key: string;
  /** Content digest of the row's non-volatile fields (A-04's `contentDigest` pattern) — never a digest of a timestamp field. */
  digest: string;
  /** The row's own update timestamp. Used ONLY to bucket it for the re-stamp window/hour check — never compared to decide "changed". */
  updatedAt: string | null;
}

export interface ComputeSourceDeltaInput {
  source: IncrementalSource;
  /** Total row count of the full dataset right now — the re-stamp window-share denominator. */
  total: number;
  /** The rows this run's window (or, if a re-stamp, full page-through) returned. */
  windowRows: readonly SourceRecord[];
  /** Hourly histogram of `windowRows`' `updatedAt` (restamp.ts's bucket shape) — the re-stamp concentration check. */
  hours: readonly HourCount[];
  /** Content digest of each key as of the last published run. A key absent here was never seen before (→ added). */
  previousDigests: ReadonlyMap<string, string>;
  /**
   * The full current key set — pass this ONLY when `windowRows` is itself a full page-through
   * (re-stamp or backfill mode); it lets `removed` be computed the way A-04's `diffKeySets`
   * does. Omit it for a normal narrow incremental window, where a key missing from the window
   * means "outside this window," not "removed" — removal detection needs a full keyset read.
   */
  currentKeys?: ReadonlySet<string>;
  /**
   * T020: keys the reconciliation layer already marked `source_removed` (use-oracle's "consume
   * dead/invalid tombstones") — an explicit, caller-asserted fact, counted into `removed` even
   * on a narrow window where `currentKeys` was never supplied (a normal incremental window never
   * reads the full keyset). A tombstoned key not present in `previousDigests` (never published
   * before) counts for nothing: there is nothing to remove. Deduplicated with any key
   * `currentKeys` already found absent, so a key caught both ways is counted once.
   */
  tombstones?: ReadonlySet<string>;
  /** The watermark value to record if this run commits (Socrata `:updated_at`, export date, or harvest date). */
  newWatermark: string | null;
}

export interface SourceDeltaResult {
  name: IncrementalSource;
  watermark: string | null;
  records: number;
  delta: { added: number; changed: number; removed: number };
  limitations: string[];
  /** The full re-stamp verdict (detected, reasons, shares) for evidence/logging. */
  restamp: RestampVerdict;
}

/**
 * Per-source watermark + content-digest delta (FR-006, data-model.md's SourceDelta). Never
 * trusts a timestamp field for "changed": every added/changed/removed count comes from
 * comparing `digest` values. Reuses A-04's `detectRestamp` (imported above) to decide whether
 * the window is a genuine incremental slice or a bulk re-stamp that happens to carry new
 * timestamps on unchanged content.
 */
export function computeSourceDelta(input: ComputeSourceDeltaInput): SourceDeltaResult {
  const restamp = detectRestamp({
    total: input.total,
    windowCount: input.windowRows.length,
    hours: input.hours,
  });

  let added = 0;
  let changed = 0;
  for (const row of input.windowRows) {
    const previous = input.previousDigests.get(row.key);
    if (previous === undefined) added += 1;
    else if (previous !== row.digest) changed += 1;
  }

  // T020: a key is removed either because a full keyset read (currentKeys) no longer has it, or
  // because the reconciliation layer explicitly tombstoned it (source_removed) — a Set dedupes a
  // key caught both ways. A tombstone for a key never seen in previousDigests removes nothing.
  const removedKeys = new Set<string>();
  if (input.currentKeys) {
    for (const key of input.previousDigests.keys()) {
      if (!input.currentKeys.has(key)) removedKeys.add(key);
    }
  }
  if (input.tombstones) {
    for (const key of input.tombstones) {
      if (input.previousDigests.has(key)) removedKeys.add(key);
    }
  }
  const removed = removedKeys.size;

  const limitations: string[] = [];
  if (restamp.detected) limitations.push(RESTAMP_LIMITATION);
  if (added === 0 && changed === 0 && removed === 0) limitations.push(NO_NEWER_EXPORT);

  return {
    name: input.source,
    watermark: input.newWatermark,
    records: input.windowRows.length,
    delta: { added, changed, removed },
    limitations,
    restamp,
  };
}

// --- T022: failed-mid-publish watermark semantics ------------------------------------------
// This module is pure (no file, network or DB I/O): it never writes a manifest or a
// runs/index.json entry, so "no manifest written on a failed run" is already true of every
// function above by construction. What a failed mid-publish run must NOT do is let its computed
// `newWatermark` become the next run's starting point — upload.ts's `publishRun` (out of this
// file's ownership this wave) already enforces that structurally: the manifest and the
// runs/index.json entry are written only after every upload, readback and bind-guard check pass
// (its `fail()` path returns before either write), so a failed attempt is logged in
// reports/publish.json but never listed in runs/index.json, and the next run's `preflight` reads
// the SAME previous watermark/index again. `PendingSourceDelta` makes that "not yet true" state
// explicit in the type a caller threads between computing a delta and the run actually
// committing, so a caller in this module's own tests (or a future wiring) cannot accidentally
// treat a computed `SourceDeltaResult.watermark` as committed before the run that produced it
// succeeded end to end.
export interface PendingSourceDelta {
  result: SourceDeltaResult;
  /** True only once the enclosing run's manifest is written AND listed in runs/index.json. */
  committed: boolean;
}

/** A freshly computed delta: never committed yet. */
export function pendingDelta(result: SourceDeltaResult): PendingSourceDelta {
  return { result, committed: false };
}

/**
 * Marks a pending delta committed. Call this ONLY after the run's manifest.json and its
 * runs/index.json entry are both written and read back from disk (upload.ts's publishRun step
 * 6) — never speculatively, and never before every readback/bind-guard check in that run passed.
 * Returns a new object; the input is never mutated.
 */
export function commitDelta(pending: PendingSourceDelta): PendingSourceDelta {
  return { ...pending, committed: true };
}

/** Build one `SourceRecord` from a raw row using A-04's `contentDigest` (never reimplemented here). */
export function toSourceRecord(
  row: Readonly<Record<string, unknown>>,
  opts: { key: string; updatedAt: string | null; volatileFields: readonly string[] },
): SourceRecord {
  return {
    key: opts.key,
    digest: contentDigest(row, opts.volatileFields),
    updatedAt: opts.updatedAt,
  };
}
