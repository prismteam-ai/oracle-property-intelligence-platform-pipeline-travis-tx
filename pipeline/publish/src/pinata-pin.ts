// A-11, AD-22: a genuine SECOND INDEPENDENT PIN. `elephant-cli upload --pinata-jwt` only pins
// its own ZIP-of-hashed-properties format; it cannot pin a CAR or a tables export, so it is not
// a second pin of OUR artifacts. This module calls Pinata's OWN REST API directly (never
// elephant-cli) to pin a CID that is already reachable on public IPFS (e.g. via the Filebase
// gateway), with a local-file upload as the only fallback when pin-by-CID does not apply.
//
// This file is a reusable, narrowly-scoped utility only: it does not touch the manifest,
// runs/index.json, the GitHub Release, or docs/atlas-pr.md. Those are wired up separately, once
// Run 1's real CIDs are known from the Filebase upload this task must not interfere with.
//
// API surface actually used, and why: Pinata's current docs describe a newer v3 Files API
// (POST /v3/files/public/pin_by_cid, POST https://uploads.pinata.cloud/v3/files, GET
// /v3/files/public). A real smoke test against the saved PINATA_JWT (2026-10-23) found that key
// cannot use v3 at all -- every v3 call, including a plain authenticated GET, returned 401
// {"error":"not authenticated"} -- while the legacy `/pinning/*` and `/data/*` endpoints work
// fine with the same key (confirmed live: `data/testAuthentication` succeeds, `pinning/
// pinFileToIPFS` pinned a throwaway file, `data/pinList` found it). The legacy pin-by-hash
// endpoint itself (`pinning/pinByHash`) is reachable but 403s with `NO_SCOPES_FOUND` for this
// key -- a real admin-scope gap, not a missing feature -- so this module still attempts it
// first (the "ideally pin-by-CID without re-upload" path) and falls back to re-uploading bytes
// only when it fails, exactly as it would for any other key that lacks that one scope. (Later
// finding, A-11 run log 2026-10-24: on the free plan pin-by-hash is `PAID_FEATURE_ONLY`, so AM-10
// makes the file upload below the only path; pipeline/publish/src/pinata-copy.ts drives it.)
//   - pin by CID (no bytes re-uploaded; content must already be fetchable from public IPFS):
//       POST https://api.pinata.cloud/pinning/pinByHash
//       body: { hashToPin: <cid>, pinataMetadata?: { name } }
//   - fallback upload (re-uploads raw bytes; used when pin-by-CID fails and a local file path
//     was given):
//       POST https://api.pinata.cloud/pinning/pinFileToIPFS
//       multipart: file, pinataMetadata? (JSON string { name })
//     plus pinataOptions (JSON string {"cidVersion":1}, A-16 T079 / AM-10): without it Pinata
//     answers a CIDv0 `Qm…` hash, which can never equal our CIDv1 manifest CIDs. A probe on
//     2026-10-26 proved that with it Pinata returns exactly our CID for the Run 3 manifest (raw
//     codec `bafkrei…`) and a 3 MB dag-pb table part (`bafybeic23v2…sldry`).
//   - unpin (used at once when an upload's CID does not equal the manifest CID):
//       DELETE https://api.pinata.cloud/pinning/unpin/<cid>
//   - account usage (the free plan is about 1 GB and 500 files):
//       GET https://api.pinata.cloud/data/userPinnedDataTotal -> { pin_count, pin_size_total }
//   - poll/confirm (the legacy pin-jobs listing; a non-empty, non-"pin_queued" row for the CID
//     under ?status=pinned is Pinata's own documented "already pinned" signal):
//       GET https://api.pinata.cloud/data/pinList?hashContains=<cid>&status=pinned
// Auth: `Authorization: Bearer <PINATA_JWT>` on every call. The JWT is passed in by the caller
// (never read from process.env by this module) and is never logged; every thrown error redacts
// it out of any response body it quotes.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PINATA_API = "https://api.pinata.cloud";
export const PINATA_PIN_BY_HASH_PATH = "/pinning/pinByHash";
export const PINATA_UPLOAD_PATH = "/pinning/pinFileToIPFS";
export const PINATA_PIN_LIST_PATH = "/data/pinList";
export const PINATA_UNPIN_PATH = "/pinning/unpin";
export const PINATA_USAGE_PATH = "/data/userPinnedDataTotal";
/** Sent with every upload: our CIDs are CIDv1 (constitution: CIDv1 only). */
export const PINATA_UPLOAD_OPTIONS = { cidVersion: 1 } as const;

