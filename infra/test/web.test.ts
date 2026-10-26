// CountyLensWeb and CountyLensCert assertions (A-03 T034) against agent-design metagross § 3,
// research R-09, ARD AD-13 / AD-14 / § 16 AM-02 and the test plan (TC-052 build-time checks):
// the Amplify L1 app for apps/web (platform WEB, build spec from amplify.yml in the repo, the
// GitHub token as a noEcho parameter, previews for 0* branches, feature/oracle-pipeline as
// PRODUCTION, the /api rewrite to the HTTP API, the SPA fallback, the build.json header and no
// read-only header Amplify rejects) and the custom-domain association only (countylens.aldarraj.com, never the root).
//
// The stacks are built two ways. "Wired" builds them directly with explicit props, so every
// value is a literal and the assertions are exact. "In the app" builds them through
// src/app.ts exactly as `cdk synth` does; there the cross-stack values arrive from the Api and
// Data stacks, or the stack says loudly (synth warning) that a wire is missing.
import { App, Tags } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  CERT_WEB_NOT_WIRED_WARNING,
  CertStack,
  COUNTYLENS_DOMAIN_NAME,
  DOMAIN_SSM_PREFIX,
} from "../src/cert-stack.js";
import { loadConfig, PROJECT_TAG_KEY, type InfraConfig } from "../src/config.js";
import {
  AMPLIFY_APP_NAME,
  AMPLIFY_MONOREPO_APP_ROOT,
  AGENT_REWRITE_SOURCE,
  API_REWRITE_SOURCE,
  AUTO_BRANCH_PATTERN,
  CID_COPY_HOST_NOT_WIRED_WARNING,
  DEFAULT_FILEBASE_GATEWAY_HOST,
  DEFAULT_ORBITOR_GATEWAY_HOST,
  DEFAULT_PINATA_GATEWAY_HOST,
  GITHUB_TOKEN_PARAMETER_ID,
  HTTP_API_URL_NOT_WIRED_WARNING,
  SPA_FALLBACK_SOURCE,
  WEB_SSM_PREFIX,
  WebStack,
  branchSlug,
} from "../src/web-stack.js";
import { appUnderTest, cdkJsonContext } from "./helpers.js";

// No region literal here: stacks.test.ts scans infra/**/*.ts for one (P0-18).
const HTTP_API_URL = "https://api.example.invalid";
const AGENT_API_URL = "https://agent.example.invalid";
const CID_COPY_HOST = "d111111abcdef8.cloudfront.net";
const PRODUCTION_BRANCH = "feature/oracle-pipeline";
const EXAMPLE_APP_ID = "d1exampleappid";
/** Amplify's error text on the first deploy: headers customHeaders may not set. */
const READONLY_AMPLIFY_HEADERS = [
  "content-length",
  "transfer-encoding",
  "content-encoding",
  "warning",
  "via",
] as const;

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}
interface CustomRule {
  Source: string;
  Target: unknown;
  Status?: string;
  Condition?: string;
}
interface EnvironmentVariable {
  Name: string;
  Value: unknown;
}
interface AmplifyAppProps {
  Name?: string;
  Platform?: string;
  Repository?: string;
  AccessToken?: unknown;
  OauthToken?: unknown;
  BuildSpec?: unknown;
  BasicAuthConfig?: unknown;
  IAMServiceRole?: unknown;
  EnableBranchAutoDeletion?: boolean;
  AutoBranchCreationConfig?: Record<string, unknown>;
  CustomRules?: CustomRule[];
  CustomHeaders?: unknown;
  EnvironmentVariables?: EnvironmentVariable[];
  Tags?: { Key: string; Value: string }[];
}
interface CfnParameter {
  Type: string;
  NoEcho?: boolean;
  Default?: unknown;
  MinLength?: number;
}

const json = (v: unknown): string => JSON.stringify(v);
/** Match.stringLikeRegexp takes a regex; the warning texts contain `(`, `.` and `{`. */
const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function only<T>(record: Record<string, T>, label: string): [string, T] {
  const entries = Object.entries(record);
  expect(entries, label).toHaveLength(1);
  return entries[0] as [string, T];
}

