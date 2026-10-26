// A-04 T023 (AC-4, FR-004), A-11 Run 3 (ERR-71, docs/decisions/0003-tenure-from-transfer-deeds.md):
// ownership tenure from the latest dated TRANSFER, taken from `sales[].saleDt` and from the
// allow-listed transfer deeds in `deeds[]`, whichever is later.
// `as_of` is the run's finishedAt date (RunContext.asOf), never now() inside the derivation.
// No dated transfer → tenure_basis unknown, tenure_years / is_long_tenure null and reason
// no_dated_sale: such an owner is never counted as a long-tenure owner (disagreement #5).
export const LONG_TENURE_YEARS = 10;
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;
/** Earliest transfer date accepted; anything older is a keying error, not a conveyance. */
export const MIN_TRANSFER_YEAR = 1900;

/**
 * The TCAD `deeds[].deedType` codes that convey ownership to the buyer named on the deed
 * (the codes are not defined in the export layout, so each is justified from its frequency, its
 * buyer/seller lines and how often the buyer is the current owner; see ADR 0003). Every other
 * code is ignored for tenure: liens, lis pendens, affidavits, letters testamentary, releases,
 * easements, deeds of trust, plats, corrections and administrative instruments.
 */
export const TRANSFER_DEED_TYPES: ReadonlyMap<string, string> = new Map([
  ["WD", "warranty deed"],
  ["SW", "special warranty deed"],
  ["QD", "quitclaim deed"],
  ["GD", "gift deed"],
  ["ED", "executor's deed"],
  ["TD", "trustee's deed"],
]);

export interface TenureFields {
  last_ownership_transfer_date: string | null;
  tenure_years: number | null;
  tenure_basis: "sale_date" | "deed_date" | "unknown";
  tenure_missing_reason: "no_dated_sale" | null;
  is_long_tenure: boolean | null;
}

/** One dated transfer of ownership: a TCAD sale, or an allow-listed TCAD transfer deed. */
export interface TransferEvent {
  /** YYYY-MM-DD, a real calendar date from MIN_TRANSFER_YEAR to as_of. */
  date: string;
  source: "sale" | "deed";
  /** The deed code for a deed; null for a sale. */
  deedType: string | null;
  /** saleID or deedID (0 when absent): the stable tie-break. */
  id: number;
}

/** The YYYY-MM-DD of a printed date ("2015-07-07 00:00:00"), or null when not a real date. */
export function saleDateOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso;
}

const idOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The dated transfers of one account, oldest first, one per calendar day. A date counts when it
 * is a real date from 1900 to `asOf` (null means no upper bound). A deed counts when its
 * `deedType` is on the allow-list and it prints `deedDt` (else `deedRecordedDt`, the recording
 * date, which is never earlier than the signing). When a sale and a deed fall on the same day the
 * sale is kept; among same-day deeds the lowest deedID. Order is date, sale before deed, id.
 */
export function transferEventsOf(
  sales: ReadonlyArray<{ saleID?: unknown; saleDt?: unknown }>,
  deeds: ReadonlyArray<Record<string, unknown>>,
  asOf: string | null,
): TransferEvent[] {
  const asOfMs = asOf === null ? Number.POSITIVE_INFINITY : Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(asOfMs)) throw new Error(`tenure: as_of ${asOf} is not a date`);
  const inRange = (d: string | null): d is string =>
    d !== null &&
    Number(d.slice(0, 4)) >= MIN_TRANSFER_YEAR &&
    Date.parse(`${d}T00:00:00Z`) <= asOfMs;
  const events: TransferEvent[] = [];
  for (const s of sales) {
    const date = saleDateOf(s.saleDt);
    if (inRange(date)) events.push({ date, source: "sale", deedType: null, id: idOf(s.saleID) });
  }
  for (const d of deeds) {
    const type = typeof d.deedType === "string" ? d.deedType.trim().toUpperCase() : "";
    if (!TRANSFER_DEED_TYPES.has(type)) continue;
    const date = saleDateOf(d.deedDt) ?? saleDateOf(d.deedRecordedDt);
    if (inRange(date)) events.push({ date, source: "deed", deedType: type, id: idOf(d.deedID) });
  }
  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.source === b.source ? 0 : a.source === "sale" ? -1 : 1) ||
      a.id - b.id,
  );
  // One event per day: the first (a sale beats a deed, then the lowest id).
  return events.filter((e, i) => i === 0 || (events[i - 1] as TransferEvent).date !== e.date);
}

export function tenureOf(
  sales: ReadonlyArray<{ saleID?: unknown; saleDt?: unknown }>,
  asOf: string,
  deeds: ReadonlyArray<Record<string, unknown>> = [],
): TenureFields {
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(asOfMs)) throw new Error(`tenure: as_of ${asOf} is not a date`);
  const latest = transferEventsOf(sales, deeds, asOf).at(-1);
  if (latest === undefined) {
    return {
      last_ownership_transfer_date: null,
      tenure_years: null,
      tenure_basis: "unknown",
      tenure_missing_reason: "no_dated_sale",
      is_long_tenure: null,
    };
  }
  const years = (asOfMs - Date.parse(`${latest.date}T00:00:00Z`)) / DAY_MS / YEAR_DAYS;
  const tenure = Math.round(years * 100) / 100;
  return {
    last_ownership_transfer_date: latest.date,
    tenure_years: tenure,
    tenure_basis: latest.source === "deed" ? "deed_date" : "sale_date",
    tenure_missing_reason: null,
    is_long_tenure: tenure > LONG_TENURE_YEARS,
  };
}
