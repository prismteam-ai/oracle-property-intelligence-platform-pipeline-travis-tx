// A-11: the resumable publish driver for one built run manifest. The logic and the six steps
// live in src/publish-run.ts; this file wires the real effects (pinned elephant-cli, Filebase
// credentials, AWS CID copy, gh) and parses argv. Rerun it after any failure: finished items are
// skipped, it resumes at the first unfinished one.
//
//   npx tsx pipeline/publish/scripts/publish-run.ts --manifest runs/<runId>/manifest.json --run-id <runId> --dry-run
//   npx tsx pipeline/publish/scripts/publish-run.ts --manifest runs/<runId>/manifest.json --run-id <runId>
//
// Steps, in this fixed order: gate, filebase, car-files, manifest, cid-copy, gate-remote, release,
// index. The two gate steps (the identity gate; see src/identity-gate.ts) are mandatory: there is
// no flag to skip or force them. A dry run runs the gate for real (read-only) and says whether a
// real run would be refused.
// Receipts: specs/011-publish-and-runs/upload-receipts/<runId>/ (Run 1's top-level receipts also
// count as "already uploaded" for any artifact whose CID they record).
//
// Flags
//   --manifest <path>            the built manifest (required)
//   --run-id <id>                must equal the manifest's runId (required)
//   --step <name>                run one step only (index refuses unless every earlier step has receipts)
//   --dry-run                    print the plan and what would be skipped; writes nothing, no network
//   --probe                      with --dry-run: allow read-only network checks (gateway range
//                                requests, `gh release view`) so already-published work shows as skip
//   --pilot                      no release, no index; the manifest may not be under runs/
//   --cli <path>                 elephant-cli (default ~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli)
//   --release-tag <tag>          release tag (default run-<runId>)
//   --release-reuse-tag <tag>    repeatable: an earlier release whose identical assets are not re-uploaded
//   --release-target <ref>       ref the tag points at (default: the current branch)
//   --repo <owner/repo>          gh repository (default: gh's own default for this checkout)
//   --copy-host <host>           host of the CID copy the gate reads (or CID_COPY_HOST); required
//
// Credentials: ~/.config/assessment/filebase.env (Filebase) and the assess-cid-writer AWS
// profile (CID copy). Neither is ever printed.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  copyManifestObjects,
  createCidCopyClients,
  resolveCidCopyBucket,
} from "../src/cid-copy.js";
import { FILEBASE_ENV_FILE, parseEnvFile } from "../src/cli.js";
import { loadPreviousManifest, runIdentityGate } from "../src/identity-gate.js";
import { openDuckDbEngine } from "./duckdb-engine.js";
import {
  createPublishSteps,
  formatReport,
  loadPublishContext,
  parsePublishArgs,
  runPublish,
  type GhClient,
  type GhRelease,
  type PublishArgs,
} from "../src/publish-run.js";
import { FILEBASE_GATEWAY, filebaseEnvProblem, spawnRunner } from "../src/sequence.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_CLI = join(
  homedir(),
  ".local/share/elephant-cli-main/node_modules/.bin/elephant-cli",
);
const execFileAsync = promisify(execFile);

