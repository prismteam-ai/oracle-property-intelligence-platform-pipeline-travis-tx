// T026 + T033 + T047: the A-01 checker, rules 1-11 (contracts/catalog.md). The kit validator
// ignores these A-01 keys, so this checker enforces them. Review additions (CR-A-01):
// rule 7 also checks the full-purpose / ETJ split (OR-m6); rule 10 binds each approved
// exception to the values it was approved for (OR-M3); rule 11 keeps status and stop
// evidence consistent, so an available source is never presented as blocked (OR-M5).
//
// Usage: check-catalog [path]   (default pipeline/docs/travis-sources.yaml)
// Prints one line per failure, `FAIL rule <n>: <subject> <detail>`, and exits 1 on any
// failure. It reads the YAML as plain data (not through the strict Zod schema) so a
// damaged catalog still yields numbered failures instead of one parse error.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { containsHomePath, redact } from "../lib/log.js";
import { isEtj, isFullPurpose, matchesJurisdiction } from "./austin-issued.js";
import { DECISIONS, SOURCE_KEYS } from "./catalog.schema.js";
import { MAX_PAGE_SIZE, MIN_PAGES, exceedsDecisionThreshold } from "./measure.js";
import {
  CENTRAL_PORTAL_KINDS,
  SPEC_CLASSES,
  STATUS_MAP,
  VALIDATOR_STATUSES,
} from "./status-map.js";
import { DEFAULT_CATALOG_PATH } from "./write-catalog.js";

export { DEFAULT_CATALOG_PATH };

type Obj = Record<string, unknown>;

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PROJECTION_TOLERANCE_H = 0.1;
const GAP_TOLERANCE_PCT = 0.01;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function text(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

type Fail = (rule: number, subject: string, detail: string) => void;

/** Rule 2 on one Measurement. */
function checkMeasurement(m: Obj, path: string, fail: Fail): void {
  if (!text(m.source_url)) fail(2, path, "missing source_url");
  if (!(typeof m.captured_at === "string" && UTC_ISO.test(m.captured_at))) {
    fail(2, path, "missing or non-UTC captured_at");
  }
  if (m.value === null) {
    if (!text(m.missing_reason)) fail(2, path, "value null without missing_reason");
  } else if (!num(m.value)) {
    fail(2, path, "value is neither a number nor null");
  }
}

/** Walks the catalog; every object with an own `value` key is a Measurement (FR-007a). */
function walkMeasurements(node: unknown, path: string, fail: Fail): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const label = isObj(item) && text(item.key) ? item.key : String(i);
      walkMeasurements(item, `${path}[${label}]`, fail);
    });
    return;
  }
  if (!isObj(node)) return;
  if (Object.hasOwn(node, "value")) {
    checkMeasurement(node, path, fail);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    walkMeasurements(v, path === "" ? k : `${path}.${k}`, fail);
  }
}

const REQUEST_STATUSES = new Set(["custodian-only", "manual-only", "blocked"]);
const REQUEST_ROUTES = new Set(["api-first", "records-first"]);
const AUSTIN_DATASET = /data\.austintexas\.gov/i;

/** The validator's `_records_request_complete`, on plain data. */
function requestComplete(req: unknown): boolean {
  if (!isObj(req)) return false;
  return (
    text(req.recipient_office) &&
    text(req.system_scope) &&
    typeof req.route === "string" &&
    REQUEST_ROUTES.has(req.route) &&
    (text(req.request_portal_url) || text(req.request_email))
  );
}