/** A non-OK Pinata response; `message` is already JWT-redacted. `status` drives retry/backoff. */
export class PinataHttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  constructor(message: string, status: number, retryAfter: string | null) {
    super(message);
    this.name = "PinataHttpError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export interface PinataPinOptions {
  /** The bearer token. Read by the CALLER from PINATA_JWT; never read from process.env here. */
  jwt: string;
  fetch?: FetchLike;
  apiBase?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout for reads and unpin (default READ_TIMEOUT_MS). */
  requestTimeoutMs?: number;
}

/** Reads (pinList, usage) and unpin: a small JSON answer. */
export const READ_TIMEOUT_MS = 30_000;
/** Upload timeout = base + size at a conservative floor rate, so a big file is not cut short. */
export const UPLOAD_TIMEOUT_BASE_MS = 60_000;
export const UPLOAD_FLOOR_BYTES_PER_SEC = 250_000;

/** The upload timeout for a file of `bytes`: 60 s plus the time at 250 kB/s. */
export function uploadTimeoutMs(bytes: number): number {
  return UPLOAD_TIMEOUT_BASE_MS + Math.ceil((bytes / UPLOAD_FLOOR_BYTES_PER_SEC) * 1000);
}

function readSignal(options: PinataPinOptions): AbortSignal {
  return AbortSignal.timeout(options.requestTimeoutMs ?? READ_TIMEOUT_MS);
}

export interface PinByCidResult {
  id: string | undefined;
  status: string | undefined;
}

export interface UploadResult {
  id: string | undefined;
  cid: string;
  /** Pinata's `PinSize` (bytes it counts against the quota), when sent. */
  pinSize?: number;
  /** Pinata's `Timestamp` (when the pin was recorded), when sent. */
  timestamp?: string;
  /** Pinata's `isDuplicate`: the CID was already pinned on this account. */
  isDuplicate?: boolean;
}

export interface PinataUsage {
  pinCount: number;
  pinSizeTotal: number;
}

export interface PinataPinResult {
  cid: string;
  id: string | undefined;
  method: "pin_by_cid" | "upload";
  pinned: true;
  polledMs: number;
}

/** Replaces every occurrence of the JWT with `[redacted]`. Use on any text that may quote it. */
export function redactJwt(text: string, jwt: string): string {
  return jwt ? text.split(jwt).join("[redacted]") : text;
}

function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}` };
}

function base(url: string | undefined): string {
  return (url ?? PINATA_API).replace(/\/+$/, "");
}

function httpError(what: string, response: Response, text: string, jwt: string): PinataHttpError {
  return new PinataHttpError(
    `${what} failed: ${response.status} ${response.statusText}: ${redactJwt(text.slice(0, 500), jwt)}`,
    response.status,
    response.headers.get("retry-after"),
  );
}

async function parseJson(text: string, jwt: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} returned non-JSON: ${redactJwt(text.slice(0, 200), jwt)}`);
  }
}

