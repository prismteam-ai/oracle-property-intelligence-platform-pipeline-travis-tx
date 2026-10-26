// Minimal read-only ZIP access for the TCAD export (the download may be a .zip holding the
// JSON). Reads the central directory from the end of the file (ZIP64 aware) and streams
// one entry, inflating it on the fly; the archive is never loaded into memory.
import { closeSync, createReadStream, fstatSync, openSync, readSync } from "node:fs";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_COMMENT = 0xffff;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const n = readSync(fd, buf, 0, length, position);
  return buf.subarray(0, n);
}

function u64(buf: Buffer, offset: number): number {
  const v = buf.readBigUInt64LE(offset);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("zip: size above 2^53");
  return Number(v);
}

export function isZip(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const head = readAt(fd, 0, 4);
    return head.length === 4 && head.readUInt32LE(0) === LOCAL_SIG;
  } finally {
    closeSync(fd);
  }
}

export function listZipEntries(path: string): ZipEntry[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 22 + MAX_COMMENT + 20);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("zip: end of central directory not found");
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    const locator = eocd - 20;
    if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR_SIG) {
      const zip64Offset = u64(tail, locator + 8);
      const rec = readAt(fd, zip64Offset, 56);
      if (rec.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw new Error("zip: bad ZIP64 record");
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }
    const cd = readAt(fd, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i += 1) {
      if (cd.readUInt32LE(p) !== CENTRAL_SIG) throw new Error("zip: bad central directory");
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let uncompressedSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localHeaderOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      // ZIP64 extended information extra field (id 0x0001): only the saturated fields follow.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = u64(cd, q);
            q += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = u64(cd, q);
            q += 8;
          }
          if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, q);
        }
        e += 4 + len;
      }
      entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
      p = extraEnd + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/**
 * A readable stream of one entry's uncompressed bytes (stored or deflated only). Destroying
 * the returned stream also destroys the underlying file stream (CR-7: an early exit, as in
 * a record-path probe, must not leak the file descriptor). An entry with no stored bytes
 * streams nothing (CR-10).
 */
export function openZipEntry(path: string, entry: ZipEntry): Readable {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`zip: entry ${entry.name} uses unsupported method ${entry.method}`);
  }
  const fd = openSync(path, "r");
  let dataStart: number;
  try {
    const local = readAt(fd, entry.localHeaderOffset, 30);
    if (local.readUInt32LE(0) !== LOCAL_SIG) throw new Error("zip: bad local header");
    dataStart = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    closeSync(fd);
  }
  // createReadStream's `end` is inclusive, so a zero-length range cannot be expressed.
  if (entry.compressedSize === 0) return Readable.from([]);
  const raw = createReadStream(path, {
    start: dataStart,
    end: dataStart + entry.compressedSize - 1,
  });
  if (entry.method === 0) return raw;
  const inflate = createInflateRaw();
  raw.on("error", (err) => inflate.destroy(err));
  inflate.once("close", () => raw.destroy());
  return raw.pipe(inflate);
}
