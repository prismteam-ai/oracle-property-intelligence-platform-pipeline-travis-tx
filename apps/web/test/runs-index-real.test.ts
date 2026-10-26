// @vitest-environment node
// A-03 T048 (G-C5): the pages resolve the real published run, not a fixture.
// 1. amplify.yml's preBuild index steps run with bash in a temporary repo-shaped tree that holds
//    the committed runs/index.json; the copy in apps/web/public/runs/index.json is byte-identical.
// 2. The committed index parses with RunsIndexV1; loadRunsIndex (served the copied bytes) and
//    latestRun resolve the latest run, and that run's committed manifest hashes (raw-leaves
//    CIDv1) to exactly the manifestCid the index names.
// 3. Grep proof: no fixture, sample or prototype value appears in apps/web/src: no CID literal,
//    no run-ID literal, no example host, no fixture/sample/prototype/mock/lorem string, and none
//    of the identifiers the design prototype shows (design/prototype is not a data source).
// Reads committed files only; no network.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RunsIndexV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { afterAll, describe, expect, it } from "vitest";
import { RUNS_INDEX_PATH, latestRun, loadRunsIndex } from "../src/data/runs-index";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_SRC = join(ROOT, "apps/web/src");
const INDEX_FILE = join(ROOT, "runs/index.json");
// apps/web declares no YAML parser; the workspace's copy (pipeline/oracle-runtime) is used read-only.
const { parse } = createRequire(join(ROOT, "pipeline/oracle-runtime/package.json"))("yaml") as {
  parse: (text: string) => unknown;
};

interface BuildSpec {
  applications: { appRoot: string; frontend: { phases: { preBuild: { commands: string[] } } } }[];
}

const indexText = readFileSync(INDEX_FILE, "utf8");
let tmp: string | undefined;
afterAll(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
});

/** Runs amplify.yml's `mkdir -p public/runs` and index-copy steps in a repo-shaped temp tree. */
function simulateIndexCopy(): string {
  const spec = parse(readFileSync(join(ROOT, "amplify.yml"), "utf8")) as BuildSpec;
  const app = spec.applications[0];
  if (app === undefined) throw new Error("amplify.yml has no application");
  const steps = app.frontend.phases.preBuild.commands.filter(
    (c) => c.startsWith("mkdir -p public/runs") || c.includes("runs/index.json"),
  );
  expect(steps.length, "amplify.yml copies runs/index.json at build").toBeGreaterThanOrEqual(2);
  tmp = mkdtempSync(join(tmpdir(), "t048-amplify-"));
  const web = join(tmp, app.appRoot);
  mkdirSync(web, { recursive: true });
  mkdirSync(join(tmp, "runs"));
  execFileSync("cp", [INDEX_FILE, join(tmp, "runs/index.json")]);
  execFileSync("bash", ["-euo", "pipefail", "-c", steps.join("\n")], { cwd: web });
  return readFileSync(join(web, "public/runs/index.json"), "utf8");
}

describe("T048: the build serves the committed run index and the pages resolve the real run", () => {
  it("A-03-T048: amplify.yml copies the committed runs/index.json byte-for-byte into apps/web/public/runs/", () => {
    expect(simulateIndexCopy()).toBe(indexText);
    expect(RUNS_INDEX_PATH).toBe("/runs/index.json");
  });

  it("A-03-T048: runs-index.ts resolves the latest committed run, whose manifest hashes to the index's manifestCid", async () => {
    const committed = RunsIndexV1.parse(JSON.parse(indexText));
    expect(committed.runs.length).toBeGreaterThan(0);
    const requested: string[] = [];
    const servedFetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(indexText, { status: 200 });
    }) as typeof fetch;
    const index = await loadRunsIndex({ fetch: servedFetch });
    expect(requested).toEqual([RUNS_INDEX_PATH]);
    expect(index).toEqual(committed);

    const latest = latestRun(index);
    const newest = [...committed.runs].sort(
      (a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt),
    )[0];
    expect(latest).toEqual(newest);

    const manifestBytes = new Uint8Array(
      readFileSync(join(ROOT, "runs", latest.runId, "manifest.json")),
    );
    expect(await rawCid(manifestBytes)).toBe(latest.manifestCid);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { runId?: string };
    expect(manifest.runId).toBe(latest.runId);
  });
});

