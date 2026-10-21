import { rmSync, statSync } from 'node:fs';
import { readPostLoadSql, readSchemaSql } from '@travis/query';
import { Db, q } from './db.js';

export interface FixtureReport {
  bytes: number;
  counts: Record<string, number>;
}

/** Central Austin (the Texas State Capitol); every pool below is measured from here. */
const CENTER = { lat: 30.2747, lon: -97.7404 };
const haversine = (lat: string, lon: string) =>
  `(3958.8 * 2 * asin(sqrt(least(1.0, pow(sin(radians(${lat} - ${CENTER.lat}) / 2), 2) + cos(radians(${CENTER.lat})) * cos(radians(${lat})) * pow(sin(radians(${lon} - ${CENTER.lon}) / 2), 2)))))`;

/**
 * A small REAL subset of the full database: properties around central Austin with roofs older than 15 years, open and
 * stalled (including long-open) roofing permits with printed contractors, long-tenure owners, absentee and out-of-area
 * owners, permits that text search finds, contractors with registry and license candidates, and business and license
 * records. No row is generated; every row is copied from the full database with its provenance.
 */
export async function buildFixture(o: {
  fullDb: string;
  outFile: string;
  log: (m: string) => void;
}): Promise<FixtureReport> {
  const tmp = `${o.outFile}.tmp`;
  rmSync(tmp, { force: true });
  rmSync(`${tmp}.wal`, { force: true });
  // a 16 KiB block size: with the default 256 KiB the many small tables and indexes would pad the file to about 26 MB
  const db = await Db.open(':memory:', { threads: '4', memory_limit: '4GB' });
  await db.run(`ATTACH ${q(tmp)} AS fx (BLOCK_SIZE 16384)`);
  await db.run('USE fx');
  await db.run(readSchemaSql());
  await db.run(`ATTACH ${q(o.fullDb)} AS src (READ_ONLY)`);
  const today = new Date().toISOString().slice(0, 10);

  await db.run(
    `CREATE TEMP TABLE small AS SELECT property_id FROM src.properties WHERE permit_count BETWEEN 1 AND 60`,
  );
  const pools: [string, string][] = [
    [
      'aged roofs near the center',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 2.5 AND p.roof_age_years > 15 ORDER BY hash(p.property_id) LIMIT 110`,
    ],
    [
      'open roofing permits, long-open first',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 8 AND p.roofing_open_count > 0 ORDER BY p.open_roofing_min_open_since ASC, p.property_id LIMIT 25`,
    ],
    [
      'open roofing permits, recent',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 5 AND p.roofing_open_count > 0 ORDER BY hash(p.property_id) LIMIT 30`,
    ],
    [
      'stalled roofing permits',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 8 AND p.roofing_stalled_count > 0 ORDER BY p.stalled_roofing_max_duration_days DESC, p.property_id LIMIT 25`,
    ],
    [
      'owners with tenure over 10 years',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 7 AND p.deed_date < DATE '${today}' - INTERVAL 10 YEAR ORDER BY hash(p.property_id) LIMIT 45`,
    ],
    [
      'absentee owners',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 2.5 AND p.owner_absentee ORDER BY hash(p.property_id) LIMIT 25`,
    ],
    [
      'out-of-area owners',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 2.5 AND p.owner_out_of_area ORDER BY hash(p.property_id) LIMIT 25`,
    ],
    [
      're-roof and hail text hits',
      `SELECT DISTINCT pr.property_id FROM src.permits pr JOIN small USING (property_id) WHERE pr.is_text_indexed AND pr.radius_lat IS NOT NULL AND ${haversine('pr.radius_lat', 'pr.radius_lon')} <= 8 AND (lower(pr.description) LIKE '%re-roof%' OR lower(pr.description) LIKE '%reroof%' OR lower(pr.description) LIKE '%hail%') ORDER BY hash(pr.property_id) LIMIT 25`,
    ],
    [
      'contractors with a registry candidate',
      `SELECT DISTINCT pr.property_id FROM src.permits pr JOIN small USING (property_id) WHERE pr.contractor_attribution_key IN (SELECT contractor_attribution_key FROM src.registry_candidates GROUP BY 1 ORDER BY hash(contractor_attribution_key) LIMIT 25) ORDER BY hash(pr.property_id) LIMIT 25`,
    ],
    [
      'contractors with a license candidate',
      `SELECT DISTINCT pr.property_id FROM src.permits pr JOIN small USING (property_id) WHERE pr.contractor_attribution_key IN (SELECT contractor_attribution_key FROM src.license_candidates GROUP BY 1 ORDER BY hash(contractor_attribution_key) LIMIT 25) ORDER BY hash(pr.property_id) LIMIT 25`,
    ],
    [
      'needs_review roofing',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.roofing_needs_review_count > 0 ORDER BY hash(p.property_id) LIMIT 6`,
    ],
    [
      'permit-basis coordinates',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.coordinate_basis = 'permit' ORDER BY hash(p.property_id) LIMIT 5`,
    ],
    [
      'no coordinates',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NULL ORDER BY hash(p.property_id) LIMIT 5`,
    ],
    [
      'reroof replacement anchors (high confidence)',
      `SELECT p.property_id FROM src.properties p JOIN small USING (property_id) WHERE p.lat IS NOT NULL AND ${haversine('p.lat', 'p.lon')} <= 4 AND p.roof_age_confidence = 'high' ORDER BY hash(p.property_id) LIMIT 20`,
    ],
  ];
  await db.run('CREATE TEMP TABLE sel (property_id VARCHAR PRIMARY KEY)');
  const counts: Record<string, number> = {};
  for (const [name, sql] of pools) {
    await db.run(`INSERT INTO sel SELECT property_id FROM (${sql}) ON CONFLICT DO NOTHING`);
    o.log(`  pool ${name}: selection now ${await db.scalar('SELECT count(*) FROM sel')}`);
  }

  const copy = async (table: string, where: string) => {
    await db.run(
      `INSERT INTO ${table} BY NAME SELECT * FROM src.${table}${where ? ` WHERE ${where}` : ''}`,
    );
    counts[table] = await db.scalar(`SELECT count(*) FROM ${table}`);
  };
  for (const t of [
    'deploy_reads',
    'meta_counts',
    'source_loads',
    'limitations',
    'unmapped_values',
    'runs',
    'manifests',
    'group_roots',
    'mirror_objects',
    'search_centers',
    'search_center_aliases',
  ])
    await copy(t, '');
  await db.run(
    `INSERT INTO deploy BY NAME SELECT * REPLACE ('fixture-' || deploy_id AS deploy_id) FROM src.deploy`,
  );
  counts.deploy = 1;
  await copy('properties', 'property_id IN (SELECT property_id FROM sel)');
  await copy('property_extras', 'property_id IN (SELECT property_id FROM sel)');
  await copy('roof_age_reference', 'property_id IN (SELECT property_id FROM sel)');
  await copy('permits', 'property_id IN (SELECT property_id FROM sel)');
  await copy('permit_text', 'permit_id IN (SELECT permit_id FROM permits)');
  await copy(
    'contractors',
    'contractor_attribution_key IN (SELECT contractor_attribution_key FROM permits)',
  );
  await copy(
    'registry_candidates',
    'contractor_attribution_key IN (SELECT contractor_attribution_key FROM permits)',
  );
  await copy(
    'license_candidates',
    'contractor_attribution_key IN (SELECT contractor_attribution_key FROM permits)',
  );
  // the records the candidates point at, plus a sample of each source so the lookup endpoints return rows
  await db.run(`CREATE TEMP TABLE bsel AS SELECT business_record_id FROM registry_candidates
    UNION SELECT business_record_id FROM (SELECT business_record_id, row_number() OVER (PARTITION BY source ORDER BY hash(business_record_id)) rn FROM src.business_records WHERE scope = 'travis') WHERE rn <= 120
    UNION SELECT business_record_id FROM (SELECT business_record_id FROM src.business_records WHERE record_id_withheld IS NOT NULL ORDER BY hash(business_record_id) LIMIT 20)`);
  await copy('business_records', 'business_record_id IN (SELECT business_record_id FROM bsel)');
  await db.run(`CREATE TEMP TABLE lsel AS SELECT license_record_id FROM license_candidates
    UNION SELECT license_record_id FROM (SELECT license_record_id, row_number() OVER (PARTITION BY source ORDER BY hash(license_record_id)) rn FROM src.license_records) WHERE rn <= 100`);
  await copy('license_records', 'license_record_id IN (SELECT license_record_id FROM lsel)');
  await db.run('LOAD fts');
  await db.run(readPostLoadSql());
  await db.run('DETACH src');
  counts.violations = await db.scalar('SELECT count(*) FROM v_privacy_violations');
  if (counts.violations) throw new Error('privacy violations in the fixture');
  await db.run('USE memory');
  await db.run('DETACH fx');
  db.close();
  rmSync(o.outFile, { force: true });
  const { renameSync } = await import('node:fs');
  renameSync(tmp, o.outFile);
  rmSync(`${tmp}.wal`, { force: true });
  const bytes = statSync(o.outFile).size;
  if (bytes > 18_000_000) throw new Error(`fixture is ${bytes} bytes; the limit is about 18 MB`);
  return { bytes, counts };
}
