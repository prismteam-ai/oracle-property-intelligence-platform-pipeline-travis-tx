// T046: operator command `npm --prefix pipeline/oracle-runtime run render-sources`
// (FR-007, FR-007a, FR-007b). Regenerates docs/sources.md from the catalog.
//
// - Front matter `id: SRC-A`, `parent: A-01` (constitution XIX).
// - Every number sits in a table row that also carries its source URL and its UTC capture
//   time (URL column before the time column), so `grep` can prove FR-007a.
// - A null value shows its `missing_reason`, never 0.
// - Deterministic: the output depends only on the catalog (no clock, no locale, no host
//   paths); times are shown to the second; a re-run with the same catalog gives no diff.
// - Review additions (CR-A-01): the run id beside waiting_human_hours (OR-n2), the
//   seed-gating statement (OR-m7), "Approved exceptions" (OR-M3) and "Amendments" (OR-M5)
//   sections; only a blocked row is listed as blocked, an available source captured another
//   way is listed under operator-side blocks (OR-M5); Austin-issued counts are split into
//   full purpose and ETJ (OR-m6); re-probes and superseded evidence are listed (OR-m2).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { redact } from "../lib/log.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import type { Catalog, Jurisdiction, Measurement, Source } from "./catalog.schema.js";
import { DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

export const SOURCES_MD_REL_PATH = "docs/sources.md";
const CATALOG_REL_PATH = "pipeline/docs/travis-sources.yaml";

type Obj = Record<string, unknown>;

/** Escapes a table cell: pipes and line breaks never break the row. */
function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** UTC time to the second (FR-007a, and the TC-022 provenance grep). */
function utc(iso: string): string {
  return iso.replace(/\.\d+Z$/, "Z");
}

function groupInt(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(n));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Integers with thousands separators; other numbers rounded to 2 decimals. */
function num(n: number): string {
  if (Number.isInteger(n)) return groupInt(n);
  const fixed = (Math.round(n * 100) / 100).toFixed(2);
  const [int = "0", frac = "00"] = fixed.split(".");
  return `${groupInt(Number(int))}.${frac}`;
}

function value(m: { value: number | null; missing_reason?: string | undefined }): string {
  return m.value === null
    ? `missing: ${cell(m.missing_reason ?? "no reason recorded")}`
    : num(m.value);
}

function row(cells: readonly string[]): string {
  return `| ${cells.map((c) => (c === "" ? " " : c)).join(" | ")} |`;
}

function table(header: readonly string[], rows: readonly string[][]): string[] {
  if (rows.length === 0) return ["_None._", ""];
  return [row(header), row(header.map(() => "---")), ...rows.map((r) => row(r)), ""];
}

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

interface FoundMeasurement {
  path: string;
  m: Measurement;
}

/** Every Measurement in a subtree (any object with an own `value`), in catalog order. */
function measurements(node: unknown, path: string, out: FoundMeasurement[]): FoundMeasurement[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const label = isObj(item) && typeof item.key === "string" ? item.key : String(i);
      measurements(item, `${path}[${label}]`, out);
    });
  } else if (isObj(node)) {
    if (Object.hasOwn(node, "value") && typeof node.source_url === "string") {
      out.push({ path, m: node as unknown as Measurement });
    } else {
      for (const [k, v] of Object.entries(node)) measurements(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

function sourcesTable(sources: readonly Source[]): string[] {
  return table(
    [
      "Source",
      "Status",
      "Denominator",
      "Decision",
      "Projected full-capture hours",
      "Source URL",
      "Captured (UTC)",
    ],
    sources.map((s) => [
      `\`${s.key}\``,
      s.status,
      value(s.denominator),
      cell(`${s.decision ?? "none"}: ${s.decision_reason ?? "no reason recorded"}`),
      typeof s.projected_full_capture_hours === "number"
        ? num(s.projected_full_capture_hours)
        : "not projected",
      s.denominator.source_url,
      utc(s.denominator.captured_at),
    ]),
  );
}

function measurementsTable(catalog: Catalog): string[] {
  const found: FoundMeasurement[] = [];
  measurements(catalog.sources, "sources", found);
  if (catalog.parcel) measurements(catalog.parcel, "parcel", found);
  if (catalog.permits) measurements(catalog.permits, "permits", found);
  return table(
    ["Measurement", "Value", "Method", "Source URL", "Captured (UTC)"],
    found.map(({ path, m }) => [
      `\`${cell(path)}\``,
      value(m),
      cell(m.method ?? m.query ?? ""),
      m.source_url,
      utc(m.captured_at),
    ]),
  );
}

function throughputSection(sources: readonly Source[]): string[] {
  const rows: string[][] = [];
  for (const s of sources) {
    const t = s.throughput;
    if (!t) continue;
    const at = utc(t.window_end);
    rows.push([
      `\`${s.key}\``,
      "rows per minute (median)",
      num(t.rows_per_minute_median),
      s.url,
      at,
    ]);
    rows.push([`\`${s.key}\``, "pages read", num(t.pages_read), s.url, at]);
    rows.push([`\`${s.key}\``, "page size (rows)", num(t.page_size), s.url, at]);
    rows.push([`\`${s.key}\``, "measurement window", `${utc(t.window_start)} to ${at}`, s.url, at]);
    rows.push([`\`${s.key}\``, "app token used", String(t.app_token_used), s.url, at]);
    rows.push([`\`${s.key}\``, "rate limits observed", cell(t.rate_limits_observed), s.url, at]);
  }
  for (const s of sources) {
    const d = s.download_rate;
    if (!d) continue;
    rows.push([
      `\`${s.key}\``,
      "download megabytes per minute",
      num(d.megabytes_per_minute),
      d.source_url,
      utc(d.captured_at),
    ]);
  }
  return table(["Source", "Measure", "Value", "Source URL", "Captured (UTC)"], rows);
}

function parcelSection(catalog: Catalog): string[] {
  const p = catalog.parcel;
  if (!p) return ["_No parcel block in the catalog._", ""];
  const roll = p.assessed_parcel_count_measurement;
  const gis = p.gis_feature_count_measurement;
  const gap =
    p.gap_pct === "unknown"
      ? `unknown: ${cell(p.gap_reason ?? "no reason recorded")}`
      : `${num(p.gap_pct)} % (threshold ${num(p.discrepancy_threshold_pct)} %)`;
  const lines = table(
    ["Measure", "Value", "Source URL", "Captured (UTC)"],
    [
      [
        `Assessed parcels, roll year ${p.roll_year} (canonical denominator)`,
        value(roll),
        roll.source_url,
        utc(roll.captured_at),
      ],
      ["GIS parcel features", value(gis), gis.source_url, utc(gis.captured_at)],
      ["Gap between roll and GIS", gap, gis.source_url, utc(gis.captured_at)],
    ],
  );
  lines.push(`- Canonical source: ${p.canonical_source}`);
  const cert = p.certification_date_measurement;
  if (cert) {
    const stated =
      cert.value === null
        ? `missing: ${cell(cert.missing_reason ?? "no reason recorded")}`
        : cert.value;
    lines.push(
      `- Certification date: ${stated} (source ${cert.source_url}, captured ${utc(cert.captured_at)})`,
    );
  } else if (p.certification_date) {
    lines.push(`- Certification date: ${p.certification_date}`);
  }
  const layout = p.identifier_layout_name ? ` (TCAD layout name: ${p.identifier_layout_name})` : "";
  lines.push(
    `- Parcel identifier: ${p.identifier_name ?? "not yet read"}${layout} (proven unique: ${String(p.identifier_proven)})${p.identifier_format ? `; format: ${p.identifier_format}` : ""}`,
  );
  if (p.deed_or_sale_dates_present !== undefined) {
    lines.push(`- Deed or sale dates present: ${String(p.deed_or_sale_dates_present)}`);
  }
  if (p.separately_assessed_without_geometry) {
    lines.push(
      `- Separately assessed units without geometry: ${p.separately_assessed_without_geometry}`,
    );
  }
  if (p.discrepancy_explanation)
    lines.push(`- Discrepancy explanation: ${p.discrepancy_explanation}`);
  if (p.export_receipt) {
    lines.push(
      `- TCAD export receipt: SHA-256 \`${p.export_receipt.sha256}\`, captured ${utc(p.export_receipt.captured_at)} from ${p.export_receipt.url} (file kept out of git)`,
    );
  }
  lines.push("");
  lines.push(...gapReconciliationSection(catalog));
  return lines;
}

/** The account breakdown and the count-level gap reconciliation, each row with provenance. */
function gapReconciliationSection(catalog: Catalog): string[] {
  const p = catalog.parcel;
  const b = p?.account_breakdown;
  if (!p || !b) return [];
  const url = b.source_url;
  const at = utc(b.captured_at);
  const rows: string[][] = [["Records in the certified export", num(b.records), url, at]];
  rows.push(["Records flagged inactive", num(b.inactive_flagged), url, at]);
  for (const t of b.by_prop_type) {
    const meaning = t.meaning ? ` (${t.meaning})` : "";
    rows.push([`Accounts with propType ${cell(t.prop_type)}${meaning}`, num(t.count), url, at]);
  }
  const re = b.real_estate;
  rows.push(["Real-property accounts: distinct geoIDs", num(re.distinct_geo_ids), url, at]);
  rows.push([
    "Real-property accounts sharing a geoID with another account",
    num(re.accounts_sharing_a_geo_id),
    url,
    at,
  ]);
  rows.push(["Real-property accounts without a geoID", num(re.accounts_without_geo_id), url, at]);
  rows.push([
    "Real-property accounts with an export geometry point",
    num(re.with_geometry_point),
    url,
    at,
  ]);
  rows.push([
    "Real-property accounts without an export geometry point",
    num(re.without_geometry_point),
    url,
    at,
  ]);
  for (const s of re.without_geometry_by_state_cd ?? []) {
    const meaning = s.meaning ? ` (${s.meaning})` : "";
    rows.push([
      `No geometry point, state code ${cell(s.state_cd)}${meaning}; with a condo unit: ${num(s.with_condo_unit)}`,
      num(s.count),
      url,
      at,
    ]);
  }
  const out = [
    `Account breakdown (${cell(b.method)}; export SHA-256 \`${b.export_sha256}\`):`,
    "",
    ...table(["Measure", "Value", "Source URL", "Captured (UTC)"], rows),
    `- propType meanings: ${b.prop_type_meaning_source}`,
    `- State code meanings: ${b.state_cd_meaning_source}`,
    "",
  ];
  const g = p.gap_reconciliation;
  if (!g) return out;
  const gis = p.gis_feature_count_measurement;
  const recRows: string[][] = [
    ["Gap: roll minus GIS", num(g.gap), gis.source_url, utc(gis.captured_at)],
    ...g.components.map((c) => [`\`${c.component}\`: ${cell(c.reason)}`, num(c.count), url, at]),
    ["Explained by the components", num(g.explained), url, at],
    [
      "Residual (unexplained)",
      `${num(g.residual)} (${num(g.residual_pct_of_roll)} % of the roll)`,
      gis.source_url,
      utc(gis.captured_at),
    ],
  ];
  out.push(
    "Gap reconciliation:",
    "",
    ...table(["Component", "Count", "Source URL", "Captured (UTC)"], recRows),
    `- Method: ${g.method}`,
    `- Residual: ${g.residual_note}`,
    "",
  );
  return out;
}

function jurisdictionsSection(catalog: Catalog): string[] {
  const out: string[] = [];
  const c = catalog.census_reference;
  if (c) {
    out.push(
      ...table(
        [
          "Census dataset",
          "Vintage",
          "Places with land in the county",
          "Expected jurisdictions (places + unincorporated)",
          "Source URL",
          "Captured (UTC)",
        ],
        [
          [
            cell(c.dataset),
            cell(c.vintage),
            num(c.place_count),
            num(c.place_count + 1),
            c.source_url,
            utc(c.captured_at),
          ],
        ],
      ),
    );
  }
  const rows = catalog.permits?.jurisdictions ?? [];
  out.push(
    ...table(
      [
        "Jurisdiction",
        "Class",
        "Validator status",
        "Historical records",
        "Supported from",
        "Issued by",
        "Austin-issued here: full purpose / ETJ",
        "Evidence URL",
        "Captured (UTC)",
      ],
      rows.map((j) => [
        cell(j.jurisdiction),
        j.spec_class,
        j.status,
        String(j.historical_records),
        j.earliest_record_date ?? "",
        cell(j.issued_by ?? ""),
        austinSplitCell(j),
        j.evidence_url,
        utc(j.evidence_captured_at),
      ]),
    ),
  );
  if (rows.length > 0) {
    out.push(
      "Austin-issued permits located in another jurisdiction are counted under `austin_permits` (see Measurements); the city rows show them as informational counts that never set a city's class, split into full purpose (inside the city limits, the count AC-4 uses) and ETJ (the city's extraterritorial jurisdiction, outside its limits).",
      "",
    );
  }
  const reprobed = rows.filter((j) => j.reprobe_count !== undefined);
  if (reprobed.length > 0) {
    out.push("Re-probes (`reprobe-jurisdictions`, once per row at most):", "");
    for (const j of reprobed) {
      const url = j.reprobe_url_changed
        ? "a new evidence URL, so it was a new probe rather than a re-probe of the same page"
        : "the same evidence URL";
      out.push(
        `- ${cell(j.jurisdiction)}: re-probed ${j.reprobe_count ?? 0} time(s), at ${utc(j.reprobed_at ?? j.evidence_captured_at)}, with ${url}`,
      );
      for (const e of j.superseded_evidence ?? []) {
        out.push(`  - \`${e.evidence_path}\` is superseded by ${supersededBy(e.superseded_by)}`);
      }
    }
    out.push("");
  }
  return out;
}

function austinSplitCell(j: Jurisdiction): string {
  const fp = j.austin_issued_full_purpose?.value;
  const etj = j.austin_issued_etj?.value;
  if (typeof fp === "number" && typeof etj === "number") return `${num(fp)} / ${num(etj)}`;
  const total = j.austin_issued_located_here?.value;
  return typeof total === "number" ? `${num(total)} (not split)` : "";
}

function supersededBy(by: string): string {
  return by.startsWith("docs/") ? `\`${by}\`` : cell(by);
}

function blockedSection(catalog: Catalog): string[] {
  const rows: Array<{
    subject: string;
    ev: NonNullable<Source["blocked_evidence"]>;
    req?: Source["records_request"];
    next?: string | undefined;
  }> = [];
  for (const s of catalog.sources) {
    // Only a blocked row is listed as blocked (OR-M5); see operatorBlocksSection.
    if (s.status === "blocked" && s.blocked_evidence) {
      rows.push({
        subject: `source \`${s.key}\``,
        ev: s.blocked_evidence,
        req: s.records_request,
        next: s.next_step,
      });
    }
  }
  for (const j of catalog.permits?.jurisdictions ?? []) {
    if (j.status === "blocked" && j.blocked_evidence) {
      rows.push({
        subject: `jurisdiction ${cell(j.jurisdiction)}`,
        ev: j.blocked_evidence,
        req: j.records_request,
      });
    }
  }
  if (rows.length === 0) return ["No source or jurisdiction was blocked at capture.", ""];
  const out = table(
    [
      "Blocked",
      "Outcome",
      "HTTP status, timeout or network error",
      "Attempts",
      "Geo signal",
      "Evidence file",
      "Blocked URL",
      "Captured (UTC)",
    ],
    rows.map(({ subject, ev }) => [
      subject,
      ev.outcome,
      ev.http_status !== undefined
        ? `HTTP ${ev.http_status}${ev.error ? ` (${cell(ev.error)})` : ""}`
        : ev.timeout_ms !== undefined
          ? `timeout after ${num(ev.timeout_ms)} ms`
          : `network error: ${cell(ev.error ?? "no HTTP response")}`,
      num(ev.attempts),
      cell(ev.geo_signal),
      `\`${ev.evidence_path}\``,
      ev.url,
      utc(ev.captured_at),
    ]),
  );
  out.push(
    "While any source is blocked the discovery run waits in `WAITING_HUMAN` for a human to resolve it: `resolve -- <source_key> still-blocked` after a 403, challenge or WAF block (such a source is never re-probed), or `captured` only after a timeout, network error, throttling or broken download; nothing is bypassed and seed, pilot and ingest stay stopped for a blocked parcel source.",
    "",
  );
  for (const { subject, req, next } of rows) {
    if (!req && !next) continue;
    out.push(`- ${subject}:`);
    if (req) {
      out.push(
        `  - Records request (${req.route}): ${req.recipient_office}; scope: ${req.system_scope}; channel: ${req.request_portal_url ?? req.request_email ?? "none"}`,
      );
    }
    if (next) out.push(`  - Next step: ${next}`);
  }
  out.push("");
  return out;
}

/** Available sources the operator machine could not reach, captured another way (OR-M5). */
function operatorBlocksSection(catalog: Catalog): string[] {
  const rows = catalog.sources.filter(
    (s) => s.status === "available" && s.operator_blocked_evidence,
  );
  if (rows.length === 0) return [];
  const out = [
    "Operator-side blocks: these sources are **available**; the operator machine could not reach them, and they were captured another way.",
    "",
    ...table(
      [
        "Source",
        "Status",
        "Operator-side block",
        "Operator-side stop",
        "How it was captured",
        "Evidence file",
        "Captured (UTC)",
      ],
      rows.map((s) => {
        const ev = s.operator_blocked_evidence as NonNullable<Source["operator_blocked_evidence"]>;
        const stop =
          ev.timeout_ms !== undefined
            ? `timeout after ${num(ev.timeout_ms)} ms`
            : ev.http_status !== undefined
              ? `HTTP ${ev.http_status}`
              : `network error: ${cell(ev.error ?? "no HTTP response")}`;
        const via = s.denominator.captured_via;
        const label =
          via !== undefined && /\bUS\b/.test(via)
            ? "operator egress blocked; captured via US runner"
            : "operator egress blocked; captured another way";
        return [
          `\`${s.key}\``,
          "available",
          label,
          `${stop}; geo signal: ${cell(ev.geo_signal)}`,
          via ? `captured via ${cell(via)}` : "captured another way",
          `\`${ev.evidence_path}\``,
          utc(s.denominator.captured_at),
        ];
      }),
    ),
  ];
  return out;
}

function exceptionsSection(catalog: Catalog): string[] {
  const list = catalog.approved_exceptions ?? [];
  if (list.length === 0) return ["No approved exceptions.", ""];
  const out: string[] = [];
  for (const e of list) {
    out.push(`### Gate \`${e.gate}\``, "");
    const p = catalog.parcel;
    if (e.gate === "parcel" && p && p.gap_pct !== "unknown") {
      out.push(
        `The readiness validator reports the parcel gate as **PASS because of this exception**; the raw gap stays ${num(p.gap_pct)}% (above the ${num(p.discrepancy_threshold_pct)}% threshold) and is printed in the validator's evidence line.`,
        "",
      );
    }
    // ERR-5 (FR-007a): every number carries the source URL and capture time of the
    // measurement it is bound to; text rows have none.
    const roll = p?.assessed_parcel_count_measurement;
    const gis = p?.gis_feature_count_measurement;
    const from = (m: { source_url: string; captured_at: string } | undefined): string[] =>
      m ? [m.source_url, utc(m.captured_at)] : ["not recorded", "not recorded"];
    const none = ["n/a", "n/a"];
    out.push(
      ...table(
        ["Approved", "Value", "Source", "Captured (UTC)"],
        [
          ["Approved by", cell(e.approved_by ?? "not recorded"), ...none],
          ["Approved on", e.approved_at ?? "not recorded", ...none],
          [
            "Gap (gap_pct)",
            e.approved_gap_pct === undefined ? "not bound" : `${num(e.approved_gap_pct)}%`,
            ...from(gis),
          ],
          [
            "GIS features (gis_feature_count)",
            e.approved_gis_count === undefined ? "not bound" : num(e.approved_gis_count),
            ...from(gis),
          ],
          [
            "Roll accounts (assessed_parcel_count)",
            e.approved_assessed_count === undefined ? "not bound" : num(e.approved_assessed_count),
            ...from(roll),
          ],
          ["Decision record", e.decision_ref ? `\`${e.decision_ref}\`` : "not recorded", ...none],
        ],
      ),
      `- Reason: ${e.reason}`,
    );
    if (e.coverage_effect) out.push(`- Coverage effect: ${e.coverage_effect}`);
    out.push(
      "- Bound to the values above: check-catalog rule 10 fails as soon as the catalog's GIS count, roll count or gap differ.",
      "",
    );
  }
  return out;
}

function amendmentsSection(catalog: Catalog): string[] {
  const list = catalog.amendments ?? [];
  if (list.length === 0) {
    return ["No offline command has changed the catalog since the workflow wrote it.", ""];
  }
  return [
    `The discovery workflow wrote the catalog at ${utc(catalog.snapshot_time)}; these offline commands changed named fields since, in order. The workflow refuses to overwrite a catalog that carries amendments.`,
    "",
    ...table(
      ["At (UTC)", "Command", "Fields", "Based on", "Egress", "Note"],
      list.map((a) => [
        utc(a.at),
        `\`${a.command}\``,
        cell(a.fields.join(", ")),
        cell(a.ref),
        `${a.egress_country ?? "not recorded"}${a.venue ? ` (${a.venue})` : ""}`,
        cell(a.note ?? ""),
      ]),
    ),
  ];
}

function destinationSection(catalog: Catalog): string[] {
  const d = catalog.destination;
  if (!d) return ["_No destination block in the catalog._", ""];
  const lines = [
    `- Writes in scope: ${String(d.writes_in_scope)}; proven: ${String(d.proven)}${d.captured_at ? ` (checked ${utc(d.captured_at)})` : ""}`,
  ];
  for (const id of d.independent_identity_sources ?? []) lines.push(`- ${id}`);
  if (d.missing_reason) lines.push(`- ${d.missing_reason}`);
  lines.push("");
  return lines;
}

function enrichmentSection(catalog: Catalog): string[] {
  const b = catalog.enrichment?.bbb;
  if (!b) return ["_No enrichment block in the catalog._", ""];
  const lines = [
    `- BBB status: ${b.status}${b.evidence_url ? `; evidence ${b.evidence_url}` : ""}${b.evidence_captured_at ? ` captured ${utc(b.evidence_captured_at)}` : ""}`,
  ];
  if (b.next_step) lines.push(`- BBB next step: ${b.next_step}`);
  lines.push("");
  return lines;
}

export function renderSourcesMd(catalog: Catalog): string {
  const lines: string[] = [
    "---",
    "id: SRC-A",
    "parent: A-01",
    `title: ${catalog.county} County source catalog summary`,
    `catalog: ${CATALOG_REL_PATH}`,
    `snapshot_time: "${utc(catalog.snapshot_time)}"`,
    "---",
    "",
    `# ${catalog.county} County sources (${catalog.state}, FIPS ${catalog.fips})`,
    "",
    `Generated by \`npm --prefix pipeline/oracle-runtime run render-sources\` from \`${CATALOG_REL_PATH}\` (snapshot ${utc(catalog.snapshot_time)}). Do not edit by hand. Every number below sits in a row with its source URL and UTC capture time; a missing value shows why it is missing.`,
    "",
    `Time the discovery run${catalog.discovery_run_id ? ` \`${catalog.discovery_run_id}\`` : ""} spent waiting for a human: ${num(catalog.waiting_human_hours)} h (recorded in the catalog, SC-006).${catalog.discovery_egress ? ` Run egress country: ${catalog.discovery_egress.country}.` : ""}`,
    "",
    "Seed gating: the kit's auto-advance on PASS is overridden; seed is A-04 behind G4–G7, and a PASS never starts seed, pilot or ingest.",
    "",
    "## Sources",
    "",
    ...sourcesTable(catalog.sources),
    "## Throughput and download rates",
    "",
    ...throughputSection(catalog.sources),
    "## Parcel roll and GIS",
    "",
    ...parcelSection(catalog),
    "## Permit jurisdictions",
    "",
    ...jurisdictionsSection(catalog),
    "## Blocked sources",
    "",
    ...blockedSection(catalog),
    ...operatorBlocksSection(catalog),
    "## Approved exceptions",
    "",
    ...exceptionsSection(catalog),
    "## Destination proof",
    "",
    ...destinationSection(catalog),
    "## Enrichment",
    "",
    ...enrichmentSection(catalog),
    "## Amendments",
    "",
    ...amendmentsSection(catalog),
    "## Measurements",
    "",
    "Every measurement in the catalog, with how it was measured.",
    "",
    ...measurementsTable(catalog),
  ];
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export interface RenderCliOptions {
  repoRoot?: string;
  catalogPath?: string;
  out?: (line: string) => void;
}

export function main(options: RenderCliOptions = {}): number {
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  let catalog: Catalog;
  try {
    catalog = readCatalog(options.catalogPath ?? DEFAULT_CATALOG_PATH);
  } catch (error) {
    const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    out(redact(`render-sources: catalog unreadable: ${message}`));
    return 1;
  }
  const target = join(root, SOURCES_MD_REL_PATH);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, renderSourcesMd(catalog), "utf8");
  renameSync(tmp, target);
  out(`render-sources: wrote ${SOURCES_MD_REL_PATH} from ${CATALOG_REL_PATH}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
