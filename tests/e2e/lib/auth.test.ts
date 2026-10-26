// A-16 T039: the credential reader of lib/auth.ts is pure; it never needs a browser.
import { describe, expect, it } from "vitest";
import { parseEnvFile, readCredentials } from "./auth.js";

describe("parseEnvFile", () => {
  it("reads KEY=value lines, comments, export and quotes", () => {
    const out = parseEnvFile(
      ["# comment", "A=1", 'export B="two words"', "C='3'", "", "not a pair"].join("\n"),
    );
    expect(out).toEqual({ A: "1", B: "two words", C: "3" });
  });
});

describe("readCredentials", () => {
  it("returns undefined for an unset or half-set pair, so a spec skips with a reason", () => {
    expect(readCredentials({})).toEqual({ admin: undefined, nonAdmin: undefined });
    expect(readCredentials({ COUNTYLENS_TEST_USERNAME: "a@example.test" }).admin).toBeUndefined();
  });

  it("reads the admin and the non-admin pair by the frozen names", () => {
    const out = readCredentials({
      COUNTYLENS_TEST_USERNAME: "admin@example.test",
      COUNTYLENS_TEST_PASSWORD: "p1",
      COUNTYLENS_TEST_NONADMIN_USERNAME: "user@example.test",
      COUNTYLENS_TEST_NONADMIN_PASSWORD: "p2",
    });
    expect(out.admin).toEqual({ username: "admin@example.test", password: "p1" });
    expect(out.nonAdmin).toEqual({ username: "user@example.test", password: "p2" });
  });
});
