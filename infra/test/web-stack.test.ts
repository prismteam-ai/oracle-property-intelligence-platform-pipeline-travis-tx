// A-13 T009 (CDK assertions) for T016: the Web stack's Amplify variables for the explorer
// pages (contracts/site-links.md, research R6, AM-01). VITE_PINATA_GATEWAY_HOST is the
// independent Verify gateway (gateway.pinata.cloud); CRM_URL, DEMO_VIDEO_URL and PR_URL come
// from CDK context, empty by default, and amplify.yml turns them into /site-links.json. A
// switch is a Web-stack deploy plus an Amplify rebuild, never a code change. The Api stack is
// untouched by these keys.
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  DEFAULT_ORBITOR_GATEWAY_HOST,
  DEFAULT_PINATA_GATEWAY_HOST,
  SITE_LINK_CONTEXT_KEYS,
  WebStack,
} from "../src/web-stack.js";
import { appUnderTest, cdkJsonContext } from "./helpers.js";

interface EnvironmentVariable {
  Name: string;
  Value: unknown;
}

function webEnv(template: Template): Record<string, unknown> {
  const apps = Object.values(template.findResources("AWS::Amplify::App"));
  expect(apps).toHaveLength(1);
  const vars = (apps[0]?.Properties?.EnvironmentVariables ?? []) as EnvironmentVariable[];
  return Object.fromEntries(vars.map((v) => [v.Name, v.Value]));
}

function synthWeb(context: Record<string, unknown> = {}): Record<string, unknown> {
  const app = new App({ context: { ...cdkJsonContext(), ...context } });
  const config = loadConfig(process.env, (key) => app.node.tryGetContext(key));
  const web = new WebStack(app, "CountyLensWeb", {
    env: { region: config.region },
    github: config.github,
    httpApiUrl: "https://api.example.invalid",
    cidCopyHost: "d111111abcdef8.cloudfront.net",
  });
  return webEnv(Template.fromStack(web));
}

describe("CountyLensWeb: A-13 Amplify variables (T009 / T016)", () => {
  it("names the context keys countylens:crmUrl, countylens:demoVideoUrl, countylens:prUrl", () => {
    expect(SITE_LINK_CONTEXT_KEYS).toEqual({
      CRM_URL: "countylens:crmUrl",
      DEMO_VIDEO_URL: "countylens:demoVideoUrl",
      PR_URL: "countylens:prUrl",
    });
  });

  it("sets VITE_PINATA_GATEWAY_HOST=gateway.pinata.cloud and empty CRM_URL, DEMO_VIDEO_URL, PR_URL by default", () => {
    expect(DEFAULT_PINATA_GATEWAY_HOST).toBe("gateway.pinata.cloud");
    const env = synthWeb();
    expect(env).toMatchObject({
      VITE_PINATA_GATEWAY_HOST: "gateway.pinata.cloud",
      CRM_URL: "",
      DEMO_VIDEO_URL: "",
      PR_URL: "",
    });
  });

  it("sets VITE_ORBITOR_GATEWAY_HOST=ipfs.orbitor.dev by default (AM-10: the second independent gateway)", () => {
    expect(DEFAULT_ORBITOR_GATEWAY_HOST).toBe("ipfs.orbitor.dev");
    expect(synthWeb()).toMatchObject({
      VITE_PINATA_GATEWAY_HOST: "gateway.pinata.cloud",
      VITE_ORBITOR_GATEWAY_HOST: "ipfs.orbitor.dev",
      VITE_FILEBASE_GATEWAY_HOST: "ipfs.filebase.io",
    });
  });

  it("takes the three links from CDK context (a switch is a deploy, not a code change)", () => {
    const env = synthWeb({
      "countylens:crmUrl": "https://crm.example.invalid/",
      "countylens:demoVideoUrl": "https://video.example.invalid/demo",
      "countylens:prUrl": "https://github.com/example/repo/pull/1",
    });
    expect(env).toMatchObject({
      CRM_URL: "https://crm.example.invalid/",
      DEMO_VIDEO_URL: "https://video.example.invalid/demo",
      PR_URL: "https://github.com/example/repo/pull/1",
    });
  });

  it("treats a blank context value as empty (hidden)", () => {
    expect(synthWeb({ "countylens:prUrl": "   " }).PR_URL).toBe("");
  });

  it("refuses a non-https link at synth time, naming the context key", () => {
    expect(() => synthWeb({ "countylens:crmUrl": "http://crm.example.invalid/" })).toThrow(
      /countylens:crmUrl must be an https:\/\/ URL or empty/,
    );
    expect(() => synthWeb({ "countylens:demoVideoUrl": 42 })).toThrow(/countylens:demoVideoUrl/);
  });

  it("the variables hold no secret-looking names and no region literal", () => {
    const env = synthWeb();
    for (const name of Object.keys(env)) expect(name).not.toMatch(/token|secret|password/i);
    expect(JSON.stringify(env)).not.toMatch(/[a-z]{2}-[a-z]+-\d/);
  });

  it("the app as synthesised keeps the Api stack free of the site-link keys", () => {
    const { stacks } = appUnderTest();
    const apiJson = JSON.stringify(Template.fromStack(stacks.api).toJSON());
    for (const key of [
      "CRM_URL",
      "DEMO_VIDEO_URL",
      "PR_URL",
      "VITE_PINATA_GATEWAY_HOST",
      "VITE_ORBITOR_GATEWAY_HOST",
    ]) {
      expect(apiJson).not.toContain(key);
    }
    expect(webEnv(Template.fromStack(stacks.web))).toMatchObject({
      VITE_PINATA_GATEWAY_HOST: DEFAULT_PINATA_GATEWAY_HOST,
      VITE_ORBITOR_GATEWAY_HOST: DEFAULT_ORBITOR_GATEWAY_HOST,
      CRM_URL: "",
      DEMO_VIDEO_URL: "",
      PR_URL: "",
    });
  });

  it("A-16 T021 (AC-6): the build gets VITE_COGNITO_USER_POOL_ID / _CLIENT_ID from CountyLensApi, never a literal", () => {
    const { stacks } = appUnderTest();
    const env = webEnv(Template.fromStack(stacks.web));
    for (const key of ["VITE_COGNITO_USER_POOL_ID", "VITE_COGNITO_USER_POOL_CLIENT_ID"]) {
      expect(JSON.stringify(env[key]), key).toMatch(/Fn::GetStackOutput|Fn::ImportValue/);
      expect(JSON.stringify(env[key]), key).toContain("CountyLensApi");
    }
    // A standalone Web stack without the pool wired emits neither.
    expect(synthWeb()).not.toHaveProperty("VITE_COGNITO_USER_POOL_ID");
  });
});
