// A-03 T020: the CI gates. `scripts/grep-gates.sh` (POSIX sh) fails on classification terms
// in the Socrata adapter, LIKE-style text classification in the contract views, any database
// engine or Query DB reference in the workspace trees, a region literal outside configuration
// and the phrase "published to Atlas" (P0-9, AD-26, P0-18, P0-4). `scripts/bundle-size.ts`
// fails when the gzipped web bundle, DuckDB chunks excluded, is over 300 KB.
// Every case runs the real script against a throw-away tree, so the tests do not depend on the
// state of the working copy; CI runs the gates on the real tree as its own step (ci.yml).
// Fixture strings are assembled at run time so that this file carries none of the literals
// the gates look for.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const gateScript = resolve(repoRoot, "scripts", "grep-gates.sh");
const bundleScript = resolve(repoRoot, "scripts", "bundle-size.ts");
const tsxBin = resolve(repoRoot, "node_modules", ".bin", "tsx");

const join2 = (...parts: string[]): string => parts.join("");
const REGION_EU = join2("eu-", "north-", "1");
const REGION_USE1 = join2("us-", "east-", "1");
const REGION_USE2 = join2("us-", "east-", "2");
const REGION_USW2 = join2("us-", "west-", "2");
const DB_URL_KEY = join2("DATABASE", "_URL");
const PG_IMPORT = join2("import pg from ", '"pg"', ";");
const POSTGRES_IMPORT = join2("import postgres from ", '"postgres"', ";");
const QUERY_DB_PKG = join2("@elephant-xyz/", "query-db");
const ATLAS_PHRASE = join2("published ", "to ", "Atlas");
const LIKE_ROOF = join2("LIKE ", "'%ROOF%'");

const ADAPTER = "pipeline/oracle-runtime/travis/adapters/socrata/socrata.ts";
const VIEWS = "packages/query-core/views.sql";

/** A tree that every gate accepts: one innocuous file at each scanned location. */
const cleanTree: Record<string, string> = {
  [ADAPTER]: 'export const source = { name: "austin-3syk-w9eu", key: "permit_number" };\n',
  [VIEWS]: "CREATE OR REPLACE VIEW v AS SELECT improvement_type = 'Roofing' AS roofing FROM t;\n",
  "pipeline/publish/src/index.ts": "export const publish = 1;\n",
  "apps/web/src/main.tsx": 'export const state = "Public by CID · Atlas registration pending";\n',
  "apps/api/src/config.ts": "export const host = process.env.CID_COPY_HOST;\n",
  "infra/src/config.ts": "export const region = process.env.CDK_DEFAULT_REGION;\n",
  "infra/bin/countylens.ts": 'import "../src/config";\n',
  "packages/shared/src/labels.ts": "export const labels = {};\n",
  "scripts/verify.ts": "export const verify = 1;\n",
  "tests/e2e/lib/aws.ts": "export const profile = 'assess';\n",
  "docs/evidence/A-03.md": "# Evidence\n",
};

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "gates-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

interface RunResult {
  status: number | null;
  out: string;
}

