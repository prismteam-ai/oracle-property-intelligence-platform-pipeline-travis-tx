// A-13 fixed texts (contracts/ui-routes.md, both tables; FR-025, stable for A-14 and A-16). Every
// fixed string of the explorer and its pages lives here; pages and tests import these, never
// retype them. Templates are functions over plain values; nothing here holds a data value.
// This module imports nothing (no contract, no zod), so the shell and the Hub can use it through
// `@countylens/shared/texts` without pulling the contract schemas into the initial bundle.

/** `YYYY-MM-DD HH:mm UTC` of an ISO 8601 instant (the Hub chip and the run labels). */
export function utcMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not an instant: ${iso}`);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** `{first 4}…{last 4}` of a digest or CID. */
export function shortHash(value: string): string {
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Runs, Compare and the run index. */
export const RUNS_TEXTS = Object.freeze({
  nextSync: "Next sync: none · scheduler off by default",
  /** Shown only when both independent gateways (Pinata, orbitor) served the bytes (AM-10). */
  oldManifestResolves: "old manifest still resolves on Pinata and orbitor",
  /** Compare with one run, and the delta column of a first run. */
  firstRun: "first run · nothing to compare against",
  /** The numbering contract of `a`/`b` on Compare, the Hub chip and every "Run N" (PO 2026-10-26): the number in each non-pilot run's ID (run-numbers.ts); A-03's pilot slice is listed but never numbered. */
  numbering:
    "Run numbers come from the run ID (Run 3.1 corrects Run 3); a run ID without one takes the next number by finish time; the first small test slice is listed as Pilot slice and not numbered",
  indexUnavailable: (reason: string): string => `Run index unavailable · ${reason}`,
  manifestUnavailable: (cid: string, reason: string): string =>
    `Manifest unavailable · ${cid} · ${reason}`,
});

export interface SizeAndDigest {
  readonly size: number;
  readonly sha256: string;
}

/** Data · Verify lanes (research R3). */
export const VERIFY_TEXTS = Object.freeze({
  rateLimited: "rate-limited, retrying",
  noReadableResponse: "no readable response (rate-limited or blocked), retrying",
  viaCar: "Verify via CAR",
  verified: "Verified · size and SHA-256 match the manifest",
  mismatch: (got: SizeAndDigest, expected: SizeAndDigest): string =>
    `Mismatch · size ${got.size} vs ${expected.size} · SHA-256 ${shortHash(got.sha256)} vs ${shortHash(expected.sha256)}`,
  /** A lane that ended without bytes to compare (no ✓). */
  notVerified: (detail: string): string => `Not verified · ${detail}`,
  /** The Warning pill when a gateway other than the copy served the bytes. */
  fallback: (host: string): string => `fallback · ${host}`,
  /** Operator names of the Verify gateways (ARD § 16 AM-10). */
  gatewayOperators: Object.freeze({ pinata: "Pinata", orbitor: "orbitor", filebase: "Filebase" }),
  /**
   * The role line of each lane: plain facts (PO decision 2026-10-26, AM-10). "Independent" means a
   * public gateway CountyLens does not operate, bytes hash-checked; Pinata and orbitor are counted.
   */
  laneRoles: Object.freeze({
    pinata: "Public gateway · also holds our second copy",
    orbitor: "Public gateway · holds no copy of ours",
    filebase: "Our main storage host · fallback, not counted",
  }),
  /** The Filebase lane's text when its bytes match: shown, never counted. */
  fallbackVerified: "Bytes match the manifest · our storage host, not counted",
  countedLanesTitle: "Counted gateways",
  /** Why the counted gateways are not the README's examples (docs/decisions/0001-read-path.md,
   *  Finding 3: every request answers 429 with a Sunset header since 2026-09-21). */
  retiredGatewaysNote:
    "ipfs.io and dweb.link stopped serving HTTP content on 2026-09-21 (every request answers 429 with a Sunset header), so Verify uses Pinata and orbitor: two public gateways this project does not operate. Each fetches the CID from the IPFS network and the browser checks the size and SHA-256 against the manifest.",
  fallbackLanesTitle: "Fallback gateway · not counted",
  /** A counted lane that ended `failed` after its retries: no readable bytes, not tampering. */
  laneGaveUp: "no readable answer after retries",
  pinataGaveUp: "Pinata may be rate-limiting; try again",
  /** The page result: both counted lanes matched the manifest. */
  independentVerified:
    "Verified on Pinata and orbitor · two public gateways CountyLens does not operate; bytes match the manifest",
  independentPending:
    "Checking Pinata and orbitor · two public gateways CountyLens does not operate",
  /** The page result when a counted lane ended without a match; `details` from the two below. */
  independentNotVerified: (details: string): string =>
    `Not verified on two public gateways · ${details}`,
  noVerifiedAnswer: (gateways: string): string => `no verified answer from ${gateways}`,
  bytesDiffer: (gateways: string): string => `bytes differ on ${gateways}`,
  storedOnTitle: "Stored on",
  storedOn: Object.freeze([
    "Filebase: IPFS pin of every artifact (storage host)",
    "Pinata: second copy of every run manifest and of the latest run's table files that fit the free quota",
    "GitHub Release: CAR backup of the run, re-pinnable",
  ] as const),
  /** Plain words: the record ids behind this policy stay in the docs, not on the page. */
  storedOnProvenance:
    "Storage policy: a second copy on Pinata's free plan; CAR files on GitHub Releases",
});

/** Explore · Filters, the result rows, permits, owners and the SQL panel. */
export const EXPLORE_TEXTS = Object.freeze({
  // Counts carry thousands separators (final review: "68,527", not "68527").
  header: (n: number, r: number, place: string, years: number): string =>
    `${n.toLocaleString("en-US")} within ${r} mi of ${place} · roof ≥ ${years} yrs`,
  /** The header of a search without a roof filter: same wording, no roof clause. */
  headerNoRoof: (n: number, r: number, place: string): string =>
    `${n.toLocaleString("en-US")} within ${r} mi of ${place}`,
  /** A BAD_REQUEST from explore.search (never the validator's JSON dump). */
  filtersOutOfRange: "Those filters are out of range · check radius, roof age and open years",
  /** `sel` names a property that the current results do not contain. */
  propertyNotInResults:
    "That property is not in these results · change the filters or pick another",
  loadMore: "Load more",
  loadMoreFailed: "More rows could not be loaded · try again",
  showingFirst: (shown: number, total: number): string => `Showing the first ${shown} of ${total}`,
  showingAll: (total: number): string => `Showing all ${total}`,
  stalledExpired: (x: number): string => `Stalled ${x} yrs · source says Expired`,
  openSourceSays: (x: number, statusRaw: string): string =>
    `Open ${x} yrs · source says ${statusRaw}`,
  // PO 2026-10-26: the City's own status word (e.g. Expired) has no field in the published data
  // model (ADR-0002), so the chip says what the dates show: an expired permit is stalled.
  stalledNoCarrier: (x: number): string => `Stalled ${x} yrs · open past expiry, never closed`,
  openNoCarrier: (x: number): string => `Open ${x} yrs · within its permit period`,
  asPrinted: "as printed on permit",
  noCarrier: "not in the published data model (status is derived from the permit dates)",
  noOpenPermits: "no open roofing permits in this radius on the current run",
  /** PO 2026-10-26: an open permit includes stalled ones; when every match is stalled, say so. */
  allStalled: (n: number): string =>
    `All ${n.toLocaleString("en-US")} matching permits are stalled: still open past their expiry date, never closed.`,
  tenureUnknownCount: (n: number): string => `tenure unknown: ${n.toLocaleString("en-US")}`,
  engineBrowser: "DuckDB-WASM in your browser · read-only",
  engineServer: "DuckDB on the server · same views",
  zeroResults: (r: number, k: number): string =>
    `No properties within ${r} mi · ${k} close matches just outside`,
  milesOutside: (miles: number): string => `+${miles} mi`,
  roofUnknown: "roof age unknown · no permit, new-construction or built-year record",
  bbbNotChecked: (reason: string): string => `BBB not checked · ${reason}`,
  // A-16 data audit (2026-10-26, #1, #9, #18): the real reasons, not a blanket "no carrier".
  bbbBlocked: "BBB blocks automated lookups; not checked",
  addressNotInExport: "Address not in the published export",
  contractorNotPrinted: "No contractor printed on this permit",
  bbbNotFound: "BBB: no profile found",
  tenureUnknown: "tenure unknown · no dated sale on record",
  ownerAreaUnknown: "owner area unknown · mailing address not in the published export",
});

/** Coverage denominators (research R10, PO D-4). */
export const COVERAGE_TEXTS = Object.freeze({
  /** A record kind with no key in the run manifest's coverage section (TC-017). */
  kindAbsent: "not in this run's coverage section",
  denominatorMissing: "denominator not in this run's manifest",
  denominatorMissingFor: (source: string): string =>
    `denominator not in this run's manifest · source ${source}`,
});

