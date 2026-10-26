// SYNTHETIC TEST FIXTURE (test-only): a read-only verb; it never starts a run.
import { z } from "zod";
import type { BackboneCommand } from "../../../../travis/backbone/cli.js";

const Args = z.object({ job: z.string(), json: z.boolean().optional() }).strict();

export const command: BackboneCommand<z.infer<typeof Args>> = {
  verb: "report",
  args: Args,
  startsRun: () => false,
  async run(_ctx, args) {
    return { jobId: args.job, exitCode: 0 };
  },
};
