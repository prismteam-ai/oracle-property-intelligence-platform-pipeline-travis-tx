import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import type {
  BusinessRecord,
  Contractor,
  LicenseRecord,
  Meta,
  PermitDetail,
  PermitSummary,
  PropertyDetail,
  PropertySummary,
  Run,
  businessSearchParams,
  licenseSearchParams,
  searchPermitsParams,
  searchPropertiesParams,
  textSearchParams,
} from '@travis/contract';
import { ROOFING_CLASSES } from '@travis/contract';
import { badRequest, notFound } from './errors.js';
import { TEXT_ALIASES, normalizeCenterName, normalizeMatcherName, normalizeText } from './text.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Row = Record<string, any>;
export type PropertySearchParams = ReturnType<typeof searchPropertiesParams>['_output'];
export type PermitSearchParams = ReturnType<typeof searchPermitsParams>['_output'];
export type TextSearchParams = ReturnType<typeof textSearchParams>['_output'];
export type BusinessSearchParams = ReturnType<typeof businessSearchParams>['_output'];
export type LicenseSearchParams = ReturnType<typeof licenseSearchParams>['_output'];

export { ROOFING_CLASSES };
type RoofingClass = (typeof ROOFING_CLASSES)[number];
/** The per-class roofing-permit signal columns of `properties` (schema.sql). */
export const classSignalColumns = (c: RoofingClass) => ({
  open: `roofing_open_count__${c}`,
  stalled: `roofing_stalled_count__${c}`,
  minOpenSince: `open_roofing_min_open_since__${c}`,
  maxStalledDays: `stalled_roofing_max_duration_days__${c}`,
});

/** The property signal over some roofing classes (all four when none are given); least/greatest skip NULLs. */
function signalExprs(classes: readonly RoofingClass[] | undefined) {
  if (!classes)
    return {
      open: 'roofing_open_count',
      stalled: 'roofing_stalled_count',
      minOpenSince: 'open_roofing_min_open_since',
      maxStalledDays: 'stalled_roofing_max_duration_days',
    };
  const cols = [...new Set(classes)].map(classSignalColumns);
  const join = (k: keyof (typeof cols)[number], f: string) =>
    cols.length === 1 ? cols[0]![k] : `${f}(${cols.map((c) => c[k]).join(', ')})`;
  return {
    open: `(${cols.map((c) => c.open).join(' + ')})`,
    stalled: `(${cols.map((c) => c.stalled).join(' + ')})`,
    minOpenSince: join('minOpenSince', 'least'),
    maxStalledDays: join('maxStalledDays', 'greatest'),
  };
}

/**
 * Serving mode (decisions.md section 30): `dbPath` is the small serving file (the small tables, permit_text and its
 * text index, and `serving_files`); the large tables are Parquet files read through httpfs at
 * `<base>/<deploy_id>/<file>`, behind views named after the tables, so the SQL below is the same in both modes.
 */
export interface ServingOptions {
  /** `s3://<deploy bucket>/serving` in Lambda; an http(s) URL for local runs and tests. */
  base: string;
  /** Credentials for an s3:// base (the function role's, from the Lambda environment). */
  s3?: { region: string; keyId: string; secret: string; sessionToken?: string };
}

/** Serving options from SERVING_BASE and the Lambda's AWS credential variables; undefined when SERVING_BASE is unset. */
export function servingFromEnv(env: NodeJS.ProcessEnv = process.env): ServingOptions | undefined {
  const base = env.SERVING_BASE;
  if (!base) return undefined;
  if (!base.startsWith('s3://')) return { base };
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)
    throw new Error(
      'SERVING_BASE is an s3:// URL but AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is unset',
    );
  return {
    base,
    s3: {
      region: env.AWS_REGION ?? 'us-east-2',
      keyId: env.AWS_ACCESS_KEY_ID,
      secret: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    },
  };
}

/** The permit columns the text search filters on before it reads any full row (decisions.md section 30). */
export const PERMIT_TEXT_FILTER_COLUMNS = [
  'permit_id',
  'status_group',
  'is_roofing',
  'radius_lat',
  'radius_lon',
] as const;

/**
 * The two relations the text search reads. The serving set has permit_text_filters as a table in the serving file and
 * permit_text_rows as an id-sorted Parquet file of the text-indexed permits; the full file has both as views over
 * permits (supersets: the text search joins them with permit_text).
 */
const FULL_FILE_VIEWS: Record<string, string> = {
  permit_text_filters: `SELECT ${PERMIT_TEXT_FILTER_COLUMNS.join(', ')} FROM permits`,
  permit_text_rows: 'SELECT * FROM permits',
};

export interface QueryOptions {
  dbPath: string;
  serving?: ServingOptions;
  memoryLimit?: string;
  threads?: number;
  tempDirectory?: string;
  extensionDirectory?: string;
  /** `/v1/meta.limits` ({stage, routes, mcp, chat}) from the CDK config (env LIMITS_JSON). */
  limits?: Meta['limits'];
  /** Injectable clock: returns today's UTC date as YYYY-MM-DD. */
  today?: () => string;
}

export const DEFAULT_LIMITS: Meta['limits'] = {
  stage: { rate: 20, burst: 40 },
  routes: {
    '/v1/agent/chat': { rate: 1, burst: 3 },
    '/v1/permits/text-search': { rate: 5, burst: 10 },
  },
  mcp: { search_permit_text: { rate: 5, burst: 10 } },
  chat: { max_output_tokens: 1500, turn_deadline_seconds: 25 },
};

const DATASET_URL = 'https://data.austintexas.gov/resource/3syk-w9eu';

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const jparse = (s: unknown): any => (typeof s === 'string' ? JSON.parse(s) : s);
/** A printed phone with fewer than 10 digits (an area code alone, say) is no phone. */
const phone = (s: unknown): string | null =>
  typeof s === 'string' && s.replace(/\D/g, '').length >= 10 ? s : null;

function httpRequest(s: unknown): {
  method: string;
  url: string;
  multiValueQueryString: Record<string, string[]>;
} {
  const o = jparse(s) ?? {};
  return {
    method: o.method ?? 'GET',
    url: o.url ?? '',
    multiValueQueryString: o.multiValueQueryString ?? {},
  };
}

const HAV = (lat0: number, lon0: number, latC: string, lonC: string) =>
  `(3958.8 * 2 * asin(sqrt(least(1.0, pow(sin(radians(${latC} - ${lat0}) / 2), 2) + cos(radians(${lat0})) * cos(radians(${latC})) * pow(sin(radians(${lonC} - ${lon0}) / 2), 2)))))`;

