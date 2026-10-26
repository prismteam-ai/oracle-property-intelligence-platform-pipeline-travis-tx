// CountyLensOps (A-03 T075): operations with nothing that bills while idle (plan § "Idle-cost
// justification per resource"). One SNS topic with the operator's email subscription (the
// PagerDuty substitute, plan Complexity Tracking D-04; the address comes from OPERATOR_EMAIL
// and is never in git), three self-resolving alarms (Lambda Errors ≥ 1 per 5 min, Throttles ≥ 1,
// HTTP API 5xx ≥ 1; ALARM and OK both notify, missing data is not breaching so each clears
// itself), the $10 monthly budget with 80 % actual and 100 % forecast notifications (NFR-02,
// TC-052) as an AwsCustomResource over the Budgets API (CloudFormation has no
// AWS::Budgets::Budget type in the project region, F3006, and no stack may live in another
// region; a budget is an account-level object, so the call needs no regional resource). The only
// Lambda here is the budget's singleton provider, which runs on deploy only ($0 idle). Alarms
// reference the Api stack's function and HTTP API through cross-stack exports (ARD § 16 AM-02
// order: Api before Ops).
//
// No GitHub OIDC provider and no CI deploy role (ARD § 16 AM-08, 2026-10-21): the AWS
// Organizations SCP denies iam:CreateOpenIDConnectProvider in this account, so CI never deploys;
// every infra deploy runs from the PO's laptop (profile assess) after a PO approval per deploy.
import { createHash } from "node:crypto";
import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as cr from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import {
  API_DURATION_ALARM_P95_MS,
  acknowledgeWildcardResources,
  type ApiStack,
} from "./api-stack.js";
import { ALERTS_TOPIC_NAME, PROJECT_NAME, PROJECT_TAG_KEY } from "./config.js";

export { ALERTS_TOPIC_NAME };
export const MONTHLY_BUDGET_USD = 10;
/** Budget name prefix; the full name carries a revision hash (budgetNameFor, metagross N2). */
export const BUDGET_NAME = "countylens-monthly";
/** The two notifications: 80 % of actual spend, 100 % of forecast spend (NFR-02). */
const BUDGET_THRESHOLDS = [
  { type: "ACTUAL", percent: 80 },
  { type: "FORECASTED", percent: 100 },
] as const;

/**
 * The budget name (and physical id): BUDGET_NAME plus 10 hex of a SHA-256 over the whole
 * definition, the operator email included. UpdateBudget cannot change notification subscribers,
 * so a changed email must become a new budget: a new name makes CloudFormation replace the
 * custom resource (create the new budget, then delete the old one in cleanup). The address
 * itself never appears in the name.
 */
export function budgetNameFor(operatorEmail: string): string {
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        limitUsd: MONTHLY_BUDGET_USD,
        thresholds: BUDGET_THRESHOLDS,
        operatorEmail: operatorEmail.trim().toLowerCase(),
      }),
    )
    .digest("hex")
    .slice(0, 10);
  return `${BUDGET_NAME}-${revision}`;
}
/** CloudFormation type of the budget custom resource (AwsCustomResource `resourceType`). */
export const BUDGET_RESOURCE_TYPE = "Custom::CountyLensBudget";
/** Alarm evaluation window (FR-007: "Errors ≥ 1 per 5 min"); one period, threshold 1. */
export const ALARM_PERIOD = Duration.minutes(5);
/** A-16 T025 (A14-3): alarm at 8 of the account's 10 concurrent Lambda executions. */
export const ACCOUNT_CONCURRENCY_ALARM = 8;

export interface OpsStackProps extends StackProps {
  /** CountyLensApi: the function and HTTP API the alarms watch. */
  readonly api: ApiStack;
  /** Alarm and budget recipient (OPERATOR_EMAIL, from the environment; never in git). */
  readonly operatorEmail: string;
}

