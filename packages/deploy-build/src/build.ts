import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOFING_CLASSES, classSignalColumns, readPostLoadSql, readSchemaSql } from '@travis/query';
import { Db, q, qlist } from './db.js';
import { KIT_DATA, RUN_ID } from './env.js';
import { loadKit, type Kit } from './kit.js';
import { insertDeployRow, loadMeta } from './meta.js';
import { loadRegistry } from './registry.js';
import { reconcile, type ReconcileReport } from './reconcile.js';
import { ROOF_AGE_AS_OF, stagePermitsAndRoofAge, stageSeed } from './stage.js';
import { type VerifiedInputs } from './verify.js';

export interface BuildOptions {
  dbFile: string;
  workDir: string;
  verified: VerifiedInputs;
  deployId: string;
  inputsSha256: string;
  serverCommit: string;
  shards: string[];
  /** true when only a subset of shards is built (development): reconciliation against the T5 totals is skipped. */
  subset: boolean;
  memoryLimit?: string;
  threads?: number;
  log: (m: string) => void;
}

export interface BuildReport {
  timings: Record<string, number>;
  reconcile: ReconcileReport;
  textIndexRows: number;
  peakRssMb: number;
}

const GEO_TABLES = new Set(['geometry']);

async function loadLex(db: Db, o: BuildOptions): Promise<void> {
  const byTable = new Map<string, string[]>();
  for (const p of o.verified.parts) {
    if (!o.shards.includes(p.shard)) continue;
    const key = `${p.group}\u0000${p.table}`;
    const l = byTable.get(key) ?? [];
    l.push(p.file);
    byTable.set(key, l);
  }
  for (const [key, files] of [...byTable.entries()].sort()) {
    const [group, table] = key.split('\u0000') as [string, string];
    const read = `read_parquet(${qlist(files)}, filename=true, union_by_name=true)`;
    const shardOf = `regexp_extract(filename, '/(s[0-9]{4})/', 1)`;
    if (table === 'properties') {
      await db.run(`INSERT INTO lex.properties_index
        SELECT ${q(group)} AS group_name, ${shardOf.replace('filename', 'u.filename')} AS shard, u.property_cid, u.schema_cid, u.data_group_cid
        FROM (UNPIVOT ${read} ON COLUMNS(* EXCLUDE (property_cid, filename)) INTO NAME schema_cid VALUE data_group_cid) u
        WHERE u.data_group_cid IS NOT NULL`);
      continue;
    }
    const target = `lex.${group === 'county' ? 'county' : 'pi'}_${table}`;
    const replacePolygon = GEO_TABLES.has(table) && group === 'county' ? ', polygon' : '';
    const polygonNull = replacePolygon ? `, NULL::VARCHAR AS polygon` : '';
    await db.run(`INSERT INTO ${target} BY NAME
      SELECT * EXCLUDE (filename${replacePolygon})${polygonNull}, ${shardOf} AS shard FROM ${read}`);
    o.log(`  ${target}: ${files.length} parts`);
  }
}

/** Creates `fts_main_permit_text` etc. */
async function postLoad(db: Db): Promise<void> {
  await db.run('LOAD fts');
  await db.run(readPostLoadSql());
}