/** Hub, Catalog, Coming soon, county selector and Help · MCP. */
export const PAGE_TEXTS = Object.freeze({
  comingSoonNotDeployed: "Coming soon · Not deployed yet",
  comingSoon: "Coming soon",
  travisOnly: "CountyLens has data for Travis County, TX only",
  catalogUnavailable: (reason: string): string => `Catalog unavailable · ${reason}`,
  tableExportMissing: "table export not in this run's manifest",
  /** "{Run N | Pilot slice} · {finishedAt as YYYY-MM-DD HH:mm UTC}"; the name follows RUNS_TEXTS.numbering. */
  hubChip: (name: string, finishedAt: string): string => `${name} · ${utcMinute(finishedAt)}`,
});

/** Help · MCP "Try a tool" (A-14 T034): fixed wording of every state. */
export const MCP_TRY_TEXTS = Object.freeze({
  running: "Running the tool…",
  noToken:
    "Runs on the server, read-only. You do not need a token here; the token is only for MCP clients.",
  truncated: (returned: number, total: number): string =>
    `Showing ${returned} of ${total} rows · the tool cut the list at its row limit`,
  complete: (returned: number): string => `${returned} rows · the full list`,
  shownOf: (shown: number, returned: number): string =>
    `Showing the first ${shown} of ${returned} returned rows`,
  badJson: "The arguments are not valid JSON",
  rateLimited: "Too many tool calls just now; wait a moment and try again",
  unreachable: "The server could not be reached; try again",
  emptyReason: (reason: string): string => `No rows · ${reason}`,
});

