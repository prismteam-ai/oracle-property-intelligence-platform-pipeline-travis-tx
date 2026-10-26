// A-11 Run 3: the facts of one incremental Austin permits refresh and how they become the
// manifest's Austin `sources[]` entry. Pure (no file, network or database I/O): the Query DB
// reads live in pipeline/local-stack/scripts/incremental-facts.ts, which hands this module plain
// numbers.
//
// What the manifest schema (RunManifestV1 ManifestSource, strict) can carry for a source:
//   watermark   the NEW watermark (the value this run commits and the next run starts from)
//   records     the capture-time total of the source at that watermark (this is also what the
//               A-16 permit-link reconciliation adds up to, so it must stay the total)
//   added / changed / removed   the digest-based delta (never `:updated_at`, FR-006)
//   limitations free text
// It has no field for the watermark this run started from or for the rows this run read, and the
// schema is strict (a deployed consumer would refuse an unknown key), so both go into one
// structured limitation line, `incrementalWindowLimitation`, instead of a new field.
import type { ManifestSourceInput } from "../manifest.js";
import type { AustinIncrementalFacts } from "./austin-facts.js";

export { AustinIncrementalFacts, PermitLinkTotals, parseAustinFacts } from "./austin-facts.js";

/** The reason a source with nothing new records (AC-11); the watermark is the one it keeps. */
export function unchangedLimitation(watermark: string | null): string {
  return `source unchanged, watermark ${watermark ?? "none"}`;
}

/**
 * The one limitation line that carries what the schema has no field for: the watermark used, the
 * rows read and the full delta split including `unchanged`.
 */
export function incrementalWindowLimitation(f: AustinIncrementalFacts): string {
  const scope =
    f.mode === "full_pass"
      ? "whole dataset paged by :id (bulk re-stamp: every :updated_at moved)"
      : `window :updated_at > ${f.watermarkUsed}`;
  return (
    `Incremental run: ${scope}; ${f.recordsRead} rows read; watermark used ${f.watermarkUsed}, ` +
    `new watermark ${f.watermarkNew}; delta by content digest: added ${f.delta.added}, ` +
    `changed ${f.delta.changed}, removed ${f.delta.removed}, unchanged ${f.unchanged}`
  );
}

/** Throws unless these facts can follow the base run's Austin source. */
export function checkFactsAgainstBase(
  f: AustinIncrementalFacts,
  base: { watermark: string | null; records: number },
): void {
  if (f.watermarkUsed !== base.watermark)
    throw new Error(
      `the incremental run started from watermark ${f.watermarkUsed}, but the base manifest's Austin watermark is ${String(base.watermark)}: the chain is broken`,
    );
  if (f.watermarkNew < f.watermarkUsed)
    throw new Error(
      `new watermark ${f.watermarkNew} is older than the one used ${f.watermarkUsed}`,
    );
  if (f.totalBefore !== base.records)
    throw new Error(
      `facts say ${f.totalBefore} rows before the run, the base manifest recorded ${base.records}`,
    );
  const seen = f.delta.added + f.delta.changed + f.unchanged;
  if (seen > f.recordsRead)
    throw new Error(
      `added ${f.delta.added} + changed ${f.delta.changed} + unchanged ${f.unchanged} exceeds the ${f.recordsRead} rows read`,
    );
  const linkedAndExcluded = Object.values(f.permitLink).reduce((a, b) => a + b, 0);
  if (linkedAndExcluded !== f.totalAfter)
    throw new Error(
      `permit-link totals add up to ${linkedAndExcluded}, but ${f.totalAfter} rows are held at the new watermark`,
    );
}

/**
 * Rows held now should be rows held before, plus added, minus removed. A difference is not an
 * error (a permit number can arrive under a second row id), but it is stated, never hidden.
 */
export function reconciliationNote(f: AustinIncrementalFacts): string | null {
  const expected = f.totalBefore + f.delta.added - f.delta.removed;
  if (expected === f.totalAfter) return null;
  return `Row count reconciliation: ${f.totalBefore} before + ${f.delta.added} added - ${f.delta.removed} removed = ${expected}, but ${f.totalAfter} rows are held (${f.totalAfter - expected} more share a permit number with an existing row)`;
}

/** The Austin `ManifestSourceInput` of an incremental run (delta from digests, new watermark). */
export function austinSourceInput(
  f: AustinIncrementalFacts,
  base: { name: string; url: string; receipts: string; limitations: readonly string[] },
): ManifestSourceInput {
  const extra = [incrementalWindowLimitation(f)];
  const note = reconciliationNote(f);
  if (note !== null) extra.push(note);
  if (f.restampDetected) extra.push("source bulk re-stamp; delta by content digest");
  if (f.removalDetection === "not_checked")
    extra.push(
      "removals not checked: this window was narrow, a deleted source row is found only by a full key-set pass",
    );
  if (f.delta.added + f.delta.changed + f.delta.removed === 0)
    extra.push(unchangedLimitation(f.watermarkNew));
  return {
    name: base.name,
    url: base.url,
    watermark: f.watermarkNew,
    receipts: base.receipts,
    limitations: [...base.limitations, ...extra],
    delta: { ...f.delta },
  };
}

/** A source an incremental run did not re-capture: delta 0 with the reason (AC-11). */
export function unchangedSourceInput(base: {
  name: string;
  url: string;
  watermark: string | null;
  receipts: string;
  limitations: readonly string[];
}): ManifestSourceInput {
  return {
    name: base.name,
    url: base.url,
    watermark: base.watermark,
    receipts: base.receipts,
    limitations: [...base.limitations, unchangedLimitation(base.watermark)],
    delta: { added: 0, changed: 0, removed: 0 },
  };
}

/** The receipt file `buildManifest` reads `captured_at` and `records` from. */
export function austinReceiptOf(f: AustinIncrementalFacts): {
  captured_at: string;
  records: number;
} {
  return { captured_at: f.capturedAt, records: f.totalAfter };
}

/**
 * Removed rows without a key-set read: every stored row either keeps `:updated_at <= W` (counted
 * by the source at W), or moved above W (it is in the window), or is gone. So
 *   removed = stored - countAtW - (window rows that were already stored).
 * This detects THAT some rows are gone (and so that a key-set pass is needed), not which ones.
 */
export function inferRemovedCount(args: {
  stored: number;
  sourceCountAtWatermark: number;
  windowRowsAlreadyStored: number;
}): number {
  return Math.max(0, args.stored - args.sourceCountAtWatermark - args.windowRowsAlreadyStored);
}
