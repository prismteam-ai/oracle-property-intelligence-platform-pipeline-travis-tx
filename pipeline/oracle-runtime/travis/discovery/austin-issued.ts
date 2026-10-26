// FR-004c: Austin-issued permits located in another jurisdiction stay Austin's. The Austin
// source row keeps them (`located_in_other_jurisdictions`); the matching city row gets an
// informational `austin_issued_located_here` count that never changes its own class.
//
// One matching rule, shared by the workflow and the checker: an Austin `jurisdiction` value
// (for example "LAKEWAY FULL PURPOSE" or "PFLUGERVILLE ETJ") belongs to a catalog row when
// it contains the row's name in upper case.
import type { Measurement } from "./catalog.schema.js";

export interface AustinLocatedEntry {
  jurisdiction: string;
  value: number;
  source_url: string;
  captured_at: string;
}

export function matchesJurisdiction(austinValue: string, rowName: string): boolean {
  const name = rowName.trim().toUpperCase();
  return name.length > 0 && austinValue.toUpperCase().includes(name);
}

export function austinEntriesFor<T extends AustinLocatedEntry>(
  rowName: string,
  located: readonly T[],
): T[] {
  return located.filter((e) => matchesJurisdiction(e.jurisdiction, rowName));
}

/** The summed Measurement for one city row, or null when Austin has no entry for it. */
export function austinIssuedMeasurement(
  rowName: string,
  located: readonly AustinLocatedEntry[],
): Measurement | null {
  const entries = austinEntriesFor(rowName, located);
  const first = entries[0];
  if (!first) return null;
  return {
    value: entries.reduce((sum, e) => sum + e.value, 0),
    source_url: first.source_url,
    captured_at: first.captured_at,
    method: `Austin-issued (3syk-w9eu jurisdiction group-by): ${entries
      .map((e) => `${e.jurisdiction}=${e.value}`)
      .join("; ")}`,
  };
}

/** "<NAME> FULL PURPOSE" (inside the city limits) and "<NAME> ETJ" (outside them), OR-m6. */
const FULL_PURPOSE = /\bFULL PURPOSE$/i;
const ETJ = /\bETJ$/i;

export interface AustinIssuedSplit {
  /** Inside the city limits: the count AC-4 uses. */
  full_purpose: Measurement;
  /** In the city's extraterritorial jurisdiction: outside its limits. */
  etj: Measurement;
}

function partMeasurement(
  label: string,
  rowName: string,
  first: AustinLocatedEntry,
  part: readonly AustinLocatedEntry[],
  suffix: string,
): Measurement {
  const method =
    part.length > 0
      ? `Austin-issued ${label} (3syk-w9eu jurisdiction group-by): ${part.map((e) => `${e.jurisdiction}=${e.value}`).join("; ")}`
      : `Austin-issued ${label} (3syk-w9eu jurisdiction group-by): no ${rowName.toUpperCase()} ${suffix} group, so 0`;
  return {
    value: part.reduce((sum, e) => sum + e.value, 0),
    source_url: first.source_url,
    captured_at: first.captured_at,
    method,
  };
}

/**
 * The full-purpose and ETJ parts of a row's Austin-issued permits, from the journaled
 * group-by (OR-m6), or null when Austin has no entry for the row. A label that is neither
 * (for example LIMITED PURPOSE) stays only in the total.
 */
export function austinIssuedSplit(
  rowName: string,
  located: readonly AustinLocatedEntry[],
): AustinIssuedSplit | null {
  const entries = austinEntriesFor(rowName, located);
  const first = entries[0];
  if (!first) return null;
  return {
    full_purpose: partMeasurement(
      "inside the city limits (full purpose)",
      rowName,
      first,
      entries.filter((e) => FULL_PURPOSE.test(e.jurisdiction.trim())),
      "FULL PURPOSE",
    ),
    etj: partMeasurement(
      "in the extraterritorial jurisdiction (ETJ, outside the city limits)",
      rowName,
      first,
      entries.filter((e) => ETJ.test(e.jurisdiction.trim())),
      "ETJ",
    ),
  };
}

/** True for an Austin label of the full-purpose (inside the city limits) part. */
export function isFullPurpose(label: string): boolean {
  return FULL_PURPOSE.test(label.trim());
}

/** True for an Austin label of the ETJ (outside the city limits) part. */
export function isEtj(label: string): boolean {
  return ETJ.test(label.trim());
}
