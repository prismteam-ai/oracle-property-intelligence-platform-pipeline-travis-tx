import { join } from 'node:path';
import {
  CfnOutput,
  type CfnResource,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Tags,
} from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  SingleValueWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import {
  CfnStage,
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  type HttpRoute,
  HttpStage,
  LogGroupLogDestination,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  Code,
  DockerImageCode,
  DockerImageFunction,
  Function as LambdaFunction,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter, ParameterTier } from 'aws-cdk-lib/aws-ssm';
import { SubscriptionProtocol, Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription, UrlSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import { type TravisConfig, foundationModelId, limitsJson } from './config.js';
import { LOG_RETENTION, pinLambdaLogGroups } from './logs.js';

export const CHAT_FLAG_PARAM = '/travis/chat/budget-exhausted';
export const DAILY_USAGE_ALARM_NAME = 'travis-chat-daily-usage';
export const DAILY_TOKENS_ALARM_NAME = 'travis-chat-daily-tokens';
export const API_FLAG_PARAM = '/travis/api/budget-exhausted';
export const API_DAILY_USAGE_ALARM_NAME = 'travis-api-daily-usage';
export const METRICS_NAMESPACE = 'TravisPropertyIntelligence';
/** The chat function's runtime name (decisions.md sections 20 and 32): its Powertools service and metrics namespace. */
export const AGENT_NAME = 'staraptor-agent';

export interface TravisApiProps extends StackProps {
  config: TravisConfig;
  /** Docker build context holding Dockerfile, dist/*.mjs and build/db/ (serving file and deploy.json; apps/api by default). */
  imageDirectory: string;
}

/**
 * Runs when a daily-usage alarm fires (via SNS) and sets that alarm's kill switch: `BUDGET_FLAGS` maps alarm name to
 * `{param, metric}`. Node 22 runtime, SDK v3 included.
 */
const BUDGET_FLAG_SETTER = `
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const ssm = new SSMClient({});
exports.handler = async (event) => {
  const flags = JSON.parse(process.env.BUDGET_FLAGS);
  const set = new Map();
  for (const record of event.Records ?? []) {
    let message;
    try { message = JSON.parse(record.Sns.Message); } catch { continue; }
    const flag = flags[message.AlarmName];
    if (flag && message.NewStateValue === 'ALARM') set.set(flag.param, flag.metric);
  }
  for (const [Name, metric] of set) {
    await ssm.send(new PutParameterCommand({ Name, Value: 'true', Type: 'String', Overwrite: true }));
    console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: process.env.METRICS_NAMESPACE, Dimensions: [[]], Metrics: [{ Name: metric, Unit: 'Count' }] }] }, [metric]: 1 }));
  }
  return { set: [...set.keys()] };
};
`;

export class TravisApi extends Stack {
  constructor(scope: Construct, id: string, props: TravisApiProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;
    Tags.of(this).add('project_name', config.projectName);

    // --- Private deploy bucket (captures and deploy inputs live here, never behind CloudFront) ---
    const deployBucket = new Bucket(this, 'DeployBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { id: 'abort-incomplete-multipart', abortIncompleteMultipartUploadAfter: Duration.days(7) },
        { id: 'expire-tmp', prefix: 'tmp/', expiration: Duration.days(30) },
      ],
    });

    // --- One image, two functions ---
    const image = new DockerImageAsset(this, 'Image', {
      directory: props.imageDirectory,
      platform: Platform.LINUX_ARM64,
    });

    // decisions.md section 30: the image carries the serving file; the large tables are Parquet under serving/ in the
    // deploy bucket, read through httpfs with the function role's credentials
    const sharedEnv = {
      DUCKDB_PATH: '/opt/db/serving.duckdb',
      SERVING_BASE: `s3://${deployBucket.bucketName}/serving`,
      DUCKDB_EXTENSION_DIR: '/opt/duckdb_extensions',
      DUCKDB_MEMORY_LIMIT: config.duckdb.memoryLimit,
      DUCKDB_THREADS: String(config.duckdb.threads),
      LIMITS_JSON: limitsJson(config),
      POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE,
    };

    const apiLogs = new LogGroup(this, 'ApiFunctionLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const chatLogs = new LogGroup(this, 'ChatFunctionLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const apiFn = new DockerImageFunction(this, 'ApiFunction', {
      code: DockerImageCode.fromEcr(image.repository, {
        tagOrDigest: image.imageTag,
        cmd: ['api.handler'],
      }),
      architecture: Architecture.ARM_64,
      memorySize: config.memoryMb.api,
      timeout: Duration.seconds(25),
      tracing: Tracing.ACTIVE,
      logGroup: apiLogs,
      environment: { ...sharedEnv, POWERTOOLS_SERVICE_NAME: 'travis-api', API_FLAG_PARAM },
    });

    const chatFn = new DockerImageFunction(this, 'ChatFunction', {
      code: DockerImageCode.fromEcr(image.repository, {
        tagOrDigest: image.imageTag,
        cmd: ['chat.handler'],
      }),
      architecture: Architecture.ARM_64,
      memorySize: config.memoryMb.chat,
      timeout: Duration.seconds(28),
      tracing: Tracing.ACTIVE,
      logGroup: chatLogs,
      reservedConcurrentExecutions:
        config.chatReservedConcurrency > 0 ? config.chatReservedConcurrency : undefined,
      environment: {
        ...sharedEnv,
        POWERTOOLS_SERVICE_NAME: AGENT_NAME,
        POWERTOOLS_METRICS_NAMESPACE: AGENT_NAME,
        CHAT_FLAG_PARAM,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        // the key itself is read from Secrets Manager at run time, never put in the environment (decisions.md section 21)
        LANGSMITH_API_KEY_SECRET_ID: config.langsmithSecretName,
        LANGSMITH_PROJECT: config.langsmithProject,
        LANGSMITH_TRACING: 'true',
      },
    });

    // `cdk synth -c sam-local=1` only (`just sam-local`): the asset metadata SAM's CDK support reads to build the image
    // from cdk.out (decisions.md section 32). The functions take the shared asset through fromEcr, so CDK writes none;
    // the deployed template stays without it.
    if (this.node.tryGetContext('sam-local')) {
      for (const fn of [apiFn, chatFn]) {
        const cfn = fn.node.defaultChild as CfnResource;
        cfn.addMetadata('aws:asset:path', `asset.${image.assetHash}`);
        cfn.addMetadata('aws:asset:dockerfile-path', 'Dockerfile');
        cfn.addMetadata('aws:asset:property', 'Code.ImageUri');
        cfn.addMetadata('SamResourceId', fn === chatFn ? 'ChatFunction' : 'ApiFunction');
      }
    }

    // --- Both functions read the serving set and nothing else in the bucket (no ListBucket: names are exact) ---
    for (const fn of [apiFn, chatFn])
      fn.addToRolePolicy(
        new PolicyStatement({
          sid: 'ReadServingSet',
          effect: Effect.ALLOW,
          actions: ['s3:GetObject'],
          resources: [deployBucket.arnForObjects('serving/*')],
        }),
      );

    // --- Kill switch flags (chat, and the API function's REST and MCP) and IAM for chat (the only Bedrock grant) ---
    const flag = new StringParameter(this, 'ChatBudgetFlag', {
      parameterName: CHAT_FLAG_PARAM,
      stringValue: 'false',
      tier: ParameterTier.STANDARD,
      description:
        'true while the daily chat budget is exhausted; chat answers 503 budget_exhausted',
    });
    const apiFlag = new StringParameter(this, 'ApiBudgetFlag', {
      parameterName: API_FLAG_PARAM,
      stringValue: 'false',
      tier: ParameterTier.STANDARD,
      description:
        'true while the daily API request budget is exhausted; REST and MCP answer 503 budget_exhausted',
    });
    apiFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'ReadBudgetFlag',
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [apiFlag.parameterArn],
      }),
    );

    const modelId = foundationModelId(config);
    chatFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'BedrockInvokeProfileAndFoundationModels',
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:${config.region}:${config.account}:inference-profile/${config.bedrockModelId}`,
          ...config.bedrockRoutingRegions.map(
            (r) => `arn:aws:bedrock:${r}::foundation-model/${modelId}`,
          ),
        ],
      }),
    );
    // The LangSmith key: one secret, created out of band and imported by name (decisions.md section 21)
    chatFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'ReadLangSmithKey',
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:${config.langsmithSecretName}-??????`,
        ],
      }),
    );
    chatFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'ReadBudgetFlag',
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [flag.parameterArn],
      }),
    );

    // --- HTTP API ---
    const api = new HttpApi(this, 'HttpApi', {
      apiName: 'travis-property-intelligence',
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', apiFn),
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['content-type', 'mcp-protocol-version'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        exposeHeaders: ['x-request-id', 'apigw-requestid'],
        allowCredentials: false,
        maxAge: Duration.hours(1),
      },
    });
    const routes: HttpRoute[] = [];
    routes.push(
      ...api.addRoutes({
        path: '/v1/agent/chat',
        methods: [HttpMethod.POST],
        integration: new HttpLambdaIntegration('ChatIntegration', chatFn),
      }),
    );
    routes.push(
      ...api.addRoutes({
        path: '/v1/permits/text-search',
        methods: [HttpMethod.GET],
        integration: new HttpLambdaIntegration('TextSearchIntegration', apiFn),
      }),
    );
    routes.push(
      ...api.addRoutes({
        path: '/v1/mcp',
        methods: [HttpMethod.POST],
        integration: new HttpLambdaIntegration('McpIntegration', apiFn),
      }),
    );

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const stage = new HttpStage(this, 'DefaultStage', {
      httpApi: api,
      autoDeploy: true,
      throttle: { rateLimit: config.throttle.stage.rate, burstLimit: config.throttle.stage.burst },
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            requestTime: '$context.requestTime',
            routeKey: '$context.routeKey',
            httpMethod: '$context.httpMethod',
            path: '$context.path',
            status: '$context.status',
            responseLatency: '$context.responseLatency',
            integrationLatency: '$context.integrationLatency',
            integrationStatus: '$context.integrationStatus',
            integrationErrorMessage: '$context.integrationErrorMessage',
            errorMessage: '$context.error.message',
          }),
        ),
      },
    });
    const routeSettings: Record<string, Record<string, unknown>> = {};
    for (const [routeKey, limit] of Object.entries(config.throttle.routes)) {
      routeSettings[routeKey] = {
        ThrottlingRateLimit: limit.rate,
        ThrottlingBurstLimit: limit.burst,
        DetailedMetricsEnabled: true,
      };
    }
    (stage.node.defaultChild as CfnStage).routeSettings = routeSettings;
    // RouteSettings name routes by key; CloudFormation rejects the stage if they do not exist yet.
    for (const route of routes) stage.node.addDependency(route);

    // --- Alerting: one topic, email and (when configured) PagerDuty ---
    const topic = new Topic(this, 'AlarmTopic', {
      displayName: 'Travis property intelligence alarms',
    });
    for (const email of config.alarmEmails) topic.addSubscription(new EmailSubscription(email));
    if (config.pagerDutyUrlParam)
      topic.addSubscription(
        new UrlSubscription(
          StringParameter.valueForStringParameter(this, config.pagerDutyUrlParam),
          { protocol: SubscriptionProtocol.HTTPS },
        ),
      );
    const alarmAction = new SnsAction(topic);

    const flagWriterLogs = new LogGroup(this, 'BudgetFlagSetterLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const flagSetter = new LambdaFunction(this, 'BudgetFlagSetter', {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromInline(BUDGET_FLAG_SETTER),
      timeout: Duration.seconds(10),
      logGroup: flagWriterLogs,
      environment: {
        BUDGET_FLAGS: JSON.stringify({
          [DAILY_USAGE_ALARM_NAME]: { param: CHAT_FLAG_PARAM, metric: 'ChatBudgetFlagSet' },
          [DAILY_TOKENS_ALARM_NAME]: { param: CHAT_FLAG_PARAM, metric: 'ChatBudgetFlagSet' },
          [API_DAILY_USAGE_ALARM_NAME]: { param: API_FLAG_PARAM, metric: 'ApiBudgetFlagSet' },
        }),
        METRICS_NAMESPACE,
      },
    });
    flagSetter.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:PutParameter'],
        resources: [flag.parameterArn, apiFlag.parameterArn],
      }),
    );
    flagSetter.addEventSource(new SnsEventSource(topic));

    const schedulerRole = new Role(this, 'FlagClearSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:PutParameter'],
        resources: [flag.parameterArn, apiFlag.parameterArn],
      }),
    );
    for (const [id, what, name] of [
      ['ClearBudgetFlagDaily', 'chat', CHAT_FLAG_PARAM],
      ['ClearApiBudgetFlagDaily', 'API', API_FLAG_PARAM],
    ] as const)
      new CfnSchedule(this, id, {
        description: `Clears the ${what} budget kill switch at 00:00 UTC`,
        scheduleExpression: 'cron(0 0 * * ? *)',
        scheduleExpressionTimezone: 'UTC',
        flexibleTimeWindow: { mode: 'OFF' },
        target: {
          arn: 'arn:aws:scheduler:::aws-sdk:ssm:putParameter',
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ Name: name, Value: 'false', Type: 'String', Overwrite: true }),
        },
      });

    // No standing warm-up schedule (decisions.md section 31): the README rules out ongoing cost by default, so
    // instances are warmed by `just warm` after a deploy and by the clients' prewarm when a person opens them.

    // --- Alarms (10 of the 10 allowed; all self-resolving) ---
    const five = Duration.minutes(5);
    const mk = (id: string, alarm: ConstructorParameters<typeof Alarm>[2]) => {
      const a = new Alarm(this, id, { treatMissingData: TreatMissingData.NOT_BREACHING, ...alarm });
      a.addAlarmAction(alarmAction);
      a.addOkAction(alarmAction);
      return a;
    };
    const stage5xx = new Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: api.apiId, Stage: '$default' },
      statistic: 'Sum',
      period: five,
    });
    mk('Stage5xxAlarm', {
      metric: stage5xx,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    for (const [label, fn] of [
      ['Api', apiFn],
      ['Chat', chatFn],
    ] as const) {
      mk(`${label}ErrorsAlarm`, {
        metric: fn.metricErrors({ period: five }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
      mk(`${label}ThrottlesAlarm`, {
        metric: fn.metricThrottles({ period: five }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
    }
    mk('ChatErrorRateAlarm', {
      metric: new MathExpression({
        expression: 'IF(invocations > 0, 100 * errors / invocations, 0)',
        usingMetrics: {
          errors: chatFn.metricErrors({ period: five }),
          invocations: chatFn.metricInvocations({ period: five }),
        },
        period: five,
      }),
      threshold: 20,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    mk('ChatDailyUsageAlarm', {
      alarmName: DAILY_USAGE_ALARM_NAME,
      alarmDescription: 'Chat invocations in a UTC day; sets the budget kill switch through SNS',
      metric: chatFn.metricInvocations({ period: Duration.days(1), statistic: 'Sum' }),
      threshold: config.dailyChatRequestLimit,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    mk('ApiDailyUsageAlarm', {
      alarmName: API_DAILY_USAGE_ALARM_NAME,
      alarmDescription:
        'API function (REST and MCP) invocations in a UTC day; sets its budget kill switch through SNS',
      metric: apiFn.metricInvocations({ period: Duration.days(1), statistic: 'Sum' }),
      threshold: config.dailyApiRequestLimit,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    const chatMetric = (metricName: string, statistic = 'Sum', period = Duration.days(1)) =>
      new Metric({
        namespace: AGENT_NAME,
        metricName,
        dimensionsMap: { service: AGENT_NAME, operation: 'agentChat' },
        statistic,
        period,
      });
    mk('ChatDailyTokensAlarm', {
      alarmName: DAILY_TOKENS_ALARM_NAME,
      alarmDescription:
        'Bedrock input plus output tokens of chat in a UTC day; sets the budget kill switch through SNS',
      metric: new MathExpression({
        expression: 'input + output',
        usingMetrics: {
          input: chatMetric('ChatInputTokens'),
          output: chatMetric('ChatOutputTokens'),
        },
        period: Duration.days(1),
      }),
      threshold: config.dailyChatTokenLimit,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    const flagSetMetric = (metricName: string) =>
      new Metric({
        namespace: METRICS_NAMESPACE,
        metricName,
        statistic: 'Sum',
        period: Duration.hours(1),
      });
    mk('BudgetFlagSetAlarm', {
      alarmDescription:
        'A budget kill switch (chat or API) was set; clears itself an hour later, the flags at 00:00 UTC',
      metric: new MathExpression({
        expression: 'chat + api',
        usingMetrics: {
          chat: flagSetMetric('ChatBudgetFlagSet'),
          api: flagSetMetric('ApiBudgetFlagSet'),
        },
        period: Duration.hours(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // --- Dashboard ---
    const apiMetric = (name: string, statistic = 'Sum') =>
      new Metric({
        namespace: 'AWS/ApiGateway',
        metricName: name,
        dimensionsMap: { ApiId: api.apiId, Stage: '$default' },
        statistic,
        period: five,
      });
    new Dashboard(this, 'Dashboard', {
      dashboardName: 'travis-property-intelligence',
      widgets: [
        [
          new GraphWidget({
            title: 'Requests, 4xx, 5xx',
            left: [apiMetric('Count'), apiMetric('4xx'), apiMetric('5xx')],
            width: 12,
          }),
          new GraphWidget({
            title: 'API latency (p95 ms)',
            left: [apiMetric('Latency', 'p95'), apiMetric('IntegrationLatency', 'p95')],
            width: 12,
          }),
        ],
        [
          new GraphWidget({
            title: 'Invocations',
            left: [
              apiFn.metricInvocations({ period: five }),
              chatFn.metricInvocations({ period: five }),
            ],
            width: 8,
          }),
          new GraphWidget({
            title: 'Errors and throttles',
            left: [
              apiFn.metricErrors({ period: five }),
              chatFn.metricErrors({ period: five }),
              apiFn.metricThrottles({ period: five }),
              chatFn.metricThrottles({ period: five }),
            ],
            width: 8,
          }),
          new GraphWidget({
            title: 'Duration (p95 ms)',
            left: [
              apiFn.metricDuration({ period: five, statistic: 'p95' }),
              chatFn.metricDuration({ period: five, statistic: 'p95' }),
            ],
            width: 8,
          }),
        ],
        [
          new GraphWidget({
            title: 'Chat turn latency (p50, p95 ms)',
            left: [
              chatMetric('ChatTurnLatency', 'p50', five),
              chatMetric('ChatTurnLatency', 'p95', five),
            ],
            width: 8,
          }),
          new GraphWidget({
            title: 'Chat tokens (input, output, cache read)',
            left: [
              chatMetric('ChatInputTokens', 'Sum', five),
              chatMetric('ChatOutputTokens', 'Sum', five),
              chatMetric('ChatCacheReadTokens', 'Sum', five),
            ],
            width: 8,
          }),
          new GraphWidget({
            title: 'Chat deadline hits, citation failures, Bedrock throttles and denials',
            left: [
              chatMetric('ChatDeadlineHits', 'Sum', five),
              chatMetric('ChatCitationFailures', 'Sum', five),
              chatMetric('BedrockThrottles', 'Sum', five),
              chatMetric('BedrockDenials', 'Sum', five),
            ],
            width: 8,
          }),
        ],
        [
          new SingleValueWidget({
            title: 'Chat invocations today (limit ' + config.dailyChatRequestLimit + ')',
            metrics: [chatFn.metricInvocations({ period: Duration.days(1) })],
            width: 8,
          }),
          new SingleValueWidget({
            title: 'API invocations today (limit ' + config.dailyApiRequestLimit + ')',
            metrics: [apiFn.metricInvocations({ period: Duration.days(1) })],
            width: 8,
          }),
          new SingleValueWidget({
            title: 'Budget flag set events (last hour)',
            metrics: [flagSetMetric('ChatBudgetFlagSet'), flagSetMetric('ApiBudgetFlagSet')],
            width: 8,
          }),
        ],
      ],
    });

    // --- Outputs ---
    new CfnOutput(this, 'ApiBase', {
      value: api.apiEndpoint,
      description: 'API_BASE: the $default execute-api URL',
    });
    new CfnOutput(this, 'ApiFunctionName', { value: apiFn.functionName });
    new CfnOutput(this, 'ChatFunctionName', { value: chatFn.functionName });
    new CfnOutput(this, 'DeployBucketName', { value: deployBucket.bucketName });
    new CfnOutput(this, 'AccessLogGroupName', { value: accessLogs.logGroupName });
    new CfnOutput(this, 'ApiLogGroupName', { value: apiLogs.logGroupName });
    new CfnOutput(this, 'ChatLogGroupName', { value: chatLogs.logGroupName });

    pinLambdaLogGroups(this);
  }
}

export const defaultImageDirectory = (cdkDir: string): string => join(cdkDir, '..');
