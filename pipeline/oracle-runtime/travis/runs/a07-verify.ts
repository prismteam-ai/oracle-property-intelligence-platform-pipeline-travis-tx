// A-07 T055 (tasks.md TZ05): the story's `agents.verify` check — spec.md's four-part
// independent test. Reads the T020/T034/T042/T060 report JSON files directly (never the Query
// DB, AD-04) and asserts all four conditions, exiting non-zero on any FAILURE. Tracks B/C
// having no report file this pass is "not_applicable", not a failure (same documented-gap
// reasoning T053's `a07-coverage.ts` uses) — this run's scope is Track A + Track D only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ConditionStatus = "pass" | "fail" | "not_applicable";

export interface ConditionResult {
  id: string;
  status: ConditionStatus;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  conditions: ConditionResult[];
}

export interface VerifyA07Options {
  /** Track A, T020's resolution-report.json. Always present (Track A always builds this run). */
  identityReportPath: string;
  /** Track B, T034's status-report.json. Undefined when Track B was not built this pass. */
  bbbReportPath?: string | undefined;
  /** Track C, T042's business-coverage-report.json. Undefined likewise. */
  businessReportPath?: string | undefined;
  /** Track D, T058's 25-property audit.json. Always present (Track D always builds this run). */
  roofAgeAuditPath: string;
  /** Track D, T059's rerun-25.json (the immediate re-run of the applied 25). Always present. */
  roofAgeRerun25Path: string;
  /** Track D, T061's worked-example.json (TCAD 0223120506, substituted anchor). Always present. */
  workedExamplePath: string;
}

function readJson(path: string | undefined): Record<string, unknown> | null {
  if (path === undefined) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

/** (1) five-state sum == permit total; every `resolved` row cited (vacuous when resolved = 0). */
function checkFiveStateTotals(identityReportPath: string): ConditionResult {
  const id = "five_state_sum_matches_permit_total";
  const report = readJson(identityReportPath);
  if (report === null) {
    return { id, status: "fail", detail: `identity report not found at ${identityReportPath}` };
  }
  const nested = report.fiveStateTotals as Record<string, unknown> | undefined;
  const totals = nested ?? report;
  const fields = ["resolved", "candidate", "ambiguous", "conflicting", "unresolved"] as const;
  const values = fields.map((f) => Number(totals[f] ?? 0));
  const sum = values.reduce((a, b) => a + b, 0);
  const permitTotal = Number(report.permitTotal ?? sum);
  const resolved = values[0] ?? 0;
  if (sum !== permitTotal) {
    return { id, status: "fail", detail: `five-state sum ${sum} != permit total ${permitTotal}` };
  }
  return {
    id,
    status: "pass",
    detail:
      resolved === 0
        ? `sum ${sum} == permit total ${permitTotal}; resolved = 0, so no citation is owed (vacuously satisfied)`
        : `sum ${sum} == permit total ${permitTotal}; ${resolved} resolved row(s) present (citation not independently re-checked here)`,
  };
}

/** (2) manifest BBB coverage by status, with receipts — not_applicable when Track B wasn't built. */
function checkBbbCoverage(bbbReportPath: string | undefined): ConditionResult {
  const id = "bbb_coverage_with_receipts";
  const report = readJson(bbbReportPath);
  if (report === null) {
    return { id, status: "not_applicable", detail: "Track B not built this pass (documented gap)" };
  }
  const resolved = Number(report.resolved ?? 0);
  const counts = report.counts as Record<string, unknown> | undefined;
  if (resolved > 0 && (counts === undefined || Object.keys(counts).length === 0)) {
    return {
      id,
      status: "fail",
      detail: `${resolved} resolved companies but no per-status bbb_status counts/receipts recorded`,
    };
  }
  return { id, status: "pass", detail: `resolved = ${resolved}, per-status counts present` };
}

/** (3) business count == Comptroller Travis total at watermark — not_applicable when Track C wasn't built. */
function checkBusinessCount(businessReportPath: string | undefined): ConditionResult {
  const id = "business_count_matches_watermark";
  const report = readJson(businessReportPath);
  if (report === null) {
    return { id, status: "not_applicable", detail: "Track C not built this pass (documented gap)" };
  }
  const loaded = Number(report.loadedCount ?? 0);
  const source = Number(report.sourceCount ?? loaded);
  if (loaded !== source) {
    return {
      id,
      status: "fail",
      detail: `loaded count ${loaded} != source count ${source} at the watermark`,
    };
  }
  return { id, status: "pass", detail: `loaded count ${loaded} == source count ${source}` };
}

/** (4) 25-property roof-age audit 25/25, re-run rowsWritten: 0, worked example traced. */
function checkRoofAge(opts: VerifyA07Options): ConditionResult {
  const id = "roof_age_25_sample_and_worked_example";
  const audit = readJson(opts.roofAgeAuditPath);
  const rerun = readJson(opts.roofAgeRerun25Path);
  const worked = readJson(opts.workedExamplePath);
  const failures: string[] = [];
  if (audit === null) failures.push("audit.json not found");
  else {
    const total = Number(audit.total ?? 0);
    const agreeCount = Number(audit.agreeCount ?? 0);
    const agreeAll25 = audit.agreeAll25 === true || (total === 25 && agreeCount === 25);
    if (!agreeAll25) failures.push(`audit agreement ${agreeCount}/${total}, not 25/25`);
  }
  if (rerun === null) failures.push("rerun-25.json not found");
  else if (Number(rerun.rowsWritten ?? -1) !== 0) {
    failures.push(`re-run rowsWritten = ${String(rerun.rowsWritten)}, expected 0`);
  }
  if (worked === null) failures.push("worked-example.json not found");
  else {
    const anchor = worked.anchor as Record<string, unknown> | undefined;
    if (typeof worked.tcadId !== "string" || worked.tcadId === "")
      failures.push("worked example missing tcadId");
    if (anchor === undefined || anchor.chosenBasis === undefined) {
      failures.push("worked example missing a traced anchor/basis");
    }
  }
  if (failures.length > 0) return { id, status: "fail", detail: failures.join("; ") };
  return {
    id,
    status: "pass",
    detail: "25/25 agreement, re-run rowsWritten: 0, worked example traced",
  };
}

export function verifyA07(options: VerifyA07Options): VerifyResult {
  const conditions = [
    checkFiveStateTotals(options.identityReportPath),
    checkBbbCoverage(options.bbbReportPath),
    checkBusinessCount(options.businessReportPath),
    checkRoofAge(options),
  ];
  return { ok: conditions.every((c) => c.status !== "fail"), conditions };
}

async function main(): Promise<number> {
  const root = resolve(new URL("../../../../", import.meta.url).pathname);
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const options: VerifyA07Options = {
    identityReportPath: resolve(root, arg("--identity-report") ?? ""),
    bbbReportPath:
      arg("--bbb-report") === undefined ? undefined : resolve(root, arg("--bbb-report") as string),
    businessReportPath:
      arg("--business-report") === undefined
        ? undefined
        : resolve(root, arg("--business-report") as string),
    roofAgeAuditPath: resolve(root, arg("--roof-age-audit") ?? ""),
    roofAgeRerun25Path: resolve(root, arg("--roof-age-rerun25") ?? ""),
    workedExamplePath: resolve(root, arg("--worked-example") ?? ""),
  };
  const result = verifyA07(options);
  for (const c of result.conditions) {
    process.stdout.write(
      `${c.status === "fail" ? "FAIL" : c.status === "pass" ? "PASS" : "N/A "} ${c.id}: ${c.detail}\n`,
    );
  }
  return result.ok ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  process.exitCode = await main();
}