/** Rule 6: count = Census place_count + 1; one valid class per row with its extras (R3). */
function checkJurisdictions(cat: Obj, fail: Fail): void {
  const census = cat.census_reference;
  const placeCount = isObj(census) && num(census.place_count) ? census.place_count : null;
  if (placeCount === null) fail(6, "census_reference", "missing");
  const permits = cat.permits;
  if (!isObj(permits)) {
    fail(6, "permits", "block missing");
    return;
  }
  const rows = Array.isArray(permits.jurisdictions) ? permits.jurisdictions : [];
  if (placeCount !== null) {
    const expected = placeCount + 1;
    if (rows.length !== expected) {
      fail(6, "jurisdictions", `${rows.length} != census place_count + 1 (${expected})`);
    }
    if (permits.expected_jurisdiction_count !== expected) {
      fail(
        6,
        "permits",
        `expected_jurisdiction_count ${String(permits.expected_jurisdiction_count)} != census place_count + 1 (${expected})`,
      );
    }
  }
  if (permits.assumes_unified_countywide_history !== false) {
    fail(6, "permits", "assumes_unified_countywide_history must be false");
  }
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const r: Obj = isObj(raw) ? raw : {};
    const id = text(r.key) ? r.key : `jurisdictions[${i}]`;
    if (text(r.key)) {
      if (seen.has(r.key)) fail(6, "jurisdictions", `duplicate key ${r.key}`);
      seen.add(r.key);
    }
    if (!text(r.jurisdiction)) fail(6, id, "jurisdiction name missing");
    if (!text(r.evidence_url)) fail(6, id, "evidence_url missing");
    if (!(typeof r.evidence_captured_at === "string" && UTC_ISO.test(r.evidence_captured_at))) {
      fail(6, id, "evidence_captured_at missing or non-UTC");
    }
    const status = r.status;
    if (!(
      typeof status === "string" && (VALIDATOR_STATUSES as readonly string[]).includes(status)
    )) {
      fail(
        6,
        id,
        `status "${String(status)}" is not a validator status (${VALIDATOR_STATUSES.join(", ")})`,
      );
      return;
    }
    const specClass = r.spec_class;
    if (!(
      typeof specClass === "string" && (SPEC_CLASSES as readonly string[]).includes(specClass)
    )) {
      fail(6, id, `spec_class "${String(specClass)}" is not one of ${SPEC_CLASSES.join(" | ")}`);
      return;
    }
    const mapping = STATUS_MAP.find((m) => m.spec_class === specClass && m.status === status);
    if (!mapping) {
      fail(6, id, `spec_class "${specClass}" does not map to status "${status}" (research R3)`);
      return;
    }
    if (typeof r.historical_records !== "boolean") {
      fail(6, id, "historical_records must be true or false");
    } else if (r.historical_records !== mapping.historical_records) {
      fail(6, id, `historical_records ${r.historical_records} does not match status "${status}"`);
    }
    const kind = typeof r.portal_kind === "string" ? r.portal_kind.trim().toLowerCase() : "";
    if (CENTRAL_PORTAL_KINDS.has(kind) && r.historical_records === true) {
      fail(6, id, `portal_kind "${kind}" is intake and cannot be historical records`);
    }
    if (status === "supported" && !text(r.earliest_record_date)) {
      fail(6, id, "earliest_record_date missing (status supported)");
    }
    if (REQUEST_STATUSES.has(status) && !requestComplete(r.records_request)) {
      fail(6, id, `records_request missing or incomplete for status "${status}"`);
    }
    if (status === "blocked" && !isObj(r.blocked_evidence)) {
      fail(6, id, "blocked_evidence missing (status blocked)");
    }
    if (status === "delegated" && !text(r.issued_by)) {
      fail(6, id, "issued_by missing (status delegated)");
    }
  });
}

/** Rule 7: Austin-issued counts located elsewhere stay under Austin (FR-004c). */
function checkAustinIssued(cat: Obj, austin: Obj | undefined, fail: Fail): void {
  if (!austin) return; // rule 5 already reports the missing Austin row
  const located = Array.isArray(austin.located_in_other_jurisdictions)
    ? austin.located_in_other_jurisdictions.filter(isObj)
    : null;
  if (located === null || located.length === 0) {
    fail(7, "austin_permits", "located_in_other_jurisdictions missing");
  }
  const entries = located ?? [];
  const permits = isObj(cat.permits) ? cat.permits : {};
  const rows = Array.isArray(permits.jurisdictions) ? permits.jurisdictions.filter(isObj) : [];
  for (const r of rows) {
    if (!text(r.jurisdiction)) continue;
    const id = text(r.key) ? r.key : r.jurisdiction;
    const isAustin = /^austin$/i.test(r.jurisdiction.trim());
    if (!isAustin && text(r.evidence_url) && AUSTIN_DATASET.test(r.evidence_url)) {
      fail(
        7,
        id,
        "evidence_url is the Austin permits dataset; a city's class rests on its own evidence",
      );
    }
    if (isAustin) continue;
    const matching = entries.filter(
      (e) =>
        typeof e.jurisdiction === "string" &&
        matchesJurisdiction(e.jurisdiction, r.jurisdiction as string),
    );
    const sum = matching.reduce((acc, e) => acc + (num(e.value) ? e.value : 0), 0);
    const here = r.austin_issued_located_here;
    if (matching.length === 0) {
      if (isObj(here)) fail(7, id, "austin_issued_located_here has no matching Austin entry");
      continue;
    }
    if (!isObj(here)) {
      fail(7, id, `austin_issued_located_here missing (Austin entries ${sum})`);
    } else if (here.value !== sum) {
      fail(7, id, `austin_issued_located_here ${String(here.value)} != Austin entries ${sum}`);
    }
    const parts: Array<[string, (label: string) => boolean]> = [
      ["austin_issued_full_purpose", isFullPurpose],
      ["austin_issued_etj", isEtj],
    ];
    for (const [field, belongs] of parts) {
      const part = r[field];
      const partSum = matching
        .filter((e) => typeof e.jurisdiction === "string" && belongs(e.jurisdiction))
        .reduce((acc, e) => acc + (num(e.value) ? e.value : 0), 0);
      if (!isObj(part)) {
        fail(7, id, `${field} missing (Austin entries ${partSum})`);
      } else if (part.value !== partSum) {
        fail(7, id, `${field} ${String(part.value)} != Austin entries ${partSum}`);
      }
    }
  }
}

