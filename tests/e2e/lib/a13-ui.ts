// Pure helpers and the DOM contract of the A-13 Part 1 specs (T032, T033; testplans/A-13-test-cases.md
// § 3 and § 8). Importing this module makes no network call and reads no page.
//
// DOM contract (what apps/web must render for the A-13 explorer specs; G2 builds it). Role and label
// selectors first; the data-* hooks below are the only other hooks the specs read.
// - Page: `section[data-route="{route}"]` with `data-state` = `loading` | `ready` | `error`
//   (route names as in apps/web/src/routes/*.tsx: runs, runs-compare, coverage, explore,
//   data-manifest, data-verify, help-mcp).
// - Progress: `role="progressbar"` with an accessible name. Errors: `role="alert"`.
// - Full CIDs: `[data-cid="{cid}"]` (visible text may be truncated); a CID copy button has an
//   accessible name starting "Copy" and ending "CID".
// - Fallback chip: its own text element reading `fallback · {FILEBASE_GATEWAY_HOST}`.
// - Runs: the run card is the `article` whose level-2 heading is the runId (A-03); each source is
//   `[data-source="{name}"]` holding `[data-delta="added|changed|removed"]` cells (or the first-run
//   text); limitations are a list with accessible name "Limitations"; coverage rows are
//   `[data-coverage="{key}"]` (A-03).
// - Compare: one `[data-compare-run]` per column with `data-cid`; the previous link is
//   a link `a[data-previous-cid="{cid}"]`; a CAR link per run `a[data-car-link]`; the summed size
//   `[data-total-size]` (bytes in the attribute); the pill text RUNS_TEXTS.oldManifestResolves;
//   one `[data-gateway="pinata|orbitor|filebase"]` check with `data-check` (the pill needs
//   Pinata and orbitor; Filebase is the labelled fallback, AM-10); a button "Re-check".
// - Coverage: each record kind `[data-kind="{kind}"]` (KIND_IDS; contractor names its five states)
//   holds its `[data-coverage-key="{key}"]` count rows (each with `[data-count]`, the derivation
//   label and a `time[datetime]`) or the "not in this run's coverage section" text, and a table chip
//   `[data-table="{group/table}"]` with the table's `[data-cid]`; each denominator
//   `[data-denominator="{source}"]` (its number in `[data-count]`).
// - Manifest: the run chain `[data-chain-entry]` (latest first, `data-cid` = manifest CID) with a
//   link "Verify" and a button "Copy CID"; the artifact table `table[aria-label="Artifacts"]`, one
//   `tbody tr[data-artifact="{name}"]` per artifact with `[data-cid]`, `[data-codec]`,
//   `[data-size]`, `[data-sha256]`, `[data-car-cid]` (where present) and a link "Verify" or
//   "Verify via CAR".
// - Verify: the page result `[data-verify-result]` (pending, verified, not_verified, via_car;
//   decided by Pinata and orbitor only, AM-10), then one lane per gateway
//   `[data-lane="pinata|orbitor|filebase"]` (`data-independent` true|false) with `data-state` = the
//   VerifyLane kind (idle, fetching, retrying, verified, mismatch, failed, via_car), the lane URL
//   as text, `[data-got-size]`, `[data-got-sha256]`, `[data-expected-size]`,
//   `[data-expected-sha256]` (full values in the attribute `data-value`), and "✓" only when
//   verified.
// - Explore · Filters: the place box `role="combobox"` named "Place"; suggestions `role="option"`;
//   controls labelled "Radius", "Roof age", "Open or stalled", "Open ≥", "Sort", "Tenure",
//   "Out-of-area owner"; preset buttons by name (`ooa78753`); the header `[data-explore-header]`;
//   the engine line `[data-engine-line]`; result rows `[data-result-row]` (`data-property-cid`) with
//   cells `[data-field="{field}"]`; the row provenance `[data-provenance]` naming the run ID with a
//   `[data-cid]` table CID; close matches `[data-close-match]` with `[data-miles-outside]`
//   (`data-value` = miles); permit chips `[data-permit-chip]` (`data-open-days`); the empty open
//   list text EXPLORE_TEXTS.noOpenPermits; filter definitions `[data-filter-definition="tenure|ooa"]`;
//   the count `[data-tenure-unknown]`; the drawer `role="dialog"` with `[data-field]` cells, a
//   contractor badge `[data-contractor-resolution]` and the BBB line `[data-field="bbb"]`.
import type { RunManifestV1 } from "@countylens/contract";
import { COVERAGE_TEXTS, EXPLORE_TEXTS, VERIFY_TEXTS } from "@countylens/shared";
import { z } from "zod";
import { stepSlug } from "./evidence.js";

