// CountyLensScheduledRun (PO 2026-10-26): one at() schedule that puts the admin page's Start
// command on the admin queue for the laptop bridge, with nothing else in the stack but its role.
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ADMIN_QUEUE_NAME } from "../src/admin-queue.js";
import { loadConfig } from "../src/config.js";
import {
  RUN_COMMAND_SCHEMA,
  SCHEDULED_REQUESTED_BY,
  ScheduledRunStack,
  scheduledStartCommand,
  type ScheduledRunConfig,
} from "../src/stacks/scheduled-run-stack.js";

const RUN: ScheduledRunConfig = {
  at: "2026-10-26T22:00",
  commandId: "6f1c2a4e-8b3d-4c5a-9e7f-0a1b2c3d4e5f",
  sinceRunId: "travis-full-run4-20261026",
  mode: "publish",
};

function template(): Template {
  const stack = new ScheduledRunStack(new App(), "CountyLensScheduledRun", { run: RUN });
  return Template.fromStack(stack);
}

describe("scheduledStartCommand", () => {
  it("is the admin Start: same window and mode, requested at the schedule time, 15 minute expiry", () => {
    expect(scheduledStartCommand(RUN)).toEqual({
      schema: RUN_COMMAND_SCHEMA,
      commandId: RUN.commandId,
      action: "start",
      window: { kind: "austin_permits_since_watermark", sinceRunId: RUN.sinceRunId },
      mode: "publish",
      requestedBy: SCHEDULED_REQUESTED_BY,
      requestedAt: "2026-10-26T22:00:00.000Z",
      expiresAt: "2026-10-26T22:15:00.000Z",
    });
  });

  it("refuses a malformed time, id or base run", () => {
    expect(() => scheduledStartCommand({ ...RUN, at: "2026-10-26 22:00" })).toThrow(/at must/);
    expect(() => scheduledStartCommand({ ...RUN, commandId: "x" })).toThrow(/UUID/);
    expect(() => scheduledStartCommand({ ...RUN, sinceRunId: " " })).toThrow(/sinceRunId/);
  });
});

describe("CountyLensScheduledRun stack", () => {
  it("has one enabled at() schedule whose target is the admin queue with the command as input", () => {
    const t = template();
    t.resourceCountIs("AWS::Scheduler::Schedule", 1);
    const schedule = Object.values(t.findResources("AWS::Scheduler::Schedule"))[0]?.Properties as {
      ScheduleExpression: string;
      ScheduleExpressionTimezone: string;
      State: string;
      Target: { Arn: unknown; Input: string };
    };
    expect(schedule.ScheduleExpression).toBe("at(2026-10-26T22:00:00)");
    expect(schedule.ScheduleExpressionTimezone).toBe("UTC");
    expect(schedule.State).toBe("ENABLED");
    expect(JSON.stringify(schedule.Target.Arn)).toContain(`:${ADMIN_QUEUE_NAME}`);
    expect(JSON.parse(schedule.Target.Input)).toEqual(scheduledStartCommand(RUN));
  });

  it("its role may only send to the admin queue", () => {
    const t = template();
    const policies = Object.values(t.findResources("AWS::IAM::Policy"));
    expect(policies).toHaveLength(1);
    const statements = (
      policies[0]?.Properties as {
        PolicyDocument: { Statement: { Action: unknown; Resource: unknown }[] };
      }
    ).PolicyDocument.Statement;
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toBe("sqs:SendMessage");
    expect(JSON.stringify(statements[0]?.Resource)).toContain(`:${ADMIN_QUEUE_NAME}`);
  });
});

describe("config: COUNTYLENS_SCHEDULED_RUN_*", () => {
  const context = (key: string): unknown =>
    ({
      "countylens:githubRepository": "o/r",
      "countylens:githubRef": "main",
      "countylens:allowedRegions": ["xx-test-1"],
    })[key];
  const base = { CDK_DEFAULT_REGION: "xx-test-1" };

  it("is absent unless set, and needs all four values", () => {
    expect(loadConfig(base, context).scheduledRun).toBeUndefined();
    expect(() => loadConfig({ ...base, COUNTYLENS_SCHEDULED_RUN_AT: RUN.at }, context)).toThrow(
      /all four/,
    );
    const full = loadConfig(
      {
        ...base,
        COUNTYLENS_SCHEDULED_RUN_AT: RUN.at,
        COUNTYLENS_SCHEDULED_RUN_ID: RUN.commandId,
        COUNTYLENS_SCHEDULED_RUN_SINCE: RUN.sinceRunId,
        COUNTYLENS_SCHEDULED_RUN_MODE: "publish",
      },
      context,
    );
    expect(full.scheduledRun).toEqual(RUN);
  });
});
