// A-14 T010 (G-4): CDK assertions for the MCP block of CountyLensApi (infra/src/api-stack.ts),
// implemented at T018. AD-21: the MCP server is a separate Lambda from the tRPC API above, with
// its own route-level throttle (not stage-wide) and its own scoped SSM read grant — never
// Secrets Manager (AD-14). Written before the MCP block exists: the red run fails because
// api-stack.ts exports none of the MCP constants imported below.
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  MCP_FUNCTION_NAME,
  MCP_MEMORY_MB,
  MCP_ROUTE_PATH,
  MCP_THROTTLE,
  MCP_TOKEN_PARAMETER_NAME,
} from "../src/api-stack.js";
import { appUnderTest } from "./helpers.js";

const TEST_OPERATOR_EMAIL = "countylens-tests@example.invalid";
process.env.OPERATOR_EMAIL ??= TEST_OPERATOR_EMAIL;

const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
}
interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

const asList = (a: string | string[]): string[] => (Array.isArray(a) ? a : [a]);
const json = (v: unknown): string => JSON.stringify(v);

function synthApi(): { template: Template; resources: Record<string, CfnResource> } {
  const { stacks } = appUnderTest(SKIP_BUNDLING);
  const template = Template.fromStack(stacks.api);
  return { template, resources: template.toJSON().Resources as Record<string, CfnResource> };
}

