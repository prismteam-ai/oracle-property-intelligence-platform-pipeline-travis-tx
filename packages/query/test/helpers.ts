/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from 'node:url';
import { FIXTURE_DB_URL, Queries } from '../src/index.js';

export const fixturePath = (): string => fileURLToPath(FIXTURE_DB_URL);

/** Today for the fixture tests: the real date, so long-open durations are real. */
export async function openFixture(): Promise<Queries> {
  return Queries.open({ dbPath: fixturePath(), memoryLimit: '1GB', threads: 2 });
}

export interface SchemaLike {
  _output: unknown;
  safeParse(v: unknown): {
    success: boolean;
    data?: any;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
}
export function expectValid<T extends SchemaLike>(
  schema: T,
  value: unknown,
  label: string,
): T['_output'] {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new Error(
      `${label} does not satisfy its schema: ${(r.error?.issues ?? [])
        .slice(0, 8)
        .map((i) => `${i.path.map(String).join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  return r.data;
}

/** Sample values taken from the database itself (real rows), so the tests assert on whatever the fixture holds. */
export interface Samples {
  center: { lat: number; lon: number };
  propertyId: string;
  geoId: string;
  openPropertyId: string;
  permitId: string;
  textPermitId: string;
  contractorWithRegistry: string;
  contractorWithLicense: string;
  businessId: string;
  businessName: string;
  businessNumber: string;
  licenseId: string;
  licenseName: string;
  licenseNumber: string;
}

export async function samples(q: Queries): Promise<Samples> {
  const one = async (sql: string): Promise<Record<string, any>> =>
    (await q.conn.runAndReadAll(sql)).getRowObjectsJson()[0] as Record<string, any>;
  const c = await one(`SELECT lat, lon FROM search_centers WHERE center_id = 'city:austin'`);
  const p = await one(
    `SELECT property_id, geo_id FROM properties WHERE geo_id IS NOT NULL AND roof_age_years > 15 AND lat IS NOT NULL ORDER BY property_id LIMIT 1`,
  );
  const open = await one(
    `SELECT property_id FROM properties WHERE roofing_open_count > 0 ORDER BY open_roofing_min_open_since LIMIT 1`,
  );
  const permit = await one(
    `SELECT permit_id FROM permits WHERE contractor_company_name IS NOT NULL AND is_roofing ORDER BY permit_id LIMIT 1`,
  );
  const text = await one(
    `SELECT permit_id FROM permits WHERE is_text_indexed AND lower(description) LIKE '%reroof%' ORDER BY permit_id LIMIT 1`,
  );
  const reg = await one(
    `SELECT contractor_attribution_key k FROM registry_candidates ORDER BY 1 LIMIT 1`,
  );
  const lic = await one(
    `SELECT contractor_attribution_key k FROM license_candidates ORDER BY 1 LIMIT 1`,
  );
  const b = await one(
    `SELECT business_record_id id, name, taxpayer_number FROM business_records WHERE taxpayer_number IS NOT NULL ORDER BY business_record_id LIMIT 1`,
  );
  const l = await one(
    `SELECT license_record_id id, holder_name, license_number FROM license_records WHERE holder_name IS NOT NULL AND license_number IS NOT NULL ORDER BY license_record_id LIMIT 1`,
  );
  return {
    center: { lat: Number(c.lat), lon: Number(c.lon) },
    propertyId: p.property_id,
    geoId: p.geo_id,
    openPropertyId: open.property_id,
    permitId: permit.permit_id,
    textPermitId: text?.permit_id,
    contractorWithRegistry: reg.k,
    contractorWithLicense: lic.k,
    businessId: b.id,
    businessName: b.name,
    businessNumber: b.taxpayer_number,
    licenseId: l.id,
    licenseName: l.holder_name,
    licenseNumber: l.license_number,
  };
}
