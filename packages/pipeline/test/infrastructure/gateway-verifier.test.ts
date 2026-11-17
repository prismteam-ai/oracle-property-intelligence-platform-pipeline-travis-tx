import { createHash } from "node:crypto";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../../src/application/publication-ports.js";
import { ArtifactKind } from "../../src/domain/artifact-manifest.js";
import { GatewayVerifier } from "../../src/infrastructure/gateway-verifier.js";

const CHECKED_AT = new Date("2026-10-28T13:06:00.000Z");
const fileBytes = new TextEncoder().encode("parquet bytes");
const fileSha = createHash("sha256").update(fileBytes).digest("hex");
const blockBytes = new TextEncoder().encode("directory node");
const directoryCid = CID.create(1, raw.code, await sha256.digest(blockBytes)).toString();

function verifierAnswering(respond: (url: URL, accept: string | null) => Response) {
  const requests: { url: URL; accept: string | null }[] = [];
  const verifier = new GatewayVerifier({
    gateways: ["https://ipfs.orbitor.dev", "https://gateway.pinata.cloud"],
    timeoutMs: 1000,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const accept = new Headers(init?.headers).get("accept");
      requests.push({ url, accept });
      return respond(url, accept);
    },
    now: () => CHECKED_AT,
  });
  return { verifier, requests };
}

const fileTarget = {
  name: "tables/properties.parquet",
  cid: "bafybei-file",
  kind: ArtifactKind.File,
  size: fileBytes.length,
  sha256: fileSha,
};
const directoryTarget = { name: "/", cid: directoryCid, kind: ArtifactKind.Directory, size: 100 };

describe("GatewayVerifier", () => {
  it("fetches each file from every gateway and checks its size and SHA-256", async () => {
    const { verifier, requests } = verifierAnswering(() => new Response(fileBytes));

    const results = await verifier.verify([fileTarget]);

    expect(requests.map((request) => request.url.toString())).toEqual([
      "https://ipfs.orbitor.dev/ipfs/bafybei-file",
      "https://gateway.pinata.cloud/ipfs/bafybei-file",
    ]);
    expect(results).toEqual([
      {
        name: "tables/properties.parquet",
        cid: "bafybei-file",
        gateway: "https://ipfs.orbitor.dev",
        status: VerificationStatus.Verified,
        httpStatus: 200,
        bytes: fileBytes.length,
        checkedAt: CHECKED_AT.toISOString(),
      },
      expect.objectContaining({
        gateway: "https://gateway.pinata.cloud",
        status: VerificationStatus.Verified,
      }),
    ]);
  });

  it("flags bytes that do not match the manifest", async () => {
    const { verifier } = verifierAnswering(() => new Response("tampered"));

    const [result] = await verifier.verify([fileTarget]);

    expect(result?.status).toBe(VerificationStatus.Mismatch);
  });

  it("checks a directory by fetching its root block and hashing it against the CID", async () => {
    const { verifier, requests } = verifierAnswering(() => new Response(blockBytes));

    const [result] = await verifier.verify([directoryTarget]);

    expect(result?.status).toBe(VerificationStatus.Verified);
    expect(requests[0]?.url.searchParams.get("format")).toBe("raw");
    expect(requests[0]?.accept).toBe("application/vnd.ipld.raw");
  });

  it("records gateways that refuse or fail as unreachable", async () => {
    const { verifier } = verifierAnswering((url) => {
      if (url.host === "ipfs.orbitor.dev") return new Response("slow down", { status: 429 });
      throw new TypeError("fetch failed");
    });

    const results = await verifier.verify([fileTarget]);

    expect(results.map((result) => [result.status, result.httpStatus])).toEqual([
      [VerificationStatus.Unreachable, 429],
      [VerificationStatus.Unreachable, undefined],
    ]);
  });
});
