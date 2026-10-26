// A-03-TC-060 at unit level (Vitest, `pnpm --filter @countylens/e2e test`): the guard helper
// and playwright.config.ts itself throw the two fixed texts (plan § "Fixed texts and config
// keys") and nothing else. The hosted case in config-guard.spec.ts spawns the real CLI.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RUNTIME_URL_UNSET_TEXT,
  assertHostedRuntimeUrl,
  runtimeUrlLocalhostText,
} from "./runtime-url.js";

const LOOPBACK_VALUES = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
  "https://localhost",
  "http://127.1.2.3:8080",
  "http://app.localhost:5173",
];

describe("A-03-TC-060: the RUNTIME_URL guard (helper)", () => {
  it.each(LOOPBACK_VALUES)("refuses %s with the exact localhost text", (value) => {
    expect(() => assertHostedRuntimeUrl(value)).toThrow(
      new Error(`RUNTIME_URL must be a hosted URL, not localhost: ${value}`),
    );
    expect(runtimeUrlLocalhostText(value)).toBe(
      `RUNTIME_URL must be a hosted URL, not localhost: ${value}`,
    );
  });

  it.each([undefined, "", "   "])(
    "refuses an unset or blank value (%j) with the exact unset text",
    (value) => {
      expect(() => assertHostedRuntimeUrl(value)).toThrow(
        new Error("RUNTIME_URL is not set; set it to the hosted URL"),
      );
      expect(RUNTIME_URL_UNSET_TEXT).toBe("RUNTIME_URL is not set; set it to the hosted URL");
    },
  );

  it("accepts a hosted URL and strips trailing slashes", () => {
    expect(assertHostedRuntimeUrl("https://003-walking-skeleton.d1abc.amplifyapp.com/")).toBe(
      "https://003-walking-skeleton.d1abc.amplifyapp.com",
    );
    expect(assertHostedRuntimeUrl("https://countylens.aldarraj.com")).toBe(
      "https://countylens.aldarraj.com",
    );
  });

  it("refuses a value that is not a URL with its own message", () => {
    expect(() => assertHostedRuntimeUrl("not a url")).toThrow(
      new Error("RUNTIME_URL is not a URL: not a url"),
    );
  });
});

describe("A-03-TC-060: playwright.config.ts throws at load", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(LOOPBACK_VALUES)("throws the exact localhost text for %s", async (value) => {
    vi.stubEnv("RUNTIME_URL", value);
    vi.resetModules();
    await expect(import("../playwright.config.js")).rejects.toThrow(
      new Error(`RUNTIME_URL must be a hosted URL, not localhost: ${value}`),
    );
  });

  it("throws the exact unset text when RUNTIME_URL is unset", async () => {
    vi.stubEnv("RUNTIME_URL", undefined);
    vi.resetModules();
    await expect(import("../playwright.config.js")).rejects.toThrow(
      new Error("RUNTIME_URL is not set; set it to the hosted URL"),
    );
  });

  it("throws the exact unset text when RUNTIME_URL is empty", async () => {
    vi.stubEnv("RUNTIME_URL", "");
    vi.resetModules();
    await expect(import("../playwright.config.js")).rejects.toThrow(
      new Error("RUNTIME_URL is not set; set it to the hosted URL"),
    );
  });

  it("loads for a hosted URL with baseURL set and the light colour scheme", async () => {
    vi.stubEnv("RUNTIME_URL", "https://example.invalid/");
    vi.resetModules();
    const config = (await import("../playwright.config.js")).default;
    expect(config.use?.baseURL).toBe("https://example.invalid");
    expect(config.use?.colorScheme).toBe("light");
  });
});
