#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Upload } from "@aws-sdk/lib-storage";
import { loadConfig } from "../core/config.js";
import { fileExists } from "../core/http.js";
import { log } from "../core/log.js";
import { runPipeline } from "../pipeline.js";
import { writeHistory } from "../publish/history.js";
import { publishRun } from "../publish/publish.js";
import { verifyManifest } from "../publish/verify.js";

const s3 = new S3Client({});

async function download(bucket: string, key: string, file: string): Promise<boolean> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await mkdir(path.dirname(file), { recursive: true });
    await pipeline(res.Body as Readable, createWriteStream(file));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return false;
    throw err;
  }
}

async function downloadPrefix(bucket: string, prefix: string, dir: string): Promise<number> {
  let token: string | undefined;
  let n = 0;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue;
      await download(bucket, o.Key, path.join(dir, o.Key.slice(prefix.length)));
      n++;
    }
    token = page.NextContinuationToken;
  } while (token);
  return n;
}

async function upload(bucket: string, key: string, file: string): Promise<void> {
  await new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: createReadStream(file) },
  }).done();
}

async function uploadDir(bucket: string, prefix: string, dir: string): Promise<number> {
  if (!(await fileExists(dir))) return 0;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  let n = 0;
  for (const e of entries.filter((x) => x.isFile())) {
    const full = path.join(e.parentPath, e.name);
    await upload(bucket, `${prefix}${path.relative(dir, full).split(path.sep).join("/")}`, full);
    n++;
  }
  return n;
}

async function loadPublishEnv(name: string | undefined): Promise<void> {
  if (!name) return;
  const ssm = new SSMClient({});
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    for (const line of (res.Parameter?.Value ?? "").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m?.[1] && m[2] !== undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    log.info("publish_env_loaded", { parameter: name });
  } catch (err) {
    log.warn("publish_env_missing", { parameter: name, error: String(err) });
  }
}

async function main(): Promise<void> {
  const bucket = process.env.ORACLE_STATE_BUCKET;
  if (!bucket) throw new Error("ORACLE_STATE_BUCKET is required");
  const config = loadConfig();
  await loadPublishEnv(process.env.ORACLE_PUBLISH_ENV_PARAMETER);
  const hadState = await download(bucket, `state/${path.basename(config.dbPath)}`, config.dbPath);
  const restoredRuns = await downloadPrefix(bucket, "runs/", config.runsDir);
  const mode =
    (process.env.ORACLE_RUN_MODE as "full" | "incremental" | undefined) ??
    (hadState ? "incremental" : "full");
  log.info("runner_start", { mode, hadState, restoredRuns });

  const result = await runPipeline(config, { mode });
  await upload(bucket, `state/${path.basename(config.dbPath)}`, config.dbPath);
  await uploadDir(bucket, `exports/${result.runId}/`, result.exportDir);

  let verified = false;
  if ((process.env.ORACLE_IPFS_PROVIDERS || "").trim()) {
    const manifest = await publishRun(config, { runId: result.runId });
    const report = await verifyManifest(config, {
      runId: result.runId,
      include: (p) => !p.endsWith(".car"),
    });
    verified = report.summary.allPassed;
    log.info("runner_published", { rootCid: manifest.root.cid, verification: report.summary });
  } else {
    log.warn("runner_publish_skipped", { reason: "ORACLE_IPFS_PROVIDERS not configured" });
  }
  await writeHistory(config);
  await uploadDir(bucket, "runs/", config.runsDir);
  log.info("runner_done", { runId: result.runId, status: result.status, verified });
  if (result.status === "failed") process.exitCode = 1;
}

main().catch((err) => {
  log.error("runner_failed", {
    error: String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exitCode = 1;
});
