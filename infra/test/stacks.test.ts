// Whole-app CDK assertions for the five CountyLens stacks (A-03 T017; TC-052, TC-053).
// Rules asserted here come from the ARD (AD-11, AD-13, AD-14, NFR-02, P0-18, P0-19, § 16 AM-02)
// and the constitution (III: region from config, tag project_name=oracle-travis; A7: nothing
// that bills while idle). The region comes from CDK_DEFAULT_REGION exactly as in `cdk synth`:
// when it is unset these tests fail with the config error, never with a fallback literal.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import type { CountyLensStacks } from "../src/app.js";
import {
  ALLOWED_REGIONS_CONTEXT_KEY,
  RegionNotAllowedError,
  loadConfig,
  type InfraConfig,
} from "../src/config.js";
import { budgetNameFor } from "../src/ops-stack.js";
import { appUnderTest, cdkJsonContext } from "./helpers.js";

// The alarm and budget recipient is never in git: the Ops stack reads OPERATOR_EMAIL from the
// environment (CI variable, PO shell); the tests use this placeholder when it is unset.
const TEST_OPERATOR_EMAIL = "countylens-tests@example.invalid";
process.env.OPERATOR_EMAIL ??= TEST_OPERATOR_EMAIL;

/** Skip NodejsFunction bundling in unit tests (no esbuild, no npm, no network). */
const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

type StackName =
  "CountyLensData" | "CountyLensApi" | "CountyLensWeb" | "CountyLensOps" | "CountyLensCert";
const STACK_ORDER: readonly StackName[] = [
  "CountyLensData",
  "CountyLensApi",
  "CountyLensWeb",
  "CountyLensOps",
  "CountyLensCert",
];

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
  Metadata?: { cdk_nag?: { rules_to_suppress?: { id?: unknown; reason?: unknown }[] } };
}
interface FlatResource {
  stack: StackName;
  logicalId: string;
  resource: CfnResource;
}

// Resource types that bill by existing (A7, P0-19) or are banned by an AD.
const BANNED_TYPES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^AWS::Route53::HostedZone$/, why: "AD-13: DNS stays at Namecheap" },
  { pattern: /^AWS::SecretsManager::Secret$/, why: "AD-14: SSM SecureString only" },
  { pattern: /^AWS::KMS::Key$/, why: "A7: a CMK bills while idle; SSE-S3 only" },
  { pattern: /^AWS::WAFv2::/, why: "A7: WAF bills while idle" },
  { pattern: /^AWS::CertificateManager::Certificate$/, why: "Amplify issues its own certificate" },
  { pattern: /^AWS::RDS::/, why: "AD-18: no hosted database" },
  { pattern: /^AWS::Lambda::Url$/, why: "AD-09: a Function URL bypasses the HTTP API throttles" },
];

// CloudFormation types in this app that accept tags. A resource of one of these types without
// the project tag fails; any other resource that carries a Tags property is checked too.
const TAGGABLE_TYPES = new Set([
  "AWS::S3::Bucket",
  "AWS::CloudFront::Distribution",
  "AWS::IAM::Role",
  "AWS::SSM::Parameter",
  "AWS::Lambda::Function",
  "AWS::Logs::LogGroup",
  "AWS::SNS::Topic",
  "AWS::SQS::Queue",
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Stage",
  "AWS::CloudWatch::Alarm",
  "AWS::Amplify::App",
  "AWS::Amplify::Branch",
  "AWS::XRay::SamplingRule",
  "AWS::IAM::OIDCProvider",
  "AWS::Budgets::Budget",
]);

const PROJECT_TAG = { key: "project_name", value: "oracle-travis" };

// Region-literal pattern built from parts so this file never contains one itself.
const REGION_LITERAL = new RegExp(
  `\\b(${["eu", "us", "ap", "ca", "sa", "af", "me", "il"].join("|")})-` +
    `(north|south|east|west|central|northeast|southeast|northwest|southwest)-\\d\\b`,
);

// Region ids assembled from parts, for the same reason as REGION_LITERAL above.
const PROJECT_REGION = ["eu", "north", "1"].join("-");
const N_VIRGINIA = ["us", "east", "1"].join("-");
const COMPANY_DEFAULT_REGION = ["us", "east", "2"].join("-");

