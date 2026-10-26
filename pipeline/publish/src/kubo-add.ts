// Kubo RPC `add` of one plain file or byte string: pinned, CIDv1 with raw leaves and the 256 KiB
// chunker cid.ts computes with, so the node's Hash is the CID computed locally. This is how the
// manifest's `carCid` of every .car (archive and tables.car; AM-05, D-5) and the manifest's own
// CID get onto IPFS as plain files a gateway can serve byte for byte. A Hash that differs from
// the local CID fails the add. The bearer token comes only from the env the caller passes
// (Filebase's base64(access key:secret key:bucket) composed from FILEBASE_ACCESS_KEY,
// FILEBASE_SECRET_KEY and FILEBASE_BUCKET exactly as elephant-cli does; IPFS_API_TOKEN only for
// another API, and refused next to the Filebase RPC, OR-8); it is never put in a URL, a form
// field, argv, a report or an error message.
import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { CID } from "multiformats/cid";
import {
  FILEBASE_RPC_API,
  filebaseEnvProblem,
  filebaseToken,
  redact,
  secretValues,
} from "./sequence.js";

export { filebaseToken } from "./sequence.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The `add` query: CIDv1, raw leaves, pinned, the importer's 256 KiB chunker (as elephant-cli). */
export const KUBO_ADD_QUERY = "cid-version=1&raw-leaves=true&pin=true&chunker=size-262144";

/** One request carries the whole file; a county CAR is tens of MB. */
export const KUBO_ADD_TIMEOUT_MS = 300_000;

export interface KuboAddOptions {
  /** The env holding the credentials: the child env, never process.env implicitly. */
  env: NodeJS.ProcessEnv;
  /** Kubo RPC API origin (default: the Filebase RPC the sequence uploads through). */
  api?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface KuboAdded {
  /** The local CID, which the node's Hash was checked against. */
  cid: string;
  name: string;
  size: number;
}

/** IPFS_API_TOKEN when set, else the Filebase token; undefined for a local daemon. */
export function kuboToken(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.IPFS_API_TOKEN;
  return typeof explicit === "string" && explicit !== "" ? explicit : filebaseToken(env);
}

/** The first `Hash` of the NDJSON lines `add` prints; a non-JSON body (wrong --api) yields none. */
function hashLine(text: string): string | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trimStart();
    if (!line.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const hash = (parsed as { Hash?: unknown }).Hash;
    if (typeof hash === "string" && hash !== "") return hash;
  }
  return undefined;
}

function parseCid(value: string, what: string): CID {
  try {
    return CID.parse(value);
  } catch {
    throw new Error(`${what} is not a CID: ${value}`);
  }
}

/**
 * Adds `content` as the plain file `name` and requires the returned Hash to equal `expectedCid`
 * (version, codec and digest). Credentials: a bearer header from `options.env` only.
 */
export async function kuboAdd(
  content: Blob,
  name: string,
  expectedCid: string,
  options: KuboAddOptions,
): Promise<KuboAdded> {
  const fetchImpl = options.fetch ?? fetch;
  const api = (options.api ?? FILEBASE_RPC_API).replace(/\/+$/, "");
  if (api === FILEBASE_RPC_API) {
    const problem = filebaseEnvProblem(options.env);
    if (problem !== undefined) throw new Error(`add of ${name} refused: ${problem}`);
  }
  const token = kuboToken(options.env);
  const safe = (text: string): string => redact(text, secretValues(options.env));
  const expected = parseCid(expectedCid, `the expected CID of ${name}`);
  const form = new FormData();
  form.append("file", content, name);
  const response = await fetchImpl(`${api}/api/v0/add?${KUBO_ADD_QUERY}`, {
    method: "POST",
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs ?? KUBO_ADD_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `add of ${name} failed: ${response.status} ${response.statusText}: ${safe(text.slice(0, 500))}`,
    );
  }
  const hash = hashLine(text);
  if (hash === undefined)
    throw new Error(`add of ${name} returned no Hash line: ${safe(text.slice(0, 200))}`);
  if (!parseCid(hash, `the Hash returned for ${name}`).equals(expected)) {
    throw new Error(`add of ${name} returned ${hash}; the locally computed CID is ${expectedCid}`);
  }
  return { cid: expectedCid, name, size: content.size };
}

/** Adds the file at `path` (streamed) under its base name; see kuboAdd. */
export async function kuboAddFile(
  path: string,
  expectedCid: string,
  options: KuboAddOptions,
): Promise<KuboAdded> {
  return kuboAdd(await openAsBlob(path), basename(path), expectedCid, options);
}

/** Adds `bytes` (the manifest's exact JCS bytes) as the file `name`; see kuboAdd. */
export async function kuboAddBytes(
  bytes: Uint8Array,
  name: string,
  expectedCid: string,
  options: KuboAddOptions,
): Promise<KuboAdded> {
  return kuboAdd(new Blob([Buffer.from(bytes)]), name, expectedCid, options);
}
