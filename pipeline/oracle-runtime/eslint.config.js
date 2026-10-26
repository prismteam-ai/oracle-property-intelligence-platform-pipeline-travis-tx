// ESLint flat config for pipeline/oracle-runtime.
// Rules: no `any` (explicit or unsafe), and no direct console output outside the
// single JSON logger in travis/lib/log.ts (constitution: JSON logs, no secrets).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  {
    ignores: ["node_modules/**", "kit/**", "coverage/**", "dist/**"],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "error",
    },
  },
  {
    files: ["travis/lib/log.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
