// ERR-40: TC-073 allows the record CIDs the page itself received from explore.search, on top of the
// manifest-derived set; a prototype CID that no response carried must still be flagged.
import { describe, expect, it } from "vitest";
import { cidTokens, disallowedCidTokens, mergeResponseCids, truncateCid } from "./a13.js";

const record = `bafkrei${"a".repeat(52)}`;
const prototype = `bafybei${"q".repeat(52)}`;
const body = JSON.stringify({ result: { data: { rows: [{ property_cid: record, n: 3 }] } } });

describe("mergeResponseCids", () => {
  it("adds the CIDs found in response bodies and keeps the base set", () => {
    const base = new Set(["bafkreibase"]);
    const merged = mergeResponseCids(base, [body]);
    expect(merged.has(record)).toBe(true);
    expect(merged.has("bafkreibase")).toBe(true);
    expect(base.has(record)).toBe(false);
  });

  it("lets a record CID (full and truncated) pass, but a prototype CID still fails", () => {
    const merged = mergeResponseCids(new Set(), [body]);
    const text = `${record} ${truncateCid(record)} ${prototype} ${truncateCid(prototype)}`;
    expect(cidTokens(text)).toHaveLength(4);
    expect(disallowedCidTokens(text, merged)).toEqual([prototype, truncateCid(prototype)]);
  });

  it("ignores bodies without CIDs", () => {
    expect(mergeResponseCids(new Set(), ["{}", "not json"]).size).toBe(0);
  });
});
