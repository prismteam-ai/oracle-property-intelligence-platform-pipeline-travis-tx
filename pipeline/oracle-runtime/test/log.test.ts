// Supporting tests for T009 (JSON logger with redaction). Synthetic strings only.
import { describe, expect, it } from "vitest";
import { containsHomePath, createLogger, redact } from "../travis/lib/log.js";
import { must } from "./helpers.js";

describe("redact", () => {
  it("removes credentials from connection URLs", () => {
    const out = redact("db at postgres://pguser:pgpass@localhost:5432/elephant");
    expect(out).not.toContain("pgpass");
    expect(out).not.toContain("pguser");
    expect(out).toContain("[REDACTED]");
  });

  it("removes userinfo from http URLs", () => {
    expect(redact("https://alice:pw123@example.test/x")).toBe("https://[REDACTED]@example.test/x");
  });

  it("removes token-like query parameter values", () => {
    const out = redact("https://example.test/r.json?$$app_token=abc123&limit=5&api_key=k9");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("k9");
    expect(out).toContain("limit=5");
  });

  it("removes bearer tokens and explicitly registered secrets", () => {
    expect(redact("Authorization: Bearer eyJabc.def")).not.toContain("eyJabc.def");
    expect(redact("value is s3cr3t-value", ["s3cr3t-value"])).not.toContain("s3cr3t-value");
  });

  it("replaces absolute home paths", () => {
    expect(redact("/Users/someone/Github/repo/file.ts")).toBe("~/Github/repo/file.ts");
    expect(redact("/home/someone/x")).toBe("~/x");
  });
});

describe("createLogger", () => {
  it("writes one single-line JSON object per event with redacted fields", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    log.info("capture", { url: "https://u:p@example.test/a", nested: { path: "/Users/x/y" } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    const entry = JSON.parse(must(lines[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "info", event: "capture" });
    expect(typeof entry.ts).toBe("string");
    expect(lines[0]).not.toContain("u:p@");
    expect(lines[0]).not.toContain("/Users/x");
  });
});

describe("home-path detection outside URLs", () => {
  it("keeps a path segment inside an http(s) URL", () => {
    const url = "https://records.example.test/publicportal/home/newrequest";
    expect(containsHomePath(url)).toBe(false);
    expect(redact(`portal ${url}`)).toBe(`portal ${url}`);
  });

  it("still replaces real home paths, including Windows ones, next to a URL", () => {
    const text = "https://example.test/home/x and /Users/someone/a and C:\\Users\\someone\\b";
    expect(containsHomePath(text)).toBe(true);
    expect(redact(text)).toBe("https://example.test/home/x and ~/a and ~\\b");
  });
});
