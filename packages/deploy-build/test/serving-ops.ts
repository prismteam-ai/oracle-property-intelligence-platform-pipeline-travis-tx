/* eslint-disable @typescript-eslint/no-explicit-any */
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  businessSearchParams,
  licenseSearchParams,
  searchPermitsParams,
  searchPropertiesParams,
  textSearchParams,
} from '@travis/contract';
import type { Queries } from '@travis/query';

/**
 * A static file server with Range support for the serving Parquet files, optionally throttled to `rate` bytes per
 * second in total with `latencyMs` before each response (the decisions.md section 30 gate models Lambda's reads so).
 */
export async function startRangeServer(
  dir: string,
  o: { rate?: number; latencyMs?: number } = {},
): Promise<{
  url: string;
  stats: () => { requests: number; bytes: number };
  reset: () => void;
  close: () => Promise<void>;
}> {
  let stats = { requests: 0, bytes: 0 };
  let next = Date.now();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const take = async (n: number) => {
    if (!o.rate) return;
    const now = Date.now();
    next = Math.max(next, now) + (n / o.rate) * 1000;
    const wait = next - now - (n / o.rate) * 1000;
    if (wait > 0) await sleep(wait);
  };
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const f = path.join(dir, path.basename(rel));
    let size: number;
    let mtime: Date;
    try {
      ({ size, mtime } = statSync(f));
    } catch {
      res.statusCode = 404;
      return res.end();
    }
    stats.requests++;
    if (o.latencyMs) await sleep(o.latencyMs);
    let start = 0;
    let end = size - 1;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (m) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-length', end - start + 1);
    // S3 sends both; DuckDB's external file cache keys its blocks on them
    res.setHeader('last-modified', mtime.toUTCString());
    res.setHeader('etag', `"${size.toString(16)}-${mtime.getTime().toString(16)}"`);
    if (req.method === 'HEAD') return res.end();
    const fd = openSync(f, 'r');
    const buf = Buffer.allocUnsafe(65536);
    try {
      for (let p = start; p <= end;) {
        const n = Math.min(65536, end - p + 1);
        readSync(fd, buf, 0, n, p);
        await take(n);
        stats.bytes += n;
        if (!res.write(Buffer.from(buf.subarray(0, n))))
          await new Promise((r) => res.once('drain', r));
        p += n;
      }
    } finally {
      closeSync(fd);
    }
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stats: () => ({ ...stats }),
    reset: () => {
      stats = { requests: 0, bytes: 0 };
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(() => r()));
    },
  };
}

/** Real values taken from the database, so the operations hit rows the data holds. */
export interface OpSample {
  center: { lat: number; lon: number };
  propertyId: string;
  geoId: string;
  permitId: string;
  contractorKey: string;
  businessId: string;
  businessName: string;
  businessNumber: string;
  licenseId: string;
  licenseName: string;
  runId: string;
}

export async function opSample(q: Queries): Promise<OpSample> {
  const one = async (sql: string): Promise<Record<string, any>> =>
    (await q.conn.runAndReadAll(sql)).getRowObjectsJson()[0] as Record<string, any>;
  const c = await one(`SELECT lat, lon FROM search_centers WHERE center_id = 'city:austin'`);
  const p = await one(
    `SELECT property_id, geo_id FROM properties WHERE geo_id IS NOT NULL AND roof_age_years > 15 AND lat IS NOT NULL ORDER BY property_id LIMIT 1`,
  );
  const permit = await one(
    `SELECT permit_id FROM permits WHERE contractor_company_name IS NOT NULL AND is_roofing ORDER BY permit_id LIMIT 1`,
  );
  const k = await one(
    `SELECT contractor_attribution_key k FROM registry_candidates ORDER BY 1 LIMIT 1`,
  );
  const b = await one(
    `SELECT business_record_id id, name, taxpayer_number FROM business_records WHERE taxpayer_number IS NOT NULL ORDER BY business_record_id LIMIT 1`,
  );
  const l = await one(
    `SELECT license_record_id id, holder_name FROM license_records WHERE holder_name IS NOT NULL ORDER BY license_record_id LIMIT 1`,
  );
  const r = await one(`SELECT run_id FROM deploy`);
  return {
    center: { lat: Number(c.lat), lon: Number(c.lon) },
    propertyId: p.property_id,
    geoId: p.geo_id,
    permitId: permit.permit_id,
    contractorKey: k.k,
    businessId: b.id,
    businessName: b.name,
    businessNumber: b.taxpayer_number,
    licenseId: l.id,
    licenseName: l.holder_name,
    runId: r.run_id,
  };
}

