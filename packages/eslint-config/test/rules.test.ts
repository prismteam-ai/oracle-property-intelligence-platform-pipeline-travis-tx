// T080 (constitution V "No `any`"; ARD AD-26 "No Query DB connection string exists in
// `apps/` or `infra/`"): the shared ESLint config reports `@typescript-eslint/no-explicit-any`
// as an error in every workspace tree, and bans the database-engine / Query DB client imports
// (`pg`, `postgres`, `@elephant-xyz/query-db`) in `infra/**` exactly as it already does in
// `packages/*`, `apps/*` and `pipeline/publish`.
//
// Fixtures are in-test strings linted with ESLint's `Linter` against the config object the root
// `eslint.config.js` re-exports. Filenames are resolved from the repo root (`cwd`), so the
// config's `files` globs match the same way they do in a real `eslint .` run.
// Traceability: tasks.md maps T080 to TC-052 (build-time).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import config from "../index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const linter = new Linter({ cwd: REPO });

interface Report {
  ruleId: string | null;
  severity: number;
  message: string;
}

/** Lint `code` as if it were the repo file at `relPath`; returns the reported messages. */
function lint(relPath: string, code: string): Report[] {
  return linter
    .verify(code, config, { filename: resolve(REPO, relPath) })
    .map(({ ruleId, severity, message }) => ({ ruleId, severity, message }));
}

const ERROR = 2;
const ANY_FIXTURE = "const x: any = 1;\nexport { x };\n";
const PG_FIXTURE = "import pg from 'pg';\nexport { pg };\n";

/** One file per workspace tree the task names (apps/*, packages/*, pipeline/publish, infra, tests/e2e). */
const WORKSPACE_FILES = [
  "apps/web/src/x.ts",
  "apps/api/src/x.ts",
  "packages/shared/src/x.ts",
  "pipeline/publish/src/x.ts",
  "infra/src/x.ts",
  "tests/e2e/x.spec.ts",
];

describe("T080 shared ESLint rules (constitution V, AD-26)", () => {
  describe("@typescript-eslint/no-explicit-any is an error in every workspace tree", () => {
    it.each(WORKSPACE_FILES)("%s", (relPath) => {
      expect(lint(relPath, ANY_FIXTURE)).toContainEqual(
        expect.objectContaining({ ruleId: "@typescript-eslint/no-explicit-any", severity: ERROR }),
      );
    });
  });

  describe("engine and Query DB imports are banned in infra/** (AD-26)", () => {
    it("import pg from 'pg' in infra/src/x.ts is reported", () => {
      expect(lint("infra/src/x.ts", PG_FIXTURE)).toContainEqual(
        expect.objectContaining({ ruleId: "no-restricted-imports", severity: ERROR }),
      );
    });

    it.each(["postgres", "@elephant-xyz/query-db"])(
      "import from '%s' in infra/src/x.ts is reported",
      (moduleName) => {
        const fixture = `import client from "${moduleName}";\nexport { client };\n`;
        expect(lint("infra/src/x.ts", fixture)).toContainEqual(
          expect.objectContaining({ ruleId: "no-restricted-imports", severity: ERROR }),
        );
      },
    );

    it("the Query DB ban message says why (publish only elephant-cli output)", () => {
      const fixture = 'import { db } from "@elephant-xyz/query-db";\nexport { db };\n';
      const [report] = lint("infra/src/x.ts", fixture).filter(
        (r) => r.ruleId === "no-restricted-imports",
      );
      expect(report?.message).toContain("Query DB");
    });

    it("covers infra test files too, not only infra/src", () => {
      expect(lint("infra/test/stacks.test.ts", PG_FIXTURE)).toContainEqual(
        expect.objectContaining({ ruleId: "no-restricted-imports", severity: ERROR }),
      );
    });

    it.each(["packages/shared/src/x.ts", "apps/api/src/x.ts", "pipeline/publish/src/x.ts"])(
      "regression: the W1 ban still holds in %s",
      (relPath) => {
        expect(lint(relPath, PG_FIXTURE)).toContainEqual(
          expect.objectContaining({ ruleId: "no-restricted-imports", severity: ERROR }),
        );
      },
    );
  });

  describe("DuckDB imports in apps/web (AD-19; ERR-10)", () => {
    const DUCKDB_FIXTURE =
      'import { createDuckDB } from "@duckdb/duckdb-wasm/blocking";\nexport { createDuckDB };\n';
    const restricted = (relPath: string): Report[] =>
      lint(relPath, DUCKDB_FIXTURE).filter((r) => r.ruleId === "no-restricted-imports");

    it("are banned in apps/web/src outside engine/", () => {
      expect(restricted("apps/web/src/routes/x.ts")).toHaveLength(1);
    });

    it("are allowed in apps/web/src/engine and in apps/web/test (real-engine conversion tests)", () => {
      expect(restricted("apps/web/src/engine/x.ts")).toEqual([]);
      expect(restricted("apps/web/test/x.test.ts")).toEqual([]);
    });

    it("apps/web/test still bans the AWS SDK", () => {
      const fixture = 'import { S3Client } from "@aws-sdk/client-s3";\nexport { S3Client };\n';
      expect(lint("apps/web/test/x.test.ts", fixture)).toContainEqual(
        expect.objectContaining({ ruleId: "no-restricted-imports", severity: ERROR }),
      );
    });
  });

  it("a clean TypeScript file in infra/src reports nothing (fixtures parse; no false positives)", () => {
    expect(lint("infra/src/x.ts", "export const y: number = 1;\n")).toEqual([]);
  });
});
