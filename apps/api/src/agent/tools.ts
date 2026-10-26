// T021 (A-14, agent-design.md § 8 "ash", § 9 "same definitions, or separate thin adapters");
// data-model.md § "agent.ask contract"): four camelCase AI SDK tools, thin adapters wired to
// packages/query-core's real functions (T011/T011a, G-1) — all four real, never stubbed, per
// /speckit-analyze finding F1. These are agent-only concerns layered over the shared query-core
// schemas: the model reads a compact (<=25-row) projection carrying each row's citation index
// `n` (so it cites `[n]`, never a CID it must invent), while EVERY row the tools return this turn
// (up to the 1,000-row cap, T035) is registered in the per-request citation registry
// (citations.ts, T019), so the server-built `matches[]` is complete. The MCP server's six tools
// (apps/api/src/mcp/tools.ts, oracle's G-3) are a separate set of thin adapters over the same
// query-core functions/schemas — not these tool objects — because the MCP contract needs full
// (<=1,000-row) envelopes with snake_case names (AD-21), which would blow the agent's token
// budget.
// A-16 (AC-13, A14-5): a tool whose run has no usable Explore index returns
// `{ error: index_not_built | index_stale, message }` instead of throwing; the out-of-area filter on
// a run with no owner area adds `owner_area: { status: "not_published" }`; and a fifth tool,
// `declareUnpublished`, lets the model state which asked-for fields the export does not carry, so
// ask.ts builds missing[] from tool results instead of the question's wording.
import { tool } from "ai";
import { z } from "zod";
import {
  GetPropertyInput,
  ListPermitsInput,
  SearchPropertiesInput,
  geocodePlace as geocodePlaceFn,
  getProperty as getPropertyFn,
  listPermits as listPermitsFn,
  searchProperties as searchPropertiesFn,
  type BoundRun,
  type QueryEngine,
  type ResultEnvelope,
  type Row,
} from "@countylens/query-core";
import { isIndexUnavailable } from "../engine/explore-index.js";
import { raceAbort } from "./abort.js";
import { UNPUBLISHED_FIELDS, type CitationRegistry, type UnpublishedField } from "./citations.js";

/** Same notice as explore.search and MCP search_properties. */
export const OWNER_AREA_NOTICE = {
  status: "not_published",
  reason: "owner_area_not_published",
  message: "owner area not published in this run",
} as const;

/** Index errors become a tool result the model and ask.ts can read; anything else still throws. */
async function indexSafe(
  run: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return await run();
  } catch (error) {
    if (isIndexUnavailable(error)) return { error: error.reason, message: error.message };
    throw error;
  }
}

/** Rows the model sees per tool call (agent-design.md § 5): a compact projection, never the full
 *  row and never more than this many per call, so three tool calls over 1,000-row envelopes stay
 *  inside the 1,500-output-token budget. `matches[]` in the final response still carries every
 *  row the tools returned that satisfied the filters (query-core's `ResultEnvelope.rows`), not
 *  only these — recall is measured on the server-built `matches[]`, not on what the model read. */
export const MAX_PROJECTED_ROWS_PER_CALL = 25;

/** T035: the most rows one request registers (and so returns in `matches[]`). Equals the
 *  1,000-row `limit` cap of the search tools; rows past it are not registered and the tool output
 *  says `truncated`, which ask.ts turns into `missing {result, truncated}`. */
export const MAX_REGISTERED_ROWS = 1000;

export interface AgentToolsContext {
  readonly engine: QueryEngine;
  readonly bound: BoundRun;
  /** One registry per request (ask.ts creates it); every tool call in this turn shares it so a
   *  row returned twice keeps its first-seen citation index. */
  readonly registry: CitationRegistry;
  /** Registry cap override (tests); defaults to `MAX_REGISTERED_ROWS`. */
  readonly maxRegisteredRows?: number;
  /** Whether the bound run publishes any owner area (default: assumed published). */
  readonly ownerAreaPublished?: () => Promise<boolean>;
}

