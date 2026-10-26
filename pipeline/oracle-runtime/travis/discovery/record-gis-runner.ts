// Operator command `npm --prefix pipeline/oracle-runtime run record-gis-runner -- <artifact dir>`
// (offline, no network; A-01 AC-6, ARD § 8, PO approval 2026-10-20).
//
// The Travis County GIS layer never answers from the operator machine (egress EG; TCP connect
// never completes, docs/evidence/blocked/tcad_gis-20261020T072223Z.md). The PO approved ONE
// identified count request from a US GitHub Actions runner (.github/workflows/
// a01-us-gis-probe.yml). This command records that run's downloaded artifact
// (pipeline/data/raw/gis/us-runner-<run id>/, gitignored) into the catalog, because the
// Restate run that wrote the catalog already resolved tcad_gis and takes no new input.
//
// The artifact is checked strictly before anything is written: a US egress, HTTP 200 with
// curl exit 0 and no error output, a `{count}` body, a UTC capture time, and the workflow's
// URL and User-Agent equal to the catalog's GIS measurement URL and the project User-Agent.
// Then it rewrites only the GIS count, its measurement, the gap and its explanation in the
// parcel block, and the tcad_gis source row; writes the committed evidence file
// docs/evidence/A-01-us-gis-runner.md (safe headers only, never cookies); and re-runs the
// readiness validator. The roll stays the denominator; GIS is never substituted for it, and
// the gap is stated as measured, not explained.
//
// CR-5: a gap_reconciliation recorded for the SAME GIS count is kept and the gap texts are
// rebuilt from it; one recorded for a different GIS count is stale and is dropped (the gap
// texts then say to rerun reconcile-parcel-gap). account_breakdown and
// separately_assessed_without_geometry come from the export alone (not from GIS), so they are
// kept. CR-9: the gap uses computeGap (gap_pct rounds to 3 decimals, the one rule for every
// writer) and the files are written with the shared atomic writer. OR-M5: the change is
// recorded in `amendments[]`.
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { redact } from "../lib/log.js";
import { safeHeaders, USER_AGENT } from "../lib/source-client.js";
import { DEFAULT_REPO_ROOT, EVIDENCE_PARENT, sanitizeEvidenceText } from "./blocked-evidence.js";
import type { Parcel } from "./assemble.js";
import {
  BlockedEvidenceSchema,
  UtcTimestamp,
  type Catalog,
  type Measurement,
  type Source,
} from "./catalog.schema.js";
import { discrepancyExplanationText, gapReasonText } from "./parcel-gap.js";
import { computeGap, gapPercent, gisCountUrl } from "./probes/arcgis.js";
import { main as runValidatorMain } from "./run-validator.js";
import {
  amendCatalog,
  DEFAULT_CATALOG_PATH,
  emitCatalogYaml,
  readCatalog,
  writeFileAtomic,
} from "./write-catalog.js";

export const WORKFLOW_REL = ".github/workflows/a01-us-gis-probe.yml";
export const EVIDENCE_REL = "docs/evidence/A-01-us-gis-runner.md";
/** The operator-side evidence the source row keeps as its blocked_evidence. */
export const OPERATOR_EVIDENCE_REL = "docs/evidence/blocked/tcad_gis-20261020T072223Z.md";
/** The workflow runs on the story branch of this fork (a push trigger, not workflow_dispatch). */
export const PROBE_REPOSITORY_URL =
  "https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx";
export const CAPTURED_VIA = "US GitHub Actions runner (ARD § 8, PO approval 2026-10-20)";
const METHOD = "returnCountOnly";
const ARTIFACT_DIR = /^pipeline\/data\/raw\/gis\/us-runner-(\d+)$/;
const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/(\d+)$/;
const NEXT_STEP = "account-type breakdown of the certified export is the next step";
const RERUN =
  "the GIS count changed, so the earlier reconciliation was dropped; rerun reconcile-parcel-gap";

/** The workflow's env, the only place the runner's URL and User-Agent are defined. */
const WorkflowSchema = z.looseObject({
  jobs: z.looseObject({
    probe: z.looseObject({ env: z.looseObject({ URL: z.url(), UA: z.string().min(1) }) }),
  }),
});
const CountBody = z.strictObject({ count: z.int().nonnegative() });
const CapturedAt = UtcTimestamp.refine((s) => !s.includes("."), "must be whole seconds");

export interface RunnerArtifact {
  run_id: string;
  run_url: string;
  artifact_rel: string;
  url: string;
  user_agent: string;
  egress_loc: string;
  egress_colo: string;
  captured_at: string;
  http_status: number;
  time_seconds: number;
  count: number;
  body: string;
  body_bytes: number;
  body_sha256: string;
  headers: Record<string, string>;
}