const TEST_CONTEXT: Record<string, unknown> = {
  "countylens:githubRepository": "owner/repo",
  "countylens:githubRef": "feature/oracle-pipeline",
  "countylens:allowedRegions": [PROJECT_REGION],
};
const contextOf =
  (ctx: Record<string, unknown>) =>
  (key: string): unknown =>
    ctx[key];

function synthAll(): {
  app: App;
  config: InfraConfig;
  stacks: CountyLensStacks;
  templates: Record<StackName, Template>;
} {
  // Same cdk.json context (feature flags, countylens:* keys) as `cdk synth`, bundling skipped.
  const { app, config, stacks } = appUnderTest(SKIP_BUNDLING);
  const templates = {
    CountyLensData: Template.fromStack(stacks.data),
    CountyLensApi: Template.fromStack(stacks.api),
    CountyLensWeb: Template.fromStack(stacks.web),
    CountyLensOps: Template.fromStack(stacks.ops),
    CountyLensCert: Template.fromStack(stacks.cert),
  };
  return { app, config, stacks, templates };
}

function flatten(templates: Record<StackName, Template>): FlatResource[] {
  const out: FlatResource[] = [];
  for (const stack of STACK_ORDER) {
    const resources = (templates[stack].toJSON().Resources ?? {}) as Record<string, CfnResource>;
    for (const [logicalId, resource] of Object.entries(resources)) {
      out.push({ stack, logicalId, resource });
    }
  }
  return out;
}

/**
 * Tags as CloudFormation renders them: a Key/Value list or a map (SSM, API Gateway v2);
 * AWS::Budgets::Budget calls the list ResourceTags.
 */
function tagsOf(props: Record<string, unknown> | undefined): Record<string, string> {
  const raw = props?.Tags ?? props?.ResourceTags;
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const entry of raw as { Key?: unknown; Value?: unknown }[]) {
      if (typeof entry.Key === "string" && typeof entry.Value === "string") {
        out[entry.Key] = entry.Value;
      }
    }
    return out;
  }
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  return {};
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