function runGates(root: string): RunResult {
  const r = spawnSync("sh", [gateScript, root], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const withViolation = (file: string, content: string): string =>
  makeTree({ ...cleanTree, [file]: content });

describe("scripts/grep-gates.sh", () => {
  it("exists", () => {
    expect(existsSync(gateScript), "ENOENT scripts/grep-gates.sh").toBe(true);
  });

  it("passes a clean tree and says so", () => {
    const r = runGates(makeTree(cleanTree));
    expect(r.out).toMatch(/grep-gates: OK/);
    expect(r.status).toBe(0);
  });

  it.each([
    ["REROOF", "// matches REROOF descriptions\n"],
    ["re-roof", "const terms = ['re-roof'];\n"],
    ["roof replace", "const q = 'upper(description) like roof replace';\n"],
    ["roofing", "// roofing permits only\n"],
    ["shingle", "const s = 'shingle';\n"],
  ])("fails on the classification term %s in the adapter", (_term, line) => {
    const r = runGates(withViolation(ADAPTER, line));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`${ADAPTER}:1:`);
    expect(r.out).toContain("reroof-terms");
  });

  it("ignores classification words outside the adapter tree", () => {
    const r = runGates(
      withViolation("pipeline/oracle-runtime/test/travis/socrata-adapter.test.ts", "// REROOF\n"),
    );
    expect(r.status).toBe(0);
  });

  it.each([
    ["LIKE", `WHERE upper(description) ${LIKE_ROOF}`],
    ["ILIKE", "WHERE description ILIKE '%reroof%'"],
    ["SIMILAR TO", "WHERE description SIMILAR TO '%ROOF%'"],
    ["a wildcard literal", "WHERE contains(description, '%ROOF%')"],
  ])("fails on %s text classification in views.sql", (_kind, line) => {
    const r = runGates(withViolation(VIEWS, `CREATE VIEW x AS SELECT 1 FROM t ${line};\n`));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`${VIEWS}:1:`);
    expect(r.out).toContain("like-roof");
  });

  it("accepts enum equality on improvement_type (no LIKE)", () => {
    const r = runGates(makeTree(cleanTree));
    expect(r.status).toBe(0);
  });

  it.each([
    ["pipeline/publish/src/cid-copy.ts", `const url = process.env.${DB_URL_KEY};\n`],
    ["infra/src/api-stack.ts", `${PG_IMPORT}\n`],
    ["apps/api/src/db.ts", `${POSTGRES_IMPORT}\n`],
    ["apps/api/src/engine/duckdb-node.ts", 'const url = "postgresql://localhost/db";\n'],
    ["packages/foo/package.json", `{ "dependencies": { "${QUERY_DB_PKG}": "^1.0.0" } }\n`],
    ["packages/foo/package.json", '{ "dependencies": { "pg": "^8.0.0" } }\n'],
    ["infra/bin/countylens.ts", 'const c = require("pg");\n'],
  ])("fails on a database engine or Query DB reference in %s", (file, content) => {
    const r = runGates(withViolation(file, content));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`${file}:1:`);
    expect(r.out).toContain("query-db");
  });

  it.each([
    "packages/foo/node_modules/pg/index.js",
    "apps/web/dist/assets/index-abc.js",
    "infra/cdk.out/manifest.json",
  ])("skips generated and installed trees: %s", (file) => {
    const r = runGates(withViolation(file, `${PG_IMPORT}\n`));
    expect(r.status).toBe(0);
  });

  it("allows the SQL alias `pg` and a bare word in a fixture (module references only)", () => {
    const r = runGates(
      makeTree({
        ...cleanTree,
        [VIEWS]: "SELECT pg.to_cid FROM (SELECT * FROM county.parcel_has_geometry) pg;\n",
        "packages/query-core/test/views.fixture.test.ts": 'permit("pg", { url: OTHER });\n',
      }),
    );
    expect(r.status).toBe(0);
  });

  it("skips the documented allow-list files that spell out the ban", () => {
    const r = runGates(
      makeTree({
        ...cleanTree,
        "packages/eslint-config/index.js": `const ban = [{ name: "postgres" }, { name: "${QUERY_DB_PKG}" }];\n`,
        "packages/eslint-config/test/rules.test.ts": `const fixture = "${PG_IMPORT}";\n`,
        "pipeline/publish/test/manifest.test.ts": `const banned = ["pg", "postgres", "${DB_URL_KEY}"];\n`,
      }),
    );
    expect(r.status).toBe(0);
  });

  it("skips a line carrying the inline `grep-gates:allow` marker", () => {
    const r = runGates(
      withViolation(
        "packages/shared/src/labels.ts",
        `export const note = "${DB_URL_KEY}"; // grep-gates:allow label text, not a connection\n`,
      ),
    );
    expect(r.status).toBe(0);
  });

  it.each([
    ["apps/web/src/data/fetch-by-cid.ts", `const host = "s3.${REGION_EU}.amazonaws.com";\n`],
    ["apps/api/src/config.ts", `const region = "${REGION_EU}";\n`],
    ["infra/bin/countylens.ts", `env: { region: "${REGION_USE1}" },\n`],
    ["infra/src/web-stack.ts", `const r = "${REGION_USE2}";\n`],
    ["pipeline/publish/src/cid-copy.ts", `new S3Client({ region: "${REGION_USW2}" });\n`],
    ["scripts/verify-manifest.ts", `const region = "${REGION_EU}";\n`],
    ["tests/e2e/lib/aws.ts", `const region = "${REGION_EU}";\n`],
    ["tests/e2e/cid-copy.spec.ts", `// bucket in ${REGION_EU}\n`],
  ])("fails on a region literal in %s", (file, content) => {
    const r = runGates(withViolation(file, content));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`${file}:1:`);
    expect(r.out).toContain("region-literal");
  });

  it.each([
    "apps/web/test/app-shell.test.tsx",
    "infra/test/stacks.test.ts",
    "scripts/test/other.test.ts",
    ".github/workflows/ci.yml",
    "docs/decisions/0001-read-path.md",
    "specs/003-walking-skeleton/plan.md",
  ])("leaves region strings alone outside the runtime trees: %s", (file) => {
    const r = runGates(withViolation(file, `region ${REGION_EU}\n`));
    expect(r.status).toBe(0);
  });

  it.each([
    ["apps/web/src/routes/Runs.tsx", `const t = "${ATLAS_PHRASE}";\n`],
    ["apps/web/src/components/StatusPill.tsx", `// ${ATLAS_PHRASE.toUpperCase()}\n`],
    ["docs/evidence/A-03.md", `The run was ${ATLAS_PHRASE} on 2026-10-21.\n`],
  ])("fails on the Atlas phrase in %s (P0-4)", (file, content) => {
    const r = runGates(withViolation(file, content));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`${file}:1:`);
    expect(r.out).toContain("atlas-phrase");
  });

  it("accepts the publication-state text and the phrase elsewhere", () => {
    const r = runGates(
      withViolation("docs/decisions/0003-atlas.md", `A-11 says ${ATLAS_PHRASE}.\n`),
    );
    expect(r.status).toBe(0);
  });

  it("reports every violation with its gate, path, line and text, then a count", () => {
    const r = runGates(
      makeTree({
        ...cleanTree,
        [ADAPTER]: "// REROOF\n// fine\n// shingle\n",
        "docs/evidence/A-03.md": `${ATLAS_PHRASE}\n`,
      }),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(`reroof-terms  ${ADAPTER}:1:// REROOF`);
    expect(r.out).toContain(`reroof-terms  ${ADAPTER}:3:// shingle`);
    expect(r.out).toContain(`atlas-phrase  docs/evidence/A-03.md:1:${ATLAS_PHRASE}`);
    expect(r.out).toMatch(/grep-gates: 3 violation\(s\)/);
  });

  it("works with the real repository root as the default argument", () => {
    // Only the exit code is asserted by CI (its own step); here the script must run at all.
    const r = spawnSync("sh", [gateScript], { encoding: "utf8", cwd: repoRoot });
    expect(r.status === 0 || r.status === 1, `${r.stdout}${r.stderr}`).toBe(true);
  });
});

