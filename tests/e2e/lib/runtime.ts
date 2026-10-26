// Hosted-runtime helpers for the A-03 Playwright harness (T023): the deployed build SHA from
// `/build.json`, the published run (manifest CID and runId read from the Runs page's
// `data-cid`, cross-checked with the committed run index served by the site), the manifest
// fetched by CID through the same read path the app uses (CID copy first, Filebase gateway as
// the labelled fallback), and the harness config keys. Every value comes from RUNTIME_URL,
// the manifest or the environment: nothing is hard-coded (test plan § 3).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes } from "@countylens/publish";
import { z } from "zod";
import { runtimeUrl } from "./runtime-url.js";

export {
  RUNTIME_URL_UNSET_TEXT,
  assertHostedRuntimeUrl,
  isLoopbackHost,
  runtimeUrl,
  runtimeUrlLocalhostText,
} from "./runtime-url.js";

/** Repository root: tests/e2e/lib → tests/e2e → tests → root. */
export const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
export const e2eRoot = resolve(repoRoot, "tests", "e2e");

// ---------------------------------------------------------------------------------------
// Config keys (plan § "Fixed texts and config keys"): the same names as the web build env,
// the Lambda env and the CDK outputs. Read from the environment; the two gateway hosts and
// the private prefix default to the plan's values, the CloudFront domain has no safe default.
// ---------------------------------------------------------------------------------------

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const HarnessEnv = z.object({
  CID_COPY_HOST: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  FILEBASE_GATEWAY_HOST: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("ipfs.filebase.io"),
  ),
  PINATA_GATEWAY_HOST: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("gateway.pinata.cloud"),
  ),
  /** The second independent Verify gateway (ARD § 16 AM-10). */
  ORBITOR_GATEWAY_HOST: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("ipfs.orbitor.dev"),
  ),
  READPATH_PRIVATE_PREFIX: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^private\/[a-z0-9-]+\/$/, "a private, non-CloudFront prefix ending in /")
      .default("private/bench/"),
  ),
});
export type HarnessConfig = z.infer<typeof HarnessEnv>;

let cachedConfig: HarnessConfig | undefined;

/** The harness config keys, parsed once from the environment. */
export function harnessConfig(): HarnessConfig {
  cachedConfig ??= HarnessEnv.parse(process.env);
  return cachedConfig;
}

export const CID_COPY_HOST_UNSET_TEXT =
  "CID_COPY_HOST is not set; export the CountyLensData CloudFront domain (CDK output CID_COPY_HOST) before running this test";

/** The CloudFront domain of the CID copy; required by the specs that read the copy directly. */
export function requireCidCopyHost(): string {
  const host = harnessConfig().CID_COPY_HOST;
  if (!host) throw new Error(CID_COPY_HOST_UNSET_TEXT);
  return host;
}

// ---------------------------------------------------------------------------------------
// Build identity (`/build.json`, written by amplify.yml from AWS_COMMIT_ID / AWS_BRANCH).
// ---------------------------------------------------------------------------------------

export const BuildInfo = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/, "a full git commit SHA"),
  branch: z.string().min(1),
});
export type BuildInfo = z.infer<typeof BuildInfo>;

const FETCH_TIMEOUT_MS = 30_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/** Step 0 of every build-time case: the deployed commit. */
export async function fetchBuildInfo(): Promise<BuildInfo> {
  return BuildInfo.parse(await getJson(`${runtimeUrl()}/build.json`));
}

/** The local checkout's HEAD, which must equal the deployed `sha` before any build-time case runs. */
export function localHeadSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

// ---------------------------------------------------------------------------------------
// The published run.
// ---------------------------------------------------------------------------------------

/** The committed run index as the site serves it (copied into apps/web/public at build). */
export async function fetchRunsIndex(): Promise<RunsIndexV1> {
  return RunsIndexV1.parse(await getJson(`${runtimeUrl()}/runs/index.json`));
}

export type RunsIndexEntry = RunsIndexV1["runs"][number];

/** The latest run: the index is ordered by finishedAt, so it is the last entry. */
export function latestRun(index: RunsIndexV1): RunsIndexEntry {
  const latest = index.runs.at(-1);
  if (!latest) throw new Error("runs/index.json lists no runs");
  return latest;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface FetchedByCid {
  bytes: Uint8Array;
  url: string;
  host: string;
  /** Which read-path leg served the bytes (the UI labels `filebase` as "fallback"). */
  via: "copy" | "filebase";
  status: number;
  headers: Headers;
}

export function copyUrl(cid: string, host = requireCidCopyHost()): string {
  return `https://${host}/${cid}`;
}

export function gatewayUrl(cid: string, host = harnessConfig().FILEBASE_GATEWAY_HOST): string {
  return `https://${host}/ipfs/${cid}`;
}

async function getBytes(
  url: string,
  timeoutMs: number,
): Promise<Omit<FetchedByCid, "via" | "host">> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    url,
    status: res.status,
    headers: res.headers,
  };
}

