// CR-A-03 N-2: the local binder reaches query-core through a declared workspace dependency, never
// through a relative path into another package, so a filtered install of @countylens/publish
// still resolves it (and DuckDB) from its own node_modules.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("N-2 local-bind dependencies are declared", () => {
  const pkg = JSON.parse(read("../package.json")) as { dependencies: Record<string, string> };
  const source = read("../scripts/local-bind.ts");

  it("package.json declares @countylens/query-core as a workspace dependency and @duckdb/node-api", () => {
    expect(pkg.dependencies["@countylens/query-core"]).toBe("workspace:*");
    expect(pkg.dependencies["@duckdb/node-api"]).toBeDefined();
  });

  it("local-bind.ts imports query-core by package name and never by a path into packages/", () => {
    expect(source).toMatch(/from "@countylens\/query-core"/);
    expect(source).not.toMatch(/from "[^"]*packages\//);
  });
});