// ---------------------------------------------------------------------------------------
// Fixed strings not (yet) exported by @countylens/shared. Each is listed in the G4 report so G2
// can move it into packages/shared/src/texts.ts; the specs switch to the import then.
// ---------------------------------------------------------------------------------------

/** Test plan § 3 "Coverage kind absent" (spec AC-2 #3). Not in @countylens/shared yet. */
export const COVERAGE_KIND_ABSENT_TEXT = COVERAGE_TEXTS.kindAbsent;

/** A-03 FallbackChip wording (apps/web/src/data/fetch-by-cid.ts `fallbackLabel`). */
export const fallbackText = (host: string): string => VERIFY_TEXTS.fallback(host);

/** The record kinds Coverage lists (AC-2), as `data-kind` ids. */
export const KIND_IDS = [
  "property",
  "ownership",
  "permit",
  "contractor",
  "bbb",
  "business",
  "places",
  "coordinates",
] as const;

/** The five contractor resolution states the contractor kind lists (AC-2, AD-24). */
export const CONTRACTOR_STATES = [
  "resolved",
  "candidate",
  "ambiguous",
  "conflicting",
  "unresolved",
] as const;

// ---------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------

export type A13Route =
  "runs" | "runs-compare" | "coverage" | "explore" | "data-manifest" | "data-verify" | "help-mcp";

export const SEL = {
  page: (route: A13Route): string => `section[data-route="${route}"]`,
  ready: (route: A13Route): string => `section[data-route="${route}"][data-state="ready"]`,
  progress: '[role="progressbar"]',
  alert: '[role="alert"]',
  cid: "[data-cid]",
  source: (name: string): string => `[data-source="${name}"]`,
  delta: (kind: "added" | "changed" | "removed"): string => `[data-delta="${kind}"]`,
  runsCoverage: "[data-coverage]",
  compareRun: "[data-compare-run]",
  previousLink: "[data-previous-cid]",
  carLink: "a[data-car-link]",
  totalSize: "[data-total-size]",
  resolveCheck: (gw: "pinata" | "orbitor" | "filebase"): string => `[data-gateway="${gw}"]`,
  coverageKey: "[data-coverage-key]",
  count: "[data-count]",
  /** The kind's table chip; its CID is a `[data-cid]` inside. */
  table: "[data-table]",
  kind: (kind: string): string => `[data-kind="${kind}"]`,
  denominator: (source: string): string => `[data-denominator="${source}"]`,
  chainEntry: "[data-chain-entry]",
  artifactTable: 'table[aria-label="Artifacts"]',
  artifactRow: (name: string): string => `tbody tr[data-artifact="${name}"]`,
  artifactRows: 'table[aria-label="Artifacts"] tbody tr[data-artifact]',
  lane: (gw: "pinata" | "orbitor" | "filebase"): string => `[data-lane="${gw}"]`,
  verifyResult: "[data-verify-result]",
  header: "[data-explore-header]",
  engineLine: "[data-engine-line]",
  resultRow: "[data-result-row]",
  field: (field: string): string => `[data-field="${field}"]`,
  provenance: "[data-provenance]",
  closeMatch: "[data-close-match]",
  milesOutside: "[data-miles-outside]",
  permitChip: "[data-permit-chip]",
  filterDefinition: (f: "tenure" | "ooa"): string => `[data-filter-definition="${f}"]`,
  tenureUnknown: "[data-tenure-unknown]",
  contractorBadge: "[data-contractor-resolution]",
} as const;

// ---------------------------------------------------------------------------------------
// Evidence names
// ---------------------------------------------------------------------------------------

/** `"7"`, `"007"`, `"TC-007"`, `"A-13-TC-007"` → `TC-007`. */
export function a13TcId(tc: string): string {
  const bare = tc
    .trim()
    .replace(/^A-13-/i, "")
    .replace(/^TC-/i, "");
  if (!/^\d{1,3}$/.test(bare)) throw new Error(`A-13 test case id must be numeric: "${tc}"`);
  return `TC-${bare.padStart(3, "0")}`;
}

/** `A-13-TC-{nnn}-{step}.png` (docs/evidence/img). */
export function a13EvidenceName(tc: string, step: string | number): string {
  return `A-13-${a13TcId(tc)}-${stepSlug(String(step))}.png`;
}

/** The exact Playwright title of a case: `@scenario:A-13-TC-{nnn}`. */
export function scenario(tc: string): string {
  return `@scenario:A-13-${a13TcId(tc)}`;
}

