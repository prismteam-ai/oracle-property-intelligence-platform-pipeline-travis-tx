// Start the bridge (see README.md):
//   AWS_PROFILE=assess COUNTYLENS_ADMIN_QUEUE_URL=<url> CID_COPY_BUCKET=<bucket> \
//     BRIDGE_COUNTY_DIR=<dir> BRIDGE_PERMITS_SEED_JOB=<job> pnpm --filter @countylens/bridge start
// Stop it: Ctrl-C, or `touch pipeline/data/bridge/KILL` (a running step finishes, then it exits).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { livePutter, sqsQueue, snsAlert } from "./aws.js";
import { makeExec } from "./exec.js";
import { IdempotencyStore } from "./idempotency.js";
import { LiveStatus } from "./live.js";
import { Bridge } from "./loop.js";
import { createRestateRunner } from "./restate.js";
import { createRunner, type Files } from "./runner.js";
import { StopFlag } from "./stop.js";
import { acquireRunLock } from "../../local-stack/scripts/run-lock.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    console.error(`${name} is required (see pipeline/bridge/README.md)`);
    process.exit(2);
  }
  return v;
}

const realFiles: Files = {
  readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined),
  writeText: (p, t) => {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, t);
    renameSync(tmp, p);
  },
  exists: (p) => existsSync(p),
};

async function main(): Promise<void> {
  const profile = process.env["AWS_PROFILE"] ?? "assess";
  const queueUrl = required("COUNTYLENS_ADMIN_QUEUE_URL");
  const bucket = required("CID_COPY_BUCKET");
  const bridgeDir = `${REPO_ROOT}/pipeline/data/bridge`;
  mkdirSync(bridgeDir, { recursive: true });
  const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

  const live = new LiveStatus({
    put: livePutter(bucket, profile),
    now: () => new Date(),
    onPutError: (e) => log(`live.json write failed: ${(e as Error).message}`),
  });
  const stop = new StopFlag();
  let runTag = "idle";
  const runner = createRunner({
    config: {
      repoRoot: REPO_ROOT,
      bridgeDir,
      countyDir: process.env["BRIDGE_COUNTY_DIR"],
      permitsSeedJob: process.env["BRIDGE_PERMITS_SEED_JOB"],
      dataRunsDir: `${REPO_ROOT}/pipeline/data/runs`,
      run1PidsFile: `${REPO_ROOT}/specs/011-publish-and-runs/run1-permit-pids.txt`,
      manifestConfig: process.env["BRIDGE_MANIFEST_CONFIG"],
      copyHost: process.env["CID_COPY_HOST"],
      releaseReuseTags: process.env["BRIDGE_RELEASE_REUSE_TAGS"]
        ?.split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      releaseTarget: process.env["BRIDGE_RELEASE_TARGET"],
    },
    exec: makeExec(`${bridgeDir}/logs`, () => runTag),
    restate: createRestateRunner({
      ingressUrl: process.env["RESTATE_INGRESS_URL"] ?? "http://localhost:8080",
    }),
    files: realFiles,
    now: () => new Date(),
    live,
    stop,
    log,
    onStep: () => {},
  });
  const bridge = new Bridge({
    queue: sqsQueue(queueUrl, profile),
    live,
    idem: new IdempotencyStore(`${bridgeDir}/commands.json`, () => new Date()),
    stop,
    now: () => Date.now(),
    log,
    tryLock: () => {
      try {
        return acquireRunLock(`${bridgeDir}/run.lock`);
      } catch (error) {
        log(`run lock: ${(error as Error).message}`);
        return undefined;
      }
    },
    runner: (cmd) => {
      runTag = cmd.commandId;
      return runner(cmd);
    },
    killSwitch: () => existsSync(`${bridgeDir}/KILL`),
    ...(process.env["COUNTYLENS_ALERTS_TOPIC_ARN"]
      ? { alert: snsAlert(process.env["COUNTYLENS_ALERTS_TOPIC_ARN"], profile) }
      : {}),
  });

  const controller = new AbortController();
  process.on("SIGINT", () => {
    log("SIGINT: stopping after the current poll");
    controller.abort();
  });
  const stopBeat = live.startHeartbeat();
  await live.heartbeat();
  log(`bridge up (profile ${profile}); polling ${queueUrl}`);
  try {
    await bridge.run(controller.signal);
  } finally {
    stopBeat();
    await live.flush();
  }
}

main().catch((error: unknown) => {
  console.error(`bridge stopped: ${(error as Error).message}`);
  process.exit(1);
});
