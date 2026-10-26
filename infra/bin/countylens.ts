// CDK app entry (A-03 T018). `cdk synth` runs this through infra/cdk.json. Region and account
// come from CDK_DEFAULT_REGION / CDK_DEFAULT_ACCOUNT, which the CDK CLI fills from the AWS
// profile (constitution III); the GitHub repository and ref come from cdk.json context.
import { App } from "aws-cdk-lib";
import { createCountyLensStacks } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const app = new App();
createCountyLensStacks(
  app,
  loadConfig(process.env, (key) => app.node.tryGetContext(key)),
);