function amplifyApp(template: Template): AmplifyAppProps {
  return only(template.findResources("AWS::Amplify::App"), "Amplify app")[1]
    .Properties as AmplifyAppProps;
}

function envOf(app: AmplifyAppProps): Record<string, unknown> {
  return Object.fromEntries((app.EnvironmentVariables ?? []).map((e) => [e.Name, e.Value]));
}

function stackBase(config: InfraConfig) {
  return { env: { region: config.region }, tags: { [PROJECT_TAG_KEY]: config.projectName } };
}

/** Web + Cert built directly with every wire given as a literal. */
function synthWired(): {
  config: InfraConfig;
  web: WebStack;
  cert: CertStack;
  webT: Template;
  certT: Template;
} {
  const app = new App({ context: cdkJsonContext() });
  const config = loadConfig(process.env, (key) => app.node.tryGetContext(key));
  const base = stackBase(config);
  const web = new WebStack(app, "CountyLensWeb", {
    ...base,
    github: config.github,
    httpApiUrl: HTTP_API_URL,
    agentApiUrl: AGENT_API_URL,
    cidCopyHost: CID_COPY_HOST,
    filebaseGatewayHost: DEFAULT_FILEBASE_GATEWAY_HOST,
  });
  const cert = new CertStack(app, "CountyLensCert", {
    ...base,
    web: { appId: EXAMPLE_APP_ID, branchName: PRODUCTION_BRANCH },
  });
  Tags.of(app).add(PROJECT_TAG_KEY, config.projectName);
  return { config, web, cert, webT: Template.fromStack(web), certT: Template.fromStack(cert) };
}

