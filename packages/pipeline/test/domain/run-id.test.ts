import { describe, expect, it } from "vitest";
import { runIdAt } from "../../src/domain/run-id.js";

describe("runIdAt", () => {
  it("is a sortable UTC timestamp without separators or milliseconds", () => {
    expect(runIdAt(new Date("2026-10-27T06:30:05.123Z"))).toBe("20261027T063005Z");
  });
});
