// T022: the TCAD probe (research R8, FR-003, FR-003a).
//
// 1. Capture the public-information page once and find the 2026 Certified Special Export,
//    the Export Layouts and the supplemental exports from their link text.
// 2. Download the Export Layouts (field definitions) once.
// 3. Download the 2026 Certified Special Export once to pipeline/data/raw/tcad/ (gitignored)
//    with a 10-minute inactivity limit and a 2-hour total limit; either limit is a timeout
//    and the source is recorded as blocked with `timeout_ms` (FR-003, FR-006).
// 4. Stream the export with stream-json (bounded memory; the file may be multi-GB): count
//    accounts, list fields, print the property key exactly as it appears, and note whether
//    deed or sale dates are present. A ZIP download is read entry by entry, never unpacked.
// Supplemental exports are listed only, never downloaded.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pipeline, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { z } from "zod";
import type { CaptureReceipt } from "../../lib/source-client.js";
import { isZip, listZipEntries, openZipEntry } from "../../lib/zip-entry.js";
import type { ExportReceipt, Measurement } from "../catalog.schema.js";
import { downloadRate, type DownloadRate } from "../measure.js";
import {
  missingReason,
  notAskedMeasurement,
  nullMeasurement,
  stopsSource,
  type ProbeDeps,
} from "./common.js";
import { ChallengeFreePage } from "./evidence.js";
import { exportSha256 } from "../../tcad/export-verify.js";

export const TCAD_PUBLIC_INFO_URL = "https://traviscad.org/publicinformation";
export const TCAD_RAW_DIR = fileURLToPath(new URL("../../../../data/raw/tcad", import.meta.url));
export const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
export const TOTAL_LIMIT_MS = 2 * 60 * 60 * 1000;
export const ROLL_YEAR = 2026;

const COUNT_METHOD = "streaming count";

export interface TcadLinks {
  certified_special_export: string | null;
  export_layouts: string | null;
  supplemental: Array<{ label: string; url: string }>;
  certification_date: string | null;
}

export interface ExportScan {
  /** "" for a top-level array, otherwise the top-level key holding the record array. */
  record_path: string;
  /** The JSON entry read inside a ZIP download, or null for a plain JSON file. */
  zip_entry: string | null;
  count: number;
  fields: string[];
  /** The key field exactly as printed: a top-level name, or `parent[].child` when nested. */
  identifier_name: string | null;
  /** The TCAD Export Layouts name of that key (`prop_id` or `geo_id`), see layoutNameFor. */
  identifier_layout_name: string | null;
  /** True only when the key is present exactly once on every record and unique across all. */
  identifier_proven: boolean;
  identifier_format: string | null;
  /** Every prop-id / geo-id field seen, with counts only (never values). */
  identifier_candidates?: IdentifierCandidate[];
  deed_or_sale_dates_present: boolean;
  /** Account-type counts from the same streaming pass (counts only, never values). */
  account_breakdown?: AccountBreakdown;
}

/** One count per state code among real-estate accounts with no export geometry point. */
export interface StateCodeCount {
  /** `propertyProfile[].stateCd` as printed, or "none" when the record has none. */
  state_cd: string;
  count: number;
  /** Of those, records with a non-empty `propertyCharacteristics[].condoUnit`. */
  with_condo_unit: number;
}

/**
 * Account-type breakdown of the certified export (PO decision 2026-10-20: explain the
 * GIS gap from data already held). Reads top-level `propType`, `inactive` and `geometry`,
 * `propertyIdentification[].geoID`, `propertyCharacteristics[].condoUnit` and
 * `propertyProfile[].stateCd`.
 */
export interface AccountBreakdown {
  records: number;
  /** Records whose `inactive` flag is set (anything but empty, 0 or false). */
  inactive_flagged: number;
  /** Counts by `propType` ("none" when absent), largest first. */
  by_prop_type: Array<{ prop_type: string; count: number }>;
  real_estate: {
    accounts: number;
    distinct_geo_ids: number;
    /** Real-estate accounts whose geoID is also printed on another real-estate account. */
    accounts_sharing_a_geo_id: number;
    accounts_without_geo_id: number;
    with_geometry_point: number;
    without_geometry_point: number;
    /** Largest first, then by code. */
    without_geometry_by_state_cd: StateCodeCount[];
  };
}

