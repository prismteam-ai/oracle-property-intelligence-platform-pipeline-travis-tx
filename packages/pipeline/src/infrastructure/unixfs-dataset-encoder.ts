import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Writable } from "node:stream";
import * as dagPb from "@ipld/dag-pb";
import * as UnixFS from "@ipld/unixfs";
import { withMaxChunkSize } from "@ipld/unixfs/file/chunker/fixed";
import { withWidth } from "@ipld/unixfs/file/layout/balanced";
import {
  type Block,
  CAREncoderStream,
  createDirectoryEncoderStream,
  createFileEncoderStream,
} from "ipfs-car";
import * as raw from "multiformats/codecs/raw";
import type { DatasetEncoder, DatasetFile, EncodedFile } from "../application/publication-ports.js";
import {
  ArtifactCodec,
  ArtifactKind,
  type ArtifactObject,
  type DatasetEncoding,
} from "../domain/artifact-manifest.js";

const KUBO_CHUNK_BYTES = 262_144;
const KUBO_LINKS_PER_NODE = 174;
const PATH_SEPARATOR = "/";

type BlockCid = Block["cid"];
type CidWithCodec = { code: number; toString(): string };

const KUBO_COMPATIBLE = UnixFS.configure({
  fileChunkEncoder: raw,
  smallFileEncoder: raw,
  chunker: withMaxChunkSize(KUBO_CHUNK_BYTES),
  fileLayout: withWidth(KUBO_LINKS_PER_NODE),
});

interface DirectoryLink {
  name: string;
  cid: CidWithCodec;
}

export class UnixFsDatasetEncoder implements DatasetEncoder {
  async encodeDirectory(files: readonly DatasetFile[], carPath: string): Promise<DatasetEncoding> {
    const entries = await Promise.all(
      files.map(async (file) => {
        const blob = await openAsBlob(file.path);
        return { name: file.name, stream: () => blob.stream() };
      }),
    );
    const root = await lastCid(createDirectoryEncoderStream(entries, KUBO_COMPATIBLE));

    const directories = new Map<string, DirectoryLink[]>();
    await writeCar(
      createDirectoryEncoderStream(entries, KUBO_COMPATIBLE).pipeThrough(
        new TransformStream<Block, Block>({
          transform(block, controller) {
            const links = directoryLinks(block);
            if (links) directories.set(block.cid.toString(), links);
            controller.enqueue(block);
          },
        }),
      ),
      root,
      carPath,
    );

    const filesByName = new Map(files.map((file) => [file.name, file]));
    const objects = await describeTree(root.toString(), "", directories, filesByName);
    return {
      root: root.toString(),
      objects,
      car: { name: basename(carPath), ...(await digest(carPath)) },
    };
  }

  async encodeFile(file: DatasetFile, carPath: string): Promise<EncodedFile> {
    const blob = await openAsBlob(file.path);
    const root = await lastCid(createFileEncoderStream(blob, KUBO_COMPATIBLE));
    await writeCar(createFileEncoderStream(blob, KUBO_COMPATIBLE), root, carPath);
    return {
      object: {
        name: file.name,
        cid: root.toString(),
        kind: ArtifactKind.File,
        codec: codecOf(root),
        ...(await digest(file.path)),
      },
      car: { path: carPath, ...(await digest(carPath)) },
    };
  }
}

async function describeTree(
  directoryCid: string,
  prefix: string,
  directories: ReadonlyMap<string, DirectoryLink[]>,
  files: ReadonlyMap<string, DatasetFile>,
): Promise<ArtifactObject[]> {
  const objects: ArtifactObject[] = [];
  for (const link of directories.get(directoryCid) ?? []) {
    const name = prefix ? `${prefix}${PATH_SEPARATOR}${link.name}` : link.name;
    const cid = link.cid.toString();
    if (directories.has(cid)) {
      const children = await describeTree(cid, name, directories, files);
      const size = children
        .filter((child) => child.kind === ArtifactKind.File)
        .reduce((total, child) => total + child.size, 0);
      objects.push(
        { name, cid, kind: ArtifactKind.Directory, codec: ArtifactCodec.DagPb, size },
        ...children,
      );
      continue;
    }
    const file = files.get(name);
    if (!file) throw new Error(`The encoded dataset holds ${name}, which was not an input file`);
    objects.push({
      name,
      cid,
      kind: ArtifactKind.File,
      codec: codecOf(link.cid),
      ...(await digest(file.path)),
    });
  }
  return objects;
}

function directoryLinks(block: Block): DirectoryLink[] | undefined {
  if (block.cid.code !== dagPb.code) return undefined;
  const node = dagPb.decode(block.bytes);
  const named = node.Links.length > 0 && node.Links.every((link) => Boolean(link.Name));
  return named ? node.Links.map((link) => ({ name: link.Name ?? "", cid: link.Hash })) : undefined;
}

function codecOf(cid: CidWithCodec): ArtifactCodec {
  return cid.code === raw.code ? ArtifactCodec.Raw : ArtifactCodec.DagPb;
}

async function lastCid(blocks: ReadableStream<Block>): Promise<BlockCid> {
  let last: BlockCid | undefined;
  await blocks.pipeTo(
    new WritableStream({
      write(block) {
        last = block.cid;
      },
    }),
  );
  if (!last) throw new Error("UnixFS encoding produced no blocks");
  return last;
}

async function writeCar(
  blocks: ReadableStream<Block>,
  root: BlockCid,
  carPath: string,
): Promise<void> {
  await mkdir(dirname(carPath), { recursive: true });
  await blocks
    .pipeThrough(new CAREncoderStream([root]))
    .pipeTo(Writable.toWeb(createWriteStream(carPath)) as WritableStream<Uint8Array>);
}

async function digest(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { size: (await stat(path)).size, sha256: hash.digest("hex") };
}