/** Asks Pinata to fetch and pin content already reachable on public IPFS, by CID alone. */
export async function pinByCid(
  cid: string,
  name: string | undefined,
  options: PinataPinOptions,
): Promise<PinByCidResult> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const body: { hashToPin: string; pinataMetadata?: { name: string } } = { hashToPin: cid };
  if (name) body.pinataMetadata = { name };
  const response = await fetchImpl(`${api}${PINATA_PIN_BY_HASH_PATH}`, {
    method: "POST",
    headers: { ...authHeaders(options.jwt), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw httpError(`pinByHash of ${cid}`, response, text, options.jwt);
  }
  const parsed = await parseJson(text, options.jwt, `pinByHash of ${cid}`);
  const data = parsed as { id?: unknown; status?: unknown };
  return {
    id: typeof data.id === "string" ? data.id : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}

/**
 * The `pinataMetadata.name` for a repo path: every "/" becomes " > ". Measured 2026-10-26 on the
 * Run 3.1 manifest: a "/" in the metadata name alone (basename filename, cidVersion 1) makes
 * pinFileToIPFS wrap the file in a folder and answer that folder's dag-pb CID
 * (`bafybeicjntq…`) instead of the file's raw CID (`bafkreidbqsav…`); the same upload with a
 * slash-free name answers the file's CID.
 */
export function pinataLabel(name: string): string {
  return name.split("/").join(" > ");
}

/**
 * Uploads the file's bytes so Pinata holds a copy directly, as CIDv1. The multipart filename is
 * the BASENAME only and the metadata name has no "/" (pinataLabel): either "/" can make
 * pinFileToIPFS treat the upload as a folder and answer a directory CID. Bounded by
 * uploadTimeoutMs(size); a timeout surfaces as a thrown error (the caller does not resend a write
 * blind; an idempotent re-run picks it up).
 */
export async function uploadFile(
  filePath: string,
  name: string | undefined,
  options: PinataPinOptions,
): Promise<UploadResult> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const bytes = await readFile(filePath);
  const form = new FormData();
  const fileName = basename(name ?? filePath);
  form.append("file", new Blob([bytes]), fileName);
  if (name) form.append("pinataMetadata", JSON.stringify({ name: pinataLabel(name) }));
  form.append("pinataOptions", JSON.stringify(PINATA_UPLOAD_OPTIONS));
  const response = await fetchImpl(`${api}${PINATA_UPLOAD_PATH}`, {
    method: "POST",
    headers: authHeaders(options.jwt),
    body: form,
    signal: AbortSignal.timeout(uploadTimeoutMs(bytes.length)),
  });
  const text = await response.text();
  if (!response.ok) {
    throw httpError(`pinFileToIPFS of ${filePath}`, response, text, options.jwt);
  }
  const parsed = await parseJson(text, options.jwt, `pinFileToIPFS of ${filePath}`);
  const data = parsed as {
    ID?: unknown;
    IpfsHash?: unknown;
    PinSize?: unknown;
    Timestamp?: unknown;
    isDuplicate?: unknown;
  };
  if (typeof data.IpfsHash !== "string") {
    throw new Error(
      `pinFileToIPFS of ${filePath} returned no IpfsHash: ${redactJwt(text.slice(0, 200), options.jwt)}`,
    );
  }
  return {
    id: typeof data.ID === "string" ? data.ID : undefined,
    cid: data.IpfsHash,
    ...(typeof data.PinSize === "number" ? { pinSize: data.PinSize } : {}),
    ...(typeof data.Timestamp === "string" ? { timestamp: data.Timestamp } : {}),
    ...(typeof data.isDuplicate === "boolean" ? { isDuplicate: data.isDuplicate } : {}),
  };
}

/** Removes a pin (used at once when an upload came back with a CID other than the manifest's). */
export async function unpin(cid: string, options: PinataPinOptions): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const response = await fetchImpl(`${api}${PINATA_UNPIN_PATH}/${encodeURIComponent(cid)}`, {
    method: "DELETE",
    headers: authHeaders(options.jwt),
    signal: readSignal(options),
  });
  const text = await response.text();
  if (!response.ok) throw httpError(`unpin of ${cid}`, response, text, options.jwt);
}