/** Rule 10: an approved exception holds only for the values it was approved for (OR-M3). */
function checkExceptions(cat: Obj, fail: Fail): void {
  const list = Array.isArray(cat.approved_exceptions) ? cat.approved_exceptions : [];
  const parcel = isObj(cat.parcel) ? cat.parcel : {};
  list.forEach((raw, i) => {
    const e: Obj = isObj(raw) ? raw : {};
    const id = `approved_exceptions[${text(e.gate) ? e.gate : i}]`;
    for (const field of ["gate", "reason", "approved_by", "approved_at", "coverage_effect"]) {
      if (!text(e[field])) fail(10, id, `${field} missing`);
    }
    if (!(text(e.decision_ref) && /^docs\/decisions\/[^/]+\.md$/.test(e.decision_ref))) {
      fail(10, id, "decision_ref missing (docs/decisions/<file>.md)");
    }
    if (e.gate !== "parcel") return;
    const bound: Array<[string, string, number]> = [
      ["approved_gis_count", "gis_feature_count", 0],
      ["approved_assessed_count", "assessed_parcel_count", 0],
      ["approved_gap_pct", "gap_pct", 0.005],
    ];
    for (const [approved, actual, tolerance] of bound) {
      const a = e[approved];
      const b = parcel[actual];
      if (!num(a)) {
        fail(10, id, `${approved} missing`);
      } else if (!num(b) || Math.abs(a - b) > tolerance) {
        fail(
          10,
          id,
          `parcel.${actual} ${String(b)} differs from ${approved} ${a}; the exception no longer applies`,
        );
      }
    }
  });
}

/** Rule 11: blocked_evidence only on a blocked row, and every blocked row has it (OR-M5). */
function checkStopConsistency(cat: Obj, fail: Fail): void {
  const sources = Array.isArray(cat.sources) ? cat.sources.filter(isObj) : [];
  for (const s of sources) {
    const key = text(s.key) ? s.key : "(unnamed source)";
    if (s.status === "available" && isObj(s.blocked_evidence)) {
      fail(
        11,
        key,
        "is available but carries blocked_evidence; an operator-side stop of an available source is operator_blocked_evidence",
      );
    }
    if (s.status === "blocked" && !isObj(s.blocked_evidence)) {
      fail(11, key, "is blocked without blocked_evidence");
    }
    if (s.status === "blocked" && isObj(s.operator_blocked_evidence)) {
      fail(11, key, "is blocked; operator_blocked_evidence is only for an available source");
    }
  }
  const permits = isObj(cat.permits) ? cat.permits : {};
  const rows = Array.isArray(permits.jurisdictions) ? permits.jurisdictions.filter(isObj) : [];
  for (const r of rows) {
    if (r.status !== "blocked" && isObj(r.blocked_evidence)) {
      fail(
        11,
        text(r.key) ? r.key : "(unnamed row)",
        `is ${String(r.status)} but carries blocked_evidence`,
      );
    }
  }
}

// ---------- T047: rule 9, catalog hygiene ----------

