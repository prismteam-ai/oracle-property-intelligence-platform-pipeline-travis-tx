// CountyLensApi assertions (A-03 T069; TC-053, TC-050 infra half, NFR-03, ARD AM-03/AM-06).
// Rules asserted here: Lambda sizing (arm64, 1,769 MB, 15 s since A-16 (A-13's 29 s / ERR-18's 3,008 MB were stop-gaps), DuckDB threads 4: ADR-0001 as updated
// by ERR-18, pending the PO's AM-06 sizing update), AD-09
// (HTTP API, no Function URL), AD-11 (no reserved or provisioned concurrency), AM-03 (the HTTP
// API JSON access log is the 30-day query log; the function log group keeps 14 days), research
// R-09 (stage throttle 10 rps / burst 20, X-Ray sampling rule FixedRate 1 for countylens-api),
// contracts/storage.md "Reader" (GetObject on ipfs/* and private/bench/* only) and contracts/
// api.md (routes under /trpc only; every other path is a gateway 404). Bundling is skipped
// here (aws:cdk:bundling-stacks = []) so the suite never runs esbuild or npm; the bundling
// options themselves are asserted from the stack, and COUNTYLENS_BUNDLE=1 runs the real bundle
// once and checks the asset for the linux-arm64 DuckDB binary and the httpfs extension.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import type { ApiStack } from "../src/api-stack.js";
import { AGENT_FUNCTION_NAME, MCP_FUNCTION_NAME } from "../src/api-stack.js";
import { COUNTYLENS_DOMAIN_NAME } from "../src/cert-stack.js";
import type { DataStack } from "../src/data-stack.js";
import { appUnderTest } from "./helpers.js";

const TEST_OPERATOR_EMAIL = "countylens-tests@example.invalid";
process.env.OPERATOR_EMAIL ??= TEST_OPERATOR_EMAIL;

/** Skip NodejsFunction bundling in unit tests (no esbuild, no npm, no network). */
const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: Record<string, unknown>;
}
interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

const json = (v: unknown): string => JSON.stringify(v);
const asList = (a: string | string[]): string[] => (Array.isArray(a) ? a : [a]);

function only<T>(record: Record<string, T>, label: string): [string, T] {
  const entries = Object.entries(record);
  expect(entries, label).toHaveLength(1);
  return entries[0] as [string, T];
}

/** Every property key reachable in a JSON value (for keys that must not exist anywhere). */
function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

function synthApi(): {
  api: ApiStack;
  data: DataStack;
  template: Template;
  resources: Record<string, CfnResource>;
} {
  // Same cdk.json context (feature flags, countylens:* keys) as `cdk synth`, bundling skipped.
  const { stacks } = appUnderTest(SKIP_BUNDLING);
  const template = Template.fromStack(stacks.api);
  return {
    api: stacks.api,
    data: stacks.data,
    template,
    resources: template.toJSON().Resources as Record<string, CfnResource>,
  };
}

