import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HttpFileDownloader } from "../../src/infrastructure/http-file-downloader.js";
import { SourceRequestError } from "../../src/infrastructure/source-request-error.js";

const URL = "https://traviscad.org/wp-content/largefiles/export.zip";
const FETCHED_AT = new Date("2026-10-27T09:00:00.000Z");

function downloaderReturning(response: Response, seen: Headers[] = []) {
  return new HttpFileDownloader({
    userAgent: "travis-oracle-pipeline/test",
    fetch: async (_input, init) => {
      seen.push(new Headers(init?.headers));
      return response;
    },
    now: () => FETCHED_AT,
  });
}

describe("HttpFileDownloader", () => {
  it("streams the file to disk and returns its size and SHA-256", async () => {
    const content = "PK\u0003\u0004 archive bytes";
    const headers: Headers[] = [];
    const destination = join(await mkdtemp(join(tmpdir(), "travis-oracle-dl-")), "raw", "a.zip");

    const receipt = await downloaderReturning(new Response(content), headers).download(
      URL,
      destination,
    );

    expect(await readFile(destination, "utf8")).toBe(content);
    expect(receipt).toEqual({
      url: URL,
      fetchedAt: FETCHED_AT.toISOString(),
      httpStatus: 200,
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    expect(headers[0]?.get("user-agent")).toBe("travis-oracle-pipeline/test");
  });

  it("fails loudly on a non-2xx response", async () => {
    const destination = join(await mkdtemp(join(tmpdir(), "travis-oracle-dl-")), "a.zip");

    await expect(
      downloaderReturning(new Response("nope", { status: 404 })).download(URL, destination),
    ).rejects.toBeInstanceOf(SourceRequestError);
  });
});
