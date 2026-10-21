import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  coerceQuery,
  licenseSearchParams,
  searchPermitsParams,
  searchPropertiesParams,
  textSearchParams,
} from '@travis/contract';
import { FIXTURE_SKIP_MESSAGE, QueryError, fixtureExists, type Queries } from '../src/index.js';
import { expectValid, openFixture, samples, type Samples } from './helpers.js';

if (!fixtureExists()) console.warn(FIXTURE_SKIP_MESSAGE);

describe.skipIf(!fixtureExists())('operations on the fixture database', () => {
  let q: Queries;
  let s: Samples;
  beforeAll(async () => {
    q = await openFixture();
    s = await samples(q);
  });
  afterAll(() => q?.close());

  const sp = (o: object) =>
    searchPropertiesParams('rest').parse({
      lat: s.center.lat,
      lon: s.center.lon,
      radius_miles: 8,
      ...o,
    });

  it('meta satisfies the Meta schema and describes the fixture', async () => {
    const m = expectValid(Meta, await q.getMeta(), 'meta');
    expect(m.deploy.deploy_id.startsWith('fixture-')).toBe(true);
    expect(Object.keys(m.groups).length).toBe(177);
    expect(m.counts.by_source['tx-comptroller-franchise-tax']?.kind).toBe('business');
    expect(m.limitations.some((l) => l.source === 'bbb.org')).toBe(true);
  });

  it('runs: the real run records, mapped onto the contract shape, validate', async () => {
    const r = expectValid(RunsResponse, await q.listRuns(), 'runs');
    expect(r.items.map((x) => x.run_id)).toEqual([
      '20261020T200236Z-t5-full',
      '20261018T143520Z-t5-full',
      '20261017T072132Z',
    ]);
    const full = r.items[0]!;
    expect(Object.keys(full.groups).length).toBe(177);
    expect(full.manifest_cid).toMatch(/^bafy/);
  });

  it('manifest bytes are served unchanged', async () => {
    const bytes = await q.getRunManifest('20261018T143520Z-t5-full');
    expect(JSON.parse(bytes.toString('utf8')).run_id).toBe('20261018T143520Z-t5-full');
    await expect(q.getRunManifest('20000101T000000Z')).rejects.toBeInstanceOf(QueryError);
  });

  it('search centers: exact, prefix and alias matches', async () => {
    const r = expectValid(SearchCentersResponse, await q.searchCenters({ q: 'Austin' }), 'centers');
    expect(r.items[0]?.match_type).toBe('exact');
    expect(r.items[0]?.basis).toMatch(/^centroid of [\d,]+ parcels with situs city AUSTIN$/);
    const zip = await q.searchCenters({ q: '78704' });
    expect(zip.items[0]?.kind).toBe('zip');
    expect((await q.searchCenters({ q: 'zzzz nowhere' })).items).toEqual([]);
  });

  it('property search: roof age, open roofing permits, reasons, sort and paging', async () => {
    const r = expectValid(
      PropertySearchResponse,
      await q.searchProperties(sp({ roof_age_min: 15, open_permits: true, limit: 10 })),
      'properties',
    );
    expect(r.total).toBeGreaterThan(10);
    expect(r.items.length).toBe(10);
    expect(r.next_cursor).not.toBeNull();
    expect(r.items.every((p) => (p.distance_miles ?? 99) <= 8)).toBe(true);
    // open before stalled before the rest
    const rank = (p: (typeof r.items)[number]) =>
      p.roofing_permit_counts.open > 0 ? 0 : p.roofing_permit_counts.stalled > 0 ? 1 : 2;
    expect(r.items.map(rank)).toEqual([...r.items.map(rank)].sort((a, b) => a - b));
    const next = expectValid(
      PropertySearchResponse,
      await q.searchProperties(
        sp({ roof_age_min: 15, open_permits: true, limit: 10, cursor: r.next_cursor! }),
      ),
      'page 2',
    );
    expect(next.items[0]?.property_id).not.toBe(r.items[0]?.property_id);
    expect(next.total).toBe(r.total);
  });

  it('property search: strict age threshold, reasons and the owner filters', async () => {
    const age = await q.searchProperties(sp({ roof_age_min: 15, open_permits: false, limit: 50 }));
    expect(age.items.length).toBeGreaterThan(0);
    for (const p of age.items) {
      expect(p.roof_age_years).toBeGreaterThan(15);
      expect(p.match_reasons).toContain('aged_roof');
    }
    const all = await q.searchProperties(sp({ roof_age_min: 0, open_permits: false, limit: 1 }));
    expect(all.total).toBeGreaterThan(age.total);
    const open = await q.searchProperties(sp({ roof_age_min: 0, open_permits: true, limit: 50 }));
    const reasons = new Set(open.items.flatMap((p) => p.match_reasons ?? []));
    expect(reasons.has('open_roofing_permit')).toBe(true);
    expect(reasons.has('long_open_roofing_permit')).toBe(true);
    const stalled = await q.searchProperties(
      sp({ roof_age_min: 0, open_permits: true, radius_miles: 25, limit: 50 }),
    );
    expect(stalled.items.some((p) => p.match_reasons?.includes('stalled_roofing_permit'))).toBe(
      true,
    );
    const tenure = await q.searchProperties(
      sp({ roof_age_min: 15, open_permits: true, owner_tenure_min: 10, limit: 20 }),
    );
    expect(tenure.items.length).toBeGreaterThan(0);
    expect(
      tenure.items.every(
        (p) => (p.owner_tenure_years ?? 0) >= 10 && p.match_reasons?.includes('owner_tenure'),
      ),
    ).toBe(true);
    const absentee = await q.searchProperties(
      sp({ roof_age_min: 15, open_permits: true, absentee_owner: true, limit: 20 }),
    );
    expect(absentee.items.length).toBeGreaterThan(0);
    expect(absentee.items.every((p) => p.owner_absentee === true)).toBe(true);
    const ooa = await q.searchProperties(
      sp({ roof_age_min: 15, open_permits: true, out_of_area_owner: true, limit: 20 }),
    );
    expect(ooa.items.length).toBeGreaterThan(0);
    expect(ooa.items.every((p) => p.owner_out_of_area === true)).toBe(true);
  });

  it('county-wide property search has null distances; an outside center returns the area note', async () => {
    const r = expectValid(
      PropertySearchResponse,
      await q.searchProperties(
        searchPropertiesParams('rest').parse({ owner_tenure_min: 10, limit: 5 }),
      ),
      'county-wide',
    );
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((p) => p.distance_miles === null)).toBe(true);
    const out = await q.searchProperties(sp({ lat: 40.7, lon: -74.0 }));
    expect(out).toMatchObject({ total: 0, items: [], area_note: 'outside Travis County' });
  });

  it('stale and malformed cursors are 400', async () => {
    const r = await q.searchProperties(sp({ roof_age_min: 15, open_permits: true, limit: 5 }));
    const old = Buffer.from(JSON.stringify({ d: 'another-deploy', a: q.today(), o: 5 })).toString(
      'base64url',
    );
    await expect(q.searchProperties(sp({ cursor: old, open_permits: true }))).rejects.toMatchObject(
      { status: 400, code: 'stale_cursor' },
    );
    const yesterday = Buffer.from(
      JSON.stringify({ d: q.deployId, a: '2000-01-01', o: 5 }),
    ).toString('base64url');
    await expect(
      q.searchProperties(sp({ cursor: yesterday, open_permits: true })),
    ).rejects.toMatchObject({ code: 'stale_cursor' });
    await expect(
      q.searchProperties(sp({ cursor: 'not a cursor', open_permits: true })),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' });
    expect(r.next_cursor).not.toBeNull();
  });

  it('property detail by id and by geo id, with embedded permits, owner and provenance', async () => {
    const d = expectValid(
      PropertyDetail,
      await q.getProperty({ property_id: s.propertyId }),
      'property',
    );
    expect(d.owner?.owner_name).toBeTruthy();
    expect(d.permits.length).toBeGreaterThan(0);
    expect(d.permits_total).toBeGreaterThanOrEqual(d.permits.length);
    expect(d.unpublished_source?.evidence_state).toBe('confirmed_present');
    expect(d.source.run_id).toBe('20261020T200236Z-t5-full');
    const g = expectValid(PropertyDetail, await q.getProperty({ geo_id: s.geoId }), 'by geo id');
    expect(g.property_id).toBe(s.propertyId);
    const short = await q.getProperty({ property_id: s.openPropertyId }, 2);
    expect(short.permits.length).toBeLessThanOrEqual(2);
    expect(short.permits_truncated).toBe(short.permits_total > 2);
    await expect(q.getProperty({ property_id: 'nope' })).rejects.toMatchObject({ status: 404 });
  });

  it('permit search: status groups, roofing only, durations, radius and a single property', async () => {
    const params = (o: object) =>
      searchPermitsParams('rest').parse({
        lat: s.center.lat,
        lon: s.center.lon,
        radius_miles: 8,
        ...o,
      });
    const r = expectValid(
      PermitSearchResponse,
      await q.searchPermits(params({ limit: 50 })),
      'permits',
    );
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((p) => p.is_roofing && ['open', 'stalled'].includes(p.status_group))).toBe(
      true,
    );
    expect(r.items.every((p) => typeof p.distance_miles === 'number')).toBe(true);
    const rank = (g: string) => ['open', 'stalled', 'closed', 'needs_review'].indexOf(g);
    expect(r.items.map((p) => rank(p.status_group))).toEqual(
      [...r.items.map((p) => rank(p.status_group))].sort((a, b) => a - b),
    );
    const open = r.items.find((p) => p.status_group === 'open')!;
    expect(open.open_duration_basis).toBe('today');
    expect(open.open_duration_days).toBeGreaterThanOrEqual(0);
    const st = await q.searchPermits(
      params({ status_group: ['stalled'], radius_miles: 25, limit: 10 }),
    );
    expect(st.items.length).toBeGreaterThan(0);
    for (const p of st.items) {
      expect(p.open_duration_basis).toMatch(/^(expires_date|statusdate)$/);
      expect(p.expires_date === null || p.days_since_expiry !== null).toBe(true);
    }
    const long = expectValid(
      PermitSearchResponse,
      await q.searchPermits(params({ min_open_years: 5, limit: 20 })),
      'long open',
    );
    expect(long.items.length).toBeGreaterThan(0);
    expect(long.items.every((p) => (p.open_duration_days ?? 0) >= 5 * 365)).toBe(true);
    const mine = expectValid(
      PermitSearchResponse,
      await q.searchPermits(
        searchPermitsParams('rest').parse({
          property_id: s.propertyId,
          status_group: 'open,stalled,closed,needs_review'.split(','),
          roofing_only: false,
        }),
      ),
      'one property',
    );
    expect(mine.items.every((p) => p.property_id === s.propertyId)).toBe(true);
    expect(mine.items.every((p) => p.distance_miles === undefined)).toBe(true);
    const nr = expectValid(
      PermitSearchResponse,
      await q.searchPermits(
        searchPermitsParams('rest').parse({
          status_group: ['needs_review'],
          roofing_only: false,
          limit: 5,
        }),
      ),
      'needs review',
    );
    expect(nr.items.every((p) => p.status_group === 'needs_review')).toBe(true);
  });

  it('a completed_date closes a permit whose printed status maps to open or stalled', async () => {
    const rows = async (sql: string) =>
      (await q.conn.runAndReadAll(sql)).getRowObjectsJson() as Record<string, string>[];
    expect(
      await rows(
        `SELECT permit_id FROM permits WHERE status_group IN ('open', 'stalled') AND completed_date IS NOT NULL`,
      ),
    ).toEqual([]);
    const [closed] = await rows(
      `SELECT permit_id FROM permits WHERE status_group_basis = 'completed_date' ORDER BY permit_id LIMIT 1`,
    );
    expect(closed).toBeDefined();
    const p = expectValid(
      PermitDetail,
      await q.getPermit(String(closed!.permit_id)),
      'closed permit',
    );
    expect(p).toMatchObject({ status_group: 'closed', status_group_basis: 'completed_date' });
    expect(p.completed_date).not.toBeNull();
    expect(p.open_duration_days).toBeNull();
    const long = await q.searchPermits(
      searchPermitsParams('rest').parse({ min_open_years: 5, radius_miles: 25, limit: 500 }),
    );
    expect(long.items.length).toBeGreaterThan(0);
    expect(long.items.filter((x) => x.completed_date !== null)).toEqual([]);
  });

  it('property search roof_work_class limits the permit signal to those classes', async () => {
    const classes = ['primary_roof_replacement', 'repair_or_coating'];
    const all = await q.searchProperties(sp({ roof_age_min: 0, open_permits: true, limit: 500 }));
    const some = expectValid(
      PropertySearchResponse,
      await q.searchProperties(
        searchPropertiesParams('rest').parse(
          coerceQuery(searchPropertiesParams('rest'), {
            lat: String(s.center.lat),
            lon: String(s.center.lon),
            radius_miles: '8',
            roof_age_min: '0',
            roof_work_class: classes.join(','),
            limit: '500',
          }),
        ),
      ),
      'replacement and repair',
    );
    expect(some.items.length).toBeGreaterThan(0);
    expect(some.total).toBeLessThan(all.total);
    for (const row of some.items) {
      const d = await q.getProperty({ property_id: row.property_id });
      const signal = d.permits.filter(
        (p) => classes.includes(p.roof_work_class) && ['open', 'stalled'].includes(p.status_group),
      );
      expect(signal.length, row.property_id).toBeGreaterThan(0);
      expect(row.roofing_permit_counts.open, row.property_id).toBe(
        signal.filter((p) => p.status_group === 'open').length,
      );
      if (row.match_reasons?.includes('long_open_roofing_permit'))
        expect(
          signal.some((p) => p.completed_date === null && (p.open_duration_days ?? 0) >= 5 * 365),
          row.property_id,
        ).toBe(true);
    }
    expect(
      searchPropertiesParams('rest').safeParse({ open_permits: true, roof_work_class: ['other'] })
        .success,
    ).toBe(false);
  });

  it('a contractor phone with fewer than 10 digits is null', async () => {
    const one = async (cond: string) =>
      (
        (
          await q.conn.runAndReadAll(
            `SELECT permit_id FROM permits WHERE contractor_attribution_key IS NOT NULL AND contractor_phone IS NOT NULL
             AND length(regexp_replace(contractor_phone, '[^0-9]', '', 'g')) ${cond} ORDER BY permit_id LIMIT 1`,
          )
        ).getRowObjectsJson() as { permit_id: string }[]
      )[0];
    const short = await one('< 10');
    expect(short).toBeDefined();
    expect((await q.getPermit(short!.permit_id)).contractor?.phone).toBeNull();
    const full = await one('>= 10');
    expect((await q.getPermit(full!.permit_id)).contractor?.phone).toMatch(/\d/);
  });

  it('permit text search: aliases, stemming, match mode, snippets and scores', async () => {
    const t = (o: object) => textSearchParams('rest').parse(o);
    const a = expectValid(
      PermitTextSearchResponse,
      await q.searchPermitText(t({ q: 're-roof' })),
      're-roof',
    );
    expect(a.total).toBeGreaterThan(0);
    for (const x of a.items) {
      expect(x.match_snippet?.text.length).toBeGreaterThan(0);
      expect(x.match_snippet!.text.length).toBeLessThanOrEqual(240);
      expect(typeof x.bm25_score).toBe('number');
    }
    expect([...a.items.map((x) => x.bm25_score!)]).toEqual(
      [...a.items.map((x) => x.bm25_score!)].sort((x, y) => y - x),
    );
    // the three spellings find the same permits
    const b = await q.searchPermitText(t({ q: 'reroof' }));
    const c = await q.searchPermitText(t({ q: 're roof' }));
    expect(b.total).toBe(a.total);
    expect(c.total).toBe(a.total);
    // stopwords are dropped from the query; `all` requires every remaining term, `any` any of them
    const stop = await q.searchPermitText(t({ q: 'the reroof of the house' }));
    const any = await q.searchPermitText(t({ q: 'reroof zzzzqqqq', match: 'any' }));
    const all = await q.searchPermitText(t({ q: 'reroof zzzzqqqq', match: 'all' }));
    expect(stop.total).toBeGreaterThan(0);
    expect(any.total).toBeGreaterThan(0);
    expect(all.total).toBe(0);
    const near = expectValid(
      PermitTextSearchResponse,
      await q.searchPermitText(
        t({ q: 'hail', lat: s.center.lat, lon: s.center.lon, radius_miles: 25, limit: 5 }),
      ),
      'hail near',
    );
    expect(near.items.every((x) => typeof x.distance_miles === 'number')).toBe(true);
    expect((await q.searchPermitText(t({ q: 'the of' }))).total).toBe(0);
    const roofOnly = await q.searchPermitText(t({ q: 'roof', roofing_only: true, limit: 20 }));
    expect(roofOnly.items.every((x) => x.is_roofing)).toBe(true);
  });

  it('permit and contractor details', async () => {
    const p = expectValid(PermitDetail, await q.getPermit(s.permitId), 'permit');
    expect(p.applicant).toBeNull();
    expect(p.property?.property_id).toBe(p.property_id);
    expect(p.bbb.status).toBe('blocked');
    await expect(q.getPermit('0000-000000 XX')).rejects.toMatchObject({ status: 404 });
    const c = expectValid(
      Contractor,
      await q.getContractor(s.contractorWithRegistry),
      'contractor',
    );
    expect(c.registry_candidates.length).toBeGreaterThan(0);
    expect(
      c.registry_candidates.every(
        (r) => r.status === 'candidate' && r.match_method === 'exact_unique_normalized_name',
      ),
    ).toBe(true);
    expect(c.official_identity).toBeNull();
    const l = expectValid(
      Contractor,
      await q.getContractor(s.contractorWithLicense),
      'contractor with license',
    );
    expect(l.license_candidates?.length).toBeGreaterThan(0);
    await expect(q.getContractor('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('business and license lookups: name, number, prefix, scope and source filters', async () => {
    const b = expectValid(
      BusinessSearchResponse,
      await q.searchBusinesses(businessSearchParams('rest').parse({ q: s.businessName })),
      'businesses by name',
    );
    expect(b.total).toBeGreaterThan(0);
    expect(
      b.items.every(
        (x) => x.record_cid === null && x.unpublished_source.evidence_state === 'confirmed_present',
      ),
    ).toBe(true);
    const n = expectValid(
      BusinessSearchResponse,
      await q.searchBusinesses(businessSearchParams('rest').parse({ number: s.businessNumber })),
      'businesses by number',
    );
    expect(n.items.map((x) => x.business_record_id)).toContain(s.businessId);
    const pre = await q.searchBusinesses(
      businessSearchParams('rest').parse({
        q: s.businessName.slice(0, 4),
        match: 'prefix',
        limit: 5,
      }),
    );
    expect(pre.items.length).toBeGreaterThan(0);
    const withheld = await q.conn.runAndReadAll(
      `SELECT name FROM business_records WHERE record_id_withheld IS NOT NULL LIMIT 1`,
    );
    const wname = (withheld.getRowObjectsJson()[0] as { name: string }).name;
    const w = await q.searchBusinesses(
      businessSearchParams('rest').parse({ q: wname, source: ['tx-comptroller-sales-tax'] }),
    );
    expect(
      w.items.some((x) => x.record_id_withheld === 'individual_owner' && x.record_id === null),
    ).toBe(true);
    expect(JSON.stringify(w.items)).not.toMatch(/"taxpayer_number"/);
    const ooc = await q.searchBusinesses(
      businessSearchParams('rest').parse({ q: s.businessName, scope: 'out_of_county' }),
    );
    expect(ooc.items.every((x) => x.scope === 'out_of_county')).toBe(true);
    expectValid(BusinessRecord, await q.getBusiness(s.businessId), 'business');
    await expect(q.getBusiness('nope')).rejects.toMatchObject({ status: 404 });

    const l = expectValid(
      LicenseSearchResponse,
      await q.searchLicenses(licenseSearchParams('rest').parse({ q: s.licenseName })),
      'licenses by name',
    );
    expect(l.total).toBeGreaterThan(0);
    const ln = expectValid(
      LicenseSearchResponse,
      await q.searchLicenses(
        licenseSearchParams('rest').parse({ license_number: s.licenseNumber }),
      ),
      'licenses by number',
    );
    expect(ln.items.map((x) => x.license_record_id)).toContain(s.licenseId);
    expectValid(LicenseRecord, await q.getLicense(s.licenseId), 'license');
    await expect(q.getLicense('nope')).rejects.toMatchObject({ status: 404 });
    const types = await q.conn.runAndReadAll(`SELECT DISTINCT license_type FROM license_records`);
    expect(types.getRowObjectsJson().length).toBeGreaterThan(1);
  });

  it('a permit that prints no contractor has no attribution key and a null contractor', async () => {
    const r = (
      await q.conn.runAndReadAll(
        `SELECT permit_id FROM permits WHERE contractor_attribution_key IS NULL LIMIT 1`,
      )
    ).getRowObjectsJson() as { permit_id: string }[];
    expect(r.length).toBe(1);
    const p = expectValid(
      PermitDetail,
      await q.getPermit(r[0]!.permit_id),
      'permit without contractor',
    );
    expect(p.contractor).toBeNull();
    const none = (
      await q.conn.runAndReadAll(
        `SELECT count(*) AS n FROM contractors WHERE contractor_attribution_key IS NULL OR company_name IS NULL AND phone IS NULL AND printed_names = []`,
      )
    ).getRowObjectsJson() as { n: string }[];
    expect(Number(none[0]!.n)).toBe(0);
  });

  it('the veteran-owned taxid is not served', async () => {
    const r = (
      await q.conn.runAndReadAll(
        `SELECT count(*) AS n FROM business_records WHERE printed LIKE '%"taxid"%'`,
      )
    ).getRowObjectsJson() as { n: string }[];
    expect(Number(r[0]!.n)).toBe(0);
  });

  it('privacy: no sole-owner taxpayer number and no personal license contact fields anywhere', async () => {
    const v = await q.conn.runAndReadAll('SELECT count(*) AS n FROM v_privacy_violations');
    expect(Number((v.getRowObjectsJson()[0] as { n: string }).n)).toBe(0);
  });

  it('run summary carries meta and runs', async () => {
    const r = await q.getRunSummary();
    expect(r.meta.deploy.deploy_id).toBe(q.deployId);
    expect(r.runs.length).toBe(3);
  });
});
