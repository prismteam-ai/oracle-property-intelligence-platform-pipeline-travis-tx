const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32Decode(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let position = offset;
  for (;;) {
    const byte = bytes[position];
    if (byte === undefined) throw new Error('truncated varint');
    result |= (byte & 0x7f) << shift;
    position += 1;
    if ((byte & 0x80) === 0) return [result, position];
    shift += 7;
  }
}

export interface ParsedCid {
  version: number;
  /** Multicodec code: 0x55 raw, 0x70 dag-pb, 0x71 dag-cbor, 0x0129 dag-json. */
  codec: number;
  /** Multihash function code: 0x12 is sha2-256. */
  hashCode: number;
  digest: Uint8Array;
}

/** Parses a base32 (`b…`) CIDv1; the explorer only handles the CIDs the pipeline publishes. */
export function parseCid(cid: string): ParsedCid {
  if (!cid.startsWith('b')) throw new Error(`unsupported multibase prefix in ${cid}`);
  const bytes = base32Decode(cid.slice(1));
  const [version, afterVersion] = readVarint(bytes, 0);
  if (version !== 1) throw new Error(`unsupported CID version ${version}`);
  const [codec, afterCodec] = readVarint(bytes, afterVersion);
  const [hashCode, afterHash] = readVarint(bytes, afterCodec);
  const [length, afterLength] = readVarint(bytes, afterHash);
  const digest = bytes.slice(afterLength, afterLength + length);
  if (digest.length !== length) throw new Error('truncated multihash');
  return { version, codec, hashCode, digest };
}

export const SHA2_256 = 0x12;
export const CODEC_RAW = 0x55;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The sha2-256 digest in the CID's multihash as hex, or null for another hash function. */
export function multihashSha256Hex(cid: string): string | null {
  const parsed = parseCid(cid);
  return parsed.hashCode === SHA2_256 ? toHex(parsed.digest) : null;
}
