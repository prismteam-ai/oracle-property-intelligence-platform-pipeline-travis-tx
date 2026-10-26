// CDK assertions for CountyLensScheduler (A-11 T024): the schedule is DISABLED, its ECS target
// references this stack's own TaskDefinition, and no AWS::ECS::Service exists anywhere in the
// synthesized template (Scheduler invokes RunTask directly — no always-on resource, $0 idle cost,
// NFR-003, P0-19). Built against the same app wiring as stacks.test.ts (appUnderTest), so these
// assertions run against exactly what `cdk synth` produces.
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  BATCH_TASK_PLACEHOLDER_IMAGE,
  CLUSTER_NAME,
  SCHEDULE_NAME,
} from "../src/stacks/scheduler-stack.js";
import { appUnderTest } from "./helpers.js";

// The alarm/budget recipient is never in git: the Ops stack reads OPERATOR_EMAIL from the
// environment (CI variable, PO shell); this test uses this placeholder when it is unset,
// the same pattern as stacks.test.ts and api.test.ts.
process.env.OPERATOR_EMAIL ??= "countylens-tests@example.invalid";

const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

function synth() {
  const { app, config, stacks } = appUnderTest(SKIP_BUNDLING);
  return { app, config, stacks, template: Template.fromStack(stacks.scheduler) };
}

describe("CountyLensScheduler: DISABLED by default, Fargate RunTask, no always-on resource", () => {
  it("the schedule exists with State: DISABLED", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: SCHEDULE_NAME,
      State: "DISABLED",
    });
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
  });

  it("the schedule's ECS target references this stack's own TaskDefinition logical id", () => {
    const { template } = synth();
    const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
    const taskDefLogicalIds = Object.keys(taskDefs);
    expect(taskDefLogicalIds).toHaveLength(1);
    const [taskDefLogicalId] = taskDefLogicalIds as [string];

    const schedules = Object.values(template.findResources("AWS::Scheduler::Schedule"));
    expect(schedules).toHaveLength(1);
    const target = (schedules[0]?.Properties as { Target?: Record<string, unknown> })?.Target;
    expect(target).toBeDefined();
    // The ECS target's TaskDefinitionArn must resolve to this stack's own TaskDefinition, not a
    // literal ARN and not some other stack's resource.
    const ecsParameters = target?.EcsParameters as { TaskDefinitionArn?: unknown };
    expect(JSON.stringify(ecsParameters?.TaskDefinitionArn)).toContain(taskDefLogicalId);
    expect(ecsParameters).toMatchObject({ LaunchType: "FARGATE", TaskCount: 1 });

    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Family: Match.anyValue(),
      RequiresCompatibilities: ["FARGATE"],
    });

    // The target's cluster ARN points at this stack's own cluster (named, not a literal ARN).
    const clusters = Object.keys(template.findResources("AWS::ECS::Cluster"));
    expect(clusters).toHaveLength(1);
    expect(JSON.stringify(target?.Arn)).toContain(clusters[0]);
    template.hasResourceProperties("AWS::ECS::Cluster", { ClusterName: CLUSTER_NAME });
  });

  it("no AWS::ECS::Service exists anywhere in the synthesized template (RunTask only, no always-on service)", () => {
    const { template } = synth();
    template.resourceCountIs("AWS::ECS::Service", 0);
  });

  it("no AWS::EC2::NatGateway exists (public subnets only; a NAT bills hourly while idle)", () => {
    const { template } = synth();
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  it("placeholder image is a registry reference, not a local Dockerfile asset (no Docker build at synth time)", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Image: BATCH_TASK_PLACEHOLDER_IMAGE }),
      ]),
    });
  });

  it("the DLQ has exactly one CloudWatch alarm, self-resolving (NOT_BREACHING on missing data)", () => {
    const { template } = synth();
    const dlqs = Object.keys(template.findResources("AWS::SQS::Queue"));
    expect(dlqs).toHaveLength(1);
    const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm"));
    expect(alarms).toHaveLength(1);
    expect(alarms[0]?.Properties).toMatchObject({
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      Threshold: 1,
      TreatMissingData: "notBreaching",
    });
  });

  it("the stack carries no region literal and reads its region from the shared config", () => {
    const { stacks, config } = synth();
    expect(stacks.scheduler.region).toBe(config.region);
  });
});
