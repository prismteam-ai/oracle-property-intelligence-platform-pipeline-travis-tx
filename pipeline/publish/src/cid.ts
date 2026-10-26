// Content addresses computed locally, the way the CLI and kubo compute them:
// UnixFS with cidVersion 1 and rawLeaves true (the default 256 KiB chunker and balanced
// layout), so a later `ipfs add --cid-version 1 --raw-leaves` of the same bytes agrees.
import { createReadStream } from "node:fs";
import { importer } from "ipfs-unixfs-importer";
import { CID } from "multiformats/cid";
import { equals } from "multiformats/bytes";

/** Blocks are hashed, never kept (the same sink the CLI's tables export uses). */
const sink = { put: async (cid: CID): Promise<CID> => cid };

const OPTIONS = { cidVersion: 1, rawLeaves: true } as const;

async function first(source: Parameters<typeof importer>[0]): Promise<string> {
  for await (const entry of importer(source, sink, OPTIONS)) return entry.cid.toString();
  throw new Error("importer produced no CID");
}

/** Raw-leaves CIDv1 of `bytes` (`bafkrei…` below one 256 KiB chunk). */
export async function cidOfBytes(bytes: Uint8Array): Promise<string> {
  return first([{ content: bytes }]);
}

/** Raw-leaves CIDv1 of a file, streamed. */
export async function cidOfFile(path: string): Promise<string> {
  return first([{ content: createReadStream(path) }]);
}

const CODECS: Record<number, string> = {
  0x55: "raw",
  0x70: "dag-pb",
  0x71: "dag-cbor",
  0x0129: "dag-json",
};

export function codecName(cid: string): string {
  const code = CID.parse(cid).code;
  return CODECS[code] ?? `0x${code.toString(16)}`;
}

/** True when two CIDs carry the same multihash, whatever their codec or version. */
export function sameDigest(a: string, b: string): boolean {
  return equals(CID.parse(a).multihash.bytes, CID.parse(b).multihash.bytes);
}