function bbox(lat: number, lon: number, radius: number, latC: string, lonC: string): string {
  const dLat = radius / 69.0 + 0.01;
  const dLon = radius / (69.0 * Math.max(0.05, Math.cos((lat * Math.PI) / 180))) + 0.01;
  return `${latC} BETWEEN ${lat - dLat} AND ${lat + dLat} AND ${lonC} BETWEEN ${lon - dLon} AND ${lon + dLon}`;
}

/**
 * Loads httpfs, sets the S3 secret, creates one TEMP view per `serving_files` row (the serving file is read-only), then
 * closes external access to everything but the serving prefix and the temp directory and locks the configuration, so no
 * SQL text can reach any other URL or file.
 */
async function attachServing(
  conn: DuckDBConnection,
  s: ServingOptions,
  deployId: string,
  tempDirectory: string,
): Promise<void> {
  await conn.run('LOAD httpfs');
  // Footers, HEAD results and the bytes read stay cached in the instance, which warm invocations reuse.
  await conn.run('SET parquet_metadata_cache = true');
  await conn.run('SET enable_http_metadata_cache = true');
  await conn.run('SET enable_external_file_cache = true');
  if (s.s3) {
    const p = [
      'TYPE s3',
      `KEY_ID ${lit(s.s3.keyId)}`,
      `SECRET ${lit(s.s3.secret)}`,
      `REGION ${lit(s.s3.region)}`,
      `SCOPE ${lit(s.base)}`,
    ];
    if (s.s3.sessionToken) p.push(`SESSION_TOKEN ${lit(s.s3.sessionToken)}`);
    await conn.run(`CREATE TEMPORARY SECRET serving_s3 (${p.join(', ')})`);
  }
  const files = (
    await conn.runAndReadAll('SELECT table_name, file FROM serving_files ORDER BY table_name')
  ).getRowObjectsJson() as Row[];
  if (files.length === 0) throw new Error('serving_files is empty');
  const prefix = `${s.base.replace(/\/+$/, '')}/${deployId}/`;
  for (const f of files) {
    const url = `${prefix}${f.file}`;
    try {
      await conn.run(`CREATE TEMP VIEW ${f.table_name} AS SELECT * FROM read_parquet(${lit(url)})`);
    } catch (e) {
      // without s3:ListBucket a missing key answers 403, not 404
      throw new Error(
        `serving: cannot read ${url} for table ${f.table_name} of deploy ${deployId}: ${(e as Error).message}`,
        { cause: e },
      );
    }
  }
  await conn.run(
    `SET allowed_directories = [${lit(prefix)}, ${lit(`${tempDirectory.replace(/\/+$/, '')}/`)}]`,
  );
  await conn.run('SET enable_external_access = false');
  await conn.run('SET lock_configuration = true');
}

export class Queries {
  private cache = new Map<string, unknown>();
  private constructor(
    readonly instance: DuckDBInstance,
    readonly conn: DuckDBConnection,
    private readonly opts: QueryOptions,
    readonly deployId: string,
    private readonly stopwords: Set<string>,
    readonly openMs: number,
  ) {}

