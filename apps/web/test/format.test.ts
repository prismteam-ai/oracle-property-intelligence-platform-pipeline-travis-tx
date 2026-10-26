// Display helpers (data/format): counts and byte sizes carry thousands separators (hosted review:
// "2,381,886", not "2381886"); exact values stay in data-* hooks on the pages.
import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, utcTimestamp } from "../src/data/format";

describe("format", () => {
  it("groups counts with en-US thousands separators", () => {
    expect(formatCount(2381886)).toBe("2,381,886");
    expect(formatCount(493246)).toBe("493,246");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(0)).toBe("0");
  });

  it("prints a byte size grouped, with its unit", () => {
    expect(formatBytes(103835)).toBe("103,835 bytes");
  });

  it("keeps a UTC ISO instant as published", () => {
    expect(utcTimestamp("2026-10-25T07:36:00.000Z")).toBe("2026-10-25T07:36:00.000Z");
  });
});
