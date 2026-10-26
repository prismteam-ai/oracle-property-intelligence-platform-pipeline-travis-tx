// .github/workflows/ci.yml after the metagross review (M4) and AM-08 (2026-10-21): the workflow
// parses as YAML, and the credential-free `e2e-hosted` job carries the environment its specs
// need. build-checks.spec.ts (TC-052/053) spawns the infra suites, which need CDK_DEFAULT_REGION
// (infra/src/config.ts) and OPERATOR_EMAIL; fallback.spec.ts (TC-032–034) and cid-copy.spec.ts
// need CID_COPY_HOST and the gateway hosts. Every value comes from a repository variable (never a
// literal: P0-18).
//
// AM-08: the AWS Organizations SCP denies the GitHub OIDC provider, so CI never deploys and never
// holds AWS credentials: no `deploy` job, no `id-token: write`, no configure-aws-credentials, no
// `cdk deploy` anywhere in the workflow. Infra deploys run from the PO's laptop (profile assess);
// Amplify builds every push from its Git connection, and `e2e-hosted` waits for that build.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// infra declares no YAML parser; the workspace's copy (pipeline/oracle-runtime) is used read-only.
const { parse } = createRequire(join(ROOT, "pipeline/oracle-runtime/package.json"))("yaml") as {
  parse: (text: string) => unknown;
};

interface Job {
  needs?: string | string[];
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: { uses?: string; run?: string; with?: Record<string, unknown> }[];
}
const text = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const workflow = parse(text) as {
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

describe("ci.yml (metagross M4): e2e-hosted environment", () => {
  const job = workflow.jobs["e2e-hosted"] as Job;

  // PO decision 2026-10-24 (A-11): e2e-hosted runs alongside the unit-test jobs and needs only the
  // secret scan; it still tests its own commit (the /build.json wait below).
  it("parses as YAML and has the e2e-hosted job after the secret scan only", () => {
    expect(job).toBeDefined();
    expect([job.needs].flat().sort()).toEqual(["gitleaks"]);
    expect(job.steps.length).toBeGreaterThan(0);
  });

  it("waits for the Amplify preview /build.json sha of this commit before Playwright", () => {
    const wait = job.steps.find((s) => s.run?.includes("/build.json"));
    expect(wait?.run).toContain("$GITHUB_SHA");
    expect(wait?.run).toContain("amplifyapp.com");
    const waitIndex = job.steps.indexOf(wait as Job["steps"][number]);
    const playwrightIndex = job.steps.findIndex((s) => s.run?.includes("playwright test"));
    expect(playwrightIndex).toBeGreaterThan(waitIndex);
  });

  it("sets the region, CID copy host, gateway hosts and operator email from repository variables", () => {
    expect(job.env).toMatchObject({
      AMPLIFY_APP_ID: "${{ vars.AMPLIFY_APP_ID }}",
      AWS_REGION: "${{ vars.AWS_REGION }}",
      CDK_DEFAULT_REGION: "${{ vars.AWS_REGION }}",
      OPERATOR_EMAIL: "${{ vars.OPERATOR_EMAIL }}",
      CID_COPY_HOST: "${{ vars.CID_COPY_HOST }}",
      FILEBASE_GATEWAY_HOST: "${{ vars.FILEBASE_GATEWAY_HOST }}",
      PINATA_GATEWAY_HOST: "${{ vars.PINATA_GATEWAY_HOST }}",
      ORBITOR_GATEWAY_HOST: "${{ vars.ORBITOR_GATEWAY_HOST }}",
      NO_TCAD_PERMIT_NUMBERS: "${{ vars.NO_TCAD_PERMIT_NUMBERS }}",
    });
    for (const value of Object.values(job.env ?? {})) {
      expect(value, "every value is a repository variable").toMatch(/^\$\{\{ vars\.[A-Z_]+ \}\}$/);
    }
  });
});

describe("ci.yml: oracle-runtime installs the pnpm workspace before the pipeline-ci.yml steps", () => {
  // travis/pilot/run-pilot.ts and travis/runs/run-month.ts import packages/contract and
  // packages/query-core source, so the runtime's tsc and Vitest need the workspace node_modules.
  const job = workflow.jobs["oracle-runtime"] as Job & {
    steps: { "working-directory"?: string }[];
  };

  it("runs `pnpm install --frozen-lockfile` at the repository root, before npm ci", () => {
    const setup = job.steps.findIndex((s) => s.uses?.startsWith("pnpm/action-setup@"));
    const install = job.steps.findIndex((s) => s.run === "pnpm install --frozen-lockfile");
    const npmCi = job.steps.findIndex((s) => s.run === "npm ci");
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(setup);
    expect(job.steps[install]?.["working-directory"]).toBe(".");
    expect(npmCi).toBeGreaterThan(install);
  });

  it("keeps the pipeline-ci.yml steps in order after the prerequisite", () => {
    const runs = job.steps.map((s) => s.run).filter((r): r is string => r !== undefined);
    const after = runs.slice(runs.indexOf("pnpm install --frozen-lockfile") + 1);
    expect(after.slice(0, 6)).toEqual([
      'python3 -m pip install --disable-pip-version-check "pyyaml==6.0.3"',
      "npm ci",
      "npm run typecheck",
      "npm run lint",
      "npm run format:check",
      "npm test",
    ]);
  });
});

describe("ci.yml (AM-08): CI never deploys and never needs AWS credentials", () => {
  it("keeps workspace, oracle-runtime, gitleaks and e2e-hosted; has no deploy job", () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual([
      "e2e-hosted",
      "gitleaks",
      "oracle-runtime",
      "workspace",
    ]);
  });

  it("grants no id-token: write at workflow or job level", () => {
    expect(workflow.permissions?.["id-token"]).toBeUndefined();
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions?.["id-token"], name).toBeUndefined();
    }
    expect(text).not.toMatch(/id-token:\s*write/);
  });

  it("uses no aws-actions/configure-aws-credentials and runs no cdk deploy", () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        expect(step.uses ?? "", name).not.toContain("aws-actions/configure-aws-credentials");
        expect(step.run ?? "", name).not.toMatch(/cdk\s+deploy/);
      }
    }
    expect(text).not.toContain("configure-aws-credentials");
    expect(text).not.toMatch(/cdk\s+deploy/);
  });

  it("reads no AWS_DEPLOY_ROLE_ARN variable and no stored secret other than GITHUB_TOKEN", () => {
    expect(text).not.toContain("AWS_DEPLOY_ROLE_ARN");
    const secrets = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(new Set(secrets)).toEqual(new Set(["GITHUB_TOKEN"]));
  });

  it("reads exactly the expected repository variables", () => {
    const vars = new Set([...text.matchAll(/vars\.([A-Z_]+)/g)].map((m) => m[1]));
    expect([...vars].sort()).toEqual([
      "AMPLIFY_APP_ID",
      "AWS_ACCOUNT_ID",
      "AWS_REGION",
      "CID_COPY_HOST",
      "FILEBASE_GATEWAY_HOST",
      "NO_TCAD_PERMIT_NUMBERS",
      "OPERATOR_EMAIL",
      "ORBITOR_GATEWAY_HOST",
      "PINATA_GATEWAY_HOST",
    ]);
  });
});