function listTsFiles(dir: string, skip: Set<string>): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full, skip));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("infra config (constitution III: region from config)", () => {
  it("synth throws when CDK_DEFAULT_REGION is missing", () => {
    expect(() => loadConfig({}, contextOf(TEST_CONTEXT))).toThrow(/CDK_DEFAULT_REGION/);
    expect(() => loadConfig({ CDK_DEFAULT_REGION: "   " }, contextOf(TEST_CONTEXT))).toThrow(
      /CDK_DEFAULT_REGION/,
    );
  });

  it("reads the region from CDK_DEFAULT_REGION and the GitHub repo/ref from context", () => {
    const config = loadConfig(process.env, contextOf(TEST_CONTEXT));
    expect(config.region).toBe(process.env.CDK_DEFAULT_REGION);
    expect(config.github).toEqual({ repository: "owner/repo", ref: "feature/oracle-pipeline" });
    expect(config.projectName).toBe(PROJECT_TAG.value);
  });

  it("metagross M3: refuses a region outside countylens:allowedRegions, naming it (RegionNotAllowedError)", () => {
    for (const region of [N_VIRGINIA, COMPANY_DEFAULT_REGION]) {
      let error: unknown;
      try {
        loadConfig({ CDK_DEFAULT_REGION: region }, contextOf(TEST_CONTEXT));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(RegionNotAllowedError);
      expect((error as Error).name).toBe("RegionNotAllowedError");
      expect((error as Error).message).toContain(region);
      expect((error as Error).message).toContain(ALLOWED_REGIONS_CONTEXT_KEY);
    }
    expect(loadConfig({ CDK_DEFAULT_REGION: PROJECT_REGION }, contextOf(TEST_CONTEXT)).region).toBe(
      PROJECT_REGION,
    );
  });

  it("metagross M3: the allow-list is required context (a non-empty list of region ids)", () => {
    const env = { CDK_DEFAULT_REGION: PROJECT_REGION };
    const without = Object.fromEntries(
      Object.entries(TEST_CONTEXT).filter(([k]) => k !== ALLOWED_REGIONS_CONTEXT_KEY),
    );
    expect(() => loadConfig(env, contextOf(without))).toThrow(ALLOWED_REGIONS_CONTEXT_KEY);
    expect(() =>
      loadConfig(env, contextOf({ ...TEST_CONTEXT, [ALLOWED_REGIONS_CONTEXT_KEY]: [] })),
    ).toThrow(ALLOWED_REGIONS_CONTEXT_KEY);
  });

  it("metagross M3: cdk.json allows exactly the project region, and synth for N. Virginia throws", () => {
    expect(cdkJsonContext()[ALLOWED_REGIONS_CONTEXT_KEY]).toEqual([PROJECT_REGION]);
    const previous = process.env.CDK_DEFAULT_REGION;
    process.env.CDK_DEFAULT_REGION = N_VIRGINIA;
    try {
      expect(() => appUnderTest(SKIP_BUNDLING)).toThrow(RegionNotAllowedError);
    } finally {
      process.env.CDK_DEFAULT_REGION = previous;
    }
  });

  it("rejects a malformed OPERATOR_EMAIL, account or GitHub repository", () => {
    const env = { CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION };
    expect(() =>
      loadConfig({ ...env, OPERATOR_EMAIL: "not-an-email" }, contextOf(TEST_CONTEXT)),
    ).toThrow(/OPERATOR_EMAIL/);
    expect(() =>
      loadConfig({ ...env, CDK_DEFAULT_ACCOUNT: "12" }, contextOf(TEST_CONTEXT)),
    ).toThrow(/CDK_DEFAULT_ACCOUNT/);
    expect(() =>
      loadConfig(env, contextOf({ ...TEST_CONTEXT, "countylens:githubRepository": "no-slash" })),
    ).toThrow(/githubRepository/);
    expect(() => loadConfig(env, contextOf({}))).toThrow(/countylens:githubRepository/);
  });
});

describe("CountyLens app: five stacks in the AM-02 order", () => {
  const { app, config, stacks, templates } = synthAll();
  const all = flatten(templates);

  it("has exactly CountyLensData, CountyLensApi, CountyLensWeb, CountyLensOps, CountyLensCert, plus the unordered CountyLensScheduler", () => {
    const names = app.node.children
      .filter((c): c is Stack => Stack.isStack(c))
      .map((s) => s.stackName);
    // CountyLensScheduler (A-11) is deliberately outside the AM-02 ordered chain below: it has
    // no dependents and only reads DataStack's published SSM parameters, never a direct
    // cross-stack reference, so it never blocks or reorders Data → Api → Web → Ops → Cert.
    expect(names.sort()).toEqual([...STACK_ORDER, "CountyLensScheduler"].sort());
    expect(stacks.data.stackName).toBe("CountyLensData");
    expect(stacks.cert.stackName).toBe("CountyLensCert");
  });

  it("deploys Data → Api → Web → Ops → Cert (ARD § 16 AM-02): explicit chain, and no stack depends on a later one", () => {
    // Cross-stack references (Data.bucket → Api, Api.fn → Ops, …) add implicit dependencies
    // next to the explicit addStackDependency chain; every one must point backwards in AM-02.
    const dependsOn = (s: Stack) => s.dependencies.map((d) => d.stackName as StackName);
    expect(dependsOn(stacks.data)).toEqual([]);
    expect(dependsOn(stacks.api)).toContain("CountyLensData");
    expect(dependsOn(stacks.web)).toContain("CountyLensApi");
    expect(dependsOn(stacks.ops)).toContain("CountyLensWeb");
    expect(dependsOn(stacks.cert)).toContain("CountyLensOps");
    for (const name of STACK_ORDER) {
      const stack = [stacks.data, stacks.api, stacks.web, stacks.ops, stacks.cert].find(
        (s) => s.stackName === name,
      ) as Stack;
      for (const dep of dependsOn(stack)) {
        expect(
          STACK_ORDER.indexOf(dep),
          `${name} depends on ${dep}, which must deploy earlier`,
        ).toBeLessThan(STACK_ORDER.indexOf(name));
      }
    }
  });

  it("every stack takes its region from config, never from a literal", () => {
    for (const stack of Object.values(stacks)) {
      expect(stack.region).toBe(config.region);
      expect(stack.region).toBe(process.env.CDK_DEFAULT_REGION);
    }
  });

  it("no region literal in infra/**/*.ts (P0-18)", () => {
    const infraRoot = fileURLToPath(new URL("..", import.meta.url));
    const files = listTsFiles(infraRoot, new Set(["node_modules", "cdk.out", "coverage", "dist"]));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((f) => REGION_LITERAL.test(readFileSync(f, "utf8")))
      .map((f) => relative(infraRoot, f));
    expect(offenders).toEqual([]);
  });

  it("creates nothing that bills while idle (A7, P0-19): banned resource types are absent", () => {
    const found = all
      .map((r) => ({ ...r, ban: BANNED_TYPES.find((b) => b.pattern.test(r.resource.Type)) }))
      .filter((r) => r.ban !== undefined)
      .map((r) => `${r.stack}/${r.logicalId} (${r.resource.Type}: ${r.ban?.why})`);
    expect(found).toEqual([]);
  });

  it("A-03-TC-053: no Lambda sets ReservedConcurrentExecutions or a ProvisionedConcurrencyConfig (AD-11)", () => {
    const keys = collectKeys(
      Object.fromEntries(STACK_ORDER.map((s) => [s, templates[s].toJSON()])),
      new Set<string>(),
    );
    expect(keys.has("ReservedConcurrentExecutions")).toBe(false);
    expect(keys.has("ProvisionedConcurrencyConfig")).toBe(false);
  });

  it("tags project_name=oracle-travis on every stack and every taggable resource (constitution III)", () => {
    const assembly = app.synth();
    for (const name of STACK_ORDER) {
      expect(assembly.getStackByName(name).tags, `${name} stack tags`).toMatchObject({
        [PROJECT_TAG.key]: PROJECT_TAG.value,
      });
    }
    const untagged = all
      .filter(
        (r) => TAGGABLE_TYPES.has(r.resource.Type) || r.resource.Properties?.Tags !== undefined,
      )
      .filter((r) => tagsOf(r.resource.Properties)[PROJECT_TAG.key] !== PROJECT_TAG.value)
      .map((r) => `${r.stack}/${r.logicalId} (${r.resource.Type})`);
    expect(untagged).toEqual([]);
  });

  it("A-03-TC-052: every AWS::SQS::Queue has a RedrivePolicy or is a DLQ with exactly one alarm (AD-12)", () => {
    const queues = all.filter((r) => r.resource.Type === "AWS::SQS::Queue");
    const alarms = all.filter((r) => r.resource.Type === "AWS::CloudWatch::Alarm");
    const dlqTargets = new Set(
      queues
        .map((q) =>
          JSON.stringify(
            (q.resource.Properties?.RedrivePolicy as { deadLetterTargetArn?: unknown })
              ?.deadLetterTargetArn ?? null,
          ),
        )
        .filter((s) => s !== "null"),
    );
    for (const q of queues) {
      if (q.resource.Properties?.RedrivePolicy !== undefined) continue;
      const isDlq = [...dlqTargets].some((target) => target.includes(q.logicalId));
      expect(isDlq, `${q.stack}/${q.logicalId} has no RedrivePolicy and is not a DLQ`).toBe(true);
      const alarmsOnQueue = alarms.filter((a) =>
        JSON.stringify(a.resource.Properties).includes(q.logicalId),
      );
      expect(alarmsOnQueue, `${q.stack}/${q.logicalId} DLQ alarms`).toHaveLength(1);
    }
  });

  it("cdk-nag AwsSolutions: no unacknowledged finding, and every acknowledgement carries a documented reason", () => {
    // cdk-nag v3 reports through CDK's Validations API: synth already throws on an
    // unacknowledged finding; validateScope() gives the readable list for this assertion.
    for (const stack of Object.values(stacks)) {
      const report = new AwsSolutionsChecks(app, { verbose: true }).validateScope(stack);
      expect(
        report.violations.map(
          (v) =>
            `${v.ruleName}: ${v.violatingResources.map((r) => r.resourceLogicalId).join(", ")}`,
        ),
        `${stack.stackName} cdk-nag findings`,
      ).toEqual([]);
      expect(report.success, `${stack.stackName} cdk-nag success`).toBe(true);
    }
    const acknowledged = all.flatMap((r) =>
      (r.resource.Metadata?.cdk_nag?.rules_to_suppress ?? []).map((s) => ({
        ...s,
        at: `${r.stack}/${r.logicalId}`,
      })),
    );
    expect(
      acknowledged.length,
      "acknowledgements are written to the template metadata",
    ).toBeGreaterThan(0);
    for (const s of acknowledged) {
      // cdk-nag AwsSolutions findings, or CDK's own template validator (F0001: an empty stack
      // that is deliberately unwired until its cross-stack props arrive).
      expect(s.id, `${s.at} acknowledgement id`).toMatch(
        /^(AwsSolutions-[A-Z0-9]+(\[.+\])?|CloudFormation-Validate::F\d{4})$/,
      );
      expect(
        typeof s.reason === "string" && s.reason.length >= 40,
        `${s.at} ${String(s.id)} reason`,
      ).toBe(true);
    }
  });
});

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: Record<string, unknown>;
}
const asList = (a: string | string[]): string[] => (Array.isArray(a) ? a : [a]);
const json = (v: unknown): string => JSON.stringify(v);