describe("CountyLensWeb: the Amplify app for apps/web (agent-design metagross § 3)", () => {
  const { config, webT } = synthWired();
  const app = amplifyApp(webT);

  it("is one L1 AWS::Amplify::App, platform WEB, on the fork from context, build spec from amplify.yml", () => {
    webT.resourceCountIs("AWS::Amplify::App", 1);
    expect(app.Name).toBe(AMPLIFY_APP_NAME);
    expect(app.Platform).toBe("WEB");
    expect(app.Repository).toBe(`https://github.com/${config.github.repository}`);
    // The build spec lives in amplify.yml in the repository (T044), never inline.
    expect(app.BuildSpec).toBeUndefined();
    expect(app.BasicAuthConfig, "public, read-only site (FR-013)").toBeUndefined();
    expect(app.IAMServiceRole, "static hosting needs no service role (A7)").toBeUndefined();
  });

  it("takes the GitHub token from the noEcho parameter GitHubAccessToken, referenced once, never OauthToken", () => {
    const parameters = (webT.toJSON().Parameters ?? {}) as Record<string, CfnParameter>;
    const token = parameters[GITHUB_TOKEN_PARAMETER_ID];
    expect(token, "GitHubAccessToken parameter").toBeDefined();
    expect(token?.Type).toBe("String");
    expect(token?.NoEcho).toBe(true);
    expect(token?.Default, "no default: the PO supplies it at deploy time").toBeUndefined();
    expect(token?.MinLength).toBe(1);
    expect(app.AccessToken).toEqual({ Ref: GITHUB_TOKEN_PARAMETER_ID });
    expect(app.OauthToken, "legacy OAuth path is not used (GitHub App)").toBeUndefined();
    const refs = json(webT.toJSON()).match(/"Ref":"GitHubAccessToken"/g) ?? [];
    expect(refs, "the token reaches only the AccessToken property").toHaveLength(1);
    expect(json(webT.toJSON().Outputs ?? {})).not.toContain(GITHUB_TOKEN_PARAMETER_ID);
  });

  it("environment: AMPLIFY_MONOREPO_APP_ROOT=apps/web, the gateway hosts, the A-13 site links and nothing secret", () => {
    // A-13 T016 added VITE_PINATA_GATEWAY_HOST and the empty-by-default site links
    // (infra/test/web-stack.test.ts covers them in detail).
    expect(envOf(app)).toEqual({
      AMPLIFY_MONOREPO_APP_ROOT: AMPLIFY_MONOREPO_APP_ROOT,
      VITE_CID_COPY_HOST: CID_COPY_HOST,
      VITE_FILEBASE_GATEWAY_HOST: DEFAULT_FILEBASE_GATEWAY_HOST,
      VITE_PINATA_GATEWAY_HOST: DEFAULT_PINATA_GATEWAY_HOST,
      VITE_ORBITOR_GATEWAY_HOST: DEFAULT_ORBITOR_GATEWAY_HOST,
      CRM_URL: "",
      DEMO_VIDEO_URL: "",
      PR_URL: "",
    });
    expect(AMPLIFY_MONOREPO_APP_ROOT).toBe("apps/web");
    expect(DEFAULT_FILEBASE_GATEWAY_HOST).toBe("ipfs.filebase.io");
    for (const name of Object.keys(envOf(app))) {
      expect(name).not.toMatch(/token|secret|key|password/i);
    }
  });

  it("creates previews for 0* branches (stage DEVELOPMENT, auto build) and never deletes branches", () => {
    expect(AUTO_BRANCH_PATTERN).toBe("0*");
    expect(app.AutoBranchCreationConfig).toEqual(
      expect.objectContaining({
        EnableAutoBranchCreation: true,
        AutoBranchCreationPatterns: [AUTO_BRANCH_PATTERN],
        Stage: "DEVELOPMENT",
        EnableAutoBuild: true,
        EnablePullRequestPreview: false,
      }),
    );
    expect(app.EnableBranchAutoDeletion).toBe(false);
  });

  it("has one CfnBranch feature/oracle-pipeline with stage PRODUCTION and auto build on", () => {
    expect(config.github.ref).toBe(PRODUCTION_BRANCH);
    webT.resourceCountIs("AWS::Amplify::Branch", 1);
    webT.hasResourceProperties("AWS::Amplify::Branch", {
      AppId: { "Fn::GetAtt": [Match.anyValue(), "AppId"] },
      BranchName: PRODUCTION_BRANCH,
      Stage: "PRODUCTION",
      EnableAutoBuild: true,
      EnablePullRequestPreview: false,
    });
  });

  it("rewrites /api/agent/<*> to the agent API, then /api/<*> to the HTTP API (200), then the SPA fallback that excludes static files", () => {
    const rules = app.CustomRules ?? [];
    expect(rules.map((r) => r.Source)).toEqual([
      AGENT_REWRITE_SOURCE,
      API_REWRITE_SOURCE,
      SPA_FALLBACK_SOURCE,
    ]);
    expect(rules[0]).toEqual({
      Source: "/api/agent/<*>",
      Target: `${AGENT_API_URL}/agent/<*>`,
      Status: "200",
    });
    expect(rules[1]).toEqual({
      Source: "/api/<*>",
      Target: `${HTTP_API_URL}/<*>`,
      Status: "200",
    });
    expect(rules[2]).toEqual({ Source: SPA_FALLBACK_SOURCE, Target: "/index.html", Status: "200" });
    // Amplify's regex form: anything without an extension, or with one outside this list.
    expect(SPA_FALLBACK_SOURCE).toMatch(
      /^<\/\^\[\^.\]\+\$\|\\\.\(\?!\(.*\)\$\)\(\[\^.\]\+\$\)\/>$/,
    );
    const excluded = (SPA_FALLBACK_SOURCE.match(/\(\?!\(([^)]*)\)\$\)/) ?? [])[1]?.split("|") ?? [];
    // gz: the engine fetches the gzip-compressed duckdb-eh.wasm.gz (compress-wasm.ts, plan R2).
    for (const ext of ["wasm", "gz", "json", "js", "css", "map", "ico", "png", "svg", "woff2"]) {
      expect(excluded, `${ext} is served as a file, not index.html`).toContain(ext);
    }
    expect(json(rules)).not.toContain("404");
  });

  it("custom headers (monorepo YAML): /build.json no-cache; no read-only header Amplify rejects", () => {
    const headers = app.CustomHeaders;
    expect(typeof headers).toBe("string");
    const yaml = headers as string;
    expect(yaml).toMatch(/^applications:\n\s+- appRoot: apps\/web\n\s+customHeaders:\n/);
    expect(yaml).toMatch(
      /pattern: '\/build\.json'\n\s+headers:\n\s+- key: 'Cache-Control'\n\s+value: '[^']*no-cache[^']*'/,
    );
    // First deploy (2026-10-21): CREATE_FAILED "can not specify a readonly header in
    // customHeaders. Readonly headers are: [content-length, transfer-encoding, content-encoding,
    // warning, via]". The WASM is now a plain .gz the engine decompresses itself (plan R2).
    const keys = [...yaml.matchAll(/- key: '([^']*)'/g)].map((m) => (m[1] ?? "").toLowerCase());
    expect(keys.length).toBeGreaterThan(0);
    for (const readonly of READONLY_AMPLIFY_HEADERS) {
      expect(keys, `${readonly} is read-only in Amplify customHeaders`).not.toContain(readonly);
    }
    expect(yaml).not.toMatch(/\t/);
  });

  it("outputs AmplifyAppId, the default domain, the branch URL pattern and the production URL; mirrors the app id to SSM", () => {
    webT.hasOutput("AmplifyAppId", {
      Value: { "Fn::GetAtt": [Match.anyValue(), "AppId"] },
      Description: Match.stringLikeRegexp("AMPLIFY_APP_ID"),
    });
    webT.hasOutput("AmplifyDefaultDomain", {
      Value: { "Fn::GetAtt": [Match.anyValue(), "DefaultDomain"] },
    });
    const outputs = webT.toJSON().Outputs as Record<
      string,
      { Value: unknown; Description?: string }
    >;
    expect(json(outputs.AmplifyBranchUrlPattern?.Value)).toContain("https://<branch-slug>.");
    expect(outputs.AmplifyBranchUrlPattern?.Description).toContain("feature-oracle-pipeline");
    expect(json(outputs.AmplifyProductionUrl?.Value)).toContain(
      `https://${branchSlug(PRODUCTION_BRANCH)}.`,
    );
    expect(json(outputs.AmplifyProductionUrl?.Value)).toContain("DefaultDomain");
    expect(branchSlug("feature/oracle-pipeline")).toBe("feature-oracle-pipeline");
    expect(branchSlug("003-walking-skeleton")).toBe("003-walking-skeleton");
    expect(WEB_SSM_PREFIX).toBe("/countylens/web");
    webT.hasResourceProperties("AWS::SSM::Parameter", {
      Name: `${WEB_SSM_PREFIX}/app-id`,
      Type: "String",
      Value: { "Fn::GetAtt": [Match.anyValue(), "AppId"] },
    });
    for (const p of Object.values(webT.findResources("AWS::SSM::Parameter"))) {
      expect((p.Properties as { Tier?: unknown }).Tier ?? "Standard").toBe("Standard");
    }
  });

  it("creates nothing else: no Route 53, no ACM, no Lambda, no custom resource; tags project_name=oracle-travis", () => {
    const resources = webT.toJSON().Resources as Record<string, CfnResource>;
    const types = [...new Set(Object.values(resources).map((r) => r.Type))].sort();
    expect(types).toEqual(["AWS::Amplify::App", "AWS::Amplify::Branch", "AWS::SSM::Parameter"]);
    for (const [id, r] of Object.entries(resources)) {
      expect(json(r.Properties?.Tags), `${id} (${r.Type}) carries the project tag`).toContain(
        "oracle-travis",
      );
    }
    Annotations.fromStack(synthWired().web).hasNoWarning("*", Match.stringLikeRegexp("not wired"));
  });

  it("unwired (as before src/app.ts passes the Api and Data values): warns per missing wire, emits no half rule", () => {
    const app2 = new App({ context: cdkJsonContext() });
    // No github prop either: the stack falls back to the cdk.json context keys config.ts checks.
    const web = new WebStack(app2, "CountyLensWeb", stackBase(config));
    const template = Template.fromStack(web);
    const annotations = Annotations.fromStack(web);
    annotations.hasWarning("*", Match.stringLikeRegexp(literal(HTTP_API_URL_NOT_WIRED_WARNING)));
    annotations.hasWarning("*", Match.stringLikeRegexp(literal(CID_COPY_HOST_NOT_WIRED_WARNING)));
    const unwired = amplifyApp(template);
    expect(unwired.Platform).toBe("WEB");
    expect(unwired.Repository).toBe(`https://github.com/${config.github.repository}`);
    expect(web.productionBranchName).toBe(config.github.ref);
    expect((unwired.CustomRules ?? []).map((r) => r.Source)).toEqual([SPA_FALLBACK_SOURCE]);
    expect(envOf(unwired)).toEqual({
      AMPLIFY_MONOREPO_APP_ROOT: AMPLIFY_MONOREPO_APP_ROOT,
      VITE_FILEBASE_GATEWAY_HOST: DEFAULT_FILEBASE_GATEWAY_HOST,
      VITE_PINATA_GATEWAY_HOST: DEFAULT_PINATA_GATEWAY_HOST,
      VITE_ORBITOR_GATEWAY_HOST: DEFAULT_ORBITOR_GATEWAY_HOST,
      CRM_URL: "",
      DEMO_VIDEO_URL: "",
      PR_URL: "",
    });
  });
});