export async function buildDatabase(o: BuildOptions): Promise<BuildReport> {
  const kit: Kit = await loadKit();
  const timings: Record<string, number> = {};
  const lap = (name: string, t0: number) => {
    timings[name] = Math.round(performance.now() - t0);
    o.log(`[${name}] ${(timings[name]! / 1000).toFixed(1)}s`);
  };
  mkdirSync(o.workDir, { recursive: true });
  rmSync(o.dbFile, { force: true });
  rmSync(`${o.dbFile}.wal`, { force: true });
  const db = await Db.open(o.dbFile, {
    memory_limit: o.memoryLimit ?? '18GB',
    threads: String(o.threads ?? 8),
    temp_directory: path.join(o.workDir, 'duckdb-tmp'),
    preserve_insertion_order: 'false',
  });
  const tmp = (n: string) => path.join(o.workDir, n);
  let t = performance.now();

  // ---- schema + lexicon mirror ---------------------------------------------------------------------------------------
  await db.run(readSchemaSql());
  const meta = await loadMeta(db, kit, o, tmp);
  o.log('loading the published lexicon tables');
  await loadLex(db, o);
  lap('lex', t);

  // ---- staging from the run's own files ------------------------------------------------------------------------------
  t = performance.now();
  const parcelRows = await db.rows<{ shard: string; id: string; built: string | null }>(
    `SELECT p.shard, p.parcel_identifier AS id, pr.property_structure_built_year AS built
       FROM lex.county_parcel p JOIN lex.county_property pr ON pr.parcel_identifier = p.parcel_identifier AND pr.shard = p.shard`,
  );
  const parcelsByShard = new Map<string, { id: string; builtYear: number | null }[]>();
  for (const r of parcelRows) {
    const l = parcelsByShard.get(r.shard) ?? [];
    l.push({ id: r.id, builtYear: r.built === null ? null : Number(r.built) });
    parcelsByShard.set(r.shard, l);
  }
  const seedFile = tmp('seed.ndjson');
  const seed = await stageSeed(kit, o.shards, seedFile);
  o.log(`  seed rows ${seed.rows}`);
  const permitsFile = tmp('permits.ndjson');
  const roofFile = tmp('roofage.ndjson');
  const staged = await stagePermitsAndRoofAge({
    kit,
    shards: o.shards,
    parcelsByShard,
    permitsFile,
    roofAgeFile: roofFile,
    log: o.log,
  });
  lap('stage', t);

  t = performance.now();
  await db.run(`CREATE TEMP TABLE seed_stage AS SELECT * FROM read_json(${q(seedFile)}, format='newline_delimited', columns={
    shard:'VARCHAR', property_id:'VARCHAR', geo_id:'VARCHAR', situs_num:'VARCHAR', situs_prefix:'VARCHAR', situs_street:'VARCHAR',
    situs_suffix:'VARCHAR', situs_unit:'VARCHAR', situs_city:'VARCHAR', situs_zip:'VARCHAR', owner_name:'VARCHAR', addr1:'VARCHAR',
    addr2:'VARCHAR', addr3:'VARCHAR', addr_city:'VARCHAR', addr_state:'VARCHAR', addr_zip:'VARCHAR', owner_confidential:'BOOLEAN',
    deed_dt:'VARCHAR', url:'VARCHAR', snapshot_at:'VARCHAR', request:'VARCHAR', row_sha256:'VARCHAR'})`);
  await db.run(`CREATE TEMP TABLE roofage_stage AS SELECT * FROM read_json(${q(roofFile)}, format='newline_delimited', columns={
    property_id:'VARCHAR', roof_age_as_of:'DATE', roof_year:'INTEGER', roof_age_years:'INTEGER', roof_age_basis:'VARCHAR',
    roof_age_confidence:'VARCHAR', anchor_permit_id:'VARCHAR', anchor_date:'DATE', anchor_date_field:'VARCHAR',
    anchor_year_built:'BOOLEAN', caveats:'VARCHAR[]'})`);
  await db.run(`CREATE TEMP TABLE permit_stage AS SELECT * FROM read_json(${q(permitsFile)}, format='newline_delimited', columns={
    permit_id:'VARCHAR', property_id:'VARCHAR', shard:'VARCHAR', link_match_method:'VARCHAR', link_normalization_version:'VARCHAR',
    link_confidence:'VARCHAR', source_url:'VARCHAR', geo_id:'VARCHAR', permit_type:'VARCHAR', permit_type_desc:'VARCHAR',
    permit_class:'VARCHAR', work_class:'VARCHAR', description:'VARCHAR', status:'VARCHAR', status_date:'DATE', applied_date:'DATE',
    issued_date:'DATE', expires_date:'DATE', completed_date:'DATE', completed_date_raw:'VARCHAR', completed_date_evidence:'VARCHAR',
    lat:'DOUBLE', lon:'DOUBLE', contractor_trade:'VARCHAR', contractor_company_name:'VARCHAR', contractor_full_name:'VARCHAR',
    contractor_phone:'VARCHAR', contractor_address1:'VARCHAR', contractor_address2:'VARCHAR', contractor_city:'VARCHAR',
    contractor_zip:'VARCHAR', contractor_attribution_key:'VARCHAR', roof_work_class:'VARCHAR', work_classifier_version:'VARCHAR',
    is_roofing:'BOOLEAN', is_reroof:'BOOLEAN', status_group:'VARCHAR', lifecycle_status:'VARCHAR', status_observed_at:'VARCHAR',
    capture_file:'VARCHAR', capture_row_index:'BIGINT', capture_row_sha256:'VARCHAR', capture_receipt_sha256:'VARCHAR'})`);
  // A completed_date closes a permit whose printed status still maps to open or stalled (decisions.md section 36); the
  // profile's own mapping stays in status_group_profile, which the reconciliation compares with the kit's.
  await db.run(`ALTER TABLE permit_stage ADD COLUMN status_group_profile VARCHAR`);
  await db.run(`UPDATE permit_stage SET status_group_profile = status_group,
    status_group = CASE WHEN status_group IN ('open', 'stalled') AND completed_date IS NOT NULL THEN 'closed' ELSE status_group END`);
  lap('stage-load', t);

  // ---- permits (without radius basis), then properties, then the radius basis ------------------------------------------
  t = performance.now();
  await db.run(`CREATE TEMP TABLE pi_root AS
    SELECT ix.shard, ix.property_cid, ix.data_group_cid FROM lex.properties_index ix
    JOIN group_roots g ON g.group_name = ix.group_name AND g.shard = ix.shard AND g.schema_cid = ix.schema_cid
    WHERE ix.group_name = 'property_improvement'`);
  await db.run(`CREATE TEMP TABLE county_root AS
    SELECT ix.shard, ix.property_cid, ix.data_group_cid FROM lex.properties_index ix
    JOIN group_roots g ON g.group_name = ix.group_name AND g.shard = ix.shard AND g.schema_cid = ix.schema_cid
    WHERE ix.group_name = 'county'`);
  await db.run(`CREATE TEMP TABLE permits_joined AS
    SELECT s.permit_id, s.property_id, pi.shard, pi.cid AS record_cid, pi.property_cid, r.data_group_cid, pi.request_identifier,
      pi.source_http_request, s.source_url, s.link_match_method, s.link_normalization_version, s.link_confidence, s.geo_id,
      s.permit_type, s.permit_type_desc, s.permit_class, s.work_class, s.description, s.status, s.status_date, s.applied_date,
      s.issued_date, s.expires_date, s.completed_date, s.completed_date_raw, s.completed_date_evidence, s.lat, s.lon,
      s.contractor_trade, s.contractor_company_name, s.contractor_full_name, s.contractor_phone, s.contractor_address1,
      s.contractor_address2, s.contractor_city, s.contractor_zip, s.contractor_attribution_key, s.roof_work_class,
      s.work_classifier_version, s.is_roofing, s.is_reroof, s.status_group, s.status_group_profile,
      CASE WHEN s.status_group <> s.status_group_profile THEN 'completed_date' ELSE 'status' END AS status_group_basis, s.lifecycle_status,
      coalesce(s.issued_date, s.applied_date) AS open_since,
      CASE WHEN s.issued_date IS NOT NULL THEN 'issued_date' WHEN s.applied_date IS NOT NULL THEN 'applied_date' END AS open_since_basis,
      CASE WHEN s.status_group = 'stalled' AND coalesce(s.issued_date, s.applied_date) IS NOT NULL THEN
        CASE WHEN s.expires_date IS NOT NULL THEN date_diff('day', coalesce(s.issued_date, s.applied_date), s.expires_date)
             WHEN s.status_date IS NOT NULL THEN date_diff('day', coalesce(s.issued_date, s.applied_date), s.status_date) END END AS static_duration_days,
      CASE WHEN s.status_group = 'stalled' AND coalesce(s.issued_date, s.applied_date) IS NOT NULL THEN
        CASE WHEN s.expires_date IS NOT NULL THEN 'expires_date' WHEN s.status_date IS NOT NULL THEN 'statusdate' END END AS static_duration_basis,
      s.status_observed_at, 'indexed' AS status_source,
      ${q('austin-issued-construction-permits/3syk-w9eu')} AS capture_dataset, s.capture_file, s.capture_row_index,
      cr.url AS capture_url, cr.fetched_at AS capture_fetched_at, cr.source_http_request AS capture_source_http_request,
      s.capture_row_sha256, s.capture_receipt_sha256, 'confirmed_present' AS capture_evidence_state,
      coalesce(s.permit_type, '') NOT IN ('EP', 'MP', 'PP') AS is_text_indexed
    FROM permit_stage s
    JOIN lex.pi_property_improvement pi ON pi.permit_number = s.permit_id
    JOIN pi_root r ON r.shard = pi.shard AND r.property_cid = pi.property_cid
    JOIN capture_receipts cr ON cr.file = s.capture_file`);
  const joined = await db.scalar('SELECT count(*) FROM permits_joined');
  const published = await db.scalar('SELECT count(*) FROM lex.pi_property_improvement');
  if (joined !== staged.permitRows || joined !== published)
    throw new Error(
      `permit join: staged ${staged.permitRows}, joined ${joined}, published ${published} (all three must agree)`,
    );
  lap('permits-join', t);

  t = performance.now();
  await db.run(
    `CREATE TEMP MACRO norm_addr(x) AS lower(regexp_replace(strip_accents(coalesce(x, '')), '[^A-Za-z0-9]', '', 'g'))`,
  );
  await db.run(`CREATE TEMP TABLE parcel_geo AS
    SELECT p.parcel_identifier AS property_id, g.latitude AS lat, g.longitude AS lon
    FROM lex.county_parcel p
    JOIN lex.county_parcel_has_geometry r ON r.from_cid = p.cid AND r.shard = p.shard
    JOIN lex.county_geometry g ON g.cid = r.to_cid AND g.shard = p.shard AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL`);
  const dupGeo = await db.scalar('SELECT count(*) - count(DISTINCT property_id) FROM parcel_geo');
  if (dupGeo !== 0) throw new Error(`${dupGeo} parcels have more than one geometry`);
  await db.run(`CREATE TEMP TABLE perm_agg AS
    SELECT property_id,
      count(*)::INTEGER AS permit_count,
      count(*) FILTER (is_roofing AND status_group = 'open')::INTEGER AS roofing_open_count,
      count(*) FILTER (is_roofing AND status_group = 'stalled')::INTEGER AS roofing_stalled_count,
      count(*) FILTER (is_roofing AND status_group = 'closed')::INTEGER AS roofing_closed_count,
      count(*) FILTER (roof_work_class = 'needs_review' OR (is_roofing AND status_group = 'needs_review'))::INTEGER AS roofing_needs_review_count,
      min(open_since) FILTER (is_roofing AND status_group = 'open') AS open_roofing_min_open_since,
      max(static_duration_days) FILTER (is_roofing AND status_group = 'stalled')::INTEGER AS stalled_roofing_max_duration_days,
      ${ROOFING_CLASSES.map((c) => {
        const k = classSignalColumns(c);
        return `count(*) FILTER (roof_work_class = '${c}' AND status_group = 'open')::INTEGER AS ${k.open},
      count(*) FILTER (roof_work_class = '${c}' AND status_group = 'stalled')::INTEGER AS ${k.stalled},
      min(open_since) FILTER (roof_work_class = '${c}' AND status_group = 'open') AS ${k.minOpenSince},
      max(static_duration_days) FILTER (roof_work_class = '${c}' AND status_group = 'stalled')::INTEGER AS ${k.maxStalledDays}`;
      }).join(',\n      ')}
    FROM permits_joined GROUP BY property_id`);
  await db.run(`CREATE TEMP TABLE last_roofing AS
    SELECT property_id, permit_id, open_since, status_group, roof_work_class FROM (
      SELECT *, row_number() OVER (PARTITION BY property_id ORDER BY open_since DESC NULLS LAST, permit_id ASC) rn
      FROM permits_joined WHERE is_roofing) WHERE rn = 1`);
  await db.run(`CREATE TEMP TABLE permit_coord AS
    SELECT property_id, lat, lon FROM (
      SELECT *, row_number() OVER (PARTITION BY property_id ORDER BY open_since DESC NULLS LAST, permit_id ASC) rn
      FROM permits_joined WHERE lat IS NOT NULL AND lon IS NOT NULL) WHERE rn = 1`);
  await db.run(
    `CREATE TEMP TABLE situs_zips AS SELECT DISTINCT substr(situs_zip, 1, 5) AS zip FROM seed_stage WHERE situs_zip IS NOT NULL`,
  );
  const listing = JSON.stringify(['geo_id', 'owner_name', 'mailing_address', 'deed_date']);
  void listing;
  await db.run(`INSERT INTO properties BY NAME
    SELECT s.property_id, s.geo_id, cp.shard, cp.cid AS record_cid, cp.property_cid, cr.data_group_cid, cp.request_identifier,
      cp.source_http_request, 'tcad-2026-certified-appraisal-export' AS source_dataset, s.url AS source_url,
      s.snapshot_at AS source_fetched_at, ${q(RUN_ID)} AS source_run_id,
      nullif(trim(concat_ws(' ', s.situs_num, s.situs_prefix, s.situs_street, s.situs_suffix, s.situs_unit)), '') AS situs_line1,
      s.situs_city, s.situs_zip,
      nullif(norm_addr(s.situs_city), '') AS situs_city_norm,
      CASE WHEN nullif(trim(concat_ws(' ', s.situs_num, s.situs_prefix, s.situs_street, s.situs_suffix, s.situs_unit)), '') IS NOT NULL
        THEN norm_addr(concat_ws(' ', s.situs_num, s.situs_prefix, s.situs_street, s.situs_suffix, s.situs_unit)) || '|' || coalesce(substr(s.situs_zip, 1, 5), '') END AS situs_norm,
      coalesce(pg.lat, pc.lat) AS lat, coalesce(pg.lon, pc.lon) AS lon,
      CASE WHEN pg.lat IS NOT NULL THEN 'parcel_centroid' WHEN pc.lat IS NOT NULL THEN 'permit' END AS coordinate_basis,
      cp.property_structure_built_year::INTEGER AS year_built,
      ra.roof_year, ra.roof_age_years, ra.roof_age_basis, ra.roof_age_confidence,
      ra.anchor_permit_id AS roof_age_anchor_permit_id, ra.anchor_date AS roof_age_anchor_date,
      ra.anchor_date_field AS roof_age_anchor_date_field, ra.anchor_year_built AS roof_age_anchor_year_built,
      ra.roof_age_as_of, ra.caveats AS roof_age_caveats,
      lr.permit_id AS last_roofing_permit_id, lr.open_since AS last_roofing_permit_date,
      lr.status_group AS last_roofing_permit_status_group, lr.roof_work_class AS last_roofing_permit_class,
      coalesce(pa.roofing_open_count, 0) AS roofing_open_count, coalesce(pa.roofing_stalled_count, 0) AS roofing_stalled_count,
      coalesce(pa.roofing_closed_count, 0) AS roofing_closed_count, coalesce(pa.roofing_needs_review_count, 0) AS roofing_needs_review_count,
      pa.open_roofing_min_open_since, pa.stalled_roofing_max_duration_days, coalesce(pa.permit_count, 0) AS permit_count,
      ${ROOFING_CLASSES.map((c) => {
        const k = classSignalColumns(c);
        return `coalesce(pa.${k.open}, 0) AS ${k.open}, coalesce(pa.${k.stalled}, 0) AS ${k.stalled}, pa.${k.minOpenSince}, pa.${k.maxStalledDays}`;
      }).join(',\n      ')},
      FALSE AS has_bbb_contractor,
      s.owner_confidential,
      CASE WHEN NOT s.owner_confidential THEN s.owner_name END AS owner_name,
      CASE WHEN NOT s.owner_confidential THEN s.addr1 END AS mailing_line1,
      CASE WHEN NOT s.owner_confidential THEN nullif(trim(concat_ws(' ', s.addr2, s.addr3)), '') END AS mailing_line2,
      CASE WHEN NOT s.owner_confidential THEN s.addr_city END AS mailing_city,
      CASE WHEN NOT s.owner_confidential THEN s.addr_state END AS mailing_state,
      CASE WHEN NOT s.owner_confidential THEN s.addr_zip END AS mailing_zip,
      CASE WHEN NOT s.owner_confidential AND s.addr1 IS NOT NULL THEN norm_addr(s.addr1) || '|' || coalesce(substr(s.addr_zip, 1, 5), '') END AS mailing_norm,
      CASE WHEN NOT s.owner_confidential THEN try_strptime(s.deed_dt, '%m-%d-%Y')::DATE END AS deed_date,
      NULL::BOOLEAN AS owner_absentee, NULL::BOOLEAN AS owner_out_of_area,
      'tcad-2026-certified-appraisal-export' AS tcad_dataset, s.url AS tcad_url, s.snapshot_at AS tcad_fetched_at,
      s.request AS tcad_source_http_request, s.row_sha256 AS tcad_row_sha256, 'confirmed_present' AS tcad_evidence_state,
      CASE WHEN s.owner_confidential THEN ['geo_id'] ELSE ['geo_id', 'owner_name', 'mailing_address', 'deed_date'] END AS tcad_fields
    FROM seed_stage s
    JOIN lex.county_property cp ON cp.parcel_identifier = s.property_id
    JOIN county_root cr ON cr.shard = cp.shard AND cr.property_cid = cp.property_cid
    JOIN roofage_stage ra ON ra.property_id = s.property_id
    LEFT JOIN parcel_geo pg ON pg.property_id = s.property_id
    LEFT JOIN permit_coord pc ON pc.property_id = s.property_id
    LEFT JOIN last_roofing lr ON lr.property_id = s.property_id
    LEFT JOIN perm_agg pa ON pa.property_id = s.property_id`);
  // owner signals need the complete set of situs ZIPs and the normalized addresses
  await db.run(`UPDATE properties SET
      owner_absentee = CASE WHEN mailing_norm IS NOT NULL AND situs_norm IS NOT NULL THEN mailing_norm <> situs_norm END,
      owner_out_of_area = CASE WHEN mailing_line1 IS NULL AND mailing_state IS NULL AND mailing_zip IS NULL THEN NULL
        ELSE coalesce(mailing_state <> 'TX', FALSE)
          OR (mailing_zip IS NOT NULL AND substr(mailing_zip, 1, 5) NOT IN (SELECT zip FROM situs_zips)) END
    WHERE NOT owner_confidential`);
  lap('properties', t);

  t = performance.now();
  await db.run(`INSERT INTO permits BY NAME
    SELECT pj.*, coalesce(pr.lat, pj.lat) AS radius_lat, coalesce(pr.lon, pj.lon) AS radius_lon
    FROM permits_joined pj JOIN properties pr ON pr.property_id = pj.property_id AND pr.property_cid = pj.property_cid`);
  const inserted = await db.scalar('SELECT count(*) FROM permits');
  if (inserted !== joined)
    throw new Error(`permits whose property_cid disagrees with the property: ${joined - inserted}`);
  await db.run(`DROP TABLE permits_joined`);
  lap('permits', t);

  // ---- tables derived from permits ---------------------------------------------------------------------------------
  t = performance.now();
  await db.run(`INSERT INTO permit_text
    SELECT permit_id, ${normalizeExpr('description')}, ${normalizeExpr('permit_class')}, ${normalizeExpr('work_class')}
    FROM permits WHERE is_text_indexed`);
  await db.run(`INSERT INTO roof_age_reference BY NAME
    SELECT prop_id AS property_id, roof_age_as_of::DATE AS roof_age_as_of, roof_year, roof_age_years, roof_age_basis, roof_age_confidence,
      roof_age_anchor::VARCHAR AS anchor_json, roof_age_caveats AS caveats, estimator::VARCHAR AS estimator_json, policy::VARCHAR AS policy_json
    FROM read_json([${o.shards.map((s) => q(path.join(o.verified.reconcileDirs[s]!, 'roof-age.jsonl'))).join(', ')}], format='newline_delimited',
      columns={prop_id:'VARCHAR', roof_age_as_of:'VARCHAR', roof_year:'INTEGER', roof_age_years:'INTEGER', roof_age_basis:'VARCHAR',
        roof_age_confidence:'VARCHAR', roof_age_anchor:'JSON', roof_age_caveats:'VARCHAR[]', estimator:'JSON', policy:'JSON'})
    WHERE prop_id IN (SELECT property_id FROM properties)`);
  await db.run(`INSERT INTO property_extras
    SELECT prop_id, regexp_extract(filename, '/(s[0-9]{4})/', 1), prop::VARCHAR, entities::VARCHAR, imp_atr::VARCHAR, land::VARCHAR, imp_info::VARCHAR
    FROM read_json([${o.shards.map((s) => q(path.join(KIT_DATA, 'runs', RUN_ID, 'shards', s, 'extras.jsonl'))).join(', ')}], format='newline_delimited',
      filename=true, columns={prop_id:'VARCHAR', prop:'JSON', entities:'JSON', imp_atr:'JSON', land:'JSON', imp_info:'JSON'})
    WHERE prop_id IN (SELECT property_id FROM properties)`);
  await db.run(`INSERT INTO search_centers
    SELECT 'city:' || situs_city_norm, 'city', mode(situs_city), situs_city_norm, avg(lat), avg(lon), count(*),
      'centroid of ' || format('{:,}', count(lat)) || ' parcels with situs city ' || mode(situs_city)
    FROM properties WHERE situs_city_norm IS NOT NULL GROUP BY situs_city_norm HAVING count(lat) > 0`);
  await db.run(`INSERT INTO search_centers
    SELECT 'zip:' || situs_zip, 'zip', situs_zip, situs_zip, avg(lat), avg(lon), count(*),
      'centroid of ' || format('{:,}', count(lat)) || ' parcels with situs ZIP ' || situs_zip
    FROM properties WHERE situs_zip IS NOT NULL GROUP BY situs_zip HAVING count(lat) > 0`);
  // reviewed aliases (decisions.md 20 / contract "Search center"): a name people use for a roll city; kept only where the target exists
  const aliases: [string, string][] = [
    ['westlake', 'city:westlakehills'],
    ['atx', 'city:austin'],
    ['austintx', 'city:austin'],
    ['austintexas', 'city:austin'],
    ['beecave', 'city:beecaves'],
  ];
  for (const [alias, center] of aliases) {
    await db.run(
      `INSERT INTO search_center_aliases SELECT ${q(alias)}, center_id, 'travis-center-alias.v1' FROM search_centers WHERE center_id = ${q(center)}`,
    );
  }
  lap('derived', t);

  // ---- contractors, registry, licenses -----------------------------------------------------------------------------
  t = performance.now();
  const reg = await loadRegistry(db, kit, o, tmp);
  lap('registry', t);

  // ---- run metadata that needs the data: counts, reads, limitations --------------------------------------------------
  t = performance.now();
  await meta.finish(db, { staged, reg, seedRows: seed.rows });
  lap('meta', t);

  // ---- indexes, FTS, checkpoint ------------------------------------------------------------------------------------
  t = performance.now();
  const textIndexRows = await db.scalar('SELECT count(*) FROM permit_text');
  await insertDeployRow(
    db,
    {
      dbFile: o.dbFile,
      deployId: o.deployId,
      inputsSha256: o.inputsSha256,
      serverCommit: o.serverCommit,
    } as BuildOptions,
    textIndexRows,
  );
  await postLoad(db);
  lap('post_load', t);

  const rec = await reconcile(db, o, { staged, permitsInternal: meta.permitsInternalSummary });
  const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  db.close();
  rmSync(path.join(o.workDir, 'duckdb-tmp'), { recursive: true, force: true });
  return { timings, reconcile: rec, textIndexRows: rec.textIndexRows, peakRssMb };
}

function normalizeExpr(col: string): string {
  // the same function the query side applies (packages/query/src/text.ts)
  return normalizeTextSqlImport(col);
}

import { normalizeTextSql as normalizeTextSqlImport } from '@travis/query';

export function fileSize(f: string): number {
  return statSync(f).size;
}
export const readText = (f: string): string => readFileSync(f, 'utf8');
export { ROOF_AGE_AS_OF };
