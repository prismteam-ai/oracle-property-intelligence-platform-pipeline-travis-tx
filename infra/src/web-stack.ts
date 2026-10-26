// CountyLensWeb (A-03 T043): Amplify Hosting for apps/web, as agent-design metagross § 3 and
// research R-09 decided. L1 CfnApp (the alpha construct sends a legacy OAuth token; L1
// AccessToken uses the Amplify GitHub App), platform WEB (static SPA), build spec read from
// amplify.yml in the repository, previews for every 0* story branch, feature/oracle-pipeline as
// PRODUCTION (the branch the PR is opened from), the /api/<*> rewrite to the HTTP API so the
// API is same-origin on every preview (no CORS), the SPA fallback, and the response headers the
// hosted tests need (/build.json never cached). No header for the DuckDB WASM: Amplify rejects
// read-only headers (content-length, transfer-encoding, content-encoding, warning, via) in
// customHeaders, so the build ships it as a plain .wasm.gz that the engine gunzips itself
// (plan risk R2 fallback, 2026-10-21).
//
// The GitHub token is a CloudFormation parameter with NoEcho (AD-14: no Secrets Manager; CFN
// does not resolve ssm-secure for Amplify). Amplify uses it once to authorise the GitHub App and
// does not store it. The PO passes it on the first deploy only (agent-design § 3 "PO steps");
// later deploys reuse the previous value, so CI never sees it. Nothing here bills while idle
// (A7): Amplify charges build minutes and bytes served only.
import { Annotations, CfnOutput, CfnParameter, Stack, type StackProps } from "aws-cdk-lib";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { CONTEXT_KEYS, ENV_NAMES, type InfraConfig } from "./config.js";

/** Amplify app name (console and `aws amplify list-apps`). */
export const AMPLIFY_APP_NAME = "countylens-web";
/** Must equal the `appRoot` in amplify.yml (Amplify monorepo rule). */
export const AMPLIFY_MONOREPO_APP_ROOT = "apps/web";
/** Story branches `NNN-slug` (constitution XX, AD-29) get their own preview URL. */
export const AUTO_BRANCH_PATTERN = "0*";
/** FILEBASE_GATEWAY_HOST (plan § "Fixed texts and config keys"); the web build reads VITE_*. */
export const DEFAULT_FILEBASE_GATEWAY_HOST = "ipfs.filebase.io";
/** PINATA_GATEWAY_HOST (AM-01, AM-10): an independent Verify gateway; the web build reads VITE_*. */
export const DEFAULT_PINATA_GATEWAY_HOST = "gateway.pinata.cloud";
/** ORBITOR_GATEWAY_HOST (A-16 AM-10): the second independent Verify gateway; the web build reads VITE_*. */
export const DEFAULT_ORBITOR_GATEWAY_HOST = "ipfs.orbitor.dev";
/**
 * Hub links (A-13 contracts/site-links.md, research R6): Amplify variable → CDK context key.
 * Empty by default (the link is hidden; the CRM card stays "Coming soon · Not deployed yet").
 * amplify.yml writes them to public/site-links.json; switching one is a Web-stack deploy plus
 * an Amplify rebuild, never a code change.
 */
export const SITE_LINK_CONTEXT_KEYS = {
  CRM_URL: "countylens:crmUrl",
  DEMO_VIDEO_URL: "countylens:demoVideoUrl",
  PR_URL: "countylens:prUrl",
} as const;
/** SSM String parameters mirroring the outputs (same pattern as the Data stack). */
export const WEB_SSM_PREFIX = "/countylens/web";
/** Logical id of the noEcho parameter: `--parameters CountyLensWeb:GitHubAccessToken=…`. */
export const GITHUB_TOKEN_PARAMETER_ID = "GitHubAccessToken";
/** Rewrite (200) of the API under the site's own origin; Target is `${httpApiUrl}/<*>`. */
export const API_REWRITE_SOURCE = "/api/<*>";
/**
 * The agent is its own HTTP API (a separate Lambda, A-14 AD-27), so `/api/agent/<*>` is rewritten
 * to it, ahead of the general API rule; the Target keeps the `/agent/` prefix its route expects.
 */
