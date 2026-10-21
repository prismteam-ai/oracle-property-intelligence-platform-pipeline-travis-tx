import { z } from 'zod';
import { MatchReason, ROOFING_CLASSES, RoofWorkClass, StatusGroup, def, obj } from './shared.js';

/**
 * Query/path/tool parameters. One natural-typed schema per operation: lists are arrays, booleans
 * are booleans. On REST the query string is first coerced with `coerceQuery` (comma lists, numbers,
 * "true"/"false"), then parsed with the same schema. `mode: 'mcp'` is the MCP / agent variant
 * (limit default 20, max 50; search_properties.open_permits required without default).
 */
export type Mode = 'rest' | 'mcp';

export const REST_LIMIT = { default: 50, max: 500 } as const;
export const MCP_LIMIT = { default: 20, max: 50 } as const;

const limit = (mode: Mode) => {
  const l = mode === 'rest' ? REST_LIMIT : MCP_LIMIT;
  return z
    .number()
    .int()
    .min(1)
    .max(l.max)
    .default(l.default)
    .describe(`Page size, 1 to ${l.max}, default ${l.default}.`);
};
const cursor = z
  .string()
  .optional()
  .describe(
    'Opaque cursor from a previous response; tied to deploy_id and open_duration_as_of (stale_cursor otherwise).',
  );
const lat = z
  .number()
  .min(-90)
  .max(90)
  .optional()
  .describe('WGS84 latitude; give together with lon. Omit both for a county-wide search.');
const lon = z
  .number()
  .min(-180)
  .max(180)
  .optional()
  .describe('WGS84 longitude; give together with lat.');
const radius = z
  .number()
  .min(0.1)
  .max(25)
  .default(5)
  .describe('Great-circle miles, 0.1 to 25, default 5.');
const csv = (what: string) => ` Comma-separated list on REST (${what}); a JSON array in MCP.`;

const latLonTogether = <T extends { lat?: number | undefined; lon?: number | undefined }>(v: T) =>
  (v.lat === undefined) === (v.lon === undefined);
const latLonMsg = { message: 'lat and lon must be given together', path: ['lat'] };

export const SearchCentersQuery = def(
  'SearchCentersQuery',
  obj({
    q: z
      .string()
      .min(1)
      .describe(
        'City name, alias or ZIP; normalized (casefolded, punctuation and spaces removed).',
      ),
  }),
);

export function searchPropertiesParams(mode: Mode) {
  return obj({
    lat,
    lon,
    radius_miles: radius,
    roof_age_min: z
      .number()
      .int()
      .min(0)
      .default(15)
      .describe('Strict: matches roof_age_years > roof_age_min. 0 omits the age clause.'),
    open_permits:
      mode === 'rest'
        ? z
            .boolean()
            .default(true)
            .describe(
              'Also match properties with an open or stalled roofing permit. REST default true.',
            )
        : z
            .boolean()
            .describe(
              'Required, no default: also match properties with an open or stalled roofing permit.',
            ),
    long_open_years: z
      .number()
      .positive()
      .default(5)
      .describe('Long-open threshold in years (open_duration_days >= long_open_years x 365).'),
    roof_work_class: z
      .array(z.enum(ROOFING_CLASSES))
      .min(1)
      .optional()
      .describe(
        'Limit the roofing-permit signal to these roofing classes: roofing_permit_counts.open and .stalled, the open, long-open and stalled match reasons, the ordering and total. Omit for all four roofing classes. For replacements and repairs only: primary_roof_replacement,repair_or_coating.' +
          csv('roofing roof_work_class values'),
      ),
    owner_tenure_min: z
      .number()
      .min(0)
      .optional()
      .describe('Years since the deed date; narrows the match.'),
    absentee_owner: z.boolean().optional().describe('Narrow to absentee owners.'),
    out_of_area_owner: z.boolean().optional().describe('Narrow to out-of-area owners.'),
    limit: limit(mode),
    cursor,
  }).refine(latLonTogether, latLonMsg);
}

export function searchPermitsParams(mode: Mode) {
  return obj({
    lat,
    lon,
    radius_miles: radius,
    status_group: z
      .array(StatusGroup)
      .min(1)
      .default(['open', 'stalled'])
      .describe(
        'Status groups to include, default open,stalled.' +
          csv('open, stalled, closed, needs_review'),
      ),
    roofing_only: z
      .boolean()
      .default(true)
      .describe('Only permits whose roof_work_class is in the roofing set.'),
    roof_work_class: z
      .array(RoofWorkClass)
      .min(1)
      .optional()
      .describe('Restrict to these roof work classes.' + csv('roof_work_class values')),
    min_open_years: z
      .number()
      .min(0)
      .optional()
      .describe('Only permits open at least this many years (open_duration_days).'),
    contractor_attribution_key: z
      .string()
      .optional()
      .describe('Permits grouped under one printed contractor name and phone.'),
    property_id: z
      .string()
      .optional()
      .describe('All permits of one property (pages beyond those embedded in PropertyDetail).'),
    limit: limit(mode),
    cursor,
  }).refine(latLonTogether, latLonMsg);
}