describe("CountyLensApi MCP resources (A-14 T010/T018): a Lambda distinct from the tRPC one", () => {
  it("the MCP Lambda is arm64, 1,769 MB (A-16), no reserved or provisioned concurrency, and is a distinct function from countylens-api", () => {
    const { template, resources } = synthApi();
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: MCP_FUNCTION_NAME,
      Architectures: ["arm64"],
      MemorySize: MCP_MEMORY_MB,
    });
    expect(MCP_MEMORY_MB).toBe(1769); // A-16: on the per-run Explore index
    expect(MCP_FUNCTION_NAME).not.toBe("countylens-api");

    const functions = Object.values(resources).filter((r) => r.Type === "AWS::Lambda::Function");
    expect(functions.length).toBeGreaterThanOrEqual(2);
    const names = functions.map((f) => f.Properties?.FunctionName);
    expect(names).toContain(MCP_FUNCTION_NAME);
    expect(names).toContain("countylens-api");

    const allProps = JSON.stringify(Object.values(resources));
    expect(allProps).not.toContain("ReservedConcurrentExecutions");
    expect(allProps).not.toContain("ProvisionedConcurrencyConfig");
    template.resourceCountIs("AWS::Lambda::Url", 0);
  });

  it("POST /mcp exists on an HTTP API distinct from the tRPC one, with a route-level (not stage-wide) 5 rps / burst 10 throttle", () => {
    const { template, resources } = synthApi();
    expect(MCP_THROTTLE).toEqual({ rateLimit: 5, burstLimit: 10 });

    const apis = Object.values(template.findResources("AWS::ApiGatewayV2::Api"));
    expect(apis.length).toBeGreaterThanOrEqual(2);
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route"));
    const mcpRoute = routes.find(
      (r) => (r.Properties as { RouteKey: string }).RouteKey === `POST ${MCP_ROUTE_PATH}`,
    );
    expect(mcpRoute, "POST /mcp route exists").toBeDefined();

    // Route-level throttle: a RouteSettings entry keyed "POST /mcp" on some stage, not the
    // DefaultRouteSettings (which would throttle every route on that stage, including GET
    // /health and, if it were the same API, the tRPC API's own routes).
    const stages = Object.values(template.findResources("AWS::ApiGatewayV2::Stage"));
    const stageWithMcpThrottle = stages.find((s) => {
      const routeSettings = (s.Properties as { RouteSettings?: Record<string, unknown> })
        .RouteSettings;
      const entry = routeSettings?.[`POST ${MCP_ROUTE_PATH}`] as
        { ThrottlingRateLimit?: number; ThrottlingBurstLimit?: number } | undefined;
      return (
        entry?.ThrottlingRateLimit === MCP_THROTTLE.rateLimit &&
        entry?.ThrottlingBurstLimit === MCP_THROTTLE.burstLimit
      );
    });
    expect(
      stageWithMcpThrottle,
      "a stage carries the POST /mcp route-level throttle",
    ).toBeDefined();

    // The tRPC API's own $default stage keeps its original 10 rps / burst 20 stage-wide
    // throttle, unaffected by the MCP block (no shared throttle object).
    const trpcStage = stages.find(
      (s) =>
        (s.Properties as { DefaultRouteSettings?: { ThrottlingRateLimit?: number } })
          .DefaultRouteSettings?.ThrottlingRateLimit === 10,
    );
    expect(trpcStage, "the tRPC stage's own 10 rps default throttle is untouched").toBeDefined();

    expect(Object.keys(resources).length).toBeGreaterThan(0);
  });

  it("GET /health exists with no authorizer (the MCP Lambda itself answers it without checking the token)", () => {
    const { template } = synthApi();
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route"));
    const health = routes.find(
      (r) => (r.Properties as { RouteKey: string }).RouteKey === "GET /health",
    );
    expect(health, "GET /health route exists").toBeDefined();
    expect((health?.Properties as { AuthorizationType?: string }).AuthorizationType ?? "NONE").toBe(
      "NONE",
    );
  });

  it("exactly one ssm:GetParameter grant, scoped to MCP_TOKEN_PARAMETER_NAME only, no wildcard", () => {
    const { template } = synthApi();
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement ??
        [],
    );
    const ssmGets = statements.filter((s) => asList(s.Action).includes("ssm:GetParameter"));
    expect(ssmGets).toHaveLength(1);
    const [grant] = ssmGets as [Statement];
    expect(grant.Effect).toBe("Allow");
    expect(asList(grant.Action)).toEqual(["ssm:GetParameter"]);
    const resources = Array.isArray(grant.Resource) ? grant.Resource : [grant.Resource];
    expect(resources).toHaveLength(1);
    const rendered = json(resources[0]);
    expect(rendered).toContain("parameter");
    expect(rendered).toContain(MCP_TOKEN_PARAMETER_NAME.replace(/^\//, ""));
    expect(rendered).not.toMatch(/"\*"|\/\*"/);

    // No other ssm action anywhere (no PutParameter, no wildcard ssm:*).
    const anySsm = statements.filter((s) => asList(s.Action).some((a) => a.startsWith("ssm:")));
    expect(anySsm).toHaveLength(1);
  });

  it("no Secrets Manager resource or action anywhere in the diff (AD-14)", () => {
    const { resources } = synthApi();
    const whole = JSON.stringify(Object.values(resources));
    expect(whole).not.toMatch(/SecretsManager|secretsmanager:/i);
    const types = new Set(Object.values(resources).map((r) => r.Type));
    expect([...types].some((t) => t.includes("SecretsManager"))).toBe(false);
  });

  it("the MCP function reads the same CID-copy bucket via its own scoped S3 reader grant (contracts/storage.md Reader)", () => {
    const { template, resources } = synthApi();
    const mcpFn = Object.values(resources).find(
      (r) => r.Type === "AWS::Lambda::Function" && r.Properties?.FunctionName === MCP_FUNCTION_NAME,
    );
    expect(mcpFn).toBeDefined();
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement ??
        [],
    );
    const gets = statements.filter((s) => asList(s.Action).includes("s3:GetObject"));
    // One for the tRPC Lambda, one for the MCP Lambda (AD-19: same reader boundary, separate
    // grants since they are separate roles).
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CountyLensApi stages that throttle per route (deploy-order regression)", () => {
  it("each stage with routeSettings depends on the routes it names, or CloudFormation can create the stage first and fail with a 404", () => {
    const { resources } = synthApi();
    const stages = Object.entries(resources).filter(
      ([, r]) =>
        r.Type === "AWS::ApiGatewayV2::Stage" &&
        (r.Properties?.RouteSettings as Record<string, unknown> | undefined) !== undefined,
    );
    expect(stages.length).toBeGreaterThanOrEqual(2);
    for (const [id, stage] of stages) {
      const wanted = Object.keys(stage.Properties?.RouteSettings as Record<string, unknown>);
      const deps = ((stage as { DependsOn?: string[] }).DependsOn ?? []).map(
        (d) => resources[d] as CfnResource,
      );
      for (const key of wanted) {
        const hit = deps.some(
          (d) => d.Type === "AWS::ApiGatewayV2::Route" && d.Properties?.RouteKey === key,
        );
        expect(hit, `${id} must depend on the route ${key}`).toBe(true);
      }
    }
  });
});