// ---------------------------------------------------------------------------------------
// Explore URLs
// ---------------------------------------------------------------------------------------

export type ExploreParams = Partial<
  Record<
    | "at"
    | "r"
    | "roof"
    | "permit"
    | "openYrs"
    | "tenure"
    | "ooa"
    | "sort"
    | "sel"
    | "mode"
    | "place"
    | "view",
    string | number
  >
>;

/** `/tx/travis/explore?{params}` in the given key order (the URL the case names). */
export function exploreUrl(explorePath: string, params: ExploreParams = {}): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return explorePath;
  // `at=lat,lon` keeps its comma readable, as the test plan writes it.
  const query = entries
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/gi, ",")}`)
    .join("&");
  return `${explorePath}?${query}`;
}

/**
 * {x} of a permit chip: open days / 365.25 to one decimal, rounded down, as the explore.search
 * contract fixes `open_years` (specs/013-explorer-and-pages/contracts/explore-search.md) and
 * query-core's toExploreRow computes it.
 */
export function openYears(openDays: number): number {
  return Math.floor((openDays / 365.25) * 10) / 10;
}

/** The numeric {x} of a "Stalled {x} yrs …" / "Open {x} yrs …" chip, or null. */
export function chipYears(text: string): number | null {
  const m = /^(?:Stalled|Open) (\d+(?:\.\d)?) yrs · /.exec(text.trim());
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** A regex of a fixed template with `{…}` holes: each hole matches `.+?`, the rest is literal. */
export function templatePattern(rendered: (...holes: string[]) => string, holes: number): RegExp {
  const text = rendered(...Array.from({ length: holes }, (_, i) => `@@${i}@@`));
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/@@\d+@@/g, "(.+?)")}$`);
}

// ---------------------------------------------------------------------------------------
// Manifest test data (test plan § 5)
// ---------------------------------------------------------------------------------------

export const VERIFY_MAX_BYTES = 50 * 1024 * 1024;

type Artifact = RunManifestV1["artifacts"][number];

/** Verify file artifact: the largest `raw` table artifact ≤ 50 MB (today a structure part). */
export function verifyFileArtifact(manifest: RunManifestV1): Artifact {
  const files = manifest.artifacts
    .filter((a) => a.kind === "table" && a.codec === "raw" && a.size <= VERIFY_MAX_BYTES)
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  const pick = files[0] ?? null;
  if (pick === null) throw new Error("the latest manifest has no raw table artifact ≤ 50 MB");
  return pick;
}

/** Directory artifact: the first directory artifact (a pilot `tables/{group}`, or one export batch of a full-county run). */
export function directoryArtifact(manifest: RunManifestV1): Artifact {
  const dir = manifest.artifacts.find((a) => a.kind === "directory");
  if (dir === undefined) throw new Error("the latest manifest has no tables directory");
  return dir;
}

/** File artifacts over 50 MB (TC-019). */
export function oversizedFiles(manifest: RunManifestV1): Artifact[] {
  return manifest.artifacts.filter((a) => a.kind !== "directory" && a.size > VERIFY_MAX_BYTES);
}

/** The latest manifest lists `tables-export.json` (A-11 switch, test plan § 3). */
export function hasTablesExport(manifest: RunManifestV1): boolean {
  return manifest.artifacts.some((a) => /(^|\/)tables-export\.json$/.test(a.name));
}

/** "Waits for A-11" branch: full assertions once the index holds ≥ 3 runs and the export. */
export function a11Branch(runCount: number, manifest: RunManifestV1): "a11" | "today" {
  return runCount >= 3 && hasTablesExport(manifest) ? "a11" : "today";
}

/** The same bytes with the last byte flipped (TC-021). */
export function flipLastByte(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) throw new Error("cannot flip a byte of an empty body");
  const out = new Uint8Array(bytes);
  out[out.length - 1] = (out[out.length - 1] ?? 0) ^ 0xff;
  return out;
}

/** Cell text that counts as blank (TC-033 step 4). */
export function isBlankCell(text: string): boolean {
  return /^(|null|undefined|NaN|—|-)$/.test(text.trim());
}

/** Stack-trace shapes that must never reach the page (TC-039). */
export function looksLikeStack(text: string): boolean {
  return (
    /\bat .+:\d+:\d+/.test(text) ||
    /\.(?:ts|js):\d+/.test(text) ||
    /\bError:\s*\n\s+at\b/.test(text)
  );
}

