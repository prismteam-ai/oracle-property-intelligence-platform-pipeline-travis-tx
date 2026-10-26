// A-16 T020 (AC-2, AC-11; FR-002, FR-011, NFR-001): the whole CDK app, all six stacks, fails
// its synth checks when anything that bills while idle, a wrong log retention, a literal
// region, open sign-up or an inbound path to the operator's laptop is introduced. Written before
// the Cognito pool, the admin queue and the new alarms existed (red first, constitution X).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ADMIN_GROUP_NAME } from "../src/config.js";
import { MONTHLY_BUDGET_USD } from "../src/ops-stack.js";
import { appUnderTest } from "./helpers.js";

process.env.OPERATOR_EMAIL ??= "countylens-tests@example.invalid";

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}
interface Flat {
  stack: string;
  id: string;
  resource: CfnResource;
}

const { stacks } = appUnderTest();
const templates: Record<string, Template> = {
  CountyLensData: Template.fromStack(stacks.data),
  CountyLensApi: Template.fromStack(stacks.api),
  CountyLensWeb: Template.fromStack(stacks.web),
  CountyLensOps: Template.fromStack(stacks.ops),
  CountyLensCert: Template.fromStack(stacks.cert),
  CountyLensScheduler: Template.fromStack(stacks.scheduler),
};
const all: Flat[] = Object.entries(templates).flatMap(([stack, t]) =>
  Object.entries((t.toJSON().Resources ?? {}) as Record<string, CfnResource>).map(
    ([id, resource]) => ({ stack, id, resource }),
  ),
);
const ofType = (type: string): Flat[] => all.filter((r) => r.resource.Type === type);
const json = (value: unknown): string => JSON.stringify(value ?? null);

describe("A-16 AC-2: $0 idle (synth)", () => {
  it("six stacks are under test", () => {
    expect(Object.keys(templates)).toHaveLength(6);
    expect(all.length).toBeGreaterThan(0);
  });

  it("the scheduler is DISABLED", () => {
    const schedules = ofType("AWS::Scheduler::Schedule");
    expect(schedules.length).toBeGreaterThanOrEqual(1);
    for (const s of schedules) expect(s.resource.Properties?.State, s.id).toBe("DISABLED");
  });

  it.each([
    ["AWS::SecretsManager::Secret", "secrets vault"],
    ["AWS::RDS::DBInstance", "relational database"],
    ["AWS::RDS::DBCluster", "relational database"],
    ["AWS::KMS::Key", "customer-managed key"],
    ["AWS::WAFv2::WebACL", "web firewall"],
    ["AWS::Route53::HostedZone", "hosted DNS zone"],
    ["AWS::EC2::NatGateway", "NAT gateway"],
    ["AWS::ECS::Service", "always-on container service"],
  ])("no %s (%s)", (type) => {
    expect(ofType(type).map((r) => `${r.stack}/${r.id}`)).toEqual([]);
  });

  it("no provisioned or reserved Lambda concurrency anywhere", () => {
    const offenders = all
      .filter((r) => {
        const p = json(r.resource.Properties);
        return (
          p.includes("ProvisionedConcurrencyConfig") || p.includes("ReservedConcurrentExecutions")
        );
      })
      .map((r) => `${r.stack}/${r.id}`);
    expect(offenders).toEqual([]);
  });

  it("every log group keeps 14 days, the HTTP API access (query) logs 30", () => {
    const accessLogTargets = ofType("AWS::ApiGatewayV2::Stage")
      .map((s) =>
        json(
          (s.resource.Properties?.AccessLogSettings as { DestinationArn?: unknown })
            ?.DestinationArn,
        ),
      )
      .join(" ");
    const groups = ofType("AWS::Logs::LogGroup");
    expect(groups.length).toBeGreaterThanOrEqual(7);
    for (const g of groups) {
      const expected = accessLogTargets.includes(`"${g.id}"`) ? 30 : 14;
      expect(g.resource.Properties?.RetentionInDays, `${g.stack}/${g.id}`).toBe(expected);
    }
    // No Lambda writes to a log group CDK did not create with a retention (Custom::LogRetention
    // would mean an implicit /aws/lambda/<name> group that never expires).
    expect(ofType("Custom::LogRetention")).toEqual([]);
  });

  it(`the $${MONTHLY_BUDGET_USD} monthly cost budget exists`, () => {
    expect(MONTHLY_BUDGET_USD).toBe(10);
    const budgets = ofType("Custom::CountyLensBudget");
    expect(budgets).toHaveLength(1);
    expect(json(budgets[0]?.resource.Properties?.Create)).toContain(
      `\\"BudgetLimit\\":{\\"Amount\\":\\"10\\",\\"Unit\\":\\"USD\\"}`,
    );
  });

  it("no literal region in infra/src (the region comes from config.ts / CDK_DEFAULT_REGION)", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const regionLiteral = new RegExp(
      `\\b(${["eu", "us", "ap", "ca", "sa", "af", "me", "il"].join("|")})-` +
        `(north|south|east|west|central|northeast|southeast|northwest|southwest)-\\d\\b`,
    );
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : name.endsWith(".ts") ? [full] : [];
      });
    })(srcRoot);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((f) => regionLiteral.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });
});

