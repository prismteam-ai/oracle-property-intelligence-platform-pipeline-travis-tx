// A-04 T027: `backbone ingest --track appraisal` (contracts/cli.md). Starts TcadBackbone over
// the whole export through the Restate ingress (never the Query DB) and polls its status:
// complete → 0 · failed → 1 · blocked → 2 · waiting_human → 3 (a missing / mismatched export,
// or a 403 on the one allowed download). Extra flags on the same verb:
//   --write-group --job <jobId> [--pids <list|file>] [--out <dir>]
//                                        the County group (R only, gis_centroid geometry only);
//                                        --pids rewrites only those pIDs' zips (comma list or a
//                                        file of pIDs), --out writes them into <dir>
//   --join-proof --job <jobId> --seed <n> the read-only 1,000-row geoID→pID proof + reverse
// Prints counts and paths only.
import { resolve } from "node:path";
import { z } from "zod";
import { parsePidList } from "../../tcad/write-group.js";
import type { BackboneCommand, ExitCode } from "../cli.js";
import type { RunContext } from "../run-context.js";
import {
  BATCH_PAUSE_RANGE,
  CHUNK_SIZE_RANGE,
  DEFAULT_BATCH_PAUSE_MS,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_WINDOW,
  WINDOW_RANGE,
} from "../batch-defaults.js";

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);

/** A flag value (string from argv, or a number in tests) checked as an integer in range. */
const intFlag = (range: { min: number; max: number }) =>
  z
    .union([z.string().regex(/^\d+$/), z.number()])
    .transform((v) => Number(v))
    .pipe(z.number().int().min(range.min).max(range.max));

const Args = z
  .object({
    track: z.literal("appraisal").optional(),
    writeGroup: z.literal(true).optional(),
    joinProof: z.literal(true).optional(),
    job: JobId.optional(),
    /** --write-group only: pIDs (comma list, or a file path) whose zips are rewritten. */
    pids: z.string().min(1).optional(),
    /** --write-group only: output directory for the rewritten zips. */
    out: z.string().min(1).optional(),
    seed: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
    /** Poll interval in ms (tests pass 0). */
    pollMs: z.number().int().nonnegative().optional(),
    /** Records per chunk (100..20000, default 2000). */
    chunkSize: intFlag(CHUNK_SIZE_RANGE).optional(),
    /** Chunks in flight (1..8, default 2). */
    window: intFlag(WINDOW_RANGE).optional(),
    /** Pause before each chunk in ms (0..600000, default 2000). */
    batchPauseMs: intFlag(BATCH_PAUSE_RANGE).optional(),
  })
  .strict()
  .refine(
    (a) =>
      [a.track !== undefined, a.writeGroup === true, a.joinProof === true].filter(Boolean)
        .length === 1,
    {
      message: "give exactly one of --track appraisal, --write-group or --join-proof",
    },
  )
  .refine((a) => (a.track !== undefined ? a.job === undefined : a.job !== undefined), {
    message: "--write-group and --join-proof need --job <jobId>; --track appraisal takes none",
  })
  .refine((a) => a.writeGroup === true || (a.pids === undefined && a.out === undefined), {
    message: "--pids and --out belong to --write-group",
  })
  .refine((a) => (a.joinProof === true) === (a.seed !== undefined), {
    message: "--join-proof needs --seed <int>",
  });
export type IngestArgs = z.output<typeof Args>;

const Status = z.looseObject({
  status: z.enum(["running", "waiting_human", "blocked", "complete", "failed"]),
  reason: z.string().nullable().optional(),
  loaded: z.number().int().optional(),
  records: z.number().int().optional(),
  clean: z.boolean().optional(),
  progress: z
    .looseObject({
      chunks_done: z.number().int(),
      chunks_started: z.number().int(),
      chunks_total: z.number().int().nullable(),
      records_loaded: z.number().int(),
      records_per_s: z.number().nullable().optional(),
    })
    .optional(),
});

export const EXIT_FOR_STATUS: Readonly<Record<string, ExitCode>> = {
  complete: 0,
  failed: 1,
  blocked: 2,
  waiting_human: 3,
};

