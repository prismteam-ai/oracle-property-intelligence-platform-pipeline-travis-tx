// CountyLensScheduledRun (PO 2026-10-26): one scheduled Start of the incremental run, delivered
// the same way as the admin page's Start button. EventBridge Scheduler puts one RunCommandV1 on
// the admin command queue at a fixed time (an at() schedule fires once; delete the stack after);
// the laptop bridge picks it up and runs the gated path (pipeline/bridge/README.md). Nothing here
// runs the pipeline: if
// the bridge is not polling, the command expires after RUN_COMMAND_TTL_MS and nothing happens.
//
// A stack of its own so that creating it touches nothing else (no API or Lambda change). It
// refers to the queue by its fixed name (ADMIN_QUEUE_NAME) instead of a cross-stack reference.
// Region and account are the stack's own (never a literal here). Costs nothing while idle: one
// Scheduler invocation and one SQS message.
import { Aws, CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type { Construct } from "constructs";
import { ADMIN_QUEUE_NAME } from "../admin-queue.js";

/** packages/contract RUN_COMMAND_SCHEMA and RUN_COMMAND_TTL_MS (infra does not import the contract). */
export const RUN_COMMAND_SCHEMA = "oracle-travis-run-command.v1";
export const RUN_COMMAND_TTL_MS = 15 * 60 * 1000;
/** RunCommandV1.requestedBy for a scheduled command (the admin page sends the Cognito sub). */
export const SCHEDULED_REQUESTED_BY = "eventbridge-scheduler";

export interface ScheduledRunConfig {
  /** UTC start, minute precision: `YYYY-MM-DDTHH:MM`. */
  readonly at: string;
  /** The command's id (a UUID), fixed so a redeploy does not make a second command. */
  readonly commandId: string;
  /** The run the incremental window starts from (the latest published run). */
  readonly sinceRunId: string;
  readonly mode: "publish" | "dry_run";
}

export interface ScheduledRunStackProps extends StackProps {
  readonly run: ScheduledRunConfig;
}

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The RunCommandV1 body the schedule delivers: the admin Start, with a 15 minute expiry. */
export function scheduledStartCommand(run: ScheduledRunConfig): Record<string, unknown> {
  if (!AT_PATTERN.test(run.at)) throw new Error(`scheduled run: at must be YYYY-MM-DDTHH:MM UTC`);
  if (!UUID_PATTERN.test(run.commandId)) throw new Error(`scheduled run: commandId must be a UUID`);
  if (run.sinceRunId.trim() === "") throw new Error(`scheduled run: sinceRunId is empty`);
  const requestedAt = new Date(`${run.at}:00.000Z`);
  return {
    schema: RUN_COMMAND_SCHEMA,
    commandId: run.commandId,
    action: "start",
    window: { kind: "austin_permits_since_watermark", sinceRunId: run.sinceRunId },
    mode: run.mode,
    requestedBy: SCHEDULED_REQUESTED_BY,
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + RUN_COMMAND_TTL_MS).toISOString(),
  };
}

export class ScheduledRunStack extends Stack {
  readonly schedule: scheduler.CfnSchedule;

  constructor(scope: Construct, id: string, props: ScheduledRunStackProps) {
    super(scope, id, props);
    const body = scheduledStartCommand(props.run);
    const queueArn = `arn:${Aws.PARTITION}:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:${ADMIN_QUEUE_NAME}`;

    const role = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID } },
      }),
      description: "EventBridge Scheduler: send the one scheduled Start to the admin queue",
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "SendToAdminQueueOnly",
        actions: ["sqs:SendMessage"],
        resources: [queueArn],
      }),
    );

    this.schedule = new scheduler.CfnSchedule(this, "Schedule", {
      description: `CountyLens: one ${props.run.mode} Start of the incremental run at ${props.run.at} UTC`,
      scheduleExpression: `at(${props.run.at}:00)`,
      scheduleExpressionTimezone: "UTC",
      flexibleTimeWindow: { mode: "OFF" },
      state: "ENABLED",
      target: {
        arn: queueArn,
        roleArn: role.roleArn,
        input: JSON.stringify(body),
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 600 },
      },
    });

    new CfnOutput(this, "ScheduledCommand", { value: JSON.stringify(body) });
  }
}
