import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { TravisApi } from '../lib/api-stack.js';
import { parseConfig } from '../lib/config.js';
import { SPA_ROUTER_CODE, TravisWeb } from '../lib/web-stack.js';
import example from '../config.example.json' with { type: 'json' };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const config = parseConfig({ ...example, chatReservedConcurrency: 3 });
const SECRET_ARN = `arn:aws:secretsmanager:us-east-2:${config.account}:secret:staraptor-agent/langsmith-api-key-??????`;
const env = { account: config.account, region: config.region };

function fixtureDirs() {
  const root = mkdtempSync(join(tmpdir(), 'travis-cdk-'));
  const image = join(root, 'image');
  const dist = join(root, 'dist');
  mkdirSync(image);
  mkdirSync(dist);
  writeFileSync(join(image, 'Dockerfile'), 'FROM scratch\n');
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  return { image, dist };
}

let api: Template;
let web: Template;
let unreserved: Template;

beforeAll(() => {
  const dirs = fixtureDirs();
  api = Template.fromStack(
    new TravisApi(new App(), 'TravisApi', { env, config, imageDirectory: dirs.image }),
  );
  web = Template.fromStack(
    new TravisWeb(new App(), 'TravisWeb', { env, config, explorerDistDirectory: dirs.dist }),
  );
  const app2 = new App();
  unreserved = Template.fromStack(
    new TravisApi(app2, 'TravisApi', {
      env,
      config: parseConfig({ ...example, chatReservedConcurrency: 0 }),
      imageDirectory: dirs.image,
    }),
  );
});

/** All IAM statements attached to the role of the function whose logical id starts with `prefix`. */
function statementsFor(t: Template, prefix: string): { actions: string[]; resources: unknown[] }[] {
  const fns = t.findResources('AWS::Lambda::Function');
  const id = Object.keys(fns).find((k) => k.startsWith(prefix));
  if (!id) throw new Error(`function ${prefix} not found`);
  const roleRef = (fns[id] as Json).Properties.Role['Fn::GetAtt'][0] as string;
  const out: { actions: string[]; resources: unknown[] }[] = [];
  for (const policy of Object.values(t.findResources('AWS::IAM::Policy')) as Json[]) {
    if (!JSON.stringify(policy.Properties.Roles).includes(roleRef)) continue;
    for (const s of policy.Properties.PolicyDocument.Statement as Json[]) {
      out.push({
        actions: ([] as string[]).concat(s.Action),
        resources: ([] as unknown[]).concat(s.Resource),
      });
    }
  }
  return out;
}

const allActions = (s: { actions: string[] }[]) => s.flatMap((x) => x.actions);

