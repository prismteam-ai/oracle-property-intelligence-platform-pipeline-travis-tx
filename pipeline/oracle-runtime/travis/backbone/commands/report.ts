// A-04 (G-FIX): `backbone report --job <jobId> [--json]` (contracts/cli.md, report.md).
// Read-only: one call to the Restate `BackboneReport/get` handler through the ingress (the CLI
// holds no Query DB client). The service already refuses private keys; this verb drops any such
// key again before printing, so an owner name can never reach stdout. Last stdout line: job_id=<id> (with --json it goes to stderr).
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";

const Args = z
  .object({
    job: z.string().regex(/^travis-a04-[a-z0-9-]+$/),
    json: z.literal(true).optional(),
  })
  .strict();
type Args = z.infer<typeof Args>;

const PRIVATE_KEY = /owner_name|mailing|payload/i;

/** A copy of the value without any key that names private data. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE_KEY.test(key))
        .map(([key, item]) => [key, redact(item)]),
    );
  }
  return value;
}

interface ReportShape {
  job_id: string;
  as_of?: string | null;
  code_sha?: string | null;
  limitations?: string[];
  [section: string]: unknown;
}

const SKIP = new Set(["job_id", "as_of", "code_sha", "limitations", "limitation_jobs"]);

function summary(report: ReportShape): string[] {
  const lines = [
    `report for ${report.job_id} as_of=${report.as_of ?? "unknown"} code_sha=${report.code_sha ?? "unknown"}`,
  ];
  for (const [key, value] of Object.entries(report)) {
    if (SKIP.has(key) || value === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  for (const text of report.limitations ?? []) lines.push(`limitation: ${text}`);
  return lines;
}

export const command: BackboneCommand<Args> = {
  verb: "report",
  args: Args,
  startsRun: () => false,
  async run(ctx, a) {
    const raw = await ctx.ingress.call<ReportShape>("BackboneReport", "get", { jobId: a.job });
    const report = redact(raw) as ReportShape;
    if (a.json === true) ctx.print(JSON.stringify(report, null, 2));
    else for (const line of summary(report)) ctx.print(line);
    return { jobId: a.job, exitCode: 0, ...(a.json === true ? { jobIdToStderr: true } : {}) };
  },
};
