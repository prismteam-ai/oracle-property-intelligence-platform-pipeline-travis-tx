// A-03-TC-044: the CID copy holds byte-identical elephant-cli output only (FR-012, AC-1;
// contracts/storage.md). Every artifact and the manifest are read back from
// `https://{CID_COPY_HOST}/<cid>`; the bucket's `ipfs/` prefix holds nothing else; an
// overwrite attempt with the uploader's own identity (`assess-cid-writer`, no Delete or ACL
// rights) is refused by the bucket policy (`AccessDenied`) and by the conditional write
// (`PreconditionFailed`), leaving the object unchanged; non-manifest paths are not public.
import { expect, test } from "./lib/fixtures.js";
import { PROFILES, cidCopyBucket, headObject, listKeys, putObjectAttempt } from "./lib/aws.js";
import { CONTENT_TYPES, expectedCidCopyKeys, publicCid } from "./lib/manifest.js";
import { NEEDS_AWS_TAG } from "./lib/needs-aws.js";
import { copyUrl, fetchManifest, requireCidCopyHost, sha256Hex } from "./lib/runtime.js";

const NON_MANIFEST_PATHS = ["querydb/", "capture/", "private/bench/", "runs/index.json"];

interface PublicObject {
  name: string;
  cid: string;
  size: number;
  sha256: string;
  kind: keyof typeof CONTENT_TYPES;
}

async function getFromCopy(
  host: string,
  cid: string,
): Promise<{ status: number; bytes: Uint8Array; headers: Headers }> {
  const res = await fetch(copyUrl(cid, host), {
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  return {
    status: res.status,
    bytes: new Uint8Array(await res.arrayBuffer()),
    headers: res.headers,
  };
}

test.describe("A-03-TC-044 CID copy holds byte-identical CLI output only", () => {
  test.describe.configure({ timeout: 20 * 60_000 });

  test(`@scenario:A-03-TC-044 ${NEEDS_AWS_TAG}`, async ({ run }, testInfo) => {
    const host = requireCidCopyHost();
    const { manifest, manifestCid, manifestBytes } = run;

    // Steps 1–2: every manifest artifact, and the manifest itself, byte-identical on the copy.
    const objects: PublicObject[] = [
      ...manifest.artifacts.map((a) => ({
        name: a.name,
        cid: publicCid(a),
        size: a.size,
        sha256: a.sha256,
        kind: a.kind,
      })),
      {
        name: "manifest",
        cid: manifestCid,
        size: manifestBytes.length,
        sha256: sha256Hex(manifestBytes),
        kind: "manifest",
      },
    ];
    const readback: Record<string, { status: number; bytes: number; sha256: string }> = {};
    for (const object of objects) {
      const got = await getFromCopy(host, object.cid);
      readback[object.name] = {
        status: got.status,
        bytes: got.bytes.length,
        sha256: sha256Hex(got.bytes),
      };
      expect(got.status, `${object.name}: served by the copy`).toBe(200);
      expect(got.bytes.length, `${object.name}: size equals the manifest entry`).toBe(object.size);
      expect(sha256Hex(got.bytes), `${object.name}: SHA-256 equals the manifest entry`).toBe(
        object.sha256,
      );
      expect
        .soft(got.headers.get("cache-control") ?? "", `${object.name}: immutable cache header`)
        .toContain("max-age=31536000");
      expect
        .soft(got.headers.get("content-type") ?? "", `${object.name}: content type by kind`)
        .toContain(CONTENT_TYPES[object.kind]);
    }
    await testInfo.attach("readback.json", {
      body: JSON.stringify(readback, null, 2),
      contentType: "application/json",
    });

    // Nothing under ipfs/ except the manifests listed in the run index and their artifacts.
    const bucket = await cidCopyBucket();
    const expected = new Set<string>();
    for (const entry of run.index.runs) {
      const m =
        entry.manifestCid === manifestCid
          ? manifest
          : (await fetchManifest(entry.manifestCid)).manifest;
      for (const key of expectedCidCopyKeys(m, entry.manifestCid)) expected.add(key);
    }
    const keys = await listKeys(bucket, "ipfs/");
    await testInfo.attach("ipfs-keys.txt", { body: keys.join("\n"), contentType: "text/plain" });
    expect(keys.length, "the copy holds the published objects").toBeGreaterThan(0);
    expect(
      keys.filter((key) => !expected.has(key)),
      "keys under ipfs/ that no manifest lists",
    ).toEqual([]);
    for (const key of expectedCidCopyKeys(manifest, manifestCid)) {
      expect(keys, `${key} is in the bucket`).toContain(key);
    }

    // Step 3: overwrite attempts with the uploader's identity are refused; the object is unchanged.
    // The body and headers repeat the stored object so that, even if a guard were missing, the
    // attempt could not alter the copy; the assertions still require the refusals.
    const key = `ipfs/${manifestCid}`;
    const before = await headObject(bucket, key);
    const base = {
      Bucket: bucket,
      Key: key,
      Body: manifestBytes,
      ContentType: before.contentType,
      CacheControl: before.cacheControl,
      Metadata: before.metadata,
    };
    const plain = await putObjectAttempt(base, PROFILES.cidWriter);
    const conditional = await putObjectAttempt({ ...base, IfNoneMatch: "*" }, PROFILES.cidWriter);
    const after = await headObject(bucket, key);
    await testInfo.attach("overwrite-attempts.json", {
      body: JSON.stringify({ key, before, plain, conditional, after }, null, 2),
      contentType: "application/json",
    });
    expect(plain.ok, "PutObject without If-None-Match is refused").toBe(false);
    if (!plain.ok) expect(plain.name, "refused by the bucket policy").toBe("AccessDenied");
    expect(conditional.ok, 'PutObject with If-None-Match: "*" is refused').toBe(false);
    if (!conditional.ok) {
      expect(conditional.name, "refused by the conditional write").toBe("PreconditionFailed");
      expect(conditional.status).toBe(412);
    }
    expect(after.etag, "ETag unchanged").toBe(before.etag);
    expect(after.checksumSha256, "stored SHA-256 checksum unchanged").toBe(before.checksumSha256);
    expect(after.metadata, "cid/sha256 metadata unchanged").toEqual(before.metadata);
    const again = await getFromCopy(host, manifestCid);
    expect(sha256Hex(again.bytes), "the public bytes are unchanged").toBe(sha256Hex(manifestBytes));

    // A key no manifest lists is not public.
    for (const path of NON_MANIFEST_PATHS) {
      const res = await fetch(`https://${host}/${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      expect([403, 404], `${path} → 403 or 404, got ${res.status}`).toContain(res.status);
    }
  });
});