// ---------------------------------------------------------------------------------------
// explore.search responses (contracts/explore-search.md; query-core ExploreRow)
// ---------------------------------------------------------------------------------------

const MissingEntry = z.object({ field: z.string(), reason: z.string() }).loose();

export const ExploreRowShape = z
  .object({
    property_cid: z.string(),
    address: z.string().nullable(),
    dist_mi: z.number(),
    bearing: z.string(),
    lat: z.number(),
    lon: z.number(),
    roof_age_years: z.number().nullable(),
    roof_age_basis: z.string().nullable(),
    roof_age_confidence: z.string().nullable(),
    permit: z
      .object({
        number: z.string().nullable(),
        status_class: z.string().nullable(),
        open_years: z.number().nullable(),
        open_days: z.number().nullable(),
      })
      .loose()
      .nullable(),
    contractor: z.object({ resolution: z.string().nullable() }).loose().nullable(),
    bbb_status: z.string().nullable(),
    bbb_status_reason: z.string().nullable(),
    tenure_years: z.number().nullable(),
    tenure_basis: z.string().nullable(),
    owner_area_class: z.string().nullable(),
    provenance: z
      .object({ run_id: z.string().nullable(), table_cid: z.string().nullable() })
      .loose(),
    missing: z.array(MissingEntry),
  })
  .loose();
export type ExploreRowShape = z.infer<typeof ExploreRowShape>;

export const ExploreSearchResult = z
  .object({
    total_within_r: z.number().int().nonnegative(),
    tenure_unknown: z.number().int().nonnegative(),
    rows: z.array(ExploreRowShape),
    close_matches: z.array(z.object({ row: ExploreRowShape, miles_outside: z.number() }).loose()),
    as_of: z.object({ runId: z.string(), manifestCid: z.string() }).loose(),
    engine: z.literal("server"),
    area: z.unknown().optional(),
    queryDurationMs: z.number().optional(),
  })
  .loose();
export type ExploreSearchResult = z.infer<typeof ExploreSearchResult>;

/** The `data` of a tRPC response body (single or batched, with or without a `json` wrapper). */
export function trpcData(body: unknown): unknown {
  const first: unknown = Array.isArray(body) ? body[0] : body;
  const data = (first as { result?: { data?: unknown } } | undefined)?.result?.data;
  if (data === undefined) throw new Error("not a tRPC result body");
  if (data !== null && typeof data === "object" && "json" in data) {
    return (data as { json: unknown }).json;
  }
  return data;
}

/** The fixed BBB text a row must show for its `bbb_status`, or null when a rating is expected. */
/**
 * A-16 data audit #1: the contractor cell shows the name printed on the permit (Run 3: 4,139 of
 * 15,025 permits), else "No contractor printed on this permit". Read from whichever field the
 * explore.search row carries it in.
 */
export function expectedContractorText(row: ExploreRowShape): string {
  const r = row as {
    contractor?: { name_as_printed?: string | null } | null;
    permit?: { contractor_name_as_printed?: string | null } | null;
    contractor_name_as_printed?: string | null;
  };
  return (
    r.contractor?.name_as_printed ??
    r.permit?.contractor_name_as_printed ??
    r.contractor_name_as_printed ??
    EXPLORE_TEXTS.contractorNotPrinted
  );
}

export function expectedBbbText(status: string | null, reason: string | null): string | null {
  switch (status) {
    case "not_checked":
      return EXPLORE_TEXTS.bbbNotChecked(reason ?? "");
    case "blocked":
      return EXPLORE_TEXTS.bbbBlocked;
    case "not_found":
      return EXPLORE_TEXTS.bbbNotFound;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------
// Gazetteer (travis-places@1.0.0, read from the committed files at run time)
// ---------------------------------------------------------------------------------------

export interface GazetteerPlace {
  readonly geoid: string;
  readonly name: string;
  readonly name_lsad: string;
  readonly lat: number;
  readonly lon: number;
  readonly source_file: string;
}

const MINUS = "−";
const coord = (v: number): string => (v < 0 ? `${MINUS}${String(-v)}` : String(v));

/** "{name_lsad} · Census {year} Gazetteer · {lat}, {lon}" (U+2212 for a negative coordinate). */
export function placeSuggestion(place: GazetteerPlace): string {
  const year = /\/(\d{4})_Gazetteer\//.exec(place.source_file)?.[1];
  if (year === undefined) throw new Error(`no Census year in ${place.source_file}`);
  return `${place.name_lsad} · Census ${year} Gazetteer · ${coord(place.lat)}, ${coord(place.lon)}`;
}
