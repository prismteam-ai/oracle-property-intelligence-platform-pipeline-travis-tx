// Explore URL state (A-13 T025, FR-004a, contracts/ui-routes.md: `at`, `r`, `roof`, `permit`,
// `openYrs`, `tenure`, `ooa`, `sort`, `sel`, `mode`, `place`, `view=list`; no `z`; `view=map`
// falls back to the list). Values outside the explore.search bounds (query-core EXPLORE_BOUNDS)
// are dropped, never clamped into a different question. Without `place` or `at` the page asks
// about DEFAULT_PLACE, a Travis County gazetteer entry (static text, not data). `permit` keeps
// its URL spelling: `open_stalled` / `open_or_stalled` → open_or_stalled, `open`, `stalled`;
// anything else (e.g. `any`) means no permit filter.
import {
  EXPLORE_BOUNDS,
  EXPLORE_MAX_PAGE,
  EXPLORE_SORTS,
  type ExploreSort,
  type PermitFilter,
} from "@countylens/query-core";
import type { ExploreUrlParam } from "@countylens/shared/routes";

/** The area asked about when the URL names none (the county seat, a gazetteer place). */
export const DEFAULT_PLACE = "Austin";
export const DEFAULT_RADIUS_MI = 5;
/** The value the "Open or stalled" switch writes. */
export const OPEN_STALLED = "open_stalled";
/** The search debounce of every control (research R1). */
export const SEARCH_DEBOUNCE_MS = 250;

export interface ExploreQuery {
  readonly place: string | null;
  readonly at: { readonly lat: number; readonly lon: number } | null;
  readonly r: number;
  readonly roof: number | undefined;
  /** The raw URL value (the controls show it); `permitFilter` maps it for the search. */
  readonly permit: string | undefined;
  readonly openYrs: number | undefined;
  readonly tenure: number | undefined;
  readonly ooa: boolean;
  readonly sort: ExploreSort;
  readonly sel: string | null;
  /** 0-based results page (the URL's `page` is 1-based). */
  readonly page: number;
}

const inRange = (value: number, [min, max]: readonly [number, number]): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

function num(
  params: URLSearchParams,
  key: ExploreUrlParam,
  range: readonly [number, number],
  integer = false,
): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!inRange(value, range) || (integer && !Number.isInteger(value))) return undefined;
  return value;
}

function parseAt(raw: string | null): ExploreQuery["at"] {
  if (raw === null) return null;
  const [lat, lon] = raw.split(",").map((part) => Number(part.trim()));
  if (lat === undefined || lon === undefined) return null;
  return inRange(lat, EXPLORE_BOUNDS.lat) && inRange(lon, EXPLORE_BOUNDS.lon) ? { lat, lon } : null;
}

export function parseExploreQuery(params: URLSearchParams): ExploreQuery {
  const at = parseAt(params.get("at"));
  const place = params.get("place")?.trim() || null;
  const sortRaw = params.get("sort");
  const sort = (EXPLORE_SORTS as readonly string[]).includes(sortRaw ?? "")
    ? (sortRaw as ExploreSort)
    : "nearest";
  const ooa = params.get("ooa");
  return {
    place: place ?? (at === null ? DEFAULT_PLACE : null),
    at: place === null ? at : null,
    r: num(params, "r", EXPLORE_BOUNDS.radiusMi) ?? DEFAULT_RADIUS_MI,
    roof: num(params, "roof", EXPLORE_BOUNDS.roof, true),
    permit: params.get("permit") ?? undefined,
    openYrs: num(params, "openYrs", EXPLORE_BOUNDS.openYrs),
    tenure: num(params, "tenure", EXPLORE_BOUNDS.tenure, true),
    ooa: ooa === "1" || ooa === "true",
    sort,
    sel: params.get("sel"),
    page: (num(params, "page", [1, EXPLORE_MAX_PAGE + 1], true) ?? 1) - 1,
  };
}

export function permitFilter(raw: string | undefined): PermitFilter | undefined {
  switch (raw) {
    case "open_stalled":
    case "open_or_stalled":
      return "open_or_stalled";
    case "open":
    case "stalled":
      return raw;
    default:
      return undefined;
  }
}

export function isOpenOrStalled(raw: string | undefined): boolean {
  return permitFilter(raw) === "open_or_stalled";
}

/** The explore.search input of a query for the bound run (contracts/explore-search.md). */
export interface ExploreSearchRequest {
  readonly manifestCid: string;
  readonly area: { readonly place: string } | { readonly at: { lat: number; lon: number } };
  readonly radius_mi: number;
  readonly roof?: number;
  readonly permit?: PermitFilter;
  readonly openYrs?: number;
  readonly tenure?: number;
  readonly ooa?: boolean;
  readonly sort: ExploreSort;
  readonly limit: number;
  readonly page?: number;
}

/** Rows a results page (PO 2026-10-26: 20, as the boards' pager). */
export const EXPLORE_PAGE_ROWS = 20;

export function searchRequest(query: ExploreQuery, manifestCid: string): ExploreSearchRequest {
  const permit = permitFilter(query.permit);
  return {
    manifestCid,
    area: query.place !== null ? { place: query.place } : { at: query.at ?? { lat: 0, lon: 0 } },
    radius_mi: query.r,
    ...(query.roof === undefined ? {} : { roof: query.roof }),
    ...(permit === undefined ? {} : { permit }),
    ...(permit === undefined || query.openYrs === undefined ? {} : { openYrs: query.openYrs }),
    ...(query.tenure === undefined ? {} : { tenure: query.tenure }),
    ...(query.ooa ? { ooa: true } : {}),
    sort: query.sort,
    limit: EXPLORE_PAGE_ROWS,
    ...(query.page > 0 ? { page: query.page } : {}),
  };
}

/** Applies a patch of URL values (undefined/null/"" removes the key); `view` is always `list`. */
export function patchParams(
  params: URLSearchParams,
  patch: Partial<Record<ExploreUrlParam, string | number | boolean | null | undefined>>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "" || value === false) next.delete(key);
    else next.set(key, value === true ? "1" : String(value));
  }
  if (next.get("view") === "map") next.set("view", "list");
  return next;
}
