// A-11: adds a run manifest's own JCS bytes to Filebase's Kubo RPC (`POST /api/v0/add`,
// cid-version=1&raw-leaves=true&pin=true&chunker=size-262144) and reads them back from both
// AM-01 gateways. Importable form of scripts/upload-manifest.ts, used by the resumable driver
// (publish-run.ts). kuboAddBytes already enforces that the node's Hash equals the locally
// computed CID.
import { createHash } from "node:crypto";
import { cidOfBytes } from "./cid.js";
import {
  gatewaysAgree,
  readbackWhole,
  READBACK_GATEWAYS,
  type GatewayCheck,
} from "./gateway-readback.js";
import { kuboAddBytes, type FetchLike } from "./kubo-add.js";
import { FILEBASE_RPC_API } from "./sequence.js";

export interface ManifestUploadResult {
  cid: string;
  size: number;
  sha256: string;
  gateways: GatewayCheck[];
  ok: boolean;
}

export interface ManifestUploadOptions {
  env: NodeJS.ProcessEnv;
  api?: string;
  fetch?: FetchLike;
  log?: (line: string) => void;
}

/** Adds `bytes` as manifest.json and requires both gateways to serve identical bytes. */
export async function uploadManifestBytes(
  bytes: Uint8Array,
  options: ManifestUploadOptions,
): Promise<ManifestUploadResult> {
  const log = options.log ?? (() => undefined);
  const cid = await cidOfBytes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await kuboAddBytes(bytes, "manifest.json", cid, {
    env: options.env,
    api: options.api ?? FILEBASE_RPC_API,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  log(`kubo add ok: Hash ${cid} matches the local CID, pinned on Filebase`);
  const gateways: GatewayCheck[] = [];
  for (const gateway of READBACK_GATEWAYS) {
    const result = await readbackWhole(gateway, cid, { size: bytes.length, sha256 }, options.fetch);
    gateways.push(result);
    log(
      result.ok
        ? `ok   ${gateway}/ipfs/${cid} size=${bytes.length} sha256 match`
        : `${result.inconclusive === true ? "WARN" : "FAIL"} ${gateway}/ipfs/${cid} ${result.reason ?? "mismatch"}${result.inconclusive === true ? " (rate limited, not counted against the file)" : ""}`,
    );
  }
  return { cid, size: bytes.length, sha256, gateways, ok: gatewaysAgree(gateways) };
}
