import { searchPermitsParams, searchPropertiesParams, textSearchParams } from '@travis/contract';
import type { Queries } from '@travis/query';

/** Central Austin: the demo's and the CRM's default center (runbook section 9). */
const CENTER = { lat: 30.2672, lon: -97.7431 };

/**
 * The calls a warm-up runs once per instance, so the demo's default searches find their row groups, footers and text
 * index pages already in the instance's caches: the CRM's main call, the default property and permit searches, a
 * county-wide text search and meta.
 */
export const PRIME: { name: string; run: (q: Queries) => Promise<unknown> }[] = [
  { name: 'getMeta', run: (q) => q.getMeta() },
  {
    name: 'searchProperties crm',
    run: (q) =>
      q.searchProperties(
        searchPropertiesParams('rest').parse({
          ...CENTER,
          radius_miles: 5,
          roof_age_min: 15,
          open_permits: false,
          limit: 500,
        }),
      ),
  },
  {
    name: 'searchProperties',
    run: (q) => q.searchProperties(searchPropertiesParams('rest').parse({ ...CENTER, limit: 50 })),
  },
  {
    name: 'searchPermits',
    run: (q) => q.searchPermits(searchPermitsParams('rest').parse({ ...CENTER, limit: 50 })),
  },
  {
    name: 'searchPermitText',
    run: (q) => q.searchPermitText(textSearchParams('rest').parse({ q: 'reroof', limit: 50 })),
  },
];

/**
 * The chat function's warm-up calls (no model call): the tool calls of README.md's two agent prompts, around the Austin
 * search center as resolve_search_center returns it, so a reviewer's first turn finds their row groups cached.
 */
export const AGENT_PRIME: { name: string; run: (q: Queries) => Promise<unknown> }[] = [
  { name: 'getMeta', run: (q) => q.getMeta() },
  {
    name: 'resolve_search_center + search_properties + search_permits (Austin, 5 mi)',
    run: async (q) => {
      const c = (await q.searchCenters({ q: 'Austin' })).items.find(
        (i) => i.match_type === 'exact',
      );
      if (!c) return;
      const center = { lat: c.lat, lon: c.lon, radius_miles: 5 };
      await q.searchProperties(
        searchPropertiesParams('mcp').parse({ ...center, roof_age_min: 15, open_permits: false }),
      );
      await q.searchPermits(searchPermitsParams('mcp').parse({ ...center, min_open_years: 5 }));
    },
  },
];
