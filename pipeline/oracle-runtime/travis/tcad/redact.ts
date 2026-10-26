// A-04 T021 (AC-5, FR-005, D-7, P0-15): conservative §25.025 owner redaction, run right after
// the strict parse and before mapping, storage, the County transform and `validate`.
// Stage 0 fact: the 2026 JSON export carries no owner-level §25.025 marker (full key scan);
// `owners[].confidentialCode` does not exist. So every account with any non-empty
// `sales[].confidentialCode` or a truthy `sales[].confidentialSale` (on any sale, not only the
// latest) is treated as confidential: owners[] are dropped and each sale/deed keeps only its
// non-party keys (no buyer, seller, grantor or grantee name, no price). The account itself is
// loaded and counted (D-5/D-7, disagreement #3); `owner_redaction_rule = sales_confidential_code`.
// tcad-county.ts keeps its own suppression as a second guard.
export const OWNER_REDACTION_RULE = "sales_confidential_code";

export const LIMITATION_COUNT_PREFIX =
  "Confidential owner records redacted (Texas Tax Code §25.025): ";
export const LIMITATION_RULE =
  "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes";

/** The two run limitations (A-11 copies them into the manifest). */
export function limitationsFor(redacted: number): [string, string] {
  return [`${LIMITATION_COUNT_PREFIX}${redacted}`, LIMITATION_RULE];
}

/** Keys a sale keeps on a redacted record: identifiers, dates, type and the code itself. */
export const SALE_KEEP = new Set([
  "saleID",
  "deedID",
  "pID",
  "saleDt",
  "saleType",
  "confidentialCode",
  "confidentialSale",
]);
/** Keys a deed keeps on a redacted record (no grantor / grantee). */
export const DEED_KEEP =
  /^(deedID|pID|deedDt|deedRecordedDt|deedType|fileDt|instrumentNum|book|page|volume)$/;

const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";

/** A confidentialSale flag is set unless absent, null, false, 0, "0" or blank. */
export function flagSet(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === 0) return false;
  if (typeof v === "string") return v.trim() !== "" && v.trim() !== "0";
  return true;
}

const items = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    : [];

/** Why a record is confidential: the sale keys that fired (empty = not confidential). */
export function confidentialBasis(record: Record<string, unknown>): string[] {
  const sales = items(record.sales);
  const basis: string[] = [];
  if (sales.some((s) => nonEmpty(s.confidentialCode))) basis.push("sales[].confidentialCode");
  if (sales.some((s) => flagSet(s.confidentialSale))) basis.push("sales[].confidentialSale");
  return basis;
}

export interface Redaction {
  /** The record to map and store: the input itself when not confidential, else a redacted copy. */
  record: Record<string, unknown>;
  redacted: boolean;
  basis: string[];
}

const keep = (item: Record<string, unknown>, ok: (k: string) => boolean): Record<string, unknown> =>
  Object.fromEntries(Object.entries(item).filter(([k]) => ok(k)));

/**
 * Top-level keys a redacted record keeps: what mapping and the County transform read. Every
 * other key (appeals, events, notes, links, permits, …) can name a party and is dropped.
 */
export const TOP_KEEP = new Set([
  "pID",
  "pRollCorr",
  "pVersion",
  "pYear",
  "propType",
  "geometry",
  "inactive",
  "propertyIdentification",
  "propertyLegalDescription",
  "propertyProfile",
  "situses",
  "sales",
  "deeds",
  "valuations",
]);

/** Improvement keys kept for the year-built rule (no comment or note field). */
const IMPROVEMENT_KEEP = new Set([
  "pImprovementID",
  "sequence",
  "imprvType",
  "stateCd",
  "actualYearBuilt",
  "effYearBuilt",
]);
const DETAIL_KEEP = new Set(["imprvDetailType", "area", "sequence"]);

/**
 * Valuations reduced to what the year-built rule and the improvement count read
 * (year-built.ts `improvementsOf`): `pYear` and the `cost-local` improvements' identifiers,
 * types, state codes, years and floor-detail areas. No value, price, comment or party.
 */
export function slimValuations(v: unknown): Record<string, unknown>[] {
  return items(v).map((val) => {
    const details = val.details as Record<string, unknown> | null | undefined;
    const cost = (details?.["cost-local"] ?? null) as Record<string, unknown> | null;
    const improvements = items(cost?.improvements).map((imp) => ({
      ...keep(imp, (k) => IMPROVEMENT_KEEP.has(k)),
      details: items(imp.details).map((d) => keep(d, (k) => DETAIL_KEEP.has(k))),
    }));
    return {
      pYear: val.pYear ?? null,
      details: cost === null ? null : { "cost-local": { improvements } },
    };
  });
}

export function redactRecord(record: Record<string, unknown>): Redaction {
  const basis = confidentialBasis(record);
  if (basis.length === 0) return { record, redacted: false, basis };
  const copy: Record<string, unknown> = keep(record, (k) => TOP_KEEP.has(k));
  copy.owners = [];
  if (Array.isArray(record.sales))
    copy.sales = items(record.sales).map((s) => keep(s, (k) => SALE_KEEP.has(k)));
  if (Array.isArray(record.deeds))
    copy.deeds = items(record.deeds).map((d) => keep(d, (k) => DEED_KEEP.test(k)));
  if (Array.isArray(record.valuations)) copy.valuations = slimValuations(record.valuations);
  return { record: copy, redacted: true, basis };
}
