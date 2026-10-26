// A-14 T001 (shared pre-task): a convenience barrel over apps/api/src/engine/*.ts (duckdb-node.ts,
// s3-read.ts, duckdb-instance.ts). DuckDB stays wired only under apps/*/src/engine/** (ARD § 4,
// AD-19's no-restricted-imports guard) — a promotion to a top-level package was tried and
// reverted, since both the MCP and agent Lambdas are entry points bundled from this same
// apps/api app, not a separate app, so this directory already is the one shared query layer.
// Callers still mostly import the individual files directly (routers/*.ts, handlers/*.ts).
export * from "./duckdb-instance.js";
export * from "./duckdb-node.js";
export * from "./s3-read.js";