describe("A-16 AC-11: admin sign-in and command queue (synth)", () => {
  const api = Template.fromStack(stacks.api);

  it("one user pool, self sign-up off (AllowAdminCreateUserOnly), email as the username, no trigger Lambda", () => {
    const pools = ofType("AWS::Cognito::UserPool");
    expect(pools).toHaveLength(1);
    expect(pools[0]?.stack).toBe("CountyLensApi");
    const p = pools[0]?.resource.Properties ?? {};
    expect(p.AdminCreateUserConfig).toMatchObject({ AllowAdminCreateUserOnly: true });
    expect(p.UsernameAttributes).toEqual(["email"]);
    expect(p.LambdaConfig).toBeUndefined();
    // Essentials/Plus tiers and advanced security bill per user: Lite, no add-ons.
    expect(p.UserPoolTier).toBe("LITE");
    expect(p.UserPoolAddOns).toBeUndefined();
  });

  it("one SRP app client without a secret, and the admin group", () => {
    api.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
    const client = Object.values(api.findResources("AWS::Cognito::UserPoolClient"))[0];
    expect(client?.Properties?.GenerateSecret).toBe(false);
    expect(client?.Properties?.ExplicitAuthFlows).toEqual(
      expect.arrayContaining(["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]),
    );
    expect(client?.Properties?.ExplicitAuthFlows).not.toContain("ALLOW_USER_PASSWORD_AUTH");
    expect(client?.Properties?.PreventUserExistenceErrors).toBe("ENABLED");
    api.resourceCountIs("AWS::Cognito::UserPoolGroup", 1);
    api.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: ADMIN_GROUP_NAME });
    expect(ofType("AWS::Cognito::UserPoolDomain")).toEqual([]);
    expect(ofType("AWS::Cognito::IdentityPool")).toEqual([]);
  });

  it("the command queue has a DLQ after 3 receives, and the DLQ has exactly one alarm that notifies", () => {
    const queues = ofType("AWS::SQS::Queue").filter((q) => q.stack === "CountyLensApi");
    const main = queues.filter((q) => q.resource.Properties?.RedrivePolicy !== undefined);
    expect(main).toHaveLength(1);
    expect(main[0]?.resource.Properties?.RedrivePolicy).toMatchObject({ maxReceiveCount: 3 });
    const dlqId = json(
      (main[0]?.resource.Properties?.RedrivePolicy as { deadLetterTargetArn?: unknown })
        .deadLetterTargetArn,
    );
    const dlq = queues.find((q) => dlqId.includes(q.id));
    expect(dlq).toBeDefined();
    const alarms = ofType("AWS::CloudWatch::Alarm").filter((a) =>
      json(a.resource.Properties?.Dimensions).includes(dlq?.id ?? "(no DLQ)"),
    );
    expect(alarms).toHaveLength(1);
    expect(alarms[0]?.resource.Properties?.AlarmActions).toHaveLength(1);
    expect(alarms[0]?.resource.Properties?.OKActions).toHaveLength(1);
  });

  it("no queue resource policy and no SQS → Lambda event source (nothing pushes to or past the queue)", () => {
    expect(ofType("AWS::SQS::QueuePolicy").filter((q) => q.stack === "CountyLensApi")).toEqual([]);
    expect(ofType("AWS::Lambda::EventSourceMapping")).toEqual([]);
  });

  it("the API role may only SendMessage to the queue (no receive, no delete, no wildcard)", () => {
    const statements = Object.values(api.findResources("AWS::IAM::Policy"))
      .flatMap(
        (p) => (p.Properties?.PolicyDocument as { Statement: Record<string, unknown>[] }).Statement,
      )
      .filter((s) => json(s.Action).includes("sqs:"));
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toBe("sqs:SendMessage");
    expect(json(statements[0]?.Resource)).not.toContain("*");
  });

  it("no inbound path to the operator machine: every API integration is a Lambda proxy, no open ingress", () => {
    for (const i of ofType("AWS::ApiGatewayV2::Integration")) {
      expect(i.resource.Properties?.IntegrationType, `${i.stack}/${i.id}`).toBe("AWS_PROXY");
    }
    expect(ofType("AWS::ApiGatewayV2::VpcLink")).toEqual([]);
    const ingress = [
      ...ofType("AWS::EC2::SecurityGroupIngress").map((r) => r.resource.Properties),
      ...ofType("AWS::EC2::SecurityGroup").flatMap(
        (r) => (r.resource.Properties?.SecurityGroupIngress as Record<string, unknown>[]) ?? [],
      ),
    ];
    expect(ingress).toEqual([]);
  });
});

describe("A-16 AC-11: no Query DB connection string in apps/ or infra/ (grep gate)", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  // This file and the A-11 gate spell out what they forbid in their own pattern comments.
  const gates = new Set([
    fileURLToPath(new URL(import.meta.url)),
    fileURLToPath(new URL("./no-connection-string.test.ts", import.meta.url)),
  ]);
  const skip = new Set(["node_modules", "cdk.out", "coverage", "dist", ".turbo", ".git"]);
  const files = (function walk(dir: string): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      if (skip.has(name)) return [];
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx|js|mjs|cjs|json|env|ya?ml)$/.test(name) ? [full] : [];
    });
  })(join(repoRoot, "apps")).concat(
    (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        if (skip.has(name)) return [];
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(ts|json|ya?ml)$/.test(name) ? [full] : [];
      });
    })(join(repoRoot, "infra")),
  );
  // Built from parts so neither this file's text nor scripts/grep-gates.sh matches it.
  const pg = ["post", "gres"].join("");
  const schemes = [pg, `${pg}ql`, "mysql", "mariadb", "mongodb", "mongodb\\+srv", "jdbc:[a-z]+"];
  const connectionString = new RegExp(`\\b(${schemes.join("|")}):\\/\\/`, "i");
  const keyValueDsn = /\b(Host|Server)=[^;\s"'`]+;\s*(Database|Port)=/i;

  it("scans apps/ and infra/", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no database URL or key=value DSN", () => {
    const offenders = files
      .filter((f) => !gates.has(f))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return connectionString.test(text) || keyValueDsn.test(text);
      })
      .map((f) => relative(repoRoot, f));
    expect(offenders).toEqual([]);
  });
});
