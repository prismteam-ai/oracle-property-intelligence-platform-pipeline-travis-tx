// RunsIndexV1 (contracts/manifest.md): published runs only, ordered by finishedAt.
import { z } from "zod";
import { CidV1, IsoDateTime } from "./cid.js";

export const RUNS_INDEX_SCHEMA = "oracle-travis-runs-index.v1";

export const RunsIndexEntry = z
  .object({ runId: z.string().min(1), manifestCid: CidV1, finishedAt: IsoDateTime })
  .strict();

export const RunsIndexV1 = z
  .object({ schema: z.literal(RUNS_INDEX_SCHEMA), runs: z.array(RunsIndexEntry) })
  .strict()
  .superRefine((index, ctx) => {
    index.runs.forEach((run, i) => {
      if (run.runId.includes("pilot")) {
        ctx.addIssue({
          code: "custom",
          path: ["runs", i, "runId"],
          message: "the pilot is never listed",
        });
      }
      const prev = index.runs[i - 1];
      if (prev && Date.parse(prev.finishedAt) > Date.parse(run.finishedAt)) {
        ctx.addIssue({
          code: "custom",
          path: ["runs", i],
          message: "runs must be ordered by finishedAt",
        });
      }
    });
  });
export type RunsIndexV1 = z.infer<typeof RunsIndexV1>;
