import { CID } from "multiformats/cid";

export enum CheckStatus {
  Verified = "verified",
  Mismatch = "mismatch",
  Unreachable = "unreachable",
}

export interface CheckedObject {
  name: string;
  cid: string;
  kind: "file" | "directory";
  size: number;
  sha256?: string | undefined;
}

export interface GatewayCheck {
  gateway: string;
  url: string;
  status: CheckStatus;
  httpStatus?: number | undefined;
  bytes?: number | undefined;
  sha256?: string | undefined;
  elapsedMs: number;
}

const RAW_BLOCK_FORMAT = "?format=raw";
const RAW_BLOCK_MEDIA_TYPE = "application/vnd.ipld.raw";
const ROOTS_HEADER = "x-ipfs-roots";
const ETAG_QUOTES = /"/g;

export async function checkObject(
  object: CheckedObject,
  gateway: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayCheck> {
  const isDirectory = object.kind === "directory";
  const url = `${gateway}/ipfs/${object.cid}${isDirectory ? RAW_BLOCK_FORMAT : ""}`;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: isDirectory ? { accept: RAW_BLOCK_MEDIA_TYPE } : {},
      cache: "no-store",
    });
  } catch {
    return { gateway, url, status: CheckStatus.Unreachable, elapsedMs: elapsed() };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return {
      gateway,
      url,
      status: CheckStatus.Unreachable,
      httpStatus: response.status,
      elapsedMs: elapsed(),
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256Hex(bytes);
  const matches =
    isDirectory || object.sha256 === undefined
      ? digest === multihashDigestOf(object.cid)
      : bytes.length === object.size && digest === object.sha256;
  return {
    gateway,
    url,
    status: matches ? CheckStatus.Verified : CheckStatus.Mismatch,
    httpStatus: response.status,
    bytes: bytes.length,
    sha256: digest,
    elapsedMs: elapsed(),
  };
}

export async function resolveIpns(
  name: string,
  gateway: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const response = await fetchImpl(`${gateway}/ipns/${name}`, { cache: "no-store" });
  await response.body?.cancel();
  if (!response.ok) return undefined;
  const roots = response.headers.get(ROOTS_HEADER)?.split(",")[0]?.trim();
  return roots || response.headers.get("etag")?.replace(ETAG_QUOTES, "") || undefined;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

function multihashDigestOf(cid: string): string {
  return toHex(CID.parse(cid).multihash.digest);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
