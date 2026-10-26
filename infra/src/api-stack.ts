// CountyLensApi (A-03 T074): the tRPC Lambda behind an HTTP API. Sizing from ADR-0001 and ARD
// § 16 AM-06, updated by ERR-18 and A-16 (arm64, 1,769 MB, 15 s, DuckDB threads 4, no reserved or
// provisioned concurrency: AD-11, account limit 10; per-invocation cost only, $0 idle; the AM-06
// text change is the PO's). The HTTP API is the only way in (AD-09: a Function URL would bypass
// the stage throttle of 10 rps / burst 20) and its JSON access log is the 30-day "query log"
// (AM-03); the function log group keeps 14 days. X-Ray is active on the function and a sampling
// rule with FixedRate 1 for service countylens-api records every request (NFR-004, research
// R-09). The function reads the CID copy through the Data stack's reader grant only (GetObject
// on ipfs/* and private/bench/*, contracts/storage.md) and presigns in-process; nothing here
// bills while idle (plan § "Idle-cost justification per resource").
//
// Bundling (research R-03, agent-design metagross § 5): NodejsFunction + esbuild, ESM, with
// `@duckdb/*` left external; afterBundling installs the linux/arm64/glibc DuckDB bindings at
// the exact version apps/api pins and places the `httpfs` extension where the engine's
// `extension_directory` (DUCKDB_EXTENSION_DIR) finds it. The DuckDB engine itself is
// apps/api/src/engine/duckdb-node.ts (T072); the handler is apps/api/src/handlers/trpc.ts (T073).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ArnFormat,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Validations,
} from "aws-cdk-lib";
import { AccessLogField, AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as xray from "aws-cdk-lib/aws-xray";
import type { Construct } from "constructs";
import { AdminQueue } from "./admin-queue.js";
import { COUNTYLENS_DOMAIN_NAME } from "./cert-stack.js";
import {
  ADMIN_GROUP_NAME,
  ALERTS_TOPIC_NAME,
  ENV_NAMES,
  EXPLORE_INDEX_PREFIX,
  EXPLORE_SEARCH_THROTTLE,
  LIVE_STATUS_KEY,
} from "./config.js";
import type { DataStack } from "./data-stack.js";

/** Function name, Powertools service name and X-Ray sampling-rule service name (one identifier). */
export const API_FUNCTION_NAME = "countylens-api";
/** Powertools metrics namespace of the three business metrics (QueryDurationMs, ItemsProcessed, ItemsFailed). */
export const API_METRICS_NAMESPACE = "CountyLens";
/** FILEBASE_GATEWAY_HOST (plan § "Fixed texts and config keys"): the labelled fallback gateway. */
export const FILEBASE_GATEWAY_HOST = "ipfs.filebase.io";

/** The committed run index, served by the site (not in the CID-copy bucket, which holds only ipfs/*). */
export const RUNS_INDEX_URL = `https://${COUNTYLENS_DOMAIN_NAME}/runs/index.json`;
/** The HTTP API route prefix; the Amplify rewrite maps the site's /api/<*> onto it (same origin). */
export const API_ROUTE_PATH = "/trpc/{proxy+}";
/** Stage throttle (AD-11, FR-007; TC-053). */
export const API_THROTTLE = { rateLimit: 10, burstLimit: 20 } as const;
/** A-16 (agent-design § index "Sizing"): the per-run Explore index is ~48 MB, so the query
 *  Lambda goes back from ERR-18's 3,008 MB to ADR-0001's 1,769 MB (one full vCPU). */
export const API_MEMORY_MB = 1769;
/** A-16 (A13-6): back to 15 s (AM-06). The 29 s stop-gap only made every failing full-county
 *  search bill twice as long; the per-run index answers well inside 15 s. */
export const API_TIMEOUT = Duration.seconds(15);
/** The dedicated route that carries EXPLORE_SEARCH_THROTTLE (same integration as the proxy). */
export const EXPLORE_SEARCH_ROUTE_PATH = "/trpc/explore.search";
export { EXPLORE_SEARCH_THROTTLE };
/** The duration alarm fires when p95 reaches 80 % of API_TIMEOUT (A13-6). */
export const API_DURATION_ALARM_P95_MS = API_TIMEOUT.toMilliseconds() * 0.8;
/** Cognito names (A-16 AC-6). */
export const USER_POOL_NAME = "countylens-admins";
export const USER_POOL_CLIENT_NAME = "countylens-web";
/** Retention (AD-16 as amended by AM-03): function log 14 days, access (query) log 30 days. */
export const FUNCTION_LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;
export const ACCESS_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
/** SSM String parameter mirroring the HttpApiUrl output. */
export const HTTP_API_URL_PARAMETER = "/countylens/api/http-api-url";

// --- MCP (A-14/A-15 T017/T018, G-4) ---
// AD-21: oracle's own MCP server lives on a separate Lambda, HTTP API and throttle from the
// tRPC Lambda above (its own blast radius). The six tool adapters and the Streamable HTTP
// transport (apps/api/src/mcp/server.ts, T024-T026) land in a later wave; this block wires the
// CDK resources now so the MCP Lambda, its /mcp route/throttle and its SSM read grant exist and
// are tested (infra/test/countylens-api-mcp.test.ts, T010) ahead of that.
/** Function name, Powertools service name of the MCP Lambda (distinct from API_FUNCTION_NAME). */
export const MCP_FUNCTION_NAME = "countylens-mcp";
/** Same size as the query API (AM-09). AM-09 raised it to 3,008 MB when the MCP tools read whole
 *  full-county parts; A-16 moves them onto the ~48 MB per-run index, so 1,769 MB again. */
export const MCP_MEMORY_MB = API_MEMORY_MB;
export const MCP_TIMEOUT = Duration.seconds(15);
export const MCP_ROUTE_PATH = "/mcp";
export const MCP_HEALTH_PATH = "/health";
/** NFR-003/AC-10: 5 rps sustained, burst 10, enforced at the route level (not stage-wide) so it
 *  never throttles GET /health or (being a separate API entirely) the tRPC API's own routes. */
export const MCP_THROTTLE = { rateLimit: 5, burstLimit: 10 } as const;
/** The MCP bearer token: an SSM SecureString created and rotated out of band by an operator
 *  (never by this stack, never a default, never Secrets Manager — AD-10, AD-14). This name must
 *  stay in sync with apps/api/src/mcp/auth.ts's MCP_TOKEN_PARAMETER_NAME (not imported directly:
 *  infra does not depend on apps/api's TypeScript source, only its bundled entry file below). */
export const MCP_TOKEN_PARAMETER_NAME = "/countylens/mcp/token";

// --- Agent (A-14 T016, G-2) ---
// AD-27: the agent Lambda is its own function, independent of both the tRPC query Lambda above
// (AM-06's 15 s timeout governs a different workload: DuckDB COUNT queries) and the MCP Lambda
// (AD-21's own blast radius). This block wires the Lambda, the spend-counter DynamoDB table, the
// 80% alarm, and (T019-T022 follow-up, Stage 5 review fix) its own HTTP API + route +
// route-level throttle, the same pattern as the tRPC API above and the MCP Lambda below: its own
// API, not folded into either, so its blast radius and throttle stay AD-27's own.
/** Function name, Powertools service name of the agent Lambda (distinct from the other two). */
export const AGENT_FUNCTION_NAME = "countylens-agent";
/** AD-27 sizing, amended by AM-09: same as the query API, because the agent tools run the same
 *  engine (A-16: on the per-run index, so 1,769 MB like the query API). */
export const AGENT_MEMORY_MB = API_MEMORY_MB;
/** AD-27: 23 s in-process abort → `timed_out`, 25 s Lambda timeout (the backstop), independent
 *  of AM-06's 15 s query-API timeout (research.md "timeout layering"). */
export const AGENT_TIMEOUT_SECONDS = 25;
/** data-model.md "Spend counter": one on-demand item per UTC day, key `pk`. Must stay in sync
 *  with apps/api/src/agent/spend.ts's own DAILY_SPEND_CAP_USD (not imported directly, same
 *  reason as MCP_TOKEN_PARAMETER_NAME above: infra depends on the bundled entry, not the source). */
export const SPEND_TABLE_NAME = "CountyLensAiSpend";
/** The daily spend cap (USD) the alarm below watches 80% of (PO 2026-10-26: $3 raised to $5). */
export const DAILY_SPEND_CAP_USD = 5;
/** 80% of DAILY_SPEND_CAP_USD ($4.00): agent-design.md § "ash" > "Spend-cap + alarm design". */
export const SPEND_ALARM_THRESHOLD_USD = DAILY_SPEND_CAP_USD * 0.8;
/** Powertools EMF metric name the agent Lambda emits per request (`src/agent/ask.ts`, T022). */
export const SPEND_METRIC_NAME = "AiSpendUsd";
/** The HTTP API route path: the tRPC AWS Lambda adapter over `agentRouter` (one procedure,
 *  `ask`), so the client POSTs `/agent/ask`. */
/** The agent's Bedrock model (apps/api/src/agent/model.ts DEFAULT_BEDROCK_MODEL_ID) and its base model. */
export const BEDROCK_INFERENCE_PROFILE_ID = "eu.anthropic.claude-sonnet-4-6";
export const BEDROCK_FOUNDATION_MODEL_ID = "anthropic.claude-sonnet-4-6";
export const AGENT_ROUTE_PATH = "/agent/{proxy+}";
/** Route-level throttle on the agent route (Stage 5 review fix: no specific number was decided
 *  in research.md/plan.md for this route, unlike the MCP route's documented 5 rps/burst 10). A
 *  conservative default: Bedrock's own 10 req/min account-wide limit (CLAUDE.md) is the real
 *  concurrency ceiling for the expensive part of this path, and the DynamoDB spend cap is the
 *  real cost backstop (agent-design.md "no reserved concurrency" risk note) -- this route
 *  throttle only exists to stop a client-side retry storm from hammering API Gateway itself,
 *  well below the tRPC API's 10 rps/burst 20. */
export const AGENT_THROTTLE = { rateLimit: 2, burstLimit: 5 } as const;

/** Where Lambda unpacks the asset; the extension directory is relative to it. */
export const LAMBDA_TASK_ROOT = "/var/task";
/** `<asset>/duckdb-extensions/<duckdb version>/<platform>/<name>.duckdb_extension` (DuckDB layout). */
export const DUCKDB_EXTENSION_DIR_NAME = "duckdb-extensions";
export const DUCKDB_PLATFORM = "linux_arm64";
export const DUCKDB_EXTENSIONS_ORIGIN = "https://extensions.duckdb.org";

/** The reader grant's wildcard object paths (Data.grantApiRead), acknowledged for cdk-nag. */
const READER_WILDCARD = /\/(ipfs|private\/bench|private\/explore-index)\/\*$/;

const RUNTIME = lambda.Runtime.NODEJS_24_X;
/** esbuild target for the runtime above (`nodejs24.x` → `node24`). */
const ESBUILD_TARGET = `node${RUNTIME.name.replace(/^nodejs(\d+)\.x$/, "$1")}`;

const ENTRY = fileURLToPath(new URL("../../apps/api/src/handlers/trpc.ts", import.meta.url));
const API_PACKAGE_JSON = fileURLToPath(new URL("../../apps/api/package.json", import.meta.url));
/** The MCP Lambda handler (the six `/mcp` tools). */
const MCP_ENTRY = fileURLToPath(new URL("../../apps/api/src/handlers/mcp.ts", import.meta.url));
/** The agent Lambda handler (`agent.ask`). */
const AGENT_ENTRY = fileURLToPath(new URL("../../apps/api/src/handlers/agent.ts", import.meta.url));

/** The `@duckdb/node-api` version apps/api pins; the asset installs exactly that one. */
export function duckDbNodeApiVersion(): string {
  const pkg = JSON.parse(readFileSync(API_PACKAGE_JSON, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const version = pkg.dependencies?.["@duckdb/node-api"];
  if (version === undefined || !/^\d+\.\d+\.\d+(-r\.\d+)?$/.test(version)) {
    throw new Error(
      `apps/api/package.json must pin @duckdb/node-api to an exact version (found ${String(version)})`,
    );
  }
  return version;
}

/** DuckDB release of a node-api version: `1.5.6-r.2` → `v1.5.6` (extension repository layout). */
export function duckDbVersion(nodeApiVersion: string): string {
  return `v${nodeApiVersion.split("-")[0]}`;
}

/**
 * The esbuild/NodejsFunction options. Exposed so the CDK assertions check the options the
 * stack really uses: the shell commands below run on the synth machine (local esbuild; CI and
 * the PO laptop both have npm ≥ 10 and curl) and need no Docker.
 */
export function apiBundling(): nodejs.BundlingOptions {
  const nodeApi = duckDbNodeApiVersion();
  const release = duckDbVersion(nodeApi);
  return {
    platform: "node",
    target: ESBUILD_TARGET,
    format: nodejs.OutputFormat.ESM,
    mainFields: ["module", "main"],
    // ESM bundle: dependencies that still call require() get one from the entry's own URL.
    banner:
      "import { createRequire as __countylensRequire } from 'node:module';" +
      "const require = __countylensRequire(import.meta.url);",
    minify: true,
    keepNames: true,
    sourceMap: true,
    sourcesContent: false,
    // The DuckDB bindings are native (.node + libduckdb.so): never bundled, installed below for
    // the Lambda platform (apps/*/src/engine/** is the only importer, AD-19).
    externalModules: ["@duckdb/*"],
    forceDockerBundling: false,
    commandHooks: {
      beforeBundling: () => [],
      beforeInstall: () => [],
      afterBundling: (_inputDir: string, outputDir: string) => {
        const extensionDir = `${outputDir}/${DUCKDB_EXTENSION_DIR_NAME}/${release}/${DUCKDB_PLATFORM}`;
        return [
          `npm install --prefix ${outputDir} --os=linux --cpu=arm64 --libc=glibc ` +
            `--omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts ` +
            `@duckdb/node-api@${nodeApi}`,
          `mkdir -p ${extensionDir}`,
          `curl -fsSL ${DUCKDB_EXTENSIONS_ORIGIN}/${release}/${DUCKDB_PLATFORM}/httpfs.duckdb_extension.gz ` +
            `| gunzip -c > ${extensionDir}/httpfs.duckdb_extension`,
        ];
      },
    },
  };
}

/**
 * cdk-nag's rendering of a policy resource (its `flattenCfnReference`): Join pieces concatenated,
 * `${x}` → `<x>`, Ref/GetAtt → `<id>` / `<id.attr>`, anything else JSON. Used to build the exact
 * `AwsSolutions-IAM5[Resource::…]` ids cdk-nag v3 requires (it matches ids literally).
 */
export function nagResourceSuffix(node: unknown): string {
  if (node === undefined) return "";
  if (typeof node === "string") return node.replace(/\$\{/g, "<").replace(/\}/g, ">");
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["Fn::Join"])) {
    const [delimiter, items] = o["Fn::Join"] as [string, unknown[]];
    return items.map(nagResourceSuffix).join(delimiter);
  }
  if (o["Fn::Sub"] !== undefined) return nagResourceSuffix(o["Fn::Sub"]);
  if (Array.isArray(o["Fn::GetAtt"])) {
    const [resource, attribute] = o["Fn::GetAtt"] as [unknown, unknown];
    return `<${nagResourceSuffix(resource)}.${nagResourceSuffix(attribute)}>`;
  }
  if (o["Fn::ImportValue"] !== undefined) return nagResourceSuffix(o["Fn::ImportValue"]);
  if (o.Ref !== undefined) return `<${nagResourceSuffix(o.Ref)}>`;
  return JSON.stringify(node);
}

/**
 * Acknowledge `AwsSolutions-IAM5[Resource::<r>]` for every Allow resource of `documents` that
 * contains a wildcard and satisfies `accept`, with the exact id cdk-nag will report. Runs as a
 * construct validation: after cross-stack references resolve (so a bucket ARN from another stack
 * renders as it will in the template) and before the validation plugins read the metadata.
 */
export function acknowledgeWildcardResources(
  scope: Construct,
  documents: () => unknown[],
  accept: (resource: string) => boolean,
  reason: string,
): void {
  scope.node.addValidation({
    validate: () => {
      const stack = Stack.of(scope);
      const acknowledged = new Set<string>();
      for (const document of documents()) {
        const resolved = stack.resolve(document) as { Statement?: Record<string, unknown>[] };
        for (const statement of resolved.Statement ?? []) {
          if (statement.Effect !== "Allow") continue;
          const resources = Array.isArray(statement.Resource)
            ? statement.Resource
            : [statement.Resource];
          for (const resource of resources.map(nagResourceSuffix)) {
            if (!resource.includes("*") || !accept(resource) || acknowledged.has(resource))
              continue;
            acknowledged.add(resource);
            Validations.of(scope).acknowledge({
              id: `AwsSolutions-IAM5[Resource::${resource}]`,
              reason,
            });
          }
        }
      }
      return [];
    },
  });
}

export interface ApiStackProps extends StackProps {
  /** CountyLensData: the CID copy the function reads (bucket, CloudFront host, private prefix). */
  readonly data: DataStack;
}

export class ApiStack extends Stack {
  readonly fn: nodejs.NodejsFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly stage: apigwv2.HttpStage;
  /** `https://{id}.execute-api.{region}.amazonaws.com` (no trailing slash): the Web rewrite target. */
  readonly httpApiUrl: string;
  readonly functionLogGroup: logs.LogGroup;
  /** The query log (AM-03): one JSON line per request, 30 days. */
  readonly accessLogGroup: logs.LogGroup;
  /** The NodejsFunction bundling options in use (asserted by infra/test/api.test.ts). */
  readonly bundling: nodejs.BundlingOptions;
  // --- MCP (T018) ---
  readonly mcpFn: nodejs.NodejsFunction;
  readonly mcpHttpApi: apigwv2.HttpApi;
  readonly mcpStage: apigwv2.HttpStage;
  readonly mcpFunctionLogGroup: logs.LogGroup;
  readonly mcpAccessLogGroup: logs.LogGroup;
  // --- Agent (T016, T019-T022) ---
  readonly agentFn: nodejs.NodejsFunction;
  readonly agentFunctionLogGroup: logs.LogGroup;
  readonly agentAccessLogGroup: logs.LogGroup;
  readonly agentHttpApi: apigwv2.HttpApi;
  readonly agentStage: apigwv2.HttpStage;
  readonly spendTable: dynamodb.Table;
  readonly spendAlarm: cloudwatch.Alarm;
  // --- Admin (A-16 T021, T023) ---
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly adminQueue: AdminQueue;
  /** The Ops topic, imported by name (CountyLensOps owns it and deploys after this stack). */
  readonly alertsTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.functionLogGroup = new logs.LogGroup(this, "FunctionLogs", {
      retention: FUNCTION_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.accessLogGroup = new logs.LogGroup(this, "AccessLogs", {
      retention: ACCESS_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Execution role without the AWS managed basic policy: log writes are scoped to the one
    // log group; X-Ray (resource "*" by design of the service) and the S3 reads are added below.
    const role = new iam.Role(this, "FunctionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Execution role of ${API_FUNCTION_NAME}: its own log group, X-Ray, GetObject on the CID copy's ipfs/* and private/bench/*`,
      inlinePolicies: {
        FunctionLogs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "WriteOwnLogGroup",
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [this.functionLogGroup.logGroupArn],
            }),
          ],
        }),
      },
    });

    this.bundling = apiBundling();
    this.fn = new nodejs.NodejsFunction(this, "Trpc", {
      functionName: API_FUNCTION_NAME,
      description:
        "CountyLens tRPC API: runs.summary, query.radius, query.roofAge over @duckdb/node-api and " +
        "presigned reads of the CID copy (ADR-0001 sizing; bench event by direct invoke only)",
      entry: ENTRY,
      handler: "handler",
      runtime: RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      memorySize: API_MEMORY_MB,
      timeout: API_TIMEOUT,
      role,
      tracing: lambda.Tracing.ACTIVE,
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      logGroup: this.functionLogGroup,
      environment: {
        // apps/api/src/config.ts (Zod): the four required keys.
        CID_COPY_BUCKET: props.data.bucket.bucketName,
        RUNS_INDEX_URL,
        CID_COPY_HOST: props.data.distribution.distributionDomainName,
        FILEBASE_GATEWAY_HOST,
        READPATH_PRIVATE_PREFIX: props.data.privateBenchPrefix,
        // A-16: the per-run Explore index (G4 reader) and the bridge's live status object.
        [ENV_NAMES.exploreIndexPrefix]: EXPLORE_INDEX_PREFIX,
        [ENV_NAMES.liveStatusKey]: LIVE_STATUS_KEY,
        // apps/api/src/engine/duckdb-node.ts (EXTENSION_DIRECTORY_ENV): DuckDB's
        // `extension_directory`; httpfs sits at <dir>/<release>/<platform>/httpfs.duckdb_extension.
        DUCKDB_EXTENSION_DIRECTORY: `${LAMBDA_TASK_ROOT}/${DUCKDB_EXTENSION_DIR_NAME}`,
        // Powertools Logger / Tracer / Metrics (constitution VIII).
        POWERTOOLS_SERVICE_NAME: API_FUNCTION_NAME,
        POWERTOOLS_METRICS_NAMESPACE: API_METRICS_NAMESPACE,
        POWERTOOLS_LOG_LEVEL: "INFO",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: this.bundling,
    });
    // Reader grant (contracts/storage.md, A-16): GetObject on ipfs/*, private/bench/*,
    // private/explore-index/* and live/live.json only.
    props.data.grantApiRead(this.fn);

    // HTTP API: routes under /trpc only; any other path is a gateway 404 and never invokes the
    // function (contracts/api.md). No CORS: the site reaches it same-origin via Amplify.
    this.httpApi = new apigwv2.HttpApi(this, "Http", {
      apiName: API_FUNCTION_NAME,
      description:
        "CountyLens tRPC over HTTP API v2; reached as /api/trpc/* through the Amplify rewrite",
      createDefaultStage: false,
    });
    const trpcIntegration = new HttpLambdaIntegration("Trpc", this.fn, {
      payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
    });
    this.httpApi.addRoutes({
      path: API_ROUTE_PATH,
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: trpcIntegration,
    });
    // A-16 (A13-6, A14-3): explore.search gets its own route key so it can carry a tighter
    // route-level throttle than the stage default. More specific than /trpc/{proxy+}, same
    // integration; the handler maps the literal path back to the procedure (context.ts).
    const exploreSearchRoutes = this.httpApi.addRoutes({
      path: EXPLORE_SEARCH_ROUTE_PATH,
      methods: [apigwv2.HttpMethod.ANY],
      integration: trpcIntegration,
    });
    this.stage = new apigwv2.HttpStage(this, "Default", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { ...API_THROTTLE },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(this.accessLogGroup),
        // Identifiers and counts only (FR-007): no caller identity, no query string.
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: AccessLogField.contextRequestId(),
            requestTime: AccessLogField.contextRequestTimeEpoch(),
            httpMethod: AccessLogField.contextHttpMethod(),
            routeKey: AccessLogField.contextRouteKey(),
            path: AccessLogField.contextPath(),
            status: AccessLogField.contextStatus(),
            responseLength: AccessLogField.contextResponseLength(),
            responseLatency: AccessLogField.contextResponseLatency(),
            integrationLatency: AccessLogField.contextIntegrationLatency(),
            integrationError: "$context.integrationErrorMessage",
          }),
        ),
      },
    });
    // Same escape hatch as the MCP and agent stages below: route-level limits need the CfnStage,
    // keyed by the exact route key, and the stage must be created after the route it names.
    const cfnStage = this.stage.node.defaultChild as apigwv2.CfnStage;
    for (const route of exploreSearchRoutes)
      cfnStage.addResourceDependency(route.node.defaultChild as apigwv2.CfnRoute);
    cfnStage.routeSettings = {
      [`ANY ${EXPLORE_SEARCH_ROUTE_PATH}`]: {
        ThrottlingRateLimit: EXPLORE_SEARCH_THROTTLE.rateLimit,
        ThrottlingBurstLimit: EXPLORE_SEARCH_THROTTLE.burstLimit,
      },
    };
    this.httpApiUrl = this.httpApi.apiEndpoint;

    // X-Ray samples 100 % of countylens-api (NFR-004); the rule is free while idle.
    new xray.CfnSamplingRule(this, "SampleAll", {
      samplingRule: {
        ruleName: API_FUNCTION_NAME,
        priority: 1000,
        fixedRate: 1,
        reservoirSize: 1,
        serviceName: API_FUNCTION_NAME,
        serviceType: "*",
        host: "*",
        httpMethod: "*",
        urlPath: "*",
        resourceArn: "*",
        version: 1,
      },
    });

    // cdk-nag acknowledgements, each with its reason (constitution: findings acknowledged, not hidden).
    Validations.of(this.httpApi).acknowledge({
      id: "AwsSolutions-APIG4",
      reason:
        "Public read-only queries over published open data (AD-09, contracts/api.md): every procedure is " +
        "a tRPC query with Zod-validated input, nothing mutates, and the stage throttle (10 rps / burst 20) " +
        "bounds the only compute. An authorizer would add a Cognito or Lambda resource that no user has.",
    });
    const defaultPolicy = role.node.tryFindChild("DefaultPolicy") as iam.Policy | undefined;
    if (defaultPolicy !== undefined) {
      Validations.of(defaultPolicy).acknowledge({
        id: "AwsSolutions-IAM5[Resource::*]",
        reason:
          "xray:PutTraceSegments/PutTelemetryRecords (active tracing, NFR-03) and A-16's " +
          "logs:GetQueryResults/StopQuery support no resource-level permission (only *); StartQuery " +
          "is limited to the query log group, so the role reads results of queries over it only.",
      });
      // The reader grant's resources are cross-stack references whose rendered form is only known
      // once references resolve; the exact finding ids are acknowledged then (see the helper).
      acknowledgeWildcardResources(
        defaultPolicy,
        () => [(defaultPolicy.node.defaultChild as iam.CfnPolicy).policyDocument],
        (resource) => READER_WILDCARD.test(resource),
        "GetObject on <bucket>/ipfs/* and <bucket>/private/bench/* is the exact reader boundary of " +
          "contracts/storage.md: objects are keyed by CID under ipfs/, the bench prefix is private and " +
          "deleted after TC-NF-05; s3:ListBucket only with s3:prefix private/bench/*, no Put or Delete (Data.grantApiRead).",
      );
    }

    new CfnOutput(this, "HttpApiUrl", {
      value: this.httpApiUrl,
      description: `HTTP API invoke URL, no trailing slash (mirrored to SSM ${HTTP_API_URL_PARAMETER}); the Web /api/<*> rewrite target`,
    });
    new CfnOutput(this, "ApiFunctionName", {
      value: this.fn.functionName,
      description: "Lambda function name (aws lambda invoke target of the TC-NF-05 bench event)",
    });
    new CfnOutput(this, "ApiFunctionLogGroupName", {
      value: this.functionLogGroup.logGroupName,
      description:
        "Function log group (14 days): the one JSON line per request with correlation_id (TC-050)",
    });
    new CfnOutput(this, "ApiAccessLogGroupName", {
      value: this.accessLogGroup.logGroupName,
      description: "HTTP API access log group (30 days): the query log (AM-03)",
    });
    new ssm.StringParameter(this, "HttpApiUrlParameter", {
      parameterName: HTTP_API_URL_PARAMETER,
      stringValue: this.httpApiUrl,
      description: "HTTP API invoke URL (CountyLensApi output HttpApiUrl)",
      tier: ssm.ParameterTier.STANDARD,
    });

    // --- MCP (A-14/A-15 T017/T018, G-4) ---
    // A separate Lambda, HTTP API and throttle from the tRPC resources above (AD-21's own blast
    // radius). Execution role: its own log group, the shared CID-copy reader grant (same
    // boundary as the tRPC role, contracts/storage.md), and exactly one ssm:GetParameter read
    // scoped to MCP_TOKEN_PARAMETER_NAME — no Secrets Manager resource, no wildcard (AD-14).
    this.mcpFunctionLogGroup = new logs.LogGroup(this, "McpFunctionLogs", {
      retention: FUNCTION_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.mcpAccessLogGroup = new logs.LogGroup(this, "McpAccessLogs", {
      retention: ACCESS_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const mcpTokenParameterArn = Stack.of(this).formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: MCP_TOKEN_PARAMETER_NAME.replace(/^\//, ""),
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    const mcpRole = new iam.Role(this, "McpFunctionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Execution role of ${MCP_FUNCTION_NAME}: its own log group, GetObject on the CID copy's ipfs/* and private/bench/*, and one scoped ssm:GetParameter read on ${MCP_TOKEN_PARAMETER_NAME}`,
      inlinePolicies: {
        FunctionLogs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "WriteOwnLogGroup",
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [this.mcpFunctionLogGroup.logGroupArn],
            }),
          ],
        }),
      },
    });
    // A standalone AWS::IAM::Policy (DefaultPolicy), same mechanism as Data.grantApiRead below —
    // scoped to exactly this one parameter's ARN, no wildcard (AD-14).
    mcpRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ReadMcpToken",
        actions: ["ssm:GetParameter"],
        resources: [mcpTokenParameterArn],
      }),
    );

    this.mcpFn = new nodejs.NodejsFunction(this, "Mcp", {
      functionName: MCP_FUNCTION_NAME,
      description:
        "CountyLens MCP server (AD-21: search_properties, list_permits, get_property, " +
        "get_coverage, list_runs, get_schema) over the published CID copy; its own Lambda, " +
        "throttle and SSM read grant, separate from the tRPC API",
      entry: MCP_ENTRY,
      handler: "handler",
      runtime: RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      memorySize: MCP_MEMORY_MB,
      timeout: MCP_TIMEOUT,
      role: mcpRole,
      tracing: lambda.Tracing.ACTIVE,
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      logGroup: this.mcpFunctionLogGroup,
      environment: {
        CID_COPY_BUCKET: props.data.bucket.bucketName,
        RUNS_INDEX_URL,
        CID_COPY_HOST: props.data.distribution.distributionDomainName,
        FILEBASE_GATEWAY_HOST,
        READPATH_PRIVATE_PREFIX: props.data.privateBenchPrefix,
        DUCKDB_EXTENSION_DIRECTORY: `${LAMBDA_TASK_ROOT}/${DUCKDB_EXTENSION_DIR_NAME}`,
        // apps/api/src/mcp/auth.ts: the one SSM parameter this Lambda is allowed to read.
        MCP_TOKEN_PARAMETER_NAME,
        [ENV_NAMES.exploreIndexPrefix]: EXPLORE_INDEX_PREFIX,
        POWERTOOLS_SERVICE_NAME: MCP_FUNCTION_NAME,
        POWERTOOLS_METRICS_NAMESPACE: API_METRICS_NAMESPACE,
        POWERTOOLS_LOG_LEVEL: "INFO",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: this.bundling,
    });
    // Same reader boundary as the tRPC Lambda (contracts/storage.md): GetObject on ipfs/* and
    // private/bench/* only, via a separate grant on this Lambda's own role.
    props.data.grantApiRead(this.mcpFn);

    this.mcpHttpApi = new apigwv2.HttpApi(this, "McpHttp", {
      apiName: MCP_FUNCTION_NAME,
      description:
        "CountyLens MCP (AD-21): POST /mcp (Streamable HTTP, bearer-token auth in the handler) " +
        "and GET /health (no auth); a separate API from the tRPC one, its own throttle",
      createDefaultStage: false,
    });
    const mcpIntegration = new HttpLambdaIntegration("Mcp", this.mcpFn, {
      payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
    });
    const mcpRoutes = this.mcpHttpApi.addRoutes({
      path: MCP_ROUTE_PATH,
      methods: [apigwv2.HttpMethod.POST],
      integration: mcpIntegration,
    });
    this.mcpHttpApi.addRoutes({
      path: MCP_HEALTH_PATH,
      methods: [apigwv2.HttpMethod.GET],
      integration: mcpIntegration,
    });
    this.mcpStage = new apigwv2.HttpStage(this, "McpDefault", {
      httpApi: this.mcpHttpApi,
      stageName: "$default",
      autoDeploy: true,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(this.mcpAccessLogGroup),
        // Identifiers and counts only (FR-007), same shape as the tRPC API's access log.
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: AccessLogField.contextRequestId(),
            requestTime: AccessLogField.contextRequestTimeEpoch(),
            httpMethod: AccessLogField.contextHttpMethod(),
            routeKey: AccessLogField.contextRouteKey(),
            path: AccessLogField.contextPath(),
            status: AccessLogField.contextStatus(),
            responseLength: AccessLogField.contextResponseLength(),
            responseLatency: AccessLogField.contextResponseLatency(),
            integrationLatency: AccessLogField.contextIntegrationLatency(),
            integrationError: "$context.integrationErrorMessage",
          }),
        ),
      },
    });
    // Route-level throttle on POST /mcp only (AD-21 "its own throttle"; NFR-003/AC-10: 5 rps,
    // burst 10). The L2 HttpStage's `throttle` prop only sets DefaultRouteSettings (stage-wide,
    // would also cover GET /health); the per-route limit needs the underlying CfnStage escape
    // hatch, keyed by the exact route key API Gateway renders ("POST /mcp").
    // `routeSettings` is untyped (`any`) in the L1 construct, so CDK does not camelCase→PascalCase
    // it the way a typed prop would: the keys below must already be the literal CFN property
    // names (confirmed by inspecting the synthesized template directly).
    const cfnMcpStage = this.mcpStage.node.defaultChild as apigwv2.CfnStage;
    // The stage names the route in routeSettings, so CloudFormation must create the route first
    // (without this the stage can be created before the route and the deploy fails with 404).
    for (const route of mcpRoutes)
      cfnMcpStage.addResourceDependency(route.node.defaultChild as apigwv2.CfnRoute);
    cfnMcpStage.routeSettings = {
      [`POST ${MCP_ROUTE_PATH}`]: {
        ThrottlingRateLimit: MCP_THROTTLE.rateLimit,
        ThrottlingBurstLimit: MCP_THROTTLE.burstLimit,
      },
    };

    Validations.of(this.mcpHttpApi).acknowledge({
      id: "AwsSolutions-APIG4",
      reason:
        "POST /mcp is gated by its own bearer-token check inside the handler " +
        "(apps/api/src/mcp/auth.ts, AD-10/AD-14: an SSM SecureString, never a default), not by " +
        "an API Gateway authorizer. GET /health is an unauthenticated liveness probe with no " +
        "data access.",
    });
    const mcpDefaultPolicy = mcpRole.node.tryFindChild("DefaultPolicy") as iam.Policy | undefined;
    if (mcpDefaultPolicy !== undefined) {
      Validations.of(mcpDefaultPolicy).acknowledge({
        id: "AwsSolutions-IAM5[Resource::*]",
        reason:
          "xray:PutTraceSegments and xray:PutTelemetryRecords support no resource-level " +
          "permission (the service accepts only *); this is the active-tracing policy CDK " +
          "attaches (NFR-03), same acknowledgement as the tRPC Lambda's role above.",
      });
      acknowledgeWildcardResources(
        mcpDefaultPolicy,
        () => [(mcpDefaultPolicy.node.defaultChild as iam.CfnPolicy).policyDocument],
        (resource) => READER_WILDCARD.test(resource),
        "GetObject on <bucket>/ipfs/* and <bucket>/private/bench/* is the exact reader boundary " +
          "of contracts/storage.md, mirrored from the tRPC Lambda's own grant (Data.grantApiRead).",
      );
    }

    new CfnOutput(this, "McpApiUrl", {
      value: this.mcpHttpApi.apiEndpoint,
      description: "MCP HTTP API invoke URL: POST /mcp (bearer token), GET /health (no auth)",
    });
    new CfnOutput(this, "McpFunctionName", {
      value: this.mcpFn.functionName,
      description: "MCP Lambda function name",
    });
    new CfnOutput(this, "McpFunctionLogGroupName", {
      value: this.mcpFunctionLogGroup.logGroupName,
      description: "MCP function log group (14 days)",
    });

    // --- Agent (A-14 T016, G-2) ---
    // Its own Lambda (AD-27), spend-counter table and 80% alarm. Its own HTTP API route and
    // throttle are defined further down (`agentHttpApi`).
    this.agentFunctionLogGroup = new logs.LogGroup(this, "AgentFunctionLogs", {
      retention: FUNCTION_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // One on-demand item per UTC day (data-model.md "Spend counter"): no provisioned capacity,
    // no idle cost (A7, P0-19), and deliberately no TimeToLiveSpecification — a counter that
    // silently expired mid-day would let spend quietly reset to zero (apps/api/src/agent/spend.ts).
    this.spendTable = new dynamodb.Table(this, "SpendTable", {
      tableName: SPEND_TABLE_NAME,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    Validations.of(this.spendTable).acknowledge({
      id: "AwsSolutions-DDB3",
      reason:
        "One tiny on-demand item per UTC day, derived entirely from Bedrock/Gateway call counts " +
        "the agent Lambda can recompute from its own CloudWatch logs; continuous backups would " +
        "add cost (A7) for a counter that is cheap to rebuild and never the system of record.",
    });

    const agentRole = new iam.Role(this, "AgentFunctionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Execution role of ${AGENT_FUNCTION_NAME}: its own log group, GetObject on the CID copy's ipfs/* and private/bench/*, and read/write on ${SPEND_TABLE_NAME}`,
      inlinePolicies: {
        FunctionLogs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "WriteOwnLogGroup",
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [this.agentFunctionLogGroup.logGroupArn],
            }),
          ],
        }),
      },
    });

    this.agentFn = new nodejs.NodejsFunction(this, "Agent", {
      functionName: AGENT_FUNCTION_NAME,
      description:
        "CountyLens agent.ask (AD-27): Vercel AI SDK tool loop over the published CID copy, " +
        "with a DynamoDB daily spend cap; its own Lambda, independent of the tRPC query API's " +
        "15 s timeout (AM-06)",
      entry: AGENT_ENTRY,
      handler: "handler",
      runtime: RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      memorySize: AGENT_MEMORY_MB,
      timeout: Duration.seconds(AGENT_TIMEOUT_SECONDS),
      role: agentRole,
      tracing: lambda.Tracing.ACTIVE,
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      logGroup: this.agentFunctionLogGroup,
      environment: {
        CID_COPY_BUCKET: props.data.bucket.bucketName,
        RUNS_INDEX_URL,
        CID_COPY_HOST: props.data.distribution.distributionDomainName,
        FILEBASE_GATEWAY_HOST,
        READPATH_PRIVATE_PREFIX: props.data.privateBenchPrefix,
        DUCKDB_EXTENSION_DIRECTORY: `${LAMBDA_TASK_ROOT}/${DUCKDB_EXTENSION_DIR_NAME}`,
        // apps/api/src/agent/spend.ts: the one table this Lambda reads/increments.
        SPEND_TABLE_NAME,
        [ENV_NAMES.exploreIndexPrefix]: EXPLORE_INDEX_PREFIX,
        POWERTOOLS_SERVICE_NAME: AGENT_FUNCTION_NAME,
        POWERTOOLS_METRICS_NAMESPACE: API_METRICS_NAMESPACE,
        POWERTOOLS_LOG_LEVEL: "INFO",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: this.bundling,
    });
    // Same reader boundary as the other two Lambdas (contracts/storage.md).
    props.data.grantApiRead(this.agentFn);
    // Read/increment the daily spend item only (no Scan, no other table).
    this.spendTable.grantReadWriteData(this.agentFn);
    // Bedrock (AI_PROVIDER=bedrock, the default): invoke only the eu. Sonnet 4.6 inference profile,
    // and the underlying foundation models only when reached through that profile (cross-region
    // inference runs the model in the EU regions the profile lists, hence the region wildcard).
    this.agentFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeBedrockSonnetProfile",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_INFERENCE_PROFILE_ID}`,
        ],
      }),
    );
    // The condition key exists only on the foundation-model request, so it cannot share a
    // statement with the profile resource (that combination matches nothing and is denied).
    this.agentFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeBedrockSonnetModelViaProfile",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:${this.partition}:bedrock:*::foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}`,
        ],
        conditions: {
          StringLike: {
            "bedrock:InferenceProfileArn": `arn:${this.partition}:bedrock:*:${this.account}:inference-profile/${BEDROCK_INFERENCE_PROFILE_ID}`,
          },
        },
      }),
    );

    // Its own HTTP API + route (Stage 5 review fix: `agent.ask` had no way in at all). A
    // separate API from both the tRPC and MCP ones above, same reasoning as those two: AD-27's
    // own blast radius and throttle, never folded into either.
    this.agentAccessLogGroup = new logs.LogGroup(this, "AgentAccessLogs", {
      retention: ACCESS_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.agentHttpApi = new apigwv2.HttpApi(this, "AgentHttp", {
      apiName: AGENT_FUNCTION_NAME,
      description:
        "CountyLens agent.ask (AD-27): the tRPC AWS Lambda adapter over agentRouter's one " +
        "procedure (`ask`); a separate API from the tRPC query API and the MCP server, its own " +
        "throttle",
      createDefaultStage: false,
    });
    const agentRoutes = this.agentHttpApi.addRoutes({
      path: AGENT_ROUTE_PATH,
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("Agent", this.agentFn, {
        payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
      }),
    });
    this.agentStage = new apigwv2.HttpStage(this, "AgentDefault", {
      httpApi: this.agentHttpApi,
      stageName: "$default",
      autoDeploy: true,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(this.agentAccessLogGroup),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: AccessLogField.contextRequestId(),
            requestTime: AccessLogField.contextRequestTimeEpoch(),
            httpMethod: AccessLogField.contextHttpMethod(),
            routeKey: AccessLogField.contextRouteKey(),
            path: AccessLogField.contextPath(),
            status: AccessLogField.contextStatus(),
            responseLength: AccessLogField.contextResponseLength(),
            responseLatency: AccessLogField.contextResponseLatency(),
            integrationLatency: AccessLogField.contextIntegrationLatency(),
            integrationError: "$context.integrationErrorMessage",
          }),
        ),
      },
    });
    // Route-level throttle (same escape hatch as the MCP route above: the L2 HttpStage's
    // `throttle` prop only sets stage-wide DefaultRouteSettings, so the per-route limit needs
    // the underlying CfnStage, keyed by the exact route key API Gateway renders).
    const cfnAgentStage = this.agentStage.node.defaultChild as apigwv2.CfnStage;
    // Same ordering fix as the MCP stage: the routes must exist before the stage names them.
    for (const route of agentRoutes)
      cfnAgentStage.addResourceDependency(route.node.defaultChild as apigwv2.CfnRoute);
    cfnAgentStage.routeSettings = {
      [`POST ${AGENT_ROUTE_PATH}`]: {
        ThrottlingRateLimit: AGENT_THROTTLE.rateLimit,
        ThrottlingBurstLimit: AGENT_THROTTLE.burstLimit,
      },
      [`GET ${AGENT_ROUTE_PATH}`]: {
        ThrottlingRateLimit: AGENT_THROTTLE.rateLimit,
        ThrottlingBurstLimit: AGENT_THROTTLE.burstLimit,
      },
    };
    Validations.of(this.agentHttpApi).acknowledge({
      id: "AwsSolutions-APIG4",
      reason:
        "agent.ask is a public, read-only (over published data) procedure with its own spend " +
        "cap and Bedrock-throttle backstops (ask.ts); it has no per-user data to gate behind an " +
        "API Gateway authorizer, same posture as the tRPC query API above (FR-013).",
    });

    // The 80% alarm (agent-design.md § "ash" > "Spend-cap + alarm design"): watches the
    // Powertools EMF metric the agent Lambda emits per request. No alarm action is wired here —
    // CountyLensOps (which already fans the Lambda Errors/Throttles/5xx alarms out to the
    // operator's SNS topic) deploys after this stack, so wiring this alarm's action into that
    // topic is a CountyLensOps follow-up, not invented here as a forward reference.
    this.spendAlarm = new cloudwatch.Metric({
      namespace: API_METRICS_NAMESPACE,
      metricName: SPEND_METRIC_NAME,
      dimensionsMap: { service: AGENT_FUNCTION_NAME },
      statistic: "Maximum",
      period: Duration.minutes(5),
    }).createAlarm(this, "SpendAlarm", {
      alarmDescription: `${AGENT_FUNCTION_NAME}: today's spend ≥ 80% of the $${DAILY_SPEND_CAP_USD}/day cap`,
      threshold: SPEND_ALARM_THRESHOLD_USD,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const agentDefaultPolicy = agentRole.node.tryFindChild("DefaultPolicy") as
      iam.Policy | undefined;
    if (agentDefaultPolicy !== undefined) {
      Validations.of(agentDefaultPolicy).acknowledge({
        id: "AwsSolutions-IAM5[Resource::*]",
        reason:
          "xray:PutTraceSegments and xray:PutTelemetryRecords support no resource-level " +
          "permission (the service accepts only *); this is the active-tracing policy CDK " +
          "attaches (NFR-03), same acknowledgement as the tRPC and MCP Lambdas' roles above.",
      });
      acknowledgeWildcardResources(
        agentDefaultPolicy,
        () => [(agentDefaultPolicy.node.defaultChild as iam.CfnPolicy).policyDocument],
        (resource) => READER_WILDCARD.test(resource),
        "GetObject on <bucket>/ipfs/* and <bucket>/private/bench/* is the exact reader boundary " +
          "of contracts/storage.md, mirrored from the tRPC and MCP Lambdas' own grants " +
          "(Data.grantApiRead).",
      );
      Validations.of(agentDefaultPolicy).acknowledge({
        id: `AwsSolutions-IAM5[Resource::arn:aws:bedrock:*::foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}]`,
        reason:
          "Cross-region inference runs the model in any of the EU regions the eu. profile lists " +
          "(six, chosen by Bedrock), so the foundation-model ARN carries a region wildcard. It names " +
          "one model only and carries a bedrock:InferenceProfileArn condition, so it is usable only " +
          "through the eu.anthropic.claude-sonnet-4-6 profile (AWS-documented pattern).",
      });
    }

    new CfnOutput(this, "AgentApiUrl", {
      value: this.agentHttpApi.apiEndpoint,
      description: "Agent HTTP API invoke URL: POST /agent/ask",
    });
    new CfnOutput(this, "AgentFunctionName", {
      value: this.agentFn.functionName,
      description: "Agent Lambda function name",
    });
    new CfnOutput(this, "AgentFunctionLogGroupName", {
      value: this.agentFunctionLogGroup.logGroupName,
      description: "Agent function log group (14 days)",
    });
    new CfnOutput(this, "SpendTableName", {
      value: this.spendTable.tableName,
      description: "Spend-counter DynamoDB table name (data-model.md)",
    });

    // --- Admin (A-16 T021, T023, T024, T025) ---
    // The Ops topic is imported by its fixed name: CountyLensOps owns it and depends on this
    // stack (AM-02), so a CDK reference from here to Ops would be a cycle.
    this.alertsTopic = sns.Topic.fromTopicArn(
      this,
      "AlertsTopic",
      this.formatArn({ service: "sns", resource: ALERTS_TOPIC_NAME }),
    );
    // T025 (A14-3): the agent's 80 % spend alarm now notifies the Ops topic (ALARM and OK).
    this.spendAlarm.addAlarmAction(new cwActions.SnsAction(this.alertsTopic));
    this.spendAlarm.addOkAction(new cwActions.SnsAction(this.alertsTopic));

    // T021 (AC-6, AC-11): Task B's pool without its lockout Lambda (Cognito's own sign-in
    // throttling is enough: no extra Lambda or table). Self sign-up off, so the operator creates
    // users with admin-create-user; email is the username; SRP only, no client secret.
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: USER_POOL_NAME,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      // Lite: plain sign-in only, no managed login or threat protection, nothing billed per user.
      featurePlan: cognito.FeaturePlan.LITE,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: USER_POOL_CLIENT_NAME,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
    });
    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: ADMIN_GROUP_NAME,
      description: "CountyLens admins: may Start / Stop / Retry runs and read Activity (A-16 AC-6)",
    });
    Validations.of(this.userPool).acknowledge(
      {
        id: "AwsSolutions-COG2",
        reason:
          "MFA would block the shared admin test login that the hosted Playwright run and the demo " +
          "use; self sign-up is off, so only operator-created users exist (Task B posture).",
      },
      {
        id: "AwsSolutions-COG3",
        reason:
          "Advanced security needs the Plus tier, billed per active user, with no budget in this " +
          "$120-credit account (A7); Cognito's built-in sign-in throttling stays on.",
      },
      {
        id: "AwsSolutions-COG8",
        reason:
          "The Lite feature plan is deliberate: Plus bills per monthly active user (A7, $0 idle); " +
          "a handful of operator-created admins sign in with SRP and a 12-character password policy.",
      },
    );

    // T023 (AC-7, AC-9, AC-11): the command queue (G3's construct). The API may only send.
    this.adminQueue = new AdminQueue(this, "AdminQueue", { alarmTopic: this.alertsTopic });
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "SendAdminCommands",
        actions: ["sqs:SendMessage"],
        resources: [this.adminQueue.queue.queueArn],
      }),
    );
    // T024 (AC-10): Activity reads the query log through Logs Insights. StartQuery is scoped to
    // that one log group; GetQueryResults and StopQuery take a query id and support no resource.
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "StartQueryOnQueryLog",
        actions: ["logs:StartQuery"],
        resources: [this.accessLogGroup.logGroupArn],
      }),
    );
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadOwnQueryResults",
        actions: ["logs:GetQueryResults", "logs:StopQuery"],
        resources: ["*"],
      }),
    );
    const adminEnv: readonly (readonly [string, string])[] = [
      [ENV_NAMES.adminQueueUrl, this.adminQueue.queue.queueUrl],
      [ENV_NAMES.userPoolId, this.userPool.userPoolId],
      [ENV_NAMES.userPoolClientId, this.userPoolClient.userPoolClientId],
      [ENV_NAMES.queryLogGroup, this.accessLogGroup.logGroupName],
    ];
    for (const [key, value] of adminEnv) this.fn.addEnvironment(key, value);

    new CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito user pool of the admins (VITE_COGNITO_USER_POOL_ID)",
    });
    new CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "SRP app client, no secret (VITE_COGNITO_USER_POOL_CLIENT_ID)",
    });
    new CfnOutput(this, "AdminQueueUrl", {
      value: this.adminQueue.queue.queueUrl,
      description: "Admin command queue the laptop bridge long-polls (COUNTYLENS_ADMIN_QUEUE_URL)",
    });
  }
}
