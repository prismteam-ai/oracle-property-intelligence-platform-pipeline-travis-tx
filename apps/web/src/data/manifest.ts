// The run manifest read by CID (A-03 T042, G-C3; interface fixed by T007). The bytes are
// accepted only when `rawCid(bytes)` equals the requested CID (constitution A3), then parsed
// with the frozen `RunManifestV1` schema (contract/v1). Every count the pages show comes from
// this object (FR-009); nothing is padded or derived elsewhere.
import { RUN_MANIFEST_SCHEMA, RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { fetchByCid, type FetchByCidOptions, type FetchByCidResult } from "./fetch-by-cid";

export interface LoadedManifest {
  readonly manifest: RunManifestV1;
  /** The CID the bytes were verified against (equal to the index entry's manifestCid). */
  readonly manifestCid: string;
  /** The read that served the bytes: source (for the fallback chip) and the bound `partUrl`. */
  readonly read: FetchByCidResult;
}

/** Parses JCS manifest bytes after checking `rawCid(bytes) === expectedCid`; throws otherwise. */
export async function parseManifest(
  bytes: Uint8Array,
  expectedCid: string,
): Promise<RunManifestV1> {
  const actual = await rawCid(bytes);
  if (actual !== expectedCid) {
    throw new Error(`Manifest bytes do not hash to ${expectedCid} (got ${actual})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`Manifest ${expectedCid} is not JSON`, { cause: error });
  }
  const parsed = RunManifestV1.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Manifest ${expectedCid} does not match ${RUN_MANIFEST_SCHEMA}: ${issues}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** `fetchByCid` + `parseManifest` for the run index's latest entry. */
export async function loadManifest(
  cid: string,
  options: FetchByCidOptions,
): Promise<LoadedManifest> {
  const read = await fetchByCid(cid, options);
  const manifest = await parseManifest(read.bytes, cid);
  return { manifest, manifestCid: cid, read };
}
