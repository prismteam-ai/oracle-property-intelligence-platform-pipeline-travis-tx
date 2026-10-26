// A-04 T052: the content digest of one Socrata row (agent-design § 3). SHA-256 of the JCS
// (RFC 8785) serialisation of the row WITHOUT
//   - every `:`-prefixed system field (`:id`, `:updated_at`, `:created_at`, `:@computed_region_*`):
//     the source moves them without the permit changing (the 2026-10-19 bulk re-stamp);
//   - the calendar-derived columns the dataset config names (Austin: `issued_in_last_30_days`,
//     `day_issued`), which change with the date, not with the permit.
// Keys are sorted; an absent key stays absent (never turned into null or ""). Each stored row
// also keeps its page sha256 and row index, which point to the exact bytes.
import { createHash } from "node:crypto";

/** True for a Socrata system or computed field (`:id`, `:updated_at`, `:@computed_region_…`). */
export const isSystemField = (key: string): boolean => key.startsWith(":");

/** RFC 8785 JSON Canonicalization of a JSON value (strings, numbers, booleans, null, arrays, objects). */
export function jcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("jcs: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(",")}}`;
  }
  throw new Error(`jcs: unsupported value of type ${typeof value}`);
}

/** The row's content fields: everything but system fields and the volatile columns. */
export function contentFields(
  row: Readonly<Record<string, unknown>>,
  volatileFields: readonly string[],
): Record<string, unknown> {
  const skip = new Set(volatileFields);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !isSystemField(k) && !skip.has(k)));
}

/** SHA-256 hex of the JCS of the row's content fields. */
export function contentDigest(
  row: Readonly<Record<string, unknown>>,
  volatileFields: readonly string[],
): string {
  return createHash("sha256")
    .update(jcs(contentFields(row, volatileFields)), "utf8")
    .digest("hex");
}
