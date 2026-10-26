import { describe, expect, it } from "vitest";
import { LIVE_RUN_SCHEMA, LiveRunV1, RUN_COMMAND_SCHEMA, RunCommandV1 } from "../src/index.js";

const start = {
  schema: RUN_COMMAND_SCHEMA,
  commandId: "6f1c2a3e-8b4d-4c1e-9a2b-1d2e3f4a5b6c",
  action: "start",
  window: { kind: "austin_permits_since_watermark", sinceRunId: "travis-full-run2-20261024" },
  mode: "dry_run",
  requestedBy: "cognito-sub-1",
  requestedAt: "2026-10-26T10:00:00Z",
  expiresAt: "2026-10-26T10:15:00Z",
};

describe("RunCommandV1", () => {
  it("accepts a start command", () => expect(RunCommandV1.parse(start).action).toBe("start"));
  it("rejects a start without a window", () =>
    expect(RunCommandV1.safeParse({ ...start, window: null }).success).toBe(false));
  it("rejects unknown fields (no token can ride along)", () =>
    expect(RunCommandV1.safeParse({ ...start, token: "x" }).success).toBe(false));
  it("rejects expiry before the request", () =>
    expect(RunCommandV1.safeParse({ ...start, expiresAt: "2026-10-26T09:00:00Z" }).success).toBe(
      false,
    ));
  it("needs targetRunId for retry", () =>
    expect(RunCommandV1.safeParse({ ...start, action: "retry" }).success).toBe(false));
});

describe("LiveRunV1", () => {
  it("accepts an idle heartbeat", () =>
    expect(
      LiveRunV1.parse({
        schema: LIVE_RUN_SCHEMA,
        state: "idle",
        runId: null,
        commandId: null,
        startedAt: null,
        updatedAt: "2026-10-26T10:00:00Z",
        step: null,
        bridgeSeenAt: "2026-10-26T10:00:00Z",
        lastCommand: null,
        limitations: [],
      }).state,
    ).toBe("idle"));
});
