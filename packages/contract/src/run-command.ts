// RunCommandV1 (A-16 AC-7, AC-9): an admin command the API sends to the SQS queue and the
// laptop bridge pulls. Carries no token, email or path; requestedBy is the Cognito sub.
import { z } from "zod";
import { IsoDateTime } from "./cid.js";

export const RUN_COMMAND_SCHEMA = "oracle-travis-run-command.v1";
/** Unpicked commands expire after this long (AC-9). */
export const RUN_COMMAND_TTL_MS = 15 * 60 * 1000;

export const RunCommandAction = z.enum(["start", "stop", "retry"]);
export type RunCommandAction = z.infer<typeof RunCommandAction>;

export const RunCommandWindow = z
  .object({ kind: z.literal("austin_permits_since_watermark"), sinceRunId: z.string().min(1) })
  .strict();

export const RunCommandV1 = z
  .object({
    schema: z.literal(RUN_COMMAND_SCHEMA),
    commandId: z.uuid(),
    action: RunCommandAction,
    window: RunCommandWindow.nullable(),
    targetRunId: z.string().min(1).optional(),
    mode: z.enum(["publish", "dry_run"]),
    requestedBy: z.string().min(1),
    requestedAt: IsoDateTime,
    expiresAt: IsoDateTime,
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.action === "start" && c.window === null) {
      ctx.addIssue({ code: "custom", path: ["window"], message: "start needs a window" });
    }
    if (c.action === "retry" && c.targetRunId === undefined) {
      ctx.addIssue({ code: "custom", path: ["targetRunId"], message: "retry needs targetRunId" });
    }
    if (Date.parse(c.expiresAt) <= Date.parse(c.requestedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be after requestedAt",
      });
    }
  });
export type RunCommandV1 = z.infer<typeof RunCommandV1>;
