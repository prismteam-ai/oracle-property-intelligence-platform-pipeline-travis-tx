// GitHub Release preparation (T014, AD-22: the third durable copy alongside Filebase and
// Pinata). This module only PLANS: it decides which files become release assets, splitting a CAR
// over GitHub's 2 GiB per-asset cap into numbered parts, and records the release's target URL.
// It never shells out to `gh`, never calls the GitHub API, and never creates anything — Stage 6's
// human-approved step (D-7/D-8) reads the plan this module writes and runs the real
// `gh release create` / `gh release upload` only after that approval. A CAR is an ordered stream
// of CAR header + varint-length-prefixed blocks (no block boundary realigns on reassembly), so a
// byte-range split and a plain `cat` to rejoin is safe; this module never re-encodes the CAR.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";

/** GitHub's per-release-asset cap. A CAR at or under this size is attached whole. */
export const GITHUB_ASSET_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface ReleaseAssetPart {
  /** The file to upload as one release asset: the whole CAR, or one numbered split part. */
  path: string;
  name: string;
  size: number;
  sha256: string;
}

export interface ReleaseAsset {
  /** The source CAR on disk; unchanged even when split (the parts live under `splitDir`). */
  carPath: string;
  group: string;
  size: number;
  split: boolean;
  parts: ReleaseAssetPart[];
}

export interface ReleasePlan {
  runId: string;
  tag: string;
  /** `owner/repo`; never hard-coded into this module (PlanReleaseOptions.repo). */
  repo: string;
  url: string;
  assets: ReleaseAsset[];
  totalBytes: number;
  maxAssetBytes: number;
}

export interface CarToAttach {
  group: string;
  path: string;
}

export interface PlanReleaseOptions {
  runId: string;
  repo: string;
  cars: readonly CarToAttach[];
  /** Where split parts are written when a CAR exceeds `maxAssetBytes` (default: a `split/`
   *  subdirectory next to the CAR). */
  splitDir?: string;
  maxAssetBytes?: number;
}

function sha256Stream(path: string): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk as Buffer))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/** The release tag a run's CARs attach to; one tag per run, never reused. */
export function releaseTag(runId: string): string {
  return `run-${runId}`;
}

/** The release URL a human approves and `gh release create` would produce for this tag. */
export function releaseUrl(repo: string, tag: string): string {
  return `https://github.com/${repo}/releases/tag/${tag}`;
}

/**
 * Splits `path` into `splitDir/<basename>.partNNN` files of at most `maxBytes` each, by byte
 * range only (streamed; never loads the CAR whole). Parts are numbered from 000 in file order,
 * so `cat <basename>.part* > <basename>` reassembles the original bytes exactly.
 */
export async function splitFile(
  path: string,
  maxBytes: number,
  splitDir: string,
): Promise<ReleaseAssetPart[]> {
  mkdirSync(splitDir, { recursive: true });
  const total = statSync(path).size;
  const parts: ReleaseAssetPart[] = [];
  let offset = 0;
  let index = 0;
  while (offset < total) {
    const end = Math.min(offset + maxBytes, total) - 1;
    const name = `${basename(path)}.part${String(index).padStart(3, "0")}`;
    const partPath = join(splitDir, name);
    await pipeline(createReadStream(path, { start: offset, end }), createWriteStream(partPath));
    const size = statSync(partPath).size;
    const sha256 = await sha256Stream(partPath);
    parts.push({ path: partPath, name, size, sha256 });
    offset = end + 1;
    index += 1;
  }
  return parts;
}

/**
 * Plans the release assets for every CAR in `options.cars`: whole when at or under
 * `maxAssetBytes` (default GITHUB_ASSET_MAX_BYTES), split into numbered parts otherwise. Makes
 * no network call and creates nothing but the split parts on local disk (never the release
 * itself).
 */
export async function planRelease(options: PlanReleaseOptions): Promise<ReleasePlan> {
  const maxAssetBytes = options.maxAssetBytes ?? GITHUB_ASSET_MAX_BYTES;
  const tag = releaseTag(options.runId);
  const assets: ReleaseAsset[] = [];
  for (const car of options.cars) {
    const size = statSync(car.path).size;
    if (size > maxAssetBytes) {
      const splitDir = options.splitDir ?? join(join(car.path, ".."), "split");
      const parts = await splitFile(car.path, maxAssetBytes, splitDir);
      assets.push({ carPath: car.path, group: car.group, size, split: true, parts });
    } else {
      const sha256 = await sha256Stream(car.path);
      assets.push({
        carPath: car.path,
        group: car.group,
        size,
        split: false,
        parts: [{ path: car.path, name: basename(car.path), size, sha256 }],
      });
    }
  }
  const totalBytes = assets.reduce((n, a) => n + a.size, 0);
  return {
    runId: options.runId,
    tag,
    repo: options.repo,
    url: releaseUrl(options.repo, tag),
    assets,
    totalBytes,
    maxAssetBytes,
  };
}

/**
 * Writes `plan` to `reportsDir/release-plan.json`: the record Stage 6's human-approved step
 * reads to run the real `gh release create` (uploading each asset in `plan.assets[].parts`) and
 * `gh release upload`. This function never invokes `gh` and never reaches the network.
 */
export function writeReleasePlan(reportsDir: string, plan: ReleasePlan): string {
  mkdirSync(reportsDir, { recursive: true });
  const path = join(reportsDir, "release-plan.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}
