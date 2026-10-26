// T028: Kubo RPC `add` of a plain file (the manifest's carCid, AM-05) and of the manifest bytes.
// Everything runs against a fake Kubo RPC: no network, no upload, no credential read from disk.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import {
  KUBO_ADD_QUERY,
  filebaseToken,
  kuboAddBytes,
  kuboAddFile,
  kuboToken,
  type FetchLike,
} from "../src/kubo-add.js";

/** Fake credentials with the real variable names; never the real values. */
const ENV = {
  FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
  FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
  FILEBASE_BUCKET: "countylens-fake",
};
const TOKEN = Buffer.from(
  `${ENV.FILEBASE_ACCESS_KEY}:${ENV.FILEBASE_SECRET_KEY}:${ENV.FILEBASE_BUCKET}`,
).toString("base64");

interface AddCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  fields: string[];
  name: string;
  bytes: Uint8Array;
}

interface FakeKuboOptions {
  /** Rewrites the Hash the fake returns (default: the locally computed CID of the bytes). */
  hash?: (cid: string) => string;
  status?: number;
  body?: string;
}

/** A fake Kubo RPC: records every `add` and answers with the raw-leaves CIDv1 of the bytes. */
function fakeKubo(opts: FakeKuboOptions = {}): { fetch: FetchLike; calls: AddCall[] } {
  const calls: AddCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error("expected a multipart FormData body");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("expected a `file` field");
    const bytes = new Uint8Array(await file.arrayBuffer());
    calls.push({
      url: new URL(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
      fields: [...form.keys()],
      name: file.name,
      bytes,
    });
    if (opts.status !== undefined) return new Response(opts.body ?? "", { status: opts.status });
    const cid = await cidOfBytes(bytes);
    const hash = opts.hash ? opts.hash(cid) : cid;
    const line = JSON.stringify({ Name: file.name, Hash: hash, Size: String(bytes.length) });
    return new Response(`${line}\n`, { status: 200 });
  };
  return { fetch, calls };
}

