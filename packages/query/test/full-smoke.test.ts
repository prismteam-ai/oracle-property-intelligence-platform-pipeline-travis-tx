import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BusinessRecord,
  BusinessSearchResponse,
  Contractor,
  LicenseRecord,
  LicenseSearchResponse,
  Meta,
  PermitDetail,
  PermitSearchResponse,
  PermitTextSearchResponse,
  PropertyDetail,
  PropertySearchResponse,
  RunsResponse,
  SearchCentersResponse,
  businessSearchParams,
  licenseSearchParams,
  searchPermitsParams,
  searchPropertiesParams,
  textSearchParams,
} from '@travis/contract';
import { Queries } from '../src/index.js';
import type { SchemaLike } from './helpers.js';

/**
 * In-process smoke of every operation against the FULL database (data/deploy/current in the main checkout, or
 * FULL_DB). Skipped when the file is absent (CI has only the fixture). Prints the cold-open time and per-operation
 * p50/p95: the T7 cold-start budget input. Run it alone: `FULL_DB=... npm test -w @travis/query -- full-smoke`.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
const main = here.includes(marker) ? here.split(marker)[0]! : path.resolve(here, '..', '..', '..');
const fullDb = process.env.FULL_DB ?? path.join(main, 'data', 'deploy', 'current', 'travis.duckdb');
const ITER = Number(process.env.SMOKE_ITERATIONS ?? 20);

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;

describe.skipIf(!existsSync(fullDb) || process.env.SKIP_FULL === '1')('full database smoke', () => {
  it('serves every operation with a valid response and reports cold-open and query timings', async () => {
    const t0 = performance.now();
    const q = await Queries.open({
      dbPath: fullDb,
      memoryLimit: process.env.SMOKE_MEMORY ?? '3GB',
      threads: Number(process.env.SMOKE_THREADS ?? 2),
    });
    const openMs = Math.round(performance.now() - t0);
    const rows = async (sql: string) =>
      (await q.conn.runAndReadAll(sql)).getRowObjectsJson() as Record<string, string>[];
    const centers = await rows(
      `SELECT name, kind, lat, lon FROM search_centers WHERE parcel_count > 3000 ORDER BY hash(center_id) LIMIT ${ITER}`,
    );
    const props = await rows(
      `SELECT property_id, geo_id FROM properties WHERE geo_id IS NOT NULL ORDER BY hash(property_id) LIMIT ${ITER}`,
    );
    const hotProps = await rows(
      `SELECT property_id FROM properties ORDER BY permit_count DESC LIMIT 5`,
    );
    const permits = await rows(`SELECT permit_id FROM permits USING SAMPLE ${ITER} ROWS`);
    const contractors = await rows(
      `SELECT k FROM (SELECT contractor_attribution_key k FROM registry_candidates UNION SELECT contractor_attribution_key FROM license_candidates) ORDER BY hash(k) LIMIT ${ITER}`,
    );
    const biz = await rows(
      `SELECT business_record_id id, name FROM business_records ORDER BY hash(business_record_id) LIMIT ${ITER}`,
    );
    const lic = await rows(
      `SELECT license_record_id id, holder_name FROM license_records WHERE holder_name IS NOT NULL ORDER BY hash(license_record_id) LIMIT ${ITER}`,
    );
    const texts = [
      're-roof',
      'hail damage',
      'roof replacement shingle',
      'reroof residential',
      'metal roof',
      'foundation repair',
      'storm damage re roof',
      'tpo membrane',
      'solar panels roof',
      'composition shingle',
    ];

    type Op = { name: string; schema: SchemaLike; run: (i: number) => Promise<unknown> };
    const c = (i: number) => centers[i % centers.length]!;
    const ops: Op[] = [
      { name: 'getMeta (cold, first call)', schema: Meta, run: () => q.getMeta() },
      { name: 'listRuns', schema: RunsResponse, run: () => q.listRuns() },
      {
        name: 'searchCenters',
        schema: SearchCentersResponse,
        run: (i) => q.searchCenters({ q: c(i).name!.slice(0, 5) }),
      },
      {
        name: 'searchProperties (radius 5, age>15 or open)',
        schema: PropertySearchResponse,
        run: (i) =>
          q.searchProperties(
            searchPropertiesParams('rest').parse({
              lat: Number(c(i).lat),
              lon: Number(c(i).lon),
              limit: 50,
            }),
          ),
      },
      {
        name: 'searchProperties (radius 25, limit 500)',
        schema: PropertySearchResponse,
        run: (i) =>
          q.searchProperties(
            searchPropertiesParams('rest').parse({
              lat: Number(c(i).lat),
              lon: Number(c(i).lon),
              radius_miles: 25,
              limit: 500,
            }),
          ),
      },
      {
        name: 'searchProperties (county-wide, tenure 10)',
        schema: PropertySearchResponse,
        run: () =>
          q.searchProperties(
            searchPropertiesParams('rest').parse({
              owner_tenure_min: 10,
              absentee_owner: true,
              limit: 50,
            }),
          ),
      },
      {
        name: 'getProperty',
        schema: PropertyDetail,
        run: (i) => q.getProperty({ property_id: props[i % props.length]!.property_id! }),
      },
      {
        name: 'getProperty (5 busiest)',
        schema: PropertyDetail,
        run: (i) => q.getProperty({ property_id: hotProps[i % hotProps.length]!.property_id! }),
      },
      {
        name: 'getProperty by geo id',
        schema: PropertyDetail,
        run: (i) => q.getProperty({ geo_id: props[i % props.length]!.geo_id! }),
      },
      {
        name: 'searchPermits (open+stalled roofing, radius 5)',
        schema: PermitSearchResponse,
        run: (i) =>
          q.searchPermits(
            searchPermitsParams('rest').parse({
              lat: Number(c(i).lat),
              lon: Number(c(i).lon),
              limit: 50,
            }),
          ),
      },
      {
        name: 'searchPermits (county-wide, min_open_years 5)',
        schema: PermitSearchResponse,
        run: () =>
          q.searchPermits(searchPermitsParams('rest').parse({ min_open_years: 5, limit: 50 })),
      },
      {
        name: 'searchPermitText (county-wide)',
        schema: PermitTextSearchResponse,
        run: (i) =>
          q.searchPermitText(
            textSearchParams('rest').parse({ q: texts[i % texts.length], limit: 50 }),
          ),
      },
      {
        name: 'searchPermitText (radius 5)',
        schema: PermitTextSearchResponse,
        run: (i) =>
          q.searchPermitText(
            textSearchParams('rest').parse({
              q: texts[i % texts.length],
              lat: Number(c(i).lat),
              lon: Number(c(i).lon),
              limit: 50,
            }),
          ),
      },
      {
        name: 'getPermit',
        schema: PermitDetail,
        run: (i) => q.getPermit(permits[i % permits.length]!.permit_id!),
      },
      {
        name: 'getContractor',
        schema: Contractor,
        run: (i) => q.getContractor(contractors[i % contractors.length]!.k!),
      },
      {
        name: 'searchBusinesses (name)',
        schema: BusinessSearchResponse,
        run: (i) =>
          q.searchBusinesses(businessSearchParams('rest').parse({ q: biz[i % biz.length]!.name })),
      },
      {
        name: 'searchBusinesses (prefix)',
        schema: BusinessSearchResponse,
        run: (i) =>
          q.searchBusinesses(
            businessSearchParams('rest').parse({
              q: biz[i % biz.length]!.name!.slice(0, 5),
              match: 'prefix',
              scope: 'all',
            }),
          ),
      },
      {
        name: 'getBusiness',
        schema: BusinessRecord,
        run: (i) => q.getBusiness(biz[i % biz.length]!.id!),
      },
      {
        name: 'searchLicenses (name)',
        schema: LicenseSearchResponse,
        run: (i) =>
          q.searchLicenses(
            licenseSearchParams('rest').parse({ q: lic[i % lic.length]!.holder_name }),
          ),
      },
      {
        name: 'getLicense',
        schema: LicenseRecord,
        run: (i) => q.getLicense(lic[i % lic.length]!.id!),
      },
    ];
    const lines: string[] = [];
    for (const op of ops) {
      const times: number[] = [];
      let first = 0;
      for (let i = 0; i < ITER; i++) {
        const s = performance.now();
        const out = await op.run(i);
        const ms = performance.now() - s;
        if (i === 0) {
          first = ms;
          const r = op.schema.safeParse(out);
          expect(
            r.success
              ? []
              : (r.error?.issues ?? [])
                  .slice(0, 5)
                  .map((x) => `${x.path.map(String).join('.')}: ${x.message}`),
            `${op.name} schema`,
          ).toEqual([]);
        } else times.push(ms);
      }
      lines.push(
        `${op.name.padEnd(52)} first ${first.toFixed(0).padStart(5)} ms   p50 ${pct(times, 50).toFixed(1).padStart(7)} ms   p95 ${pct(times, 95).toFixed(1).padStart(7)} ms   max ${Math.max(
          ...times,
        )
          .toFixed(0)
          .padStart(5)} ms`,
      );
    }
    process.stdout.write(
      `FULL DB ${fullDb}\nopen (cold start of the query layer): ${openMs} ms; deploy ${q.deployId}; memory_limit ${process.env.SMOKE_MEMORY ?? '3GB'}, threads ${process.env.SMOKE_THREADS ?? 2}; ${ITER} iterations per operation\n${lines.join('\n')}\n`,
    );
    q.close();
  }, 600_000);
});
