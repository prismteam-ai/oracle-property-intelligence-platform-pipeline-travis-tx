const ISO_DATE_LENGTH = "YYYY-MM-DD".length;
const YEAR_LENGTH = "YYYY".length;
const MONTH_DAY_START = "YYYY-".length;
const MILLISECONDS_PER_DAY = 86_400_000;
const EARLIEST_PLAUSIBLE_YEAR = 1800;

export function isoDateOf(dateTime: string): string {
  return dateTime.slice(0, ISO_DATE_LENGTH);
}

export function daysBefore(isoDate: string, days: number): string {
  const instant = Date.parse(`${isoDate}T00:00:00Z`) - days * MILLISECONDS_PER_DAY;
  return isoDateOf(new Date(instant).toISOString());
}

export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, YEAR_LENGTH));
}

export function isPlausibleYear(year: number, asOf: string): boolean {
  return Number.isInteger(year) && year >= EARLIEST_PLAUSIBLE_YEAR && year <= yearOf(asOf);
}

export function isPlausibleDate(isoDate: string, asOf: string): boolean {
  return isPlausibleYear(yearOf(isoDate), asOf) && isoDateOf(isoDate) <= asOf;
}

export function wholeYearsBetween(from: string, to: string): number {
  const years = yearOf(to) - yearOf(from);
  const reachedAnniversary =
    to.slice(MONTH_DAY_START, ISO_DATE_LENGTH) >= from.slice(MONTH_DAY_START, ISO_DATE_LENGTH);
  return reachedAnniversary ? years : years - 1;
}