describe("CountyLensCert: the custom-domain association only (AD-13, AM-02)", () => {
  const { certT } = synthWired();

  it("holds exactly one AWS::Amplify::Domain for countylens.aldarraj.com and nothing else", () => {
    expect(COUNTYLENS_DOMAIN_NAME).toBe("countylens.aldarraj.com");
    const resources = certT.toJSON().Resources as Record<string, CfnResource>;
    const types = [...new Set(Object.values(resources).map((r) => r.Type))].sort();
    expect(types).toEqual(["AWS::Amplify::Domain", "AWS::SSM::Parameter"]);
    certT.resourceCountIs("AWS::Amplify::Domain", 1);
    certT.resourceCountIs("AWS::Route53::HostedZone", 0);
    certT.resourceCountIs("AWS::Route53::RecordSet", 0);
    certT.resourceCountIs("AWS::CertificateManager::Certificate", 0);
  });

  it("maps the bare sub-domain (prefix '') to feature/oracle-pipeline with the default Amplify-managed certificate", () => {
    certT.hasResourceProperties("AWS::Amplify::Domain", {
      AppId: EXAMPLE_APP_ID,
      DomainName: COUNTYLENS_DOMAIN_NAME,
      SubDomainSettings: [{ Prefix: "", BranchName: PRODUCTION_BRANCH }],
    });
    const [, domain] = only(certT.findResources("AWS::Amplify::Domain"), "domain");
    const props = domain.Properties as Record<string, unknown>;
    expect((props.SubDomainSettings as unknown[]).length).toBe(1);
    // Omitted CertificateSettings = Amplify-managed (the default). Setting it, even to
    // AMPLIFY_MANAGED, made CloudFormation demand a custom certificate ARN (2026-10-21 deploy).
    expect(
      props.CertificateSettings,
      "managed by default: CertificateSettings absent",
    ).toBeUndefined();
    certT.resourceCountIs("AWS::CertificateManager::Certificate", 0);
    expect(props.EnableAutoSubDomain ?? false).toBe(false);
    expect(props.AutoSubDomainIamRole, "no IAM role: DNS is at Namecheap (AD-13)").toBeUndefined();
    expect(props.AutoSubDomainCreationPatterns).toBeUndefined();
  });

  it("never associates the root domain: every aldarraj.com in the template is countylens.aldarraj.com", () => {
    const text = json(certT.toJSON());
    expect(text).toContain("countylens.aldarraj.com");
    // Every host that ends in aldarraj.com is exactly countylens.aldarraj.com (no bare root).
    for (const m of text.matchAll(/[^"\s]*aldarraj\.com/g)) {
      expect(m[0]).toMatch(/(^|[^.\w-])countylens\.aldarraj\.com$/);
    }
  });

  it("outputs the domain status and the certificate-validation record (the PO's Namecheap CNAMEs); mirrors the name to SSM", () => {
    certT.hasOutput("DomainStatus", {
      Value: { "Fn::GetAtt": [Match.anyValue(), "DomainStatus"] },
    });
    certT.hasOutput("CertificateVerificationRecord", {
      Value: { "Fn::GetAtt": [Match.anyValue(), "CertificateRecord"] },
      Description: Match.stringLikeRegexp("Namecheap"),
    });
    certT.hasOutput("HostedUrl", { Value: `https://${COUNTYLENS_DOMAIN_NAME}` });
    expect(DOMAIN_SSM_PREFIX).toBe("/countylens/domain");
    certT.hasResourceProperties("AWS::SSM::Parameter", {
      Name: `${DOMAIN_SSM_PREFIX}/name`,
      Type: "String",
      Value: COUNTYLENS_DOMAIN_NAME,
    });
  });

  it("unwired (no Web app id yet): no resources, one warning, still synthesizes", () => {
    const app2 = new App({ context: cdkJsonContext() });
    const config = loadConfig(process.env, (key) => app2.node.tryGetContext(key));
    const cert = new CertStack(app2, "CountyLensCert", stackBase(config));
    const template = Template.fromStack(cert);
    expect(Object.keys(template.toJSON().Resources ?? {})).toEqual([]);
    Annotations.fromStack(cert).hasWarning(
      "*",
      Match.stringLikeRegexp(literal(CERT_WEB_NOT_WIRED_WARNING)),
    );
  });
});

describe("CountyLensWeb + CountyLensCert as src/app.ts builds them (what `cdk synth` deploys)", () => {
  it("Web is a real Amplify app in the app; each cross-stack wire is either a stack reference or a loud warning", () => {
    const { stacks } = appUnderTest();
    const webT = Template.fromStack(stacks.web);
    const certT = Template.fromStack(stacks.cert);
    webT.resourceCountIs("AWS::Amplify::App", 1);
    webT.resourceCountIs("AWS::Amplify::Branch", 1);
    expect(amplifyApp(webT).Platform).toBe("WEB");

    const notWired = (stack: WebStack | CertStack) =>
      Annotations.fromStack(stack)
        .findWarning("*", Match.stringLikeRegexp("not wired"))
        .map((w) => String(w.entry.data));
    const webWarnings = notWired(stacks.web);
    const certWarnings = notWired(stacks.cert);
    const crossStack = /Fn::GetStackOutput|Fn::ImportValue/;

    if (webWarnings.length === 0 && certWarnings.length === 0) {
      // Wired: the Api URL, the CID-copy host and the app id come from the other stacks.
      const app = amplifyApp(webT);
      const apiRule = (app.CustomRules ?? []).find((r) => r.Source === API_REWRITE_SOURCE);
      expect(json(apiRule?.Target)).toMatch(crossStack);
      expect(json(envOf(app).VITE_CID_COPY_HOST)).toMatch(crossStack);
      certT.resourceCountIs("AWS::Amplify::Domain", 1);
      const [, domain] = only(certT.findResources("AWS::Amplify::Domain"), "domain");
      expect(json((domain.Properties as { AppId: unknown }).AppId)).toMatch(crossStack);
    } else {
      // Not wired yet (src/app.ts still passes only StackProps): exactly these warnings, so
      // `cdk synth --strict` fails and the gap cannot deploy silently.
      const text = (m: string): string => m.split(" [ack:")[0] ?? m;
      expect(webWarnings.map(text).sort()).toEqual(
        [HTTP_API_URL_NOT_WIRED_WARNING, CID_COPY_HOST_NOT_WIRED_WARNING].sort(),
      );
      expect(certWarnings.map(text)).toEqual([CERT_WEB_NOT_WIRED_WARNING]);
    }
  });
});