function projectProperty(n: number, row: Row): Record<string, unknown> {
  return {
    n,
    property_cid: row.cid,
    // Contract v1.2 publishes the situs text (Run 3.1: 441,940 of 441,961 properties).
    address: row.unnormalized_address ?? null,
    dist_mi: row.dist_mi,
    roof_age_years: row.roof_age_years,
    roof_age_basis: row.roof_age_basis,
    roof_age_confidence: row.roof_age_confidence,
    tenure_years: row.tenure_years,
    owner_is_out_of_area: row.owner_is_out_of_area,
  };
}

/** The model-facing permit fields. A-16: the printed contractor name and its BBB search link are
 *  included (the system prompt tells the model to report the name). */
export function projectPermit(n: number, row: Row): Record<string, unknown> {
  return {
    n,
    property_cid: row.property_cid,
    permit_number: row.permit_number,
    status_class: row.status_class,
    open_days: row.open_days,
    open_years: row.open_years,
    dist_mi: row.dist_mi,
    contractor_resolution:
      typeof row.contractor === "object" && row.contractor !== null
        ? (row.contractor as Record<string, unknown>).resolution
        : undefined,
    contractor_name_as_printed: row.contractor_name_as_printed ?? null,
    bbb_url: row.bbb_url ?? null,
    bbb_status: row.bbb_status,
    bbb_status_reason: row.bbb_status_reason,
  };
}

/** Registers EVERY row of `envelope.rows` (keyed by the row's own `cid`, T019) up to
 *  `maxRegisteredRows` for the whole request, and returns the compact projection of the first
 *  `MAX_PROJECTED_ROWS_PER_CALL` rows + the envelope metadata the model sees — never the full
 *  rows. Rows the registry has no room for make `truncated` true (honest, never silent). */
function projectEnvelope(
  envelope: ResultEnvelope<Row>,
  registry: CitationRegistry,
  project: (n: number, row: Row) => Record<string, unknown>,
  maxRegisteredRows: number,
): Record<string, unknown> {
  const matches: Record<string, unknown>[] = [];
  let droppedByRegistry = false;
  for (const [index, row] of envelope.rows.entries()) {
    const cid = String(row.cid);
    if (!registry.has(cid) && registry.size() >= maxRegisteredRows) {
      droppedByRegistry = true;
      continue;
    }
    const n = registry.register({ ...row, cid });
    if (index < MAX_PROJECTED_ROWS_PER_CALL) matches.push(project(n, row));
  }
  return {
    matches,
    returned: envelope.returned,
    total: envelope.total,
    truncated: envelope.truncated || droppedByRegistry,
    empty_reason: envelope.empty_reason,
    unknown_excluded: envelope.unknown_excluded,
    area: envelope.area,
    applied: envelope.applied,
  };
}

