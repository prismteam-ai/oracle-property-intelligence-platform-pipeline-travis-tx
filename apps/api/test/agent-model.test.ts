// A-14 T007 (agent-design.md § "ash" > getModel(); constitution VI): `getModel()` is the only
// `AI_PROVIDER` read site under apps/api/src/agent/, and no file in that directory may import a
// provider SDK directly. Provider identity is asserted on the resolved `LanguageModel`'s own
// `provider`/`modelId` fields (no network call — these are pure object constructors).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_GATEWAY_MODEL_ID,
  getModel,
} from "../src/agent/model.js";

describe("getModel (A-14 T007/T014)", () => {
  it("AI_PROVIDER=bedrock (default) returns a Bedrock-backed model at the eu. inference profile id", () => {
    const model = getModel({});
    expect(model.provider).toBe("amazon-bedrock");
    expect(model.modelId).toBe(DEFAULT_BEDROCK_MODEL_ID);
    expect(model.modelId).toMatch(/^eu\./);
  });

  it("AI_PROVIDER=bedrock explicit, with a BEDROCK_MODEL_ID override", () => {
    const model = getModel({
      AI_PROVIDER: "bedrock",
      BEDROCK_MODEL_ID: "eu.anthropic.claude-other",
    });
    expect(model.provider).toBe("amazon-bedrock");
    expect(model.modelId).toBe("eu.anthropic.claude-other");
  });

  it("AI_PROVIDER=gateway returns a Gateway-backed model", () => {
    const model = getModel({ AI_PROVIDER: "gateway" });
    expect(model.provider).toBe("gateway");
    expect(model.modelId).toBe(DEFAULT_GATEWAY_MODEL_ID);
  });

  it("AI_PROVIDER=gateway, with an AI_GATEWAY_MODEL_ID override", () => {
    const model = getModel({
      AI_PROVIDER: "gateway",
      AI_GATEWAY_MODEL_ID: "amazon/titan-embed-text-v2",
    });
    expect(model.provider).toBe("gateway");
    expect(model.modelId).toBe("amazon/titan-embed-text-v2");
  });

  it("an unknown AI_PROVIDER throws, naming the bad value (no silent fallback)", () => {
    expect(() => getModel({ AI_PROVIDER: "openai" })).toThrow(/AI_PROVIDER/);
    expect(() => getModel({ AI_PROVIDER: "openai" })).toThrow(/openai/);
  });

  it("region is never read or set here: no REGION-shaped key is ever consulted by getModel", () => {
    // getModel must behave identically regardless of AWS_REGION/CDK_DEFAULT_REGION — the
    // provider resolves region itself from the Lambda runtime (P0-18), never from this module.
    const withRegion = getModel({ AI_PROVIDER: "bedrock", AWS_REGION: "eu-north-1" });
    const withoutRegion = getModel({ AI_PROVIDER: "bedrock" });
    expect(withRegion.modelId).toBe(withoutRegion.modelId);
    expect(withRegion.provider).toBe(withoutRegion.provider);
  });
});

describe("apps/api/src/agent/**: no direct provider SDK import (constitution VI)", () => {
  const agentDir = fileURLToPath(new URL("../src/agent", import.meta.url));
  const FORBIDDEN = ["@aws-sdk/client-bedrock-runtime", "@anthropic-ai/sdk", "openai"];

  function listTsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listTsFiles(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  }

  it("no file under apps/api/src/agent/ imports a direct provider SDK", () => {
    const files = listTsFiles(agentDir);
    expect(files.length).toBeGreaterThan(0);
    const offenders: { file: string; forbidden: string }[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN) {
        // Matches static `import`/`export ... from` and dynamic `import(...)` of the package.
        const re = new RegExp(`from\\s+["']${forbidden}["']|import\\(\\s*["']${forbidden}["']`);
        if (re.test(text)) offenders.push({ file, forbidden });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("getModel() itself (model.ts) only imports ai / @ai-sdk/amazon-bedrock, never a raw provider SDK", () => {
    const modelTs = readFileSync(join(agentDir, "model.ts"), "utf8");
    for (const forbidden of FORBIDDEN) {
      const re = new RegExp(`from\\s+["']${forbidden}["']|import\\(\\s*["']${forbidden}["']`);
      expect(re.test(modelTs)).toBe(false);
    }
    expect(modelTs).toMatch(/from\s+["']@ai-sdk\/amazon-bedrock["']/);
    expect(modelTs).toMatch(/from\s+["']ai["']/);
  });
});
