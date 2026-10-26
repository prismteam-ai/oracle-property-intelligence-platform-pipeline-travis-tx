// amplify.yml (A-03 T044) after /code-review Major 3: the build spec parses as YAML with the
// monorepo shape the Web stack expects, and the run-index step never fails a build when
// runs/index.json has not been published yet. The step is executed here with bash in a temporary
// tree laid out like the repo (apps/web as the working directory), once with and once without
// the index. When absent nothing is written: /runs/index.json then answers 404 (the SPA fallback
// excludes .json) and the Runs page shows RUN_INDEX_TEXTS.unreadable; no placeholder data.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AMPLIFY_MONOREPO_APP_ROOT } from "../src/web-stack.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// infra declares no YAML parser; the workspace's copy (pipeline/oracle-runtime) is used read-only.
const { parse } = createRequire(join(ROOT, "pipeline/oracle-runtime/package.json"))("yaml") as {
  parse: (text: string) => unknown;
};

interface BuildSpec {
  version: number;
  applications: {
    appRoot: string;
    frontend: {
      phases: Record<"preBuild" | "build", { commands: string[] }>;
      artifacts: { baseDirectory: string; files: string[] };
    };
  }[];
}

const spec = parse(readFileSync(join(ROOT, "amplify.yml"), "utf8")) as BuildSpec;
const app = spec.applications[0];
const preBuild = app?.frontend.phases.preBuild.commands ?? [];
const indexSteps = preBuild.filter((c) => c.includes("runs/index.json"));

let tmp: string | undefined;
afterEach(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** Runs the mkdir + index steps of preBuild with bash in a fresh repo-shaped tree. */
function runIndexSteps(index: string | undefined): { web: string; output: string } {
  tmp = mkdtempSync(join(tmpdir(), "amplify-yml-"));
  const web = join(tmp, AMPLIFY_MONOREPO_APP_ROOT);
  mkdirSync(web, { recursive: true });
  if (index !== undefined) {
    mkdirSync(join(tmp, "runs"));
    writeFileSync(join(tmp, "runs/index.json"), index);
  }
  const steps = preBuild.filter(
    (c) => c.startsWith("mkdir -p public/runs") || indexSteps.includes(c),
  );
  const output = execFileSync("bash", ["-euo", "pipefail", "-c", steps.join("\n")], {
    cwd: web,
    encoding: "utf8",
  });
  return { web, output };
}

describe("amplify.yml (T044): structure and the run-index step", () => {
  it("parses as YAML: version 1, one application rooted at apps/web, dist artifacts", () => {
    expect(spec.version).toBe(1);
    expect(spec.applications).toHaveLength(1);
    expect(app?.appRoot).toBe(AMPLIFY_MONOREPO_APP_ROOT);
    expect(app?.frontend.artifacts.baseDirectory).toBe("dist");
    expect(app?.frontend.phases.build.commands).toContain("pnpm exec vite build");
    for (const c of [...preBuild, ...(app?.frontend.phases.build.commands ?? [])])
      expect(typeof c).toBe("string");
  });

  it("copies runs/index.json only when it exists: a single guarded step, no bare cp", () => {
    expect(indexSteps).toHaveLength(1);
    expect(indexSteps[0]).toMatch(/if \[ -f \.\.\/\.\.\/runs\/index\.json \]/);
    expect(preBuild).not.toContain("cp ../../runs/index.json public/runs/index.json");
  });

  it("before the first publish: the step succeeds and writes no index (no placeholder data)", () => {
    const { web, output } = runIndexSteps(undefined);
    expect(existsSync(join(web, "public/runs"))).toBe(true);
    expect(existsSync(join(web, "public/runs/index.json"))).toBe(false);
    expect(output).toMatch(/runs\/index\.json/);
  });

  it("after a publish: the committed index is copied byte for byte", () => {
    const committed = '{"version":1,"runs":[]}\n';
    const { web } = runIndexSteps(committed);
    expect(readFileSync(join(web, "public/runs/index.json"), "utf8")).toBe(committed);
  });
});

// A-13 T016 (contracts/site-links.md): the build writes public/site-links.json next to
// build.json from the Amplify variables CRM_URL, DEMO_VIDEO_URL and PR_URL (Web stack, empty by
// default). The step runs here with bash, once with the variables unset and once set.
const siteLinkSteps = preBuild.filter((c) => c.includes("site-links.json"));

function runSiteLinkSteps(env: Record<string, string>): Record<string, unknown> {
  tmp = mkdtempSync(join(tmpdir(), "amplify-yml-links-"));
  const web = join(tmp, AMPLIFY_MONOREPO_APP_ROOT);
  mkdirSync(join(web, "public"), { recursive: true });
  const { CRM_URL: _c, DEMO_VIDEO_URL: _d, PR_URL: _p, ...base } = process.env;
  execFileSync("bash", ["-euo", "pipefail", "-c", siteLinkSteps.join("\n")], {
    cwd: web,
    encoding: "utf8",
    env: { ...base, ...env },
  });
  return JSON.parse(readFileSync(join(web, "public/site-links.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("amplify.yml (A-13 T016): public/site-links.json", () => {
  it("has a site-links step in preBuild, after build.json is written", () => {
    expect(siteLinkSteps.length).toBeGreaterThanOrEqual(1);
    const buildJsonAt = preBuild.findIndex((c) => c.includes("public/build.json"));
    const linksAt = preBuild.findIndex((c) => c.includes("site-links.json"));
    expect(buildJsonAt).toBeGreaterThanOrEqual(0);
    expect(linksAt).toBeGreaterThan(buildJsonAt);
  });

  it("variables unset: every link is the empty string (hidden), exactly the three keys", () => {
    expect(runSiteLinkSteps({})).toEqual({ crmUrl: "", demoVideoUrl: "", prUrl: "" });
  });

  it("variables set: the values are copied verbatim (the Hub validates https)", () => {
    expect(
      runSiteLinkSteps({
        CRM_URL: "https://crm.example.invalid/",
        DEMO_VIDEO_URL: "https://video.example.invalid/demo",
        PR_URL: "https://github.com/example/repo/pull/1",
      }),
    ).toEqual({
      crmUrl: "https://crm.example.invalid/",
      demoVideoUrl: "https://video.example.invalid/demo",
      prUrl: "https://github.com/example/repo/pull/1",
    });
  });
});