function tempFile(name: string, bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "kubo-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

describe("the Filebase token", () => {
  it("is base64(access key:secret key:bucket) from the env, as elephant-cli composes it", () => {
    expect(filebaseToken(ENV)).toBe(TOKEN);
    expect(filebaseToken({ ...ENV, FILEBASE_BUCKET: "" })).toBeUndefined();
    expect(filebaseToken({})).toBeUndefined();
  });

  it("prefers IPFS_API_TOKEN when set, like the CLI", () => {
    expect(kuboToken({ ...ENV, IPFS_API_TOKEN: "fake-bearer" })).toBe("fake-bearer");
    expect(kuboToken(ENV)).toBe(TOKEN);
    expect(kuboToken({})).toBeUndefined();
  });
});

describe("kuboAddFile (carCid, AM-05)", () => {
  it("POSTs add?cid-version=1&raw-leaves=true&pin=true to the Filebase RPC and returns the local CID", async () => {
    const bytes = new TextEncoder().encode("CAR bytes of travis-county.car");
    const path = tempFile("travis-county.car", bytes);
    const kubo = fakeKubo();
    const expected = await cidOfFile(path);
    const added = await kuboAddFile(path, expected, { env: ENV, fetch: kubo.fetch });
    expect(added).toEqual({ cid: expected, name: "travis-county.car", size: bytes.length });
    expect(expected).toMatch(/^bafkrei/);
    const call = at(kubo.calls, 0);
    expect(call.method).toBe("POST");
    expect(call.url.origin).toBe("https://rpc.filebase.io");
    expect(call.url.pathname).toBe("/api/v0/add");
    expect(call.url.searchParams.get("cid-version")).toBe("1");
    expect(call.url.searchParams.get("raw-leaves")).toBe("true");
    expect(call.url.searchParams.get("pin")).toBe("true");
    expect(KUBO_ADD_QUERY).toContain("cid-version=1");
    expect(KUBO_ADD_QUERY).toContain("raw-leaves=true");
    expect(KUBO_ADD_QUERY).toContain("pin=true");
    expect(call.fields).toEqual(["file"]);
    expect(call.name).toBe("travis-county.car");
    expect(Buffer.from(call.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("agrees with cidOfFile above one 256 KiB chunk too (a dag-pb root)", async () => {
    const bytes = new Uint8Array(300 * 1024).map((_, i) => i % 251);
    const path = tempFile("tables.car", bytes);
    const kubo = fakeKubo();
    const expected = await cidOfFile(path);
    expect(expected).toMatch(/^bafybei/);
    const added = await kuboAddFile(path, expected, { env: ENV, fetch: kubo.fetch });
    expect(added.cid).toBe(expected);
    expect(added.size).toBe(bytes.length);
  });

  it("sends the credentials only as a bearer header: never in the URL, never in the form", async () => {
    const path = tempFile("x.car", new TextEncoder().encode("x"));
    const kubo = fakeKubo();
    await kuboAddFile(path, await cidOfFile(path), { env: ENV, fetch: kubo.fetch });
    const call = at(kubo.calls, 0);
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const secret of [TOKEN, ENV.FILEBASE_SECRET_KEY, ENV.FILEBASE_ACCESS_KEY]) {
      expect(call.url.href).not.toContain(secret);
      expect(new TextDecoder().decode(call.bytes)).not.toContain(secret);
    }
    expect(call.fields).toEqual(["file"]);
  });

  it("omits the header for a local daemon without credentials", async () => {
    const path = tempFile("x.car", new TextEncoder().encode("x"));
    const kubo = fakeKubo();
    await kuboAddFile(path, await cidOfFile(path), {
      env: {},
      fetch: kubo.fetch,
      api: "http://127.0.0.1:5001",
    });
    const call = at(kubo.calls, 0);
    expect(call.headers.authorization).toBeUndefined();
    expect(call.url.origin).toBe("http://127.0.0.1:5001");
  });

  it("fails when the returned Hash is not the locally computed CID", async () => {
    const path = tempFile("x.car", new TextEncoder().encode("x"));
    const other = await cidOfBytes(new TextEncoder().encode("y"));
    const kubo = fakeKubo({ hash: () => other });
    const expected = await cidOfFile(path);
    await expect(kuboAddFile(path, expected, { env: ENV, fetch: kubo.fetch })).rejects.toThrow(
      new RegExp(`${other}.*${expected}|${expected}.*${other}`),
    );
  });

  it("fails on a non-2xx response with the status, redacting any echoed credential", async () => {
    const path = tempFile("x.car", new TextEncoder().encode("x"));
    const kubo = fakeKubo({
      status: 401,
      body: `unauthorized: bad token ${TOKEN} for key ${ENV.FILEBASE_ACCESS_KEY}`,
    });
    const error = await kuboAddFile(path, await cidOfFile(path), {
      env: ENV,
      fetch: kubo.fetch,
    }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("401");
    expect(error?.message).toContain("[redacted]");
    for (const secret of [TOKEN, ENV.FILEBASE_SECRET_KEY, ENV.FILEBASE_ACCESS_KEY])
      expect(error?.message).not.toContain(secret);
  });

  it("fails when the response carries no Hash line (an HTML body from a wrong --api)", async () => {
    const path = tempFile("x.car", new TextEncoder().encode("x"));
    const kubo = fakeKubo({ status: 200, body: "<html>not kubo</html>" });
    await expect(
      kuboAddFile(path, await cidOfFile(path), { env: ENV, fetch: kubo.fetch }),
    ).rejects.toThrow(/no Hash/);
  });
});

describe("kuboAddBytes (the manifest)", () => {
  it("adds the exact JCS bytes and requires the returned CID to equal cidOfBytes", async () => {
    const bytes = new TextEncoder().encode('{"a":1,"runId":"travis-202609-reroof-x"}');
    const kubo = fakeKubo();
    const expected = await cidOfBytes(bytes);
    const added = await kuboAddBytes(bytes, "manifest.json", expected, {
      env: ENV,
      fetch: kubo.fetch,
    });
    expect(added).toEqual({ cid: expected, name: "manifest.json", size: bytes.length });
    expect(Buffer.from(at(kubo.calls, 0).bytes).equals(Buffer.from(bytes))).toBe(true);
    const kubo2 = fakeKubo({ hash: (cid) => cid.replace(/.$/, (c) => (c === "a" ? "b" : "a")) });
    await expect(
      kuboAddBytes(bytes, "manifest.json", expected, { env: ENV, fetch: kubo2.fetch }),
    ).rejects.toThrow(/manifest\.json/);
  });
});
