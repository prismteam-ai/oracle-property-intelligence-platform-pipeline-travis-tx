import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { CarWriter } from "@ipld/car/writer";
import { importer, type ImportCandidate } from "ipfs-unixfs-importer";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

export const CID_PROFILE = "unixfs-v1-2025" as const;

export type DagEntry = {
  path: string;
  cid: string;
  codec: "file" | "directory";
  size: number;
  sha256?: string;
};

export type CarBuildResult = {
  rootCid: string;
  carPath: string;
  carBytes: number;
  carSha256: string;
  blocks: number;
  entries: DagEntry[];
};

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
}

export async function sha256File(file: string): Promise<{ sha256: string; size: number }> {
  const h = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    h.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: h.digest("hex"), size };
}

export async function buildCar(
  sourceDir: string,
  rootName: string,
  carPath: string,
): Promise<CarBuildResult> {
  const files = await listFiles(sourceDir);
  const placeholder = CID.createV1(0x70, await sha256.digest(raw.encode(new Uint8Array([0]))));
  const { writer, out } = CarWriter.create([placeholder]);
  const fh = await open(carPath, "w");
  let carBytes = 0;
  const drain = (async () => {
    for await (const chunk of out) {
      carBytes += chunk.length;
      await fh.write(chunk);
    }
  })();

  const seen = new Set<string>();
  let blocks = 0;
  const blockstore = {
    async put(cid: CID, bytes: Uint8Array) {
      const key = cid.toString();
      if (!seen.has(key)) {
        seen.add(key);
        blocks++;
        await writer.put({ cid, bytes });
      }
      return cid;
    },
  };

  async function* candidates(): AsyncGenerator<ImportCandidate> {
    for (const rel of files) {
      yield {
        path: `${rootName}/${rel}`,
        content: Readable.from(createReadStream(path.join(sourceDir, rel))),
      };
    }
  }

  const entries: DagEntry[] = [];
  let rootCid: CID | undefined;
  for await (const entry of importer(candidates(), blockstore, {
    profile: CID_PROFILE,
    cidVersion: 1,
    rawLeaves: true,
  })) {
    const isDir =
      entry.unixfs?.type === "directory" || entry.unixfs?.type === "hamt-sharded-directory";
    entries.push({
      path: entry.path ?? "",
      cid: entry.cid.toString(),
      codec: isDir ? "directory" : "file",
      size: Number(entry.size),
    });
    if (entry.path === rootName) rootCid = entry.cid;
  }
  await writer.close();
  await drain;
  if (!rootCid) throw new Error(`importer did not produce a root for ${rootName}`);
  await fh.close();

  const headerFd = await open(carPath, "r+");
  await CarWriter.updateRootsInFile(headerFd, [rootCid]);
  await headerFd.close();
  const finalDigest = await sha256File(carPath);

  for (const e of entries) {
    if (e.codec === "file") {
      const rel = e.path.slice(rootName.length + 1);
      const d = await sha256File(path.join(sourceDir, rel));
      e.sha256 = d.sha256;
      e.size = d.size;
    }
  }
  const carStat = await stat(carPath);
  if (carStat.size !== carBytes) throw new Error("CAR size mismatch after root update");
  return {
    rootCid: rootCid.toString(),
    carPath,
    carBytes,
    carSha256: finalDigest.sha256,
    blocks,
    entries,
  };
}
