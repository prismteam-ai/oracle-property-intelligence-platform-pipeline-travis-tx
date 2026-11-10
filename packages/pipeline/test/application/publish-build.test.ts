import { describe, expect, it } from "vitest";
import {
  type ArtifactVerifier,
  type DatasetEncoder,
  type DatasetFile,
  type EncodedFile,
  type ManifestWriter,
  type NameService,
  type PinningService,
  type PinRequest,
  type PublicationHistoryStore,
  type VerificationResult,
  VerificationStatus,
  type VerificationTarget,
} from "../../src/application/publication-ports.js";
import { publishBuild } from "../../src/application/publish-build.js";
import {
  ArtifactCodec,
  ArtifactKind,
  type DatasetEncoding,
  type Manifest,
  PinMismatchError,
  PinningProvider,
} from "../../src/domain/artifact-manifest.js";
import type { Publication } from "../../src/domain/publication-history.js";

const BUILD_ID = "20261028T130000Z";
const ROOT = "bafybei-dataset-root";
const MANIFEST_CID = "bafkrei-manifest";
const FILES: DatasetFile[] = [
  { name: "tables/properties.parquet", path: "/data/build/x/properties.parquet" },
  { name: "build.json", path: "/data/build/x/build.json" },
];

class FakeEncoder implements DatasetEncoder {
  async encodeDirectory(_files: readonly DatasetFile[], carPath: string): Promise<DatasetEncoding> {
    return {
      root: ROOT,
      objects: [
        {
          name: "tables/properties.parquet",
          cid: "bafybei-properties",
          kind: ArtifactKind.File,
          codec: ArtifactCodec.DagPb,
          size: 2048,
          sha256: "props",
        },
      ],
      car: { name: carPath.split("/").at(-1) ?? "", size: 4096, sha256: "car" },
    };
  }
  async encodeFile(file: DatasetFile, carPath: string): Promise<EncodedFile> {
    return {
      object: {
        name: file.name,
        cid: MANIFEST_CID,
        kind: ArtifactKind.File,
        codec: ArtifactCodec.Raw,
        size: 512,
        sha256: "manifest",
      },
      car: { path: carPath, size: 600, sha256: "manifest-car" },
    };
  }
}

class FakePinning implements PinningService {
  readonly requests: PinRequest[] = [];
  readonly unpinned: string[] = [];
  constructor(
    readonly provider: PinningProvider,
    readonly retainPublications: number,
    private readonly answer: (request: PinRequest) => string = (request) =>
      request.asDirectory ? ROOT : MANIFEST_CID,
  ) {}
  async pin(request: PinRequest) {
    this.requests.push(request);
    return this.answer(request);
  }
  async unpin(label: string) {
    this.unpinned.push(label);
  }
}

class FakeNames implements NameService {
  published: string | undefined;
  async publish(cid: string) {
    this.published = cid;
    return { name: "k51-travis-oracle", resolvedCid: cid };
  }
}

class FakeVerifier implements ArtifactVerifier {
  targets: readonly VerificationTarget[] = [];
  async verify(targets: readonly VerificationTarget[]): Promise<VerificationResult[]> {
    this.targets = targets;
    return targets.map((target) => ({
      name: target.name,
      cid: target.cid,
      gateway: "https://ipfs.orbitor.dev",
      status: VerificationStatus.Verified,
      httpStatus: 200,
      bytes: target.size,
      checkedAt: "2026-10-28T13:06:00.000Z",
    }));
  }
}

class MemoryHistory implements PublicationHistoryStore {
  constructor(public entries: Publication[] = []) {}
  async read() {
    return this.entries;
  }
  async write(history: readonly Publication[]) {
    this.entries = [...history];
  }
}

class CapturingManifestWriter implements ManifestWriter {
  manifest: Manifest | undefined;
  async write(manifest: Manifest, workDir: string): Promise<DatasetFile> {
    this.manifest = manifest;
    return { name: "manifest.json", path: `${workDir}/manifest.json` };
  }
}

const earlier = (buildId: string): Publication => ({
  buildId,
  publishedAt: "2026-10-27T13:05:00.000Z",
  manifestCid: `bafkrei-manifest-${buildId}`,
  rootCid: `bafybei-root-${buildId}`,
  ipns: { name: "k51-travis-oracle", resolvedCid: `bafkrei-manifest-${buildId}` },
});

function setup(history: Publication[] = [], pinataAnswer?: (request: PinRequest) => string) {
  return {
    encoder: new FakeEncoder(),
    pinning: [
      new FakePinning(PinningProvider.Filebase, 30),
      new FakePinning(PinningProvider.Pinata, 2, pinataAnswer),
    ],
    names: new FakeNames(),
    verifier: new FakeVerifier(),
    history: new MemoryHistory(history),
    manifests: new CapturingManifestWriter(),
  };
}