/** The pinned `@duckdb/node-api` version of apps/api: infra must install exactly that one. */
function apiPackageDuckDbVersion(): string {
  const pkgPath = fileURLToPath(new URL("../../apps/api/package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const version = pkg.dependencies?.["@duckdb/node-api"];
  expect(version, "apps/api pins @duckdb/node-api").toMatch(/^\d+\.\d+\.\d+(-r\.\d+)?$/);
  return version as string;
}

// A-14 added a second Lambda/HTTP API/stage to this same stack (the MCP block, T018), so these
// tests scope every lookup to the tRPC resources by name/ApiId rather than assuming the stack
// holds exactly one of each — the MCP block has its own test file (countylens-api-mcp.test.ts).
function lambdaFunction(template: Template): [string, CfnResource] {
  return only(
    template.findResources("AWS::Lambda::Function", {
      Properties: { FunctionName: "countylens-api" },
    }) as Record<string, CfnResource>,
    "exactly one countylens-api Lambda function",
  );
}

function httpApi(template: Template): [string, CfnResource] {
  return only(
    template.findResources("AWS::ApiGatewayV2::Api", {
      Properties: { Name: "countylens-api" },
    }) as Record<string, CfnResource>,
    "exactly one countylens-api HTTP API",
  );
}

/** The tRPC role's own policies (IAM::Policy resources whose Roles include it), excluding the
 *  MCP Lambda's separate role and grant. */
function policiesForRole(
  resources: Record<string, CfnResource>,
  roleLogicalId: string,
): CfnResource[] {
  return Object.values(resources).filter((r) => {
    if (r.Type !== "AWS::IAM::Policy") return false;
    const roles = (r.Properties as { Roles?: unknown[] }).Roles ?? [];
    return roles.some((ref) => json(ref).includes(`"${roleLogicalId}"`));
  });
}

describe("CountyLensApi: the tRPC Lambda (ADR-0001 sizing, AM-06)", () => {
  const { template, resources, data } = synthApi();

  it("A-03-TC-053: no ReservedConcurrentExecutions, no ProvisionedConcurrencyConfig, no Function URL (AD-11, AD-09)", () => {
    const keys = collectKeys(template.toJSON(), new Set<string>());
    expect(keys.has("ReservedConcurrentExecutions")).toBe(false);
    expect(keys.has("ProvisionedConcurrencyConfig")).toBe(false);
    template.resourceCountIs("AWS::Lambda::Url", 0);
    template.resourceCountIs("AWS::Lambda::Version", 0);
    template.resourceCountIs("AWS::Lambda::Alias", 0);
  });

  it("is exactly one arm64 function: 1,769 MB, 15 s (A-16, A13-6), X-Ray Active, JSON logs, SystemLogLevel WARN", () => {
    const [, fn] = lambdaFunction(template);
    expect(fn.Properties).toMatchObject({
      FunctionName: "countylens-api",
      Architectures: ["arm64"],
      MemorySize: 1769,
      Timeout: 15,
      TracingConfig: { Mode: "Active" },
      LoggingConfig: { LogFormat: "JSON", SystemLogLevel: "WARN" },
    });
    expect(fn.Properties?.Runtime).toMatch(/^nodejs\d+\.x$/);
    expect(fn.Properties?.Handler).toBe("index.handler");
    expect(Object.keys(fn.Properties?.Code as object).sort()).toEqual(["S3Bucket", "S3Key"]);
    expect((fn.Properties as { Code: { S3Bucket: unknown; S3Key: unknown } }).Code.S3Key).toMatch(
      /\.zip$/,
    );
  });

  it("RUNS_INDEX_URL: the tRPC, MCP and agent Lambdas read the run index from the site, not from S3", () => {
    const url = `https://${COUNTYLENS_DOMAIN_NAME}/runs/index.json`;
    for (const name of ["countylens-api", MCP_FUNCTION_NAME, AGENT_FUNCTION_NAME]) {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: name,
        Environment: { Variables: { RUNS_INDEX_URL: url } },
      });
    }
  });

  it("environment: CID_COPY_BUCKET, CID_COPY_HOST, FILEBASE_GATEWAY_HOST, READPATH_PRIVATE_PREFIX and nothing secret", () => {
    const [, fn] = lambdaFunction(template);
    const env = (fn.Properties as { Environment: { Variables: Record<string, unknown> } })
      .Environment.Variables;
    // The bucket name and the CloudFront host come from CountyLensData (cross-stack exports).
    // Weak references (cdk.json defaultCrossStackReferences) render as Fn::GetStackOutput;
    // strong ones as Fn::ImportValue. Either way the value is CountyLensData's, never a literal.
    expect(json(env.CID_COPY_BUCKET)).toMatch(/Fn::GetStackOutput|Fn::ImportValue/);
    expect(json(env.CID_COPY_BUCKET)).toContain("CountyLensData");
    expect(json(env.CID_COPY_HOST)).toMatch(/Fn::GetStackOutput|Fn::ImportValue/);
    expect(env.FILEBASE_GATEWAY_HOST).toBe("ipfs.filebase.io");
    expect(env.READPATH_PRIVATE_PREFIX).toBe(data.privateBenchPrefix);
    expect(env.READPATH_PRIVATE_PREFIX).toBe("private/bench/");
    expect(env.POWERTOOLS_SERVICE_NAME).toBe("countylens-api");
    expect(env.POWERTOOLS_METRICS_NAMESPACE).toBe("CountyLens");
    expect(String(env.NODE_OPTIONS)).toContain("--enable-source-maps");
    // apps/api/src/engine/duckdb-node.ts EXTENSION_DIRECTORY_ENV: the httpfs copy in afterBundling
    // lands at <this dir>/<release>/linux_arm64/httpfs.duckdb_extension.
    expect(env.DUCKDB_EXTENSION_DIRECTORY).toBe("/var/task/duckdb-extensions");
    // No credential-shaped key: the Lambda reads S3 through its role and presigns in-process.
    expect(
      Object.keys(env).filter((k) => /SECRET|TOKEN|PASSWORD|ACCESS_KEY|API_KEY/i.test(k)),
    ).toEqual([]);
    for (const value of Object.values(env)) {
      expect(json(value)).not.toMatch(/X-Amz-|AKIA[0-9A-Z]{16}/);
    }
  });

  it("logs: the function log group keeps 14 days; it is the only log group besides the access log", () => {
    const [, fn] = lambdaFunction(template);
    const ref = (fn.Properties as { LoggingConfig: { LogGroup?: { Ref?: string } } }).LoggingConfig
      .LogGroup?.Ref;
    expect(ref, "LoggingConfig.LogGroup is a Ref to a log group in this stack").toBeDefined();
    const group = resources[ref as string];
    expect(group?.Type).toBe("AWS::Logs::LogGroup");
    expect(group?.Properties?.RetentionInDays).toBe(14);
    // Two log groups belong to the tRPC resources (function + access); the MCP block (T018) adds
    // its own separate pair (countylens-api-mcp.test.ts) and the Agent block (T016) adds its own
    // single function log group (countylens-api-agent.test.ts) — neither asserted here.
    const nonMcpOrAgentLogGroups = Object.keys(resources).filter(
      (id) =>
        resources[id]?.Type === "AWS::Logs::LogGroup" &&
        !id.startsWith("Mcp") &&
        !id.startsWith("Agent"),
    );
    expect(nonMcpOrAgentLogGroups).toHaveLength(2);
  });

  it("reads only ipfs/*, private/bench/*, private/explore-index/* and live/live.json of the CID copy (contracts/storage.md Reader, A-16); lists private/bench/* only", () => {
    const [, fn] = lambdaFunction(template);
    const roleLogicalId = (fn.Properties as { Role: { "Fn::GetAtt": [string, string] } }).Role[
      "Fn::GetAtt"
    ][0];
    // `resources` is shadowed later in this block (the IAM statement's own Resource list, unrelated
    // pre-existing name), so this reads straight from the template rather than the describe-level
    // destructure to avoid that TDZ collision.
    const stackResources = template.toJSON().Resources as Record<string, CfnResource>;
    const statements = policiesForRole(stackResources, roleLogicalId).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement ??
        [],
    );
    const s3 = statements.filter((s) => asList(s.Action).some((a) => a.startsWith("s3:")));
    const gets = s3.filter((s) => asList(s.Action).includes("s3:GetObject"));
    const lists = s3.filter((s) => asList(s.Action).includes("s3:ListBucket"));
    expect(gets).toHaveLength(1);
    expect(lists, "presignPrefix (ListObjectsV2) needs s3:ListBucket on the bucket").toHaveLength(
      1,
    );
    expect(s3).toHaveLength(2);
    for (const s of s3) expect(s.Effect).toBe("Allow");

    const [get] = gets as [Statement];
    expect(asList(get.Action)).toEqual(["s3:GetObject"]);
    const resources = Array.isArray(get.Resource) ? get.Resource : [get.Resource];
    expect(resources).toHaveLength(4);
    const rendered = resources.map(json);
    expect(rendered.some((r) => r.includes("/ipfs/*"))).toBe(true);
    expect(rendered.some((r) => r.includes("/private/bench/*"))).toBe(true);
    expect(rendered.some((r) => r.includes("/private/explore-index/*"))).toBe(true);
    expect(rendered.some((r) => r.includes('/live/live.json"'))).toBe(true);
    for (const r of rendered) {
      expect(r).toMatch(
        /\/(ipfs\/\*|private\/bench\/\*|private\/explore-index\/\*|live\/live\.json")/,
      );
      expect(r).not.toMatch(/"\/\*"|"\*"/);
    }

    // ListBucket on the bucket ARN itself (no object path), only for keys under private/bench/.
    const [list] = lists as [Statement];
    expect(asList(list.Action)).toEqual(["s3:ListBucket"]);
    const listResources = Array.isArray(list.Resource) ? list.Resource : [list.Resource];
    expect(listResources).toHaveLength(1);
    expect(json(listResources[0])).not.toMatch(/\/\*|ipfs|private/);
    expect(list.Condition).toEqual({ StringLike: { "s3:prefix": ["private/bench/*"] } });

    const allActions = statements.flatMap((s) => asList(s.Action));
    expect(allActions.filter((a) => /^s3:(Put|Delete|\*)/.test(a))).toEqual([]);
    expect(allActions.filter((a) => /^s3:List/.test(a))).toEqual(["s3:ListBucket"]);
    // No managed policy on the execution role: logs and X-Ray are explicit statements.
    for (const role of Object.values(template.findResources("AWS::IAM::Role"))) {
      expect(
        (role.Properties as { ManagedPolicyArns?: unknown[] }).ManagedPolicyArns ?? [],
      ).toEqual([]);
    }
  });
});

