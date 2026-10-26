// A-07 T059/T060 (Track D, contracts/estimator.md): `backbone roof-age:backfill --as-of-date
// <date> --source-system <src> --report <path> [--limit N --offset M] [--apply]`. Talks only to
// the Restate ingress (`RoofAgeBackfill.run`) — never the database directly from this process.
// Without `--limit` the scope is the full roll (T060); with it, the same deterministic subset
// `roof-age:audit` already reviewed (T058/T059, D-21). Without `--apply` this is a dry run
// (rowsWritten stays 0 and nothing is persisted) — `--apply` is the only thing that writes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";

const Args = z
  .object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceSystem: z.string().min(1),
    report: z.string().min(1),
    limit: z.string().regex(/^\d+$/).optional(),
    offset: z.string().regex(/^\d+$/).optional(),
    apply: z.literal(true).optional(),
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

interface BackfillResult {
  jobId: string;
  asOfDate: string;
  scope: "subset" | "full";
  limit: number | null;
  offset: number;
  apply: boolean;
  rowsWritten: number;
  coverage: {
    byBasis: Record<string, number>;
    byConfidence: Record<string, number>;
    total: number;
  };
}

export const command: BackboneCommand<Args> = {
  verb: "roof-age:backfill",
  args: Args,
  startsRun: () => false,
  async run(ctx, a) {
    const jobId = mintA07JobId(
      a.limit === undefined ? "roofage-full" : "roofage-apply25",
      new Date(),
    );
    const result = await ctx.ingress.call<BackfillResult>("RoofAgeBackfill", "run", {
      jobId,
      asOfDate: a.asOfDate,
      limit: a.limit === undefined ? undefined : Number(a.limit),
      offset: a.offset === undefined ? 0 : Number(a.offset),
      apply: a.apply === true,
    });
    ctx.print(
      `roof-age:backfill source=${a.sourceSystem} scope=${result.scope} apply=${result.apply} total=${result.coverage.total} rowsWritten=${result.rowsWritten}`,
    );
    ctx.print(
      `roof-age:backfill byBasis=${JSON.stringify(result.coverage.byBasis)} byConfidence=${JSON.stringify(result.coverage.byConfidence)}`,
    );

    const repoRoot = resolve(new URL("../../../../../", import.meta.url).pathname);
    const reportPath = resolve(repoRoot, a.report);
    const report = { sourceSystem: a.sourceSystem, ...result };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    ctx.print(`report: ${reportPath}`);

    return { jobId, exitCode: 0, jobIdPrinted: false };
  },
};