export interface IdentifierCandidate {
  name: string;
  records: number;
  /** Records carrying exactly one non-empty value for this field. */
  present: number;
  distinct: number;
  proven: boolean;
}

export interface TcadProbe {
  status: "available" | "blocked";
  receipts: CaptureReceipt[];
  blocked_receipt: CaptureReceipt | null;
  url: string;
  links: TcadLinks | null;
  layouts_receipt: CaptureReceipt | null;
  layouts_path: string | null;
  export_url: string | null;
  export_receipt: CaptureReceipt | null;
  export_path: string | null;
  download_rate: DownloadRate | null;
  scan: ExportScan | null;
  assessed_parcel_count: Measurement;
  roll_year: number;
  certification_date: string | null;
  /**
   * OR-m8: captured_at of the prior download whose file was reused (no export request was
   * sent); absent when the export was downloaded by this probe.
   */
  export_reused_from?: string;
}

export interface TcadProbeDeps extends ProbeDeps {
  rawDir?: string;
  landingUrl?: string;
  limits?: { inactivityMs: number; totalMs: number };
  /** Explicit JSON record path, once confirmed from the Export Layouts (T048). */
  recordPath?: string;
  /**
   * OR-m8: the previous export download; when `canReuseExport` holds, its file is scanned
   * again and no export request is sent.
   */
  priorExport?: PriorExport;
}