/** Builds the four agent tools over one bound run + one citation registry (one per request). */
export function createAgentTools(ctx: AgentToolsContext) {
  const { engine, bound, registry } = ctx;
  const cap = ctx.maxRegisteredRows ?? MAX_REGISTERED_ROWS;

  const geocodePlace = tool({
    description:
      "Resolve a place name, ZIP/ZCTA or 7-digit GEOID to a point in or near Travis County, via " +
      "the Census 2024 Gazetteer. Exact match only -- a misspelling or anything outside Travis " +
      "County returns status 'out_of_scope', never a guessed point. searchProperties and " +
      "searchRoofingPermits accept an area place name directly and resolve it themselves, so " +
      "call this tool only to disambiguate a place or to check whether it is in scope.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(100) }),
    execute: async ({ query }, options) =>
      raceAbort(Promise.resolve(geocodePlaceFn({ query })), options?.abortSignal),
  });

  const searchProperties = tool({
    description:
      "Search properties within a radius of a place or point, filtered by roof age (at least N years), owner tenure (more than N years), an " +
      "out-of-area owner mailing address, or an open/stalled roofing permit. Returns a compact " +
      "list of matches, each carrying a citation index n -- cite rows in the answer as [n], " +
      "never invent a CID. unknown_excluded counts rows left out because a filtered field is " +
      "null (say 'unknown', never 'none', when that count is non-zero); empty_reason explains a " +
      "zero-row result (out_of_scope, no_match, or field_not_published).",
    // manifest_cid stays in the schema (ListPermitsInput/GetPropertyInput carry a `.refine()`
    // Zod cannot `.omit()` from, zod/v4/core/util.js "omit() cannot be used on object schemas
    // containing refinements"); the agent pins one run per conversation, so every execute()
    // below drops any manifest_cid the model supplies rather than trusting it.
    inputSchema: SearchPropertiesInput,
    execute: async (input, options) =>
      indexSafe(async () => {
        const envelope = await raceAbort(
          searchPropertiesFn(engine, bound, { ...input, manifest_cid: undefined }),
          options?.abortSignal,
        );
        const projected = projectEnvelope(envelope, registry, projectProperty, cap);
        if (
          input.owner_is_out_of_area === true &&
          ctx.ownerAreaPublished !== undefined &&
          !(await ctx.ownerAreaPublished())
        )
          return { ...projected, owner_area: OWNER_AREA_NOTICE };
        return projected;
      }),
  });

  const searchRoofingPermits = tool({
    description:
      "List roofing permits (replacement roofs), optionally within a radius of a place, " +
      "filtered by status (open, stalled, closed), minimum years open, or an exact permit " +
      "number (format 'YYYY-NNNNNN XX'). Omitting the area searches county-wide; with an area, " +
      "radius_mi is required (use 5 when the user names none). Returns a " +
      "compact list of matches, each carrying a citation index n -- cite rows as [n].",
    inputSchema: ListPermitsInput,
    execute: async (input, options) =>
      indexSafe(async () => {
        const envelope = await raceAbort(
          listPermitsFn(engine, bound, { ...input, manifest_cid: undefined }),
          options?.abortSignal,
        );
        return projectEnvelope(envelope, registry, projectPermit, cap);
      }),
  });

  const getProperty = tool({
    description:
      "Look up one property by its CID or by the TCAD parcel identifier exactly as printed, " +
      "including its roofing permits.",
    inputSchema: GetPropertyInput,
    execute: async (input, options) =>
      indexSafe(async () => {
        const envelope = await raceAbort(
          getPropertyFn(engine, bound, { ...input, manifest_cid: undefined }),
          options?.abortSignal,
        );
        return projectEnvelope(envelope, registry, projectProperty, cap);
      }),
  });

  const fields = Object.keys(UNPUBLISHED_FIELDS) as [UnpublishedField, ...UnpublishedField[]];
  const declareUnpublished = tool({
    description:
      "Declare which fields the question asks about that the published export does not carry: " +
      "owner_is_out_of_area (owners living outside the area / absentee owners: the owner's mailing " +
      "location is not published), bbb_status (BBB rating: BBB blocks automated lookups, so it was " +
      "not checked; a BBB search link is on each permit with a printed contractor). The contractor's printed name IS " +
      "published (contractor_name_as_printed on each permit row; empty when the permit prints none). Call it in the same step as your search whenever the question asks about any " +
      "of them; the answer then states they are not available.",
    inputSchema: z.object({ fields: z.array(z.enum(fields)).min(1).max(fields.length) }).strict(),
    execute: async ({ fields: asked }) => ({
      unpublished: [...new Set(asked)].map((field) => ({
        field,
        reason: UNPUBLISHED_FIELDS[field],
      })),
    }),
  });

  return { geocodePlace, searchProperties, searchRoofingPermits, getProperty, declareUnpublished };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
