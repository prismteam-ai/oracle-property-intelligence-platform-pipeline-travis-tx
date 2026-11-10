import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PinningProvider } from "../../src/domain/artifact-manifest.js";
import { FilebaseNames, FilebasePinning } from "../../src/infrastructure/filebase.js";
import { PinataPinning } from "../../src/infrastructure/pinata.js";
import { ServiceRequestError } from "../../src/infrastructure/service-request-error.js";

const ROOT = "bafybeiemueagst5oc7kfeunh6cqagln4yw6g2rognqwx6bajps7ojax64q";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "travis-oracle-pins-"));
  await writeFile(join(dir, "dataset.car"), "car bytes");
  await writeFile(join(dir, "properties.parquet"), "parquet bytes");
  await writeFile(join(dir, "manifest.json"), "{}");
});

type Captured = { method: string; url: string; headers: Headers; body?: FormData | string };

function recordingFetch(respond: (call: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const body = init?.body instanceof FormData ? init.body : undefined;
    const call: Captured = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(body && { body }),
      ...(typeof init?.body === "string" && { body: init.body }),
    };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetchImpl };
}

describe("FilebasePinning", () => {
  const credentials = { accessKeyId: "KEY", secretAccessKey: "SECRET", bucket: "travis-oracle" };

  it("imports the CAR into the IPFS bucket with a signed request and returns the pinned root", async () => {
    const { calls, fetchImpl } = recordingFetch(
      () => new Response(null, { status: 200, headers: { "x-amz-meta-cid": ROOT } }),
    );
    const pinning = new FilebasePinning({
      ...credentials,
      fetch: fetchImpl,
      retainPublications: 30,
    });

    const cid = await pinning.pin({
      label: "travis-oracle-20261028T130000Z",
      files: [],
      carPath: join(dir, "dataset.car"),
      asDirectory: true,
    });

    expect(cid).toBe(ROOT);
    expect(pinning.provider).toBe(PinningProvider.Filebase);
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: "https://s3.filebase.com/travis-oracle/travis-oracle-20261028T130000Z.car",
    });
    expect(calls[0]?.headers.get("x-amz-meta-import")).toBe("car");
    expect(calls[0]?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=KEY\//);
  });

  it("fails when Filebase does not report the pinned CID", async () => {
    const { fetchImpl } = recordingFetch(() => new Response("denied", { status: 403 }));
    const pinning = new FilebasePinning({
      ...credentials,
      fetch: fetchImpl,
      retainPublications: 30,
    });

    await expect(
      pinning.pin({ label: "x", files: [], carPath: join(dir, "dataset.car"), asDirectory: true }),
    ).rejects.toBeInstanceOf(ServiceRequestError);
  });

  it("unpins a publication by deleting its CAR object, tolerating one already gone", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(null, { status: 404 }));
    const pinning = new FilebasePinning({
      ...credentials,
      fetch: fetchImpl,
      retainPublications: 30,
    });

    await pinning.unpin("travis-oracle-20261026T130000Z");

    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: "https://s3.filebase.com/travis-oracle/travis-oracle-20261026T130000Z.car",
    });
  });
});

describe("PinataPinning", () => {
  it("uploads a dataset as a public folder named after the publication", async () => {
    const { calls, fetchImpl } = recordingFetch(
      () => new Response(JSON.stringify({ data: { id: "f1", cid: ROOT } }), { status: 200 }),
    );
    const pinning = new PinataPinning({ jwt: "JWT", fetch: fetchImpl, retainPublications: 3 });

    const cid = await pinning.pin({
      label: "travis-oracle-20261028T130000Z",
      files: [{ name: "tables/properties.parquet", path: join(dir, "properties.parquet") }],
      carPath: join(dir, "dataset.car"),
      asDirectory: true,
    });

    expect(cid).toBe(ROOT);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://uploads.pinata.cloud/v3/files",
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer JWT");
    const form = calls[0]?.body as FormData;
    expect(form.get("network")).toBe("public");
    expect(form.get("name")).toBe("travis-oracle-20261028T130000Z");
    expect((form.getAll("file")[0] as File).name).toBe(
      "travis-oracle-20261028T130000Z/tables/properties.parquet",
    );
  });

  it("uploads a single file under its own name", async () => {
    const { calls, fetchImpl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ data: { id: "f2", cid: "bafkrei-manifest" } }), {
          status: 200,
        }),
    );
    const pinning = new PinataPinning({ jwt: "JWT", fetch: fetchImpl, retainPublications: 3 });

    await pinning.pin({
      label: "travis-oracle-manifest-20261028T130000Z",
      files: [{ name: "manifest.json", path: join(dir, "manifest.json") }],
      carPath: "",
      asDirectory: false,
    });

    const form = calls[0]?.body as FormData;
    expect((form.getAll("file")[0] as File).name).toBe("manifest.json");
  });

  it("unpins every upload carrying the publication's label", async () => {
    const { calls, fetchImpl } = recordingFetch((call) =>
      call.method === "GET"
        ? new Response(
            JSON.stringify({
              data: {
                files: [
                  { id: "old-1", name: "travis-oracle-20261026T130000Z" },
                  { id: "other", name: "travis-oracle-20261026T130000Z-extra" },
                ],
              },
            }),
            { status: 200 },
          )
        : new Response(null, { status: 200 }),
    );
    const pinning = new PinataPinning({ jwt: "JWT", fetch: fetchImpl, retainPublications: 3 });

    await pinning.unpin("travis-oracle-20261026T130000Z");

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      [
        "GET",
        "https://api.pinata.cloud/v3/files/public?name=travis-oracle-20261026T130000Z&limit=100",
      ],
      ["DELETE", "https://api.pinata.cloud/v3/files/public/old-1"],
    ]);
  });
});

describe("FilebaseNames", () => {
  const config = { accessKeyId: "KEY", secretAccessKey: "SECRET", label: "travis-oracle" };

  it("points the existing name at the new CID and reports the k51 name", async () => {
    const { calls, fetchImpl } = recordingFetch((call) =>
      call.method === "PUT"
        ? new Response(null, { status: 200 })
        : new Response(
            JSON.stringify({ label: "travis-oracle", network_key: "k51abc", cid: "bafkrei-new" }),
            {
              status: 200,
            },
          ),
    );

    const result = await new FilebaseNames({ ...config, fetch: fetchImpl }).publish("bafkrei-new");

    expect(result).toEqual({ name: "k51abc", resolvedCid: "bafkrei-new" });
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: "https://api.filebase.io/v1/names/travis-oracle",
    });
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ cid: "bafkrei-new" });
    expect(calls[0]?.headers.get("authorization")).toBe(
      `Bearer ${Buffer.from("KEY:SECRET").toString("base64")}`,
    );
  });

  it("creates the name the first time", async () => {
    const { calls, fetchImpl } = recordingFetch((call) => {
      if (call.method === "PUT") return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ network_key: "k51abc", cid: "bafkrei-first" }), {
        status: 200,
      });
    });

    const result = await new FilebaseNames({ ...config, fetch: fetchImpl }).publish(
      "bafkrei-first",
    );

    expect(calls[1]).toMatchObject({ method: "POST", url: "https://api.filebase.io/v1/names" });
    expect(JSON.parse(String(calls[1]?.body))).toEqual({
      label: "travis-oracle",
      cid: "bafkrei-first",
    });
    expect(result.name).toBe("k51abc");
  });
});