describe('TravisApi stack', () => {
  it('has fixed name, termination protection and the project_name tag', () => {
    const app = new App();
    const d = fixtureDirs();
    const stack = new TravisApi(app, 'TravisApi', { env, config, imageDirectory: d.image });
    expect(stack.terminationProtection).toBe(true);
    expect(stack.region).toBe('us-east-2');
  });

  it('runs both functions on arm64 from the same image with distinct CMDs', () => {
    const fns = Object.values(api.findResources('AWS::Lambda::Function')) as Json[];
    const images = fns.filter((f) => f.Properties.PackageType === 'Image');
    expect(images).toHaveLength(2);
    for (const f of images) expect(f.Properties.Architectures).toEqual(['arm64']);
    expect(images.map((f) => f.Properties.ImageConfig.Command[0]).sort()).toEqual([
      'api.handler',
      'chat.handler',
    ]);
    expect(new Set(images.map((f) => JSON.stringify(f.Properties.Code.ImageUri))).size).toBe(1);
    expect(
      Object.keys(api.toJSON().Resources).filter(
        (k) => k.includes('Image') && !k.includes('Function'),
      ),
    ).toBeDefined();
  });

  it('gives chat a 28 s timeout, the reservation when R > 0, and none when 0', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ POWERTOOLS_SERVICE_NAME: 'staraptor-agent' }) },
      Timeout: 28,
      ReservedConcurrentExecutions: 3,
    });
    const chat = Object.values(unreserved.findResources('AWS::Lambda::Function')).find(
      (f) =>
        (f as Json).Properties.Environment?.Variables?.POWERTOOLS_SERVICE_NAME ===
        'staraptor-agent',
    ) as Json;
    expect(chat.Properties).not.toHaveProperty('ReservedConcurrentExecutions');
  });

  it('sets the interface environment variables', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DUCKDB_PATH: '/opt/db/serving.duckdb',
          SERVING_BASE: {
            'Fn::Join': [
              '',
              ['s3://', { Ref: Match.stringLikeRegexp('^DeployBucket') }, '/serving'],
            ],
          },
          DUCKDB_EXTENSION_DIR: '/opt/duckdb_extensions',
          DUCKDB_MEMORY_LIMIT: '2GB',
          DUCKDB_THREADS: '4',
          POWERTOOLS_SERVICE_NAME: 'travis-api',
          POWERTOOLS_METRICS_NAMESPACE: 'TravisPropertyIntelligence',
          API_FLAG_PARAM: '/travis/api/budget-exhausted',
          LIMITS_JSON: Match.stringLikeRegexp('agent/chat'),
        }),
      },
    });
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CHAT_FLAG_PARAM: '/travis/chat/budget-exhausted',
          BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
          POWERTOOLS_SERVICE_NAME: 'staraptor-agent',
          POWERTOOLS_METRICS_NAMESPACE: 'staraptor-agent',
          LANGSMITH_PROJECT: 'staraptor-agent',
          LANGSMITH_TRACING: 'true',
          LANGSMITH_API_KEY_SECRET_ID: 'staraptor-agent/langsmith-api-key',
        }),
      },
    });
  });

  describe('IAM', () => {
    /** decisions.md section 30: s3:GetObject on the deploy bucket's serving/ prefix, nothing else in S3. */
    const expectServingGrantOnly = (s: ReturnType<typeof statementsFor>) => {
      const s3 = s.filter((x) => x.actions.some((a) => a.startsWith('s3:')));
      expect(s3).toHaveLength(1);
      expect(s3[0]!.actions).toEqual(['s3:GetObject']);
      expect(s3[0]!.resources).toHaveLength(1);
      const r = JSON.stringify(s3[0]!.resources);
      expect(r).toContain('DeployBucket');
      expect(r).toContain('/serving/*');
    };

    it('api function: logs, X-Ray, the serving set and its kill-switch flag only', () => {
      const s = statementsFor(api, 'ApiFunction');
      const actions = allActions(s);
      expect(actions.sort()).toEqual(
        expect.arrayContaining(['xray:PutTraceSegments', 'xray:PutTelemetryRecords']),
      );
      for (const a of actions) expect(a).toMatch(/^(xray:|ecr:|logs:|s3:|ssm:GetParameter$)/);
      expectServingGrantOnly(s);
      const role = Object.values(api.findResources('AWS::IAM::Role')).find((r) =>
        JSON.stringify((r as Json).Properties.ManagedPolicyArns ?? '').includes(
          'AWSLambdaBasicExecutionRole',
        ),
      );
      expect(role).toBeDefined();
      const flat = JSON.stringify(s);
      for (const denied of ['bedrock', 'ssm:PutParameter', 'aws-marketplace', 'secretsmanager']) {
        expect(flat).not.toContain(denied);
      }
    });

    it('chat function: Bedrock invoke on the profile and foundation-model ARNs, ssm:GetParameter on the flag, the serving set', () => {
      const s = statementsFor(api, 'ChatFunction');
      expectServingGrantOnly(s);
      const bedrock = s.find((x) => x.actions.some((a) => a.startsWith('bedrock:')))!;
      expect(bedrock.actions.sort()).toEqual([
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ]);
      expect(bedrock.resources).toEqual([
        `arn:aws:bedrock:us-east-2:${config.account}:inference-profile/us.anthropic.claude-sonnet-4-6`,
        'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6',
        'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-6',
        'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-6',
      ]);
      const ssm = s.find((x) => x.actions.includes('ssm:GetParameter'))!;
      expect(ssm.actions).toEqual(['ssm:GetParameter']);
      expect(JSON.stringify(ssm.resources)).toContain('ChatBudgetFlag');
      const secret = s.filter((x) => x.actions.some((a) => a.startsWith('secretsmanager:')));
      expect(secret).toEqual([
        { actions: ['secretsmanager:GetSecretValue'], resources: [SECRET_ARN] },
      ]);
      // exactly these grants: Bedrock invoke, the one secret, the flag, the serving set, X-Ray (and the basic logs role)
      for (const a of allActions(s))
        expect(a).toMatch(
          /^(bedrock:Invoke|secretsmanager:GetSecretValue$|ssm:GetParameter$|s3:GetObject$|xray:|ecr:|logs:)/,
        );
      const flat = JSON.stringify(s);
      for (const denied of ['aws-marketplace', 'ssm:PutParameter', 'bedrock:*']) {
        expect(flat).not.toContain(denied);
      }
      // only X-Ray's statement has a wildcard resource (its actions take none)
      for (const x of s.filter((y) => y.resources.includes('*')))
        for (const a of x.actions) expect(a).toMatch(/^xray:/);
    });

    it('derives the foundation-model ARNs of an Opus 4.6 profile (its id ends in -v1)', () => {
      const t = Template.fromStack(
        new TravisApi(new App(), 'TravisApi', {
          env,
          config: parseConfig({ ...example, bedrockModelId: 'us.anthropic.claude-opus-4-6-v1' }),
          imageDirectory: fixtureDirs().image,
        }),
      );
      const bedrock = statementsFor(t, 'ChatFunction').find((x) =>
        x.actions.some((a) => a.startsWith('bedrock:')),
      )!;
      expect(bedrock.resources).toEqual([
        `arn:aws:bedrock:us-east-2:${config.account}:inference-profile/us.anthropic.claude-opus-4-6-v1`,
        'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-opus-4-6-v1',
        'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-opus-4-6-v1',
        'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-opus-4-6-v1',
      ]);
    });

    it('flag writer: ssm:PutParameter on the two flags only', () => {
      const s = statementsFor(api, 'BudgetFlagSetter');
      const put = s.find((x) => x.actions.includes('ssm:PutParameter'))!;
      expect(put.actions).toEqual(['ssm:PutParameter']);
      expect(JSON.stringify(put.resources)).toContain('ChatBudgetFlag');
      expect(JSON.stringify(put.resources)).toContain('ApiBudgetFlag');
      expect(JSON.stringify(s)).not.toContain('bedrock');
    });

    it('no policy in either stack mentions aws-marketplace', () => {
      expect(JSON.stringify(api.toJSON())).not.toContain('aws-marketplace');
      expect(JSON.stringify(web.toJSON())).not.toContain('aws-marketplace');
    });

    it('stores the flags as standard SSM parameters', () => {
      for (const Name of ['/travis/chat/budget-exhausted', '/travis/api/budget-exhausted'])
        api.hasResourceProperties('AWS::SSM::Parameter', {
          Name,
          Type: 'String',
          Tier: 'Standard',
          Value: 'false',
        });
    });

    it('API function: ssm:GetParameter on its own flag only', () => {
      const s = statementsFor(api, 'ApiFunction');
      const ssm = s.find((x) => x.actions.includes('ssm:GetParameter'))!;
      expect(ssm.actions).toEqual(['ssm:GetParameter']);
      expect(JSON.stringify(ssm.resources)).toContain('ApiBudgetFlag');
      expect(JSON.stringify(ssm.resources)).not.toContain('ChatBudgetFlag');
    });
  });

  describe('HTTP API', () => {
    it('has the four routes with the right integrations', () => {
      const routes = Object.values(api.findResources('AWS::ApiGatewayV2::Route')) as Json[];
      expect(routes.map((r) => r.Properties.RouteKey).sort()).toEqual([
        '$default',
        'GET /v1/permits/text-search',
        'POST /v1/agent/chat',
        'POST /v1/mcp',
      ]);
      const integrations = api.findResources('AWS::ApiGatewayV2::Integration');
      const target = (key: string) => {
        const route = routes.find((r) => r.Properties.RouteKey === key)!;
        const ref = (route.Properties.Target['Fn::Join'][1] as unknown[]).find(
          (p) => typeof p === 'object' && p !== null && 'Ref' in p,
        ) as { Ref: string };
        const integ = integrations[ref.Ref] as Json;
        return JSON.stringify(integ.Properties.IntegrationUri);
      };
      expect(target('POST /v1/agent/chat')).toContain('ChatFunction');
      expect(target('$default')).toContain('ApiFunction');
      expect(target('GET /v1/permits/text-search')).toContain('ApiFunction');
      expect(target('POST /v1/mcp')).toContain('ApiFunction');
    });

    it('sets CORS on the API per the contract', () => {
      api.hasResourceProperties('AWS::ApiGatewayV2::Api', {
        CorsConfiguration: {
          AllowOrigins: ['*'],
          AllowHeaders: ['content-type', 'mcp-protocol-version'],
          AllowMethods: ['GET', 'POST', 'OPTIONS'],
          ExposeHeaders: ['x-request-id', 'apigw-requestid'],
          AllowCredentials: false,
        },
      });
    });

    it('applies stage and per-route throttles from the config', () => {
      api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        StageName: '$default',
        AutoDeploy: true,
        DefaultRouteSettings: Match.objectLike({
          ThrottlingRateLimit: 20,
          ThrottlingBurstLimit: 40,
        }),
        RouteSettings: {
          'POST /v1/agent/chat': Match.objectLike({
            ThrottlingRateLimit: 0.4,
            ThrottlingBurstLimit: 5,
          }),
          'GET /v1/permits/text-search': Match.objectLike({
            ThrottlingRateLimit: 5,
            ThrottlingBurstLimit: 10,
          }),
        },
      });
    });

    it('creates every throttled route before the stage that names it', () => {
      const routes = api.findResources('AWS::ApiGatewayV2::Route') as Record<string, Json>;
      const [stage] = Object.values(api.findResources('AWS::ApiGatewayV2::Stage')) as Json[];
      const dependsOn = (stage!.DependsOn ?? []) as string[];
      for (const key of Object.keys(stage!.Properties.RouteSettings)) {
        const id = Object.keys(routes).find((k) => routes[k]!.Properties.RouteKey === key);
        expect(id, key).toBeDefined();
        expect(dependsOn, key).toContain(id);
      }
    });

    it('writes access logs with the required fields', () => {
      api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
        AccessLogSettings: {
          Format: Match.stringLikeRegexp('requestId.*routeKey.*status.*integrationErrorMessage'),
        },
      });
    });
  });

  it('keeps 90 days on every log group and points every function at one', () => {
    const groups = Object.values(api.findResources('AWS::Logs::LogGroup')) as Json[];
    expect(groups.length).toBeGreaterThanOrEqual(5);
    for (const g of groups) {
      expect(g.Properties.RetentionInDays).toBe(90);
      expect(g.DeletionPolicy).toBe('Delete');
    }
    for (const f of Object.values(api.findResources('AWS::Lambda::Function')) as Json[]) {
      expect(f.Properties.LoggingConfig?.LogGroup).toBeDefined();
    }
  });

  describe('alarms and kill switch', () => {
    it('has at most ten alarms, all notifying the one email-only topic and self-resolving', () => {
      const alarms = Object.values(api.findResources('AWS::CloudWatch::Alarm')) as Json[];
      expect(alarms.length).toBeLessThanOrEqual(10);
      expect(alarms.length).toBe(10);
      for (const a of alarms) {
        expect(a.Properties.AlarmActions).toHaveLength(1);
        expect(a.Properties.OKActions).toHaveLength(1);
        expect(a.Properties.TreatMissingData).toBe('notBreaching');
      }
      const topics = api.findResources('AWS::SNS::Topic');
      expect(Object.keys(topics)).toHaveLength(1);
      const subs = Object.values(api.findResources('AWS::SNS::Subscription')) as Json[];
      expect(subs.filter((s) => s.Properties.Protocol === 'email')).toHaveLength(
        config.alarmEmails.length,
      );
      expect(subs.filter((s) => s.Properties.Protocol === 'https')).toHaveLength(0);
    });

    it('subscribes the PagerDuty integration URL from SSM over HTTPS when configured', () => {
      const t = Template.fromStack(
        new TravisApi(new App(), 'TravisApi', {
          env,
          config: parseConfig({
            ...example,
            pagerDutyUrlParam: '/roofing-crm/pagerduty/integration-url',
          }),
          imageDirectory: fixtureDirs().image,
        }),
      );
      const https = (Object.values(t.findResources('AWS::SNS::Subscription')) as Json[]).filter(
        (s) => s.Properties.Protocol === 'https',
      );
      expect(https).toHaveLength(1);
      const params = t.toJSON().Parameters as Record<string, { Type: string; Default: string }>;
      expect(
        Object.values(params).some(
          (p) =>
            p.Type === 'AWS::SSM::Parameter::Value<String>' &&
            p.Default === '/roofing-crm/pagerduty/integration-url',
        ),
      ).toBe(true);
    });

    it('daily usage alarm uses a one-day sum of chat invocations at the configured limit', () => {
      api.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'travis-chat-daily-usage',
        MetricName: 'Invocations',
        Period: 86400,
        Statistic: 'Sum',
        Threshold: config.dailyChatRequestLimit,
      });
    });

    it("daily token alarm sums the agent's input and output tokens and also sets the kill switch", () => {
      const alarm = Object.values(api.findResources('AWS::CloudWatch::Alarm')).find(
        (a) => (a as Json).Properties.AlarmName === 'travis-chat-daily-tokens',
      ) as Json;
      expect(alarm.Properties.Threshold).toBe(config.dailyChatTokenLimit);
      const metrics = alarm.Properties.Metrics as Json[];
      expect(metrics.find((m) => m.Expression)?.Expression).toBe('input + output');
      const names = metrics
        .filter((m) => m.MetricStat)
        .map((m) => m.MetricStat.Metric.MetricName)
        .sort();
      expect(names).toEqual(['ChatInputTokens', 'ChatOutputTokens']);
      for (const m of metrics.filter((x) => x.MetricStat)) {
        expect(m.MetricStat.Metric.Namespace).toBe('staraptor-agent');
        expect(m.MetricStat.Period).toBe(86400);
      }
      const setter = Object.values(api.findResources('AWS::Lambda::Function')).find(
        (f) => (f as Json).Properties.Environment?.Variables?.BUDGET_FLAGS,
      ) as Json;
      expect(JSON.parse(setter.Properties.Environment.Variables.BUDGET_FLAGS)).toEqual({
        'travis-chat-daily-usage': {
          param: '/travis/chat/budget-exhausted',
          metric: 'ChatBudgetFlagSet',
        },
        'travis-chat-daily-tokens': {
          param: '/travis/chat/budget-exhausted',
          metric: 'ChatBudgetFlagSet',
        },
        'travis-api-daily-usage': {
          param: '/travis/api/budget-exhausted',
          metric: 'ApiBudgetFlagSet',
        },
      });
    });

    it('API daily usage alarm uses a one-day sum of API invocations at the configured limit', () => {
      api.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'travis-api-daily-usage',
        MetricName: 'Invocations',
        Period: 86400,
        Statistic: 'Sum',
        Threshold: config.dailyApiRequestLimit,
      });
    });

    it('sets the flag through SNS and clears it daily through EventBridge Scheduler', () => {
      api.hasResourceProperties('AWS::Lambda::Permission', { Principal: 'sns.amazonaws.com' });
      api.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(0 0 * * ? *)',
        ScheduleExpressionTimezone: 'UTC',
        Target: Match.objectLike({
          Arn: 'arn:aws:scheduler:::aws-sdk:ssm:putParameter',
          Input: Match.stringLikeRegexp('budget-exhausted'),
        }),
      });
    });

    it('has no standing schedule but the daily flag clears (no warm-up pings; decisions.md section 31)', () => {
      const schedules = Object.keys(api.findResources('AWS::Scheduler::Schedule')).sort();
      expect(schedules).toHaveLength(2);
      expect(schedules[0]).toMatch(/^ClearApiBudgetFlagDaily/);
      expect(schedules[1]).toMatch(/^ClearBudgetFlagDaily/);
    });

    it('does not use reserved concurrency zero as the kill switch', () => {
      for (const f of Object.values(unreserved.findResources('AWS::Lambda::Function')) as Json[]) {
        expect(f.Properties.ReservedConcurrentExecutions).not.toBe(0);
      }
    });
  });

  it('has a private deploy bucket', () => {
    expectPrivateBuckets(api, 1);
  });

  it('has one dashboard and the required outputs', () => {
    api.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    const outputs = Object.keys(api.toJSON().Outputs);
    expect(outputs).toEqual(
      expect.arrayContaining([
        'ApiBase',
        'ApiFunctionName',
        'ChatFunctionName',
        'DeployBucketName',
      ]),
    );
  });
});