describe("CountyLensApi: HTTP API, throttles and the 30-day JSON access log (AD-09, AM-03)", () => {
  const { template, resources } = synthApi();

  it("has one HTTP API with routes under /trpc only, Lambda proxy v2, no authorizer", () => {
    const [apiId] = httpApi(template);
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "countylens-api",
      ProtocolType: "HTTP",
    });
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).filter((r) =>
      json((r.Properties as { ApiId: unknown }).ApiId).includes(`"${apiId}"`),
    );
    expect(routes.length).toBeGreaterThan(0);
    const keys = routes.map((r) => (r.Properties as { RouteKey: string }).RouteKey).sort();
    // A-16: explore.search has its own route key so it can carry a route-level throttle.
    expect(keys).toEqual(["ANY /trpc/explore.search", "GET /trpc/{proxy+}", "POST /trpc/{proxy+}"]);
    for (const r of routes) {
      expect((r.Properties as { AuthorizationType?: string }).AuthorizationType ?? "NONE").toBe(
        "NONE",
      );
    }
    template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      IntegrationType: "AWS_PROXY",
      PayloadFormatVersion: "2.0",
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "apigateway.amazonaws.com",
      SourceArn: Match.anyValue(),
    });
    // One invoke permission per route of this API, each scoped to its execute-api ARN.
    const permissions = Object.values(template.findResources("AWS::Lambda::Permission")).filter(
      (p) => json(p.Properties?.SourceArn).includes("/trpc/"),
    );
    expect(permissions).toHaveLength(3);
    for (const permission of permissions) {
      expect(permission.Properties?.Principal).toBe("apigateway.amazonaws.com");
      expect(json(permission.Properties?.SourceArn)).toContain("execute-api");
      expect(json(permission.Properties?.SourceArn)).toContain("/trpc/");
    }
  });

  it("A-03-TC-053: the $default stage throttles at 10 rps / burst 20 and auto-deploys", () => {
    const [apiId] = httpApi(template);
    const [, stage] = only(
      Object.fromEntries(
        Object.entries(template.findResources("AWS::ApiGatewayV2::Stage")).filter(([, s]) =>
          json((s as CfnResource).Properties?.ApiId).includes(`"${apiId}"`),
        ),
      ),
      "the tRPC API's own stage",
    );
    expect(stage.Properties).toMatchObject({
      StageName: "$default",
      AutoDeploy: true,
    });
    expect(stage.Properties?.DefaultRouteSettings).toMatchObject({
      ThrottlingRateLimit: 10,
      ThrottlingBurstLimit: 20,
    });
    // A-16 (A13-6, A14-3): explore.search is throttled tighter, on its own route key only.
    expect(stage.Properties?.RouteSettings).toEqual({
      "ANY /trpc/explore.search": { ThrottlingRateLimit: 3, ThrottlingBurstLimit: 6 },
    });
  });

  it("access log (the query log, AM-03): JSON lines with request id, route, status and latency into a 30-day group; identifiers and counts only", () => {
    const [apiId] = httpApi(template);
    const [, stage] = only(
      Object.fromEntries(
        Object.entries(template.findResources("AWS::ApiGatewayV2::Stage")).filter(([, s]) =>
          json((s as CfnResource).Properties?.ApiId).includes(`"${apiId}"`),
        ),
      ),
      "the tRPC API's own stage",
    );
    const settings = (
      stage.Properties as { AccessLogSettings?: { DestinationArn?: unknown; Format?: string } }
    ).AccessLogSettings;
    expect(settings?.Format, "access log format").toBeDefined();
    const format = JSON.parse(settings?.Format as string) as Record<string, string>;
    const fields = Object.values(format);
    for (const required of [
      "$context.requestId",
      "$context.routeKey",
      "$context.status",
      "$context.responseLatency",
      "$context.integrationLatency",
    ]) {
      expect(fields, required).toContain(required);
    }
    // FR-007: identifiers and counts only. No caller identity, no query string.
    expect(fields.filter((f) => /identity|queryString|authorizer/i.test(f))).toEqual([]);
    const arn = json(settings?.DestinationArn);
    const groupId = Object.keys(resources).find(
      (id) => resources[id]?.Type === "AWS::Logs::LogGroup" && arn.includes(`"${id}"`),
    );
    expect(groupId, "DestinationArn points at a log group of this stack").toBeDefined();
    expect(resources[groupId as string]?.Properties?.RetentionInDays).toBe(30);
  });

  it("X-Ray: AWS::XRay::SamplingRule FixedRate 1 for service countylens-api (NFR-004)", () => {
    template.resourceCountIs("AWS::XRay::SamplingRule", 1);
    template.hasResourceProperties("AWS::XRay::SamplingRule", {
      SamplingRule: Match.objectLike({
        FixedRate: 1,
        ServiceName: "countylens-api",
        Host: "*",
        HTTPMethod: "*",
        URLPath: "*",
        ResourceARN: "*",
        ServiceType: "*",
        Version: 1,
      }),
    });
  });

  it("outputs HttpApiUrl (mirrored to SSM /countylens/api/http-api-url), the function name and both log group names", () => {
    template.hasOutput("HttpApiUrl", { Value: Match.anyValue() });
    // CDK's ApiEndpoint attribute resolves to https://{id}.execute-api.{region}.amazonaws.com.
    const [apiId] = httpApi(template);
    expect(template.toJSON().Outputs.HttpApiUrl.Value).toEqual({
      "Fn::GetAtt": [apiId, "ApiEndpoint"],
    });
    const url = json(template.toJSON().Outputs.HttpApiUrl.Value);
    expect(url).not.toMatch(/\/\$default|\/$/);
    template.hasOutput("ApiFunctionName", { Value: { Ref: Match.anyValue() } });
    template.hasOutput("ApiFunctionLogGroupName", { Value: { Ref: Match.anyValue() } });
    template.hasOutput("ApiAccessLogGroupName", { Value: { Ref: Match.anyValue() } });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/countylens/api/http-api-url",
      Type: "String",
    });
  });

  it("tags project_name=oracle-travis on the function, log groups, API, stage and sampling rule", () => {
    const taggable = Object.values(resources).filter((r) =>
      [
        "AWS::Lambda::Function",
        "AWS::Logs::LogGroup",
        "AWS::ApiGatewayV2::Api",
        "AWS::ApiGatewayV2::Stage",
        "AWS::XRay::SamplingRule",
        "AWS::IAM::Role",
        "AWS::SSM::Parameter",
      ].includes(r.Type),
    );
    expect(taggable.length).toBeGreaterThanOrEqual(8);
    for (const r of taggable) {
      expect(json(r.Properties?.Tags), r.Type).toContain("oracle-travis");
    }
  });
});

