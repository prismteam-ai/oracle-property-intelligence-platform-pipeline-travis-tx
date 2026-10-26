// A-04 T051: `backbone permits --mode backfill|incremental|pilot` or `backbone permits --link`
// (contracts/cli.md). Starts the AustinPermits workflow through the Restate ingress (never the
// Query DB), waits for its output, prints counts only, and exits 0 ok · 1 failed · 2 blocked
// (a source refused; receipt written; never retried). `pilot` = one page (maxPages 1);
// `--link` = link + classify over the loaded rows (the Loader writes).
//
// A-11 T031 (Stage 5 S5.2): extra flag on the same verb, same shape as `ingest --write-group`
// (commands/ingest.ts): `--write-group --job <jobId> [--pids <list|file>] [--out <dir>]` —
// the Property Improvement group, paged over the already-reconciled Query DB rows
// (local-stack/services/workflows/permits-backbone.ts), local files only, never a new Austin
// request. `--job` here is any string (a Property Improvement export is not tied to one
// AustinPermits run id; it reads whatever is currently reconciled in the Query DB).
import { resolve } from "node:path";
import { z } from "zod";
import { parsePidList } from "../../tcad/write-group.js";
import type { BackboneCommand, ExitCode } from "../cli.js";

const Args = z
  .object({
    mode: z.enum(["backfill", "incremental", "pilot"]).optional(),
    link: z.literal(true).optional(),
    /** Start the backfill from page 1, archiving a stale cursor (F2 OR-m5). */
    fresh: z.literal(true).optional(),
    writeGroup: z.literal(true).optional(),
    /** --write-group only: any job label used to lay out `groups/property_improvement`. */
    job: z.string().min(1).optional(),
    /** --write-group only: pIDs (comma list, or a file path) whose groups are (re)written. */
    pids: z.string().min(1).optional(),
    /** --write-group only: output directory for the written groups. */
    out: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (a) =>
      [a.mode !== undefined, a.link === true, a.writeGroup === true].filter(Boolean).length === 1,
    { message: "give exactly one of --mode backfill|incremental|pilot, --link or --write-group" },
  )
  .refine((a) => a.fresh === undefined || a.mode === "backfill", {
    message: "--fresh only goes with --mode backfill",
  })
  .refine((a) => a.writeGroup !== true || a.job !== undefined, {
    message: "--write-group needs --job <jobId>",
  })
  .refine(
    (a) =>
      a.writeGroup === true || (a.pids === undefined && a.out === undefined && a.job === undefined),
    {
      message: "--job, --pids and --out belong to --write-group",
    },
  );
type Args = z.infer<typeof Args>;

const GroupOut = z.looseObject({
  groups: z.number().int(),
  empty: z.number().int(),
  permits: z.number().int(),
  dir: z.string(),
  missing_pids: z.array(z.string()).optional(),
});

const Output = z.looseObject({
  status: z.enum(["complete", "waiting_human", "failed"]),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  pages: z.number().int().optional(),
  rows: z.number().int().optional(),
  written: z.number().int().optional(),
  tombstones: z.number().int().optional(),
  watermark: z.string().nullable().optional(),
  watermarkCheck: z.string().optional(),
  reason: z.string().optional(),
});

export const command: BackboneCommand<Args> = {
  verb: "permits",
  args: Args,
  startsRun: (a) => a.writeGroup !== true,
  async run(ctx, args) {
    if (args.writeGroup === true && args.job !== undefined) {
      const out = GroupOut.parse(
        await ctx.ingress.callLong(
          "PropertyImprovementBackbone",
          "writeGroup",
          {
            jobId: args.job,
            ...(args.pids !== undefined ? { pids: parsePidList(args.pids) } : {}),
            ...(args.out !== undefined ? { out: resolve(args.out) } : {}),
          },
          args.job,
        ),
      );
      ctx.print(
        `property_improvement_group: groups=${out.groups} empty=${out.empty} permits=${out.permits} dir=${out.dir}`,
      );
      if (out.missing_pids !== undefined && out.missing_pids.length > 0) {
        ctx.print(`property_improvement_group: missing_pids=${out.missing_pids.length}`);
      }
      return { jobId: args.job, exitCode: 0 };
    }
    const mode = args.link === true ? "link" : (args.mode ?? "backfill");
    const jobId = ctx.jobIdFor(`permits-${mode}`);
    const key = `austin-3syk-w9eu-${jobId.replace(/^travis-a04-permits-/, "")}`;
    await ctx.ingress.send("AustinPermits", key, "run", {
      jobId,
      mode,
      ...(args.fresh ? { fresh: true } : {}),
    });
    const out = Output.parse(await ctx.ingress.get("AustinPermits", key));
    const counts = [
      `status=${out.status}`,
      `pages=${out.pages ?? 0}`,
      `rows=${out.rows ?? 0}`,
      `written=${out.written ?? 0}`,
      `tombstones=${out.tombstones ?? 0}`,
      ...(out.watermark ? [`watermark=${out.watermark}`] : []),
      ...(out.watermarkCheck ? [`watermark_check=${out.watermarkCheck}`] : []),
    ];
    ctx.print(`permits ${mode}: ${counts.join(" ")}`);
    if (out.reason) ctx.print(`permits ${mode}: ${out.reason}`);
    return { jobId, exitCode: out.exitCode as ExitCode };
  },
};