function expectPrivateBuckets(t: Template, count: number) {
  const buckets = Object.entries(t.findResources('AWS::S3::Bucket')).filter(
    ([k]) => !k.includes('Custom'),
  );
  expect(buckets).toHaveLength(count);
  for (const [, b] of buckets as [string, Json][]) {
    expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(
      b.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]
        .ServerSideEncryptionByDefault,
    ).toEqual({
      SSEAlgorithm: 'AES256',
    });
    expect(b.DeletionPolicy).toBe('Delete');
  }
  const policies = Object.values(t.findResources('AWS::S3::BucketPolicy')) as Json[];
  expect(policies).toHaveLength(count);
  for (const p of policies) {
    const denyTls = (p.Properties.PolicyDocument.Statement as Json[]).find(
      (s) => s.Effect === 'Deny' && s.Condition?.Bool?.['aws:SecureTransport'] === 'false',
    );
    expect(denyTls).toBeDefined();
  }
}

describe('TravisWeb stack', () => {
  it('has fixed name, termination protection and the project_name tag', () => {
    const app = new App();
    const d = fixtureDirs();
    const stack = new TravisWeb(app, 'TravisWeb', { env, config, explorerDistDirectory: d.dist });
    expect(stack.terminationProtection).toBe(true);
  });

  it('has an explorer bucket and a mirror bucket, both private', () => {
    expectPrivateBuckets(web, 2);
    web.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
  });

  it('serves /tables/* from the mirror with GET/HEAD/OPTIONS, no compression and immutable caching', () => {
    const dist = Object.values(web.findResources('AWS::CloudFront::Distribution'))[0] as Json;
    const cfg = dist.Properties.DistributionConfig;
    const behavior = (cfg.CacheBehaviors as Json[]).find((b) => b.PathPattern === '/tables/*')!;
    expect(behavior.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS']);
    expect(behavior.Compress).toBe(false);
    expect(behavior.TargetOriginId).not.toBe(cfg.DefaultCacheBehavior.TargetOriginId);
    expect(behavior.FunctionAssociations).toBeUndefined();
    expect(cfg.CustomErrorResponses).toBeUndefined();
    expect(cfg.DefaultCacheBehavior.FunctionAssociations).toHaveLength(1);
    expect(cfg.DefaultCacheBehavior.FunctionAssociations[0].EventType).toBe('viewer-request');
    web.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        MinTTL: 31536000,
        DefaultTTL: 31536000,
        MaxTTL: 31536000,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          EnableAcceptEncodingGzip: false,
          EnableAcceptEncodingBrotli: false,
        }),
      }),
    });
  });

  it('allows Range from any origin and exposes the range headers on /tables/*', () => {
    web.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: {
          AccessControlAllowOrigins: { Items: ['*'] },
          AccessControlAllowHeaders: { Items: Match.arrayWith(['Range']) },
          AccessControlAllowMethods: { Items: ['GET', 'HEAD', 'OPTIONS'] },
          AccessControlExposeHeaders: {
            Items: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
          },
          AccessControlAllowCredentials: false,
          OriginOverride: true,
          AccessControlMaxAgeSec: 86400,
        },
        CustomHeadersConfig: {
          Items: [
            Match.objectLike({
              Header: 'Cache-Control',
              Value: Match.stringLikeRegexp('immutable'),
            }),
          ],
        },
      }),
    });
  });

  it('routes the single-page app with a viewer-request function that leaves /tables/* alone', () => {
    web.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
    });
    const run = new Function(`${SPA_ROUTER_CODE}; return handler;`)() as (e: unknown) => {
      uri: string;
    };
    expect(run({ request: { uri: '/search/roofs' } }).uri).toBe('/index.html');
    expect(run({ request: { uri: '/' } }).uri).toBe('/index.html');
    expect(run({ request: { uri: '/assets/app-1a2b.js' } }).uri).toBe('/assets/app-1a2b.js');
    expect(run({ request: { uri: '/tables/bafy/address/part-00000.parquet' } }).uri).toBe(
      '/tables/bafy/address/part-00000.parquet',
    );
    expect(run({ request: { uri: '/tables/bafy/missing' } }).uri).toBe('/tables/bafy/missing');
  });

  it('deploys the explorer invalidating only /index.html and serves .wasm as application/wasm', () => {
    const deployments = Object.values(web.findResources('Custom::CDKBucketDeployment')) as Json[];
    expect(deployments).toHaveLength(2);
    const main = deployments.find((d) => d.Properties.DistributionId)!;
    expect(main.Properties.DistributionPaths).toEqual(['/index.html']);
    const wasm = deployments.find((d) => !d.Properties.DistributionId)!;
    expect(wasm.Properties.SystemMetadata['content-type']).toBe('application/wasm');
    expect(wasm.Properties.Exclude).toEqual(['*']);
    expect(wasm.Properties.Include).toEqual(['*.wasm']);
    expect(wasm.Properties.Prune).toBe(false);
  });

  it('does not fill the mirror by deployment and exposes the outputs', () => {
    const deployments = Object.values(web.findResources('Custom::CDKBucketDeployment')) as Json[];
    for (const d of deployments) {
      expect(JSON.stringify(d.Properties.DestinationBucketName)).toContain('ExplorerStore');
    }
    expect(Object.keys(web.toJSON().Outputs)).toEqual(
      expect.arrayContaining(['ExplorerUrl', 'MirrorBucket', 'DistributionId']),
    );
  });

  it('keeps 90 days on every log group, including custom-resource functions', () => {
    for (const g of Object.values(web.findResources('AWS::Logs::LogGroup')) as Json[]) {
      expect(g.Properties.RetentionInDays).toBe(90);
      expect(g.DeletionPolicy).toBe('Delete');
    }
    const fns = Object.values(web.findResources('AWS::Lambda::Function')) as Json[];
    expect(fns.length).toBeGreaterThan(0);
    for (const f of fns) expect(f.Properties.LoggingConfig?.LogGroup).toBeDefined();
  });
});

