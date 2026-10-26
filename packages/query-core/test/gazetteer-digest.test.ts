// T028 (A-02, AD-26 / research R-07): the committed gazetteer DIGEST matches its content.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAZETTEER, canonicalize } from "../gazetteer/travis-places@1.0.0/index.js";

const dir = new URL("../gazetteer/travis-places@1.0.0/", import.meta.url);
const read = (f: string): unknown => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

describe("travis-places@1.0.0 DIGEST", () => {
  it("canonicalize() follows RFC 8785 (sorted keys, no whitespace, ES number form)", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1e21, y: 0.1 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":0.1,"z":1e+21}}',
    );
    expect(canonicalize({ é: 1, e: 2 })).toBe('{"e":2,"é":1}');
  });

  it("DIGEST = sha256 of JCS({version, places, zctas, owner-area, sources})", () => {
    const body = {
      version: "travis-places@1.0.0",
      places: read("places.json"),
      zctas: read("zctas.json"),
      "owner-area": read("owner-area.json"),
      sources: read("sources.json"),
    };
    const recomputed = createHash("sha256").update(canonicalize(body), "utf8").digest("hex");
    const committed = readFileSync(new URL("DIGEST", dir), "utf8").trim();
    expect(committed).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputed).toBe(committed);
    expect(GAZETTEER.sha256).toBe(committed);
  });

  it("sources.json stamps every Census file with url, Last-Modified, retrieved_at, bytes and sha256", () => {
    const sources = read("sources.json") as Array<Record<string, unknown>>;
    const urls = sources.map((s) => s["url"]);
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("2024_Gaz_place_national.zip"),
        expect.stringContaining("2024_Gaz_zcta_national.zip"),
        expect.stringContaining("tab20_zcta520_county20_natl.txt"),
        expect.stringContaining("st48_tx_place_by_county2020.txt"),
      ]),
    );
    for (const s of sources) {
      expect(s["url"]).toMatch(/^https:\/\/www2\.census\.gov\//);
      expect(typeof s["last_modified"]).toBe("string");
      expect(Number.isNaN(Date.parse(String(s["last_modified"])))).toBe(false);
      expect(Number.isNaN(Date.parse(String(s["retrieved_at"])))).toBe(false);
      expect(Number.isInteger(s["bytes"]) && (s["bytes"] as number) > 0).toBe(true);
      expect(s["sha256"]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