export const AGENT_REWRITE_SOURCE = "/api/agent/<*>";
/**
 * Amplify's SPA fallback in regex form: a path with no extension, or an extension outside the
 * list, is served as /index.html (200) for the client-side router. Every static type the build
 * emits is listed so a missing asset is a real 404, never a silent index.html.
 */
export const SPA_FALLBACK_SOURCE =
  "</^[^.]+$|\\.(?!(css|gif|gz|ico|jpg|jpeg|js|json|map|png|svg|txt|wasm|webmanifest|webp|woff|woff2|ttf)$)([^.]+$)/>";

export const HTTP_API_URL_NOT_WIRED_WARNING =
  "CountyLensWeb: httpApiUrl is not wired from CountyLensApi, so the /api/<*> rewrite is not emitted; " +
  "pass it in src/app.ts (the Api stack's HTTP API URL without a trailing slash) before deploying";
export const CID_COPY_HOST_NOT_WIRED_WARNING =
  "CountyLensWeb: cidCopyHost is not wired from CountyLensData, so VITE_CID_COPY_HOST is not emitted; " +
  "pass data.distribution.distributionDomainName in src/app.ts before deploying";

export interface WebStackProps extends StackProps {
  /**
   * GitHub `owner/repo` (the fork) and the production branch (config.github). When omitted the
   * stack reads the same CDK context keys config.ts validates (infra/cdk.json).
   */
  readonly github?: InfraConfig["github"];
  /**
   * The HTTP API invoke URL from CountyLensApi, without a trailing slash
   * (`https://{id}.execute-api.{region}.amazonaws.com`). Missing → warning, no /api rule.
   */
  readonly httpApiUrl?: string;
  /** The agent HTTP API invoke URL from CountyLensApi (A-14), without a trailing slash. Missing → no agent rule. */
  readonly agentApiUrl?: string;
  /** CloudFront domain of the CID copy from CountyLensData (CID_COPY_HOST). Missing → warning. */
  readonly cidCopyHost?: string;
  /** Public IPFS gateway host used as the labelled fallback (FILEBASE_GATEWAY_HOST). */
  readonly filebaseGatewayHost?: string;
  /** Independent IPFS gateway host for Verify (PINATA_GATEWAY_HOST, A-13 AM-01). */
  readonly pinataGatewayHost?: string;
  /** Second independent IPFS gateway host for Verify (ORBITOR_GATEWAY_HOST, A-16 AM-10). */
  readonly orbitorGatewayHost?: string;
  /** A-16 (AC-6): the admin user pool and SRP client from CountyLensApi. Missing → no admin sign-in vars. */
  readonly cognito?: { readonly userPoolId: string; readonly userPoolClientId: string };
}

/** A site link from context: "" when unset or blank, else an https:// URL (anything else fails synth). */
function siteLinkFromContext(scope: Construct, key: string): string {
  const raw: unknown = scope.node.tryGetContext(key);
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") {
    throw new Error(`CountyLensWeb: ${key} must be an https:// URL or empty, got ${typeof raw}`);
  }
  const value = raw.trim();
  if (value === "") return "";
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (url?.protocol !== "https:") {
    throw new Error(`CountyLensWeb: ${key} must be an https:// URL or empty, got ${value}`);
  }
  return value;
}

