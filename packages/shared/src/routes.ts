// A-13 (contracts/ui-routes.md): the route paths and Explore URL parameters, stable for A-14 and
// A-16 (FR-025). apps/web's route-list.ts maps each path to its lazy page. No imports, so the
// shell reads it through `@countylens/shared/routes` without the contract schemas.
export const ROUTES = Object.freeze({
  hub: "/",
  runs: "/runs",
  runsCompare: "/runs/compare",
  runsLog: "/runs/log",
  coverage: "/tx/travis/coverage",
  explore: "/tx/travis/explore",
  dataManifest: "/data/manifest",
  dataVerify: "/data/verify/:cid",
  dataCatalog: "/data/catalog",
  helpMcp: "/help/mcp",
  legalData: "/legal/data",
  legalPrivacy: "/legal/privacy",
  legalTerms: "/legal/terms",
  comingSoon: "/soon/:item",
  permits: "/permits",
  // A-16 (frozen interfaces): admin sign-in (email + password) and the admin-only Activity page.
  // The Runs admin controls live on the existing `runs` route.
  adminSignIn: "/admin/sign-in",
  activity: "/activity",
});

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** `/data/verify/{cid}`. */
export const verifyPath = (cid: string): string => `/data/verify/${encodeURIComponent(cid)}`;
/** `/soon/{item}`. */
export const comingSoonPath = (item: string): string => `/soon/${encodeURIComponent(item)}`;

/** Explore URL state (FR-004a): no `z`; `view=map` falls back to `view=list`. */
export const EXPLORE_URL_PARAMS = Object.freeze([
  "at",
  "r",
  "roof",
  "permit",
  "openYrs",
  "tenure",
  "ooa",
  "sort",
  "sel",
  "mode",
  "place",
  "view",
  // A-16 (PO 2026-10-26): the results page, 1-based (20 rows a page); absent = page 1.
  "page",
] as const);
export type ExploreUrlParam = (typeof EXPLORE_URL_PARAMS)[number];
