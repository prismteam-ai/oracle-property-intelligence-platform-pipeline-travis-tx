import { describe, expect, it } from "vitest";
import { type ByteRange, IpfsRoute, type MirrorStore } from "../../worker/ipfs-route.js";
import type { Publication } from "../../worker/publications.js";

const ROOT = "bafybeigw2tcsb4aa3br7622u3oqxbk3trcvxc2iza6gkohnltefkt5ewwq";
const MANIFEST = "bafkreibzo5l57bgzkwtypxkbcg72n3mez6gcdjaon65lnsfxywptt3dqm4";
const UNKNOWN = "bafkreiaaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkkkllllmmmm";
const PUBLICATIONS: Publication[] = [
  {
    buildId: "20261027T082005Z",
    publishedAt: "2026-10-27T08:21:33.509Z",
    manifestCid: MANIFEST,
    rootCid: ROOT,
    ipns: {
      name: "k51qzi5uqu5dkkce5c4ypc8o1xsrybtdhfae3ec2f3nbhz5ht1c4msv89ftm5c",
      resolvedCid: MANIFEST,
    },
  },
];
const PARQUET = "PAR1-twenty-bytes!!!";

function memoryMirror(objects: Record<string, string>): MirrorStore {
  const bytes = (key: string) => new TextEncoder().encode(objects[key]);
  return {
    head: async (key) => (key in objects ? { size: bytes(key).length } : null),
    get: async (key, range?: ByteRange) => {
      if (!(key in objects)) return null;
      const all = bytes(key);
      const part = range ? all.slice(range.offset, range.offset + range.length) : all;
      return { body: new Response(part).body, size: all.length };
    },
  };
}

function recordingFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; range: string | null }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, range: new Headers(init?.headers).get("range") });
    return respond(url, init);
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function route(
  objects: Record<string, string>,
  fetchImpl: typeof fetch = recordingFetch(() => new Response("", { status: 500 })).fetchImpl,
) {
  return new IpfsRoute({
    mirror: memoryMirror(objects),
    gateways: ["https://ipfs.orbitor.dev", "https://gw.ipfs-lens.dev"],
    fetch: fetchImpl,
    publications: async () => PUBLICATIONS,
  });
}

const request = (path: string, init?: RequestInit) =>
  new Request(`https://explorer.test${path}`, init);

describe("IpfsRoute", () => {
  const objects = {
    [`ipfs/${ROOT}/tables/properties.parquet`]: PARQUET,
    [`ipfs/${MANIFEST}`]: '{"schema":1}',
  };

  it("serves a mirrored file of a published dataset with immutable caching", async () => {
    const response = await route(objects).handle(
      request(`/ipfs/${ROOT}/tables/properties.parquet`),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PARQUET);
    expect(response.headers.get("content-length")).toBe("20");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("application/vnd.apache.parquet");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-served-by")).toBe("r2-mirror");
  });

  it("serves byte ranges the way DuckDB reads Parquet", async () => {
    const explorer = route(objects);
    const path = `/ipfs/${ROOT}/tables/properties.parquet`;

    const middle = await explorer.handle(request(path, { headers: { range: "bytes=5-10" } }));
    expect(middle.status).toBe(206);
    expect(middle.headers.get("content-range")).toBe("bytes 5-10/20");
    expect(await middle.text()).toBe("twenty");

    const suffix = await explorer.handle(request(path, { headers: { range: "bytes=-4" } }));
    expect(suffix.headers.get("content-range")).toBe("bytes 16-19/20");
    expect(await suffix.text()).toBe("s!!!");

    const open = await explorer.handle(request(path, { headers: { range: "bytes=10-" } }));
    expect(open.headers.get("content-range")).toBe("bytes 10-19/20");

    const beyond = await explorer.handle(request(path, { headers: { range: "bytes=40-" } }));
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe("bytes */20");
  });

  it("answers HEAD with the size only", async () => {
    const response = await route(objects).handle(
      request(`/ipfs/${ROOT}/tables/properties.parquet`, { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("20");
    expect(await response.text()).toBe("");
  });

  it("serves a published manifest by its CID", async () => {
    const response = await route(objects).handle(request(`/ipfs/${MANIFEST}`));

    expect(await response.json()).toEqual({ schema: 1 });
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("falls back to the public gateways in order when the mirror lacks a file", async () => {
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.startsWith("https://ipfs.orbitor.dev")
        ? new Response("busy", { status: 504 })
        : new Response("tail", { status: 206, headers: { "content-range": "bytes 0-3/100" } }),
    );

    const response = await route({}, fetchImpl).handle(
      request(`/ipfs/${ROOT}/coverage.json`, { headers: { range: "bytes=0-3" } }),
    );

    expect(calls).toEqual([
      { url: `https://ipfs.orbitor.dev/ipfs/${ROOT}/coverage.json`, range: "bytes=0-3" },
      { url: `https://gw.ipfs-lens.dev/ipfs/${ROOT}/coverage.json`, range: "bytes=0-3" },
    ]);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-3/100");
    expect(response.headers.get("x-served-by")).toBe("gw.ipfs-lens.dev");
    expect(await response.text()).toBe("tail");
  });

  it("reports a bad gateway when no gateway has the file", async () => {
    const response = await route({}).handle(request(`/ipfs/${ROOT}/coverage.json`));

    expect(response.status).toBe(502);
  });

  it("only serves CIDs from the publication history, so it is not an open IPFS proxy", async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response("anything"));

    const unknown = await route(objects, fetchImpl).handle(request(`/ipfs/${UNKNOWN}`));
    const manifestPath = await route(objects, fetchImpl).handle(request(`/ipfs/${MANIFEST}/x`));
    const traversal = await route(objects, fetchImpl).handle(request(`/ipfs/${ROOT}/../x`));

    expect([unknown.status, manifestPath.status, traversal.status]).toEqual([404, 404, 404]);
    expect(calls).toEqual([]);
  });
});