// ---------- landing page ----------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us)
    return `${us[3]}-${(us[1] as string).padStart(2, "0")}-${(us[2] as string).padStart(2, "0")}`;
  const long = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(raw);
  if (long) {
    const month = MONTHS.indexOf((long[1] as string).toLowerCase());
    if (month < 0) return null;
    return `${long[3]}-${String(month + 1).padStart(2, "0")}-${(long[2] as string).padStart(2, "0")}`;
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Finds the export links by their visible text (the page layout is not a contract). */
export function findTcadLinks(html: string, baseUrl: string): TcadLinks {
  const anchors: Array<{ text: string; url: string }> = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    try {
      anchors.push({ text: stripTags(m[3] as string), url: new URL(m[2] as string, baseUrl).href });
    } catch {
      // an unparsable href is not a download link
    }
  }
  const year = String(ROLL_YEAR);
  const special = anchors.filter(
    (a) => /special\s+export/i.test(a.text) && !/supplement/i.test(a.text),
  );
  const certified =
    special.find(
      (a) => /certified/i.test(a.text) && (a.text.includes(year) || a.url.includes(year)),
    ) ??
    special.find((a) => /certified/i.test(a.text) && !/\b20\d\d\b/.test(a.text)) ??
    null;
  const layouts = anchors.find((a) => /export\s+layouts?/i.test(a.text)) ?? null;
  const supplemental = anchors
    .filter((a) => /supplement/i.test(a.text))
    .map((a) => ({ label: a.text, url: a.url }));

  let certificationDate: string | null = null;
  const dateRe =
    /certif\w*[^.<]{0,60}?\b([A-Z][a-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i;
  const dm = dateRe.exec(stripTags(html));
  if (dm) certificationDate = normalizeDate(dm[1] as string);

  return {
    certified_special_export: certified ? certified.url : null,
    export_layouts: layouts ? layouts.url : null,
    supplemental,
    certification_date: certificationDate,
  };
}

/**
 * Where a TCAD download lands: pipeline/data/raw/tcad/<stem>-<8 hex of SHA-256(URL)><ext>
 * (CR-8): the URL basename alone is not unique (two links named `export.zip` would
 * overwrite each other), so a short digest of the whole URL is added. Files downloaded
 * before this rule keep their names: an existing file is always located through its
 * receipt's `file_path` (see `priorExportFrom`), never by recomputing the name.
 */
export function tcadExportPath(url: string, rawDir: string = TCAD_RAW_DIR): string {
  const raw = basename(new URL(url).pathname).replace(/[^A-Za-z0-9._-]/g, "_");
  const name = raw.length > 0 && raw !== "." ? raw : "tcad-certified-special-export";
  const tag = createHash("sha256").update(url).digest("hex").slice(0, 8);
  const ext = extname(name);
  const stem = ext.length > 0 && ext.length < name.length ? name.slice(0, -ext.length) : name;
  return join(rawDir, `${stem}-${tag}${ext.length < name.length ? ext : ""}`);
}

// ---------- OR-m8: reuse of an export already downloaded ----------

/**
 * A previous export download (the catalog's `parcel.export_receipt`) whose file may be
 * reused instead of a new GET (OR-m8: AC-3 says the export is downloaded once).
 */
export interface PriorExport {
  /** The previous receipt (outcome ok or throttled-then-ok). */
  receipt: CaptureReceipt;
  /** Absolute path of the file the receipt names. */
  path: string;
  /** Wall-clock seconds of that download (for the download rate). */
  seconds: number;
  /** The ETag of that download, when one was recorded (the 2026 catalog records none). */
  etag?: string;
}

/**
 * Builds a PriorExport from the catalog's export receipt. `repoRoot` resolves its
 * repository-relative `file_path`; the file keeps the name it was saved under.
 */
export function priorExportFrom(receipt: ExportReceipt, repoRoot: string): PriorExport {
  return {
    receipt: {
      url: receipt.url,
      method: receipt.method,
      status: receipt.status,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      captured_at: receipt.captured_at,
      user_agent: receipt.user_agent,
      attempts: receipt.attempts,
      outcome: receipt.outcome,
      geo_signal: "none",
      app_token_used: false,
      timeout_ms: null,
      blocked_reason: null,
      rate_limits_observed: null,
      resumes: receipt.resumes ?? 0,
    },
    path: join(repoRoot, receipt.file_path),
    seconds: receipt.seconds,
  };
}

/**
 * True when the prior download can stand in for a new one with no request: the landing
 * page still links the same export URL (a new export gets a new file name on TCAD), the
 * prior outcome was a success, and the local file has the receipt's size and SHA-256. An
 * ETag is compared only when both sides know one; the probe sends no HEAD to learn it.
 */
export async function canReuseExport(
  prior: PriorExport,
  exportUrl: string,
  currentEtag?: string,
): Promise<boolean> {
  const r = prior.receipt;
  if (r.url !== exportUrl || (r.outcome !== "ok" && r.outcome !== "throttled-then-ok")) {
    return false;
  }
  if (prior.etag !== undefined && currentEtag !== undefined && prior.etag !== currentEtag) {
    return false;
  }
  if (!existsSync(prior.path)) return false;
  if (statSync(prior.path).size !== r.bytes) return false;
  // CR2-10: re-hash only when {size, mtime, inode} changed since the last hash.
  return (await exportSha256(prior.path)).sha256 === r.sha256;
}

// ---------- streaming scan ----------

type Token = { name: string; value?: unknown };

function openExport(path: string): { stream: Readable; zip_entry: string | null } {
  if (!isZip(path)) return { stream: createReadStream(path), zip_entry: null };
  const jsonEntries = listZipEntries(path)
    .filter((e) => /\.json$/i.test(e.name))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize);
  const entry = jsonEntries[0];
  if (!entry) throw new Error("tcad: the ZIP export has no .json entry");
  return { stream: openZipEntry(path, entry), zip_entry: entry.name };
}

/** Reads only the first tokens to find where the record array sits. */
async function detectRecordPath(path: string): Promise<string> {
  const { stream } = openExport(path);
  const tokens = stream.pipe(parser.asStream({ streamValues: false }));
  let depth = 0;
  let key: string | null = null;
  try {
    for await (const raw of tokens) {
      const token = raw as Token;
      if (depth === 0) {
        if (token.name === "startArray") return "";
        if (token.name !== "startObject") break;
        depth = 1;
        continue;
      }
      if (depth === 1 && token.name === "keyValue") {
        key = String(token.value);
        continue;
      }
      if (depth === 1 && token.name === "startArray" && key !== null) return key;
      if (token.name === "startObject" || token.name === "startArray") depth += 1;
      else if (token.name === "endObject" || token.name === "endArray") depth -= 1;
      if (depth === 0) break;
    }
  } finally {
    stream.destroy();
    tokens.destroy();
  }
  throw new Error("tcad: no record array found at the top level of the export");
}

const RecordSchema = z.record(z.string(), z.unknown());
// Printed spellings of the property id: prop_id / PROP_ID (legacy layout), propID, property_id
// and pID (the 2026 TCAD protax JSON). Only a TOP-LEVEL field counts: every child array of
// the protax JSON (deeds, owners, sales...) repeats pID, which is a foreign key there.
const PROP_ID = /^p(?:rop(?:erty)?)?[_ ]?id$/i;
const GEO_ID = /^geo[_ ]?id$/i;
const DEED_OR_SALE_DATE = /(deed|sale).*(date|dt)|(date|dt).*(deed|sale)/i;
const MAX_FIELD_DEPTH = 3;

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

/**
 * The TCAD Export Layouts name of a printed key (FR-003a, PO decision 2026-10-20). The
 * Legacy 8.0.33 Appraisal Export Layout (the "Export Layouts" download) defines File #2
 * Property with `prop_id` ("Property ID") and `geo_id` ("Geographic ID"); the 2026 JSON
 * export prints them as `pID` and `propertyIdentification[].geoID`. Only a top-level
 * property id or a top-level / one-level-nested geo id maps; a child array's repeated pID
 * (for example `deeds[].pID`) is a foreign key and maps to nothing.
 */
export function layoutNameFor(printed: string): "prop_id" | "geo_id" | null {
  if (PROP_ID.test(printed)) return "prop_id";
  const leaf = printed.split(".").at(-1) ?? printed;
  if (GEO_ID.test(leaf) && printed.split(".").length <= 2) return "geo_id";
  return null;
}

/** Rank: top-level prop id, then top-level geo id, then a geo id nested one level down. */
type IdRank = 0 | 1 | 2;

class IdTracker {
  readonly seen = new Set<string>();
  present = 0;
  allNumbers = true;
  allDigits = true;
  minLen = Number.POSITIVE_INFINITY;
  maxLen = 0;
  constructor(
    readonly rank: IdRank,
    readonly order: number,
  ) {}
  /** One record's values for this field: proven only when there is exactly one. */
  addRecord(values: readonly unknown[]): void {
    const present = values.filter((v) => isScalar(v) && nonEmpty(v));
    if (present.length !== 1) return;
    const v = present[0];
    const s = String(v);
    this.present += 1;
    this.seen.add(s);
    if (typeof v !== "number") this.allNumbers = false;
    if (!/^\d+$/.test(s)) this.allDigits = false;
    this.minLen = Math.min(this.minLen, s.length);
    this.maxLen = Math.max(this.maxLen, s.length);
  }
  proven(count: number): boolean {
    return count > 0 && this.present === count && this.seen.size === count;
  }
  format(): string {
    const kind = this.allNumbers ? "integer" : this.allDigits ? "string of digits" : "string";
    const unit = this.allNumbers ? "digits" : "characters";
    return this.minLen === this.maxLen
      ? `${kind}, ${this.minLen} ${unit}`
      : `${kind}, ${this.minLen}-${this.maxLen} ${unit}`;
  }
}

/** Collects one record's key candidates: top-level prop/geo ids and nested geo ids. */
function keyCandidates(
  record: Record<string, unknown>,
): Map<string, { rank: IdRank; values: unknown[] }> {
  const out = new Map<string, { rank: IdRank; values: unknown[] }>();
  for (const [k, v] of Object.entries(record)) {
    if (PROP_ID.test(k)) out.set(k, { rank: 0, values: [v] });
    else if (GEO_ID.test(k)) out.set(k, { rank: 1, values: [v] });
    else if (v !== null && typeof v === "object") {
      const children = Array.isArray(v) ? v : [v];
      const base = Array.isArray(v) ? `${k}[]` : k;
      for (const child of children) {
        if (child === null || typeof child !== "object" || Array.isArray(child)) continue;
        for (const [ck, cv] of Object.entries(child)) {
          if (!GEO_ID.test(ck)) continue;
          const name = `${base}.${ck}`;
          const entry = out.get(name) ?? { rank: 2 as const, values: [] };
          entry.values.push(cv);
          out.set(name, entry);
        }
      }
    }
  }
  return out;
}

/** The first non-empty scalar `field` of `record[key]` (an array of objects, or one object). */
function firstChildValue(
  record: Record<string, unknown>,
  key: string,
  field: string,
): string | null {
  const v = record[key];
  const children = Array.isArray(v) ? v : [v];
  for (const child of children) {
    if (child === null || typeof child !== "object" || Array.isArray(child)) continue;
    const value = (child as Record<string, unknown>)[field];
    if (isScalar(value) && nonEmpty(value)) return String(value).trim();
  }
  return null;
}

function isFlagSet(v: unknown): boolean {
  if (!nonEmpty(v) || !isScalar(v)) return false;
  return v !== false && v !== 0 && String(v).trim() !== "0";
}

/**
 * True when `geometry` is a point: a "[lat, lon]" string of two finite numbers. The 2026
 * protax JSON prints a missing point as the string "[null, null]", not as null, so a
 * non-empty string is not enough.
 */
export function isGeometryPoint(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const m = /^\s*\[\s*([^,\]]+?)\s*,\s*([^,\]]+?)\s*\]\s*$/.exec(v);
  if (!m) return false;
  return [m[1], m[2]].every((x) => x !== undefined && x !== "" && Number.isFinite(Number(x)));
}

