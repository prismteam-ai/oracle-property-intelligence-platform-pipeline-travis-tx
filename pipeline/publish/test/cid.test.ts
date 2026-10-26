// T032: RFC 8785 JCS bytes, raw-leaves CIDv1 of bytes and files, and CID comparison by digest.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { cidOfBytes, cidOfFile, codecName, sameDigest } from "../src/cid.js";
import { jcs, jcsBytes } from "../src/jcs.js";

describe("jcs (RFC 8785)", () => {
  it("matches the RFC 8785 § 3.2.4 example", () => {
    const input = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], ' +
        '"string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}',
    );
    expect(jcs(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts keys by UTF-16 code units (RFC 8785 § 3.2.3 example)", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    // Read the keys from the text: JSON.parse would move the integer-like key "1" first.
    const keys = [...jcs(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    expect(keys).toEqual(["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"]);
  });

  it("serializes the RFC 8785 number vectors", () => {
    const cases: Array<[number, string]> = [
      [0, "0"],
      [-0, "0"],
      [5e-324, "5e-324"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
      [9007199254740992, "9007199254740992"],
      [1e21, "1e+21"],
      [1e23, "1e+23"],
      [0.000001, "0.000001"],
      [1e-7, "1e-7"],
    ];
    for (const [n, s] of cases) expect(jcs(n)).toBe(s);
  });

  it("has no insignificant whitespace, keeps array order and nests", () => {
    expect(jcs({ b: [3, 1, { d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[3,1,{"c":2,"d":1}]}');
  });

  it("rejects values JSON cannot carry", () => {
    expect(() => jcs(Number.NaN)).toThrow();
    expect(() => jcs(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => jcs({ a: undefined })).toThrow();
    expect(() => jcs(BigInt(1))).toThrow();
  });

  it("jcsBytes is the UTF-8 of jcs", () => {
    expect(Buffer.from(jcsBytes({ é: 1 })).toString("utf8")).toBe('{"é":1}');
  });
});

describe("cidOfBytes / cidOfFile", () => {
  it("is a raw-leaves CIDv1 (bafkrei…) below 256 KiB, equal to raw + sha2-256", async () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    const cid = await cidOfBytes(bytes);
    expect(cid.startsWith("bafkrei")).toBe(true);
    expect(cid).toBe(CID.createV1(raw.code, await sha256.digest(bytes)).toString());
  });

  it("is a dag-pb CIDv1 (bafybei…) above one 256 KiB chunk", async () => {
    const big = new Uint8Array(256 * 1024 + 1).fill(7);
    const cid = await cidOfBytes(big);
    expect(cid.startsWith("bafybei")).toBe(true);
    expect(codecName(cid)).toBe("dag-pb");
  });

  it("gives the same CID for a file and its bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cid-"));
    const file = join(dir, "part-00000.parquet");
    const bytes = new Uint8Array(300 * 1024).map((_, i) => i % 251);
    writeFileSync(file, bytes);
    expect(await cidOfFile(file)).toBe(await cidOfBytes(bytes));
  });
});

describe("sameDigest", () => {
  it("compares CIDs by multihash digest across raw, dag-pb and dag-json", async () => {
    const digest = await sha256.digest(new TextEncoder().encode("x"));
    const asRaw = CID.createV1(0x55, digest).toString();
    const asDagPb = CID.createV1(0x70, digest).toString();
    const asDagJson = CID.createV1(0x0129, digest).toString();
    expect(asRaw).not.toBe(asDagJson);
    expect(sameDigest(asRaw, asDagPb)).toBe(true);
    expect(sameDigest(asRaw, asDagJson)).toBe(true);
    const other = CID.createV1(0x55, await sha256.digest(new TextEncoder().encode("y"))).toString();
    expect(sameDigest(asRaw, other)).toBe(false);
  });

  it("names codecs", () => {
    expect(codecName("bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu")).toBe("raw");
  });
});