/** Explore · AI tab (A-14 T033, FR-012; contracts/agent-ask.md). Fixed wording of every state. */
export const AI_TEXTS = Object.freeze({
  /** Questions an anonymous visitor may ask in one browser session (spec: 10 per session). */
  sessionLimit: 10,
  /** Client-side stop (AD-27 layer 3), in milliseconds. */
  clientStopMs: 25_000,
  working: "Working…",
  workingElapsed: (seconds: number): string => `Working… ${seconds} s`,
  counter: (used: number, limit: number): string =>
    `${used} of ${limit} questions used this session`,
  noResults: "No matching properties",
  noResultsBody:
    "The agent found no rows for this question. What it could not tell is listed below.",
  throttled: "The AI is busy right now · wait a minute and try again",
  paused: "AI answers are paused for today · the daily budget is used up and resets at 00:00 UTC",
  timedOut: "Took too long · try again, or use Filters instead",
  limitReached: (limit: number): string =>
    `Question limit reached · ${limit} questions per session · use Filters, or reload to start a new session`,
  cancelled: "Cancelled · nothing was counted",
  failed: "The agent could not answer this question · try rephrasing it, or use Filters instead",
  unreachable: "The agent could not be reached · try again, or use Filters instead",
  howTitle: "How I read this",
  howHelp: "Edit a value and ask again to change how the question is read.",
  missingTitle: "What is missing or unknown",
  sourcesTitle: "Sources",
  noMissing: "Nothing reported missing for this answer.",
  searchedRun: "Searched run",
  runAsOf: "as of",
  runManifest: "manifest",
  sourceMissing: "source not in the published row",
});
