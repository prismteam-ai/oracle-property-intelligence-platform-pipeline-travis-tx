// Raw-leaves CIDv1 of a byte string below one UnixFS chunk (256 KiB): base32 "b" + varint 1
// (CIDv1) + 0x55 (raw) + 0x12 0x20 (sha2-256, 32 bytes) + digest. It equals
// `ipfs add --cid-version 1 --raw-leaves` for such files (every pilot part and the manifest).
// Uses Web Crypto, so it runs in Node and the browser.

const CHUNK = 262_144;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The raw-leaves CIDv1 (`bafkrei…`) of `bytes`; throws above one chunk (that needs a UnixFS DAG). */
export async function rawCid(bytes: Uint8Array): Promise<string> {
  if (bytes.length > CHUNK) {
    throw new Error(`rawCid: ${bytes.length} bytes is more than one 256 KiB chunk`);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return `b${base32(new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]))}`;
}
