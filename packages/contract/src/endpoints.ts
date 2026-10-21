import type { z } from 'zod';
import {
  BusinessIdParam,
  ContractorKeyParam,
  GeoIdParam,
  LicenseIdParam,
  PermitIdParam,
  PropertyIdParam,
  RunIdParam,
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
  Meta,
  PermitDetail,
  PropertyDetail,
} from './records.js';
import {
  BusinessSearchResponse,
  LicenseSearchResponse,
  ManifestResponse,
  OpenApiDocument,
  PermitSearchResponse,
  PermitTextSearchResponse,
  PropertySearchResponse,
  RunsResponse,
  SearchCentersResponse,
} from './responses.js';
import { ChatResponse, ChatRequest } from './chat.js';

export type Method = 'GET' | 'POST';
export interface Endpoint {
  operationId: string;
  method: Method;
  /** OpenAPI path template, e.g. `/v1/permits/{permit_id}`. */
  path: string;
  summary: string;
  tag: string;
  query?: z.ZodObject;
  pathParams?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  /** Extra non-2xx statuses beyond 429/5xx: 400 when params exist, 404 for by-id lookups, 413/503 for chat. */
  errors: readonly (400 | 404 | 413 | 503)[];
  /** `application/json` unless the response is another JSON payload served as-is. */
  rawJson?: boolean;
}

/**
 * Every REST operation. Lookup order matters for routers: literal segments
 * (`/v1/properties/search`, `/v1/properties/by-geo-id/{geo_id}`) are matched before
 * `/v1/properties/{property_id}`.
 */
export const ENDPOINTS: readonly Endpoint[] = [
  {
    operationId: 'getMeta',
    method: 'GET',
    path: '/v1/meta',
    summary: 'Run, counts, group CIDs, deploy snapshot, limitations and limits.',
    tag: 'run',
    response: Meta,
    errors: [],
  },
  {
    operationId: 'searchCenters',
    method: 'GET',
    path: '/v1/search-centers',
    summary: 'Resolve a city, alias or ZIP to a parcel-centroid search center.',
    tag: 'search',
    query: SearchCentersQuery,
    response: SearchCentersResponse,
    errors: [400],
  },
  {
    operationId: 'searchProperties',
    method: 'GET',
    path: '/v1/properties/search',
    summary: 'Properties by radius, roof age, open roofing permits and owner signals.',
    tag: 'properties',
    query: searchPropertiesParams('rest'),
    response: PropertySearchResponse,
    errors: [400],
  },
  {
    operationId: 'getPropertyByGeoId',
    method: 'GET',
    path: '/v1/properties/by-geo-id/{geo_id}',
    summary: 'One property by TCAD Geographic ID.',
    tag: 'properties',
    pathParams: GeoIdParam,
    response: PropertyDetail,
    errors: [404],
  },
  {
    operationId: 'getProperty',
    method: 'GET',
    path: '/v1/properties/{property_id}',
    summary: 'One property by TCAD PROP_ID with its permits.',
    tag: 'properties',
    pathParams: PropertyIdParam,
    response: PropertyDetail,
    errors: [404],
  },
  {
    operationId: 'searchPermits',
    method: 'GET',
    path: '/v1/permits/search',
    summary: 'Permits by radius, status group, roofing class and years open.',
    tag: 'permits',
    query: searchPermitsParams('rest'),
    response: PermitSearchResponse,
    errors: [400],
  },
  {
    operationId: 'searchPermitText',
    method: 'GET',
    path: '/v1/permits/text-search',
    summary: 'Full-text search over building-permit description, permit_class and work_class.',
    tag: 'permits',
    query: textSearchParams('rest'),
    response: PermitTextSearchResponse,
    errors: [400],
  },
  {
    operationId: 'getPermit',
    method: 'GET',
    path: '/v1/permits/{permit_id}',
    summary: 'One permit with its property, contractor attribution and BBB status.',
    tag: 'permits',
    pathParams: PermitIdParam,
    response: PermitDetail,
    errors: [404],
  },
  {
    operationId: 'getContractor',
    method: 'GET',
    path: '/v1/contractors/{contractor_attribution_key}',
    summary:
      'Permits grouped under one printed contractor name and phone; an attribution, not an identity.',
    tag: 'contractors',
    pathParams: ContractorKeyParam,
    response: Contractor,
    errors: [404],
  },
  {
    operationId: 'searchBusinesses',
    method: 'GET',
    path: '/v1/businesses/search',
    summary: 'Lookup in the official business records by name or printed number.',
    tag: 'businesses',
    query: businessSearchParams('rest'),
    response: BusinessSearchResponse,
    errors: [400],
  },
  {
    operationId: 'getBusiness',
    method: 'GET',
    path: '/v1/businesses/{business_record_id}',
    summary: 'One business record.',
    tag: 'businesses',
    pathParams: BusinessIdParam,
    response: BusinessRecord,
    errors: [404],
  },
  {
    operationId: 'searchLicenses',
    method: 'GET',
    path: '/v1/licenses/search',
    summary: 'Lookup in the license records by name or license number.',
    tag: 'licenses',
    query: licenseSearchParams('rest'),
    response: LicenseSearchResponse,
    errors: [400],
  },
  {
    operationId: 'getLicense',
    method: 'GET',
    path: '/v1/licenses/{license_record_id}',
    summary: 'One license record.',
    tag: 'licenses',
    pathParams: LicenseIdParam,
    response: LicenseRecord,
    errors: [404],
  },
  {
    operationId: 'listRuns',
    method: 'GET',
    path: '/v1/runs',
    summary: 'Every run that ever published, newest first, with its group roots.',
    tag: 'run',
    response: RunsResponse,
    errors: [],
  },
  {
    operationId: 'getRunManifest',
    method: 'GET',
    path: '/v1/runs/{run_id}/manifest',
    summary: "The run's artifact manifest JSON, served as the pinned bytes unchanged.",
    tag: 'run',
    pathParams: RunIdParam,
    response: ManifestResponse,
    errors: [404],
    rawJson: true,
  },
  {
    operationId: 'getOpenApi',
    method: 'GET',
    path: '/v1/openapi.json',
    summary: 'This document, served byte-identical to the committed openapi.json.',
    tag: 'run',
    response: OpenApiDocument,
    errors: [],
    rawJson: true,
  },
  {
    operationId: 'agentChat',
    method: 'POST',
    path: '/v1/agent/chat',
    summary: 'Stateless grounded chat over the v1 tools (Bedrock).',
    tag: 'agent',
    body: ChatRequest,
    response: ChatResponse,
    errors: [400, 413, 503],
  },
  {
    operationId: 'mcp',
    method: 'POST',
    path: '/v1/mcp',
    summary: 'MCP Streamable HTTP, stateless JSON responses, protocol revision 2025-06-18.',
    tag: 'mcp',
    response: ManifestResponse,
    errors: [400],
    rawJson: true,
  },
];