/** The placeholder sdkCall() puts where the template has a token (here only AWS::AccountId). */
const ACCOUNT_TOKEN = "<AWS::AccountId>";

interface SdkCall {
  service: string;
  action: string;
  region?: string;
  physicalResourceId?: unknown;
  ignoreErrorCodesMatching?: string;
  parameters: Record<string, unknown>;
}

/** An AwsCustomResource Create/Update/Delete property (a JSON string, or Fn::Join around tokens). */
function sdkCall(value: unknown): SdkCall {
  const render = (v: unknown): string => {
    if (typeof v === "string") return v;
    const join = (v as { "Fn::Join"?: [string, unknown[]] })["Fn::Join"];
    if (join !== undefined) return join[1].map(render).join(join[0]);
    if (json(v) === json({ Ref: "AWS::AccountId" })) return ACCOUNT_TOKEN;
    throw new Error(`sdkCall: unexpected token ${json(v)}`);
  };
  return JSON.parse(render(value)) as SdkCall;
}

describe("CountyLensOps: alarms → SNS email, $10 budget, no GitHub OIDC (research R-09, D-04, AM-08)", () => {
  const { stacks, templates } = synthAll();
  const all = flatten(templates);
  const ops = templates.CountyLensOps;
  const opsResources = ops.toJSON().Resources as Record<string, CfnResource>;
  const operatorEmail = process.env.OPERATOR_EMAIL as string;

  it("A-03-TC-052: every Lambda traces Active; function log groups keep 14 days, the API access log 30", () => {
    const functions = all.filter((r) => r.resource.Type === "AWS::Lambda::Function");
    expect(functions.length).toBeGreaterThan(0);
    const groups = new Map(
      all
        .filter((r) => r.resource.Type === "AWS::Logs::LogGroup")
        .map((r) => [`${r.stack}/${r.logicalId}`, r.resource] as const),
    );
    for (const fn of functions) {
      expect(fn.resource.Properties?.TracingConfig, `${fn.stack}/${fn.logicalId}`).toEqual({
        Mode: "Active",
      });
      const ref = (fn.resource.Properties as { LoggingConfig?: { LogGroup?: { Ref?: string } } })
        .LoggingConfig?.LogGroup?.Ref;
      expect(ref, `${fn.stack}/${fn.logicalId} has an explicit log group`).toBeDefined();
      expect(groups.get(`${fn.stack}/${ref}`)?.Properties?.RetentionInDays).toBe(14);
    }
    // A-14 T018 added a second stage (the MCP block's own HTTP API, infra/src/api-stack.ts): each
    // stage gets its own access log group assertion below, rather than assuming exactly one.
    const stages = all.filter((r) => r.resource.Type === "AWS::ApiGatewayV2::Stage");
    expect(stages.length).toBeGreaterThanOrEqual(1);
    for (const stage of stages) {
      const arn = json(
        (stage.resource.Properties as { AccessLogSettings?: { DestinationArn?: unknown } })
          .AccessLogSettings?.DestinationArn,
      );
      const accessGroup = [...groups.entries()].find(([key]) =>
        arn.includes(`"${key.split("/")[1]}"`),
      );
      expect(
        accessGroup,
        `${stage.stack}/${stage.logicalId}'s access log group is in the app`,
      ).toBeDefined();
      expect(accessGroup?.[1].Properties?.RetentionInDays).toBe(30);
    }
    for (const [, group] of groups) {
      expect([14, 30]).toContain(group.Properties?.RetentionInDays);
    }
  });

  it("A-03-TC-052: one SNS topic with exactly one email subscription from OPERATOR_EMAIL, SSL enforced", () => {
    ops.resourceCountIs("AWS::SNS::Topic", 1);
    ops.resourceCountIs("AWS::SNS::Subscription", 1);
    ops.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: operatorEmail,
      TopicArn: { Ref: Match.anyValue() },
    });
    const [, policy] = Object.entries(ops.findResources("AWS::SNS::TopicPolicy"))[0] ?? [];
    expect(policy, "topic policy (enforceSSL)").toBeDefined();
    expect(json(policy?.Properties)).toContain('"aws:SecureTransport":"false"');
    ops.resourceCountIs("AWS::KMS::Key", 0);
  });

  it("the operator email is never in git: no email literal in infra/src or infra/bin", () => {
    const infraRoot = fileURLToPath(new URL("..", import.meta.url));
    const files = [
      ...listTsFiles(join(infraRoot, "src"), new Set()),
      ...listTsFiles(join(infraRoot, "bin"), new Set()),
    ];
    expect(files.length).toBeGreaterThan(0);
    const emailLiteral = /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}\b/i;
    const offenders = files
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return emailLiteral.test(text) || text.includes(operatorEmail);
      })
      .map((f) => relative(infraRoot, f));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(infraRoot, "cdk.json"), "utf8")).not.toMatch(emailLiteral);
  });

  it("A-16 (A13-6, A14-3): p95 duration ≥ 12 s and account ConcurrentExecutions ≥ 8, each ALARM + OK → the topic, notBreaching", () => {
    const [topicId] = Object.keys(ops.findResources("AWS::SNS::Topic"));
    const byName = (name: string) =>
      Object.values(ops.findResources("AWS::CloudWatch::Alarm")).find(
        (a) => a.Properties?.AlarmName === name,
      )?.Properties;
    expect(byName("countylens-api-duration-p95")).toMatchObject({
      Namespace: "AWS/Lambda",
      MetricName: "Duration",
      ExtendedStatistic: "p95",
      Period: 300,
      EvaluationPeriods: 1,
      Threshold: 12000,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "notBreaching",
      AlarmActions: [{ Ref: topicId }],
      OKActions: [{ Ref: topicId }],
    });
    expect(json(byName("countylens-api-duration-p95")?.Dimensions)).toContain("CountyLensApi");
    const concurrency = byName("countylens-account-concurrency");
    expect(concurrency).toMatchObject({
      Namespace: "AWS/Lambda",
      MetricName: "ConcurrentExecutions",
      Statistic: "Maximum",
      Period: 60,
      Threshold: 8,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "notBreaching",
      AlarmActions: [{ Ref: topicId }],
      OKActions: [{ Ref: topicId }],
    });
    // Account-wide: no FunctionName dimension.
    expect(concurrency?.Dimensions).toBeUndefined();
  });

  it("A-03-TC-052: three alarms (Lambda Errors ≥ 1 / 5 min, Throttles ≥ 1, HTTP API 5xx ≥ 1), each ALARM + OK → the topic, notBreaching", () => {
    const all = Object.values(ops.findResources("AWS::CloudWatch::Alarm"));
    // Five in Ops since A-16 (duration and concurrency asserted above); the free tier allows 10.
    expect(all).toHaveLength(5);
    const alarms = all.filter(
      (a) =>
        !["countylens-api-duration-p95", "countylens-account-concurrency"].includes(
          a.Properties?.AlarmName as string,
        ),
    );
    expect(alarms).toHaveLength(3);
    const [topicId] = Object.keys(ops.findResources("AWS::SNS::Topic"));
    const metrics = alarms
      .map((a) => {
        const p = a.Properties as {
          Namespace: string;
          MetricName: string;
          Dimensions?: { Name: string }[];
        };
        return `${p.Namespace}/${p.MetricName}[${(p.Dimensions ?? []).map((d) => d.Name).join(",")}]`;
      })
      .sort();
    expect(metrics).toEqual([
      "AWS/ApiGateway/5xx[ApiId]",
      "AWS/Lambda/Errors[FunctionName]",
      "AWS/Lambda/Throttles[FunctionName]",
    ]);
    for (const a of alarms) {
      expect(a.Properties).toMatchObject({
        Statistic: "Sum",
        Period: 300,
        EvaluationPeriods: 1,
        Threshold: 1,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        TreatMissingData: "notBreaching",
        AlarmActions: [{ Ref: topicId }],
        OKActions: [{ Ref: topicId }],
      });
      // The function name and API id come from CountyLensApi (cross-stack exports).
      expect(json(a.Properties?.Dimensions)).toMatch(/Fn::GetStackOutput|Fn::ImportValue/);
      expect(json(a.Properties?.Dimensions)).toContain("CountyLensApi");
    }
  });

  // metagross M2: CloudFormation has no AWS::Budgets::Budget type in the project region (F3006)
  // and no stack may live elsewhere, so the budget is an AwsCustomResource in CountyLensOps that
  // calls the (global) Budgets API. Asserted unconditionally (no BUDGET_REGION skip).
  // metagross N2: UpdateBudget cannot change subscribers, so the budget name (= physical id)
  // carries a revision hash of its whole definition including the operator email. Update calls
  // CreateBudget: an unchanged definition is the same name (DuplicateRecordException ignored, no
  // replacement); a changed email is a new name, so CloudFormation's cleanup deletes the old one.
  // metagross N1: Delete targets the physical id and ignores NotFoundException.
  it("A-03-TC-052: the $10 MONTHLY COST budget is a custom resource in CountyLensOps (Create/Update/Delete), 80 % actual + 100 % forecast to the operator email, no budget action", () => {
    for (const t of Object.values(templates)) {
      t.resourceCountIs("AWS::Budgets::Budget", 0);
      t.resourceCountIs("AWS::Budgets::BudgetsAction", 0);
    }
    const budgets = Object.values(ops.findResources("Custom::CountyLensBudget"));
    expect(budgets).toHaveLength(1);
    const props = budgets[0]?.Properties as Record<string, unknown>;
    const call = (phase: "Create" | "Update" | "Delete") => sdkCall(props[phase]);
    const create = call("Create");
    const update = call("Update");
    const del = call("Delete");
    const name = budgetNameFor(operatorEmail);
    expect(name).toMatch(/^countylens-monthly-[0-9a-f]{10}$/);
    expect([create.service, create.action]).toEqual(["Budgets", "CreateBudget"]);
    expect([update.service, update.action]).toEqual(["Budgets", "CreateBudget"]);
    expect([del.service, del.action]).toEqual(["Budgets", "DeleteBudget"]);
    for (const c of [create, update, del]) {
      expect(c.physicalResourceId).toEqual({ id: name });
      expect(c.parameters.AccountId).toBe(ACCOUNT_TOKEN);
      expect(
        c.region,
        "no region literal: the SDK call runs in the stack's region",
      ).toBeUndefined();
    }
    expect(create.ignoreErrorCodesMatching).toBeUndefined();
    expect(update.ignoreErrorCodesMatching).toBe("DuplicateRecordException");
    expect(update.parameters).toEqual(create.parameters);
    const budget = {
      BudgetName: name,
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: "10", Unit: "USD" },
    };
    expect(create.parameters.Budget).toEqual(budget);
    expect(del.parameters).toEqual({
      AccountId: ACCOUNT_TOKEN,
      BudgetName: "PHYSICAL:RESOURCEID:",
    });
    expect(
      del.ignoreErrorCodesMatching,
      "N1: an already-deleted budget must not fail the stack",
    ).toBe("NotFoundException");
    expect(create.parameters.ResourceTags).toEqual([
      { Key: PROJECT_TAG.key, Value: PROJECT_TAG.value },
    ]);
    const notifications = create.parameters.NotificationsWithSubscribers as {
      Notification: Record<string, unknown>;
      Subscribers: unknown[];
    }[];
    expect(notifications.map((n) => n.Notification)).toEqual([
      {
        NotificationType: "ACTUAL",
        ComparisonOperator: "GREATER_THAN",
        Threshold: 80,
        ThresholdType: "PERCENTAGE",
      },
      {
        NotificationType: "FORECASTED",
        ComparisonOperator: "GREATER_THAN",
        Threshold: 100,
        ThresholdType: "PERCENTAGE",
      },
    ]);
    for (const n of notifications) {
      expect(n.Subscribers).toEqual([{ SubscriptionType: "EMAIL", Address: operatorEmail }]);
    }
  });

  it("A-03-TC-052 (N2): the budget name changes when the operator email changes and is stable otherwise", () => {
    expect(budgetNameFor(operatorEmail)).toBe(budgetNameFor(operatorEmail));
    expect(budgetNameFor("someone-else@example.invalid")).not.toBe(budgetNameFor(operatorEmail));
    expect(budgetNameFor(operatorEmail), "the address itself is never in the name").not.toContain(
      operatorEmail,
    );
    const outputs = ops.toJSON().Outputs as Record<string, { Value: unknown }>;
    expect(outputs.BudgetName?.Value).toBe(budgetNameFor(operatorEmail));
  });

  it("A-03-TC-052: the budget provider may only modify/view/tag budget/countylens-monthly-*; its Lambda traces Active and logs 14 days", () => {
    const policies = Object.values(ops.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement,
    );
    const budgetStatements = policies.filter((s) =>
      asList(s.Action).some((a) => a.startsWith("budgets:")),
    );
    expect(budgetStatements).toHaveLength(1);
    const [st] = budgetStatements as [Statement];
    expect(asList(st.Action).sort()).toEqual([
      "budgets:ModifyBudget",
      "budgets:TagResource",
      "budgets:ViewBudget",
    ]);
    const resource = json(st.Resource);
    expect(resource).toContain(":budgets::");
    expect(resource).toContain(":budget/countylens-monthly-*");
    expect(resource).not.toMatch(/budget\/\*|"\*"/);
    const fns = Object.values(ops.findResources("AWS::Lambda::Function"));
    expect(fns, "only the AwsCustomResource singleton provider").toHaveLength(1);
    expect(fns[0]?.Properties?.TracingConfig).toEqual({ Mode: "Active" });
    // Retention 14 days is asserted for every function's log group by the TC-052 case above.
  });

  it("AM-08: no GitHub OIDC provider and no role trusting token.actions.githubusercontent.com (the SCP denies the provider; CI never deploys)", () => {
    for (const [stack, template] of Object.entries(templates)) {
      template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
      template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
      for (const [id, role] of Object.entries(template.findResources("AWS::IAM::Role"))) {
        const trust = json(
          (role.Properties as { AssumeRolePolicyDocument?: unknown }).AssumeRolePolicyDocument,
        );
        expect(trust, `${stack}/${id}`).not.toContain("token.actions.githubusercontent.com");
        expect(trust, `${stack}/${id}`).not.toContain("AssumeRoleWithWebIdentity");
      }
    }
    // The one role in Ops is the budget's AwsCustomResource provider role.
    ops.resourceCountIs("AWS::IAM::Role", 1);
    expect(Object.keys(ops.toJSON().Outputs ?? {}).sort()).toEqual([
      "AlertsTopicArn",
      "BudgetName",
    ]);
    ops.hasOutput("AlertsTopicArn", { Value: { Ref: Match.anyValue() } });
  });

  it("Ops has no Lambda, queue, key, secret or Function URL of its own; every alarm/topic is tagged", () => {
    for (const type of ["AWS::SQS::Queue", "AWS::KMS::Key", "AWS::SecretsManager::Secret"]) {
      ops.resourceCountIs(type, 0);
    }
    const tagged = Object.values(opsResources).filter((r) =>
      ["AWS::SNS::Topic", "AWS::CloudWatch::Alarm", "AWS::IAM::Role"].includes(r.Type),
    );
    expect(tagged.length).toBeGreaterThanOrEqual(5);
    for (const r of tagged) {
      expect(json(r.Properties?.Tags), r.Type).toContain(PROJECT_TAG.value);
    }
    expect(stacks.ops.stackName).toBe("CountyLensOps");
  });
});
