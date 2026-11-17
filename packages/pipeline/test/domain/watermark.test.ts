import { describe, expect, it } from "vitest";
import { laterWatermark } from "../../src/domain/watermark.js";

describe("laterWatermark", () => {
  it("keeps the later of two dates", () => {
    expect(laterWatermark("2026-10-20", "2026-10-26")).toBe("2026-10-26");
    expect(laterWatermark("2026-10-26", "2026-10-20")).toBe("2026-10-26");
  });

  it("never moves backwards when a page has no dates", () => {
    expect(laterWatermark("2026-10-26", undefined)).toBe("2026-10-26");
  });

  it("starts from the first date seen", () => {
    expect(laterWatermark(undefined, "2026-10-26")).toBe("2026-10-26");
    expect(laterWatermark(undefined, undefined)).toBeUndefined();
  });
});
