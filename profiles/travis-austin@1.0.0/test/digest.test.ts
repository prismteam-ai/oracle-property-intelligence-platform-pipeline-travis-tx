// T015: profile digest (research R-07, AD-26).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE, RulesSchema, canonicalize, digest, digestOf, verifyDigest } from "../index.js";

const here = (p: string): string => new URL(`../${p}`, import.meta.url).pathname;
const rawRules = (): unknown => JSON.parse(readFileSync(here("rules.json"), "utf8"));
const committed = readFileSync(here("DIGEST"), "utf8").trim();

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;

describe("profile digest", () => {
  it("is SHA-256 of Zod-parsed, recursively key-sorted JSON plus a newline", () => {
    const canonical = JSON.stringify(sortKeys(RulesSchema.parse(rawRules()))) + "\n";
    expect(canonicalize(rawRules())).toBe(canonical);
    expect(digest()).toBe(createHash("sha256").update(canonical).digest("hex"));
  });

  it("equals the committed DIGEST and PROFILE.sha256", () => {
    expect(committed).toMatch(/^[0-9a-f]{64}$/);
    expect(digest()).toBe(committed);
    expect(PROFILE.sha256).toBe(committed);
    expect(verifyDigest(rawRules(), committed).ok).toBe(true);
  });

  it("key order in rules.json does not change the digest", () => {
    const r = rawRules() as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(r).reverse());
    expect(digestOf(reversed)).toBe(committed);
  });

  it("changing any rule without a version bump fails verification", () => {
    const r = structuredClone(rawRules()) as { roofing: { include: { terms: string[] } } };
    r.roofing.include.terms.push("NEW TERM");
    const v = verifyDigest(r, committed);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/version/);
  });

  it("name, version, package.json and directory agree", () => {
    const pkg = JSON.parse(readFileSync(here("package.json"), "utf8")) as { version: string };
    expect(PROFILE.name).toBe("travis-austin");
    expect(PROFILE.version).toBe(pkg.version);
    expect(here("")).toContain(`/${PROFILE.name}@${PROFILE.version}/`);
  });

  it("CHANGELOG records this version with its digest", () => {
    const log = readFileSync(here("CHANGELOG.md"), "utf8");
    expect(log).toContain(`## ${PROFILE.version}`);
    expect(log).toContain(committed);
  });

  it("expectations.json is outside the digest", () => {
    const before = digest();
    const exp = JSON.parse(readFileSync(here("expectations.json"), "utf8")) as {
      rules_sha256: string;
    };
    expect(exp.rules_sha256).toBe(before);
    expect(JSON.stringify(rawRules())).not.toContain("measured_at");
  });

  it("rejects unknown keys (strict schema)", () => {
    const r = { ...(rawRules() as object), extra: 1 };
    expect(() => RulesSchema.parse(r)).toThrow();
  });
});
