// SYNTHETIC TEST FIXTURE (test-only): a BackboneCommand shaped like
// travis/backbone/commands/ingest.ts. It starts nothing real; it sends one fake ingress call.
import { z } from "zod";
import type { BackboneCommand } from "../../../../travis/backbone/cli.js";

const Args = z.object({ track: z.literal("appraisal"), leak: z.boolean().optional() }).strict();

export const command: BackboneCommand<z.infer<typeof Args>> = {
  verb: "ingest",
  args: Args,
  async run(ctx, args) {
    if (args.leak === true) {
      ctx.print(`connecting with ${process.env.DATABASE_URL ?? ""}`);
      throw new Error(
        `failed: ${process.env.DATABASE_URL ?? ""} token ${process.env.SYNTH_API_TOKEN ?? ""}`,
      );
    }
    await ctx.ingress.send("TcadBackbone", ctx.jobId, "run", { jobId: ctx.jobId });
    ctx.print("chunks=2 rows=3");
    return { jobId: ctx.jobId, exitCode: 0 };
  },
};
