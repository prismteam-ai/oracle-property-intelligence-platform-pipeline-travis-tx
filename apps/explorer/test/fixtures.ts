// Real Travis County values only. Sources: runs/20261018T143520Z-t5-full.json, publish/.../manifest.json (read from the
// repo at test time), the published Parquet parts of shard s0015 (property 196364 and permit 2014-132181 BP, record /
// property / data-group CIDs), that shard's seed.csv (situs, coordinates, owner and mailing text) and the Austin permit
// export partition BP-2014 (status, dates, printed contractor).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Meta, PermitSummary, PropertySummary, Run } from '@travis/contract';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const root = join(import.meta.dirname, '..', '..', '..');
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));

export const RUN_ID = '20261018T143520Z-t5-full';
export const MANIFEST_CID = 'bafybeid6jqqzpo2ods6iehz5vgud2ust4fykfiozspzxb3xjmqiup36ud4';

let manifestCache: Record<string, unknown> | undefined;
export const realManifest = (): Record<string, unknown> =>
  (manifestCache ??= readJson(`publish/${RUN_ID}/manifest.json`));
const realRun = readJson(`runs/${RUN_ID}.json`) as Loose;

interface Car {
  kind: 'archive' | 'tables';
  group: string;
  shard: string;
  root_cid: string;
  schema_cid: string;
}
/** `<group>/<shard>` → {cid, schema, tables}, from the manifest's CARs (archive root and tables root per shard). */
export function realGroups(): Record<string, { cid: string; schema: string; tables: string }> {
  const groups: Record<string, { cid: string; schema: string; tables: string }> = {};
  for (const car of (realManifest().cars as Car[]) ?? []) {
    const key = `${car.group}/${car.shard}`;
    const entry = (groups[key] ??= { cid: '', schema: car.schema_cid, tables: '' });
    if (car.kind === 'archive') entry.cid = car.root_cid;
    else entry.tables = car.root_cid;
  }
  return groups;
}

const TCAD_URL =
  'https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip';
const AUSTIN_URL = 'https://data.austintexas.gov/resource/3syk-w9eu.csv';
const FETCHED_TCAD = '2026-10-16T17:42:52Z';

const capturedSources = (
  realRun.sources as { sha256: string | null; url: string | null; fetched_at: string | null }[]
).filter((s) => s.sha256 && s.url && s.fetched_at);
const objectLimitations = (realRun.limitations as { records_request: unknown }[]).filter(
  (l) => l.records_request === null || typeof l.records_request === 'object',
);

export function runFixture() {
  return Run.parse({
    run_id: RUN_ID,
    started_at: realRun.started_at,
    finished_at: realRun.finished_at,
    sources: capturedSources,
    limitations: objectLimitations,
    deltas: realRun.deltas,
    groups: realGroups(),
    manifest_cid: MANIFEST_CID,
  });
}

/** The pilot run (runs/20261017T072132Z-pilot.json) has no published manifest: it appears in history without one. */
export function pilotRunFixture() {
  const pilot = readJson('runs/20261017T072132Z-pilot.json') as Loose;
  return Run.parse({
    run_id: pilot.run_id,
    started_at: pilot.started_at,
    finished_at: pilot.finished_at,
    groups: {},
  });
}

