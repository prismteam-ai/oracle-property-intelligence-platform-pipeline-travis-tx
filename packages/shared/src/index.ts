// @countylens/shared: UI wording and read-path URL helpers shared by apps/web, apps/api and
// the scripts (plan.md § Project Structure). Browser-safe: no node: imports, no env reads.
export {
  ADDRESS_POINT_PROVENANCE_TEXT,
  BBB_SEARCH_LINK_LABEL,
  COORDINATE_SOURCE_LABELS,
  CONTRACTOR_NOT_PRINTED_LABEL,
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  MISSING_REASON_LABELS,
  PERMITS_PAGE_SIZE,
  PERMITS_TEXTS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  RUN_INDEX_TEXTS,
  assertMissingReasonLabels,
  isContractorField,
  missingLabel,
  missingReasonLabel,
  type CoverageLabelKey,
  type Derivation,
} from "./labels.js";
export { SOURCE_LABELS, isSourceName, sourceLabel, type SourceName } from "./sources.js";
export {
  INDEPENDENT_GATEWAYS,
  isIndependentGateway,
  readPathUrls,
  type GatewayName,
  type ReadPathHosts,
  type ReadPathUrls,
} from "./urls.js";
export {
  AI_TEXTS,
  MCP_TRY_TEXTS,
  COVERAGE_TEXTS,
  EXPLORE_TEXTS,
  PAGE_TEXTS,
  RUNS_TEXTS,
  VERIFY_TEXTS,
  shortHash,
  utcMinute,
  type SizeAndDigest,
} from "./texts.js";
export {
  EXPLORE_URL_PARAMS,
  ROUTES,
  comingSoonPath,
  verifyPath,
  type ExploreUrlParam,
  type RoutePath,
} from "./routes.js";