interface BundleFile {
  name: string;
  bytes: number;
  gzipBytes: number;
  excluded: boolean;
}
interface BundleReport {
  distDir: string;
  files: BundleFile[];
  totalGzipBytes: number;
  limitBytes: number;
  ok: boolean;
}
interface BundleModule {
  DEFAULT_LIMIT_BYTES: number;
  checkBundle(options: { distDir: string; limitBytes?: number }): BundleReport;
  formatReport(report: BundleReport): string;
}

const loadBundle = async (): Promise<BundleModule> =>
  (await import("../bundle-size.ts")) as BundleModule;

/** A dist/ folder with incompressible JS of the given sizes (KiB) under assets/. */
function makeDist(files: Record<string, number>): string {
  const root = makeTree({});
  const assets = join(root, "dist", "assets");
  mkdirSync(assets, { recursive: true });
  for (const [name, kib] of Object.entries(files)) {
    writeFileSync(join(assets, name), randomBytes(kib * 1024));
  }
  return join(root, "dist");
}

function runBundle(args: string[]): RunResult {
  const r = spawnSync(tsxBin, [bundleScript, ...args], { encoding: "utf8", cwd: repoRoot });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("scripts/bundle-size.ts", () => {
  it("exists", () => {
    expect(existsSync(bundleScript), "ENOENT scripts/bundle-size.ts").toBe(true);
  });

  it("limits the gzipped assets/*.js total to 320 KB by default (PO, A-16, AM-10, demo polish)", async () => {
    const { DEFAULT_LIMIT_BYTES } = await loadBundle();
    expect(DEFAULT_LIMIT_BYTES).toBe(320 * 1024);
  });

  it("fails when the gzipped total of the app chunks is over the limit", async () => {
    const { checkBundle } = await loadBundle();
    const report = checkBundle({ distDir: makeDist({ "index-a1.js": 170, "vendor-b2.js": 170 }) });
    expect(report.ok).toBe(false);
    expect(report.totalGzipBytes).toBeGreaterThan(320 * 1024);
    expect(report.files.map((f) => f.name).sort()).toEqual(["index-a1.js", "vendor-b2.js"]);
  });

  it("passes under the limit and reports every file's gzipped size", async () => {
    const { checkBundle } = await loadBundle();
    const report = checkBundle({ distDir: makeDist({ "index-a1.js": 100, "runs-c3.js": 50 }) });
    expect(report.ok).toBe(true);
    expect(report.totalGzipBytes).toBeLessThan(300 * 1024);
    for (const f of report.files) {
      expect(f.gzipBytes).toBeGreaterThan(0);
      expect(f.excluded).toBe(false);
    }
  });

  it("excludes the DuckDB chunks from the total but lists them", async () => {
    const { checkBundle } = await loadBundle();
    const report = checkBundle({
      distDir: makeDist({
        "index-a1.js": 100,
        "duckdb-browser-eh.worker-d4.js": 2048,
        "duckdb-eh-e5.js": 1024,
      }),
    });
    expect(report.ok).toBe(true);
    expect(report.totalGzipBytes).toBeLessThan(300 * 1024);
    const excluded = report.files.filter((f) => f.excluded).map((f) => f.name);
    expect(excluded.sort()).toEqual(["duckdb-browser-eh.worker-d4.js", "duckdb-eh-e5.js"]);
  });

  it("counts only .js under assets/ (not .wasm, .css or .map)", async () => {
    const { checkBundle } = await loadBundle();
    const dist = makeDist({ "index-a1.js": 10 });
    writeFileSync(join(dist, "assets", "duckdb-eh-f6.wasm"), randomBytes(1024 * 1024));
    writeFileSync(join(dist, "assets", "index-g7.css"), randomBytes(500 * 1024));
    writeFileSync(join(dist, "assets", "index-a1.js.map"), randomBytes(500 * 1024));
    const report = checkBundle({ distDir: dist });
    expect(report.ok).toBe(true);
    expect(report.files.map((f) => f.name)).toEqual(["index-a1.js"]);
  });

  it("honours a custom limit", async () => {
    const { checkBundle } = await loadBundle();
    const dist = makeDist({ "index-a1.js": 20 });
    expect(checkBundle({ distDir: dist, limitBytes: 10 * 1024 }).ok).toBe(false);
    expect(checkBundle({ distDir: dist, limitBytes: 40 * 1024 }).ok).toBe(true);
  });

  it("as a CLI exits 1 over the limit and prints the total against the limit", () => {
    const r = runBundle(["--dist", makeDist({ "index-a1.js": 200, "vendor-b2.js": 200 })]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/bundle-size: FAIL/);
    expect(r.out).toMatch(/limit 327680/);
  });

  it("as a CLI exits 0 under the limit", () => {
    const r = runBundle(["--dist", makeDist({ "index-a1.js": 50 })]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/bundle-size: OK/);
  });

  it("as a CLI exits 1 when the dist folder is missing (a build that did not run)", () => {
    const r = runBundle(["--dist", join(makeTree({}), "missing")]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/not found/);
  });
});

// A-04 T012 (TC-NF-02, P0-1/2): the reroof-term gate also covers the A-04 permit modules, and
// the Query-DB gate covers pipeline/oracle-runtime/travis/** (the runtime never holds a DB
// client; only pipeline/local-stack/services tracks, report, loader and migrate do) and any
// elephant-cli upload there. Fixture strings are assembled at run time (see the header).
describe("scripts/grep-gates.sh A-04 paths", () => {
  const PERMITS = "pipeline/oracle-runtime/travis/permits/classify.ts";
  const PAGES = "pipeline/oracle-runtime/travis/adapters/socrata/socrata-pages.ts";
  const RT = "pipeline/oracle-runtime/travis/backbone/commands/ingest.ts";
  const UPLOAD = join2("elephant", "-cli ", "upload ", "county.car");

  it.each([
    [PERMITS, join2("// RE", "ROOF\n")],
    [PAGES, join2("const s = 'shin", "gle';\n")],
  ])("reroof-terms fails on a roof word in %s", (file, line) => {
    const r = runGates(withViolation(file, line));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`reroof-terms  ${file}:1:`);
  });

  it.each([
    ["the pg module", `${PG_IMPORT}\n`],
    ["the postgres module", `${POSTGRES_IMPORT}\n`],
    ["the DATABASE_URL name", `const u = process.env.${DB_URL_KEY};\n`],
    ["a bare pg word", "const client = pg.connect();\n"],
  ])("query-db fails on %s in oracle-runtime/travis", (_what, line) => {
    const r = runGates(withViolation(RT, line));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`query-db  ${RT}:1:`);
  });

  it("query-db fails on an elephant-cli upload in oracle-runtime/travis", () => {
    const r = runGates(withViolation(RT, `run("${UPLOAD}");\n`));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`query-db  ${RT}:1:`);
  });

  it("accepts the same words outside oracle-runtime/travis (local-stack Loader, tests)", () => {
    const r = runGates(
      makeTree({
        ...cleanTree,
        "pipeline/local-stack/services/loader.ts": `${POSTGRES_IMPORT}\n`,
        "pipeline/oracle-runtime/test/travis/a04/cli.test.ts": `const k = "${DB_URL_KEY}";\n`,
      }),
    );
    expect(r.status, r.out).toBe(0);
  });

  it("the real tree passes the A-04 gates", () => {
    const r = spawnSync("sh", [gateScript], { encoding: "utf8", cwd: repoRoot });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(
      /(reroof-terms|query-db) {2}pipeline\/oracle-runtime\/travis\//,
    );
  });
});
