// T041: validator runner (FR-001, FR-007; research R2). The unit cases inject a fake python
// runner; one integration case runs the real vendored validator with python3 on a
// synthetic catalog inside a temporary repository root (offline, test-only data).
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "../travis/lib/command.js";
import {
  CATALOG_REL_PATH,
  REPORT_REL_PATH,
  VALIDATOR_REL_PATH,
  VENDORED_MD_REL_PATH,
  readVendoredSha256,
  runValidator,
} from "../travis/discovery/run-validator.js";
import { emitCatalogYaml } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const REAL_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPORT = `{\n  "overall": "BLOCKED",\n  "catalog_path": "pipeline/docs/travis-sources.yaml",\n  "gates": []\n}\n`;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A temporary repository root holding a stand-in validator and its VENDORED.md row. */
function fakeRoot(validatorText = "# stand-in validator (test-only)\n", listed?: string): string {
  const root = mkdtempSync(join(tmpdir(), "run-validator-"));
  tmpDirs.push(root);
  const script = join(root, VALIDATOR_REL_PATH);
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, validatorText);
  const hash = listed ?? sha256(validatorText);
  writeFileSync(
    join(root, VENDORED_MD_REL_PATH),
    [
      "| Vendored path | Kit source path | SHA-256 |",
      "| --- | --- | --- |",
      `| \`use-oracle/scripts/validate-county-readiness.py\` | \`skills/use-oracle/scripts/validate-county-readiness.py\` | \`${hash}\` |`,
      "",
    ].join("\n"),
  );
  return root;
}

interface PyCall {
  file: string;
  args: readonly string[];
  cwd: string | undefined;
}

function fakePython(stdout: string, exitCode: number, calls: PyCall[]): CommandRunner {
  return async (file, args, options) => {
    calls.push({ file, args: [...args], cwd: options?.cwd });
    return { exit_code: exitCode, stdout, stderr: "" };
  };
}

describe("T041 validator runner", () => {
  it("calls the vendored script with the relative catalog path from the repository root", async () => {
    const root = fakeRoot();
    const calls: PyCall[] = [];
    await runValidator({ repoRoot: root, python: fakePython(REPORT, 1, calls) });
    expect(calls).toHaveLength(1);
    const call = must(calls[0]);
    expect(call.file).toBe("python3");
    expect(call.args).toEqual([VALIDATOR_REL_PATH, CATALOG_REL_PATH]);
    expect(CATALOG_REL_PATH).toBe("pipeline/docs/travis-sources.yaml");
    expect(call.cwd).toBe(root);
  });

  it("saves stdout byte-for-byte to docs/evidence/A-01-readiness.json and returns the exit code", async () => {
    const root = fakeRoot();
    const result = await runValidator({ repoRoot: root, python: fakePython(REPORT, 1, []) });
    expect(REPORT_REL_PATH).toBe("docs/evidence/A-01-readiness.json");
    expect(readFileSync(join(root, REPORT_REL_PATH), "utf8")).toBe(REPORT);
    expect(result.exit_code).toBe(1);
    expect(result.report_path).toBe(REPORT_REL_PATH);
    expect(result.vendored_sha256).toBe(sha256("# stand-in validator (test-only)\n"));
  });

  it("passes exit 0 through", async () => {
    const root = fakeRoot();
    const pass = REPORT.replace("BLOCKED", "PASS");
    const result = await runValidator({ repoRoot: root, python: fakePython(pass, 0, []) });
    expect(result.exit_code).toBe(0);
  });

  it("refuses to run when the vendored SHA-256 does not match kit/VENDORED.md", async () => {
    const root = fakeRoot("# edited validator\n", "0".repeat(64));
    const calls: PyCall[] = [];
    await expect(
      runValidator({ repoRoot: root, python: fakePython(REPORT, 0, calls) }),
    ).rejects.toThrow(/SHA-256/);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(root, REPORT_REL_PATH))).toBe(false);
  });

  it("refuses a report that contains an absolute home path (nothing is saved)", async () => {
    const root = fakeRoot();
    const leaky = REPORT.replace(
      '"pipeline/docs/travis-sources.yaml"',
      '"/Users/someone/repo/pipeline/docs/travis-sources.yaml"',
    );
    await expect(
      runValidator({ repoRoot: root, python: fakePython(leaky, 1, []) }),
    ).rejects.toThrow(/home path/);
    expect(existsSync(join(root, REPORT_REL_PATH))).toBe(false);
  });

  it("treats any exit code other than 0 or 1 as a crash", async () => {
    const root = fakeRoot();
    await expect(runValidator({ repoRoot: root, python: fakePython("", 2, []) })).rejects.toThrow(
      /exit 2/,
    );
  });

  it("the committed kit/VENDORED.md lists the committed validator's SHA-256", () => {
    const listed = readVendoredSha256(REAL_REPO_ROOT);
    const actual = sha256(readFileSync(join(REAL_REPO_ROOT, VALIDATOR_REL_PATH)));
    expect(listed).toBe(actual);
  });

  it("integration: the real vendored validator reports the relative catalog path and no home path", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-validator-real-"));
    tmpDirs.push(root);
    for (const rel of [VALIDATOR_REL_PATH, VENDORED_MD_REL_PATH]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      copyFileSync(join(REAL_REPO_ROOT, rel), join(root, rel));
    }
    mkdirSync(dirname(join(root, CATALOG_REL_PATH)), { recursive: true });
    writeFileSync(join(root, CATALOG_REL_PATH), emitCatalogYaml(syntheticCatalog()));
    const result = await runValidator({ repoRoot: root });
    expect([0, 1]).toContain(result.exit_code);
    const text = readFileSync(join(root, REPORT_REL_PATH), "utf8");
    const report = JSON.parse(text) as { catalog_path: string; overall: string };
    expect(report.catalog_path).toBe(CATALOG_REL_PATH);
    expect(text).not.toMatch(/\/Users\/|\/home\//);
    expect(text).not.toContain(root);
  });
});