/** Amplify's branch URL label: `/` becomes `-` (feature/oracle-pipeline → feature-oracle-pipeline). */
export function branchSlug(branchName: string): string {
  return branchName.replace(/\//g, "-");
}

/** The fork and production branch from CDK context (the keys config.ts already validated). */
function githubFromContext(scope: Construct): InfraConfig["github"] {
  const repository: unknown = scope.node.tryGetContext(CONTEXT_KEYS.githubRepository);
  const ref: unknown = scope.node.tryGetContext(CONTEXT_KEYS.githubRef);
  if (typeof repository !== "string" || typeof ref !== "string" || !repository || !ref) {
    throw new Error(
      `CountyLensWeb: props.github is missing and CDK context ${CONTEXT_KEYS.githubRepository} / ` +
        `${CONTEXT_KEYS.githubRef} is not set (infra/cdk.json or -c)`,
    );
  }
  return { repository, ref };
}

/**
 * The app-level custom headers in Amplify's monorepo YAML format (the console's "Custom headers"
 * value; a monorepo app must use the `applications` form). Rendered by hand so the stack needs
 * no YAML dependency; the test checks the exact shape.
 */
export function renderCustomHeaders(
  appRoot: string,
  rules: readonly { pattern: string; headers: readonly { key: string; value: string }[] }[],
): string {
  const lines = ["applications:", `  - appRoot: ${appRoot}`, "    customHeaders:"];
  for (const rule of rules) {
    lines.push(`      - pattern: '${rule.pattern}'`, "        headers:");
    for (const header of rule.headers) {
      lines.push(`          - key: '${header.key}'`, `            value: '${header.value}'`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export class WebStack extends Stack {
  readonly app: amplify.CfnApp;
  readonly productionBranch: amplify.CfnBranch;
  /** Token for the Cert stack's domain association. */
  readonly appId: string;
  /** The branch the custom domain maps to (prefix '' → this branch). */
  readonly productionBranchName: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const github = props.github ?? githubFromContext(this);
    const filebaseGatewayHost = props.filebaseGatewayHost ?? DEFAULT_FILEBASE_GATEWAY_HOST;
    this.productionBranchName = github.ref;

    // The token never lives in code, context, env files or git: NoEcho, no default, typed by the
    // PO at the first deploy (`--parameters`), reused by CloudFormation afterwards.
    const accessToken = new CfnParameter(this, GITHUB_TOKEN_PARAMETER_ID, {
      type: "String",
      noEcho: true,
      minLength: 1,
      description:
        "GitHub personal access token (classic; scopes repo, admin:repo_hook; short expiry) that Amplify " +
        "uses once to connect the GitHub App to the fork. Amplify does not store it. Supplied with " +
        "--parameters on the first CountyLensWeb deploy; later deploys keep the previous value. " +
        "Revoke it on GitHub after the first successful Amplify build.",
    });

    const environmentVariables: amplify.CfnApp.EnvironmentVariableProperty[] = [
      { name: "AMPLIFY_MONOREPO_APP_ROOT", value: AMPLIFY_MONOREPO_APP_ROOT },
    ];
    if (props.cidCopyHost === undefined) {
      Annotations.of(this).addWarningV2(
        "countylens:web:cidCopyHost-not-wired",
        CID_COPY_HOST_NOT_WIRED_WARNING,
      );
    } else {
      environmentVariables.push({ name: "VITE_CID_COPY_HOST", value: props.cidCopyHost });
    }
    environmentVariables.push({ name: "VITE_FILEBASE_GATEWAY_HOST", value: filebaseGatewayHost });
    environmentVariables.push({
      name: "VITE_PINATA_GATEWAY_HOST",
      value: props.pinataGatewayHost ?? DEFAULT_PINATA_GATEWAY_HOST,
    });
    environmentVariables.push({
      name: "VITE_ORBITOR_GATEWAY_HOST",
      value: props.orbitorGatewayHost ?? DEFAULT_ORBITOR_GATEWAY_HOST,
    });
    for (const [name, key] of Object.entries(SITE_LINK_CONTEXT_KEYS)) {
      environmentVariables.push({ name, value: siteLinkFromContext(this, key) });
    }
    // A-16 (AC-6): public identifiers only (a pool id and a secretless SRP client id).
    if (props.cognito !== undefined) {
      environmentVariables.push(
        { name: ENV_NAMES.webUserPoolId, value: props.cognito.userPoolId },
        { name: ENV_NAMES.webUserPoolClientId, value: props.cognito.userPoolClientId },
      );
    }

    // Rules apply top-down: the API rewrite must come before the SPA fallback, whose regex would
    // otherwise swallow /api/trpc/runs.summary (it has a dot) as index.html.
    const customRules: amplify.CfnApp.CustomRuleProperty[] = [];
    if (props.httpApiUrl === undefined) {
      Annotations.of(this).addWarningV2(
        "countylens:web:httpApiUrl-not-wired",
        HTTP_API_URL_NOT_WIRED_WARNING,
      );
    } else {
      if (props.agentApiUrl !== undefined) {
        customRules.push({
          source: AGENT_REWRITE_SOURCE,
          target: `${props.agentApiUrl}/agent/<*>`,
          status: "200",
        });
      }
      customRules.push({
        source: API_REWRITE_SOURCE,
        target: `${props.httpApiUrl}/<*>`,
        status: "200",
      });
    }
    customRules.push({ source: SPA_FALLBACK_SOURCE, target: "/index.html", status: "200" });

    this.app = new amplify.CfnApp(this, "App", {
      name: AMPLIFY_APP_NAME,
      description:
        "CountyLens hosted UI (apps/web): Runs page and Permits list over the CID copy; " +
        "previews per 0* story branch, feature/oracle-pipeline as production.",
      platform: "WEB",
      repository: `https://github.com/${github.repository}`,
      accessToken: accessToken.valueAsString,
      // No buildSpec: Amplify reads amplify.yml from the repository (appRoot apps/web, T044).
      environmentVariables,
      customRules,
      customHeaders: renderCustomHeaders(AMPLIFY_MONOREPO_APP_ROOT, [
        {
          // CI and the hosted tests poll /build.json for the deployed sha; never serve a stale one.
          pattern: "/build.json",
          headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
        },
      ]),
      enableBranchAutoDeletion: false,
      autoBranchCreationConfig: {
        enableAutoBranchCreation: true,
        autoBranchCreationPatterns: [AUTO_BRANCH_PATTERN],
        stage: "DEVELOPMENT",
        enableAutoBuild: true,
        enablePullRequestPreview: false,
      },
    });
    this.appId = this.app.attrAppId;

    this.productionBranch = new amplify.CfnBranch(this, "ProductionBranch", {
      appId: this.app.attrAppId,
      branchName: this.productionBranchName,
      description: `${this.productionBranchName}: the PR branch; countylens.aldarraj.com maps to it (CountyLensCert)`,
      stage: "PRODUCTION",
      enableAutoBuild: true,
      enablePullRequestPreview: false,
    });

    const defaultDomain = this.app.attrDefaultDomain;
    new CfnOutput(this, "AmplifyAppId", {
      value: this.app.attrAppId,
      description: `AMPLIFY_APP_ID (CI repository variable; mirrored to SSM ${WEB_SSM_PREFIX}/app-id)`,
    });
    new CfnOutput(this, "AmplifyDefaultDomain", {
      value: defaultDomain,
      description: "Amplify default domain: {appId}.amplifyapp.com",
    });
    new CfnOutput(this, "AmplifyBranchUrlPattern", {
      value: `https://<branch-slug>.${defaultDomain}`,
      description:
        "Preview URL per branch: the branch name with '/' replaced by '-' " +
        "(feature/oracle-pipeline → feature-oracle-pipeline; 003-walking-skeleton unchanged)",
    });
    new CfnOutput(this, "AmplifyProductionUrl", {
      value: `https://${branchSlug(this.productionBranchName)}.${defaultDomain}`,
      description:
        "Hosted runtime fallback (ASM-8, FR-010) while the custom domain is pending; named in the evidence",
    });

    new ssm.StringParameter(this, "AppIdParameter", {
      parameterName: `${WEB_SSM_PREFIX}/app-id`,
      stringValue: this.app.attrAppId,
      description: "Amplify app id (CountyLensWeb output AmplifyAppId)",
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
