import { describe, expect, it } from "vitest";
import {
  ArtifactCodec,
  ArtifactKind,
  buildManifest,
  type DatasetEncoding,
  MANIFEST_SCHEMA,
  PinMismatchError,
  PinningProvider,
  verificationTargets,
} from "../../src/domain/artifact-manifest.js";

const ROOT = "bafybeiemueagst5oc7kfeunh6cqagln4yw6g2rognqwx6bajps7ojax64q";

const encoding: DatasetEncoding = {
  root: ROOT,
  objects: [
    {
      name: "tables/properties.parquet",
      cid: "bafybeifiwh6uz5lvv2rtk5srp4lt62gz2duwuegk2tg2fr2otr7dwsbqby",
      kind: ArtifactKind.File,
      codec: ArtifactCodec.DagPb,
      size: 3_145_728,
      sha256: "aa",
    },
    {
      name: "coverage.json",
      cid: "bafkreidzmakcuetcfj5st672mnvb2mgscaqcosrri4xi5vqlhskodwa6f4",
      kind: ArtifactKind.File,
      codec: ArtifactCodec.Raw,
      size: 120,
      sha256: "bb",
    },
    {
      name: "tables",
      cid: "bafybeia7io3cirrk4j6uwf3loje2l6l33cfxkpbtjbrfrhjjbhd3w5rove",
      kind: ArtifactKind.Directory,
      codec: ArtifactCodec.DagPb,
      size: 3_145_728,
    },
  ],
  car: { name: "travis-oracle-20261027T130000Z.car", size: 3_200_000, sha256: "cc" },
};

const matchingPins = [
  { provider: PinningProvider.Filebase, cid: ROOT },
  { provider: PinningProvider.Pinata, cid: ROOT },
];

describe("verificationTargets", () => {
  it("checks the dataset root first, then every listed object", () => {
    const manifest = buildManifest({
      buildId: "20261027T130000Z",
      createdAt: "2026-10-27T13:05:00.000Z",
      encoding,
      pins: matchingPins,
      previous: undefined,
      carUrl: undefined,
    });

    expect(verificationTargets(manifest).map((target) => target.name)).toEqual([
      "/",
      "coverage.json",
      "tables",
      "tables/properties.parquet",
    ]);
  });
});

describe("buildManifest", () => {
  it("lists the dataset root, every object sorted by name, the CAR and how the DAG was made", () => {
    const manifest = buildManifest({
      buildId: "20261027T130000Z",
      createdAt: "2026-10-27T13:05:00.000Z",
      encoding,
      pins: matchingPins,
      previous: undefined,
      carUrl:
        "https://github.com/curiousily/repo/releases/download/build-20261027T130000Z/travis-oracle-20261027T130000Z.car",
    });

    expect(manifest).toMatchObject({
      schema: MANIFEST_SCHEMA,
      build_id: "20261027T130000Z",
      created_at: "2026-10-27T13:05:00.000Z",
      root: { name: "/", cid: ROOT, kind: ArtifactKind.Directory, codec: ArtifactCodec.DagPb },
      car: {
        name: "travis-oracle-20261027T130000Z.car",
        root: ROOT,
        size: 3_200_000,
        sha256: "cc",
        url: expect.stringContaining("/releases/download/"),
      },
      dag: { cid_version: 1, multibase: "base32", hash: "sha2-256", raw_leaves: true },
      pins: [
        { provider: "filebase", cid: ROOT },
        { provider: "pinata", cid: ROOT },
      ],
      previous: null,
    });
    expect(manifest.objects.map((object) => object.name)).toEqual([
      "coverage.json",
      "tables",
      "tables/properties.parquet",
    ]);
    expect(manifest.root.size).toBe(3_145_848);
  });

  it("links the previous publication so history forms a chain", () => {
    const manifest = buildManifest({
      buildId: "20261028T130000Z",
      createdAt: "2026-10-28T13:05:00.000Z",
      encoding,
      pins: matchingPins,
      previous: { manifestCid: "bafkreiprevious", rootCid: "bafybeiprevious" },
      carUrl: undefined,
    });

    expect(manifest.previous).toEqual({
      manifest_cid: "bafkreiprevious",
      root_cid: "bafybeiprevious",
    });
    expect(manifest.car.url).toBeNull();
  });

  it("refuses to describe a dataset that a provider pinned under a different CID", () => {
    expect(() =>
      buildManifest({
        buildId: "20261027T130000Z",
        createdAt: "2026-10-27T13:05:00.000Z",
        encoding,
        pins: [
          { provider: PinningProvider.Filebase, cid: ROOT },
          { provider: PinningProvider.Pinata, cid: "bafybeisomethingelse" },
        ],
        previous: undefined,
        carUrl: undefined,
      }),
    ).toThrow(PinMismatchError);
  });

  it("refuses to describe a dataset pinned by fewer than two providers", () => {
    expect(() =>
      buildManifest({
        buildId: "20261027T130000Z",
        createdAt: "2026-10-27T13:05:00.000Z",
        encoding,
        pins: [{ provider: PinningProvider.Filebase, cid: ROOT }],
        previous: undefined,
        carUrl: undefined,
      }),
    ).toThrow(/two independent providers/i);
  });
});