export interface RecordGisRunnerOptions {
  /** The downloaded artifact directory (absolute, or relative to the current directory). */
  artifactDir: string;
  /** The run page; defaults to PROBE_REPOSITORY_URL + the run id from the directory name. */
  runUrl?: string;
  repoRoot?: string;
  catalogPath?: string;
  validate?: () => Promise<number>;
  out?: (line: string) => void;
  /** Amendment time (tests). */
  now?: () => Date;
}

class Refusal extends Error {}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function readText(dir: string, name: string): string {
  const path = join(dir, name);
  if (!existsSync(path)) throw new Refusal(`artifact file ${name} is missing`);
  return readFileSync(path, "utf8");
}

/** `key=value` lines (egress.txt, result.txt) into a map; any other line is refused. */
function keyValues(text: string, name: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/).filter((l) => l.trim() !== "")) {
    for (const pair of line.trim().split(/\s+/)) {
      const m = /^([a-z_]+)=(\S+)$/.exec(pair);
      if (!m?.[1] || m[2] === undefined) throw new Refusal(`${name}: unexpected line "${line}"`);
      if (map.has(m[1])) throw new Refusal(`${name}: ${m[1]} appears twice`);
      map.set(m[1], m[2]);
    }
  }
  return map;
}

/** The last header block of a curl `-D` dump: its status and its headers (names lower-cased). */
function parseHeaderDump(text: string): { status: number; headers: Record<string, string> } {
  const blocks = text
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
  const last = blocks.at(-1);
  if (last === undefined) throw new Refusal("headers.txt is empty");
  const [statusLine, ...lines] = last.split(/\r?\n/);
  const status = /^HTTP\/[\d.]+ (\d{3})\b/.exec(statusLine ?? "")?.[1];
  if (status === undefined) throw new Refusal("headers.txt has no HTTP status line");
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i <= 0) throw new Refusal("headers.txt has a malformed header line");
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return { status: Number(status), headers };
}

/** Reads and checks the artifact; refuses on the first mismatch. Reads files only. */
export function readRunnerArtifact(
  root: string,
  artifactDir: string,
  runUrl?: string,
): RunnerArtifact {
  const abs = isAbsolute(artifactDir) ? artifactDir : resolve(artifactDir);
  const artifactRel = relative(root, abs).split(sep).join("/");
  const runId = ARTIFACT_DIR.exec(artifactRel)?.[1];
  if (runId === undefined) {
    throw new Refusal(
      "artifact directory must be pipeline/data/raw/gis/us-runner-<run id> in this repository",
    );
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Refusal(`artifact directory ${artifactRel} not found`);
  }
  const url = runUrl ?? `${PROBE_REPOSITORY_URL}/actions/runs/${runId}`;
  const urlRun = RUN_URL.exec(url)?.[1];
  if (urlRun !== runId) {
    throw new Refusal(`run URL must be a GitHub Actions run page for run ${runId}`);
  }

  const egress = keyValues(readText(abs, "egress.txt"), "egress.txt");
  const loc = egress.get("loc");
  const colo = egress.get("colo");
  if (loc !== "US") throw new Refusal(`egress loc is ${loc ?? "missing"}, not US: not a US runner`);
  if (colo === undefined || !/^[A-Z]{3}$/.test(colo)) {
    throw new Refusal("egress.txt has no colo");
  }

  const capturedAt = CapturedAt.safeParse(readText(abs, "captured_at.txt").trim());
  if (!capturedAt.success) throw new Refusal("captured_at.txt is not a UTC ISO-8601 time");

  const result = keyValues(readText(abs, "result.txt"), "result.txt");
  if (result.get("http") !== "200") {
    throw new Refusal(`result.txt http is ${result.get("http") ?? "missing"}, not 200`);
  }
  if (result.get("curl_exit") !== "0") {
    throw new Refusal(`result.txt curl_exit is ${result.get("curl_exit") ?? "missing"}, not 0`);
  }
  const time = /^(\d+(?:\.\d+)?)s$/.exec(result.get("time") ?? "")?.[1];
  if (time === undefined) throw new Refusal("result.txt has no time");
  if (readText(abs, "error.txt").trim() !== "") {
    throw new Refusal("error.txt is not empty");
  }

  const bodyPath = join(abs, "body.json");
  if (!existsSync(bodyPath)) throw new Refusal("artifact file body.json is missing");
  const bodyBytes = readFileSync(bodyPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyBytes.toString("utf8"));
  } catch {
    throw new Refusal("body.json is not JSON");
  }
  const body = CountBody.safeParse(parsed);
  if (!body.success) throw new Refusal("body.json is not {count: non-negative integer}");

  const dump = parseHeaderDump(readText(abs, "headers.txt"));
  if (dump.status !== 200) throw new Refusal(`headers.txt status is ${dump.status}, not 200`);
  const length = dump.headers["content-length"];
  if (length !== undefined && Number(length) !== bodyBytes.length) {
    throw new Refusal(`Content-Length ${length} != body.json ${bodyBytes.length} bytes`);
  }

  const workflowPath = join(root, WORKFLOW_REL);
  if (!existsSync(workflowPath)) throw new Refusal(`${WORKFLOW_REL} not found`);
  const workflow = WorkflowSchema.safeParse(parse(readFileSync(workflowPath, "utf8")));
  if (!workflow.success) throw new Refusal(`${WORKFLOW_REL} has no jobs.probe.env URL and UA`);
  const env = workflow.data.jobs.probe.env;

  return {
    run_id: runId,
    run_url: url,
    artifact_rel: artifactRel,
    url: env.URL,
    user_agent: env.UA,
    egress_loc: loc,
    egress_colo: colo,
    captured_at: capturedAt.data,
    http_status: dump.status,
    time_seconds: Number(time),
    count: body.data.count,
    body: bodyBytes.toString("utf8"),
    body_bytes: bodyBytes.length,
    body_sha256: sha256(bodyBytes),
    headers: safeHeaders(dump.headers),
  };
}

