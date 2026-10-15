import path from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import { OracleApiStack } from "../lib/api-stack.js";
import { OracleIngestStack } from "../lib/ingest-stack.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = new App();
const ctx = (k: string): string | undefined => {
  const v = app.node.tryGetContext(k) as string | undefined;
  return v === undefined || v === "" ? undefined : String(v);
};
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx("region") ?? "us-east-2" };

new OracleApiStack(app, "OracleTravisApi", {
  env,
  repoRoot,
  snapshotRootCid: ctx("snapshotRootCid"),
  snapshotManifestUrl: ctx("snapshotManifestUrl"),
  historyUrl: ctx("historyUrl"),
  manifestBaseUrl: ctx("manifestBaseUrl"),
  ipfsGateway: ctx("ipfsGateway") ?? "https://ipfs.io",
  llmProvider: ctx("llmProvider") ?? "bedrock",
  llmModel: ctx("llmModel"),
  agentConcurrency: Number(ctx("apiConcurrency") ?? 5),
});

new OracleIngestStack(app, "OracleTravisIngest", {
  env,
  repoRoot,
  scheduleEnabled: ctx("ingestScheduleEnabled") === "true",
  scheduleExpression: ctx("ingestSchedule") ?? "cron(0 9 * * ? *)",
  publishEnvParameterName: ctx("publishEnvParameter") ?? "/oracle-travis/publish-env",
  alertEmail: ctx("alertEmail"),
  pagerDutyIntegrationUrl: ctx("pagerDutyIntegrationUrl"),
  tcadExportUrl:
    ctx("tcadExportUrl") ??
    "https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip",
});