describe("CountyLensApi: bundling (research R-03; arm64 DuckDB + httpfs in the asset)", () => {
  const { api, template } = synthApi();

  it("esbuild options: ESM for the runtime's Node major, @duckdb/* external, source maps", () => {
    const bundling = api.bundling;
    expect(bundling, "ApiStack.bundling holds the NodejsFunction bundling options").toBeDefined();
    const [, fn] = lambdaFunction(template);
    const major = /^nodejs(\d+)\.x$/.exec(String(fn.Properties?.Runtime))?.[1];
    expect(bundling.target).toBe(`node${major}`);
    expect(bundling.format).toBe("esm");
    // Only the native DuckDB packages stay external; everything else (Powertools incl.
    // @aws-lambda-powertools/jmespath, the AWS SDK v3 clients, tRPC) is bundled.
    expect(bundling.externalModules).toEqual(["@duckdb/*"]);
    expect(bundling.sourceMap).toBe(true);
    expect(bundling.forceDockerBundling ?? false).toBe(false);
  });

  it("afterBundling installs @duckdb/node-api at the apps/api pin for linux/arm64/glibc and copies httpfs", () => {
    const hooks = api.bundling.commandHooks;
    expect(hooks, "commandHooks").toBeDefined();
    expect(hooks?.beforeBundling("/in", "/out")).toEqual([]);
    expect(hooks?.beforeInstall("/in", "/out")).toEqual([]);
    const after = (hooks?.afterBundling("/in", "/out") ?? []).join("\n");
    const pin = apiPackageDuckDbVersion();
    expect(after).toContain(`npm install --prefix /out --os=linux --cpu=arm64 --libc=glibc`);
    expect(after).toContain(`@duckdb/node-api@${pin}`);
    const duckdbVersion = `v${pin.split("-")[0]}`;
    expect(after).toContain(
      `https://extensions.duckdb.org/${duckdbVersion}/linux_arm64/httpfs.duckdb_extension.gz`,
    );
    expect(after).toContain(
      `/out/duckdb-extensions/${duckdbVersion}/linux_arm64/httpfs.duckdb_extension`,
    );
  });

  it.skipIf(process.env.COUNTYLENS_BUNDLE !== "1")(
    "COUNTYLENS_BUNDLE=1: the real asset holds the linux-arm64 DuckDB binary and the httpfs extension",
    () => {
      const { app, stacks } = appUnderTest({ "aws:cdk:bundling-stacks": ["**"] });
      const assembly = app.synth();
      // The staged Lambda asset: the assembly's asset.<hash> directory named by the function's S3Key.
      const [, fn] = lambdaFunction(Template.fromStack(stacks.api));
      const key = String((fn.Properties?.Code as { S3Key: string }).S3Key).replace(/\.zip$/, "");
      const dir = readdirSync(assembly.directory)
        .filter((name) => name === `asset.${key}`)
        .map((name) => join(assembly.directory, name))
        .find((p) => existsSync(join(p, "index.mjs")));
      expect(dir, "a staged asset directory with index.mjs").toBeDefined();
      const pin = apiPackageDuckDbVersion();
      const duckdbVersion = `v${pin.split("-")[0]}`;
      const binary = join(
        dir as string,
        "node_modules/@duckdb/node-bindings-linux-arm64/libduckdb.so",
      );
      expect(existsSync(binary), binary).toBe(true);
      expect(statSync(binary).size).toBeGreaterThan(10_000_000);
      const nodeApi = JSON.parse(
        readFileSync(join(dir as string, "node_modules/@duckdb/node-api/package.json"), "utf8"),
      ) as { version: string };
      expect(nodeApi.version).toBe(pin);
      expect(
        existsSync(join(dir as string, "node_modules/@duckdb/node-bindings-darwin-arm64")),
      ).toBe(false);
      const httpfs = join(
        dir as string,
        `duckdb-extensions/${duckdbVersion}/linux_arm64/httpfs.duckdb_extension`,
      );
      expect(existsSync(httpfs), httpfs).toBe(true);
      expect(statSync(httpfs).size).toBeGreaterThan(1_000_000);
    },
    // esbuild + a linux-arm64 npm install: well over Vitest's 5 s default under a parallel run.
    120_000,
  );
});
