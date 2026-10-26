// T043: checker rule 9 (contracts/catalog.md): no string anywhere in the catalog holds a
// postgres:// URL, a token value or an absolute home path. Synthetic catalogs only.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { checkCatalog, main } from "../travis/discovery/check-catalog.js";
import { syntheticUs1Catalog } from "./fixtures/synthetic-us1-catalog.js";

type Json = Record<string, unknown>;

function cat(): Json {
  return structuredClone(syntheticUs1Catalog()) as unknown as Json;
}
function austin(c: Json): Json {
  return (c.sources as Json[]).find((s) => s.key === "austin_permits") as Json;
}
function rule9(c: unknown, secrets: readonly string[] = []): string[] {
  return checkCatalog(c, { secrets }).filter((l) => l.startsWith("FAIL rule 9:"));
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("T043 checker rule 9: catalog hygiene", () => {
  it("a clean catalog has no rule 9 failure", () => {
    expect(rule9(cat())).toEqual([]);
  });

  it.each([
    ["a postgres:// URL", "postgres://user@localhost:5432/elephant"],
    ["a postgresql:// URL", "postgresql://localhost/elephant"],
    ["credentials in a URL", "https://user:pw@example.test/x"],
    ["a Socrata app token in a query", "https://example.test/r.json?$$app_token=abc123"],
    ["an X-App-Token header value", "X-App-Token: abc123"],
    ["a bearer token", "Authorization: Bearer abc.def.ghi"],
    ["a macOS home path", "/Users/someone/repo/file"],
    ["a Linux home path", "/home/someone/repo/file"],
    ["a DATABASE_URL name", "DATABASE_URL was read"],
    ["a password assignment", "password=hunter2"],
  ])("fails on %s and names the path, never the value", (_label, bad) => {
    const c = cat();
    austin(c).notes = bad;
    const lines = rule9(c);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^FAIL rule 9: sources\[austin_permits\]\.notes contains /);
    expect(lines[0]).not.toContain(bad);
  });

  it("walks nested values and lists (a blocked evidence path)", () => {
    const c = cat();
    const tcad = (c.sources as Json[]).find((s) => s.key === "tcad_certified") as Json;
    tcad.blocked_evidence = {
      ...(tcad.blocked_evidence as Json),
      evidence_path: "/Users/someone/evidence.md",
    };
    expect(rule9(c)).toEqual([
      expect.stringMatching(
        /^FAIL rule 9: sources\[tcad_certified\]\.blocked_evidence\.evidence_path contains /,
      ),
    ]);
  });

  it("fails when a registered secret value appears verbatim (for example the Socrata token)", () => {
    const c = cat();
    austin(c).anti_bot = "used token s3cr3t-token-value";
    const lines = rule9(c, ["s3cr3t-token-value"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("s3cr3t-token-value");
  });

  it("main() checks the SOCRATA_APP_TOKEN value from the environment and prints rules 1-11 on PASS", () => {
    const d = mkdtempSync(join(tmpdir(), "hygiene-"));
    tmpDirs.push(d);
    const clean = join(d, "clean.yaml");
    writeFileSync(clean, stringify(cat()));
    const out: string[] = [];
    expect(main([clean], (l) => out.push(l), { SOCRATA_APP_TOKEN: "env-token-xyz" })).toBe(0);
    expect(out.join("\n")).toMatch(/PASS check-catalog rules 1-11/);

    const dirty = cat();
    austin(dirty).notes = "token env-token-xyz";
    const path = join(d, "dirty.yaml");
    writeFileSync(path, stringify(dirty));
    const out2: string[] = [];
    expect(main([path], (l) => out2.push(l), { SOCRATA_APP_TOKEN: "env-token-xyz" })).toBe(1);
    expect(out2.some((l) => l.startsWith("FAIL rule 9:"))).toBe(true);
    expect(out2.join("\n")).not.toContain("env-token-xyz");
  });

  it.each([
    [
      "a /home/ segment in a records-request portal URL",
      "https://records.example.test/publicportal/home/newrequest",
    ],
    ["a /Users/ segment in an http URL", "http://example.test/Users/list"],
    ["a home segment in a URL inside prose", "file at https://example.test/a/home/b (checked)"],
  ])("does not fire on %s", (_label, url) => {
    const c = cat();
    austin(c).notes = url;
    expect(rule9(c)).toEqual([]);
  });

  it.each([
    ["a macOS home path after a URL", "https://example.test/x then /Users/someone/file"],
    ["a Linux home path in prose", "saved to /home/someone/out.json"],
    ["a Windows home path", "saved to C:\\Users\\someone\\out.json"],
    ["a file:// URL to a home path", "file:///Users/someone/out.json"],
  ])("still fails on %s outside an http(s) URL", (_label, bad) => {
    const c = cat();
    austin(c).notes = bad;
    expect(rule9(c)).toEqual([
      expect.stringMatching(
        /^FAIL rule 9: sources\[austin_permits\]\.notes contains an absolute home path/,
      ),
    ]);
  });
});
