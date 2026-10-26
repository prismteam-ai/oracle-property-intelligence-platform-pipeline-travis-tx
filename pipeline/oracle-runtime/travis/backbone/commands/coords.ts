// A-04 T043 / T045: `backbone coords` (contracts/cli.md). Talks only to the Restate ingress.
//
//   coords --gis-artifact <dir> [--job <tcadJobId>]   GisImport: import the US-runner artifact
//                                                     (offline), then assemble coordinates
//   coords --assemble-only [--job <tcadJobId>]        GisImport: assemble only (after permits --link)
//   coords --address-points <cacheDir> --assemble-only [--job <tcadJobId>]
//                                                     load the City of Austin address-point layer
//                                                     cache (npm run fetch-address-layer), then assemble
//   coords --coverage --tables <dir> [--job <id>]     coverage both ways (coverage-report.ts), read-only
//
// Exit 2 when the artifact has no complete.json (`gis: blocked at {ts}; coverage not complete`).
// Last line: job_id=travis-a04-coords-<yyyymmddhhmmss> (the coverage form prints its coverage line
// and then the job it read).
import { resolve } from "node:path";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";
import type { GisImportResult } from "../../gis/workflow.js";
import { runCoverage } from "../../gis/coverage-report.js";

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);

const Args = z
  .object({
    gisArtifact: z.string().min(1).optional(),
    assembleOnly: z.literal(true).optional(),
    addressPoints: z.string().min(1).optional(),
    coverage: z.literal(true).optional(),
    tables: z.string().min(1).optional(),
    job: JobId.optional(),
  })
  .strict()
  .refine((a) => a.addressPoints === undefined || a.assembleOnly === true, {
    message: "--address-points goes with --assemble-only (the points are used by the assembly)",
    path: ["addressPoints"],
  })
  .refine(
    (a) =>
      [a.gisArtifact !== undefined, a.assembleOnly === true, a.coverage === true].filter(Boolean)
        .length === 1,
    {
      message:
        "give exactly one of --gis-artifact <dir>, --assemble-only, --coverage --tables <dir>",
    },
  )
  .refine((a) => a.coverage !== true || a.tables !== undefined, {
    message: "--coverage needs --tables <dir>",
    path: ["tables"],
  });
type Args = z.infer<typeof Args>;

export const command: BackboneCommand<Args> = {
  verb: "coords",
  args: Args,
  startsRun: (a) => a.coverage !== true,
  async run(ctx, a) {
    if (a.coverage === true) {
      const out = await runCoverage({
        tablesDir: resolve(a.tables ?? ""),
        jobId: a.job ?? null,
        ingress: ctx.ingress,
      });
      for (const l of out.lines) ctx.print(l);
      return { jobId: out.jobId, exitCode: out.ok ? 0 : 1 };
    }
    const jobId = ctx.jobIdFor("coords");
    const body = {
      artifactDir: a.gisArtifact === undefined ? null : resolve(a.gisArtifact),
      assemble: true,
      addressPointsDir: a.addressPoints === undefined ? null : resolve(a.addressPoints),
      tcadJobId: a.job ?? null,
    };
    const result = await ctx.ingress.call<GisImportResult>("GisImport", "run", body, jobId);
    if (result.gis !== null) {
      ctx.print(
        `gis: artifact ${result.gis.artifactRunId} ${result.gis.status} (${result.gis.detail}) pages=${result.gis.pages} source_count=${result.gis.sourceCount ?? "unknown"} rows_written=${result.gis.rowsWritten}`,
      );
      if (result.gis.limitation !== null) ctx.print(result.gis.limitation);
    }
    if (result.addressPoints !== null)
      ctx.print(
        `address points: sha256=${result.addressPoints.sha256} records=${result.addressPoints.recordCount} rows_written=${result.addressPoints.rowsWritten} skipped=${result.addressPoints.skipped}`,
      );
    if (result.assembled !== null)
      ctx.print(`coordinates: rows_written=${result.assembled.rowsWritten}`);
    return { jobId, exitCode: result.gis?.status === "blocked" ? 2 : 0 };
  },
};
