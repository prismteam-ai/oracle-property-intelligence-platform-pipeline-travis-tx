import { createHash } from "node:crypto";
import { CID } from "multiformats/cid";
import {
  type ArtifactVerifier,
  type VerificationResult,
  VerificationStatus,
  type VerificationTarget,
} from "../application/publication-ports.js";
import { ArtifactKind } from "../domain/artifact-manifest.js";

const RAW_BLOCK_MEDIA_TYPE = "application/vnd.ipld.raw";
const RAW_BLOCK_FORMAT = "raw";

export interface GatewayVerifierConfig {
  gateways: readonly string[];
  timeoutMs: number;
  fetch: typeof fetch;
  now: () => Date;
}

export class GatewayVerifier implements ArtifactVerifier {
  constructor(private readonly config: GatewayVerifierConfig) {}

  async verify(targets: readonly VerificationTarget[]): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];
    for (const target of targets) {
      for (const gateway of this.config.gateways) {
        results.push(await this.check(gateway, target));
      }
    }
    return results;
  }

  private async check(gateway: string, target: VerificationTarget): Promise<VerificationResult> {
    const base = { name: target.name, cid: target.cid, gateway };
    const isDirectory = target.kind === ArtifactKind.Directory;
    const url = new URL(`/ipfs/${target.cid}`, gateway);
    if (isDirectory) url.searchParams.set("format", RAW_BLOCK_FORMAT);

    try {
      const response = await this.config.fetch(url, {
        headers: isDirectory ? { accept: RAW_BLOCK_MEDIA_TYPE } : {},
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      const checkedAt = this.config.now().toISOString();
      if (!response.ok) {
        await response.body?.cancel();
        return {
          ...base,
          status: VerificationStatus.Unreachable,
          httpStatus: response.status,
          bytes: undefined,
          checkedAt,
        };
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const matches = isDirectory ? blockMatchesCid(bytes, target.cid) : fileMatches(bytes, target);
      return {
        ...base,
        status: matches ? VerificationStatus.Verified : VerificationStatus.Mismatch,
        httpStatus: response.status,
        bytes: bytes.length,
        checkedAt,
      };
    } catch {
      return {
        ...base,
        status: VerificationStatus.Unreachable,
        httpStatus: undefined,
        bytes: undefined,
        checkedAt: this.config.now().toISOString(),
      };
    }
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileMatches(bytes: Uint8Array, target: VerificationTarget): boolean {
  return (
    bytes.length === target.size &&
    (target.sha256 === undefined || sha256Hex(bytes) === target.sha256)
  );
}

function blockMatchesCid(bytes: Uint8Array, cid: string): boolean {
  return sha256Hex(bytes) === Buffer.from(CID.parse(cid).multihash.digest).toString("hex");
}
