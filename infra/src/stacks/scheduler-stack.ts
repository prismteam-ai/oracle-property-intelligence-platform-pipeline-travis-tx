// CountyLensScheduler (A-11 G-SCHED, task T026-T028): a CDK-defined, DISABLED-by-default
// EventBridge Scheduler schedule targeting a Fargate RunTask directly — no FargateService, no
// ReservedConcurrency, no NAT Gateway. Scheduler and Fargate RunTask both bill per invocation
// only, so the whole stack costs $0 while the schedule is DISABLED (NFR-003, P0-19, plan §
// "Idle-cost justification per resource"). This is the infra side of A-11 User Story 3; the
// Fargate task's own entrypoint (`pipeline/publish/src/batch-entrypoint.ts`, contracts/
// publish-sequence.md "Fargate batch-task entrypoint contract") is a separate, not-yet-built
// G-RUN task (T029) — the container image referenced below is a placeholder until that lands.
//
// Region comes from the stack's own `env.region` (constitution III, P0-18: this file never
// contains a region literal; see infra/test/scheduler.test.ts and stacks.test.ts's repo-wide
// grep). Secrets (DB credentials, Filebase + Pinata pinning credentials) are referenced by name
// only (`secretsmanager.Secret.fromSecretNameV2`) — this stack never creates a real
// AWS::SecretsManager::Secret resource and never puts a real credential value anywhere; the
// operator provisions these three secrets out-of-band (same pattern as OPERATOR_EMAIL today,
// ops-stack.ts), and ECS resolves them into the container's environment via `valueFrom` (an ARN),
// never a plaintext `environment` entry (AD-26, contracts/publish-sequence.md).
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { CID_COPY_PUBLIC_PREFIX, CID_COPY_SSM_PREFIX } from "../data-stack.js";

/** EventBridge Scheduler schedule name (always created DISABLED; an operator enables it by hand). */
export const SCHEDULE_NAME = "countylens-incremental-run";
/** ECS cluster name (no FargateService lives here — RunTask only). */
export const CLUSTER_NAME = "countylens-batch";
/** Fargate task family for the batch publishRun entrypoint. */
export const TASK_FAMILY = "countylens-publish-run";
/** Secret names the operator provisions out-of-band in Secrets Manager; never created here. */
export const DB_CREDENTIALS_SECRET_NAME = "countylens/scheduler/db-credentials";
export const FILEBASE_CREDENTIALS_SECRET_NAME = "countylens/scheduler/filebase-credentials";
export const PINATA_CREDENTIALS_SECRET_NAME = "countylens/scheduler/pinata-credentials";
/**
 * Placeholder image: `pipeline/publish/src/batch-entrypoint.ts` (contracts/publish-sequence.md,
 * tasks.md T029) does not exist yet — that is a G-RUN task, not something G-SCHED builds. Once it
 * ships with a Dockerfile, this becomes an `ecs.ContainerImage.fromAsset(...)` of that image.
 */
export const BATCH_TASK_PLACEHOLDER_IMAGE = "public.ecr.aws/docker/library/node:24-slim";
/** DLQ alarm evaluation window, same cadence as the Ops stack's alarms (ALARM_PERIOD). */
export const DLQ_ALARM_PERIOD = Duration.minutes(5);

export interface SchedulerStackProps extends StackProps {
  /** DLQ alarm recipient; optional — when absent the alarm exists with no subscriber yet. */
  readonly operatorEmail?: string;
}