/** The account's current pin count and total pinned bytes (the free-plan quota inputs). */
export async function usage(options: PinataPinOptions): Promise<PinataUsage> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const response = await fetchImpl(`${api}${PINATA_USAGE_PATH}`, {
    method: "GET",
    headers: authHeaders(options.jwt),
    signal: readSignal(options),
  });
  const text = await response.text();
  if (!response.ok) throw httpError("userPinnedDataTotal", response, text, options.jwt);
  const parsed = (await parseJson(text, options.jwt, "userPinnedDataTotal")) as {
    pin_count?: unknown;
    pin_size_total?: unknown;
  };
  const pinCount = Number(parsed.pin_count);
  const pinSizeTotal = Number(parsed.pin_size_total);
  if (!Number.isFinite(pinCount) || !Number.isFinite(pinSizeTotal))
    throw new Error(
      `userPinnedDataTotal returned no pin_count/pin_size_total: ${redactJwt(text.slice(0, 200), options.jwt)}`,
    );
  return { pinCount, pinSizeTotal };
}

/** Pinata's own "already pinned" signal: the CID appears in `pinList?status=pinned`. */
export async function isPinned(cid: string, options: PinataPinOptions): Promise<boolean> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const query = `hashContains=${encodeURIComponent(cid)}&status=pinned`;
  const response = await fetchImpl(`${api}${PINATA_PIN_LIST_PATH}?${query}`, {
    method: "GET",
    headers: authHeaders(options.jwt),
    signal: readSignal(options),
  });
  const text = await response.text();
  if (!response.ok) {
    throw httpError(`pinList for ${cid}`, response, text, options.jwt);
  }
  const parsed = await parseJson(text, options.jwt, `pinList for ${cid}`);
  const rows = (parsed as { rows?: unknown[] }).rows;
  return Array.isArray(rows) && rows.length > 0;
}

/** Polls `isPinned` until it is true, or throws once `pollTimeoutMs` elapses. Returns elapsed ms. */
export async function pollUntilPinned(cid: string, options: PinataPinOptions): Promise<number> {
  const interval = options.pollIntervalMs ?? 3000;
  const timeout = options.pollTimeoutMs ?? 120_000;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const start = now();
  for (;;) {
    if (await isPinned(cid, options)) return now() - start;
    if (now() - start >= timeout) {
      throw new Error(`pin of ${cid} did not confirm as pinned within ${timeout}ms`);
    }
    await sleep(interval);
  }
}

/**
 * Pins `args.cid` via pin-by-CID; if that fails and `args.filePath` is given, falls back to
 * uploading that file's bytes. Either way, does not return until `pollUntilPinned` confirms the
 * resulting CID is actually pinned (not just an initial ack).
 */
export async function pinataPin(
  args: { cid?: string; filePath?: string; name?: string },
  options: PinataPinOptions,
): Promise<PinataPinResult> {
  if (!options.jwt) throw new Error("PINATA_JWT is required and must not be empty");
  if (!args.cid && !args.filePath) throw new Error("pinataPin requires a cid or a filePath");

  let cid = args.cid;
  let id: string | undefined;
  let method: "pin_by_cid" | "upload" = "pin_by_cid";

  if (cid) {
    try {
      const result = await pinByCid(cid, args.name, options);
      id = result.id;
    } catch (err) {
      if (!args.filePath) throw err;
      method = "upload";
      const result = await uploadFile(args.filePath, args.name, options);
      cid = result.cid;
      id = result.id;
    }
  } else if (args.filePath) {
    method = "upload";
    const result = await uploadFile(args.filePath, args.name, options);
    cid = result.cid;
    id = result.id;
  }

  if (!cid) throw new Error("pinataPin: no cid resolved");
  const pollMs = await pollUntilPinned(cid, options);
  return { cid, id, method, pinned: true, polledMs: pollMs };
}
