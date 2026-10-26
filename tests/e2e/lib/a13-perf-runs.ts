// The run plan of TC-041 (20 timed Filters searches per query, p95 < 3 s from input change to updated
// header). Pure; no browser. Each timed run sets a radius the page has not searched yet: the page
// caches an answered search by its request, so going back to a radius already seen (5 -> 4 -> 5) is
// answered locally with no API call and measures nothing. A new radius is a real explore.search.

/** One timed run is one bounded measurement: input change -> header names the new radius. */
export const PER_RUN_TIMEOUT_MS = 10_000;

const STEP_MI = 0.25;

/**
 * `count` distinct radii (0.25 mi steps, in 0.25..25) around `loaded`, never `loaded` itself (that search
 * is already cached) and never the same as the run before. Starts at `loaded - 2` and climbs.
 */
export function searchRadii(count: number, loaded: number): number[] {
  const out: number[] = [];
  for (let r = Math.max(STEP_MI, loaded - 2); out.length < count && r <= 25; r += STEP_MI) {
    if (r !== loaded) out.push(r);
  }
  if (out.length < count) throw new RangeError(`cannot plan ${count} fresh radii around ${loaded}`);
  return out;
}

/** The header of a search at exactly `r` miles: "{n} within {r} mi of ...". */
export function radiusHeaderPattern(r: number): RegExp {
  return new RegExp(`^\\d[\\d,]* within ${String(r).replace(".", "\\.")} mi of `);
}

/** The failure of one timed run, naming the series, the run index and the radius. */
export function runFailureMessage(
  series: string,
  run: number,
  total: number,
  radius: number,
  cause: string,
): string {
  return `TC-041 ${series}: run ${run} of ${total} at radius ${radius} mi: no updated header within ${PER_RUN_TIMEOUT_MS} ms (${cause})`;
}

/** Worst-case time of `series` series of `runs` timed runs plus one warm-up each (all at the per-run cap). */
export function seriesBudgetMs(series: number, runs: number): number {
  return series * (runs + 1) * PER_RUN_TIMEOUT_MS + 60_000;
}
