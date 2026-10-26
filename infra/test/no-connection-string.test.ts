// Repo-wide grep test (plain Node/TS, not a CDK assertion) for A-11 T025: no Postgres
// connection-string literal or hardcoded host anywhere in apps/ or infra/ source, and the
// scheduled batch task's ECS `Secret`s resolve from a Secrets Manager/SSM ARN, never a plaintext
// `environment` entry (AD-26, contracts/publish-sequence.md "Fargate batch-task entrypoint
// contract"). This complements scheduler.test.ts's CDK assertions and the existing
// stacks.test.ts region-literal / operator-email greps, scoped specifically to database
// connection strings for this story.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { appUnderTest } from "./helpers.js";

const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };
const SKIP_DIRS = new Set(["node_modules", "cdk.out", "coverage", "dist", ".turbo", ".git"]);
// This file's own path, so its pattern literals (which necessarily spell out what they forbid)
// never fail its own scan.
const SELF_PATH = fileURLToPath(new URL(import.meta.url));

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // the directory may not exist in every checkout (e.g. apps/ in an infra-only clone)
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|cjs|json|env|yaml|yml)$/.test(name)) out.push(full);
  }
  return out;
}

// postgres://user:pass@host:port/db or postgresql://..., with or without credentials.
const POSTGRES_CONNECTION_STRING = /postgres(ql)?:\/\/[^\s"'`]*/i;
// A bare host-looking literal assigned to something that smells like a DB host
// (DB_HOST=..., host: "...", PGHOST=...), excluding obvious placeholders/examples.
const HARDCODED_DB_HOST = /\b(DB_HOST|PGHOST|DATABASE_HOST)\s*[:=]\s*["'`][\w.-]+["'`]/;
const PLACEHOLDER_ALLOWLIST = /example\.invalid|localhost|127\.0\.0\.1/i;

describe("A-11 T025: no Postgres connection string or hardcoded DB host in apps/ or infra/", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const files = [
    ...listSourceFiles(join(repoRoot, "apps")),
    ...listSourceFiles(join(repoRoot, "infra")),
  ];

  it("scans a non-empty set of source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no literal postgres:// / postgresql:// connection string in apps/ or infra/", () => {
    const offenders = files
      .filter((f) => f !== SELF_PATH)
      .filter((f) => POSTGRES_CONNECTION_STRING.test(readFileSync(f, "utf8")))
      .map((f) => relative(repoRoot, f));
    expect(offenders).toEqual([]);
  });

  it("no hardcoded DB host literal (excluding documented local/test placeholders)", () => {
    const offenders = files
      .filter((f) => f !== SELF_PATH)
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        if (!HARDCODED_DB_HOST.test(text)) return false;
        const match = text.match(HARDCODED_DB_HOST)?.[0] ?? "";
        return !PLACEHOLDER_ALLOWLIST.test(match);
      })
      .map((f) => relative(repoRoot, f));
    expect(offenders).toEqual([]);
  });

  it("the scheduled batch task's DB/Filebase/Pinata secrets are Secrets Manager valueFrom (ARN), never a plaintext environment entry", () => {
    const { stacks } = appUnderTest(SKIP_BUNDLING);
    const template = Template.fromStack(stacks.scheduler);
    const taskDefs = Object.values(template.findResources("AWS::ECS::TaskDefinition"));
    expect(taskDefs).toHaveLength(1);
    const containers = (
      taskDefs[0]?.Properties as {
        ContainerDefinitions: {
          Environment?: { Name: string; Value: unknown }[];
          Secrets?: { Name: string; ValueFrom: unknown }[];
        }[];
      }
    ).ContainerDefinitions;
    expect(containers).toHaveLength(1);
    const [container] = containers as [
      { Environment?: unknown[]; Secrets?: { Name: string; ValueFrom: unknown }[] },
    ];

    const secretNames = (container.Secrets ?? []).map((s) => s.Name);
    expect(secretNames.sort()).toEqual(
      ["DB_CREDENTIALS_JSON", "FILEBASE_CREDENTIALS_JSON", "PINATA_CREDENTIALS_JSON"].sort(),
    );
    for (const secret of container.Secrets ?? []) {
      // ValueFrom is a CloudFormation intrinsic resolving to a Secrets Manager ARN (Fn::Join /
      // Ref / Fn::GetAtt against a secret resource token), never a bare string.
      expect(typeof secret.ValueFrom).not.toBe("string");
      expect(JSON.stringify(secret.ValueFrom)).toMatch(/secretsmanager|secret/i);
    }

    // No plaintext DB credential, Filebase, or Pinata key/token under Environment.
    const envText = JSON.stringify(container.Environment ?? []);
    expect(envText).not.toMatch(/password|secret|token|api[_-]?key/i);

    // The template contains no CDK-created AWS::SecretsManager::Secret (reference-only, AD-14):
    // the three secrets above are read with fromSecretNameV2, which never emits that resource type.
    template.resourceCountIs("AWS::SecretsManager::Secret", 0);
  });
});