/** Every source file under apps/web/src (ts, tsx, css, html, json). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|html|json)$/.test(name) ? [path] : [];
  });
}

/** Code without comments: values are what matter, prose may say "no fixture". */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Identifiers the design prototype shows: CIDs, permit numbers, parcel IDs, large counts. */
function prototypeValues(): Set<string> {
  const dir = join(ROOT, "design/prototype");
  const values = new Set<string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of [
      /baf[a-z2-7]{7,}/g,
      /\b\d{4}-\d{6}\b/g,
      /\b0\d{9}\b/g,
      /\b\d{1,3}(?:,\d{3}){1,}\b/g,
    ]) {
      for (const match of text.matchAll(pattern)) values.add(match[0]);
    }
  }
  return values;
}

describe("T048 grep proof: no fixture, sample or prototype value in apps/web/src", () => {
  // The one named exception (PO 2026-10-26 06:55): the pilot set in run-numbers.ts names A-03's
  // slice so the UI can call it "Pilot slice" instead of numbering it. Only that literal, only
  // in that file, is excused; the test below proves it is the only run ID there.
  const PILOT_FILE = "apps/web/src/data/run-numbers.ts";
  const PILOT_LITERAL = '"travis-202609-permits-20261021t103516z"';
  const files = sourceFiles(WEB_SRC).map((path) => {
    const rel = relative(ROOT, path);
    const code = stripComments(readFileSync(path, "utf8"));
    return { path: rel, code: rel === PILOT_FILE ? code.replaceAll(PILOT_LITERAL, '""') : code };
  });

  it("A-03-T048: scans a non-empty source tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("A-03-T048: the pilot set is the one excused run-ID literal (PO 2026-10-26)", () => {
    const raw = stripComments(readFileSync(join(ROOT, PILOT_FILE), "utf8"));
    expect(raw.split(PILOT_LITERAL)).toHaveLength(2);
    expect(files.find((f) => f.path === PILOT_FILE)?.code).not.toMatch(/travis-\d{6}/);
  });

  it.each([
    ["CID literal", /\b(?:baf[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})\b/],
    ["run-ID literal", /travis-\d{6}/],
    ["example host", /\bexample\.(?:test|com|org|invalid)\b|\.example\b/],
    [
      "fixture/sample/prototype/mock/lorem value",
      /["'`][^"'`\n]*\b(?:fixture|sample|prototype|mock|lorem|dummy)\b/i,
    ],
  ])("A-03-T048: no %s", (_, pattern) => {
    const hits = files.filter((f) => pattern.test(f.code)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("A-03-T048: none of the design prototype's identifiers or counts appear", () => {
    const values = prototypeValues();
    expect(values.size).toBeGreaterThan(0);
    // The generated cost/limits file is built from docs/cost.md and docs/source-limits.md (real
    // measurements, e.g. Socrata's 50,000 rows per page); a number that also appears on a board
    // is a coincidence, not a copy. test/cost-limits.test.ts proves the file equals those docs.
    const hits = files
      .filter((f) => !f.path.endsWith("cost-limits.generated.json"))
      .flatMap((f) => [...values].filter((v) => f.code.includes(v)).map((v) => `${f.path}: ${v}`));
    expect(hits).toEqual([]);
  });

  it("A-03-T048: the committed run's own values are read at runtime, never written into the source", () => {
    const committed = RunsIndexV1.parse(JSON.parse(indexText));
    const literals = committed.runs.flatMap((r) => [r.runId, r.manifestCid]);
    const hits = files.flatMap((f) =>
      literals.filter((v) => f.code.includes(v)).map((v) => `${f.path}: ${v}`),
    );
    expect(hits).toEqual([]);
  });
});
