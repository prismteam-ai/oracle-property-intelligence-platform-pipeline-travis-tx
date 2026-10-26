// A-04 T009: app.ts binds every services/workflows/*.ts that exports createService(restate),
// keeps TravisDiscovery, Loader and BackboneReport, and hands every file ONE Restate SDK.
// Nothing is served: buildServices only builds the definitions. Synthetic fixtures only.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { buildServices } from "../services/app.js";
import { seen } from "./fixtures/workflows/fake-backbone.js";

const WORKFLOWS = fileURLToPath(new URL("./fixtures/workflows/", import.meta.url));
const SECTIONS = fileURLToPath(new URL("./fixtures/report-sections/", import.meta.url));
const TRACKS = fileURLToPath(new URL("./fixtures/tracks/", import.meta.url));

const names = (defs: ReadonlyArray<{ name: string }>) => defs.map((d) => d.name).sort();

describe("A-04 app registration", () => {
  it("binds every workflow file exporting createService, plus TravisDiscovery, Loader and BackboneReport", async () => {
    const defs = await buildServices({ workflowsDir: WORKFLOWS, tracksDir: TRACKS, sectionsDir: SECTIONS });
    expect(names(defs)).toEqual(["BackboneReport", "FakeBackbone", "Loader", "TravisDiscovery"]);
  });

  it("with no workflows directory the A-01 and shared services stay bound", async () => {
    const defs = await buildServices({
      workflowsDir: `${WORKFLOWS}missing/`,
      tracksDir: TRACKS,
      sectionsDir: SECTIONS,
    });
    expect(names(defs)).toEqual(["BackboneReport", "Loader", "TravisDiscovery"]);
  });

  it("hands each workflow file the one Restate SDK instance app.ts imports", async () => {
    seen.length = 0;
    await buildServices({ workflowsDir: WORKFLOWS, tracksDir: TRACKS, sectionsDir: SECTIONS });
    expect(seen.length).toBeGreaterThan(0);
    for (const sdk of seen) expect(sdk.workflow).toBe(restate.workflow);
  });

  it("services/workflows files import the SDK type-only (no second runtime instance)", () => {
    const dir = fileURLToPath(new URL("../services/workflows/", import.meta.url));
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    } catch {
      files = [];
    }
    for (const f of files) {
      const src = readFileSync(`${dir}${f}`, "utf8");
      expect(src, f).not.toMatch(/^import (?!type)[^;]*["']@restatedev\/restate-sdk["']/m);
    }
  });

  it("app.ts serves only when run as the entry point", () => {
    const src = readFileSync(new URL("../services/app.ts", import.meta.url), "utf8");
    expect(src).toMatch(/restate\.serve\(/);
    expect(src).toMatch(/isEntryPoint/);
  });
});