  /**
   * Opens the checkpointed file (or, in serving mode, the serving file) read-only with the memory, thread, temp and
   * extension settings of the Lambda image.
   */
  static async open(opts: QueryOptions): Promise<Queries> {
    const t0 = performance.now();
    const config: Record<string, string> = {
      access_mode: 'READ_ONLY',
      memory_limit: opts.memoryLimit ?? '1GB',
      threads: String(opts.threads ?? 2),
      temp_directory: opts.tempDirectory ?? '/tmp',
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
    };
    if (opts.extensionDirectory) config.extension_directory = opts.extensionDirectory;
    const instance = await DuckDBInstance.create(opts.dbPath, config);
    const conn = await instance.connect();
    await conn.run('LOAD fts');
    const dep = (
      await conn.runAndReadAll('SELECT deploy_id FROM deploy')
    ).getRowObjectsJson() as Row[];
    if (dep.length !== 1) throw new Error('deploy table must hold exactly one row');
    if (opts.serving)
      await attachServing(conn, opts.serving, dep[0]!.deploy_id as string, config.temp_directory!);
    else
      for (const [name, select] of Object.entries(FULL_FILE_VIEWS))
        await conn.run(`CREATE TEMP VIEW ${name} AS ${select}`);
    const sw = (
      await conn.runAndReadAll('SELECT sw FROM fts_main_permit_text.stopwords')
    ).getRowObjectsJson() as Row[];
    return new Queries(
      instance,
      conn,
      opts,
      dep[0]!.deploy_id as string,
      new Set(sw.map((r) => String(r.sw))),
      Math.round(performance.now() - t0),
    );
  }

  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }

  today(): string {
    return this.opts.today ? this.opts.today() : new Date().toISOString().slice(0, 10);
  }

  private async all(sql: string): Promise<Row[]> {
    return (await this.conn.runAndReadAll(sql)).getRowObjectsJson() as Row[];
  }
  private async scalar(sql: string): Promise<number> {
    const r = await this.all(sql);
    return Number(Object.values(r[0] ?? { n: 0 })[0]);
  }
  private memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as Promise<T>;
  }

  // ---- cursors ----------------------------------------------------------------------------------------------------
  private encodeCursor(offset: number, asOf: string): string {
    return Buffer.from(JSON.stringify({ d: this.deployId, a: asOf, o: offset })).toString(
      'base64url',
    );
  }
  private decodeCursor(cursor: string | undefined, asOf: string): number {
    if (cursor === undefined) return 0;
    let c: any;
    try {
      c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw badRequest('invalid_cursor', 'the cursor is not one this server issued');
    }
    if (typeof c?.d !== 'string' || typeof c?.a !== 'string' || !Number.isInteger(c?.o) || c.o < 0)
      throw badRequest('invalid_cursor', 'the cursor is not one this server issued');
    if (c.d !== this.deployId || c.a !== asOf) throw badRequest('stale_cursor');
    return c.o as number;
  }
  private page<T>(
    items: T[],
    total: number,
    offset: number,
    limit: number,
    asOf: string,
  ): { items: T[]; total: number; next_cursor: string | null } {
    return {
      items,
      total,
      next_cursor:
        offset + items.length < total && items.length > 0
          ? this.encodeCursor(offset + limit, asOf)
          : null,
    };
  }

  // ---- shared lookups ---------------------------------------------------------------------------------------------------
  private deployRow = () =>
    this.memo('deploy', async () => (await this.all('SELECT * FROM deploy'))[0]!);
  private bounds = () =>
    this.memo(
      'bounds',
      async () =>
        jparse((await this.deployRow()).area_bounds) as {
          min_lat: number;
          max_lat: number;
          min_lon: number;
          max_lon: number;
        },
    );
  private async bbb(): Promise<{
    rating: null;
    status: 'blocked' | 'unavailable' | 'available';
    incomplete_reason: string | null;
    note: string | null;
  }> {
    const d = await this.deployRow();
    return {
      rating: null,
      status: d.bbb_status,
      incomplete_reason: d.bbb_incomplete_reason ?? null,
      note: d.bbb_note ?? null,
    };
  }
  /** `outside Travis County` when the center is outside the box derived from the loaded parcels. */
  private async areaNote(
    lat?: number,
    lon?: number,
  ): Promise<{ outside: boolean; note: string | null }> {
    if (lat === undefined || lon === undefined) return { outside: false, note: null };
    const b = await this.bounds();
    const outside = lat < b.min_lat || lat > b.max_lat || lon < b.min_lon || lon > b.max_lon;
    return { outside, note: outside ? 'outside Travis County' : null };
  }
  private async source(
    dataset: string,
    recordId: string,
    url: string,
    fetchedAt: string,
    requestIdentifier: string,
    req: unknown,
  ) {
    const d = await this.deployRow();
    return {
      dataset,
      record_id: recordId,
      url,
      fetched_at: fetchedAt,
      run_id: d.run_id as string,
      request_identifier: requestIdentifier,
      source_http_request: httpRequest(req),
    };
  }

  // ---- meta, runs, manifest ------------------------------------------------------------------------------------------------
  getMeta(): Promise<Meta> {
    return this.memo('meta', async () => {
      const d = await this.deployRow();
      const runs = await this.runs();
      const run = runs.find((r) => r.run_id === d.run_id)!;
      const counts: Row = {};
      for (const r of await this.all('SELECT name, value FROM meta_counts'))
        counts[r.name] = Number(r.value);
      const bySource: Row = {};
      for (const r of await this.all('SELECT * FROM source_loads ORDER BY source_key')) {
        bySource[r.source_key] = {
          kind: r.kind,
          dataset: r.dataset,
          rows_loaded: Number(r.rows_loaded),
          in_scope_rows: Number(r.in_scope_rows),
          out_of_county_candidate_rows: Number(r.out_of_county_candidate_rows),
          withheld_record_ids: Number(r.withheld_record_ids),
          candidates: Number(r.candidates),
          fetched_at: r.fetched_at,
        };
      }
      const groups: Row = {};
      for (const r of await this.all('SELECT * FROM group_roots ORDER BY group_name, shard'))
        groups[`${r.group_name}/${r.shard}`] = {
          cid: r.archive_cid,
          schema: r.schema_cid,
          tables: r.tables_cid,
        };
      const ev = (k: string) => {
        const o: Record<string, number> = {};
        for (const [name, v] of Object.entries(counts))
          if (name.startsWith(`evidence_states.${k}.`))
            o[name.slice(`evidence_states.${k}.`.length)] = v as number;
        return o;
      };
      const ur = (k: string) => (counts[`unlinked_reasons.${k}`] as number) ?? 0;
      const limitations = (await this.all('SELECT * FROM limitations ORDER BY seq')).map((l) => ({
        source: l.source,
        availability: l.availability,
        source_access_status: l.source_access_status,
        incomplete_reason: l.incomplete_reason ?? null,
        detail: l.detail,
        evidence: l.evidence ?? null,
        records_request: l.records_request ? jparse(l.records_request) : null,
      }));
      const reads = (await this.all('SELECT * FROM deploy_reads ORDER BY dataset')).map((r) => ({
        dataset: r.dataset,
        url: r.url,
        fetched_at: r.fetched_at,
        sha256: r.sha256,
        rows: Number(r.rows),
        matched: Number(r.matched),
        unavailable: Number(r.unavailable),
        conflicting: Number(r.conflicting),
      }));
      const sha = this.duckdbSha256() ?? d.duckdb_sha256 ?? '';
      const countKeys = [
        'properties',
        'with_coordinates',
        'with_roof_age',
        'permits',
        'permits_joined_to_property',
        'permits_unmatched',
        'permits_needs_review',
        'roofing_permits',
        'open_roofing_permits',
        'stalled_roofing_permits',
        'roofing_permits_needs_review',
        'owners',
        'permit_contractor_attributions',
        'registry_rows_loaded',
        'bbb_profiles',
        'business_records',
        'license_records',
        'contractors_with_registry_candidate',
        'contractors_with_license_candidate',
      ];
      const meta = {
        county: d.county,
        fips: d.fips,
        run: { run_id: run.run_id, started_at: run.started_at, finished_at: run.finished_at },
        counts: {
          ...Object.fromEntries(countKeys.map((k) => [k, (counts[k] as number) ?? 0])),
          by_source: bySource,
        },
        groups,
        manifest_cid: d.manifest_cid,
        atlas: null,
        evidence_states: {
          completed_date: ev('completed_date'),
          status_current: ev('status_current'),
          tcad_id: ev('tcad_id'),
        },
        unlinked_reasons: {
          no_candidate: ur('no_candidate'),
          multiple_candidates: ur('multiple_candidates'),
          invalid_quarantined: ur('invalid_quarantined'),
          out_of_county: ur('out_of_county'),
        },
        limitations,
        cli_commit: d.cli_commit,
        lexicon_manifest_url: d.lexicon_manifest_url,
        kit_commit: d.kit_commit,
        deploy: {
          deploy_id: d.deploy_id,
          inputs_sha256: d.inputs_sha256,
          deployed_at: d.deployed_at,
          server_commit: d.server_commit,
          duckdb_version: d.duckdb_version,
          duckdb_sha256: sha,
          text_index: {
            rows: Number(d.text_index_rows),
            config: {
              stemmer: d.text_index_stemmer,
              stopwords: d.text_index_stopwords,
              ignore: d.text_index_ignore,
              lower: d.text_index_lower,
              strip_accents: d.text_index_strip_accents,
            },
            alias_version: d.text_index_alias_version,
          },
          reads,
        },
        mcp: { protocol_version: '2025-06-18' as const },
        attribution_key_version: d.attribution_key_version,
        limits: this.opts.limits ?? DEFAULT_LIMITS,
      };
      return meta as unknown as Meta;
    });
  }

  private duckdbSha256(): string | null {
    const f = path.join(path.dirname(this.opts.dbPath), 'deploy.json');
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, 'utf8')).duckdb_sha256 ?? null;
      } catch {
        return null;
      }
    }
    return process.env.DUCKDB_SHA256 ?? null;
  }

  /** Every run that ever published, newest first, mapped onto the contract's Run shape. */
  runs(): Promise<Run[]> {
    return this.memo('runs', async () => {
      const rows = await this.all(
        'SELECT run_id, manifest_cid, record_json FROM runs ORDER BY run_id DESC',
      );
      const groupRows = await this.all('SELECT * FROM group_roots ORDER BY group_name, shard');
      const d = await this.deployRow();
      return rows.map((r) =>
        normalizeRun(
          JSON.parse(r.record_json),
          r.manifest_cid,
          r.run_id === d.run_id ? groupRows : [],
        ),
      ) as Run[];
    });
  }
  async listRuns(): Promise<{ items: Run[] }> {
    return { items: await this.runs() };
  }
  async getRunManifest(runId: string): Promise<Buffer> {
    const r = await this.all(`SELECT hex(bytes) AS h FROM manifests WHERE run_id = ${lit(runId)}`);
    if (r.length === 0) throw notFound(`run ${runId}`);
    return Buffer.from(r[0]!.h as string, 'hex');
  }
  async getRunSummary(): Promise<{ meta: Meta; runs: Run[] }> {
    return { meta: await this.getMeta(), runs: await this.runs() };
  }

  // ---- search centers ------------------------------------------------------------------------------------------------------
  async searchCenters(p: { q: string }) {
    const norm = normalizeCenterName(p.q);
    if (norm === '') return { items: [] };
    const rows = await this.all(`
      WITH m AS (
        SELECT c.*, 'exact' AS match_type, 0 AS rk FROM search_centers c WHERE c.name_norm = ${lit(norm)}
        UNION ALL SELECT c.*, 'prefix', 1 FROM search_centers c WHERE starts_with(c.name_norm, ${lit(norm)}) AND c.name_norm <> ${lit(norm)}
        UNION ALL SELECT c.*, 'alias', 2 FROM search_centers c JOIN search_center_aliases a ON a.center_id = c.center_id WHERE a.alias_norm = ${lit(norm)})
      SELECT * FROM m QUALIFY row_number() OVER (PARTITION BY center_id ORDER BY rk) = 1 ORDER BY rk, parcel_count DESC, center_id LIMIT 25`);
    return {
      items: rows.map((r) => ({
        name: r.name,
        kind: r.kind,
        match_type: r.match_type,
        lat: r.lat,
        lon: r.lon,
        parcel_count: Number(r.parcel_count),
        basis: r.basis,
      })),
    };
  }

  // ---- properties -------------------------------------------------------------------------------------------------------------
  private propCols(asOf: string): string {
    return `p.*, CASE WHEN p.deed_date IS NOT NULL THEN round(date_diff('day', p.deed_date, DATE ${lit(asOf)}) / 365.25, 1) END AS owner_tenure_years`;
  }

  private async propertySummary(r: Row): Promise<PropertySummary> {
    const anchor =
      r.roof_age_anchor_permit_id !== null && r.roof_age_anchor_permit_id !== undefined
        ? {
            permit_id: r.roof_age_anchor_permit_id,
            date: r.roof_age_anchor_date,
            date_field: r.roof_age_anchor_date_field,
          }
        : r.roof_age_anchor_year_built
          ? { source_field: 'year_built' as const }
          : null;
    return {
      property_id: r.property_id,
      geo_id: r.geo_id ?? null,
      address: {
        line1: r.situs_line1 ?? null,
        city: r.situs_city ?? null,
        zip: r.situs_zip ?? null,
      },
      lat: r.lat ?? null,
      lon: r.lon ?? null,
      coordinate_basis: r.coordinate_basis ?? null,
      year_built: r.year_built ?? null,
      roof_year: r.roof_year ?? null,
      roof_age_years: r.roof_age_years ?? null,
      roof_age_basis: r.roof_age_basis ?? null,
      roof_age_confidence: r.roof_age_confidence,
      roof_age_anchor: anchor,
      roof_age_as_of: r.roof_age_as_of,
      roof_age_caveats: r.roof_age_caveats ?? [],
      last_roofing_permit: r.last_roofing_permit_id
        ? {
            permit_id: r.last_roofing_permit_id,
            date: r.last_roofing_permit_date ?? null,
            status_group: r.last_roofing_permit_status_group,
            roof_work_class: r.last_roofing_permit_class,
          }
        : null,
      roofing_permit_counts: {
        open: r.roofing_open_count,
        stalled: r.roofing_stalled_count,
        closed: r.roofing_closed_count,
        needs_review: r.roofing_needs_review_count,
      },
      owner_tenure_years: num(r.owner_tenure_years),
      owner_absentee: r.owner_absentee ?? null,
      owner_out_of_area: r.owner_out_of_area ?? null,
      has_bbb_contractor: r.has_bbb_contractor,
      source: await this.source(
        r.source_dataset,
        r.property_id,
        r.source_url,
        r.source_fetched_at,
        r.request_identifier,
        r.source_http_request,
      ),
      record_cid: r.record_cid,
      property_cid: r.property_cid,
      data_group_cid: r.data_group_cid,
      unpublished_source: {
        dataset: r.tcad_dataset,
        url: r.tcad_url,
        fetched_at: r.tcad_fetched_at,
        source_http_request: httpRequest(r.tcad_source_http_request),
        row_sha256: r.tcad_row_sha256,
        evidence_state: r.tcad_evidence_state,
        fields: r.tcad_fields,
      },
    } as PropertySummary;
  }

  async searchProperties(p: PropertySearchParams) {
    const asOf = this.today();
    const offset = this.decodeCursor(p.cursor, asOf);
    const area = await this.areaNote(p.lat, p.lon);
    if (area.outside) return { items: [], total: 0, next_cursor: null, area_note: area.note };
    const center = p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : null;
    const dist = center ? HAV(center.lat, center.lon, 'lat', 'lon') : 'NULL::DOUBLE';
    const conds: string[] = [];
    if (center)
      conds.push('lat IS NOT NULL', bbox(center.lat, center.lon, p.radius_miles, 'lat', 'lon'));
    const sig = signalExprs(p.roof_work_class);
    const permitClause = p.open_permits ? `(${sig.open} > 0 OR ${sig.stalled} > 0)` : null;
    const ageClause = p.roof_age_min > 0 ? `roof_age_years > ${p.roof_age_min}` : null;
    const match = [ageClause, permitClause].filter(Boolean);
    if (match.length) conds.push(`(${match.join(' OR ')})`);
    if (p.owner_tenure_min !== undefined)
      conds.push(
        `deed_date IS NOT NULL AND date_diff('day', deed_date, DATE ${lit(asOf)}) / 365.25 >= ${p.owner_tenure_min}`,
      );
    if (p.absentee_owner !== undefined)
      conds.push(
        `owner_absentee IS NOT DISTINCT FROM ${p.absentee_owner ? 'TRUE' : 'FALSE'} AND owner_absentee IS NOT NULL`,
      );
    if (p.out_of_area_owner !== undefined)
      conds.push(
        `owner_out_of_area IS NOT DISTINCT FROM ${p.out_of_area_owner ? 'TRUE' : 'FALSE'} AND owner_out_of_area IS NOT NULL`,
      );
    const where = conds.join(' AND ') || 'TRUE';
    const inner = `(SELECT ${this.propCols(asOf)}, ${dist} AS distance_miles FROM properties p WHERE ${where.replace(/\b(lat|lon)\b/g, 'p.$1')})`;
    // with roof_work_class the four signal columns are the requested classes' combination, everywhere below
    const base = p.roof_work_class
      ? `(SELECT * REPLACE (${sig.open} AS roofing_open_count, ${sig.stalled} AS roofing_stalled_count,
          ${sig.minOpenSince} AS open_roofing_min_open_since, ${sig.maxStalledDays} AS stalled_roofing_max_duration_days) FROM ${inner})`
      : inner;
    const within = center ? `WHERE distance_miles <= ${p.radius_miles}` : '';
    const total = await this.scalar(`SELECT count(*) FROM ${base} ${within}`);
    const longDays = p.long_open_years * 365;
    const rows = await this.all(`
      SELECT *, date_diff('day', open_roofing_min_open_since, DATE ${lit(asOf)}) AS open_days FROM ${base} ${within}
      ORDER BY CASE WHEN roofing_open_count > 0 THEN 0 WHEN roofing_stalled_count > 0 THEN 1 ELSE 2 END,
        CASE WHEN roofing_open_count > 0 THEN date_diff('day', open_roofing_min_open_since, DATE ${lit(asOf)}) WHEN roofing_stalled_count > 0 THEN stalled_roofing_max_duration_days END DESC NULLS LAST,
        roof_age_years DESC NULLS LAST, distance_miles ASC NULLS LAST, property_id ASC
      LIMIT ${p.limit} OFFSET ${offset}`);
    const items = [];
    for (const r of rows) {
      const s = (await this.propertySummary(r)) as any;
      s.distance_miles = center ? Math.round(Number(r.distance_miles) * 1000) / 1000 : null;
      const reasons: string[] = [];
      if (ageClause && r.roof_age_years !== null && r.roof_age_years > p.roof_age_min)
        reasons.push('aged_roof');
      if (p.open_permits) {
        if (r.roofing_open_count > 0) {
          reasons.push('open_roofing_permit');
          if (Number(r.open_days) >= longDays) reasons.push('long_open_roofing_permit');
        }
        if (r.roofing_stalled_count > 0) {
          reasons.push('stalled_roofing_permit');
          if (r.roofing_open_count === 0 && Number(r.stalled_roofing_max_duration_days) >= longDays)
            reasons.push('long_open_roofing_permit');
        }
      }
      if (p.owner_tenure_min !== undefined) reasons.push('owner_tenure');
      if (p.absentee_owner === true) reasons.push('absentee_owner');
      if (p.out_of_area_owner === true) reasons.push('out_of_area_owner');
      s.match_reasons = reasons;
      items.push(s);
    }
    return { ...this.page(items, total, offset, p.limit, asOf), area_note: null as string | null };
  }

  private async propertyRow(where: string): Promise<Row | null> {
    const rows = await this.all(
      // a geo_id can sit on several accounts (1,160 do): the lowest property_id answers, in both modes
      `SELECT ${this.propCols(this.today())} FROM properties p WHERE ${where} ORDER BY p.property_id LIMIT 1`,
    );
    return rows[0] ?? null;
  }

  async getProperty(
    by: { property_id?: string; geo_id?: string },
    permitLimit = 50,
  ): Promise<PropertyDetail> {
    const r = await this.propertyRow(
      by.property_id !== undefined
        ? `p.property_id = ${lit(by.property_id)}`
        : `p.geo_id = ${lit(by.geo_id ?? '')}`,
    );
    if (!r) throw notFound(`property ${by.property_id ?? by.geo_id}`);
    const asOf = this.today();
    const summary = (await this.propertySummary(r)) as any;
    const prows = await this.all(`SELECT * FROM permits WHERE property_id = ${lit(r.property_id)}
      ORDER BY is_roofing DESC, open_since DESC NULLS LAST, permit_id ASC LIMIT ${permitLimit}`);
    const permits = await this.permitSummaries(prows, asOf);
    const total = Number(r.permit_count);
    const mailing = [
      r.mailing_line1,
      r.mailing_line2,
      r.mailing_city,
      r.mailing_state,
      r.mailing_zip,
    ];
    const fields: string[] = (r.tcad_fields as string[]).filter((f) => f !== 'geo_id');
    const detail = {
      ...summary,
      owner: {
        owner_name: r.owner_name ?? null,
        mailing_address: mailing.every((x) => x === null || x === undefined)
          ? null
          : {
              line1: r.mailing_line1 ?? null,
              line2: r.mailing_line2 ?? null,
              city: r.mailing_city ?? null,
              state: r.mailing_state ?? null,
              zip: r.mailing_zip ?? null,
            },
        deed_date: r.deed_date ?? null,
        owner_tenure_years: num(r.owner_tenure_years),
        owner_absentee: r.owner_absentee ?? null,
        owner_out_of_area: r.owner_out_of_area ?? null,
        source: summary.source,
        unpublished_source: { ...summary.unpublished_source, fields },
      },
      permits,
      permits_total: total,
      permits_truncated: total > permits.length,
    };
    return detail as PropertyDetail;
  }

  // ---- permits ---------------------------------------------------------------------------------------------------------------------
  private async permitSummaries(
    rows: Row[],
    asOf: string,
    extra?: (r: Row) => Row,
  ): Promise<PermitSummary[]> {
    const bbb = await this.bbb();
    const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
    const days = (from: string) =>
      Math.round((asOfMs - Date.parse(`${from}T00:00:00Z`)) / 86400000);
    const out: PermitSummary[] = [];
    for (const r of rows) {
      const open = r.status_group === 'open' && r.open_since ? days(r.open_since) : null;
      const stalled = r.status_group === 'stalled' ? num(r.static_duration_days) : null;
      const s: any = {
        permit_id: r.permit_id,
        geo_id: r.geo_id ?? null,
        property_id: r.property_id,
        property_link: {
          match_method: r.link_match_method,
          normalization_version: r.link_normalization_version ?? null,
          confidence: r.link_confidence,
        },
        permit_type: r.permit_type ?? '',
        permit_class: r.permit_class ?? '',
        work_class: r.work_class ?? '',
        description: r.description ?? '',
        roof_work_class: r.roof_work_class,
        work_classifier_version: r.work_classifier_version,
        is_roofing: r.is_roofing,
        is_reroof: r.is_reroof,
        status: r.status ?? '',
        status_group: r.status_group,
        status_group_basis: r.status_group_basis,
        status_observed_at: r.status_observed_at,
        status_source: r.status_source,
        applied_date: r.applied_date ?? null,
        issued_date: r.issued_date ?? null,
        expires_date: r.expires_date ?? null,
        completed_date: r.completed_date ?? null,
        completed_date_evidence: r.completed_date_evidence,
        open_since: r.open_since ?? null,
        open_since_basis: r.open_since_basis ?? null,
        open_duration_days: open ?? stalled,
        open_duration_basis:
          open !== null ? 'today' : stalled !== null ? (r.static_duration_basis ?? null) : null,
        open_duration_as_of: asOf,
        days_since_expiry:
          r.status_group === 'stalled' && r.expires_date ? days(r.expires_date) : null,
        contractor:
          r.contractor_attribution_key === null || r.contractor_attribution_key === undefined
            ? null
            : {
                contractor_attribution_key: r.contractor_attribution_key,
                identity_status: 'source_name_attribution',
                printed_name: r.contractor_full_name ?? '',
                company_name: r.contractor_company_name ?? null,
                trade: r.contractor_trade ?? null,
                phone: phone(r.contractor_phone),
              },
        bbb,
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        source: await this.source(
          r.capture_dataset,
          r.permit_id,
          r.source_url ?? DATASET_URL,
          r.status_observed_at,
          r.request_identifier,
          r.source_http_request,
        ),
        record_cid: r.record_cid,
        property_cid: r.property_cid,
        data_group_cid: r.data_group_cid,
        unpublished_source: {
          dataset: r.capture_dataset,
          url: r.capture_url,
          fetched_at: r.capture_fetched_at,
          source_http_request: httpRequest(r.capture_source_http_request),
          row_sha256: r.capture_row_sha256,
          evidence_state: r.capture_evidence_state,
          fields: [
            'geo_id',
            'permit_type',
            'permit_class',
            'work_class',
            'description',
            'status',
            'expires_date',
            'contractor_trade',
            'contractor_company_name',
            'contractor_full_name',
            'contractor_phone',
            'contractor_address1',
            'contractor_address2',
            'contractor_city',
            'contractor_zip',
            'lat',
            'lon',
          ],
        },
      };
      if (extra) Object.assign(s, extra(r));
      out.push(s);
    }
    return out;
  }

  private openDays(asOf: string): string {
    return `CASE status_group WHEN 'open' THEN date_diff('day', open_since, DATE ${lit(asOf)}) WHEN 'stalled' THEN static_duration_days END`;
  }
  private statusRank = `CASE status_group WHEN 'open' THEN 0 WHEN 'stalled' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END`;

  private permitFilter(p: { status_group: string[]; roofing_only: boolean }): string[] {
    const c = [`status_group IN (${p.status_group.map(lit).join(', ')})`];
    if (p.roofing_only) c.push('is_roofing');
    return c;
  }

  async searchPermits(p: PermitSearchParams) {
    const asOf = this.today();
    const offset = this.decodeCursor(p.cursor, asOf);
    const area = await this.areaNote(p.lat, p.lon);
    if (area.outside) return { items: [], total: 0, next_cursor: null, area_note: area.note };
    const center = p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : null;
    const conds = this.permitFilter(p);
    if (p.roof_work_class)
      conds.push(`roof_work_class IN (${p.roof_work_class.map(lit).join(', ')})`);
    if (p.min_open_years !== undefined)
      conds.push(`(${this.openDays(asOf)}) >= ${p.min_open_years * 365}`);
    if (p.contractor_attribution_key)
      conds.push(`contractor_attribution_key = ${lit(p.contractor_attribution_key)}`);
    if (p.property_id) conds.push(`property_id = ${lit(p.property_id)}`);
    if (center)
      conds.push(
        'radius_lat IS NOT NULL',
        bbox(center.lat, center.lon, p.radius_miles, 'radius_lat', 'radius_lon'),
      );
    const dist = center ? HAV(center.lat, center.lon, 'radius_lat', 'radius_lon') : 'NULL::DOUBLE';
    const base = `(SELECT *, ${dist} AS distance_miles FROM permits WHERE ${conds.join(' AND ')})`;
    const within = center ? `WHERE distance_miles <= ${p.radius_miles}` : '';
    const total = await this.scalar(`SELECT count(*) FROM ${base} ${within}`);
    const rows = await this.all(
      `SELECT * FROM ${base} ${within} ORDER BY ${this.statusRank}, (${this.openDays(asOf)}) DESC NULLS LAST, permit_id ASC LIMIT ${p.limit} OFFSET ${offset}`,
    );
    const items = await this.permitSummaries(
      rows,
      asOf,
      center
        ? (r) => ({ distance_miles: Math.round(Number(r.distance_miles) * 1000) / 1000 })
        : undefined,
    );
    return { ...this.page(items, total, offset, p.limit, asOf), area_note: null as string | null };
  }

  private queryTokens(q: string): string[] {
    return normalizeText(q)
      .split(/(?:\.|[^a-z0-9])+/)
      .filter((t) => t !== '' && !this.stopwords.has(t));
  }

  async searchPermitText(p: TextSearchParams) {
    const asOf = this.today();
    const offset = this.decodeCursor(p.cursor, asOf);
    const area = await this.areaNote(p.lat, p.lon);
    if (area.outside) return { items: [], total: 0, next_cursor: null, area_note: area.note };
    const tokens = this.queryTokens(p.q);
    if (tokens.length === 0)
      return { items: [], total: 0, next_cursor: null, area_note: null as string | null };
    const center = p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : null;
    const conds = this.permitFilter(p);
    if (center)
      conds.push(
        'f.radius_lat IS NOT NULL',
        bbox(center.lat, center.lon, p.radius_miles, 'f.radius_lat', 'f.radius_lon'),
      );
    const dist = center
      ? HAV(center.lat, center.lon, 'f.radius_lat', 'f.radius_lon')
      : 'NULL::DOUBLE';
    const bm = `fts_main_permit_text.match_bm25(permit_id, ${lit(tokens.join(' '))}, fields := 'description_norm,permit_class_norm,work_class_norm', conjunctive := ${p.match === 'all' ? 1 : 0})`;
    const scored = `(SELECT permit_id, ${bm} AS score FROM permit_text)`;
    // Scores, filters, the total and the page's ids come from local tables; only the page's full rows are read from
    // permit_text_rows, by id (decisions.md section 30).
    const base = `(SELECT f.permit_id, s.score AS bm25_score, ${dist} AS distance_miles FROM ${scored} s JOIN permit_text_filters f ON f.permit_id = s.permit_id WHERE s.score IS NOT NULL AND ${conds.join(' AND ')})`;
    const within = center ? `WHERE distance_miles <= ${p.radius_miles}` : '';
    const total = await this.scalar(`SELECT count(*) FROM ${base} ${within}`);
    const hits = await this.all(
      `SELECT * FROM ${base} ${within} ORDER BY bm25_score DESC, permit_id ASC LIMIT ${p.limit} OFFSET ${offset}`,
    );
    const full = new Map(
      (hits.length
        ? await this.all(
            `SELECT * FROM permit_text_rows WHERE permit_id IN (${hits.map((h) => lit(h.permit_id)).join(', ')})`,
          )
        : []
      ).map((r) => [r.permit_id as string, r]),
    );
    const rows = hits.map((h) => {
      const r = full.get(h.permit_id);
      if (!r) throw new Error(`permit_text_rows has no permit ${h.permit_id}`);
      return { ...r, bm25_score: h.bm25_score, distance_miles: h.distance_miles };
    });
    const stems =
      (
        await this.all(
          `SELECT ${tokens.map((t) => `stem(${lit(t)}, 'porter') AS "${t.replace(/"/g, '')}"`).join(', ')}`,
        )
      )[0] ?? {};
    const stemList = Object.values(stems).map(String);
    const items = await this.permitSummaries(rows, asOf, (r) => ({
      ...(center ? { distance_miles: Math.round(Number(r.distance_miles) * 1000) / 1000 } : {}),
      bm25_score: Number(r.bm25_score),
      match_snippet: snippet(r, stemList),
    }));
    return { ...this.page(items, total, offset, p.limit, asOf), area_note: null as string | null };
  }

  async getPermit(permitId: string): Promise<PermitDetail> {
    const rows = await this.all(`SELECT * FROM permits WHERE permit_id = ${lit(permitId)}`);
    if (rows.length === 0) throw notFound(`permit ${permitId}`);
    const asOf = this.today();
    const [s] = await this.permitSummaries(rows, asOf);
    const pr = await this.propertyRow(`p.property_id = ${lit(rows[0]!.property_id)}`);
    return {
      ...(s as any),
      property: pr ? await this.propertySummary(pr) : null,
      applicant: null,
      applicant_unavailable_reason: 'not collected: personal contact fields',
    } as PermitDetail;
  }

  // ---- contractors -------------------------------------------------------------------------------------------------------------------
  async getContractor(key: string): Promise<Contractor> {
    const rows = await this.all(
      `SELECT * FROM contractors WHERE contractor_attribution_key = ${lit(key)}`,
    );
    if (rows.length === 0) throw notFound(`contractor ${key}`);
    const c = rows[0]!;
    const reg = await this
      .all(`SELECT rc.*, b.us_url, b.us_fetched_at, b.us_source_http_request, b.row_sha256, b.evidence_state, b.us_fields
      FROM registry_candidates rc JOIN business_records b USING (business_record_id) WHERE rc.contractor_attribution_key = ${lit(key)} ORDER BY rc.source, rc.business_record_id`);
    const lic = await this
      .all(`SELECT lc.*, l.us_url, l.us_fetched_at, l.us_source_http_request, l.row_sha256, l.evidence_state, l.us_fields
      FROM license_candidates lc JOIN license_records l USING (license_record_id) WHERE lc.contractor_attribution_key = ${lit(key)} ORDER BY lc.source, lc.license_record_id`);
    const haveLicenses = (await this.scalar('SELECT count(*) FROM license_records')) > 0;
    const us = (r: Row) => ({
      dataset: r.dataset,
      url: r.us_url,
      fetched_at: r.us_fetched_at,
      source_http_request: httpRequest(r.us_source_http_request),
      row_sha256: r.row_sha256,
      evidence_state: r.evidence_state,
      fields: r.us_fields,
    });
    return {
      contractor_attribution_key: c.contractor_attribution_key,
      identity_status: 'source_name_attribution',
      company_name: c.company_name ?? null,
      printed_names: c.printed_names ?? [],
      trade: c.trade ?? null,
      phone: phone(c.phone),
      address: c.address ?? null,
      permit_count: c.permit_count,
      open_permit_count: c.open_permit_count,
      roofing_permit_count: c.roofing_permit_count,
      needs_review_permit_count: c.needs_review_permit_count,
      registry_candidates: reg.map((r) => ({
        source: r.source,
        dataset: r.dataset,
        business_record_id: r.business_record_id,
        taxpayer_number: r.taxpayer_number ?? null,
        sos_file_number: r.sos_file_number ?? null,
        name: r.name,
        scope: r.scope,
        matched_field: r.matched_field,
        printed_value: r.printed_value,
        normalized_name: r.normalized_name,
        match_method: r.match_method,
        matcher_version: r.matcher_version,
        status: 'candidate',
        unpublished_source: us(r),
      })),
      license_candidates: haveLicenses
        ? lic.map((r) => ({
            source: r.source,
            dataset: r.dataset,
            license_record_id: r.license_record_id,
            license_number: r.license_number ?? null,
            license_type: r.license_type ?? null,
            name: r.name,
            matched_field: r.matched_field,
            printed_value: r.printed_value,
            normalized_name: r.normalized_name,
            match_method: r.match_method,
            matcher_version: r.matcher_version,
            status: 'candidate',
            unpublished_source: us(r),
          }))
        : null,
      official_identity: null,
      bbb: await this.bbb(),
    } as Contractor;
  }

  // ---- businesses and licenses ---------------------------------------------------------------------------------------------------------
  private matcherVersion = () =>
    this.memo('matcher', async () =>
      String(
        (await this.all('SELECT matcher_version FROM source_loads ORDER BY source_key LIMIT 1'))[0]
          ?.matcher_version ?? '',
      ),
    );

  private businessFromRow(r: Row): BusinessRecord {
    const a = [r.address_line1, r.address_line2, r.address_city, r.address_state, r.address_zip];
    return {
      business_record_id: r.business_record_id,
      source: r.source,
      dataset: r.dataset,
      record_id: r.record_id ?? null,
      record_id_withheld: r.record_id_withheld ?? null,
      name: r.name,
      sos_file_number: r.sos_file_number ?? null,
      organization_type: r.organization_type ?? null,
      status_code: r.status_code ?? null,
      status_date: r.status_date ?? null,
      right_to_transact: r.right_to_transact ?? null,
      naics_code: r.naics_code ?? null,
      address: a.every((x) => x === null || x === undefined)
        ? null
        : {
            line1: r.address_line1 ?? null,
            line2: r.address_line2 ?? null,
            city: r.address_city ?? null,
            state: r.address_state ?? null,
            zip: r.address_zip ?? null,
          },
      address_kind: r.address_kind ?? null,
      county_code: r.county_code ?? null,
      scope: r.scope,
      candidate_of: {
        contractor_attributions: r.candidate_of_contractors,
        roll_owners: r.candidate_of_owners,
      },
      detail_url: r.detail_url ?? null,
      printed: jparse(r.printed),
      record_cid: null,
      unpublished_source: {
        dataset: r.dataset,
        url: r.us_url,
        fetched_at: r.us_fetched_at,
        source_http_request: httpRequest(r.us_source_http_request),
        row_sha256: r.row_sha256,
        evidence_state: r.evidence_state,
        fields: r.us_fields,
      },
    } as BusinessRecord;
  }

  async searchBusinesses(p: BusinessSearchParams) {
    const asOf = this.today();
    const offset = this.decodeCursor(p.cursor, asOf);
    const conds: string[] = [];
    if (p.q !== undefined) {
      const n = normalizeMatcherName(p.q);
      if (n === null)
        return {
          items: [],
          total: 0,
          next_cursor: null,
          matcher_version: await this.matcherVersion(),
        };
      conds.push(
        p.match === 'prefix' ? `starts_with(name_norm, ${lit(n)})` : `name_norm = ${lit(n)}`,
      );
    } else {
      const v = lit((p.number ?? '').trim());
      conds.push(`(taxpayer_number = ${v} OR sos_file_number = ${v} OR record_id = ${v})`);
    }
    if (p.source) conds.push(`source IN (${p.source.map(lit).join(', ')})`);
    if (p.scope !== 'all') conds.push(`scope = ${lit(p.scope)}`);
    const where = conds.join(' AND ');
    const total = await this.scalar(`SELECT count(*) FROM business_records WHERE ${where}`);
    const rows = await this.all(
      `SELECT * FROM business_records WHERE ${where} ORDER BY name_norm, source, business_record_id LIMIT ${p.limit} OFFSET ${offset}`,
    );
    return {
      ...this.page(
        rows.map((r) => this.businessFromRow(r)),
        total,
        offset,
        p.limit,
        asOf,
      ),
      matcher_version: await this.matcherVersion(),
    };
  }
  async getBusiness(id: string): Promise<BusinessRecord> {
    const rows = await this.all(
      `SELECT * FROM business_records WHERE business_record_id = ${lit(id)}`,
    );
    if (rows.length === 0) throw notFound(`business record ${id}`);
    return this.businessFromRow(rows[0]!);
  }

  private licenseFromRow(r: Row): LicenseRecord {
    return {
      license_record_id: r.license_record_id,
      source: r.source,
      dataset: r.dataset,
      license_number: r.license_number ?? null,
      license_type: r.license_type ?? null,
      license_subtype: r.license_subtype ?? null,
      holder_name: r.holder_name ?? null,
      business_name: r.business_name ?? null,
      issue_date: r.issue_date ?? null,
      expiration_date: r.expiration_date ?? null,
      business_city: r.business_city ?? null,
      business_county: r.business_county ?? null,
      printed: jparse(r.printed),
      record_cid: null,
      unpublished_source: {
        dataset: r.dataset,
        url: r.us_url,
        fetched_at: r.us_fetched_at,
        source_http_request: httpRequest(r.us_source_http_request),
        row_sha256: r.row_sha256,
        evidence_state: r.evidence_state,
        fields: r.us_fields,
      },
    } as LicenseRecord;
  }
  async searchLicenses(p: LicenseSearchParams) {
    const asOf = this.today();
    const offset = this.decodeCursor(p.cursor, asOf);
    const conds: string[] = [];
    if (p.q !== undefined) {
      const n = normalizeMatcherName(p.q);
      if (n === null)
        return {
          items: [],
          total: 0,
          next_cursor: null,
          matcher_version: await this.matcherVersion(),
        };
      conds.push(
        p.match === 'prefix'
          ? `(starts_with(name_norm, ${lit(n)}) OR starts_with(business_name_norm, ${lit(n)}))`
          : `(name_norm = ${lit(n)} OR business_name_norm = ${lit(n)})`,
      );
    } else conds.push(`license_number = ${lit((p.license_number ?? '').trim())}`);
    if (p.source) conds.push(`source IN (${p.source.map(lit).join(', ')})`);
    if (p.license_type) conds.push(`license_type IN (${p.license_type.map(lit).join(', ')})`);
    const where = conds.join(' AND ');
    const total = await this.scalar(`SELECT count(*) FROM license_records WHERE ${where}`);
    const rows = await this.all(
      `SELECT * FROM license_records WHERE ${where} ORDER BY name_norm, source, license_record_id LIMIT ${p.limit} OFFSET ${offset}`,
    );
    return {
      ...this.page(
        rows.map((r) => this.licenseFromRow(r)),
        total,
        offset,
        p.limit,
        asOf,
      ),
      matcher_version: await this.matcherVersion(),
    };
  }
  async getLicense(id: string): Promise<LicenseRecord> {
    const rows = await this.all(
      `SELECT * FROM license_records WHERE license_record_id = ${lit(id)}`,
    );
    if (rows.length === 0) throw notFound(`license record ${id}`);
    return this.licenseFromRow(rows[0]!);
  }
}

