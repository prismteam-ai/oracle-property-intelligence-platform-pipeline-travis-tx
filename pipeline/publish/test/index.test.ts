// CR-A-03 F-4: the package API offers no approval-free path. runPublish (phase 1 and phase 2
// with no D-8 approval) stays in sequence.ts for the order tests only; the gated publishRun and
// the phase-1-only runBuild are the public entry points.
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("@countylens/publish exports (CR-A-03 F-4)", () => {
  it("does not export runPublish, the 12-step path without the D-8 approval", () => {
    expect(api).not.toHaveProperty("runPublish");
  });

  it("does not export runUpload or executePlan, which upload a build no approval verified", () => {
    expect(api).not.toHaveProperty("runUpload");
    expect(api).not.toHaveProperty("executePlan");
  });

  it("exports the approval-gated publishRun, the build-only runBuild and the bind guard", () => {
    expect(typeof api.publishRun).toBe("function");
    expect(typeof api.runBuild).toBe("function");
    expect(typeof api.assertBindable).toBe("function");
  });
});