function ghClient(repo: string | undefined): GhClient {
  const repoArgs = repo === undefined ? [] : ["--repo", repo];
  const gh = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
    execFileAsync("gh", [...args, ...repoArgs], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  return {
    async view(tag) {
      try {
        const { stdout } = await gh(["release", "view", tag, "--json", "tagName,assets"]);
        return JSON.parse(stdout) as GhRelease;
      } catch (error) {
        const text = `${(error as { stderr?: string }).stderr ?? ""}${(error as Error).message}`;
        if (/release not found|not found/i.test(text)) return null;
        throw error;
      }
    },
    async create({ tag, title, notes, target, files }) {
      await gh([
        "release",
        "create",
        tag,
        "--title",
        title,
        "--notes",
        notes,
        "--target",
        target,
        ...files,
      ]);
    },
    async upload(tag, files) {
      await gh(["release", "upload", tag, ...files]);
    },
    async deleteAsset(tag, name) {
      await gh(["release", "delete-asset", tag, name, "--yes"]);
    },
  };
}

function loadFilebaseEnv(): NodeJS.ProcessEnv {
  const fromFile = existsSync(FILEBASE_ENV_FILE)
    ? parseEnvFile(readFileSync(FILEBASE_ENV_FILE, "utf8"))
    : {};
  const env: NodeJS.ProcessEnv = { ...process.env, ...fromFile };
  const problem = filebaseEnvProblem(env);
  if (problem !== undefined) throw new Error(`Filebase credentials unusable: ${problem}`);
  return env;
}

async function main(): Promise<number> {
  let args: PublishArgs;
  try {
    args = parsePublishArgs(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const cliPath = args.cli ?? DEFAULT_CLI;
  const ctx = await loadPublishContext({
    repoRoot: REPO_ROOT,
    manifestPath: args.manifest,
    runId: args.runId,
    pilot: args.pilot,
  });

  let env: NodeJS.ProcessEnv | undefined;
  const loadEnv = (): NodeJS.ProcessEnv => (env ??= loadFilebaseEnv());
  const log = (line: string): void => console.log(line);
  const now = (): Date => new Date();
  const impls = createPublishSteps({
    gate: {
      // Read-only. Local parts count only when their SHA-256 matches the manifest; remote-only
      // (gate-remote) binds every part from the CID copy, the bytes the app reads.
      // A run with a previousManifestCid also proves every previous property_cid and permit_cid
      // still exists with the same request_identifier (Task B leads key on them).
      run: async (c, { remoteOnly }) =>
        runIdentityGate({
          previous:
            c.pilot || c.manifest.previousManifestCid === null
              ? null
              : {
                  manifestBytes: await loadPreviousManifest(
                    c.repoRoot,
                    c.manifest.previousManifestCid,
                  ),
                  root: c.repoRoot,
                },
          openEngine: openDuckDbEngine,
          manifestBytes: c.manifestBytes,
          manifestPath: c.manifestPath,
          copyHost: args.copyHost,
          root: c.repoRoot,
          remoteOnly,
        }),
      now,
      log,
    },
    filebase: {
      loadEnv,
      runCli: (argv, childEnv) => {
        if (!existsSync(cliPath)) throw new Error(`elephant-cli not found at ${cliPath}`);
        return spawnRunner(cliPath, { cwd: REPO_ROOT, env: childEnv })(argv);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
      // A second worker: PUBLISH_FILEBASE_REVERSE=1 walks the queue from the end (per-unit locks).
      reverse: process.env.PUBLISH_FILEBASE_REVERSE === "1",
      // PUBLISH_FILEBASE_KINDS=car uploads CAR units only (tables wait for the provider; ERR-67).
      kinds: (process.env.PUBLISH_FILEBASE_KINDS ?? "").split(",").filter((k) => k !== ""),
      // PUBLISH_FILEBASE_UNITS=county-b05-tables,permits-b01-car,...: one runner of a split job (Run 3.1).
      units: (process.env.PUBLISH_FILEBASE_UNITS ?? "").split(",").filter((k) => k !== ""),
    },
    // PUBLISH_DEFER_PINATA=1: Filebase-only readback of the carCid files (PO 2026-10-25, A-16 item 14).
    carFiles: {
      loadEnv,
      now,
      log,
      ...(process.env.PUBLISH_DEFER_PINATA === "1" ? { readbackGateways: [FILEBASE_GATEWAY] } : {}),
      // PUBLISH_CARFILES_NO_PROBE=1: upload without the "already served?" probe (gateways hang on new CIDs).
      skipProbe: process.env.PUBLISH_CARFILES_NO_PROBE === "1",
      // PUBLISH_CARFILES_PRESENT_ONLY=1: upload only the CAR files already fetched (cloud runner).
      presentOnly: process.env.PUBLISH_CARFILES_PRESENT_ONLY === "1",
    },
    manifest: { loadEnv, now, log },
    cidCopy: {
      now,
      copy: async (c) => {
        const { s3, ssm } = createCidCopyClients();
        const bucket = await resolveCidCopyBucket({ env: process.env, ssm });
        const report = await copyManifestObjects({
          manifestPath: c.manifestPath,
          runDir: c.repoRoot,
          bucket,
          s3,
          log,
        });
        return { written: report.written, skipped: report.skipped, total: report.objects.length };
      },
    },
    release: {
      gh: ghClient(args.repo),
      options: {
        ...(args.releaseTag === undefined ? {} : { tag: args.releaseTag }),
        ...(args.releaseReuseTags === undefined ? {} : { reuseTags: args.releaseReuseTags }),
        ...(args.releaseTarget === undefined ? {} : { target: args.releaseTarget }),
      },
      currentBranch: () =>
        execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        }).trim(),
      now,
      log,
    },
    index: { log },
  });

  const report = await runPublish({
    ctx,
    impls,
    dryRun: args.dryRun,
    probe: args.probe,
    ...(args.step === undefined ? {} : { step: args.step }),
  });
  for (const line of formatReport(report)) console.log(line);
  return report.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
