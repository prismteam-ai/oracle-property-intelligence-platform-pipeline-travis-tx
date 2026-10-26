// T026 (TC-001, TC-002): the fixed elephant-cli publish order, two phases, fail-closed, no skip
// switch, credentials never on argv, CLI pinned at 44bb182. Everything runs through the injected
// fake CLI: no network, no upload, no elephant-cli against real data.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLI_COMMIT,
  PART_SIZE,
  PlanOrderError,
  assertOrdered,
  assertPinnedCli,
  cliCommitFromPath,
  dataGroupCids,
  executePlan,
  filebaseToken,
  parseCsv,
  planBuild,
  planPublish,
  planUpload,
  redact,
  resolveCli,
  runBuild,
  runPublish,
  secretValues,
  spawnRunner,
  type CliRunner,
  type DataGroup,
  type SequenceOptions,
  type StepName,
} from "../src/sequence.js";

const CAR_ROOT = "baguqeerasords4njcts6vs7qvdjfcvgnume4hqohf65zsfguprqphs3icwea";
const TABLES_ROOT = "baguqeeraa5xaitdmh4ngbzsxbkfnjk5k6t2xd5v4wpxbs6vfzy2t3wnzqqia";
const SEED = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";
const GROUPS: readonly DataGroup[] = ["county", "property_improvement"];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The 12 publish steps in their fixed order: phase 1 for every group, then phase 2. */
const ORDER: ReadonlyArray<readonly [DataGroup, StepName]> = [
  ["county", "validate"],
  ["county", "hash"],
  ["county", "validate-car"],
  ["county", "export-tables"],
  ["property_improvement", "validate"],
  ["property_improvement", "hash"],
  ["property_improvement", "validate-car"],
  ["property_improvement", "export-tables"],
  ["county", "upload-car"],
  ["county", "upload-tables"],
  ["property_improvement", "upload-car"],
  ["property_improvement", "upload-tables"],
];