describe('tags', () => {
  it('tags taggable resources in both stacks with project_name', () => {
    const tag = { Key: 'project_name', Value: config.projectName };
    api.hasResourceProperties('AWS::S3::Bucket', { Tags: Match.arrayWith([tag]) });
    web.hasResourceProperties('AWS::S3::Bucket', { Tags: Match.arrayWith([tag]) });
  });
});

describe('config', () => {
  it('rejects a non-us-east-2 region and a missing email', () => {
    expect(() => parseConfig({ ...example, region: 'us-west-2' })).toThrow();
    expect(() => parseConfig({ ...example, alarmEmails: [] })).toThrow();
  });
  it('defaults the model to the Sonnet 4.6 profile and chat reservation to unreserved', () => {
    const rest: Json = { ...example };
    delete rest.bedrockModelId;
    delete rest.chatReservedConcurrency;
    const parsed = parseConfig(rest);
    expect(parsed.bedrockModelId).toBe('us.anthropic.claude-sonnet-4-6');
    expect(parsed.chatReservedConcurrency).toBe(0);
    expect(parsed.langsmithSecretName).toBe('staraptor-agent/langsmith-api-key');
  });
  it('the example config reserves R = 5 for chat with the route throttle R / p95 (decisions.md section 32)', () => {
    expect(example.chatReservedConcurrency).toBe(5);
    expect(example.throttle.routes['POST /v1/agent/chat']).toEqual({ rate: 0.4, burst: 5 });
    expect(example.bedrockModelId).toBe('us.anthropic.claude-sonnet-4-6');
  });
});