/** As-printed substring (at most ~240 characters) of the first field that contains a query stem. */
function snippet(
  r: Row,
  stems: string[],
): { field: 'description' | 'permit_class' | 'work_class'; text: string } {
  const alias = TEXT_ALIASES[0]!;
  for (const field of ['description', 'permit_class', 'work_class'] as const) {
    const raw: string | null = r[field] ?? null;
    if (!raw) continue;
    const norm = normalizeText(raw);
    const hit = stems.find((s) => norm.includes(s));
    if (!hit) continue;
    let idx = raw.toLowerCase().indexOf(hit);
    if (idx < 0) {
      const m = new RegExp(alias.pattern.replace('\\b', ''), 'i').exec(raw);
      idx = m ? m.index : 0;
    }
    const start = Math.max(0, idx - 80);
    const end = Math.min(raw.length, start + 240);
    return { field, text: raw.slice(start, end) };
  }
  for (const field of ['description', 'permit_class', 'work_class'] as const)
    if (r[field]) return { field, text: String(r[field]).slice(0, 240) };
  return { field: 'description', text: '' };
}

/** Maps a verbatim run record onto the contract's Run shape (nulls where the contract allows; nothing invented). */
export function normalizeRun(rec: any, manifestCid: string | null, groupRows: Row[]): Row {
  const r: Row = { ...rec };
  if (rec.window) {
    r.window = Object.fromEntries(
      Object.entries<any>(rec.window).map(([k, v]) => [k, { from: null, to: null, ...v }]),
    );
  }
  if (Array.isArray(rec.limitations)) {
    r.limitations = rec.limitations.map((l: any) =>
      typeof l.records_request === 'string'
        ? {
            ...l,
            detail: `${l.detail} (records request: ${l.records_request})`,
            records_request: null,
          }
        : l,
    );
  }
  if ((!rec.groups || Object.keys(rec.groups).length === 0) && groupRows.length) {
    r.groups = Object.fromEntries(
      groupRows.map((g) => [
        `${g.group_name}/${g.shard}`,
        { cid: g.archive_cid, schema: g.schema_cid, tables: g.tables_cid },
      ]),
    );
  }
  if ((r.manifest_cid === null || r.manifest_cid === undefined) && manifestCid)
    r.manifest_cid = manifestCid;
  return r;
}
