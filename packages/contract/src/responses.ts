import { z } from 'zod';
import {
  BusinessRecord,
  LicenseRecord,
  Meta,
  PermitSummary,
  PropertySummary,
  Run,
} from './records.js';
import { def, int, nstr, obj } from './shared.js';

const page = <T extends z.ZodType>(item: T) => ({
  items: z.array(item),
  total: int.describe('Exact count of matches.'),
  next_cursor: nstr,
  area_note: nstr.describe('For example "outside Travis County"; null otherwise.'),
});

export const SearchCenter = def(
  'SearchCenter',
  obj({
    name: z.string(),
    kind: z.enum(['city', 'zip']),
    match_type: z.enum(['exact', 'prefix', 'alias']),
    lat: z.number(),
    lon: z.number(),
    parcel_count: int,
    basis: z.string(),
  }),
);
export const SearchCentersResponse = def(
  'SearchCentersResponse',
  obj({ items: z.array(SearchCenter) }),
);
export const PropertySearchResponse = def('PropertySearchResponse', obj(page(PropertySummary)));
export const PermitSearchResponse = def('PermitSearchResponse', obj(page(PermitSummary)));
/** Text-search items are PermitSummary with match_snippet and bm25_score present. */
export const PermitTextSearchResponse = def('PermitTextSearchResponse', obj(page(PermitSummary)));
export const BusinessSearchResponse = def(
  'BusinessSearchResponse',
  obj({
    items: z.array(BusinessRecord),
    total: int,
    next_cursor: nstr,
    matcher_version: z.string(),
  }),
);
export const LicenseSearchResponse = def(
  'LicenseSearchResponse',
  obj({
    items: z.array(LicenseRecord),
    total: int,
    next_cursor: nstr,
    matcher_version: z.string(),
  }),
);
export const RunsResponse = def('RunsResponse', obj({ items: z.array(Run) }));
/** MCP get_run_summary result: GET /v1/meta plus GET /v1/runs. */
export const RunSummaryResponse = def(
  'RunSummaryResponse',
  obj({ meta: Meta, runs: z.array(Run) }),
);
/** The manifest is served as the pinned bytes unchanged; its shape is the kit's, not ours. */
export const ManifestResponse = def('ManifestResponse', z.record(z.string(), z.unknown()));
export const OpenApiDocument = def('OpenApiDocument', z.record(z.string(), z.unknown()));