export function metaFixture() {
  return Meta.parse({
    county: 'Travis County, TX',
    fips: '48453',
    run: { run_id: RUN_ID, started_at: realRun.started_at, finished_at: realRun.finished_at },
    counts: {
      // /v1/meta.counts of the full deploy e17c90aa0b91ccae (2026-10-20), by_source omitted.
      properties: 441939,
      with_coordinates: 377962,
      with_roof_age: 390212,
      permits: 2276838,
      permits_joined_to_property: 1986484,
      permits_unmatched: 290315,
      permits_needs_review: 445,
      roofing_permits: 196002,
      open_roofing_permits: 4365,
      stalled_roofing_permits: 6377,
      roofing_permits_needs_review: 5683,
      owners: 441939,
      permit_contractor_attributions: 52773,
      registry_rows_loaded: 349278,
      bbb_profiles: 0,
      business_records: 400661,
      license_records: 30529,
      contractors_with_registry_candidate: 11893,
      contractors_with_license_candidate: 5536,
      by_source: {},
    },
    groups: realGroups(),
    manifest_cid: MANIFEST_CID,
    atlas: null,
    evidence_states: realRun.evidence_states,
    unlinked_reasons: realRun.unlinked_reasons,
    limitations: objectLimitations,
    cli_commit: realRun.cli_commit ?? 'unknown',
    lexicon_manifest_url:
      realRun.lexicon_manifest_url ?? 'https://lexicon.elephant.xyz/api/manifest',
    kit_commit: realRun.kit_commit ?? 'unknown',
    deploy: {
      deploy_id: 'fixture',
      inputs_sha256: '4a0f3231ed7131e925f484aeb6d1448f2586ac5c9dc520b974cff678f8c009fb',
      deployed_at: '2026-10-20T00:00:00Z',
      server_commit: 'fixture',
      duckdb_version: '1.5.6',
      duckdb_sha256: '4a0f3231ed7131e925f484aeb6d1448f2586ac5c9dc520b974cff678f8c009fb',
      text_index: {
        rows: 2380707,
        config: {
          stemmer: 'porter',
          stopwords: 'english',
          ignore: '(\\.|[^a-z])+',
          lower: true,
          strip_accents: true,
        },
        alias_version: 'fixture',
      },
      reads: [],
    },
    mcp: { protocol_version: '2025-06-18' },
    attribution_key_version: 'fixture',
    limits: {
      stage: { rate: 20, burst: 40 },
      routes: {
        '/v1/agent/chat': { rate: 1, burst: 3 },
        '/v1/permits/text-search': { rate: 5, burst: 10 },
      },
      mcp: { search_permit_text: { rate: 5, burst: 10 } },
      chat: { max_output_tokens: 1500, turn_deadline_seconds: 25 },
    },
  });
}

const tcadSource = (recordId: string) => ({
  dataset: 'tcad-2026-certified-appraisal-export',
  record_id: recordId,
  url: TCAD_URL,
  fetched_at: FETCHED_TCAD,
  run_id: RUN_ID,
  request_identifier: recordId,
  source_http_request: { method: 'GET', url: TCAD_URL, multiValueQueryString: {} },
});

/** TCAD property 196364 / geo_id 0207200906: 1006 LOTT AVE 78721, built 1961 (shard s0015 Parquet + seed.csv). */
export function propertyFixture() {
  return PropertySummary.parse({
    property_id: '196364',
    geo_id: '0207200906',
    address: { line1: '1006 LOTT AVE', city: null, zip: '78721' },
    lat: 30.268135415877754,
    lon: -97.68377197022404,
    coordinate_basis: 'parcel_centroid',
    year_built: 1961,
    roof_year: 1961,
    roof_age_years: 65,
    roof_age_basis: 'year_built',
    roof_age_confidence: 'low',
    roof_age_anchor: { source_field: 'year_built' },
    roof_age_as_of: '2026-10-20',
    roof_age_caveats: ['year_built is the only roof-age anchor; no completed re-roof permit.'],
    last_roofing_permit: {
      permit_id: '2014-132181 BP',
      date: null,
      status_group: 'stalled',
      roof_work_class: 'primary_roof_replacement',
    },
    roofing_permit_counts: { open: 0, stalled: 1, closed: 0, needs_review: 0 },
    owner_tenure_years: null,
    owner_absentee: false,
    owner_out_of_area: false,
    has_bbb_contractor: false,
    source: tcadSource('196364'),
    record_cid: 'baguqeerapajlmafvtkzfnkt4pwp2ekjkffgvmezsp3eb3365sgd4xq5rxrla',
    property_cid: 'baguqeerankuiv5rxain7thn4otkek7uygvukargrfgsqdtmdlch4e4pl6eoa',
    data_group_cid: 'bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq',
    unpublished_source: null,
    distance_miles: 3.1,
    match_reasons: ['aged_roof'],
  });
}

const PERMIT_ROW =
  '2014-132181 BP,Building Permit,R- 435 Renovations/Remodel,Repair,Re-roof to include deckboards and rotted wood.  Replace toilet shut offs and water lines. Wireless battery powered smoke alarms,0207200906,2014-12-12,2014-12-12,Expired,2017-03-01,2017-02-28';

