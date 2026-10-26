// A-16 T030: the admin command queue (AC-9, AC-11). Tested on a bare stack so the assertions do
// not depend on how CountyLensApi wires it.
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as sns from "aws-cdk-lib/aws-sns";
import { describe, expect, it } from "vitest";
import { AdminQueue } from "../src/admin-queue.js";

function synth(): Template {
  const stack = new Stack(new App(), "T", {
    env: { region: process.env.CDK_DEFAULT_REGION ?? "test-region-1", account: "111111111111" },
  });
  const topic = new sns.Topic(stack, "Topic");
  const q = new AdminQueue(stack, "AdminQueue", { alarmTopic: topic });
  expect(q.queue).toBeDefined();
  expect(q.dlq).toBeDefined();
  return Template.fromStack(stack);
}

describe("AdminQueue", () => {
  const t = synth();

  it("creates the command queue: SSE-SQS, 120 s visibility, 15 min retention, 20 s long poll", () => {
    t.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "countylens-admin-commands",
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 120,
      MessageRetentionPeriod: 900,
      ReceiveMessageWaitTimeSeconds: 20,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
    });
  });

  it("creates the DLQ with 14 day retention and SSE-SQS", () => {
    t.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "countylens-admin-commands-dlq",
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 14 * 24 * 3600,
    });
    t.resourceCountIs("AWS::SQS::Queue", 2);
  });

  it("alarms on a non-empty DLQ, self-resolving, to the topic", () => {
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/SQS",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      EvaluationPeriods: 1,
      Period: 300,
      TreatMissingData: "notBreaching",
      AlarmActions: [Match.anyValue()],
      OKActions: [Match.anyValue()],
    });
    t.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("has no queue policy, no event source mapping and no KMS key (AC-11)", () => {
    t.resourceCountIs("AWS::SQS::QueuePolicy", 0);
    t.resourceCountIs("AWS::Lambda::EventSourceMapping", 0);
    t.resourceCountIs("AWS::KMS::Key", 0);
  });
});
