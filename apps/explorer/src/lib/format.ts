export const fmtInt = (n: number | null | undefined): string =>
  n === null || n === undefined ? 'n/a' : n.toLocaleString('en-US');

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export const fmtTime = (iso: string | null | undefined): string =>
  iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : 'n/a';

export const shortCid = (cid: string): string =>
  cid.length > 20 ? `${cid.slice(0, 10)}…${cid.slice(-8)}` : cid;

export const fmtYears = (n: number | null | undefined): string =>
  n === null || n === undefined ? 'n/a' : `${n.toFixed(1)} y`;

export const fmtDays = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return 'n/a';
  return n >= 365 ? `${(n / 365).toFixed(1)} y (${fmtInt(n)} d)` : `${fmtInt(n)} d`;
};

/** Great-circle miles, for the plot only; the API's `distance_miles` is authoritative. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(a));
}
