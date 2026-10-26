// A-07 T058 (Track D, contracts/estimator.md): `backbone roof-age:audit --limit 25 --offset 0
// --as-of-date 2026-10-22 --source-system travis-austin-permits --report <path>`. Talks only
// to the Restate ingress (`RoofAgeAudit.run`) — never the database directly from this process.
// Always a dry run (no `--apply` flag exists on this verb at all): T059 is a separate verb,
// strictly gated on D-21's human approval, never invoked from here.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";

const Args = z
  .object({
    limit: z.string().regex(/^\d+$/),
    offset: z.string().regex(/^\d+$/).optional(),
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceSystem: z.string().min(1),
    report: z.string().min(1),
  })
  .strict();
type Args = z.infer<typeof Args>;

export const A07_JOB_ID = /^travis-a07-[a-z0-9-]+$/;

function mintA07JobId(kind: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = `travis-a07-${kind}-${stamp}`;
  if (!A07_JOB_ID.test(id)) throw new Error(`invalid A-07 job id: ${id}`);
  return id;
}

interface AuditResult {
  asOfDate: string;
  limit: number;
  offset: number;
  total: number;
  agreeCount: number;
  agreeAll25: boolean;
  rows: Array<{ tcadId: string; agree: boolean; mismatchFields: string[] }>;
}

export const command: BackboneCommand<Args> = {
  verb: "roof-age:audit",
  args: Args,
  startsRun: () => false,
  async run(ctx, a) {
    const jobId = mintA07JobId("roofage-audit", new Date());
    const result = await ctx.ingress.call<AuditResult>("RoofAgeAudit", "run", {
      limit: Number(a.limit),
      offset: a.offset === undefined ? 0 : Number(a.offset),
      asOfDate: a.asOfDate,
    });
    ctx.print(
      `roof-age:audit source=${a.sourceSystem} as_of=${result.asOfDate} total=${result.total} agree=${result.agreeCount}/${result.total} agreeAll25=${result.agreeAll25}`,
    );
    const doubtful = result.rows.filter((r) => !r.agree);
    if (doubtful.length > 0) {
      ctx.print(`roof-age:audit doubtful rows: ${doubtful.map((r) => r.tcadId).join(", ")}`);
    }

    // Report paths are repo-root-relative (`pipeline/data/...`), resolved from this file's own
    // location so the run lands in the same place regardless of the invoking shell's cwd.
    const repoRoot = resolve(new URL("../../../../../", import.meta.url).pathname);
    const reportPath = resolve(repoRoot, a.report);
    const report = { jobId, sourceSystem: a.sourceSystem, ...result };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    ctx.print(`report: ${reportPath}`);

    return { jobId, exitCode: 0, jobIdPrinted: false };
  },
};
