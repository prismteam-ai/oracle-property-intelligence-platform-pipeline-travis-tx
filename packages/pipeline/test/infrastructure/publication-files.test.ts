import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Manifest } from "../../src/domain/artifact-manifest.js";
import type { Publication } from "../../src/domain/publication-history.js";
import {
  JsonManifestWriter,
  JsonPublicationHistory,
} from "../../src/infrastructure/publication-files.js";

const publication: Publication = {
  buildId: "20261028T130000Z",
  publishedAt: "2026-10-28T13:05:00.000Z",
  manifestCid: "bafkrei-manifest",
  rootCid: "bafybei-root",
  ipns: { name: "k51abc", resolvedCid: "bafkrei-manifest" },
};

describe("JsonPublicationHistory", () => {
  it("starts empty and keeps what it was given", async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), "travis-oracle-history-")),
      "published",
      "history.json",
    );
    const history = new JsonPublicationHistory(path);

    expect(await history.read()).toEqual([]);
    await history.write([publication]);

    expect(await new JsonPublicationHistory(path).read()).toEqual([publication]);
  });
});

describe("JsonManifestWriter", () => {
  it("writes the manifest as manifest.json in the work directory", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "travis-oracle-manifest-"));
    const manifest = { schema: "travis-oracle.artifact-manifest.v1", build_id: "x" } as Manifest;

    const file = await new JsonManifestWriter().write(manifest, workDir);

    expect(file).toEqual({ name: "manifest.json", path: join(workDir, "manifest.json") });
    expect(JSON.parse(await readFile(file.path, "utf8"))).toEqual(manifest);
  });
});
