// Public API of @countylens/query-core (A-02): bind the contract/v1 views to a run manifest over
// any QueryEngine, plus the derivation functions the views use. A-03 adds the query builders
// (builders.ts), the read-path bench stand-ins (bench-sql.ts) and the generated constants that make
// every module here browser-safe (no node: import; test/browser-safe.test.ts). A-13 adds the
// Explore search builder (explore.ts) and the place resolver (places.ts).
export type { QueryEngine, Row } from "./engine.js";
export * from "./builders.js";
export * from "./explore.js";
// A-16: the read-side "no contractor printed" reason remap (the web's Permits page can use it).
export * from "./contractor-gaps.js";
export * from "./places.js";
export * from "./bench-sql.js";
export { GAZETTEER_SHA256 } from "./sql.generated.js";
export {
  REQUIRED_TABLES,
  TRAVIS_GROUP_SOURCES,
  bindManifest,
  boundPartNames,
  resolveBatchGroups,
  tablesForViews,
  type BindOptions,
  type BoundRun,
  type BoundTable,
  type RequiredTable,
} from "./bind-manifest.js";
export * from "./carrier-emission.js";
export * as derive from "./derive.js";
export { rawCid } from "./raw-cid.js";
export { SAMPLE_RULE, SAMPLE_SIZE, sampleSql } from "./sample.js";
export { STATUS_MAP_SQL, VIEWS_SQL } from "./sql.js";
export {
  CONTRACT_VIEWS,
  VIEW_STATEMENTS,
  planViews,
  viewsReadBy,
  type ContractView,
  type ViewPlan,
  type ViewStatement,
} from "./view-plan.js";
export * as gazetteer from "../gazetteer/travis-places@1.0.0/index.js";
// T002/T011/T011a/T012/T013 (A-14): the agent/MCP tool layer (Zod input schemas, the six
// functions and geocodePlace) and the new permit-level builder.
export * from "./tools/index.js";
export * from "./permits.js";
// permits.ts and explore.ts both define DAYS_PER_YEAR (365.25); re-export one explicitly.
export { DAYS_PER_YEAR } from "./permits.js";
