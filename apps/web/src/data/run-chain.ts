// Run chain (A-13 T014, data-model.md RunChainLink, FR-001b): from a manifest, follow
// `previousManifestCid` back to the first run (null). Each manifest is read through the caller's
// loader (fetch-by-cid + parseManifest in the pages), so every link is a verified published file.
// A cycle or a chain longer than `maxLinks` stops the walk instead of looping. Compare shows
// "old manifest still resolves on Pinata and orbitor" only after both independent gateways
// answered with bytes whose raw-leaves CID equals the manifest CID (never the CID copy). Filebase
// is checked too and shown as the labelled fallback, but never decides the text (AM-10).
import type { RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import {
  INDEPENDENT_GATEWAYS,
  RUNS_TEXTS,
  type GatewayName,
  type ReadPathUrls,
} from "@countylens/shared";
import { browserFetch } from "./http";
import { readCapped } from "./read-capped";

/** A run manifest is a few KB; anything over 1 MB is not one. */
export const RUN_MANIFEST_MAX_BYTES = 1024 * 1024;

export interface RunChainLink {
  readonly runId: string;
  readonly manifestCid: string;
  readonly previousManifestCid: string | null;
  readonly finishedAt: string;
}

export type ManifestLoader = (cid: string) => Promise<RunManifestV1>;

/** Head first, then each previous run, until previousManifestCid is null. */
export async function loadRunChain(
  headCid: string,
  load: ManifestLoader,
  maxLinks = 100,
): Promise<RunChainLink[]> {
  const chain: RunChainLink[] = [];
  const seen = new Set<string>();
  let cid: string | null = headCid;
  while (cid !== null && !seen.has(cid) && chain.length < maxLinks) {
    seen.add(cid);
    const manifest = await load(cid);
    chain.push({
      runId: manifest.runId,
      manifestCid: cid,
      previousManifestCid: manifest.previousManifestCid,
      finishedAt: manifest.finishedAt,
    });
    cid = manifest.previousManifestCid;
  }
  return chain;
}

/** One gateway's answer for an old manifest: not yet answered, the right bytes, or not. */
export type GatewayCheck = "pending" | "resolves" | "fails";

export type ChainResolves = Readonly<Record<GatewayName, GatewayCheck>>;

/** Every gateway still to answer. */
export const PENDING_RESOLVES: ChainResolves = Object.freeze({
  pinata: "pending",
  orbitor: "pending",
  filebase: "pending",
});

/** The fixed text only when both independent gateways served the right bytes (never Filebase). */
export function oldManifestResolvesText(resolves: ChainResolves): string | null {
  return INDEPENDENT_GATEWAYS.every((g) => resolves[g] === "resolves")
    ? RUNS_TEXTS.oldManifestResolves
    : null;
}

export interface CheckOptions {
  readonly urls: ReadPathUrls;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

async function checkGateway(
  cid: string,
  gateway: GatewayName,
  options: CheckOptions,
): Promise<GatewayCheck> {
  const fetchImpl = options.fetch ?? browserFetch;
  try {
    const init: RequestInit = { credentials: "omit" };
    if (options.signal !== undefined) init.signal = options.signal;
    const response = await fetchImpl(options.urls.gatewayUrl(cid, gateway), init);
    if (response.status !== 200) return "fails";
    const read = await readCapped(response, RUN_MANIFEST_MAX_BYTES);
    if (read.kind === "too_large") return "fails";
    return (await rawCid(read.bytes)) === cid ? "resolves" : "fails";
  } catch {
    return "fails";
  }
}

/** GET the manifest from Pinata, orbitor and Filebase in parallel and check each response's CID. */
export async function checkManifestResolves(
  cid: string,
  options: CheckOptions,
): Promise<ChainResolves> {
  const [pinata, orbitor, filebase] = await Promise.all([
    checkGateway(cid, "pinata", options),
    checkGateway(cid, "orbitor", options),
    checkGateway(cid, "filebase", options),
  ]);
  return { pinata, orbitor, filebase };
}
