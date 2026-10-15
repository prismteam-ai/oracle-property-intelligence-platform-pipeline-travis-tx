import { existsSync } from "node:fs";
import path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

export type ApiStackProps = StackProps & {
  repoRoot: string;
  snapshotRootCid?: string;
  snapshotManifestUrl?: string;
  historyUrl?: string;
  manifestBaseUrl?: string;
  ipfsGateway: string;
  llmProvider: string;
  llmModel?: string;
  agentConcurrency: number;
};

export class OracleApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    Tags.of(this).add("project", "oracle-travis");
    Tags.of(this).add("component", "api");

    const env: Record<string, string> = {
      HOME: "/tmp",
      NODE_OPTIONS: "--enable-source-maps",
      ORACLE_IPFS_GATEWAY: props.ipfsGateway,
      ORACLE_LLM_PROVIDER: props.llmProvider,
      ORACLE_BEDROCK_REGION: this.region,
      POWERTOOLS_SERVICE_NAME: "oracle-travis-mcp",
    };
    if (props.snapshotRootCid) env.ORACLE_SNAPSHOT_ROOT_CID = props.snapshotRootCid;
    if (props.snapshotManifestUrl) env.ORACLE_SNAPSHOT_MANIFEST = props.snapshotManifestUrl;
    if (props.historyUrl) env.ORACLE_HISTORY_URL = props.historyUrl;
    if (props.manifestBaseUrl) env.ORACLE_MANIFEST_BASE_URL = props.manifestBaseUrl;
    if (props.llmModel) env.ORACLE_LLM_MODEL = props.llmModel;
    // Stop the agent before CloudFront's 60 s origin timeout so callers get a JSON error, not a 504 page.
    env.ORACLE_AGENT_TIMEOUT_MS = "55000";

    const fn = new nodejs.NodejsFunction(this, "McpApiFunction", {
      entry: path.join(props.repoRoot, "packages/mcp/src/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      memorySize: 3008,
      timeout: Duration.seconds(120),
      reservedConcurrentExecutions: props.agentConcurrency,
      environment: env,
      logGroup: new logs.LogGroup(this, "McpApiLogs", {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      tracing: lambda.Tracing.ACTIVE,
      depsLockFilePath: path.join(props.repoRoot, "package-lock.json"),
      projectRoot: props.repoRoot,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        mainFields: ["module", "main"],
        nodeModules: ["@duckdb/node-api", "@duckdb/node-bindings"],
        banner:
          "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
        // Ship the committed publication record (runs/history.json + manifests) with the function, so the
        // explorer's IPFS publication tab works without historyUrl; historyUrl/manifestBaseUrl still take precedence.
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp -r "${inputDir}/runs" "${outputDir}/runs"`,
          ],
        },
      },
    });
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        ],
      }),
    );
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const site = new s3.Bucket(this, "ExplorerSite", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // The agent runs a multi-step tool loop; 60 s is CloudFront's maximum origin read timeout without a quota increase.
    const apiOrigin = new origins.FunctionUrlOrigin(url, { readTimeout: Duration.seconds(60) });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };
    const dist = new cloudfront.Distribution(this, "ExplorerDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: { "/api/*": apiBehavior, "/mcp": apiBehavior, "/health": apiBehavior },
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const distDir = path.join(props.repoRoot, "apps/explorer/dist");
    if (existsSync(distDir)) {
      new s3deploy.BucketDeployment(this, "ExplorerDeploy", {
        destinationBucket: site,
        sources: [s3deploy.Source.asset(distDir)],
        distribution: dist,
        distributionPaths: ["/*"],
      });
    }

    new CfnOutput(this, "ExplorerUrl", { value: `https://${dist.distributionDomainName}` });
    new CfnOutput(this, "McpEndpoint", { value: `https://${dist.distributionDomainName}/mcp` });
    new CfnOutput(this, "FunctionUrl", { value: url.url });
  }
}