const options = {
  buildId: BUILD_ID,
  files: FILES,
  workDir: "/data/publish/20261028T130000Z",
  now: () => "2026-10-28T13:05:00.000Z",
  carUrl: (name: string) =>
    `https://github.com/curiousily/repo/releases/download/build-${BUILD_ID}/${name}`,
};

describe("publishBuild", () => {
  it("pins the dataset on every provider, describes it in a manifest and points the name at it", async () => {
    const deps = setup([earlier("20261027T130000Z")]);

    const result = await publishBuild(deps, options);

    for (const pinning of deps.pinning) {
      expect(pinning.requests.map((request) => [request.label, request.asDirectory])).toEqual([
        [`travis-oracle-${BUILD_ID}`, true],
        [`travis-oracle-manifest-${BUILD_ID}`, false],
      ]);
    }
    expect(deps.manifests.manifest).toMatchObject({
      build_id: BUILD_ID,
      root: { cid: ROOT },
      car: { name: `travis-oracle-${BUILD_ID}.car`, url: expect.stringContaining(BUILD_ID) },
      previous: {
        manifest_cid: "bafkrei-manifest-20261027T130000Z",
        root_cid: "bafybei-root-20261027T130000Z",
      },
    });
    expect(deps.names.published).toBe(MANIFEST_CID);
    expect(result.publication).toEqual({
      buildId: BUILD_ID,
      publishedAt: "2026-10-28T13:05:00.000Z",
      manifestCid: MANIFEST_CID,
      rootCid: ROOT,
      ipns: { name: "k51-travis-oracle", resolvedCid: MANIFEST_CID },
    });
  });

  it("verifies the dataset root, every object and the manifest through the gateways", async () => {
    const deps = setup();

    const result = await publishBuild(deps, options);

    expect(deps.verifier.targets.map((target) => target.cid)).toEqual([
      ROOT,
      "bafybei-properties",
      MANIFEST_CID,
    ]);
    expect(result.verification.every((entry) => entry.status === VerificationStatus.Verified)).toBe(
      true,
    );
  });

  it("appends the publication to the history and keeps every earlier one", async () => {
    const deps = setup([earlier("20261026T130000Z"), earlier("20261027T130000Z")]);

    await publishBuild(deps, options);

    expect(deps.history.entries.map((entry) => entry.buildId)).toEqual([
      "20261026T130000Z",
      "20261027T130000Z",
      BUILD_ID,
    ]);
  });

  it("unpins datasets that fall outside a provider's retention, keeping manifests", async () => {
    const deps = setup([earlier("20261026T130000Z"), earlier("20261027T130000Z")]);

    const result = await publishBuild(deps, options);

    const [filebase, pinata] = deps.pinning;
    expect(filebase?.unpinned).toEqual([]);
    expect(pinata?.unpinned).toEqual(["travis-oracle-20261026T130000Z"]);
    expect(result.unpinned).toEqual([
      { provider: PinningProvider.Pinata, label: "travis-oracle-20261026T130000Z" },
    ]);
  });

  it("keeps older pins when the new publication could not be verified anywhere", async () => {
    const deps = setup([earlier("20261026T130000Z"), earlier("20261027T130000Z")]);
    deps.verifier.verify = async (targets) =>
      targets.map((target) => ({
        name: target.name,
        cid: target.cid,
        gateway: "https://ipfs.orbitor.dev",
        status: VerificationStatus.Unreachable,
        httpStatus: undefined,
        bytes: undefined,
        checkedAt: "2026-10-28T13:06:00.000Z",
      }));

    const result = await publishBuild(deps, options);

    expect(result.unpinned).toEqual([]);
    expect(deps.pinning[1]?.unpinned).toEqual([]);
  });

  it("stops before naming anything when a provider pinned a different dataset root", async () => {
    const deps = setup([], (request) => (request.asDirectory ? "bafybei-other" : MANIFEST_CID));

    await expect(publishBuild(deps, options)).rejects.toThrow(PinMismatchError);
    expect(deps.names.published).toBeUndefined();
    expect(deps.history.entries).toEqual([]);
  });

  it("stops when a provider pinned a different manifest", async () => {
    const deps = setup([], (request) => (request.asDirectory ? ROOT : "bafkrei-other"));

    await expect(publishBuild(deps, options)).rejects.toThrow(PinMismatchError);
    expect(deps.names.published).toBeUndefined();
  });
});
