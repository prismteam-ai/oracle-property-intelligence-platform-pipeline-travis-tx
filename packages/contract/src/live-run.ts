// LiveRunV1 (A-16 AC-7, AC-9): the bridge's status object at s3://<CID-copy bucket>/live/live.json.
// Written only by the bridge (heartbeat every 30 s), read by the API. Never published, never in a
// manifest; holds no paths, tokens or database strings.
import { z } from "zod";
import { IsoDateTime } from "./cid.js";

export const LIVE_RUN_SCHEMA = "oracle-travis-live-run.v1";
/** The Runs page shows "Bridge offline" when bridgeSeenAt is older than this. */
export const BRIDGE_STALE_MS = 3 * 60 * 1000;

export const LiveRunState = z.enum([
  "idle",
  "running",
  "stopping",
  "stopped",
  "failed",
  "succeeded",
]);
export const LastCommandOutcome = z.enum([
  "accepted",
  "rejected_active_run",
  "expired",
  "duplicate",
  "cancelled",
]);

export const LiveRunV1 = z
  .object({
    schema: z.literal(LIVE_RUN_SCHEMA),
    state: LiveRunState,
    runId: z.string().min(1).nullable(),
    commandId: z.uuid().nullable(),
    startedAt: IsoDateTime.nullable(),
    updatedAt: IsoDateTime,
    step: z.string().min(1).nullable(),
    bridgeSeenAt: IsoDateTime,
    lastCommand: z
      .object({ commandId: z.uuid(), outcome: LastCommandOutcome, at: IsoDateTime })
      .strict()
      .nullable(),
    limitations: z.array(z.string().min(1)),
  })
  .strict();
export type LiveRunV1 = z.infer<typeof LiveRunV1>;
