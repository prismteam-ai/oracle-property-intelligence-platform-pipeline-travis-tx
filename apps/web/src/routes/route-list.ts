// The route list as data (A-13 T015, contracts/ui-routes.md, agent-design Answer 13): every
// route of the app, its title and its lazy page module. App.tsx builds the router from it, the
// shell's More sheet links from it, and the hosted no-sample-data scan (tests/e2e) walks it.
// Paths come from packages/shared ROUTES (stable for A-14 and A-16); `/tx/:county/*` catches
// another county's URL, which the ComingSoon module answers with the Travis-only message.
// Every page loads lazily, so no page's code (and never DuckDB-WASM) is in the Hub's graph.
import { ROUTES, type RoutePath } from "@countylens/shared/routes";
import type { ComponentType } from "react";

export interface RouteModule {
  readonly Component: ComponentType;
}

export const OTHER_COUNTY_PATH = "/tx/:county/*";

export interface RouteEntry {
  readonly path: RoutePath | typeof OTHER_COUNTY_PATH;
  readonly title: string;
  /** Story part (spec Part 1 / Part 2), or the kept A-03 page. */
  readonly part: 1 | 2 | "A-03";
  readonly load: () => Promise<RouteModule>;
}

export const ROUTE_LIST: readonly RouteEntry[] = Object.freeze([
  { path: ROUTES.hub, title: "Hub", part: 2, load: () => import("./Hub") },
  { path: ROUTES.runs, title: "Runs", part: 1, load: () => import("./Runs") },
  {
    path: ROUTES.runsCompare,
    title: "Runs · Compare",
    part: 1,
    load: () => import("./RunsCompare"),
  },
  { path: ROUTES.runsLog, title: "Runs · Log", part: 2, load: () => import("./RunsLog") },
  { path: ROUTES.coverage, title: "Coverage", part: 1, load: () => import("./Coverage") },
  { path: ROUTES.explore, title: "Explore", part: 1, load: () => import("./Explore") },
  {
    path: ROUTES.dataManifest,
    title: "Data · Manifest",
    part: 1,
    load: () => import("./DataManifest"),
  },
  { path: ROUTES.dataVerify, title: "Data · Verify", part: 1, load: () => import("./DataVerify") },
  {
    path: ROUTES.dataCatalog,
    title: "Data · Catalog",
    part: 2,
    load: () => import("./DataCatalog"),
  },
  { path: ROUTES.helpMcp, title: "Help · MCP", part: 1, load: () => import("./HelpMcp") },
  {
    path: ROUTES.legalData,
    title: "Legal · Data sources",
    part: 2,
    load: () => import("./LegalData"),
  },
  {
    path: ROUTES.legalPrivacy,
    title: "Legal · Privacy",
    part: 2,
    load: () => import("./LegalPrivacy"),
  },
  { path: ROUTES.legalTerms, title: "Legal · Terms", part: 2, load: () => import("./LegalTerms") },
  { path: ROUTES.comingSoon, title: "Coming soon", part: 2, load: () => import("./ComingSoon") },
  { path: OTHER_COUNTY_PATH, title: "Other county", part: 2, load: () => import("./ComingSoon") },
  { path: ROUTES.permits, title: "Permits", part: "A-03", load: () => import("./Permits") },
  {
    path: ROUTES.adminSignIn,
    title: "Admin sign-in",
    part: 2,
    load: () => import("./AdminSignIn"),
  },
  { path: ROUTES.activity, title: "Activity", part: 2, load: () => import("./Activity") },
]);

/** The pages the More sheet lists besides the Coming soon items. */
export const MORE_PAGES: readonly RouteEntry[] = ROUTE_LIST.filter((r) =>
  (
    [
      ROUTES.dataCatalog,
      ROUTES.runsLog,
      ROUTES.runsCompare,
      ROUTES.helpMcp,
      ROUTES.legalData,
      ROUTES.legalPrivacy,
      ROUTES.legalTerms,
    ] as readonly string[]
  ).includes(r.path),
);
