// A-16 T030 (AC-9, AC-11): the admin command queue. The API Lambda sends a RunCommandV1; the
// laptop bridge long-polls it. Standard queue, SSE-SQS (no CMK, so no KMS bill), 15 minute
// retention so an unread Start never fires later, a DLQ after 3 receives, and one self-resolving
// alarm on the DLQ. No queue policy, no Lambda trigger, no inbound path: access is by the IAM
// identities that G1 (API role, send only) and the bridge user (receive/delete) hold.
import { Duration, Validations } from "aws-cdk-lib";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export const ADMIN_QUEUE_NAME = "countylens-admin-commands";
export const ADMIN_DLQ_NAME = "countylens-admin-commands-dlq";

export interface AdminQueueProps {
  /** Receives the DLQ alarm (ALARM and OK). */
  readonly alarmTopic: sns.ITopic;
}

export class AdminQueue extends Construct {
  readonly queue: sqs.Queue;
  readonly dlq: sqs.Queue;
  readonly dlqAlarm: cw.Alarm;

  constructor(scope: Construct, id: string, props: AdminQueueProps) {
    super(scope, id);
    this.dlq = new sqs.Queue(this, "Dlq", {
      queueName: ADMIN_DLQ_NAME,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new sqs.Queue(this, "Queue", {
      queueName: ADMIN_QUEUE_NAME,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(120),
      retentionPeriod: Duration.minutes(15),
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: 3 },
    });
    // AwsSolutions-SQS4 asks for an enforce-SSL queue policy. The AC-11 synth test requires that
    // no queue policy exists at all (nothing may widen access); the AWS SDK only speaks TLS.
    for (const q of [this.queue, this.dlq]) {
      Validations.of(q).acknowledge({
        id: "AwsSolutions-SQS4",
        reason:
          "AC-11 forbids any queue resource policy; clients are the AWS SDK (TLS only) under IAM.",
      });
    }
    this.dlqAlarm = new cw.Alarm(this, "DlqNotEmpty", {
      alarmName: "countylens-admin-commands-dlq",
      alarmDescription: "A run command failed 3 times and sits in the DLQ (A-16 AC-9)",
      metric: this.dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    const action = new cwActions.SnsAction(props.alarmTopic);
    this.dlqAlarm.addAlarmAction(action);
    this.dlqAlarm.addOkAction(action);
  }
}
