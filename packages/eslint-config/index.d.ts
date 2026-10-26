// Type surface of the shared flat config (index.js is plain ESM so ESLint loads it without a
// build step). `test/rules.test.ts` and the root tsconfig typecheck against this declaration.
import type { Linter } from "eslint";

declare const config: Linter.Config[];
export default config;
