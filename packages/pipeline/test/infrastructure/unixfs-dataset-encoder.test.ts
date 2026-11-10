import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarReader } from "@ipld/car";
import { beforeAll, describe, expect, it } from "vitest";
import { ArtifactCodec, ArtifactKind } from "../../src/domain/artifact-manifest.js";
import { UnixFsDatasetEncoder } from "../../src/infrastructure/unixfs-dataset-encoder.js";

const PINATA_FOLDER_CID = "bafybeiemueagst5oc7kfeunh6cqagln4yw6g2rognqwx6bajps7ojax64q";
const PINATA_FILE_CID = "bafybeifiwh6uz5lvv2rtk5srp4lt62gz2duwuegk2tg2fr2otr7dwsbqby";
const BIG_FILE_BYTES = 3 * 1024 * 1024;
const SHA256_BYTES = 32;

function pinataProbeBytes(): Buffer {
  let seed = createHash("sha256").update("travis-oracle").digest();
  const chunks: Buffer[] = [];
  for (let i = 0; i < BIG_FILE_BYTES / SHA256_BYTES; i++) {
    seed = createHash("sha256").update(seed).digest();
    chunks.push(seed);
  }
  return Buffer.concat(chunks);
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

let dir: string;
const small = JSON.stringify({ probe: "pinata-cid-match" });
let big: Buffer;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "travis-oracle-unixfs-"));
  big = pinataProbeBytes();
  await writeFile(join(dir, "a.json"), small);
  await writeFile(join(dir, "b.bin"), big);
  await mkdir(join(dir, "tables"));
  await writeFile(join(dir, "tables", "c.json"), "{}");
});

async function carRoots(path: string): Promise<string[]> {
  const reader = await CarReader.fromIterable(createReadStream(path));
  return (await reader.getRoots()).map(String);
}

describe("UnixFsDatasetEncoder", () => {
  it("builds the same directory CID that Pinata computes for the same folder", async () => {
    const encoding = await new UnixFsDatasetEncoder().encodeDirectory(
      [
        { name: "a.json", path: join(dir, "a.json") },
        { name: "b.bin", path: join(dir, "b.bin") },
      ],
      join(dir, "probe.car"),
    );

    expect(encoding.root).toBe(PINATA_FOLDER_CID);
    expect(encoding.objects.find((object) => object.name === "b.bin")).toEqual({
      name: "b.bin",
      cid: PINATA_FILE_CID,
      kind: ArtifactKind.File,
      codec: ArtifactCodec.DagPb,
      size: BIG_FILE_BYTES,
      sha256: sha256(big),
    });
    expect(encoding.objects.find((object) => object.name === "a.json")).toMatchObject({
      codec: ArtifactCodec.Raw,
      size: Buffer.byteLength(small),
      sha256: sha256(small),
    });
  });

  it("writes a CAR whose single root is the dataset and reports its size and digest", async () => {
    const carPath = join(dir, "probe-2.car");

    const encoding = await new UnixFsDatasetEncoder().encodeDirectory(
      [{ name: "a.json", path: join(dir, "a.json") }],
      carPath,
    );

    const car = await readFile(carPath);
    expect(await carRoots(carPath)).toEqual([encoding.root]);
    expect(encoding.car).toEqual({ name: "probe-2.car", size: car.length, sha256: sha256(car) });
  });

  it("lists nested directories with their own CIDs and the bytes they hold", async () => {
    const encoding = await new UnixFsDatasetEncoder().encodeDirectory(
      [
        { name: "a.json", path: join(dir, "a.json") },
        { name: "tables/c.json", path: join(dir, "tables", "c.json") },
      ],
      join(dir, "nested.car"),
    );

    const tables = encoding.objects.find((object) => object.name === "tables");
    expect(tables).toMatchObject({
      kind: ArtifactKind.Directory,
      codec: ArtifactCodec.DagPb,
      size: 2,
    });
    expect(tables?.cid).toMatch(/^bafybei/);
    expect(encoding.objects.map((object) => object.name).sort()).toEqual([
      "a.json",
      "tables",
      "tables/c.json",
    ]);
  });

  it("encodes a single file whose small-file CID is the raw SHA-256 of its bytes", async () => {
    const carPath = join(dir, "single.car");

    const encoded = await new UnixFsDatasetEncoder().encodeFile(
      { name: "manifest.json", path: join(dir, "a.json") },
      carPath,
    );

    expect(encoded.object).toMatchObject({
      name: "manifest.json",
      kind: ArtifactKind.File,
      codec: ArtifactCodec.Raw,
      size: Buffer.byteLength(small),
      sha256: sha256(small),
    });
    expect(encoded.object.cid).toMatch(/^bafkrei/);
    expect(await carRoots(carPath)).toEqual([encoded.object.cid]);
    expect(encoded.car.path).toBe(carPath);
  });
});