/** The real-estate property type in the TCAD protax JSON (Export Layouts: R = Real). */
const REAL_ESTATE = "R";

class BreakdownTracker {
  private records = 0;
  private inactive = 0;
  private readonly byType = new Map<string, number>();
  private readonly geoIds = new Map<string, number>();
  private realEstate = 0;
  private withoutGeoId = 0;
  private withGeometry = 0;
  private readonly noGeometry = new Map<string, { count: number; with_condo_unit: number }>();

  add(record: Record<string, unknown>): void {
    this.records += 1;
    if (isFlagSet(record.inactive)) this.inactive += 1;
    const rawType = record.propType;
    const type = isScalar(rawType) && nonEmpty(rawType) ? String(rawType).trim() : "none";
    this.byType.set(type, (this.byType.get(type) ?? 0) + 1);
    if (type !== REAL_ESTATE) return;

    this.realEstate += 1;
    const geoId = firstChildValue(record, "propertyIdentification", "geoID");
    if (geoId === null) this.withoutGeoId += 1;
    else this.geoIds.set(geoId, (this.geoIds.get(geoId) ?? 0) + 1);

    if (isGeometryPoint(record.geometry)) {
      this.withGeometry += 1;
      return;
    }
    const code = firstChildValue(record, "propertyProfile", "stateCd") ?? "none";
    const row = this.noGeometry.get(code) ?? { count: 0, with_condo_unit: 0 };
    row.count += 1;
    if (firstChildValue(record, "propertyCharacteristics", "condoUnit") !== null)
      row.with_condo_unit += 1;
    this.noGeometry.set(code, row);
  }

