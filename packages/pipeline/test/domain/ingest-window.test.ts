import { describe, expect, it } from "vitest";
import { WindowKind, windowAfter } from "../../src/domain/ingest-window.js";

describe("windowAfter", () => {
  it("asks for a full load when the source has never been ingested", () => {
    expect(windowAfter(undefined, 7)).toEqual({ kind: WindowKind.Full });
  });

  it("re-reads the lookback days before the watermark to catch late postings", () => {
    expect(windowAfter("2026-10-26", 7)).toEqual({ kind: WindowKind.Since, since: "2026-10-19" });
  });

  it("crosses month and year boundaries", () => {
    expect(windowAfter("2026-01-03", 7)).toEqual({ kind: WindowKind.Since, since: "2025-12-27" });
  });

  it("starts on the watermark itself when there is no lookback", () => {
    expect(windowAfter("2026-10-26", 0)).toEqual({ kind: WindowKind.Since, since: "2026-10-26" });
  });
});