/** Polls TcadBackbone/<jobId>/status until it is not `running`; prints counts only. */
export async function waitForRun(
  ctx: RunContext,
  jobId: string,
  pollMs = 5_000,
): Promise<ExitCode> {
  for (;;) {
    const s = Status.parse(await ctx.ingress.call("TcadBackbone", "status", null, jobId));
    if (s.status !== "running") {
      ctx.print(
        `tcad: status=${s.status}${s.records === undefined ? "" : ` records=${s.records}`}${s.loaded === undefined ? "" : ` loaded=${s.loaded}`}${s.reason ? ` reason=${s.reason}` : ""}`,
      );
      if (s.status === "complete" && s.clean === false) {
        // The status list has no "complete with differences": the run is complete, the roll is
        // not clean (limitation roll_difference_unexplained), so the CLI exits 1 (OR-m6).
        ctx.print("tcad: roll_difference_unexplained (see the report limitations)");
        return 1;
      }
      return EXIT_FOR_STATUS[s.status] ?? 1;
    }
    if (s.progress !== undefined) {
      const p = s.progress;
      ctx.print(
        `tcad: progress chunks=${p.chunks_done}/${p.chunks_total ?? "?"} started=${p.chunks_started} loaded=${p.records_loaded}${p.records_per_s == null ? "" : ` rps=${p.records_per_s}`}`,
      );
    }
    if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
  }
}

const GroupOut = z.looseObject({
  zips: z.number().int(),
  out_of_scope: z.number().int(),
  dir: z.string(),
  geometry: z.record(z.string(), z.number()),
  mailing_address_fallback: z.number().int().optional(),
  missing_pids: z.array(z.string()).optional(),
});
const ProofOut = z.looseObject({
  pass: z.boolean(),
  matched: z.number().int(),
  disagreements: z.number().int(),
  no_tcad_geoid: z.number().int(),
  ambiguous_geoid: z.number().int(),
  reverse_checked: z.number().int(),
  reverse_disagreements: z.number().int(),
});

export const command: BackboneCommand<IngestArgs> = {
  verb: "ingest",
  args: Args,
  startsRun: (a) => a.track !== undefined,
  async run(ctx, args) {
    if (args.writeGroup === true && args.job !== undefined) {
      const out = GroupOut.parse(
        await ctx.ingress.callLong(
          "TcadBackbone",
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
        `county_group: zips=${out.zips} out_of_scope=${out.out_of_scope} geometry=${JSON.stringify(out.geometry)} mailing_address_fallback=${out.mailing_address_fallback ?? 0} dir=${out.dir}`,
      );
      if (out.missing_pids !== undefined && out.missing_pids.length > 0) {
        ctx.print(`county_group: missing_pids=${out.missing_pids.length}`);
      }
      return { jobId: args.job, exitCode: 0 };
    }
    if (args.joinProof === true && args.job !== undefined) {
      const seed = Number(args.seed);
      const out = ProofOut.parse(
        await ctx.ingress.callLong(
          "TcadBackbone",
          "joinProof",
          { jobId: args.job, seed },
          args.job,
        ),
      );
      ctx.print(
        `join_proof: no_tcad_geoid=${out.no_tcad_geoid} ambiguous_geoid=${out.ambiguous_geoid} reverse_checked=${out.reverse_checked} reverse_disagreements=${out.reverse_disagreements} seed=${seed}`,
      );
      ctx.print(`job_id=${args.job}`);
      // contracts/cli.md: the join_proof line is the LAST line for --join-proof.
      ctx.print(
        `join_proof=${out.pass ? "pass" : "fail"} matched=${out.matched} disagreements=${out.disagreements}`,
      );
      return { jobId: args.job, exitCode: out.pass ? 0 : 1, jobIdPrinted: true };
    }
    const jobId = ctx.jobIdFor(null);
    await ctx.ingress.send("TcadBackbone", jobId, "run", {
      jobId,
      mode: "full",
      asOf: ctx.asOf(),
      chunkSize: args.chunkSize ?? DEFAULT_CHUNK_SIZE,
      window: args.window ?? DEFAULT_WINDOW,
      batchPauseMs: args.batchPauseMs ?? DEFAULT_BATCH_PAUSE_MS,
    });
    return { jobId, exitCode: await waitForRun(ctx, jobId, args.pollMs) };
  },
};