/** Austin permit 2014-132181 BP on geo_id 0207200906: Expired, no completed date → stalled. */
export function permitFixture() {
  return PermitSummary.parse({
    permit_id: '2014-132181 BP',
    geo_id: '0207200906',
    property_id: '196364',
    property_link: { match_method: 'exact', normalization_version: null, confidence: 'exact' },
    permit_type: 'Building Permit',
    permit_class: 'R- 435 Renovations/Remodel',
    work_class: 'Repair',
    description:
      'Re-roof to include deckboards and rotted wood.  Replace toilet shut offs and water lines. Wireless battery powered smoke alarms',
    roof_work_class: 'primary_roof_replacement',
    work_classifier_version: 'fixture',
    is_roofing: true,
    is_reroof: true,
    status: 'Expired',
    status_group: 'stalled',
    status_observed_at: '2026-10-17T12:24:23Z',
    status_source: 'indexed',
    applied_date: '2014-12-12',
    issued_date: '2014-12-12',
    expires_date: '2017-02-28',
    completed_date: null,
    completed_date_evidence: 'unknown',
    open_since: '2014-12-12',
    open_since_basis: 'issued_date',
    open_duration_days: 809,
    open_duration_basis: 'expires_date',
    open_duration_as_of: '2026-10-20',
    days_since_expiry: 3521,
    contractor: {
      contractor_attribution_key: createHash('sha256')
        .update('Valdez Remodeling & Weatherization Inc.\u001f5129265700')
        .digest('hex')
        .slice(0, 32),
      identity_status: 'source_name_attribution',
      printed_name: 'Christine Valdez',
      company_name: 'Valdez Remodeling & Weatherization Inc.',
      trade: 'General Contractor',
      phone: '5129265700',
    },
    bbb: {
      rating: null,
      status: 'blocked',
      incomplete_reason: 'http_403_source_block',
      note: 'BBB returns a bot challenge and 403 to scripted access',
    },
    lat: 30.268135415877754,
    lon: -97.68377197022404,
    source: {
      dataset: 'austin-issued-construction-permits/3syk-w9eu',
      record_id: '2014-132181 BP',
      url: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=11263281',
      fetched_at: '2026-10-17T12:24:23Z',
      run_id: RUN_ID,
      request_identifier: '196364',
      source_http_request: { method: 'GET', url: AUSTIN_URL, multiValueQueryString: {} },
    },
    record_cid: 'baguqeerar7lk7r6okyzk7veqoaou4wkksna3a75znpfc3u64jlv5zh3lzozq',
    property_cid: 'baguqeerankuiv5rxain7thn4otkek7uygvukargrfgsqdtmdlch4e4pl6eoa',
    data_group_cid: 'bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu',
    unpublished_source: {
      dataset: 'austin-issued-construction-permits/3syk-w9eu',
      url: AUSTIN_URL,
      fetched_at: '2026-10-17T12:24:23Z',
      source_http_request: { method: 'GET', url: AUSTIN_URL, multiValueQueryString: {} },
      row_sha256: createHash('sha256').update(PERMIT_ROW).digest('hex'),
      evidence_state: 'unknown',
      fields: ['status', 'expires_date', 'completed_date'],
    },
    distance_miles: 3.1,
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface Mock {
  fetch: typeof fetch;
  calls: string[];
}

/** A fetch that answers the v1 routes from the fixtures; `overrides` replace a route by path prefix. */
export function mockApi(
  overrides: Record<string, (url: URL, init?: RequestInit) => Response> = {},
): Mock {
  const calls: string[] = [];
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (url.pathname.startsWith(prefix)) return fn(url, init);
    }
    const path = url.pathname;
    if (path === '/v1/meta') return json(200, metaFixture());
    if (path === '/v1/runs') return json(200, { items: [runFixture(), pilotRunFixture()] });
    if (path === `/v1/runs/${RUN_ID}/manifest`) return json(200, realManifest());
    if (path === '/v1/properties/search') {
      return json(200, {
        items: [propertyFixture()],
        total: 1,
        next_cursor: null,
        area_note: null,
      });
    }
    if (path === '/v1/permits/search' || path === '/v1/permits/text-search') {
      return json(200, { items: [permitFixture()], total: 1, next_cursor: null, area_note: null });
    }
    if (path === '/v1/search-centers') {
      // The Austin situs-city centroid is computed by the API from the roll; this fixture reuses a real parcel point.
      return json(200, {
        items: [
          {
            name: 'AUSTIN',
            kind: 'city',
            match_type: 'exact',
            lat: 30.268135415877754,
            lon: -97.68377197022404,
            parcel_count: 1,
            basis: 'fixture: centroid of 1 parcel with situs city AUSTIN',
          },
        ],
      });
    }
    if (path === '/v1/agent/chat') {
      return json(503, {
        error: 'agent_unavailable',
        reason: 'model_unavailable',
        request_id: 'fixture-request',
      });
    }
    if (path === '/v1/mcp') {
      return json(200, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'search_properties',
              description: 'Properties by radius, roof age, permits and owner signals.',
            },
            {
              name: 'search_permits',
              description: 'Permits by radius, status group, roofing class and years open.',
            },
          ],
        },
      });
    }
    return json(404, { error: 'not_found', request_id: 'fixture' });
  };
  return { fetch: handler as typeof fetch, calls };
}
