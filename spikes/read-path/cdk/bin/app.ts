// A-03 read-path spike (temporary). Region and account come from the AWS profile
// (CDK_DEFAULT_REGION / CDK_DEFAULT_ACCOUNT); nothing is hard-coded.
import { App, Tags } from "aws-cdk-lib";
import { CountyLensSpikeStack } from "../lib/spike-stack.ts";

const app = new App();
const stack = new CountyLensSpikeStack(app, "CountyLensSpike", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: "CountyLens A-03 read-path spike (temporary, destroyed after measurement)",
});
Tags.of(stack).add("project", "countylens");
Tags.of(stack).add("purpose", "spike");
Tags.of(stack).add("ttl", "2026-10-22");