export function textSearchParams(mode: Mode) {
  return obj({
    q: z
      .string()
      .min(1)
      .max(200)
      .describe('Plain words, at most 200 characters; stopwords are dropped, aliases applied.'),
    match: z
      .enum(['all', 'any'])
      .default('all')
      .describe('all: every remaining query term must match.'),
    lat,
    lon,
    radius_miles: radius,
    status_group: z
      .array(StatusGroup)
      .min(1)
      .default(['open', 'stalled', 'closed', 'needs_review'])
      .describe(
        'Status groups to include, default all four.' + csv('open, stalled, closed, needs_review'),
      ),
    roofing_only: z
      .boolean()
      .default(false)
      .describe('Only permits whose roof_work_class is in the roofing set.'),
    limit: limit(mode),
    cursor,
  }).refine(latLonTogether, latLonMsg);
}

export function businessSearchParams(mode: Mode) {
  return obj({
    q: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Business name, at most 200 characters; normalized with the matcher normalizer. Exactly one of q or number.',
      ),
    number: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Taxpayer number, SOS file number or filing number, compared with the trimmed printed value; a withheld number never matches.',
      ),
    match: z
      .enum(['exact', 'prefix'])
      .default('exact')
      .describe('exact: normalized name equals q; prefix: starts with q.'),
    source: z
      .array(z.string())
      .min(1)
      .optional()
      .describe('Source keys, default all loaded.' + csv('source keys')),
    scope: z
      .enum(['travis', 'out_of_county', 'all'])
      .default('travis')
      .describe('Record scope, default travis.'),
    limit: limit(mode),
    cursor,
  }).refine((v) => (v.q === undefined) !== (v.number === undefined), {
    message: 'give exactly one of q or number',
    path: ['q'],
  });
}

export function licenseSearchParams(mode: Mode) {
  return obj({
    q: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Holder or business name, at most 200 characters. Exactly one of q or license_number.',
      ),
    license_number: z
      .string()
      .min(1)
      .optional()
      .describe('Compared with the trimmed printed value.'),
    match: z.enum(['exact', 'prefix']).default('exact'),
    source: z
      .array(z.string())
      .min(1)
      .optional()
      .describe('Source keys, default all loaded.' + csv('source keys')),
    license_type: z
      .array(z.string())
      .min(1)
      .optional()
      .describe('Compared with the printed license type.' + csv('printed types')),
    limit: limit(mode),
    cursor,
  }).refine((v) => (v.q === undefined) !== (v.license_number === undefined), {
    message: 'give exactly one of q or license_number',
    path: ['q'],
  });
}

// ---- path params -------------------------------------------------------------------------------
export const PropertyIdParam = obj({
  property_id: z.string().describe('TCAD PROP_ID as printed.'),
});
export const GeoIdParam = obj({ geo_id: z.string().describe('TCAD Geographic ID as printed.') });
export const PermitIdParam = obj({
  permit_id: z.string().describe('Permit number as printed, URL-encoded (contains a space).'),
});
export const ContractorKeyParam = obj({ contractor_attribution_key: z.string() });
export const BusinessIdParam = obj({ business_record_id: z.string() });
export const LicenseIdParam = obj({ license_record_id: z.string() });
export const RunIdParam = obj({
  run_id: z
    .string()
    .regex(/^\d{8}T\d{6}Z/)
    .describe('Pipeline run id, YYYYMMDDTHHMMSSZ (a label suffix such as -t5-full is allowed).'),
});

// ---- MCP-only input shapes ---------------------------------------------------------------------
export const GetPropertyInput = obj({
  property_id: z.string().optional().describe('TCAD PROP_ID as printed.'),
  geo_id: z.string().optional().describe('TCAD Geographic ID as printed.'),
}).refine((v) => (v.property_id === undefined) !== (v.geo_id === undefined), {
  message: 'give exactly one of property_id or geo_id',
  path: ['property_id'],
});
export const EmptyInput = obj({});

export { MatchReason };

/**
 * Coerce a raw query-string record (as API Gateway delivers it) to the natural types of `schema`.
 * Numbers, booleans ("true"/"false") and comma lists are decided from the schema's input JSON
 * Schema, so there is exactly one place that defines parameter types. Values that do not coerce are
 * passed through unchanged so that parsing reports them as 400.
 */
export function coerceQuery(
  schema: z.ZodType,
  raw: Record<string, string | undefined>,
): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { type?: string }>;
  };
  const props = js.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    const t = props[k]?.type;
    if (t === 'array') out[k] = v === '' ? [] : v.split(',').map((s) => s.trim());
    else if ((t === 'number' || t === 'integer') && v.trim() !== '') out[k] = Number(v);
    else if (t === 'boolean') out[k] = v === 'true' ? true : v === 'false' ? false : v;
    else out[k] = v;
  }
  return out;
}
