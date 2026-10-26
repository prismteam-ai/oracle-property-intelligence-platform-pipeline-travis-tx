// The CountyLens CDK app (A-03 T018): five stacks in one App, deployed in the ARD § 16 AM-02
// order Data → Api → Web → Ops → Cert, tagged project_name=oracle-travis, checked by the
// cdk-nag AwsSolutions pack. `bin/countylens.ts` calls this for `cdk synth`; the tests call it
// with the same config so assertions run against exactly what deploys.
import { App, Tags, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { ApiStack } from "./api-stack.js";
import { CertStack } from "./cert-stack.js";
import { PROJECT_TAG_KEY, type InfraConfig } from "./config.js";
import { DataStack } from "./data-stack.js";
import { OpsStack } from "./ops-stack.js";
import { ScheduledRunStack } from "./stacks/scheduled-run-stack.js";
import { SchedulerStack } from "./stacks/scheduler-stack.js";
import { WebStack } from "./web-stack.js";

export interface CountyLensStacks {
  readonly data: DataStack;
  readonly api: ApiStack;
  readonly web: WebStack;
  readonly ops: OpsStack;
  readonly cert: CertStack;
  /** A-11 G-SCHED: DISABLED-by-default scheduler, no dependents (never blocks AM-02 order). */
  readonly scheduler: SchedulerStack;
  /** One scheduled Start for the laptop bridge, only when COUNTYLENS_SCHEDULED_RUN_* is set. */
  readonly scheduledRun?: ScheduledRunStack;
}

/** The Ops stack needs the alarm and budget recipient; it is never in git (CI variable, PO shell). */
function requireOperatorEmail(config: InfraConfig): string {
  if (config.operatorEmail === undefined) {
    throw new Error(
      "infra config: OPERATOR_EMAIL is not set; export the alarm and budget recipient " +
        "(repository variable OPERATOR_EMAIL in CI, your own shell for a local synth). Never commit it.",
    );
  }
  return config.operatorEmail;
}

export function createCountyLensStacks(app: App, config: InfraConfig): CountyLensStacks {
  // `account` is only set when the CLI resolved it; synth stays env-agnostic without it.
  const env =
    config.account === undefined
      ? { region: config.region }
      : { account: config.account, region: config.region };
  // Stack-level tags (CloudFormation propagates them) are explicit props under the
  // @aws-cdk/core:explicitStackTags flag; Tags.of(app) below tags every resource.
  const base = { env, tags: { [PROJECT_TAG_KEY]: config.projectName } };

  const data = new DataStack(app, "CountyLensData", {
    ...base,
    description:
      "CountyLens CID copy: private S3 bucket + CloudFront (OAC, origin path /ipfs) serving elephant-cli output by CID (AD-02).",
  });
  const api = new ApiStack(app, "CountyLensApi", {
    ...base,
    data,
    description:
      "CountyLens API: tRPC Lambda (arm64, 1,769 MB, 15 s) behind an HTTP API with a 30-day JSON access log and X-Ray (AD-09, AM-03, AM-06); admin user pool and command queue (A-16).",
  });
  const web = new WebStack(app, "CountyLensWeb", {
    ...base,
    github: config.github,
    httpApiUrl: api.httpApiUrl,
    agentApiUrl: api.agentHttpApi.apiEndpoint,
    cidCopyHost: data.distribution.distributionDomainName,
    cognito: {
      userPoolId: api.userPool.userPoolId,
      userPoolClientId: api.userPoolClient.userPoolClientId,
    },
    description:
      "CountyLens web: Amplify Hosting app and branches for apps/web; /api/<*> rewritten to the HTTP API.",
  });
  const ops = new OpsStack(app, "CountyLensOps", {
    ...base,
    api,
    operatorEmail: requireOperatorEmail(config),
    description:
      "CountyLens operations: SNS email, alarms (Errors, Throttles, 5xx, p95 duration, account concurrency) and the $10 budget (no CI deploy role, AM-08).",
  });
  const cert = new CertStack(app, "CountyLensCert", {
    ...base,
    web: { appId: web.appId, branchName: web.productionBranchName },
    description: "CountyLens domain: the Amplify custom-domain association only (AD-13, AM-02).",
  });
  // A-11 G-SCHED: added after Data (it reads the CID-copy bucket/CloudFront names DataStack
  // mirrors to SSM, CID_COPY_SSM_PREFIX) but with no dependents, so it never sits in the
  // Data→Api→Web→Ops→Cert chain (plan.md, tasks.md T026). Region only, never a concrete account:
  // with a concrete account, CDK's ec2.Vpc construct validates its explicit `availabilityZones`
  // against a real EC2 DescribeAvailabilityZones context-provider call (needs AWS credentials at
  // synth time, undesirable for `cdk synth`/CI/unit tests); with no account, Stack.availabilityZones
  // short-circuits to dummy AZ names. The stack's own resources use account-agnostic pseudo
  // parameters (Aws.ACCOUNT_ID) exactly like every IAM ARN elsewhere in this app, and it reads
  // DataStack's bucket/host through its published SSM parameters rather than a direct TS
  // cross-stack object reference (which would force matching account pinning).
  const scheduler = new SchedulerStack(app, "CountyLensScheduler", {
    ...base,
    env: { region: config.region },
    ...(config.operatorEmail === undefined ? {} : { operatorEmail: config.operatorEmail }),
    description:
      "CountyLens scheduler: DISABLED-by-default EventBridge Scheduler → Fargate RunTask " +
      "(no FargateService), $0 while disabled (NFR-003, P0-19).",
  });

  // Deploy order (ARD § 16 AM-02): Cert last because the domain association needs the Web app.
  api.addStackDependency(data, "AM-02: Api reads the Data bucket");
  web.addStackDependency(api, "AM-02: Web rewrites /api to the HTTP API");
  ops.addStackDependency(web, "AM-02: Ops alarms reference Api and Web");
  cert.addStackDependency(ops, "AM-02: the domain association needs the Web app and branch");
  // G-SCHED: explicit ordering only (no CDK object/export reference) — the Fargate task reads
  // DataStack's SSM parameters at its own deploy/run time, so this is documentation of intended
  // operator deploy order, not a resource dependency CDK itself needs to resolve.
  scheduler.addStackDependency(
    data,
    "G-SCHED: reads the CID-copy bucket/CloudFront SSM parameters",
  );

  // PO 2026-10-26: one scheduled Start on the admin queue (its own stack: deploying it changes
  // nothing else). Synthesized only when the four COUNTYLENS_SCHEDULED_RUN_* values are set.
  const scheduledRun =
    config.scheduledRun === undefined
      ? undefined
      : new ScheduledRunStack(app, "CountyLensScheduledRun", {
          ...base,
          run: config.scheduledRun,
          description:
            "CountyLens: one EventBridge Scheduler Start on the admin command queue for the laptop bridge; an at() schedule fires once, then delete this stack.",
        });

  Tags.of(app).add(PROJECT_TAG_KEY, config.projectName);
  Validations.of(app).addPlugins(
    new AwsSolutionsChecks(app, { verbose: true, writeSuppressionsToCloudFormation: true }),
  );

  return {
    data,
    api,
    web,
    ops,
    cert,
    scheduler,
    ...(scheduledRun === undefined ? {} : { scheduledRun }),
  };
}
