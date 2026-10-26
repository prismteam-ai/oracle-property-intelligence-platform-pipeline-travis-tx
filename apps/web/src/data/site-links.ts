// Site links (A-13 T014, research R6, contracts/site-links.md): `public/site-links.json` is
// written at build time by amplify.yml from Amplify variables the Web stack sets (CRM_URL,
// DEMO_VIDEO_URL, PR_URL; empty by default). Each value is shown only when it is an https URL;
// an empty, invalid or unreadable value is hidden (the CRM card stays "Coming soon · Not deployed
// yet"). Switching a link is a Web-stack deploy plus an Amplify rebuild, never a code change.
import { browserFetch, requestInit } from "./http";

export const SITE_LINKS_PATH = "/site-links.json";

export interface SiteLinks {
  readonly crmUrl?: string;
  readonly demoVideoUrl?: string;
  readonly prUrl?: string;
}

const KEYS = ["crmUrl", "demoVideoUrl", "prUrl"] as const;

/** An absolute https URL. Plain URL parsing (no schema library): the Hub's graph stays small. */
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps each known key whose value is an https URL; everything else is dropped. */
export function parseSiteLinks(data: unknown): SiteLinks {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const record = data as Record<string, unknown>;
  const links: { -readonly [K in keyof SiteLinks]: string } = {};
  for (const key of KEYS) {
    const url = httpsUrl(record[key]);
    if (url !== undefined) links[key] = url;
  }
  return links;
}

export interface LoadSiteLinksOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** GET SITE_LINKS_PATH; any failure hides every link ({}). */
export async function loadSiteLinks(options: LoadSiteLinksOptions = {}): Promise<SiteLinks> {
  const fetchImpl = options.fetch ?? browserFetch;
  try {
    const response = await fetchImpl(SITE_LINKS_PATH, requestInit(options.signal));
    if (response.status !== 200) return {};
    return parseSiteLinks(JSON.parse(await response.text()));
  } catch {
    return {};
  }
}
