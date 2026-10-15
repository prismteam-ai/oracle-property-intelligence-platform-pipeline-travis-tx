import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export type IngestStackProps = StackProps & {
  repoRoot: string;
  scheduleEnabled: boolean;
  scheduleExpression: string;
  publishEnvParameterName: string;
  alertEmail?: string;
  pagerDutyIntegrationUrl?: string;
  /** TCAD certified appraisal export zip (published yearly at https://traviscad.org/publicinformation). */
  tcadExportUrl?: string;
};

export class OracleIngestStack extends Stack {
  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);
    Tags.of(this).add("project", "oracle-travis");
    Tags.of(this).add("component", "ingest");

    const state = new s3.Bucket(this, "PipelineState", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
    });

    const vpc = new ec2.Vpc(this, "IngestVpc", {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });
    const cluster = new ecs.Cluster(this, "IngestCluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    const task = new ecs.FargateTaskDefinition(this, "IngestTask", {
      cpu: 2048,
      memoryLimitMiB: 8192,
      ephemeralStorageGiB: 80,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const logGroup = new logs.LogGroup(this, "IngestLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    task.addContainer("pipeline", {
      image: ecs.ContainerImage.fromAsset(props.repoRoot, {
        file: "Dockerfile",
        exclude: ["data", "node_modules", "cdk.out", "infra/cdk.out", ".git"],
      }),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "ingest", logGroup }),
      environment: {
        ORACLE_STATE_BUCKET: state.bucketName,
        ORACLE_PUBLISH_ENV_PARAMETER: props.publishEnvParameterName,
        AWS_REGION: this.region,
        ...(props.tcadExportUrl ? { ORACLE_TCAD_EXPORT_URL: props.tcadExportUrl } : {}),
      },
    });
    state.grantReadWrite(task.taskRole);
    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${props.publishEnvParameterName}`,
        ],
      }),
    );

    const alerts = new sns.Topic(this, "IngestAlerts", {
      displayName: "Oracle Travis ingestion alerts",
    });
    if (props.alertEmail) alerts.addSubscription(new subs.EmailSubscription(props.alertEmail));
    if (props.pagerDutyIntegrationUrl)
      alerts.addSubscription(new subs.UrlSubscription(props.pagerDutyIntegrationUrl));

    const dlq = new sqs.Queue(this, "IngestScheduleDlq", {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    const dlqAlarm = new cloudwatch.Alarm(this, "IngestDlqNotEmpty", {
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Scheduled ingestion could not be started (events in DLQ). Self-resolves when the DLQ drains.",
    });
    dlqAlarm.addAlarmAction(new cwActions.SnsAction(alerts));
    dlqAlarm.addOkAction(new cwActions.SnsAction(alerts));

    new events.Rule(this, "IngestSchedule", {
      enabled: props.scheduleEnabled,
      schedule: events.Schedule.expression(props.scheduleExpression),
      targets: [
        new targets.EcsTask({
          cluster,
          taskDefinition: task,
          launchType: ecs.LaunchType.FARGATE,
          assignPublicIp: true,
          subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
          deadLetterQueue: dlq,
          retryAttempts: 2,
          maxEventAge: Duration.hours(2),
        }),
      ],
    });

    new events.Rule(this, "IngestTaskFailed", {
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ["STOPPED"],
          containers: { exitCode: [{ "anything-but": 0 }] },
        },
      },
      targets: [new targets.SnsTopic(alerts)],
    });

    new CfnOutput(this, "StateBucket", { value: state.bucketName });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "TaskDefinitionArn", { value: task.taskDefinitionArn });
    new CfnOutput(this, "PublicSubnets", {
      value: vpc.publicSubnets.map((s) => s.subnetId).join(","),
    });
    new CfnOutput(this, "AlertsTopic", { value: alerts.topicArn });
  }
}