/** The operator-side blocked evidence, read back from its committed front matter. */
function operatorEvidence(root: string, rel: string): Source["blocked_evidence"] {
  const path = join(root, rel);
  if (!existsSync(path)) throw new Refusal(`operator evidence ${rel} not found`);
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"))?.[1];
  if (front === undefined) throw new Refusal(`operator evidence ${rel} has no front matter`);
  const f = z.looseObject({}).parse(parse(front)) as Record<string, unknown>;
  const evidence = BlockedEvidenceSchema.safeParse({
    ...(f.http_status !== undefined ? { http_status: f.http_status } : {}),
    ...(f.timeout_ms !== undefined ? { timeout_ms: f.timeout_ms } : {}),
    ...(f.error !== undefined ? { error: f.error } : {}),
    captured_at: f.captured_at,
    url: f.url,
    evidence_path: rel,
    body_sha256: f.body_sha256,
    attempts: f.attempts,
    user_agent: f.user_agent,
    outcome: f.outcome,
    geo_signal: f.geo_signal,
  });
  if (!evidence.success) throw new Refusal(`operator evidence ${rel} front matter is incomplete`);
  return evidence.data;
}

/** |roll - GIS| / roll in percent via gapPercent (3 decimals; the roll is the denominator). */
export function gapPct(roll: number, gis: number): number {
  const gap = gapPercent(roll, gis);
  if (gap === "unknown") throw new Refusal("the roll count is 0; a gap percentage is undefined");
  return gap;
}

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function renderRunnerEvidence(a: RunnerArtifact, measurement: Measurement): string {
  const clean = (s: string): string => sanitizeEvidenceText(s);
  const front = {
    id: "EV-A-01-us-gis-runner",
    parent: EVIDENCE_PARENT,
    subject: "source:tcad_gis",
    captured_at: a.captured_at,
    url: clean(a.url),
    method: "GET",
    attempts: 1,
    user_agent: clean(a.user_agent),
    run_url: a.run_url,
    egress_loc: a.egress_loc,
    egress_colo: a.egress_colo,
    http_status: a.http_status,
    time_seconds: a.time_seconds,
    body_bytes: a.body_bytes,
    body_sha256: a.body_sha256,
    count: a.count,
  };
  const headerRows = Object.entries(a.headers).map(
    ([name, value]) => `| \`${name}\` | ${clean(value).replace(/\|/g, "\\|")} |`,
  );
  return [
    "---",
    stringify(front, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    "# Evidence: Travis County GIS count from a US GitHub Actions runner",
    "",
    `The Travis County GIS parcel layer never answers from the operator machine (egress EG, TCP connect never completes; [operator evidence](blocked/${basename(OPERATOR_EVIDENCE_REL)})). The PO approved ONE identified count request from a US GitHub Actions runner on 2026-10-20 (ARD § 8, A-01 AC-6). Workflow \`${WORKFLOW_REL}\` made it once, with the same URL and project User-Agent as the discovery probe, no retry and no identity change.`,
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| Run | ${a.run_url} |`,
    `| Runner egress (Cloudflare trace) | \`loc=${a.egress_loc}\`, \`colo=${a.egress_colo}\` |`,
    `| URL | ${clean(a.url)} |`,
    `| User-Agent | \`${clean(a.user_agent)}\` |`,
    `| Captured at (UTC) | ${a.captured_at} |`,
    `| HTTP status | ${a.http_status} |`,
    `| Time | ${a.time_seconds} s |`,
    `| Body | ${a.body_bytes} bytes, SHA-256 \`${a.body_sha256}\` |`,
    `| GIS feature count | ${thousands(a.count)} |`,
    "",
    `Recorded into \`pipeline/docs/travis-sources.yaml\` by \`npm --prefix pipeline/oracle-runtime run record-gis-runner\` as \`parcel.gis_feature_count_measurement\` (method \`${measurement.method ?? METHOD}\`). The certified roll stays the canonical denominator; GIS is never substituted for it.`,
    "",
    "## Body",
    "",
    "```json",
    clean(a.body.trimEnd()),
    "```",
    "",
    "## Response headers",
    "",
    "Safe headers only: cookie, auth and token-bearing headers are dropped (`safeHeaders`).",
    "",
    "| Header | Value |",
    "| --- | --- |",
    ...headerRows,
    "",
    `The raw artifact stays gitignored at \`${a.artifact_rel}/\`.`,
    "",
  ].join("\n");
}

/** The catalog with the runner measurement applied; validated, nothing written. */
export function applyRunnerMeasurement(
  catalog: Catalog,
  a: RunnerArtifact,
  blockedEvidence: Source["blocked_evidence"],
): { catalog: Catalog; measurement: Measurement; gap: number; dropped: boolean } {
  const current = catalog.parcel;
  if (!current) throw new Refusal("catalog has no parcel block; run discovery first");
  const roll = current.assessed_parcel_count;
  if (roll === null || roll <= 0) {
    throw new Refusal("catalog has no certified roll count; the roll is the denominator");
  }
  const row = catalog.sources.find((s) => s.key === "tcad_gis");
  if (!row) throw new Refusal("catalog has no tcad_gis source row");
  const expectedUrl = current.gis_feature_count_measurement.source_url;
  if (a.url !== expectedUrl || a.url !== row.denominator.source_url || a.url !== gisCountUrl()) {
    throw new Refusal(
      `${WORKFLOW_REL} URL differs from the catalog's tcad_gis measurement URL ${expectedUrl}`,
    );
  }
  if (a.user_agent !== USER_AGENT) {
    throw new Refusal(`${WORKFLOW_REL} UA differs from the project User-Agent`);
  }

  const measurement: Measurement = {
    value: a.count,
    source_url: a.url,
    captured_at: a.captured_at,
    method: METHOD,
    captured_via: CAPTURED_VIA,
    run_url: a.run_url,
    body_sha256: a.body_sha256,
    egress_country: "US",
  };
  const computed = computeGap(current.assessed_parcel_count_measurement, measurement).gap_pct;
  if (computed === "unknown") throw new Refusal("the gap against the roll is undefined");
  const gap = computed;
  const diff = a.count - roll;
  const relation = diff < 0 ? "below" : diff > 0 ? "above" : "equal to";
  const measured = `GIS ${a.count} features vs certified roll ${roll}${diff === 0 ? "" : ` (${Math.abs(diff)} ${diff < 0 ? "fewer" : "more"}, ${gap}% ${relation} the roll)`}, counted from a ${CAPTURED_VIA} at ${a.captured_at}`;
  const material = gap > current.discrepancy_threshold_pct;

  const {
    gap_reason: _reason,
    discrepancy_explanation: _explanation,
    gis_feature_count: _gis,
    gis_feature_count_measurement: _gisMeasurement,
    gap_pct: _gap,
    gap_reconciliation: previous,
    ...rest
  } = current;
  // CR-5: a reconciliation stays only while it was made for this very GIS count.
  const kept = previous !== undefined && previous.gap === roll - a.count ? previous : undefined;
  const dropped = previous !== undefined && kept === undefined;
  const pending = dropped ? RERUN : NEXT_STEP;
  const receipt = current.export_receipt;
  const texts =
    kept !== undefined && receipt !== undefined
      ? {
          gap_reason: gapReasonText(roll, measurement, gap, kept, receipt),
          discrepancy_explanation: discrepancyExplanationText(
            roll,
            measurement,
            gap,
            current.discrepancy_threshold_pct,
            kept,
            receipt,
          ),
        }
      : {
          gap_reason: `${measured}; gap not yet explained (${pending})`,
          discrepancy_explanation: `${measured}${material ? `; above the ${current.discrepancy_threshold_pct}% threshold, so GIS-only seeding is blocked` : ""}; gap not yet explained (${pending}); the certified roll stays the canonical denominator and GIS is never substituted`,
        };
  const parcel: Parcel = {
    ...rest,
    gis_feature_count: a.count,
    gis_feature_count_measurement: measurement,
    gap_pct: gap,
    ...(diff === 0 ? {} : texts),
    ...(kept === undefined ? {} : { gap_reconciliation: kept }),
  };

  const { blocked_evidence: _blocked, ...rowRest } = row;
  const source: Source = {
    ...rowRest,
    status: "available",
    denominator: measurement,
    captured_at: a.captured_at,
    anti_bot:
      "challenge: none seen; requests: 1 from US runner; operator egress EG: TCP connect never completes",
    decision: "ingest",
    decision_reason:
      "count-only probe in A-01; GIS is not the population; coordinates are paged at 2,000 features per request in A-05 through the kit arcgis-feature-service adapter, and that paging must run from a US runner (the operator egress never connects)",
    // Available now: the operator-side stop is kept as operator_blocked_evidence (OR-M5).
    ...(blockedEvidence ? { operator_blocked_evidence: blockedEvidence } : {}),
  };
  const next: Catalog = {
    ...catalog,
    parcel,
    sources: catalog.sources.map((s) => (s.key === "tcad_gis" ? source : s)),
  };
  emitCatalogYaml(next); // throws before any write if the catalog would not validate or emit
  return { catalog: next, measurement, gap, dropped };
}

export async function recordGisRunner(options: RecordGisRunnerOptions): Promise<number> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));

  try {
    const artifact = readRunnerArtifact(root, options.artifactDir, options.runUrl);
    say(
      `record-gis-runner: artifact ${artifact.artifact_rel} (run ${artifact.run_id}, egress loc=${artifact.egress_loc} colo=${artifact.egress_colo}, HTTP ${artifact.http_status}, ${artifact.body_bytes} bytes, sha256 ${artifact.body_sha256}, captured_at ${artifact.captured_at})`,
    );
    const catalog = readCatalog(catalogPath);
    const evidence = operatorEvidence(root, OPERATOR_EVIDENCE_REL);
    const applied = applyRunnerMeasurement(catalog, artifact, evidence);
    writeFileAtomic(join(root, EVIDENCE_REL), renderRunnerEvidence(artifact, applied.measurement));
    amendCatalog(
      applied.catalog,
      {
        command: "record-gis-runner",
        venue: "runner",
        fields: [
          "parcel.gis_feature_count",
          "parcel.gis_feature_count_measurement",
          "parcel.gap_pct",
          "parcel.gap_reason",
          "parcel.discrepancy_explanation",
          ...(applied.dropped ? ["parcel.gap_reconciliation (dropped: stale)"] : []),
          "sources[tcad_gis]",
        ],
        ref: `${artifact.run_url} (artifact ${artifact.artifact_rel}, body SHA-256 ${artifact.body_sha256})`,
        egress_country: "US",
        note: "the request ran on the US GitHub Actions runner, not on the operator machine",
      },
      catalogPath,
      (options.now ?? (() => new Date()))(),
    );
    if (applied.dropped) {
      say(`record-gis-runner: note: ${RERUN}`);
    }
    say(
      `record-gis-runner: parcel.gis_feature_count ${artifact.count} (roll ${String(catalog.parcel?.assessed_parcel_count)}), gap_pct ${applied.gap}; tcad_gis status available; evidence ${EVIDENCE_REL}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`record-gis-runner: refused: ${message}`);
    return 2;
  }

  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runUrl = argValue("--run-url");
  const positional = process.argv
    .slice(2)
    .filter((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--run-url");
  const artifactDir = positional[0];
  if (artifactDir === undefined) {
    process.stdout.write(
      "record-gis-runner: refused: usage: record-gis-runner <artifact dir> [--run-url <url>]\n",
    );
    process.exitCode = 2;
  } else {
    // `npm --prefix` runs in the package directory; resolve against where npm was started.
    const from = process.env.INIT_CWD ?? process.cwd();
    void recordGisRunner({
      artifactDir: resolve(from, artifactDir),
      ...(runUrl ? { runUrl } : {}),
    }).then((code) => {
      process.exitCode = code;
    });
  }
}