export class SchedulerStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly schedule: scheduler.CfnSchedule;
  readonly dlq: sqs.Queue;
  readonly dlqAlarm: cw.Alarm;

  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);

    // Public subnets only, zero NAT gateways: a NAT Gateway bills hourly whether or not the
    // schedule ever fires, which would violate "$0 while disabled" (NFR-003, P0-19). The Fargate
    // task gets a public IP and reaches the operator's DB/Filebase/Pinata endpoints through the
    // (free) Internet Gateway directly; it holds no inbound security-group rule.
    // The DB is the operator-chosen Postgres of AD-26, never the Query DB client. grep-gates:allow reason: names that architecture decision in prose, not an import or dependency.
    this.vpc = new ec2.Vpc(this, "BatchVpc", {
      // Explicit AZ names (built from this.region, never a literal) instead of maxAzs: with a
      // concrete env (account + region, set in app.ts), CDK's default AZ discovery is a real
      // EC2 DescribeAvailabilityZones context-provider call, which needs AWS credentials at
      // synth time — undesirable for `cdk synth`/CI and for these unit tests.
      availabilityZones: [`${this.region}a`, `${this.region}b`],
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      restrictDefaultSecurityGroup: false,
    });
    Validations.of(this.vpc).acknowledge({
      id: "AwsSolutions-VPC7",
      reason:
        "VPC Flow Logs need a destination (S3 or CloudWatch Logs) that bills for storage while " +
        "the schedule is disabled and the task never runs (A7, NFR-003); the only traffic is one " +
        "short-lived Fargate RunTask per invocation, and its own task logs (TaskLogs below) already " +
        "record the run.",
    });

    const taskSecurityGroup = new ec2.SecurityGroup(this, "BatchTaskSg", {
      vpc: this.vpc,
      description: "CountyLens scheduled publish-run Fargate task: outbound only, no inbound rule",
      allowAllOutbound: true,
    });

    this.cluster = new ecs.Cluster(this, "BatchCluster", {
      clusterName: CLUSTER_NAME,
      vpc: this.vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });
    Validations.of(this.cluster).acknowledge({
      id: "AwsSolutions-ECS4",
      reason:
        "Container Insights bills per-metric and the cluster runs exactly one short-lived " +
        "RunTask invocation per schedule fire, never a long-lived service (A7, NFR-003); the " +
        "task's own CloudWatch Logs group (TaskLogs) and the DLQ alarm (T028) already give " +
        "operator visibility into every run's success/failure.",
    });

    // Referenced-only secrets: never a CDK-created AWS::SecretsManager::Secret (AD-14 bans that
    // resource type for anything this app creates), never a plaintext value in this file. The
    // operator creates these three secrets by name before enabling the schedule.
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "DbCredentialsSecret",
      DB_CREDENTIALS_SECRET_NAME,
    );
    const filebaseSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "FilebaseCredentialsSecret",
      FILEBASE_CREDENTIALS_SECRET_NAME,
    );
    const pinataSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "PinataCredentialsSecret",
      PINATA_CREDENTIALS_SECRET_NAME,
    );

    const taskLogs = new logs.LogGroup(this, "TaskLogs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, "PublishRunTask", {
      family: TASK_FAMILY,
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    // Bucket/CloudFront names via the SSM String parameters DataStack already mirrors its own
    // outputs to (data-stack.ts, CID_COPY_SSM_PREFIX) — a CloudFormation cross-stack reference
    // resolved at deploy time, never a literal and never a direct TS object coupling to
    // DataStack (which would force this stack onto DataStack's exact account/region pinning;
    // this stack is intentionally account-agnostic so that creating its VPC never needs a real
    // EC2 DescribeAvailabilityZones call at synth time — see BatchVpc below).
    const cidCopyBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `${CID_COPY_SSM_PREFIX}/bucket`,
    );
    const cidCopyHost = ssm.StringParameter.valueForStringParameter(
      this,
      `${CID_COPY_SSM_PREFIX}/host`,
    );
    const cidCopyBucket = s3.Bucket.fromBucketName(this, "CidCopyBucketRef", cidCopyBucketName);

    this.taskDefinition.addContainer("PublishRun", {
      containerName: "publish-run",
      image: ecs.ContainerImage.fromRegistry(BATCH_TASK_PLACEHOLDER_IMAGE),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "publish-run", logGroup: taskLogs }),
      // Public bucket/CloudFront names only — not secrets (the bucket is already world-readable
      // by design, data-stack.ts). Everything that is a credential (DB, Filebase, Pinata) goes
      // through `secrets` below, never `environment` (contracts/publish-sequence.md).
      environment: {
        CID_COPY_BUCKET: cidCopyBucketName,
        CID_COPY_HOST: cidCopyHost,
      },
      secrets: {
        // DB credentials: an operator-chosen private database, never the Query DB (AD-26). The
        // batch task reads its watermark/run state from this DB at task start, never from local
        // disk (Fargate tasks are ephemeral; contracts/publish-sequence.md).
        // The DB above is the operator-chosen Postgres of AD-26. grep-gates:allow reason: names that architecture decision in prose, not an import or dependency.
        DB_CREDENTIALS_JSON: ecs.Secret.fromSecretsManager(dbSecret),
        FILEBASE_CREDENTIALS_JSON: ecs.Secret.fromSecretsManager(filebaseSecret),
        PINATA_CREDENTIALS_JSON: ecs.Secret.fromSecretsManager(pinataSecret),
      },
    });
    Validations.of(this.taskDefinition).acknowledge({
      id: "AwsSolutions-ECS2",
      reason:
        "The two plaintext environment entries (CID_COPY_BUCKET, CID_COPY_HOST) are the public " +
        "bucket name and CloudFront domain of the already-public CID copy (data-stack.ts) — not " +
        "secrets. Every credential (DB, Filebase, Pinata) is injected via `secrets` " +
        "(ecs.Secret.fromSecretsManager, valueFrom an ARN), never `environment` " +
        "(contracts/publish-sequence.md, infra/test/no-connection-string.test.ts).",
    });

    if (this.taskDefinition.executionRole !== undefined) {
      Validations.of(this.taskDefinition.executionRole).acknowledge({
        id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy]",
        reason:
          "The ECS-managed execution role pulls the image, resolves the three Secrets Manager " +
          "secrets into the container, and writes task logs only " +
          "(AmazonECSTaskExecutionRolePolicy is the AWS-documented role for exactly that); it " +
          "never touches application data.",
      });
    }

    // Write grant: the batch task publishes new CIDs under ipfs/* the same way the interactive
    // path's CidCopyWriter role does (data-stack.ts), scoped to the same prefix; no Delete, no ACL.
    // The bucket is referenced only (fromBucketName, via the SSM parameter above), never a direct
    // DataStack object coupling.
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "WriteCidCopyFromScheduledBatchTask",
        actions: ["s3:PutObject", "s3:GetObject", "s3:GetObjectAttributes"],
        resources: [cidCopyBucket.arnForObjects(`${CID_COPY_PUBLIC_PREFIX}*`)],
      }),
    );
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ListPublishedPrefixOnlyFromBatchTask",
        actions: ["s3:ListBucket"],
        resources: [cidCopyBucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": [`${CID_COPY_PUBLIC_PREFIX}*`] } },
      }),
    );
    // The imported bucket's ARN token resolves through an SSM dynamic reference
    // (`valueForStringParameter` above, `{{resolve:ssm:...}}`); cdk-nag's granular IAM5 id embeds
    // that exact resolved-parameter construct id (stable while the parameter name and this
    // construct's id, "CidCopyBucketRef", stay the same), copied verbatim from the synth-time
    // finding rather than computed.
    Validations.of(this.taskDefinition.taskRole).acknowledge({
      id: "AwsSolutions-IAM5[Resource::arn:aws:s3:::<SsmParameterValuecountylenscidcopybucketC96584B6F00A464EAD1953AFF4B05118Parameter>/ipfs/*]",
      reason:
        "Objects are keyed by their content CID under ipfs/*, the exact boundary of what the " +
        "scheduled batch task may write (same prefix and same no-Delete/no-ACL shape as " +
        "CidCopyWriter in data-stack.ts); the bucket policy additionally denies any PutObject " +
        "under ipfs/* without If-None-Match, so a published CID is never overwritten.",
    });

    // DLQ for the Scheduler invocation's own failure path (T028): if EventBridge Scheduler cannot
    // start the RunTask after its retries, the failed event lands here. One self-resolving alarm
    // (observability-dlq-alarms): ALARM when non-empty, OK when drained, missing data not breaching.
    this.dlq = new sqs.Queue(this, "ScheduleFailureDlq", {
      queueName: "countylens-scheduler-run-task-dlq",
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    this.dlq.grantSendMessages(new iam.ServicePrincipal("scheduler.amazonaws.com"));
    Validations.of(this.dlq).acknowledge({
      id: "AwsSolutions-SQS3",
      reason:
        "This queue is itself the dead-letter queue for the Scheduler target's failed RunTask " +
        "invocations (T028); a DLQ does not need a second DLQ behind it. It has exactly one " +
        "CloudWatch alarm (DlqNotEmpty below), matching the project's one-alarm-per-DLQ rule " +
        "(infra/test/stacks.test.ts TC-052).",
    });

    const alarmTopic = new sns.Topic(this, "SchedulerAlerts", {
      topicName: "countylens-scheduler-alerts",
      displayName: "CountyLens scheduler alerts",
      enforceSSL: true,
    });
    if (props.operatorEmail !== undefined) {
      alarmTopic.addSubscription(new subs.EmailSubscription(props.operatorEmail));
    }

    this.dlqAlarm = new cw.Alarm(this, "DlqNotEmpty", {
      alarmName: "countylens-scheduler-run-task-dlq-not-empty",
      alarmDescription:
        "countylens scheduler: one or more RunTask invocations landed in the DLQ " +
        "(EventBridge Scheduler exhausted its retries starting the Fargate publish-run task)",
      metric: this.dlq.metricApproximateNumberOfMessagesVisible({
        period: DLQ_ALARM_PERIOD,
        statistic: "Maximum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // Zero messages is healthy; the alarm clears itself (and the PagerDuty-equivalent SNS
      // notification auto-resolves) once the DLQ drains.
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    this.dlqAlarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));
    this.dlqAlarm.addOkAction(new cwActions.SnsAction(alarmTopic));

    // EventBridge Scheduler role: only what's needed to RunTask this one task definition and pass
    // its two roles — never a wildcard across the account's tasks/roles.
    const schedulerRole = new iam.Role(this, "SchedulerExecutionRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description:
        "Starts the countylens publish-run Fargate task only (RunTask + PassRole, scoped)",
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "RunThisTaskDefinitionOnly",
        actions: ["ecs:RunTask"],
        // Every revision of this family: EventBridge Scheduler always targets the current one.
        resources: [this.taskDefinition.taskDefinitionArn],
      }),
    );
    if (this.taskDefinition.executionRole === undefined) {
      throw new Error("FargateTaskDefinition always creates an execution role by default");
    }
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassThisTasksTwoRolesOnly",
        actions: ["iam:PassRole"],
        resources: [
          this.taskDefinition.taskRole.roleArn,
          this.taskDefinition.executionRole.roleArn,
        ],
      }),
    );

    // The schedule itself: created DISABLED. An operator flips it to ENABLED by hand after
    // reviewing Run 1-3's evidence (Stage 6, 🛑 D-8) — this stack never enables it.
    this.schedule = new scheduler.CfnSchedule(this, "IncrementalRunSchedule", {
      name: SCHEDULE_NAME,
      description:
        "CountyLens: run the incremental publish for Travis County (DISABLED by default)",
      state: "DISABLED",
      scheduleExpression: "rate(1 day)",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: this.cluster.clusterArn,
        roleArn: schedulerRole.roleArn,
        ecsParameters: {
          taskDefinitionArn: this.taskDefinition.taskDefinitionArn,
          launchType: "FARGATE",
          taskCount: 1,
          platformVersion: "LATEST",
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: this.vpc.publicSubnets.map((s) => s.subnetId),
              assignPublicIp: "ENABLED",
              securityGroups: [taskSecurityGroup.securityGroupId],
            },
          },
        },
        deadLetterConfig: { arn: this.dlq.queueArn },
        retryPolicy: { maximumRetryAttempts: 2 },
      },
    });

    new CfnOutput(this, "ScheduleName", {
      value: SCHEDULE_NAME,
      description:
        "EventBridge Scheduler schedule (state DISABLED until an operator enables it, 🛑 D-8)",
    });
    new CfnOutput(this, "ClusterArn", { value: this.cluster.clusterArn });
    new CfnOutput(this, "TaskDefinitionArn", { value: this.taskDefinition.taskDefinitionArn });
    new CfnOutput(this, "DlqArn", { value: this.dlq.queueArn });
  }
}