  result(): AccountBreakdown {
    let sharing = 0;
    for (const n of this.geoIds.values()) if (n > 1) sharing += n;
    const byCount = <T extends { count: number }>(a: [string, T], b: [string, T]): number =>
      b[1].count - a[1].count || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    return {
      records: this.records,
      inactive_flagged: this.inactive,
      by_prop_type: [...this.byType.entries()]
        .map(([k, count]): [string, { count: number }] => [k, { count }])
        .sort(byCount)
        .map(([prop_type, { count }]) => ({ prop_type, count })),
      real_estate: {
        accounts: this.realEstate,
        distinct_geo_ids: this.geoIds.size,
        accounts_sharing_a_geo_id: sharing,
        accounts_without_geo_id: this.withoutGeoId,
        with_geometry_point: this.withGeometry,
        without_geometry_point: this.realEstate - this.withGeometry,
        without_geometry_by_state_cd: [...this.noGeometry.entries()]
          .sort(byCount)
          .map(([state_cd, r]) => ({
            state_cd,
            count: r.count,
            with_condo_unit: r.with_condo_unit,
          })),
      },
    };
  }
}

export async function scanExport(
  path: string,
  opts: { recordPath?: string } = {},
): Promise<ExportScan> {
  const recordPath = opts.recordPath ?? (await detectRecordPath(path));
  const { stream, zip_entry } = openExport(path);
  const records = streamArray.asStream();
  const stages: NodeJS.ReadWriteStream[] = [parser.asStream()];
  if (recordPath !== "") stages.push(pick.asStream({ filter: recordPath }));
  pipeline([stream, ...stages, records], (error) => {
    if (error) records.destroy(error);
  });

  const fields = new Set<string>();
  const ids = new Map<string, IdTracker>();
  const breakdown = new BreakdownTracker();
  let deedOrSale = false;
  let count = 0;

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (depth > MAX_FIELD_DEPTH || value === null || typeof value !== "object") return;
    const entries = Array.isArray(value)
      ? value.flatMap((item) =>
          item !== null && typeof item === "object" && !Array.isArray(item)
            ? Object.entries(item)
            : [],
        )
      : Object.entries(value);
    const base = Array.isArray(value) ? `${prefix}[]` : prefix;
    for (const [k, v] of entries) {
      const name = base === "" ? k : `${base}.${k}`;
      fields.add(name);
      if (!deedOrSale && DEED_OR_SALE_DATE.test(k) && nonEmpty(v) && typeof v !== "object")
        deedOrSale = true;
      walk(v, name, depth + 1);
    }
  };

  for await (const item of records) {
    const record = RecordSchema.parse((item as { value: unknown }).value);
    count += 1;
    breakdown.add(record);
    for (const [name, { rank, values }] of keyCandidates(record)) {
      let t = ids.get(name);
      if (!t) {
        t = new IdTracker(rank, ids.size);
        ids.set(name, t);
      }
      t.addRecord(values);
    }
    walk(record, "", 1);
  }

  // Ranked candidates; the first proven one is the key, otherwise the best-ranked one is
  // named with identifier_proven false (the printed name is still evidence).
  const ranked = [...ids.entries()].sort(([, a], [, b]) => a.rank - b.rank || a.order - b.order);
  const chosen = ranked.find(([, t]) => t.proven(count)) ?? ranked[0] ?? null;
  const tracker = chosen ? chosen[1] : null;
  return {
    record_path: recordPath,
    zip_entry,
    count,
    fields: [...fields].sort(),
    identifier_name: chosen ? chosen[0] : null,
    identifier_layout_name: chosen ? layoutNameFor(chosen[0]) : null,
    identifier_proven: tracker !== null && tracker.proven(count),
    identifier_format: tracker && tracker.present > 0 ? tracker.format() : null,
    identifier_candidates: ranked.map(([name, t]) => ({
      name,
      records: count,
      present: t.present,
      distinct: t.seen.size,
      proven: t.proven(count),
    })),
    deed_or_sale_dates_present: deedOrSale,
    account_breakdown: breakdown.result(),
  };
}

