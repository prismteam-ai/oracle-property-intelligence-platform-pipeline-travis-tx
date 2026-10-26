// Display helpers of the pages (A-03 T042, G-C3). Timestamps are shown as the manifest's own
// UTC ISO strings with a "UTC" suffix (TC-010 step 4);
// counts are grouped with thousands separators (en-US) and shown with `tabular-nums`.

/** The ISO instant in UTC: the manifest value itself when it already ends in `Z`. */
export function utcTimestamp(iso: string): string {
  if (iso.endsWith("Z")) return iso;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
}

/** A manifest count with thousands separators ("2,381,886"), shown with `tabular-nums`. */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** A byte size with thousands separators and its unit ("103,835 bytes"). */
export function formatBytes(size: number): string {
  return `${formatCount(size)} bytes`;
}