export const CRM_F1 =
  'searchProperties CRM F1 (r5, roof_age_min 15, open_permits false, limit 500)';

/** Every Queries operation once; the parity test and the gate compare their JSON between the two modes. */
export function servingOps(s: OpSample): { name: string; run: (q: Queries) => Promise<unknown> }[] {
  const at = { lat: s.center.lat, lon: s.center.lon };
  return [
    { name: 'getMeta', run: (q) => q.getMeta() },
    { name: 'listRuns', run: (q) => q.listRuns() },
    {
      name: 'getRunManifest',
      run: async (q) => (await q.getRunManifest(s.runId)).toString('hex'),
    },
    { name: 'searchCenters', run: (q) => q.searchCenters({ q: 'aus' }) },
    {
      name: CRM_F1,
      run: (q) =>
        q.searchProperties(
          searchPropertiesParams('rest').parse({
            ...at,
            radius_miles: 5,
            roof_age_min: 15,
            open_permits: false,
            limit: 500,
          }),
        ),
    },
    {
      name: 'searchProperties r5 (defaults, limit 50)',
      run: (q) => q.searchProperties(searchPropertiesParams('rest').parse({ ...at, limit: 50 })),
    },
    {
      name: 'searchProperties county-wide (tenure 10, absentee)',
      run: (q) =>
        q.searchProperties(
          searchPropertiesParams('rest').parse({
            owner_tenure_min: 10,
            absentee_owner: true,
            limit: 50,
          }),
        ),
    },
    { name: 'getProperty', run: (q) => q.getProperty({ property_id: s.propertyId }) },
    { name: 'getProperty by geo_id', run: (q) => q.getProperty({ geo_id: s.geoId }) },
    {
      name: 'searchPermits open+stalled roofing r5',
      run: (q) => q.searchPermits(searchPermitsParams('rest').parse({ ...at, limit: 50 })),
    },
    {
      name: 'searchPermits county-wide (min_open_years 5)',
      run: (q) =>
        q.searchPermits(searchPermitsParams('rest').parse({ min_open_years: 5, limit: 50 })),
    },
    {
      name: 'searchPermitText county-wide (reroof)',
      run: (q) => q.searchPermitText(textSearchParams('rest').parse({ q: 'reroof', limit: 50 })),
    },
    {
      name: 'searchPermitText r5 (hail damage)',
      run: (q) =>
        q.searchPermitText(textSearchParams('rest').parse({ q: 'hail damage', ...at, limit: 50 })),
    },
    { name: 'getPermit', run: (q) => q.getPermit(s.permitId) },
    { name: 'getContractor', run: (q) => q.getContractor(s.contractorKey) },
    {
      name: 'searchBusinesses by name',
      run: (q) => q.searchBusinesses(businessSearchParams('rest').parse({ q: s.businessName })),
    },
    {
      name: 'searchBusinesses by number',
      run: (q) =>
        q.searchBusinesses(businessSearchParams('rest').parse({ number: s.businessNumber })),
    },
    { name: 'getBusiness', run: (q) => q.getBusiness(s.businessId) },
    {
      name: 'searchLicenses by name',
      run: (q) => q.searchLicenses(licenseSearchParams('rest').parse({ q: s.licenseName })),
    },
    { name: 'getLicense', run: (q) => q.getLicense(s.licenseId) },
  ];
}
