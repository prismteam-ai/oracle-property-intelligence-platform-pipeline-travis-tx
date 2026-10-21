import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FTS_CONFIG, TEXT_ALIAS_VERSION } from '@travis/query';
import type { BuildOptions } from './build.js';
import { Db, q } from './db.js';
import {
  KIT_DATA,
  MANIFEST_PATH,
  PUBLICATION_PATH,
  REPO_ROOT,
  captureDir,
  RUN_ID,
  RUN_RECORD_PATH,
  linkDir,
} from './env.js';
import { sha256Hex } from './hash.js';
import type { Kit } from './kit.js';
import type { RegistryResult } from './registry.js';
import type { PermitStageResult } from './stage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PermitsInternalSummary {
  total: number;
  outOfCounty: number;
}

export interface MetaHandle {
  permitsInternalSummary: PermitsInternalSummary;
  finish(
    db: Db,
    ctx: { staged: PermitStageResult; reg: RegistryResult; seedRows: number },
  ): Promise<void>;
}

const readJson = (f: string): any => JSON.parse(readFileSync(f, 'utf8'));

/** Loads run/manifest/group/mirror metadata and the capture receipts; stages permits-internal for counts and reconciliation. */
export async function loadMeta(
  db: Db,
  _kit: Kit,
  o: BuildOptions,
  tmp: (n: string) => string,
): Promise<MetaHandle> {
  const run = readJson(RUN_RECORD_PATH);
  const manifest = readJson(MANIFEST_PATH);

  // ---- runs and manifests (every run record that has a published manifest) ------------------------------------------
  const runsDir = path.join(REPO_ROOT, 'runs');
  const runRows: object[] = [];
  const manifestRows: {
    run_id: string;
    manifest_cid: string | null;
    size: number;
    sha256: string;
    hex: string;
  }[] = [];
  for (const f of readdirSync(runsDir).sort()) {
    if (!f.endsWith('.json') || f.endsWith('.publication.json') || f.includes('.gateway-checks'))
      continue;
    const text = readFileSync(path.join(runsDir, f), 'utf8');
    const rec = JSON.parse(text);
    if (typeof rec.run_id !== 'string') continue;
    const mf = path.join(REPO_ROOT, 'publish', rec.run_id, 'manifest.json');
    if (!existsSync(mf)) continue;
    const bytes = readFileSync(mf);
    const pubFile = path.join(runsDir, f.replace(/\.json$/, '.publication.json'));
    const manifestCid = existsSync(pubFile)
      ? readJson(pubFile).manifest.cid
      : (rec.manifest_cid ?? null);
    runRows.push({
      run_id: rec.run_id,
      started_at: rec.started_at,
      finished_at: rec.finished_at,
      manifest_cid: manifestCid,
      // A run record written before publication has no group roots; its own manifest lists them (every run in
      // /v1/runs shows its roots, not only the served one).
      record_json:
        rec.groups && Object.keys(rec.groups).length > 0
          ? text
          : JSON.stringify({
              ...rec,
              groups: groupsOfManifest(JSON.parse(bytes.toString('utf8'))),
            }),
    });
    manifestRows.push({
      run_id: rec.run_id,
      manifest_cid: manifestCid,
      size: bytes.length,
      sha256: sha256Hex(bytes),
      hex: bytes.toString('hex'),
    });
  }
  await db.insertJson('runs', runRows, tmp('runs.ndjson'));
  for (const m of manifestRows) {
    await db.run(
      `INSERT INTO manifests VALUES (${q(m.run_id)}, ${m.manifest_cid ? q(m.manifest_cid) : 'NULL'}, ${m.size}, ${q(m.sha256)}, unhex(${q(m.hex)}))`,
    );
  }

  // ---- group roots and mirror objects ---------------------------------------------------------------------------
  const cars = manifest.cars as {
    kind: string;
    group: string;
    shard: string;
    root_cid: string;
    schema_cid: string;
    properties?: number;
  }[];
  const rootRows = o.verified.roots
    .filter((r) => o.shards.includes(r.shard))
    .map((r) => {
      const archive = cars.find(
        (c) => c.kind === 'archive' && c.group === r.group && c.shard === r.shard,
      );
      const tables = cars.find(
        (c) => c.kind === 'tables' && c.group === r.group && c.shard === r.shard,
      );
      if (!archive || !tables) throw new Error(`manifest has no cars for ${r.group}/${r.shard}`);
      if (tables.root_cid !== r.tablesCid)
        throw new Error(`${r.group}/${r.shard}: tables car root differs from the tables root`);
      return {
        group_name: r.group,
        shard: r.shard,
        archive_cid: archive.root_cid,
        schema_cid: archive.schema_cid,
        tables_cid: r.tablesCid,
        properties: archive.properties ?? 0,
      };
    });
  await db.insertJson('group_roots', rootRows, tmp('group_roots.ndjson'));
  const tablesCid = new Map(o.verified.roots.map((r) => [`${r.group}/${r.shard}`, r.tablesCid]));
  const mirror = o.verified.parts
    .filter((p) => o.shards.includes(p.shard))
    .map((p) => ({
      tables_cid: tablesCid.get(`${p.group}/${p.shard}`)!,
      rel_path: p.relPath,
      group_name: p.group,
      shard: p.shard,
      table_name: p.table,
      size: p.size,
      sha256: p.sha256,
      object_cid: p.cid,
    }));
  await db.insertJson('mirror_objects', mirror, tmp('mirror.ndjson'));

  // ---- capture receipts (partition requests) ------------------------------------------------------------------------
  const capDir = captureDir();
  const latest = new Map<string, any>();
  for (const l of readFileSync(path.join(capDir, 'receipts.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.kind === 'page' && r.status === 200 && !r.retried) latest.set(r.file, r);
  }
  await db.run(
    'CREATE TEMP TABLE capture_receipts (file VARCHAR, url VARCHAR, fetched_at VARCHAR, source_http_request VARCHAR)',
  );
  await db.insertJson(
    'capture_receipts',
    [...latest.values()].map((r) => ({
      file: r.file,
      url: r.url,
      fetched_at: r.fetched_at,
      source_http_request: JSON.stringify(r.source_http_request),
    })),
    tmp('receipts.ndjson'),
  );

  // ---- permits-internal: the kit's classification of every captured permit (reconciliation + captured-level counts) -----
  await db.run(`CREATE TEMP TABLE permits_internal AS SELECT * FROM read_json(${q(path.join(linkDir(), 'permits-internal.jsonl'))},
    format='newline_delimited', columns={permit_number:'VARCHAR', status_current:'VARCHAR', permit_class:'VARCHAR', work_class:'VARCHAR',
      status_group:'VARCHAR', lifecycle_status:'VARCHAR', roof_work_class:'VARCHAR', is_roofing:'BOOLEAN', is_reroof:'BOOLEAN',
      completed_date_evidence:'VARCHAR', property_id:'VARCHAR', unlinked_reason:'VARCHAR', match_method:'VARCHAR'})`);
  const total = await db.scalar('SELECT count(*) FROM permits_internal');
  const outOfCounty = await db.scalar(
    `SELECT count(*) FROM permits_internal WHERE unlinked_reason = 'out_of_county'`,
  );

  return {
    permitsInternalSummary: { total, outOfCounty },
    async finish(db2, ctx) {
      const cnt = (sql: string) => db2.scalar(sql);
      const set = new Map<string, number>();
      const inCounty = `unlinked_reason IS DISTINCT FROM 'out_of_county'`;
      // a completed_date closes an open or stalled permit, as in build.ts
      const notCompleted = `completed_date_evidence IS DISTINCT FROM 'confirmed_present'`;
      set.set('properties', await cnt('SELECT count(*) FROM properties'));
      set.set(
        'with_coordinates',
        await cnt('SELECT count(*) FROM properties WHERE lat IS NOT NULL'),
      );
      set.set(
        'with_roof_age',
        await cnt('SELECT count(*) FROM properties WHERE roof_age_years IS NOT NULL'),
      );
      set.set('permits', await cnt(`SELECT count(*) FROM permits_internal WHERE ${inCounty}`));
      set.set('permits_joined_to_property', await cnt('SELECT count(*) FROM permits'));
      const ur = run.unlinked_reasons as Record<string, number>;
      set.set(
        'permits_unmatched',
        ur.no_candidate! + ur.multiple_candidates! + ur.invalid_quarantined!,
      );
      set.set(
        'permits_needs_review',
        await cnt(
          `SELECT count(*) FROM permits_internal WHERE ${inCounty} AND status_group = 'needs_review'`,
        ),
      );
      set.set(
        'roofing_permits',
        await cnt(`SELECT count(*) FROM permits_internal WHERE ${inCounty} AND is_roofing`),
      );
      set.set(
        'open_roofing_permits',
        await cnt(
          `SELECT count(*) FROM permits_internal WHERE ${inCounty} AND is_roofing AND status_group = 'open' AND ${notCompleted}`,
        ),
      );
      set.set(
        'stalled_roofing_permits',
        await cnt(
          `SELECT count(*) FROM permits_internal WHERE ${inCounty} AND is_roofing AND status_group = 'stalled' AND ${notCompleted}`,
        ),
      );
      set.set(
        'roofing_permits_needs_review',
        await cnt(
          `SELECT count(*) FROM permits_internal WHERE ${inCounty} AND (roof_work_class = 'needs_review' OR (is_roofing AND status_group = 'needs_review'))`,
        ),
      );
      set.set('owners', await cnt('SELECT count(*) FROM properties WHERE owner_name IS NOT NULL'));
      set.set('permit_contractor_attributions', await cnt('SELECT count(*) FROM contractors'));
      set.set(
        'registry_rows_loaded',
        await cnt(
          `SELECT count(*) FROM business_records WHERE source = 'tx-comptroller-franchise-tax'`,
        ),
      );
      set.set('bbb_profiles', 0);
      set.set('business_records', await cnt('SELECT count(*) FROM business_records'));
      set.set('license_records', await cnt('SELECT count(*) FROM license_records'));
      set.set(
        'contractors_with_registry_candidate',
        await cnt('SELECT count(DISTINCT contractor_attribution_key) FROM registry_candidates'),
      );
      set.set(
        'contractors_with_license_candidate',
        await cnt('SELECT count(DISTINCT contractor_attribution_key) FROM license_candidates'),
      );
      // extra keys (not part of /v1/meta.counts): the T5 reconciliation inputs
      set.set('captured_permits', total);
      set.set('permits_out_of_county', outOfCounty);
      set.set(
        'permits_without_contractor',
        await cnt('SELECT count(*) FROM permits WHERE contractor_attribution_key IS NULL'),
      );
      set.set('permits_published', await cnt('SELECT count(*) FROM permits'));
      set.set('parcels_with_permits', await cnt('SELECT count(DISTINCT property_id) FROM permits'));
      set.set('seed_rows', ctx.seedRows);
      set.set('properties_dead', ctx.seedRows - (await cnt('SELECT count(*) FROM properties')));
      set.set(
        'roof_age_high',
        await cnt(`SELECT count(*) FROM properties WHERE roof_age_confidence = 'high'`),
      );
      set.set(
        'roof_age_medium',
        await cnt(`SELECT count(*) FROM properties WHERE roof_age_confidence = 'medium'`),
      );
      set.set(
        'roof_age_low',
        await cnt(`SELECT count(*) FROM properties WHERE roof_age_confidence = 'low'`),
      );
      for (const [k, v] of Object.entries(
        run.evidence_states as Record<string, Record<string, number>>,
      ))
        for (const [s, n] of Object.entries(v)) set.set(`evidence_states.${k}.${s}`, n);
      for (const [k, n] of Object.entries(ur)) set.set(`unlinked_reasons.${k}`, n);
      await db2.insertJson(
        'meta_counts',
        [...set.entries()].map(([name, value]) => ({ name, value })),
        tmp('meta_counts.ndjson'),
      );

      // ---- unmapped values (needs_review) over every captured permit -----------------------------------------------
      await db2.run(`INSERT INTO unmapped_values
        SELECT 'status_current', coalesce(status_current, ''), count(*) FROM permits_internal WHERE status_group = 'needs_review' GROUP BY 2
        UNION ALL SELECT 'work_class', coalesce(work_class, ''), count(*) FROM permits_internal WHERE roof_work_class = 'needs_review' GROUP BY 2
        UNION ALL SELECT 'permit_class', coalesce(permit_class, ''), count(*) FROM permits_internal WHERE roof_work_class = 'needs_review' GROUP BY 2`);

      // ---- limitations: the run's, plus deploy-added rows ------------------------------------------------------------
      const lims = (run.limitations as any[]).map((l, i) => ({
        seq: i + 1,
        scope: 'run',
        source: l.source,
        availability: l.availability,
        source_access_status: l.source_access_status,
        incomplete_reason: l.incomplete_reason ?? null,
        // a records_request that is free text (not the contract's object) cannot be mapped without inventing fields: it moves into `detail`
        detail:
          typeof l.records_request === 'string'
            ? `${l.detail} (records request: ${l.records_request})`
            : l.detail,
        evidence: l.evidence ?? null,
        records_request:
          l.records_request && typeof l.records_request === 'object'
            ? JSON.stringify(l.records_request)
            : null,
      }));
      const unm = await db2.rows<{ kind: string; value: string; n: string }>(
        'SELECT * FROM unmapped_values ORDER BY kind, n DESC, value',
      );
      const unmText = unm.length
        ? unm.map((u) => `${u.kind} "${u.value}" (${u.n})`).join('; ')
        : 'none';
      let seq = lims.length;
      const noContractor = set.get('permits_without_contractor') ?? 0;
      lims.push({
        seq: ++seq,
        scope: 'deploy',
        source: 'austin-issued-construction-permits/3syk-w9eu',
        availability: 'supported_partial',
        source_access_status: 'available',
        incomplete_reason: 'no_contractor_printed',
        detail: `${noContractor.toLocaleString('en-US')} published permits print no company name, no full name and no phone: they carry no contractor attribution (contractor is null)`,
        evidence: 'meta_counts.permits_without_contractor',
        records_request: null,
      });
      lims.push({
        seq: ++seq,
        scope: 'deploy',
        source: 'austin-issued-construction-permits/3syk-w9eu',
        availability: 'supported_partial',
        source_access_status: 'available',
        incomplete_reason: 'needs_review_values',
        detail: `values outside the permit profile's mapping are needs_review and excluded from the open, stalled and closed counts and from the open-permit signal: ${unmText}`,
        evidence: 'unmapped_values',
        records_request: null,
      });
      const completedOpen = await db2.rows<{ n: string; roofing: string }>(
        `SELECT count(*) n, count(*) FILTER (is_roofing) roofing FROM permits_internal
         WHERE ${inCounty} AND status_group IN ('open', 'stalled') AND NOT ${notCompleted}`,
      );
      lims.push({
        seq: ++seq,
        scope: 'deploy',
        source: 'austin-issued-construction-permits/3syk-w9eu',
        availability: 'supported_partial',
        source_access_status: 'available',
        incomplete_reason: 'completed_date_closes_status',
        detail: `${Number(completedOpen[0]!.n).toLocaleString('en-US')} permits (${Number(completedOpen[0]!.roofing).toLocaleString('en-US')} roofing) print an open or stalled status but have a completed date: they are served as closed (status_group_basis completed_date), with the printed status kept in status, and are left out of the open and stalled counts and the long-open signal`,
        evidence: 'docs/decisions.md section 36',
        records_request: null,
      });
      lims.push({
        seq: ++seq,
        scope: 'deploy',
        source: 'tcad-2026-certified-appraisal-export',
        availability: 'supported_partial',
        source_access_status: 'available',
        incomplete_reason: 'later_supplement_not_loaded',
        detail:
          "owner, deed and value fields are from TCAD's 2026 certified roll (supplement 0, 2026-07-18); TCAD's supplemental roll export 335 of 2026-10-08 uses a different file layout and is not loaded: run 2 refreshed the permits only",
        evidence: 'docs/decisions.md sections 33 and 36',
        records_request: null,
      });
      lims.push({
        seq: ++seq,
        scope: 'deploy',
        source: 'tcad-2026-certified-appraisal-export',
        availability: 'supported_partial',
        source_access_status: 'available',
        incomplete_reason: 'address_text_from_capture',
        detail:
          'the published address tables carry no address text; situs and mailing text are served from the receipted TCAD capture, labelled unpublished_source beside the published address CID (decisions.md section 29)',
        evidence: 'docs/decisions.md section 29',
        records_request: null,
      });
      lims.push({
        seq: seq + 1,
        scope: 'deploy',
        source: 'travis-tnr-tcad-parcels',
        availability: 'supported_partial',
        source_access_status: 'available',
        incomplete_reason: 'polygon_in_mirror_only',
        detail:
          'parcel polygons are in the Parquet mirror (county geometry tables), not in the query database; coordinates are parcel centroids',
        evidence: 'docs/hosted-layer-interfaces.md',
        records_request: null,
      });
      await db2.insertJson('limitations', lims, tmp('limitations.ndjson'));

      // ---- deploy_reads ----------------------------------------------------------------------------------------------
      const cap = readJson(path.join(captureDir(), 'capture.json'));
      const srcOf = (ds: string) => (run.sources as any[]).find((s) => s.dataset === ds);
      const reads: object[] = [
        {
          dataset: 'austin-issued-construction-permits/3syk-w9eu',
          url: 'https://data.austintexas.gov/resource/3syk-w9eu',
          fetched_at: cap.finished_at,
          sha256: srcOf('austin-issued-construction-permits/3syk-w9eu').sha256,
          rows: cap.rows,
          matched: await cnt('SELECT count(*) FROM permits'),
          unavailable: 0,
          conflicting: 0,
        },
        {
          dataset: 'tcad-2026-certified-appraisal-export',
          url: srcOf('tcad-2026-certified-appraisal-export').url,
          fetched_at: srcOf('tcad-2026-certified-appraisal-export').fetched_at,
          sha256: srcOf('tcad-2026-certified-appraisal-export').sha256,
          rows: ctx.seedRows,
          matched: await cnt('SELECT count(*) FROM properties'),
          unavailable: 0,
          conflicting: 0,
        },
        {
          dataset: 'tcad-2026-certified-special-export-json',
          url: srcOf('tcad-2026-certified-special-export-json').url,
          fetched_at: srcOf('tcad-2026-certified-special-export-json').fetched_at,
          sha256: srcOf('tcad-2026-certified-special-export-json').sha256,
          rows: readJson(
            path.join(KIT_DATA, 'tcad-permit-listing', '6f7a758568fd03fa', 'index.json'),
          ).listing.rows,
          matched: run.counts.permits.by_link_method.tcad_permit_listing,
          unavailable: 0,
          conflicting: 0,
        },
        ...ctx.reg.reads,
      ];
      await db2.insertJson('deploy_reads', reads, tmp('reads.ndjson'));
    },
  };
}

export interface DeployRowInput {
  deployId: string;
  inputsSha256: string;
  serverCommit: string;
  textIndexRows: number;
  areaBounds: string;
}

export async function insertDeployRow(
  db: Db,
  o: BuildOptions,
  textIndexRows: number,
): Promise<void> {
  const run = readJson(RUN_RECORD_PATH);
  const pub = readJson(PUBLICATION_PATH);
  const bbb = (run.limitations as any[]).find((l) => l.source === 'bbb.org');
  const ver = run.versions as Record<string, string>;
  const bounds = await db.one<Record<string, number>>(
    'SELECT min(lat) AS min_lat, max(lat) AS max_lat, min(lon) AS min_lon, max(lon) AS max_lon FROM properties',
  );
  const matcherVersions = await db.rows<{ source_key: string; matcher_version: string }>(
    'SELECT source_key, matcher_version FROM source_loads',
  );
  const mv = Object.fromEntries(matcherVersions.map((m) => [m.source_key, m.matcher_version]));
  const version = await db.one<{ v: string }>('SELECT version() AS v');
  await db.run(
    `INSERT INTO deploy VALUES (${[
      q(o.deployId),
      q(o.inputsSha256),
      q(new Date().toISOString()),
      q(o.serverCommit),
      q(version.v.replace(/^v/, '')),
      'NULL',
      q(RUN_ID),
      q(pub.manifest.cid),
      q(run.cli_commit),
      q(run.lexicon_manifest_url),
      q(run.kit_commit),
      q('Travis County, TX'),
      q('48453'),
      q('travis-attribution-key.v1'),
      q(ver.work_classifier ?? 'travis-work-classifier-v2'),
      `DATE '${run.roof_age.as_of_date}'`,
      textIndexRows,
      q(FTS_CONFIG.stemmer),
      q(FTS_CONFIG.stopwords),
      q(FTS_CONFIG.ignore),
      'TRUE',
      'TRUE',
      q(TEXT_ALIAS_VERSION),
      q('blocked'),
      q(bbb?.incomplete_reason ?? 'http_403_source_block'),
      q(bbb?.detail ?? ''),
      q(JSON.stringify(mv)),
      q(JSON.stringify(bounds)),
    ].join(', ')})`,
  );
}

/** Per `group/shard`: the archive root, its schema and its tables root, from a run's published manifest. */
export function groupsOfManifest(
  manifest: any,
): Record<string, { cid: string; schema: string; tables: string | null }> {
  const cars: any[] = manifest.cars ?? [];
  return Object.fromEntries(
    cars
      .filter((car) => car.kind === 'archive')
      .map((car) => [
        `${car.group}/${car.shard}`,
        {
          cid: car.root_cid,
          schema: car.schema_cid,
          tables:
            cars.find((t) => t.kind === 'tables' && t.group === car.group && t.shard === car.shard)
              ?.root_cid ?? null,
        },
      ]),
  );
}
