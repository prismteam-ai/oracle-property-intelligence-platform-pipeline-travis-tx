/**
 * The search-center rule (decisions.md section 20, "Agent tools"): a search's `lat`/`lon` must be a point that
 * `resolve_search_center` returned in this turn or numbers the user typed. Anything else is rejected before the query
 * runs, so the model cannot search around a coordinate it recalled or invented.
 */
export interface CenterPoint {
  name: string;
  kind: string;
  match_type: string;
  lat: number;
  lon: number;
  parcel_count: number;
  basis: string;
  /** False when the call that returned it had no exact match (only prefix or alias matches). */
  confirmed?: boolean;
}

/** Rounding to four decimals (about 11 m) still counts as the returned point. */
export const CENTER_TOLERANCE_DEG = 1e-4;

const NUMBER = /[-+]?\d{1,3}\.\d+/g;

export type GuardResult = { ok: true; center: CenterPoint | null } | { ok: false; detail: string };

export class CoordinateGuard {
  private readonly centers: CenterPoint[] = [];
  private readonly typed: number[];

  /** `userTexts`: the content of every user message in the request (the user typed them). */
  constructor(userTexts: string[]) {
    this.typed = userTexts.flatMap((t) => (t.match(NUMBER) ?? []).map(Number));
  }

  /**
   * Records the centers one resolve_search_center call returned. When none of them is an exact match, they are kept as
   * unconfirmed: the agent asks which one was meant (decisions.md section 20) instead of searching around one.
   */
  addCenters(items: CenterPoint[]): void {
    const confirmed = items.some((c) => c.match_type === 'exact');
    for (const c of items)
      if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) this.centers.push({ ...c, confirmed });
  }

  /** The center a search used, when one matches (for its basis in `assumptions`). */
  check(lat: number | undefined, lon: number | undefined): GuardResult {
    if (lat === undefined && lon === undefined) return { ok: true, center: null };
    if (lat === undefined || lon === undefined)
      return { ok: false, detail: 'lat and lon must be given together' };
    const near = this.centers.filter(
      (c) =>
        Math.abs(c.lat - lat) <= CENTER_TOLERANCE_DEG &&
        Math.abs(c.lon - lon) <= CENTER_TOLERANCE_DEG,
    );
    const center = near.find((c) => c.confirmed !== false);
    if (center) return { ok: true, center };
    if (near.length > 0)
      return {
        ok: false,
        detail:
          'unconfirmed_search_center: resolve_search_center returned only prefix or alias matches for this place; ask the user which place they meant before searching (outcome needs_clarification)',
      };
    const typedLat = this.typed.some((n) => Math.abs(n - lat) < 1e-9);
    const typedLon = this.typed.some((n) => Math.abs(n - lon) < 1e-9);
    if (typedLat && typedLon) return { ok: true, center: null };
    return {
      ok: false,
      detail:
        'coordinates_not_allowed: lat/lon must be a point resolve_search_center returned in this turn, or numbers the user typed; call resolve_search_center first',
    };
  }
}
