// T045: operator command `npm --prefix pipeline/oracle-runtime run validate` (FR-001, FR-007,
// research R2, contracts/cli.md).
//
// 1. Checks the vendored validator's SHA-256 against kit/VENDORED.md (refuses on mismatch).
// 2. Runs `python3 <vendored script> pipeline/docs/travis-sources.yaml` with the repository
//    root as the working directory, so the report's `catalog_path` is the relative path no
//    matter where npm was started (`npm --prefix` changes the cwd to the package).
// 3. Saves stdout byte-for-byte to docs/evidence/A-01-readiness.json, after refusing any
//    report that contains an absolute home path.
// 4. Exits with the validator's own code: 0 PASS, 1 BLOCKED. Anything else (hash mismatch,
//    crash, unreadable report) exits 2 and writes nothing.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execRunner, type CommandRunner } from "../lib/command.js";
import { containsHomePath, redact } from "../lib/log.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import type { ValidatorResult } from "./workflow.js";

export const CATALOG_REL_PATH = "pipeline/docs/travis-sources.yaml";
export const VALIDATOR_REL_PATH =
  "pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py";
export const VENDORED_MD_REL_PATH = "pipeline/oracle-runtime/kit/VENDORED.md";
export const REPORT_REL_PATH = "docs/evidence/A-01-readiness.json";

/** The validator's row in VENDORED.md, keyed by its path under kit/. */
const VENDORED_KEY = "`use-oracle/scripts/validate-county-readiness.py`";

export interface RunValidatorOptions {
  repoRoot?: string;
  python?: CommandRunner;
  /** Python executable (default python3). */
  pythonBin?: string;
}

/** The SHA-256 VENDORED.md lists for the validator script. */
export function readVendoredSha256(repoRoot: string = DEFAULT_REPO_ROOT): string {
  const text = readFileSync(join(repoRoot, VENDORED_MD_REL_PATH), "utf8");
  const row = text.split("\n").find((line) => line.trimStart().startsWith(`| ${VENDORED_KEY}`));
  const hash = row?.match(/`([0-9a-f]{64})`/)?.[1];
  if (!hash)
    throw new Error(`run-validator: no SHA-256 for ${VENDORED_KEY} in ${VENDORED_MD_REL_PATH}`);
  return hash;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function runValidator(options: RunValidatorOptions = {}): Promise<ValidatorResult> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const listed = readVendoredSha256(root);
  const actual = sha256File(join(root, VALIDATOR_REL_PATH));
  if (actual !== listed) {
    throw new Error(
      `run-validator: vendored validator SHA-256 ${actual} does not match kit/VENDORED.md (${listed}); refusing to run`,
    );
  }
  const python = options.python ?? execRunner;
  const result = await python(
    options.pythonBin ?? "python3",
    [VALIDATOR_REL_PATH, CATALOG_REL_PATH],
    {
      cwd: root,
    },
  );
  if (result.exit_code !== 0 && result.exit_code !== 1) {
    const why = result.stderr.split("\n").find((l) => l.trim().length > 0) ?? "";
    throw new Error(`run-validator: validator crashed (exit ${result.exit_code}) ${redact(why)}`);
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    throw new Error("run-validator: validator stdout is not a JSON report; nothing saved");
  }
  if (containsHomePath(result.stdout)) {
    throw new Error("run-validator: report contains an absolute home path; nothing saved");
  }
  const reportPath = join(root, REPORT_REL_PATH);
  mkdirSync(dirname(reportPath), { recursive: true });
  const tmp = `${reportPath}.tmp-${process.pid}`;
  writeFileSync(tmp, result.stdout, "utf8");
  renameSync(tmp, reportPath);
  return { exit_code: result.exit_code, report_path: REPORT_REL_PATH, vendored_sha256: actual };
}

interface ReportSummary {
  overall?: unknown;
  error?: unknown;
  gates?: Array<{ gate?: unknown; status?: unknown }>;
}

export async function main(
  options: RunValidatorOptions = {},
  out: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Promise<number> {
  let result: ValidatorResult;
  try {
    result = await runValidator(options);
  } catch (error) {
    out(redact(error instanceof Error ? error.message : String(error)));
    return 2;
  }
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const report = JSON.parse(readFileSync(join(root, REPORT_REL_PATH), "utf8")) as ReportSummary;
  const gates = (report.gates ?? []).map((g) => `${String(g.gate)}:${String(g.status)}`).join(", ");
  out(
    redact(
      `validate: exit ${result.exit_code}, overall ${String(report.overall)}${gates ? `, gates ${gates}` : ""}${report.error ? `, ${String(report.error)}` : ""}; report ${result.report_path}; vendored validator sha256 ${result.vendored_sha256}`,
    ),
  );
  return result.exit_code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
