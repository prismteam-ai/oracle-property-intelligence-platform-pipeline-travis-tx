// The route set of the A-13 Part 2 specs (T043; testplans/A-13-test-cases.md TC-086, TC-073, TC-080).
// The list is read from apps/web/src/routes/route-list.ts and apps/web/src/content/coming-soon.ts
// as text at run time, so a route or Coming soon item added to the app is visited by the scan and
// the responsive, a11y and smoke cases without editing the specs. A route key this module cannot
// map to a URL throws, so a new route is never silently skipped. No network call, no browser.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTES, comingSoonPath, verifyPath } from "@countylens/shared";
import { repoRoot } from "./runtime.js";

const ROUTE_LIST_FILE = resolve(repoRoot, "apps", "web", "src", "routes", "route-list.ts");
const COMING_SOON_FILE = resolve(repoRoot, "apps", "web", "src", "content", "coming-soon.ts");

export interface ComingSoonItemFacts {
  readonly id: string;
  readonly title: string;
  readonly sentence: string;
  /** false: listed in the More sheet but has no page (AI-user sign-in). */
  readonly linked: boolean;
}

/** The Coming soon items of content/coming-soon.ts, in file order. */
export function comingSoonItems(
  source = readFileSync(COMING_SOON_FILE, "utf8"),
): ComingSoonItemFacts[] {
  const pattern =
    /id:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*sentence:\s*"((?:[^"\\]|\\.)*)",\s*linked:\s*(true|false)/g;
  const items = [...source.matchAll(pattern)].map((m) => ({
    id: m[1] ?? "",
    title: m[2] ?? "",
    sentence: JSON.parse(`"${m[3] ?? ""}"`) as string,
    linked: m[4] === "true",
  }));
  if (items.length === 0) throw new Error(`no Coming soon items found in ${COMING_SOON_FILE}`);
  return items;
}

export interface RouteTarget {
  /** The `ROUTES` key (hub, runs, …), plus a suffix for a variant of the same route. */
  readonly key: string;
  /** What the browser opens (path and query). */
  readonly path: string;
}

type RouteKey = keyof typeof ROUTES;

/**
 * Every route of route-list.ts as a URL to open. `/data/verify/:cid` takes the latest manifest CID,
 * `/runs/compare` the TC-086 query, and `/soon/:item` expands to
 * every linked Coming soon item. The other-county catch-all is TC-071's, not a route to scan.
 */
export function routeTargets(
  manifestCid: string,
  listSource = readFileSync(ROUTE_LIST_FILE, "utf8"),
  items = comingSoonItems(),
): RouteTarget[] {
  const keys = [...listSource.matchAll(/path:\s*ROUTES\.(\w+)/g)].map((m) => m[1] ?? "");
  if (keys.length === 0) throw new Error(`no ROUTES.* entries found in ${ROUTE_LIST_FILE}`);
  const out: RouteTarget[] = [];
  for (const key of keys) {
    if (!(key in ROUTES))
      throw new Error(`route-list.ts names ROUTES.${key}, not in @countylens/shared`);
    const path = ROUTES[key as RouteKey];
    switch (key) {
      case "dataVerify":
        out.push({ key, path: verifyPath(manifestCid) });
        break;
      case "runsCompare":
        out.push({ key, path: `${path}?a=1&b=1` });
        break;
      case "comingSoon":
        for (const item of items.filter((i) => i.linked)) {
          out.push({ key: `soon-${item.id}`, path: comingSoonPath(item.id) });
        }
        break;
      case "hub":
      case "explore":
      case "runs":
      case "runsLog":
      case "coverage":
      case "dataManifest":
      case "dataCatalog":
      case "helpMcp":
      case "legalData":
      case "legalPrivacy":
      case "legalTerms":
      case "permits":
      case "adminSignIn": // A-16: the public sign-in form (no session needed).
        out.push({ key, path });
        break;
      case "activity":
        // A-16: admin-only (RequireSession); a signed-out scan would only see the redirect to
        // sign-in. Covered signed in by A-16-admin.spec.ts, so the public page scans skip it.
        break;
      default:
        throw new Error(
          `route-list.ts has ROUTES.${key}, which a13-routes.ts cannot turn into a URL`,
        );
    }
  }
  return out;
}

/** The key of a target as a file-name-safe step slug source. */
export const targetLabel = (t: RouteTarget): string => t.key;

/** Median of a non-empty sample (mean of the two middle values for an even count). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