export class OpsStack extends Stack {
  readonly topic: sns.Topic;
  readonly alarms: readonly cw.Alarm[];
  readonly budget: cr.AwsCustomResource;

  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);

    // Email channel. No KMS: a customer-managed key bills while idle (A7) and the AWS-managed
    // SNS key cannot be used by CloudWatch alarms; the messages carry alarm state names only.
    this.topic = new sns.Topic(this, "Alerts", {
      topicName: ALERTS_TOPIC_NAME,
      displayName: "CountyLens alerts",
      enforceSSL: true,
    });
    this.topic.addSubscription(new subs.EmailSubscription(props.operatorEmail));

    const notify = (alarm: cw.Alarm): cw.Alarm => {
      alarm.addAlarmAction(new cwActions.SnsAction(this.topic));
      alarm.addOkAction(new cwActions.SnsAction(this.topic));
      return alarm;
    };
    const alarm = (
      alarmId: string,
      alarmName: string,
      metric: cw.Metric,
      alarmDescription: string,
    ): cw.Alarm =>
      notify(
        new cw.Alarm(this, alarmId, {
          alarmName,
          alarmDescription,
          metric,
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          // Zero traffic is healthy: the alarm clears itself when the next window has no errors.
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }),
      );
    const sum = { period: ALARM_PERIOD, statistic: "Sum" };
    this.alarms = [
      alarm(
        "LambdaErrors",
        "countylens-api-errors",
        props.api.fn.metricErrors(sum),
        "countylens-api: one or more invocation errors in 5 minutes (FR-007)",
      ),
      alarm(
        "LambdaThrottles",
        "countylens-api-throttles",
        props.api.fn.metricThrottles(sum),
        "countylens-api: one or more throttled invocations in 5 minutes (account concurrency limit 10, AD-11)",
      ),
      alarm(
        "HttpApi5xx",
        "countylens-api-5xx",
        props.api.httpApi.metricServerError(sum),
        "countylens-api HTTP API: one or more 5xx responses in 5 minutes (FR-007)",
      ),
      // A-16 T022 (A13-6): p95 duration at 80 % of the 15 s timeout means searches are about
      // to time out (and bill the full timeout each).
      notify(
        new cw.Alarm(this, "LambdaDuration", {
          alarmName: "countylens-api-duration-p95",
          alarmDescription: `countylens-api: p95 duration ≥ ${API_DURATION_ALARM_P95_MS} ms (80 % of the timeout) in 5 minutes (A13-6)`,
          metric: props.api.fn.metricDuration({ period: ALARM_PERIOD, statistic: "p95" }),
          threshold: API_DURATION_ALARM_P95_MS,
          evaluationPeriods: 1,
          comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }),
      ),
      // A-16 T025 (A14-3): the query API, the agent and the MCP server share the account's 10
      // concurrent executions; at 8 one of them is about to starve the others. The lasting fix
      // is a Service Quotas increase for "Concurrent executions" (operator option, not IaC).
      notify(
        new cw.Alarm(this, "AccountConcurrency", {
          alarmName: "countylens-account-concurrency",
          alarmDescription: `Account Lambda ConcurrentExecutions ≥ ${ACCOUNT_CONCURRENCY_ALARM} of 10 in 1 minute (A14-3; shared by api, agent, mcp)`,
          metric: new cw.Metric({
            namespace: "AWS/Lambda",
            metricName: "ConcurrentExecutions",
            statistic: "Maximum",
            period: Duration.minutes(1),
          }),
          threshold: ACCOUNT_CONCURRENCY_ALARM,
          evaluationPeriods: 1,
          comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }),
      ),
    ];

    this.budget = this.monthlyBudget(props.operatorEmail);

    new CfnOutput(this, "AlertsTopicArn", {
      value: this.topic.topicArn,
      description: "SNS topic of the alarms (email subscription confirmed by the PO, ✋ A-3)",
    });
  }
  /**
   * The $10 MONTHLY COST budget (NFR-02, TC-052): notifications only (a budget action bills per
   * day), 80 % actual and 100 % forecast to the operator email. The physical id is the budget
   * name from budgetNameFor (a revision hash of the definition and email, metagross N2):
   * - Create: CreateBudget.
   * - Update: the same CreateBudget. An unchanged definition keeps the name, the budget already
   *   exists and DuplicateRecordException is ignored (no replacement). A changed email or limit
   *   is a new name: the new budget is created and CloudFormation's cleanup Delete removes the
   *   old one by its physical id.
   * - Delete: DeleteBudget of the physical id; NotFoundException is ignored so a budget already
   *   removed by hand or by a failed create does not leave the stack DELETE_FAILED (metagross N1).
   * First deploy: a budget with the same hashed name must not already exist (CreateBudget fails
   * with DuplicateRecordException on Create, which is not ignored).
   */
  private monthlyBudget(operatorEmail: string): cr.AwsCustomResource {
    const budgetName = budgetNameFor(operatorEmail);
    const definition = {
      BudgetName: budgetName,
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: String(MONTHLY_BUDGET_USD), Unit: "USD" },
    };
    const subscribers = [{ SubscriptionType: "EMAIL", Address: operatorEmail }];
    const createBudget: cr.AwsSdkCall = {
      service: "Budgets",
      action: "CreateBudget",
      parameters: {
        AccountId: Aws.ACCOUNT_ID,
        Budget: definition,
        NotificationsWithSubscribers: BUDGET_THRESHOLDS.map(({ type, percent }) => ({
          Notification: {
            NotificationType: type,
            ComparisonOperator: "GREATER_THAN",
            Threshold: percent,
            ThresholdType: "PERCENTAGE",
          },
          Subscribers: subscribers,
        })),
        ResourceTags: [{ Key: PROJECT_TAG_KEY, Value: PROJECT_NAME }],
      },
      physicalResourceId: cr.PhysicalResourceId.of(budgetName),
      logging: cr.Logging.withDataHidden(), // the operator email is in the parameters
    };
    const budgetArn = this.formatArn({
      service: "budgets",
      region: "",
      resource: "budget",
      resourceName: `${BUDGET_NAME}-*`,
    });
    const logGroup = new logs.LogGroup(this, "BudgetProviderLogs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const budget = new cr.AwsCustomResource(this, "MonthlyBudget", {
      resourceType: BUDGET_RESOURCE_TYPE,
      installLatestAwsSdk: false,
      logGroup,
      timeout: Duration.minutes(2),
      onCreate: createBudget,
      onUpdate: { ...createBudget, ignoreErrorCodesMatching: "DuplicateRecordException" },
      onDelete: {
        service: "Budgets",
        action: "DeleteBudget",
        parameters: {
          AccountId: Aws.ACCOUNT_ID,
          BudgetName: new cr.PhysicalResourceIdReference(),
        },
        physicalResourceId: cr.PhysicalResourceId.of(budgetName),
        ignoreErrorCodesMatching: "NotFoundException",
        logging: cr.Logging.withDataHidden(),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          sid: "MonthlyBudgetOnly",
          actions: ["budgets:ModifyBudget", "budgets:ViewBudget", "budgets:TagResource"],
          resources: [budgetArn],
        }),
      ]),
    });
    const budgetPolicy = budget.node.findChild("CustomResourcePolicy") as iam.Policy;
    acknowledgeWildcardResources(
      budgetPolicy,
      () => [budgetPolicy.document],
      (resource) => resource.endsWith(`:budget/${BUDGET_NAME}-*`),
      `The only budgets statement is scoped to budget/${BUDGET_NAME}-*: this stack's own budget, ` +
        "whose name carries a revision hash (budgetNameFor) so an operator-email change replaces it; " +
        "the replacement window needs both the old and the new name. No other budget matches.",
    );

    // The singleton provider Lambda: X-Ray active like every function here (NFR-03, TC-052).
    // The singleton lives at stack scope as "AWS" + the provider UUID without dashes.
    const provider = this.node.findChild(
      `AWS${cr.AwsCustomResource.PROVIDER_FUNCTION_UUID.replace(/-/g, "")}`,
    ) as lambda.Function;
    (provider.node.defaultChild as lambda.CfnFunction).tracingConfig = { mode: "Active" };
    provider.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
        resources: ["*"],
      }),
    );
    Validations.of(provider).acknowledge({
      id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      reason:
        "AwsCustomResource's singleton provider uses AWSLambdaBasicExecutionRole for its own log " +
        "writes; it runs on deploy only and holds no permission beyond the budget statement and X-Ray.",
    });
    Validations.of(provider).acknowledge({
      id: "AwsSolutions-L1",
      reason:
        "The provider runtime is chosen by aws-cdk-lib for AwsCustomResource and moves with CDK upgrades.",
    });
    Validations.of(provider).acknowledge({
      id: "AwsSolutions-IAM5[Resource::*]",
      reason:
        "xray:PutTraceSegments and xray:PutTelemetryRecords support no resource-level permission " +
        "(the service accepts only *); active tracing on the provider (NFR-03).",
    });
    new CfnOutput(this, "BudgetName", {
      value: budgetName,
      description: `AWS Budget of ${MONTHLY_BUDGET_USD} USD per month (80 % actual, 100 % forecast → email)`,
    });
    return budget;
  }
}