/**
 * Fetches public bytes by CID the way the app does: the CID copy first (when its host is
 * configured), the Filebase gateway when the copy errors or returns non-200. The harness
 * waits longer than the UI's 4 s so a slow gateway is not mistaken for a failed test.
 */
export async function fetchByCid(
  cid: string,
  options: { timeoutMs?: number; prefer?: "copy" | "filebase" } = {},
): Promise<FetchedByCid> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const config = harnessConfig();
  const legs: { via: FetchedByCid["via"]; host: string; url: string }[] = [];
  if (config.CID_COPY_HOST && options.prefer !== "filebase") {
    legs.push({ via: "copy", host: config.CID_COPY_HOST, url: copyUrl(cid, config.CID_COPY_HOST) });
  }
  legs.push({ via: "filebase", host: config.FILEBASE_GATEWAY_HOST, url: gatewayUrl(cid) });
  const failures: string[] = [];
  for (const leg of legs) {
    try {
      const got = await getBytes(leg.url, timeoutMs);
      return { ...got, via: leg.via, host: leg.host };
    } catch (error) {
      failures.push(
        `${leg.via} (${leg.url}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`CID ${cid} could not be fetched from any leg:\n${failures.join("\n")}`);
}

export interface FetchedManifest extends FetchedByCid {
  manifest: RunManifestV1;
  text: string;
}

/** Fetches a run manifest by CID, checks the bytes hash to that CID, and validates RunManifestV1. */
export async function fetchManifest(manifestCid: string): Promise<FetchedManifest> {
  const got = await fetchByCid(manifestCid);
  const actualCid = await cidOfBytes(got.bytes);
  if (actualCid !== manifestCid) {
    throw new Error(`manifest bytes from ${got.url} hash to ${actualCid}, not ${manifestCid}`);
  }
  const text = new TextDecoder().decode(got.bytes);
  const manifest = RunManifestV1.parse(JSON.parse(text));
  return { ...got, manifest, text };
}

export interface PublishedRun {
  runId: string;
  manifestCid: string;
  manifest: RunManifestV1;
  manifestBytes: Uint8Array;
  manifestText: string;
  /** Which leg served the manifest to the harness. */
  via: FetchedByCid["via"];
  index: RunsIndexV1;
}

/** `runs/<runId>/manifest.json` in this checkout (exact JCS bytes, committed after readback). */
export function committedManifestPath(runId: string): string {
  return resolve(repoRoot, "runs", runId, "manifest.json");
}

export function readCommittedManifest(runId: string): Uint8Array | undefined {
  const path = committedManifestPath(runId);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}

/**
 * Step 0 of every published-data case: open `{RUNTIME_URL}/runs`, read the manifest CID of
 * the latest run from the run card's `data-cid` attribute (never the truncated visible text,
 * test plan § 3) and its runId, then fetch the manifest by that CID. The committed index the
 * site serves names the expected CID, so a card showing any other CID fails here.
 */
export async function readPublishedRun(page: Page): Promise<PublishedRun> {
  const index = await fetchRunsIndex();
  const latest = latestRun(index);
  await page.goto(`${runtimeUrl()}/runs`, { waitUntil: "domcontentloaded" });
  // The Run menu lists every CID in a collapsed list first; the card's visible CID is the one shown.
  const cidElement = page
    .locator(`[data-cid="${latest.manifestCid}"]`)
    .filter({ visible: true })
    .first();
  await cidElement.waitFor({ state: "visible", timeout: 60_000 });
  const manifestCid = await cidElement.getAttribute("data-cid");
  if (!manifestCid) throw new Error("the run card's manifest CID element has no data-cid");
  await page
    .getByText(latest.runId)
    .filter({ visible: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  const fetched = await fetchManifest(manifestCid);
  if (fetched.manifest.runId !== latest.runId) {
    throw new Error(
      `manifest ${manifestCid} is run ${fetched.manifest.runId}, the index names ${latest.runId}`,
    );
  }
  return {
    runId: fetched.manifest.runId,
    manifestCid,
    manifest: fetched.manifest,
    manifestBytes: fetched.bytes,
    manifestText: fetched.text,
    via: fetched.via,
    index,
  };
}
