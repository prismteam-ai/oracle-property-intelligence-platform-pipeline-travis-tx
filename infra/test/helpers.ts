// Test helper: build the app exactly as `cdk synth` does. The CDK CLI loads infra/cdk.json
// (feature flags and the countylens:* context) into the App; `new App()` in a test does not,
// so the assertions would run under different flags (for example explicitStackTags). This
// reads the same file and passes its context, and uses CDK_DEFAULT_REGION like the CLI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import { createCountyLensStacks, type CountyLensStacks } from "../src/app.js";
import { loadConfig, type ContextReader, type InfraConfig } from "../src/config.js";

export function cdkJsonContext(): Record<string, unknown> {
  const raw = readFileSync(fileURLToPath(new URL("../cdk.json", import.meta.url)), "utf8");
  const parsed = JSON.parse(raw) as { context?: Record<string, unknown> };
  return parsed.context ?? {};
}

export const contextReader =
  (context: Record<string, unknown>): ContextReader =>
  (key) =>
    context[key];

export interface AppUnderTest {
  app: App;
  config: InfraConfig;
  stacks: CountyLensStacks;
}

/** The five stacks under the cdk.json context, with the region from CDK_DEFAULT_REGION. */
export function appUnderTest(contextOverrides: Record<string, unknown> = {}): AppUnderTest {
  // Bundling the Lambda (esbuild + a linux-arm64 npm install) in every test file at once is slow
  // and flaky under the parallel run, so tests never bundle unless a test opts in with the
  // override { "aws:cdk:bundling-stacks": ["**"] } (the COUNTYLENS_BUNDLE=1 asset check does).
  const skipBundling = { "aws:cdk:bundling-stacks": [] as string[] };
  const context = { ...cdkJsonContext(), ...skipBundling, ...contextOverrides };
  const app = new App({ context });
  const config = loadConfig(process.env, (key) => app.node.tryGetContext(key));
  const stacks = createCountyLensStacks(app, config);
  return { app, config, stacks };
}
