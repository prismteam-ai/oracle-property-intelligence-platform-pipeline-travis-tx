// A-11 Run 3 (PO decisions 2026-10-25, FU-A-01, ERR-66): the contractor company name AS PRINTED on an
// Austin permit (published as company.name via property_improvement_has_contractor) and a plain BBB
// SEARCH link built from it. The published link is built IN THE VIEW (macro bbb_search_url in
// packages/query-core/src/derive.ts, tested for parity with bbbSearchUrl below). Neither is an identity claim:
//   - the printed name is evidence, "as printed, unverified": the company record carries no
//     registry id (sunbiz_document_number null), so contractor_resolution stays 'unresolved';
//   - the link is a string we build. This module never requests bbb.org (A-01 receipts: HTTP 403
//     Cloudflare challenge). The BBB rating therefore stays missing, with bbb_status = 'blocked'
//     and bbb_status_reason = 'bbb_blocked'.
//
// URL SHAPE CHECKED BY HAND (PO, 2026-10-26, ERR-66): with find_type=Category BBB listed only
// category ads; without it the exact business was found. No automated request is ever made to BBB.
// If BBB's shape changes, only BBB_SEARCH_BASE and `bbbSearchUrl` change.
//
// Pure functions, no I/O.

/** Unverified BBB public search page (see the header). */
export const BBB_SEARCH_BASE = "https://www.bbb.org/search";

/** Longest printed name that goes into a link; longer names are cut at a word boundary. */
export const MAX_NAME_CHARS = 120;

/** City used in the link when the permit prints no contractor city (the permit authority's city). */
export const DEFAULT_BBB_CITY = "Austin";

/** Printed values that mean "no contractor" (compared after upper-casing and trimming punctuation). */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  "N/A",
  "NA",
  "N A",
  "NONE",
  "NULL",
  "NO",
  "NIL",
  "UNKNOWN",
  "TBD",
  "TO BE DETERMINED",
  "OWNER",
  "SELF",
  "HOMEOWNER",
  "HOME OWNER",
  "OWNER BUILDER",
  "OWNER/BUILDER",
  "OWNER BUILT",
  "THE OWNER",
  "SAME",
  "SAME AS ABOVE",
  "-",
]);

/** Trim and collapse inner whitespace; null for missing input. */
export function cleanPrinted(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** True when the printed text is empty or a placeholder such as N/A, OWNER or SELF. */
export function isPlaceholderName(value: string | null | undefined): boolean {
  const s = cleanPrinted(value);
  if (s === null) return true;
  const key = s.toUpperCase().replace(/^[\s.\-_*]+|[\s.\-_*]+$/g, "");
  if (key === "") return true;
  if (PLACEHOLDER_NAMES.has(key)) return true;
  // Punctuation only, for example "...".
  return !/[\p{L}\p{N}]/u.test(key);
}

/** Percent-encode one query value: RFC 3986 unreserved characters stay, everything else is escaped. */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The contractor company name as it is PUBLISHED (company.name, "as printed, unverified"): trimmed,
 * whitespace collapsed, and without the clerk markers Austin appends, such as "**MAIN**" or
 * "***DO NOT USE***" (they are not part of the business name). Null for empty and placeholder names.
 */
export function publishedContractorName(value: string | null | undefined): string | null {
  const text = cleanPrinted(
    (cleanPrinted(value) ?? "").replace(/\*+[^*]*\*+/g, " ").replace(/\*/g, " "),
  );
  return text === null || isPlaceholderName(text) ? null : text;
}

/** Cut a name to MAX_NAME_CHARS code points (the SQL macro bbb_search_url does the same). */
function limitName(name: string): string {
  return Array.from(name).slice(0, MAX_NAME_CHARS).join("").trimEnd();
}

/**
 * The BBB search link for a printed contractor name and city, or null when the name is empty or a
 * placeholder. City falls back to DEFAULT_BBB_CITY; the state is always TX (Austin permits).
 * Shape checked by hand (PO, 2026-10-26).
 */
export function bbbSearchUrl(
  name: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const text = publishedContractorName(name);
  if (text === null) return null;
  const printed = limitName(text);
  const place = cleanPrinted(city) ?? DEFAULT_BBB_CITY;
  return (
    `${BBB_SEARCH_BASE}?find_country=USA` +
    `&find_text=${encodeValue(printed)}` +
    `&find_loc=${encodeValue(`${place}, TX`)}`
  );
}
