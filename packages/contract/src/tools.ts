import { z } from 'zod';
import {
  EmptyInput,
  GetPropertyInput,
  SearchCentersQuery,
  businessSearchParams,
  licenseSearchParams,
  searchPermitsParams,
  searchPropertiesParams,
  textSearchParams,
} from './params.js';
import {
  BusinessRecord,
  Contractor,
  LicenseRecord,
  PermitDetail,
  PropertyDetail,
} from './records.js';
import {
  BusinessSearchResponse,
  LicenseSearchResponse,
  PermitSearchResponse,
  PermitTextSearchResponse,
  PropertySearchResponse,
  RunSummaryResponse,
  SearchCentersResponse,
} from './responses.js';
import { BusinessIdParam, LicenseIdParam, PermitIdParam, ContractorKeyParam } from './params.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18' as const;

export const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface ToolDef {
  name: string;
  /** Normative, frozen description (api-contract.md "MCP tools"). */
  description: string;
  equivalentRest: string;
  input: z.ZodType;
  output: z.ZodType;
  /** In the pipeline agent's tool list (adds search_businesses/search_licenses; has no get_business/get_license). */
  agent: boolean;
}

/** The single registry behind MCP tools/list, the agent's tools and the REST handlers' parameters. */
export const TOOLS: readonly ToolDef[] = [
  {
    name: 'resolve_search_center',
    equivalentRest: 'GET /v1/search-centers',
    agent: true,
    input: SearchCentersQuery,
    output: SearchCentersResponse,
    description:
      'Resolve a Travis County city, alias or ZIP to a centroid. Call it first when a question names a place; never pass coordinates it did not return or the user did not type.',
  },
  {
    name: 'search_properties',
    equivalentRest: 'GET /v1/properties/search',
    agent: true,
    input: searchPropertiesParams('mcp'),
    output: PropertySearchResponse,
    description:
      'Properties within a radius by roof age, open roofing permits and owner signals. `open_permits` is required: a property matches when its roof is older than `roof_age_min` **or**, if `open_permits` is true, it has an open or stalled roofing permit.',
  },
  {
    name: 'get_property',
    equivalentRest: 'GET /v1/properties/{id}',
    agent: true,
    input: GetPropertyInput,
    output: PropertyDetail,
    description:
      'One property with its permits. Takes exactly one of `property_id` or `geo_id`. Embeds at most 20 permits, roofing first, with `permits_total` and `permits_truncated`; page the rest with `search_permits` and `property_id`.',
  },
  {
    name: 'search_permits',
    equivalentRest: 'GET /v1/permits/search',
    agent: true,
    input: searchPermitsParams('mcp'),
    output: PermitSearchResponse,
    description:
      'Permits within a radius, or of one `property_id`, by status group, roofing class and years open, longest-open first.',
  },
  {
    name: 'search_permit_text',
    equivalentRest: 'GET /v1/permits/text-search',
    agent: true,
    input: textSearchParams('mcp'),
    output: PermitTextSearchResponse,
    description:
      'Free-text search over building-permit descriptions. A hit is roofing only if its `roof_work_class` is in the roofing set.',
  },
  {
    name: 'get_permit',
    equivalentRest: 'GET /v1/permits/{id}',
    agent: true,
    input: PermitIdParam,
    output: PermitDetail,
    description: 'One permit with its property, contractor attribution and BBB status.',
  },
  {
    name: 'get_contractor',
    equivalentRest: 'GET /v1/contractors/{key}',
    agent: true,
    input: ContractorKeyParam,
    output: Contractor,
    description:
      'Permits grouped under one printed contractor name and phone; an attribution, not a verified identity.',
  },
  {
    name: 'get_run_summary',
    equivalentRest: 'GET /v1/meta + GET /v1/runs',
    agent: true,
    input: EmptyInput,
    output: RunSummaryResponse,
    description: 'The current run, counts, group CIDs, deploy snapshot and limitations.',
  },
  {
    name: 'search_businesses',
    equivalentRest: 'GET /v1/businesses/search',
    agent: true,
    input: businessSearchParams('mcp'),
    output: BusinessSearchResponse,
    description:
      'Look up official Texas business records (Comptroller franchise-tax and sales-tax rows, SOS veteran-owned rows) by name or printed number. Each row is the official record of its own taxpayer, served from the source and not published by CID; a name hit is not a verified identity of a permit contractor or an owner.',
  },
  {
    name: 'get_business',
    equivalentRest: 'GET /v1/businesses/{id}',
    agent: false,
    input: BusinessIdParam,
    output: BusinessRecord,
    description: 'One business record with every printed field and its source provenance.',
  },
  {
    name: 'search_licenses',
    equivalentRest: 'GET /v1/licenses/search',
    agent: true,
    input: licenseSearchParams('mcp'),
    output: LicenseSearchResponse,
    description:
      'Look up license holders (TDLR electrical and air conditioning, TSBPE responsible master plumbers, City of Austin right-of-way contractors) by name or license number. Texas issues no roofing license, so most roofing contractors have none; a name hit is not a verified identity.',
  },
  {
    name: 'get_license',
    equivalentRest: 'GET /v1/licenses/{id}',
    agent: false,
    input: LicenseIdParam,
    output: LicenseRecord,
    description: 'One license record with its printed fields and source provenance.',
  },
];

import { clean, componentSchemas, idOf, selfContained } from './jsonschema.js';

export interface McpToolListing {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: typeof TOOL_ANNOTATIONS;
}

/** The MCP `tools/list` payload, generated from the Zod registry (JSON Schema draft 2020-12, self-contained). */
export function mcpToolListing(): McpToolListing[] {
  const schemas = componentSchemas();
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: clean(
      z.toJSONSchema(t.input, { io: 'input', target: 'draft-2020-12', unrepresentable: 'any' }),
    ) as Record<string, unknown>,
    outputSchema: selfContained(idOf(t.output), schemas) as Record<string, unknown>,
    annotations: TOOL_ANNOTATIONS,
  }));
}

export const AGENT_TOOL_NAMES = TOOLS.filter((t) => t.agent).map((t) => t.name);
