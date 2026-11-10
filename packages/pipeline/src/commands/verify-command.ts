import { createHash } from "node:crypto";
import { CID } from "multiformats/cid";
import {
  type VerificationResult,
  VerificationStatus,
  type VerificationTarget,
} from "../application/publication-ports.js";
import { ArtifactKind, type Manifest, verificationTargets } from "../domain/artifact-manifest.js";
import { GatewayVerifier } from "../infrastructure/gateway-verifier.js";
import { MANIFEST_FILE } from "../infrastructure/publication-files.js";
import { VERIFICATION_GATEWAYS, VERIFICATION_TIMEOUT_MS } from "./settings.js";

export interface VerificationReport {
  manifestCid: string;
  buildId: string;
  rootCid: string;
  checkedAt: string;
  gateways: readonly string[];
  verifiedByGateway: Record<string, string>;
  results: VerificationResult[];
}

export async function runVerify(manifestCid: string): Promise<VerificationReport> {
  const manifestBytes = await fetchByCid(manifestCid);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  const targets: VerificationTarget[] = [
    ...verificationTargets(manifest),
    {
      name: MANIFEST_FILE,
      cid: manifestCid,
      kind: ArtifactKind.File,
      size: manifestBytes.length,
      sha256: sha256Hex(manifestBytes),
    },
  ];

  const results = await new GatewayVerifier({
    gateways: VERIFICATION_GATEWAYS,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
    fetch,
    now: () => new Date(),
  }).verify(targets);

  return {
    manifestCid,
    buildId: manifest.build_id,
    rootCid: manifest.root.cid,
    checkedAt: new Date().toISOString(),
    gateways: VERIFICATION_GATEWAYS,
    verifiedByGateway: Object.fromEntries(
      VERIFICATION_GATEWAYS.map((gateway) => {
        const verified = results.filter(
          (result) => result.gateway === gateway && result.status === VerificationStatus.Verified,
        ).length;
        return [gateway, `${verified}/${targets.length}`];
      }),
    ),
    results,
  };
}

async function fetchByCid(cid: string): Promise<Uint8Array> {
  const expectedDigest = Buffer.from(CID.parse(cid).multihash.digest).toString("hex");
  for (const gateway of VERIFICATION_GATEWAYS) {
    const bytes = await fetchFrom(gateway, cid).catch(() => undefined);
    if (bytes && sha256Hex(bytes) === expectedDigest) return bytes;
  }
  throw new Error(`No gateway returned bytes that hash to ${cid}`);
}

async function fetchFrom(gateway: string, cid: string): Promise<Uint8Array | undefined> {
  const response = await fetch(new URL(`/ipfs/${cid}`, gateway), {
    signal: AbortSignal.timeout(VERIFICATION_TIMEOUT_MS),
  });
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
