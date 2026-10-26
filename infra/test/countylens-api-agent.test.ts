// A-14 T009 (write-only this pass; tasks.md "T016 ... done in a follow-up pass"). Asserts the
// agent-owned CDK resource block of CountyLensApi (infra/src/api-stack.ts): the agent Lambda
// (arm64, 3,008 MB per AD-27 as amended by AM-09, timeout 25 s, no reserved concurrency — research.md "no reserved
// Lambda concurrency"), the spend-counter DynamoDB table (on-demand billing, data-model.md
// "Spend counter"), and the CloudWatch alarm at 80% of the $5/day cap (agent-design.md § "ash"
// > "Spend-cap + alarm design").
//
// EXPECTED RED until T016 (G-2, wave 1 follow-up, after oracle's concurrent MCP-Lambda edit to
// the same file lands first): today infra/src/api-stack.ts exports only the tRPC Lambda (`fn`)
// and no DynamoDB table or alarm, so every assertion below fails — intentionally, per the TDD
// ordering this builder pass was given. The constant names (`AGENT_FUNCTION_NAME`,
// `AGENT_MEMORY_MB`, `AGENT_TIMEOUT_SECONDS`, `SPEND_TABLE_NAME`, `SPEND_ALARM_THRESHOLD_USD`)
// are this builder's proposed contract for T016 to implement against; T016 may rename them, in
// which case this file's imports (not its assertions) need a one-line update.
import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
// These six exports do not exist until T016 lands (expected red, see header): both `tsc
// --noEmit` and `vitest run` fail on this file until then, which is the correct state for this
// builder pass (ash builds T016 in the follow-up pass once oracle's concurrent MCP-Lambda edit
// to this same file is done).
import {
  AGENT_FUNCTION_NAME,
  AGENT_MEMORY_MB,
  AGENT_TIMEOUT_SECONDS,
  DAILY_SPEND_CAP_USD,
  SPEND_ALARM_THRESHOLD_USD,
  SPEND_TABLE_NAME,
} from "../src/api-stack.js";
import { appUnderTest } from "./helpers.js";

const TEST_OPERATOR_EMAIL = "countylens-tests@example.invalid";
process.env.OPERATOR_EMAIL ??= TEST_OPERATOR_EMAIL;

const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

function synthApi(): { template: Template; resources: Record<string, unknown> } {
  const { stacks } = appUnderTest(SKIP_BUNDLING);
  const template = Template.fromStack(stacks.api);
  return { template, resources: template.toJSON().Resources as Record<string, unknown> };
}

describe("CountyLensApi agent resources (A-14 T009/T016): Lambda, spend table, 80% alarm", () => {
  it("the agent Lambda: arm64, 1,769 MB (A-16), 25 s timeout, no reserved or provisioned concurrency", () => {
    const { template } = synthApi();
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: AGENT_FUNCTION_NAME,
      Architectures: ["arm64"],
      MemorySize: AGENT_MEMORY_MB,
      Timeout: AGENT_TIMEOUT_SECONDS,
    });
    expect(AGENT_MEMORY_MB).toBe(1769); // A-16: on the per-run Explore index
    expect(AGENT_TIMEOUT_SECONDS).toBe(Duration.seconds(25).toSeconds());

    // No ReservedConcurrentExecutions/ProvisionedConcurrencyConfig anywhere in the stack
    // (research.md: the account's ConcurrentExecutions limit is 10, account-wide).
    const { resources } = synthApi();
    const allProps = JSON.stringify(Object.values(resources));
    expect(allProps).not.toContain("ReservedConcurrentExecutions");
    expect(allProps).not.toContain("ProvisionedConcurrencyConfig");
  });

  it("the spend-counter DynamoDB table: on-demand billing, pk only, no TTL", () => {
    const { template } = synthApi();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: SPEND_TABLE_NAME,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [Match.objectLike({ AttributeName: "pk", KeyType: "HASH" })],
    });
    const { resources } = synthApi();
    const tables = Object.values(resources).filter(
      (r) => (r as { Type?: string }).Type === "AWS::DynamoDB::Table",
    ) as { Properties?: Record<string, unknown> }[];
    expect(tables).toHaveLength(1);
    expect(tables[0]?.Properties).not.toHaveProperty("TimeToLiveSpecification");
  });

  it("a CloudWatch alarm fires at 80% of the $5/day spend cap ($4.00)", () => {
    expect(DAILY_SPEND_CAP_USD).toBe(5);
    expect(SPEND_ALARM_THRESHOLD_USD).toBeCloseTo(4, 5);
    const { template } = synthApi();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: SPEND_ALARM_THRESHOLD_USD,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  });

  it("A-16 T025 (A14-3): the 80% spend alarm notifies the Ops topic countylens-alerts on ALARM and OK", () => {
    const { template } = synthApi();
    // The topic ARN is a literal string when CDK_DEFAULT_ACCOUNT is set and an Fn::Join otherwise.
    const alarms = Object.values(
      template.findResources("AWS::CloudWatch::Alarm", {
        Properties: { Threshold: SPEND_ALARM_THRESHOLD_USD },
      }),
    ) as Array<{ Properties?: { AlarmActions?: unknown[]; OKActions?: unknown[] } }>;
    expect(alarms).toHaveLength(1);
    const props = alarms[0]?.Properties ?? {};
    for (const actions of [props.AlarmActions, props.OKActions]) {
      expect(actions).toHaveLength(1);
      expect(JSON.stringify(actions)).toContain(":countylens-alerts");
    }
  });
});

describe("CountyLensApi agent Bedrock grant (found on the first hosted call: the role had none)", () => {
  it("the agent role may invoke only the eu. Sonnet 4.6 profile and its base models via that profile, nothing broader", () => {
    const { stacks } = appUnderTest({ "aws:cdk:bundling-stacks": [] as string[] });
    const policies = Template.fromStack(stacks.api).findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } })
          .PolicyDocument.Statement,
    );
    const bedrock = statements.filter((s) => JSON.stringify(s.Action).includes("bedrock:"));
    // Two statements: the profile carries no condition (the key is absent on that request), the
    // foundation model carries the InferenceProfileArn condition.
    expect(bedrock).toHaveLength(2);
    for (const s of bedrock) {
      expect(s.Effect).toBe("Allow");
      expect(s.Action).toEqual(["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]);
      expect(JSON.stringify(s)).not.toMatch(/"Resource":"\*"/);
    }
    const profile = bedrock.find((s) => JSON.stringify(s.Resource).includes("inference-profile/"));
    const model = bedrock.find((s) => JSON.stringify(s.Resource).includes("foundation-model/"));
    expect(JSON.stringify(profile?.Resource)).toContain(
      "inference-profile/eu.anthropic.claude-sonnet-4-6",
    );
    expect(profile?.Condition).toBeUndefined();
    expect(JSON.stringify(model?.Resource)).toContain(
      "foundation-model/anthropic.claude-sonnet-4-6",
    );
    expect(JSON.stringify(model?.Condition)).toContain("bedrock:InferenceProfileArn");
  });
});
