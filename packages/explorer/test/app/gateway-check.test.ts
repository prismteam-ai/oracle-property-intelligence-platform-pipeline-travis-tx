import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { CheckStatus, checkObject, resolveIpns } from "../../src/ipfs/gateway-check.js";

const BYTES = new TextEncoder().encode('{"properties":{"rows":453713}}');
const GATEWAY = "https://ipfs.orbitor.dev";

async function rawCid(bytes: Uint8Array): Promise<string> {
  return CID.create(1, raw.code, await sha256.digest(bytes)).toString();
}

async function hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serving(body: Uint8Array | string, status = 200) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(body as BodyInit, { status });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

describe("checkObject", () => {
  it("verifies a file by fetching its CID and matching the manifest size and SHA-256", async () => {
    const cid = await rawCid(BYTES);
    const { urls, fetchImpl } = serving(BYTES);

    const check = await checkObject(
      { name: "coverage.json", cid, kind: "file", size: BYTES.length, sha256: await hex(BYTES) },
      GATEWAY,
      fetchImpl,
    );

    expect(urls).toEqual([`${GATEWAY}/ipfs/${cid}`]);
    expect(check).toMatchObject({
      gateway: GATEWAY,
      status: CheckStatus.Verified,
      httpStatus: 200,
      bytes: BYTES.length,
      sha256: await hex(BYTES),
    });
  });

  it("reports a mismatch when the bytes differ from the manifest", async () => {
    const { fetchImpl } = serving("tampered");

    const check = await checkObject(
      {
        name: "coverage.json",
        cid: await rawCid(BYTES),
        kind: "file",
        size: BYTES.length,
        sha256: await hex(BYTES),
      },
      GATEWAY,
      fetchImpl,
    );

    expect(check.status).toBe(CheckStatus.Mismatch);
  });

  it("verifies a directory by hashing its raw root block against the CID", async () => {
    const block = new Uint8Array([0x12, 0x34, 0x56]);
    const cid = await rawCid(block);
    const { urls, fetchImpl } = serving(block);

    const check = await checkObject(
      { name: "/", cid, kind: "directory", size: 99 },
      GATEWAY,
      fetchImpl,
    );

    expect(urls).toEqual([`${GATEWAY}/ipfs/${cid}?format=raw`]);
    expect(check.status).toBe(CheckStatus.Verified);
  });

  it("reports an unreachable gateway", async () => {
    const { fetchImpl } = serving("gone", 504);

    const check = await checkObject(
      { name: "build.json", cid: await rawCid(BYTES), kind: "file", size: 1 },
      GATEWAY,
      fetchImpl,
    );

    expect(check).toMatchObject({ status: CheckStatus.Unreachable, httpStatus: 504 });
  });
});

describe("resolveIpns", () => {
  it("reads the CID an IPNS name resolves to from the gateway's roots header", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { headers: { "x-ipfs-roots": "bafkrei-latest" } })) as typeof fetch;

    expect(await resolveIpns("k51name", GATEWAY, fetchImpl)).toBe("bafkrei-latest");
  });
});