function arg(argv: string[], flag: string): string {
  const i = argv.indexOf(flag);
  if (i < 0) throw new Error(`missing ${flag}`);
  return argv[i + 1] as string;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

interface FakeCliOptions {
  /** Fail the call with this zero-based index. */
  failAt?: number;
  failOn?: (argv: string[]) => boolean;
  /** stderr printed by the failing call. */
  stderr?: string;
}

/** A fake CLI that writes the files each command would write. */
function fakeCli(opts: FakeCliOptions = {}): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CliRunner = async (argv) => {
    const index = calls.length;
    calls.push(argv);
    if (index === opts.failAt || opts.failOn?.(argv))
      return { code: 1, stdout: "", stderr: opts.stderr ?? "validation failed" };
    const cmd = argv[0];
    if (cmd === "validate") write(arg(argv, "--output-csv"), "property_cid,file,error\n");
    if (cmd === "hash") {
      // elephant-cli 44bb182 writes --output-zip as a directory of per-property zips.
      write(join(arg(argv, "--output-zip"), "100008.zip"), "zip");
      write(
        arg(argv, "--output-csv"),
        `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n${SEED},${COUNTY},${CAR_ROOT},x/${COUNTY}.json,\n`,
      );
      write(arg(argv, "--output-car"), "car");
      return {
        code: 0,
        stdout: `CAR written: ${arg(argv, "--output-car")} (12 blocks, root ${CAR_ROOT})\n`,
        stderr: "",
      };
    }
    if (cmd === "export-tables") {
      mkdirSync(arg(argv, "--output"), { recursive: true });
      write(join(arg(argv, "--output"), "tables.car"), "tables");
      write(arg(argv, "--output-json"), JSON.stringify({ root: TABLES_ROOT }));
      return {
        code: 0,
        stdout: `Tables written: ${arg(argv, "--output")} (5 tables, 5 parts, root ${TABLES_ROOT})\n`,
        stderr: "",
      };
    }
    if (cmd === "upload") {
      const input = argv[1] as string;
      const root = input.endsWith(".car") ? CAR_ROOT : TABLES_ROOT;
      write(arg(argv, "--output-json"), JSON.stringify({ api: arg(argv, "--api"), root }));
      return { code: 0, stdout: `Uploaded ${input} (root ${root})\n`, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

function setup(): string {
  const p = mkdtempSync(join(tmpdir(), "run-"));
  mkdirSync(join(p, "groups/county"), { recursive: true });
  mkdirSync(join(p, "groups/property_improvement"), { recursive: true });
  return p;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

afterEach(() => vi.unstubAllEnvs());

describe("runPublish: the fixed 12-step order", () => {
  it("A-03-TC-001 records 2×4 build steps for both groups, then 2×2 uploads, with the exact argv in order", async () => {
    const p = setup();
    const cli = fakeCli();
    const report = await runPublish({ county: "travis", runDir: p, groups: GROUPS, run: cli.run });
    expect(report.ok).toBe(true);
    expect(report.phase).toBe("publish");
    expect(report.steps.map((s) => [s.group, s.step])).toEqual(ORDER);
    expect(report.steps.map((s) => s.phase)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(cli.calls).toEqual(planPublish("travis", p, GROUPS).map((s) => s.argv));
    expect(cli.calls.slice(0, 4)).toEqual([
      ["validate", `${p}/groups/county`, "--output-csv", `${p}/reports/county-errors.csv`],
      [
        "hash",
        `${p}/groups/county`,
        "--output-zip",
        `${p}/hashed/county`,
        "--output-csv",
        `${p}/reports/county-hash.csv`,
        "--output-car",
        `${p}/car/travis-county.car`,
      ],
      [
        "validate",
        `${p}/car/travis-county.car`,
        "--output-csv",
        `${p}/reports/county-car-errors.csv`,
      ],
      [
        "export-tables",
        `${p}/car/travis-county.car`,
        "--output",
        `${p}/tables/county`,
        "--part-size",
        "48m",
        "--output-json",
        `${p}/reports/county-tables-export.json`,
      ],
    ]);
    expect(cli.calls.slice(8, 10)).toEqual([
      [
        "upload",
        `${p}/car/travis-county.car`,
        "--api",
        "https://rpc.filebase.io",
        "--gateway",
        "https://ipfs.filebase.io",
        "--timeout",
        "300",
        "--output-json",
        `${p}/reports/county-archive-upload.json`,
      ],
      [
        "upload",
        `${p}/tables/county`,
        "--api",
        "https://rpc.filebase.io",
        "--gateway",
        "https://ipfs.filebase.io",
        "--timeout",
        "300",
        "--output-json",
        `${p}/reports/county-tables-upload.json`,
      ],
    ]);
    expect(PART_SIZE).toBe("48m");
    expect(report.groups.map((g) => g.uploads)).toEqual([
      {
        archiveJson: `${p}/reports/county-archive-upload.json`,
        tablesJson: `${p}/reports/county-tables-upload.json`,
      },
      {
        archiveJson: `${p}/reports/property_improvement-archive-upload.json`,
        tablesJson: `${p}/reports/property_improvement-tables-upload.json`,
      },
    ]);
  });

  it("A-03-TC-001 runBuild runs exactly the 8 phase-1 steps in order and never uploads (the D-8 boundary)", async () => {
    const p = setup();
    const cli = fakeCli();
    const report = await runBuild({ county: "travis", runDir: p, groups: GROUPS, run: cli.run });
    expect(report.ok).toBe(true);
    expect(report.phase).toBe("build");
    expect(cli.calls).toEqual(planBuild("travis", p, GROUPS).map((s) => s.argv));
    expect(cli.calls.map((c) => c[0])).toEqual([
      "validate",
      "hash",
      "validate",
      "export-tables",
      "validate",
      "hash",
      "validate",
      "export-tables",
    ]);
    expect(cli.calls.flat()).not.toContain("upload");
    expect(report.groups.every((g) => g.uploads === undefined)).toBe(true);
  });

  it("A-03-TC-001 uploads nothing before every group's build steps have passed (two phases, in order)", async () => {
    const p = setup();
    const cli = fakeCli();
    await runPublish({ county: "travis", runDir: p, groups: GROUPS, run: cli.run });
    const firstUpload = cli.calls.findIndex((c) => c[0] === "upload");
    expect(firstUpload).toBe(8);
    expect(cli.calls.slice(0, 8).map((c) => c[0])).not.toContain("upload");
  });

  it.each(ORDER.map((s, i) => [i, s[0], s[1]] as const))(
    "A-03-TC-002 stops after step %i (%s %s) fails and makes no later call",
    async (i, group, step) => {
      const p = setup();
      const cli = fakeCli({ failAt: i });
      const report = await runPublish({
        county: "travis",
        runDir: p,
        groups: GROUPS,
        run: cli.run,
      });
      expect(report.ok).toBe(false);
      expect(cli.calls).toHaveLength(i + 1);
      expect(report.steps).toHaveLength(i + 1);
      expect(at(report.steps, i)).toMatchObject({ group, step, exitCode: 1 });
      expect(report.failed).toMatchObject({ group, step, reason: "exit code 1" });
    },
  );

  it("A-03-TC-002 has no flag or environment switch that skips a step (P0-2)", async () => {
    vi.stubEnv("SKIP_VALIDATE", "1");
    vi.stubEnv("ELEPHANT_SKIP_VALIDATION", "1");
    vi.stubEnv("PUBLISH_SKIP_STEPS", "validate,hash,validate-car,export-tables,upload-car");
    vi.stubEnv("DRY_RUN", "1");
    vi.stubEnv("NO_UPLOAD", "1");
    vi.stubEnv("CI", "true");
    const p = setup();
    const cli = fakeCli();
    const extra = { skip: ["validate"], only: ["hash"], dryRun: true, steps: [], phase: "none" };
    const report = await runPublish({
      county: "travis",
      runDir: p,
      groups: GROUPS,
      run: cli.run,
      ...extra,
    } as SequenceOptions);
    expect(report.ok).toBe(true);
    expect(cli.calls).toEqual(planPublish("travis", p, GROUPS).map((s) => s.argv));
    const src = readFileSync(new URL("../src/sequence.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\b(skip|skipSteps|dryRun|only)\??:/);
    expect(src).not.toMatch(/SKIP|DRY_RUN|NO_UPLOAD/);
  });

  it("plans the same steps for an empty group and a huge one: the plan reads no input", () => {
    const p = setup();
    const before = planPublish("travis", p, GROUPS);
    for (let i = 0; i < 2000; i += 1)
      write(join(p, "groups/county", `${i}.json`), JSON.stringify({ i }));
    expect(planPublish("travis", p, GROUPS)).toEqual(before);
    expect(planPublish("travis", join(p, "absent"), GROUPS)).toHaveLength(12);
    expect(before.map((s) => s.phase)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(planPublish("travis", p, GROUPS).slice(0, 8)).toEqual(planBuild("travis", p, GROUPS));
  });

  it("puts no --token, --pinata-jwt, --atlas-page or secret value on any argv", async () => {
    const p = setup();
    const cli = fakeCli();
    const env = {
      FILEBASE_ACCESS_KEY: "FAKE-ACCESS-KEY-NOT-A-SECRET",
      FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
      FILEBASE_BUCKET: "countylens-fake",
      IPFS_API_TOKEN: "fake-bearer-token-value",
    };
    const report = await runPublish({
      county: "travis",
      runDir: p,
      groups: GROUPS,
      run: cli.run,
      env,
    });
    expect(report.ok).toBe(true);
    const flat = cli.calls.flat();
    for (const bad of [
      "--token",
      "--pinata-jwt",
      "--atlas-page",
      env.FILEBASE_ACCESS_KEY,
      env.FILEBASE_SECRET_KEY,
      env.IPFS_API_TOKEN,
    ]) {
      expect(
        flat.some((a) => a.includes(bad)),
        `argv carries ${bad}`,
      ).toBe(false);
    }
    const file = readFileSync(join(p, "reports/sequence-publish.json"), "utf8");
    for (const secret of [env.FILEBASE_ACCESS_KEY, env.FILEBASE_SECRET_KEY, env.IPFS_API_TOKEN])
      expect(file).not.toContain(secret);
  });

  it("writes reports/sequence-publish.json on failure too, with stderr redacted", async () => {
    const p = setup();
    const secret = "fake-secret-key-value-xyz";
    const cli = fakeCli({ failAt: 8, stderr: `401 Unauthorized for token ${secret}\n` });
    const report = await runPublish({
      county: "travis",
      runDir: p,
      groups: GROUPS,
      run: cli.run,
      env: { FILEBASE_SECRET_KEY: secret },
    });
    expect(report.ok).toBe(false);
    expect(report.failed?.stderr).toContain("[redacted]");
    expect(report.failed?.stderr).not.toContain(secret);
    const file = readFileSync(join(p, "reports/sequence-publish.json"), "utf8");
    expect(file).not.toContain(secret);
    const parsed = JSON.parse(file) as { phase: string; ok: boolean; steps: unknown[] };
    expect(parsed).toMatchObject({ phase: "publish", ok: false });
    expect(parsed.steps).toHaveLength(9);
  });
});

describe("the CLI pin", () => {
  it("is the workspace elephant-cli at commit 44bb182, never a global or Homebrew copy", () => {
    expect(CLI_COMMIT).toBe("44bb182");
    const cli = assertPinnedCli(resolveCli(REPO_ROOT));
    expect(cli.bin).toBe(join(REPO_ROOT, "node_modules", ".bin", "elephant-cli"));
    expect(cli.commit?.startsWith(CLI_COMMIT)).toBe(true);
  });

  it("refuses another commit and an unpinned copy", () => {
    expect(() =>
      assertPinnedCli({
        bin: "/r/node_modules/.bin/elephant-cli",
        realPath:
          "/r/node_modules/.pnpm/@elephant-xyz+cli@https+++codeload.github.com+elephant-xyz+elephant-cli+tar.gz+deadbeef_x/node_modules/@elephant-xyz/cli",
        commit: "deadbeef",
      }),
    ).toThrow(/44bb182/);
    expect(() =>
      assertPinnedCli({
        bin: "/opt/homebrew/bin/elephant-cli",
        realPath: "/opt/homebrew/lib/node_modules/@elephant-xyz/cli",
        commit: null,
      }),
    ).toThrow(/44bb182/);
  });

  it("is asserted before the first step when no runner is injected", async () => {
    const root = mkdtempSync(join(tmpdir(), "repo-"));
    const store = join(
      root,
      "node_modules/.pnpm/@elephant-xyz+cli@https+++codeload.github.com+elephant-xyz+elephant-cli+tar.gz+deadbeef_x/node_modules/@elephant-xyz/cli",
    );
    mkdirSync(store, { recursive: true });
    write(join(root, "node_modules/.bin/elephant-cli"), "#!/bin/sh\nexit 0\n");
    symlinkSync(store, join(root, "node_modules/elephant-cli"));
    const p = setup();
    await expect(
      runBuild({ county: "travis", runDir: p, groups: ["county"], repoRoot: root }),
    ).rejects.toThrow(/44bb182/);
    expect(existsSync(join(p, "reports/sequence-build.json"))).toBe(false);
    expect(existsSync(join(p, "reports/county-errors.csv"))).toBe(false);
  });
});

describe("spawnRunner", () => {
  it("spawns in the run dir with credentials only in the child env and gateways unset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bin-"));
    const bin = join(dir, "fake-cli");
    writeFileSync(
      bin,
      '#!/bin/sh\nprintf "%s\\n" "$PWD" "${FILEBASE_SECRET_KEY:-unset}" "${ELEPHANT_IPFS_GATEWAYS:-unset}" "$*"\n',
    );
    chmodSync(bin, 0o755);
    const runDir = mkdtempSync(join(tmpdir(), "run-"));
    const run = spawnRunner(bin, {
      cwd: runDir,
      env: { FILEBASE_SECRET_KEY: "fake-secret", ELEPHANT_IPFS_GATEWAYS: "https://example.test" },
    });
    const result = await run(["upload", "x.car"]);
    expect(result.code).toBe(0);
    const [pwd, secret, gateways, argv] = result.stdout.trimEnd().split("\n");
    expect(realpathSync(pwd as string)).toBe(realpathSync(runDir));
    expect(secret).toBe("fake-secret");
    expect(gateways).toBe("unset");
    expect(argv).toBe("upload x.car");
  });
});

describe("runBuild records what each step did", () => {
  it("records argv, exit codes, printed roots, dataGroupCid and output sha256 values", async () => {
    const p = setup();
    const cli = fakeCli();
    const report = await runBuild({
      county: "travis",
      runDir: p,
      groups: ["county"],
      run: cli.run,
    });
    const [validate, hash, validateCar, exportTables] = report.steps;
    expect(validate).toMatchObject({ step: "validate", phase: 1, exitCode: 0 });
    expect(validate?.outputs).toEqual([
      {
        path: `${p}/reports/county-errors.csv`,
        size: "property_cid,file,error\n".length,
        sha256: sha("property_cid,file,error\n"),
      },
    ]);
    expect(hash).toMatchObject({ step: "hash", exitCode: 0, carRoot: CAR_ROOT, blocks: 12 });
    expect(hash?.argv[0]).toBe("hash");
    expect(hash?.outputs.map((o) => o.path)).toEqual([
      `${p}/hashed/county`,
      `${p}/reports/county-hash.csv`,
      `${p}/car/travis-county.car`,
    ]);
    // A directory output is digested as sorted "<relative path>\t<sha256>\n" lines.
    expect(hash?.outputs[0]?.sha256).toBe(sha(`100008.zip\t${sha("zip")}\n`));
    // ... and every file under it is listed with its own path, size and SHA-256.
    expect(hash?.outputs[0]?.size).toBe(3);
    expect(hash?.outputs[0]?.files).toEqual([
      { path: `${p}/hashed/county/100008.zip`, size: 3, sha256: sha("zip") },
    ]);
    expect(validateCar).toMatchObject({ step: "validate-car", exitCode: 0 });
    expect(exportTables).toMatchObject({
      step: "export-tables",
      exitCode: 0,
      tablesRoot: TABLES_ROOT,
    });
    expect(exportTables?.outputs.map((o) => o.path)).toEqual([
      `${p}/reports/county-tables-export.json`,
      `${p}/tables/county`,
      `${p}/tables/county/tables.car`,
    ]);
    expect(report.groups).toEqual([
      {
        group: "county",
        groupDir: `${p}/groups/county`,
        carPath: `${p}/car/travis-county.car`,
        carRoot: CAR_ROOT,
        blocks: 12,
        hashCsv: `${p}/reports/county-hash.csv`,
        dataGroupCids: [COUNTY],
        tablesDir: `${p}/tables/county`,
        tablesRoot: TABLES_ROOT,
        tablesExportJson: `${p}/reports/county-tables-export.json`,
      },
    ]);
    expect(existsSync(join(p, "reports/sequence-build.json"))).toBe(true);
    expect(existsSync(join(p, "reports/sequence.json"))).toBe(false);
  });

  it("fails a step whose expected output is missing even with exit 0", async () => {
    const p = setup();
    const run: CliRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const report = await runBuild({ county: "travis", runDir: p, groups: ["county"], run });
    expect(report.ok).toBe(false);
    expect(report.failed?.reason).toMatch(/missing output/);
  });

  it("fails when hash prints no CAR root", async () => {
    const p = setup();
    const cli = fakeCli();
    const run: CliRunner = async (argv) => {
      const r = await cli.run(argv);
      return argv[0] === "hash" ? { ...r, stdout: "done\n" } : r;
    };
    const report = await runBuild({ county: "travis", runDir: p, groups: ["county"], run });
    expect(report.ok).toBe(false);
    expect(report.failed).toMatchObject({ step: "hash" });
  });

  it("fails when an upload writes no --output-json", async () => {
    const p = setup();
    const cli = fakeCli();
    const run: CliRunner = async (argv) => {
      if (argv[0] === "upload") {
        cli.calls.push(argv);
        return { code: 0, stdout: "", stderr: "" };
      }
      return cli.run(argv);
    };
    const report = await runPublish({ county: "travis", runDir: p, groups: ["county"], run });
    expect(report.ok).toBe(false);
    expect(report.failed).toMatchObject({ step: "upload-car" });
    expect(report.failed?.reason).toMatch(/missing output/);
  });
});

describe("resolveCli", () => {
  it("uses the workspace-pinned binary at the repo root, never a global one", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-"));
    write(join(root, "node_modules/.bin/elephant-cli"), "#!/bin/sh\n");
    expect(resolveCli(root).bin).toBe(join(root, "node_modules/.bin/elephant-cli"));
  });

  it("throws when the workspace pin is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-"));
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    expect(() => resolveCli(root)).toThrow(/pnpm install/);
  });

  it("reads the pinned commit from the pnpm store path", () => {
    expect(
      cliCommitFromPath(
        "/r/node_modules/.pnpm/@elephant-xyz+cli@https+++codeload.github.com+elephant-xyz+elephant-cli+tar.gz+44bb182b_7205/node_modules/@elephant-xyz/cli",
      ),
    ).toBe("44bb182b");
    expect(cliCommitFromPath("/opt/homebrew/lib/node_modules/@elephant-xyz/cli")).toBeNull();
  });
});

describe("hash.csv parsing (oracle F9: a real CSV parser)", () => {
  it("parses quoted fields with commas, doubled quotes, CRLF and a trailing newline", () => {
    expect(parseCsv('a,"b,c",d\r\n"x ""y""",2,""\n')).toEqual([
      ["a", "b,c", "d"],
      ['x "y"', "2", ""],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  it("reads dataGroupCid by its header name, whatever the column order and quoting", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashcsv-"));
    const file = join(dir, "hash.csv");
    writeFileSync(
      file,
      [
        "filePath,dataGroupCid,propertyCid",
        '"a,b.json",bafkreiseed,p1',
        '"c.json","bafkreicounty",p1',
        "d.json,bafkreicounty,p2",
        "",
      ].join("\n"),
    );
    expect(dataGroupCids(file)).toEqual(["bafkreiseed", "bafkreicounty"]);
  });

  it("throws when hash.csv has no dataGroupCid column", () => {
    const dir = mkdtempSync(join(tmpdir(), "hashcsv-"));
    const file = join(dir, "hash.csv");
    writeFileSync(file, "propertyCid,dataCid\np1,c1\n");
    expect(() => dataGroupCids(file)).toThrow(/dataGroupCid/);
  });
});

describe("assertOrdered: a plan out of the fixed order is refused by name (OR-2)", () => {
  /** planPublish with county upload-car moved in front of county export-tables. */
  function reordered(p: string): ReturnType<typeof planPublish> {
    const plan = planPublish("travis", p, GROUPS);
    const upload = plan.findIndex((s) => s.group === "county" && s.step === "upload-car");
    const exportTables = plan.findIndex((s) => s.group === "county" && s.step === "export-tables");
    const [moved] = plan.splice(upload, 1);
    plan.splice(exportTables, 0, moved as (typeof plan)[number]);
    return plan;
  }

  it("A-03-TC-002 refuses upload-car before export-tables, naming both steps", () => {
    const p = setup();
    const plan = reordered(p);
    expect(() => assertOrdered(plan)).toThrow(PlanOrderError);
    expect(() => assertOrdered(plan)).toThrow(
      "upload-car of county before export-tables of county",
    );
  });

  it("A-03-TC-002 runs no step of a reordered plan: the named error comes before the first CLI call", async () => {
    const p = setup();
    const cli = fakeCli();
    await expect(
      executePlan("publish", reordered(p), {
        county: "travis",
        runDir: p,
        groups: GROUPS,
        run: cli.run,
      }),
    ).rejects.toThrow("upload-car of county before export-tables of county");
    expect(cli.calls).toHaveLength(0);
    expect(existsSync(join(p, "reports/sequence-publish.json"))).toBe(false);
  });

  it("A-03-TC-002 refuses an upload of one group before another group's build step", () => {
    const p = setup();
    const plan = planPublish("travis", p, GROUPS);
    const upload = plan.findIndex((s) => s.group === "county" && s.step === "upload-car");
    const [moved] = plan.splice(upload, 1);
    plan.splice(4, 0, moved as (typeof plan)[number]);
    expect(() => assertOrdered(plan)).toThrow(
      "upload-car of county before validate of property_improvement",
    );
  });

  it("A-03-TC-002 refuses a plan that skips a step, naming it", () => {
    const p = setup();
    const plan = planBuild("travis", p, GROUPS).filter(
      (s) => !(s.group === "county" && s.step === "validate-car"),
    );
    expect(() => assertOrdered(plan)).toThrow(PlanOrderError);
    expect(() => assertOrdered(plan)).toThrow("validate-car of county missing");
  });

  it("A-03-TC-001 accepts the fixed build, upload and publish plans", () => {
    const p = setup();
    expect(() => assertOrdered(planBuild("travis", p, GROUPS))).not.toThrow();
    expect(() => assertOrdered(planUpload("travis", p, GROUPS))).not.toThrow();
    expect(() => assertOrdered(planPublish("travis", p, GROUPS))).not.toThrow();
    expect(planUpload("travis", p, GROUPS)).toEqual(planPublish("travis", p, GROUPS).slice(8));
  });
});

describe("redaction of the composed Filebase bearer (OR-7)", () => {
  const env = {
    FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
    FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
    FILEBASE_BUCKET: "countylens-fake",
  };
  const token = Buffer.from(
    `${env.FILEBASE_ACCESS_KEY}:${env.FILEBASE_SECRET_KEY}:${env.FILEBASE_BUCKET}`,
  ).toString("base64");

  it("counts the composed token and its Authorization value among the secrets", () => {
    expect(filebaseToken(env)).toBe(token);
    const secrets = secretValues(env);
    expect(secrets).toContain(token);
    expect(secrets).toContain(`Bearer ${token}`);
    expect(redact(`Authorization: Bearer ${token}`, secrets)).toBe("Authorization: [redacted]");
  });

  it("keeps the composed token out of a failed step's stderr and the sequence report", async () => {
    const p = setup();
    const cli = fakeCli({
      failOn: (argv) => argv[0] === "upload",
      stderr: `401 for Authorization: Bearer ${token}\n`,
    });
    const report = await runPublish({
      county: "travis",
      runDir: p,
      groups: ["county"],
      run: cli.run,
      env,
    });
    expect(report.ok).toBe(false);
    expect(report.failed?.stderr).not.toContain(token);
    expect(report.failed?.stderr).toContain("[redacted]");
    expect(readFileSync(join(p, "reports/sequence-publish.json"), "utf8")).not.toContain(token);
  });
});

// AC-1 (T005, corrected 2026-10-23): an upload-readback failure on either of the 2 real groups
// stops the sequence before any later step — report.ok is false, the failing group's `uploads`
// stays undefined, and the other group's phase-2 steps never run, before any manifest-building
// code could start. buildManifest only ever reads the `GroupResult`s a *successful* sequence
// report hands it, so a report with ok:false is where the manifest step never starts; this is
// that boundary, proven at the sequence layer. (The "it scales past 2 groups" claim this block
// used to make doesn't apply any more — DataGroup is the real 2 groups, matching the lexicon.)
describe("runPublish: readback failure stops the sequence before the manifest (AC-1)", () => {
  it("an upload-readback failure on property_improvement's upload-tables stops before any later step, uploads left undefined", async () => {
    const p = setup();
    // 2 groups × 4 build steps = 8; property_improvement is group index 1, so its upload-tables
    // call (the second of its two phase-2 uploads) is global step index 8 + 1*2 + 1 = 11.
    const failAt = 8 + 1 * 2 + 1;
    const cli = fakeCli({ failAt, stderr: "readback: CID not found on either gateway" });
    const report = await runPublish({
      county: "travis",
      runDir: p,
      groups: GROUPS,
      run: cli.run,
    });
    expect(report.ok).toBe(false);
    expect(report.failed).toMatchObject({
      group: "property_improvement",
      step: "upload-tables",
      reason: "exit code 1",
    });
    expect(cli.calls).toHaveLength(failAt + 1);
    // The failing group's uploads stay undefined: nothing downstream can treat it as published.
    const pi = report.groups.find((g) => g.group === "property_improvement");
    expect(pi?.uploads).toBeUndefined();
    // report.ok === false is the boundary a caller must check before ever building a manifest
    // (buildManifest is never invoked from a failed sequence report in this codebase).
    expect(report.ok).toBe(false);
  });
});