// ---------- the probe ----------

export async function probeTcad(deps: TcadProbeDeps): Promise<TcadProbe> {
  const landingUrl = deps.landingUrl ?? TCAD_PUBLIC_INFO_URL;
  const rawDir = deps.rawDir ?? TCAD_RAW_DIR;
  const limits = deps.limits ?? { inactivityMs: INACTIVITY_LIMIT_MS, totalMs: TOTAL_LIMIT_MS };
  const receipts: CaptureReceipt[] = [];
  const base: TcadProbe = {
    status: "available",
    receipts,
    blocked_receipt: null,
    url: landingUrl,
    links: null,
    layouts_receipt: null,
    layouts_path: null,
    export_url: null,
    export_receipt: null,
    export_path: null,
    download_rate: null,
    scan: null,
    assessed_parcel_count: nullMeasurement(landingUrl, deps.now().toISOString(), "not measured"),
    roll_year: ROLL_YEAR,
    certification_date: null,
  };
  const stop = (
    receipt: CaptureReceipt,
    url: string,
    partial: Partial<TcadProbe> = {},
  ): TcadProbe => ({
    ...base,
    ...partial,
    status: "blocked",
    blocked_receipt: receipt,
    assessed_parcel_count: nullMeasurement(
      url,
      receipt.captured_at,
      `TCAD ${missingReason(receipt)}`,
      COUNT_METHOD,
    ),
  });

  // 1. landing page
  const landing = await deps.client.capture({
    url: landingUrl,
    schema: ChallengeFreePage,
    bodyKind: "text",
    accept: "text/html",
  });
  receipts.push(landing.receipt);
  if (stopsSource(landing.receipt) || landing.data === null)
    return stop(landing.receipt, landingUrl);
  const links = findTcadLinks(landing.data, landingUrl);
  base.links = links;
  base.certification_date = links.certification_date;
  if (links.certified_special_export === null) {
    return {
      ...base,
      assessed_parcel_count: nullMeasurement(
        landingUrl,
        landing.receipt.captured_at,
        `${ROLL_YEAR} Certified Special Export link not found on the public-information page`,
        COUNT_METHOD,
      ),
    };
  }
  const exportUrl = links.certified_special_export;
  base.export_url = exportUrl;

  // 2. export layouts (field definitions), once
  if (links.export_layouts !== null) {
    const layouts = await deps.client.capture({ url: links.export_layouts, accept: "*/*" });
    receipts.push(layouts.receipt);
    base.layouts_receipt = layouts.receipt;
    if (stopsSource(layouts.receipt)) {
      return {
        ...stop(layouts.receipt, links.export_layouts),
        assessed_parcel_count: notAskedMeasurement(exportUrl, layouts.receipt, COUNT_METHOD),
      };
    }
    mkdirSync(rawDir, { recursive: true });
    const layoutsPath = tcadExportPath(links.export_layouts, rawDir);
    writeFileSync(layoutsPath, layouts.body);
    base.layouts_path = layoutsPath;
  }

  // 3. the one download (OR-m8: or none, when the prior download's file still matches)
  const prior = deps.priorExport;
  if (prior !== undefined && (await canReuseExport(prior, exportUrl))) {
    base.export_receipt = prior.receipt;
    base.export_path = prior.path;
    base.export_reused_from = prior.receipt.captured_at;
    base.download_rate = downloadRate({
      bytes: prior.receipt.bytes,
      seconds: Math.max(prior.seconds, 0.001),
      source_url: exportUrl,
      captured_at: prior.receipt.captured_at,
    });
    return scanned(base, prior.path, exportUrl, prior.receipt.captured_at, deps.recordPath);
  }
  const dl = await deps.client.download({
    url: exportUrl,
    destPath: tcadExportPath(exportUrl, rawDir),
    inactivityMs: limits.inactivityMs,
    totalMs: limits.totalMs,
  });
  receipts.push(dl.receipt);
  base.export_receipt = dl.receipt;
  if (stopsSource(dl.receipt) || dl.path === null) return stop(dl.receipt, exportUrl);
  base.export_path = dl.path;
  base.download_rate = downloadRate({
    bytes: dl.receipt.bytes,
    seconds: Math.max(dl.seconds, 0.001),
    source_url: exportUrl,
    captured_at: dl.receipt.captured_at,
  });

  // 4. streaming scan
  return scanned(base, dl.path, exportUrl, dl.receipt.captured_at, deps.recordPath);
}

/** Step 4: the streaming scan of the export file; a scan failure leaves the count null. */
async function scanned(
  base: TcadProbe,
  path: string,
  exportUrl: string,
  capturedAt: string,
  recordPath: string | undefined,
): Promise<TcadProbe> {
  try {
    const scan = await scanExport(path, recordPath === undefined ? {} : { recordPath });
    return {
      ...base,
      scan,
      assessed_parcel_count: {
        value: scan.count,
        source_url: exportUrl,
        captured_at: capturedAt,
        method: COUNT_METHOD,
        ...(scan.record_path === "" ? {} : { query: `record path: ${scan.record_path}` }),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      assessed_parcel_count: nullMeasurement(
        exportUrl,
        capturedAt,
        `export downloaded but not countable: ${message}`,
        COUNT_METHOD,
      ),
    };
  }
}

// ---------- A-04 CR2-10: verify the export without re-hashing 3.5 GB every run ----------
// The summary file read lives in travis/tcad/export-verify.ts (this probe never reads a
// whole file into memory); re-exported here as the A-01 probe's entry point.
export {
  ExportVerifyError,
  exportSha256,
  exportSummaryPath,
  verifyExport,
  type ExportSummary,
  type ExportVerifyCode,
} from "../../tcad/export-verify.js";