/** What rule 9 refuses. The FAIL line names the pattern and the path, never the value. */
const HYGIENE_PATTERNS: ReadonlyArray<readonly [string, { test(text: string): boolean }]> = [
  ["a postgres:// connection URL", /postgres(?:ql)?:\/\//i],
  ["credentials in a URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@/i],
  [
    "a token value in a query string",
    /[?&](?:\$\$)?(?:app_token|token|access_token|api_key|apikey|secret|password|sig|signature)=[^&#\s"]+/i,
  ],
  ["an X-App-Token header value", /x-app-token\s*[:=]\s*\S+/i],
  ["a bearer or basic credential", /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/],
  ["an absolute home path", { test: containsHomePath }],
  ["the DATABASE_URL variable name", /DATABASE_URL/],
  ["a password assignment", /password\s*[=:]\s*\S+/i],
];

export interface CheckOptions {
  /** Secret values that must never appear verbatim (for example the Socrata app token). */
  secrets?: readonly string[];
}

/** Rule 9 on every string (keys and values) in the catalog. */
function checkHygiene(node: unknown, path: string, secrets: readonly string[], fail: Fail): void {
  const inspect = (text: string, where: string): void => {
    // one FAIL line per string: the first finding is enough to stop the catalog
    if (secrets.some((secret) => secret.length > 0 && text.includes(secret))) {
      fail(9, where, "contains a registered secret value");
      return;
    }
    const hit = HYGIENE_PATTERNS.find(([, re]) => re.test(text));
    if (hit) fail(9, where, `contains ${hit[0]}`);
  };
  if (typeof node === "string") {
    inspect(node, path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const label = isObj(item) && text(item.key) ? item.key : String(i);
      checkHygiene(item, `${path}[${label}]`, secrets, fail);
    });
    return;
  }
  if (!isObj(node)) return;
  for (const [k, v] of Object.entries(node)) {
    const where = path === "" ? k : `${path}.${k}`;
    inspect(k, `${where} (key)`);
    checkHygiene(v, where, secrets, fail);
  }
}

export function checkCatalog(raw: unknown, options: CheckOptions = {}): string[] {
  const lines: string[] = [];
  const fail: Fail = (rule, subject, detail) => {
    lines.push(`FAIL rule ${rule}: ${subject} ${detail}`);
  };
  const cat: Obj = isObj(raw) ? raw : {};
  const sources = Array.isArray(cat.sources) ? cat.sources.filter(isObj) : [];
  const byKey = new Map<string, Obj>();
  for (const s of sources) if (text(s.key) && !byKey.has(s.key)) byKey.set(s.key, s);

  // Rule 1: all 9 source keys present.
  for (const key of SOURCE_KEYS) if (!byKey.has(key)) fail(1, "sources", `missing ${key}`);

  // Rule 2: every Measurement has source_url and captured_at; every null has a reason.
  if (Array.isArray(cat.sources)) walkMeasurements(cat.sources, "sources", fail);
  if (isObj(cat.parcel)) walkMeasurements(cat.parcel, "parcel", fail);
  if (isObj(cat.permits)) walkMeasurements(cat.permits, "permits", fail);

  // Rule 3: every source has a decision (one of three words) and a reason.
  for (const s of sources) {
    const key = text(s.key) ? s.key : "(unnamed source)";
    const hours = num(s.projected_full_capture_hours) ? s.projected_full_capture_hours : null;
    if (!text(s.decision)) {
      if (exceedsDecisionThreshold(hours)) {
        fail(3, key, `projected ${fmt(hours as number)} h has no decision`);
      } else {
        fail(3, key, "has no decision");
      }
    } else if (!(DECISIONS as readonly string[]).includes(s.decision)) {
      fail(3, key, `decision "${s.decision}" is not one of ${DECISIONS.join(" | ")}`);
    }
    if (!text(s.decision_reason)) fail(3, key, "has no decision_reason");
  }

  // Rule 4: Comptroller has both counts; the denominator is the Travis-coded count.
  const comptroller = byKey.get("tx_comptroller");
  if (!comptroller) {
    fail(4, "tx_comptroller", "row missing");
  } else {
    const travis = comptroller.travis_coded_rows;
    const statewide = comptroller.statewide_rows;
    if (!isObj(travis)) fail(4, "tx_comptroller", "missing travis_coded_rows");
    if (!isObj(statewide)) fail(4, "tx_comptroller", "missing statewide_rows");
    if (isObj(travis)) {
      const denominator = isObj(comptroller.denominator)
        ? comptroller.denominator.value
        : undefined;
      if (denominator !== travis.value) {
        fail(4, "tx_comptroller", "denominator does not equal travis_coded_rows");
      }
      if (
        isObj(statewide) &&
        num(statewide.value) &&
        num(travis.value) &&
        statewide.value < travis.value
      ) {
        fail(4, "tx_comptroller", "statewide_rows is smaller than travis_coded_rows");
      }
    }
  }

  // Rule 5: Austin has count, null tcad_id count, throughput, projection and decision.
  const austin = byKey.get("austin_permits");
  if (!austin) {
    fail(5, "austin_permits", "row missing");
  } else {
    const subject = "austin_permits";
    const denominator = isObj(austin.denominator) ? austin.denominator.value : undefined;
    if (!num(denominator)) fail(5, subject, "count (denominator.value) missing");
    const nulls = austin.tcad_id_null_count;
    if (!isObj(nulls) || !num(nulls.value)) fail(5, subject, "tcad_id_null_count missing");
    const t = austin.throughput;
    let median: number | null = null;
    if (!isObj(t)) {
      fail(5, subject, "throughput missing");
    } else {
      if (!(num(t.pages_read) && t.pages_read >= MIN_PAGES)) {
        fail(5, subject, `throughput.pages_read ${String(t.pages_read)} is below ${MIN_PAGES}`);
      }
      if (!(num(t.page_size) && t.page_size > 0 && t.page_size <= MAX_PAGE_SIZE)) {
        fail(
          5,
          subject,
          `throughput.page_size ${String(t.page_size)} is not within 1..${MAX_PAGE_SIZE}`,
        );
      }
      if (num(t.rows_per_minute_median) && t.rows_per_minute_median > 0) {
        median = t.rows_per_minute_median;
      } else {
        fail(5, subject, "throughput.rows_per_minute_median is not positive");
      }
    }
    const projected = austin.projected_full_capture_hours;
    if (!num(projected)) {
      fail(5, subject, "projected_full_capture_hours missing");
    } else if (num(denominator) && median !== null) {
      const expected = denominator / median / 60;
      if (Math.abs(projected - expected) > PROJECTION_TOLERANCE_H) {
        fail(
          5,
          subject,
          `projected_full_capture_hours ${projected} != denominator / median / 60 (${fmt(expected)})`,
        );
      }
    }
    if (!text(austin.decision)) fail(5, subject, "decision missing");
  }

  checkJurisdictions(cat, fail);
  checkAustinIssued(cat, austin, fail);

  // Rule 8: GIS is counted (gap computed against the roll), or unknown with a reason.
  const parcel = cat.parcel;
  if (!isObj(parcel)) {
    fail(8, "parcel", "block missing");
  } else {
    const gis = parcel.gis_feature_count;
    const roll = parcel.assessed_parcel_count;
    const gap = parcel.gap_pct;
    const needUnknown = (why: string): void => {
      if (gap !== "unknown")
        fail(8, "parcel", `gap_pct ${String(gap)} must be unknown when ${why}`);
      else if (!text(parcel.gap_reason)) fail(8, "parcel", "gap_pct unknown without gap_reason");
    };
    if (num(gis)) {
      if (num(roll) && roll > 0) {
        const expected = (Math.abs(roll - gis) / roll) * 100;
        if (!num(gap) || Math.abs(gap - expected) > GAP_TOLERANCE_PCT) {
          fail(
            8,
            "parcel",
            `gap_pct ${String(gap)} != |roll - GIS| / roll * 100 (${expected.toFixed(3)})`,
          );
        }
      } else {
        needUnknown("the roll count is missing");
      }
    } else if (gis === null) {
      needUnknown("GIS is not counted");
    } else {
      fail(8, "parcel", "gis_feature_count missing");
    }
  }

  // Rule 9: no connection URL, token value or absolute home path anywhere in the catalog.
  checkHygiene(raw, "", options.secrets ?? [], fail);

  // Rules 10 and 11 (review additions).
  checkExceptions(cat, fail);
  checkStopConsistency(cat, fail);

  return lines;
}

export function resolveCatalogPath(arg: string | undefined, cwd: string): string {
  if (arg === undefined || arg.trim() === "") return DEFAULT_CATALOG_PATH;
  return isAbsolute(arg) ? arg : resolve(cwd, arg);
}

export function main(
  argv: readonly string[],
  out: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
  env: Record<string, string | undefined> = process.env,
): number {
  const secrets = [env.SOCRATA_APP_TOKEN ?? ""].filter((s) => s.length > 0);
  const path = resolveCatalogPath(argv[0], env.INIT_CWD ?? process.cwd());
  const shown = redact(path);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"), { schema: "core" });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    out(`FAIL rule 0: catalog ${shown} unreadable: ${redact(message ?? "")}`);
    return 1;
  }
  const lines = checkCatalog(raw, { secrets });
  for (const line of lines) out(redact(line, secrets));
  if (lines.length === 0) out(`PASS check-catalog rules 1-11: ${shown}`);
  return lines.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
