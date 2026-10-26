// A-03 T001: the Turborepo workspace layout (plan.md § Project Structure, AD-23).
// Runs from the repo root with `pnpm test:root` (vitest --root scripts), outside the
// package projects. No dependency on a YAML library: pnpm-workspace.yaml is a two-level
// file of keys and lists, parsed by the small reader below.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const read = (file: string): string => readFileSync(resolve(repoRoot, file), "utf8");

type YamlList = string[];
type YamlValue = string | YamlList | Record<string, string | YamlList>;

/** Strips a trailing `# comment` that is outside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFlowList(raw: string): YamlList {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === "") return [];
  return inner.split(",").map(unquote);
}

/**
 * Reads the subset of YAML that pnpm-workspace.yaml uses: top-level `key:` followed by
 * `  - item` lines or a flow list `[a, b]`, and one level of nested `  key:` with
 * `    - item` lines or a flow list. Scalars become strings.
 */
function parseWorkspaceYaml(text: string): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  let topKey: string | null = null;
  let subKey: string | null = null;
  for (const rawLine of text.split("\n")) {
    const line = stripComment(rawLine).replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (body.startsWith("- ")) {
      const item = unquote(body.slice(2));
      if (topKey === null) throw new Error(`list item without a key: ${rawLine}`);
      if (indent >= 4 && subKey !== null) {
        const parent = out[topKey];
        if (typeof parent !== "object" || Array.isArray(parent)) {
          throw new Error(`nested list under a non-object key: ${topKey}`);
        }
        const existing = parent[subKey];
        parent[subKey] = Array.isArray(existing) ? [...existing, item] : [item];
      } else {
        const existing = out[topKey];
        out[topKey] = Array.isArray(existing) ? [...existing, item] : [item];
      }
      continue;
    }
    const colon = body.indexOf(":");
    if (colon === -1) throw new Error(`unsupported line: ${rawLine}`);
    const key = unquote(body.slice(0, colon));
    const rest = body.slice(colon + 1).trim();
    const value: string | YamlList | null =
      rest === "" ? null : rest.startsWith("[") ? parseFlowList(rest) : unquote(rest);
    if (indent === 0) {
      topKey = key;
      subKey = null;
      if (value !== null) out[key] = value;
    } else {
      if (topKey === null) throw new Error(`nested key without a parent: ${rawLine}`);
      subKey = key;
      const parent = out[topKey];
      const obj: Record<string, string | YamlList> =
        typeof parent === "object" && !Array.isArray(parent) ? parent : {};
      if (value !== null) obj[key] = value;
      out[topKey] = obj;
    }
  }
  return out;
}

const workspace = (): Record<string, YamlValue> => parseWorkspaceYaml(read("pnpm-workspace.yaml"));

describe("pnpm-workspace.yaml (plan § Project Structure)", () => {
  it("lists exactly the Turborepo members and keeps pipeline/oracle-runtime out", () => {
    const members = workspace()["packages"];
    expect(members).toEqual([
      "packages/*",
      "profiles/*",
      "pipeline/publish",
      "pipeline/bridge",
      "apps/*",
      "infra",
      "tests/e2e",
      "tests/agent",
    ]);
    expect(members).not.toContain("pipeline/oracle-runtime");
  });

  it("supports the Lambda target (linux arm64 glibc) next to the current machine", () => {
    expect(workspace()["supportedArchitectures"]).toEqual({
      os: ["current", "linux"],
      cpu: ["current", "arm64"],
      libc: ["current", "glibc"],
    });
  });

  it("keeps the onlyBuiltDependencies allowlist (elephant-cli prepare, esbuild)", () => {
    const only = workspace()["onlyBuiltDependencies"];
    expect(Array.isArray(only)).toBe(true);
    const list = only as YamlList;
    expect(list).toContain("esbuild");
    expect(list.some((entry) => entry.startsWith("@elephant-xyz/cli@"))).toBe(true);
  });
});

interface TurboTask {
  dependsOn?: string[];
  outputs?: string[];
}
interface TurboConfig {
  tasks?: Record<string, TurboTask>;
}

const turboTasks = (): Record<string, TurboTask> => {
  const parsed = JSON.parse(read("turbo.json")) as TurboConfig;
  return parsed.tasks ?? {};
};

describe("turbo.json (agent-design metagross § 1)", () => {
  it("build depends on ^build and outputs dist/**", () => {
    const build = turboTasks()["build"];
    expect(build?.dependsOn).toContain("^build");
    expect(build?.outputs).toContain("dist/**");
  });

  it("declares typecheck, lint, test and synth", () => {
    const tasks = turboTasks();
    for (const name of ["typecheck", "lint", "test", "synth"]) {
      expect(tasks, `task ${name}`).toHaveProperty(name);
    }
  });

  it("test outputs coverage/**", () => {
    expect(turboTasks()["test"]?.outputs).toContain("coverage/**");
  });
});
