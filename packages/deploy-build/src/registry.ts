import path from 'node:path';
import { normalizeMatcherName } from '@travis/query';
import type { BuildOptions } from './build.js';
import { Db, q } from './db.js';
import { KIT_DATA } from './env.js';
import type { Kit } from './kit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RegistryResult {
  reads: object[];
}

const REG = (n: string) => path.join(KIT_DATA, 'registry', n);
const LIC = (n: string) => path.join(KIT_DATA, 'licensing', n);
const MATCH = (n: string) => path.join(KIT_DATA, 'matcher', `${n}.names.parquet`);
const US = 'chr(31)';
const recId = (source: string, ...parts: string[]) =>
  `substr(sha256(${[q(source), ...parts].join(` || ${US} || `)}), 1, 32)`;

async function describeCols(db: Db, file: string): Promise<string[]> {
  const rows = await db.rows<{ column_name: string }>(
    `SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet(${q(file)}))`,
  );
  return rows.map((r) => r.column_name);
}

/** JSON object of the source columns as printed (trimmed values), the un-suffixed names, minus `exclude`. */
function printedExpr(cols: string[], exclude: string[] = []): string {
  const base = cols
    .filter((c) => c.endsWith('__trimmed'))
    .map((c) => c.slice(0, -'__trimmed'.length))
    .filter((c) => !exclude.includes(c));
  return `json_object(${base.map((c) => `${q(c)}, ${c}__trimmed`).join(', ')})::VARCHAR`;
}

const reqJson = (urlCol: string) =>
  `json_object('method', 'GET', 'url', ${urlCol}, 'multiValueQueryString', json_object())::VARCHAR`;

export async function loadRegistry(
  db: Db,
  kit: Kit,
  o: BuildOptions,
  tmp: (n: string) => string,
): Promise<RegistryResult> {
  const MATCHER_VERSION: string = kit.matcher.MATCHER_VERSION;
  const MATCH_METHOD: string = kit.matcher.MATCH_METHOD;
  const normalizeName: (s: unknown) => string | null = kit.matcher.normalizeName;

  // ---- contractors --------------------------------------------------------------------------------------------------
  const top = (name: string, expr: string) =>
    db.run(`CREATE TEMP TABLE c_${name} AS SELECT k, v FROM (
      SELECT contractor_attribution_key AS k, ${expr} AS v, count(*) AS c FROM permits WHERE ${expr} IS NOT NULL AND contractor_attribution_key IS NOT NULL GROUP BY 1, 2)
      QUALIFY row_number() OVER (PARTITION BY k ORDER BY c DESC, v) = 1`);
  await top('company', 'contractor_company_name');
  await top('trade', 'contractor_trade');
  await top('phone', 'contractor_phone');
  await top(
    'address',
    `nullif(trim(concat_ws(', ', nullif(trim(contractor_address1), ''), nullif(trim(contractor_address2), ''), nullif(trim(concat_ws(' ', contractor_city, contractor_zip)), ''))), '')`,
  );
  await db.run(`INSERT INTO contractors
    SELECT p.k, 'travis-attribution-key.v1', co.v, coalesce(nm.names, []), tr.v, ph.v, ad.v, p.n, p.open_n, p.roof_n, p.nr_n,
      'blocked', NULL, 'http_403_source_block', NULL
    FROM (SELECT contractor_attribution_key AS k, count(*)::INTEGER n, count(*) FILTER (status_group = 'open')::INTEGER open_n,
            count(*) FILTER (is_roofing)::INTEGER roof_n, count(*) FILTER (status_group = 'needs_review')::INTEGER nr_n
          FROM permits WHERE contractor_attribution_key IS NOT NULL GROUP BY 1) p
    LEFT JOIN c_company co ON co.k = p.k LEFT JOIN c_trade tr ON tr.k = p.k LEFT JOIN c_phone ph ON ph.k = p.k LEFT JOIN c_address ad ON ad.k = p.k
    LEFT JOIN (SELECT contractor_attribution_key AS k, list(DISTINCT contractor_full_name ORDER BY contractor_full_name) AS names
               FROM permits WHERE contractor_full_name IS NOT NULL AND contractor_attribution_key IS NOT NULL GROUP BY 1) nm ON nm.k = p.k`);
  await db.run(
    `UPDATE contractors SET bbb_note = ${q('BBB returns a bot challenge and 403 to scripted access; ratings ship as null, status blocked, until approved API access (decisions.md section 4)')}`,
  );

  // ---- contractor names normalized by the kit matcher ---------------------------------------------------------------------
  const names = await db.rows<{ k: string; field: string; printed: string }>(
    `SELECT k, 'company_name' AS field, v AS printed FROM c_company
     UNION ALL SELECT contractor_attribution_key, 'printed_name', contractor_full_name FROM permits WHERE contractor_full_name IS NOT NULL AND contractor_attribution_key IS NOT NULL GROUP BY 1, 3`,
  );
  const cn = names
    .map((n) => ({ ...n, norm: normalizeName(n.printed) }))
    .filter((n) => n.norm !== null);
  await db.run(
    'CREATE TEMP TABLE contractor_names (k VARCHAR, field VARCHAR, printed VARCHAR, norm VARCHAR)',
  );
  await db.insertJson(
    'contractor_names',
    cn.map((n) => ({ k: n.k, field: n.field, printed: n.printed, norm: n.norm })),
    tmp('cn.ndjson'),
  );

  const candSql = (source: string, names: string) =>
    `SELECT cn.k, cn.field, cn.printed, cn.norm, nm.entity_key, ${q(source)} AS source
     FROM contractor_names cn JOIN read_parquet(${q(MATCH(names))}) nm ON nm.normalized_name = cn.norm WHERE nm.keys_under_name = 1`;
  await db.run(
    `CREATE TEMP TABLE cand_keys (k VARCHAR, field VARCHAR, printed VARCHAR, norm VARCHAR, entity_key VARCHAR, source VARCHAR)`,
  );
  // registry sources match the printed company name only; license sources match the company and the printed full name
  for (const [source, names, fields] of [
    ['tx-comptroller-franchise-tax', 'tx-comptroller-franchise-tax-statewide', ['company_name']],
    ['tx-comptroller-sales-tax', 'tx-comptroller-sales-tax-travis', ['company_name']],
    ['tx-sos-veteran-owned-business', 'tx-sos-veteran-owned-business', ['company_name']],
    ['tdlr-license-files', 'tdlr-license-files', ['company_name', 'printed_name']],
    [
      'tsbpe-responsible-master-plumber',
      'tsbpe-responsible-master-plumber',
      ['company_name', 'printed_name'],
    ],
    [
      'austin-row-contractor-licenses',
      'austin-row-contractor-licenses',
      ['company_name', 'printed_name'],
    ],
  ] as const) {
    await db.run(
      `INSERT INTO cand_keys SELECT * FROM (${candSql(source, names)}) WHERE field IN (${fields.map(q).join(', ')})`,
    );
  }

  // ---- business records ---------------------------------------------------------------------------------------------------
  const FR = 'tx-comptroller-franchise-tax';
  const ST = 'tx-comptroller-sales-tax';
  const VO = 'tx-sos-veteran-owned-business';
  const frTravis = REG('tx-comptroller-franchise-tax-travis.parquet');
  const frState = REG('tx-comptroller-franchise-tax-statewide.parquet');
  const stFile = REG('tx-comptroller-sales-tax-travis.parquet');
  const voFile = REG('tx-sos-veteran-owned-business.parquet');
  const joinFile = REG('tx-sos-veteran-owned-business.franchise-join.parquet');
  const frCols = await describeCols(db, frTravis);
  const stCols = await describeCols(db, stFile);
  const voCols = await describeCols(db, voFile);
  const detail = `CASE WHEN regexp_matches(taxpayer_number__trimmed, '^[0-9]{11}$') THEN ${q(kit.sources.COMPTROLLER_FRANCHISE_DETAIL_PREFIX)} || taxpayer_number__trimmed END`;
  const frSelect = (file: string, where: string) => `
    SELECT ${recId(FR, 'taxpayer_number__trimmed')} AS business_record_id, ${q(FR)} AS source, ${q('tx-comptroller-franchise-tax/9cir-efmm')} AS dataset,
      taxpayer_number__trimmed AS record_id, NULL::VARCHAR AS record_id_withheld, taxpayer_number__trimmed AS taxpayer_number,
      taxpayer_name__trimmed AS name, secretary_of_state_sos_or_coa_file_number__trimmed AS sos_file_number,
      taxpayer_organizational_type__trimmed AS organization_type, sos_status_code__trimmed AS status_code,
      sos_status_date__trimmed AS status_date, right_to_transact_business_code__trimmed AS right_to_transact, _621111__trimmed AS naics_code,
      taxpayer_address__trimmed AS address_line1, NULL::VARCHAR AS address_line2, taxpayer_city__trimmed AS address_city,
      taxpayer_state__trimmed AS address_state, taxpayer_zip__trimmed AS address_zip, 'mailing' AS address_kind,
      taxpayer_county_code__trimmed AS county_code, CASE WHEN taxpayer_county_code__trimmed = '227' THEN 'travis' ELSE 'out_of_county' END AS scope,
      ${detail} AS detail_url, ${printedExpr(frCols)} AS printed,
      _capture_url AS us_url, _capture_fetched_at AS us_fetched_at, ${reqJson('_capture_url')} AS us_source_http_request, _row_sha256 AS row_sha256,
      'confirmed_present' AS evidence_state,
      ['record_id','taxpayer_number','name','sos_file_number','organization_type','status_code','status_date','right_to_transact','naics_code','address','county_code'] AS us_fields,
      taxpayer_number__trimmed AS entity_key
    FROM read_parquet(${q(file)}) ${where}`;
  await db.run(`CREATE TEMP TABLE biz_raw AS
    ${frSelect(frTravis, '')}
    UNION ALL ${frSelect(frState, `WHERE taxpayer_county_code__trimmed <> '227' AND taxpayer_number__trimmed IN (SELECT entity_key FROM cand_keys WHERE source = ${q(FR)})`)}
    UNION ALL
    SELECT CASE WHEN _privacy_class IS NULL THEN ${recId(ST, 'taxpayer_number__trimmed', 'outlet_number__trimmed')} ELSE _withheld_record_id END, ${q(ST)}, ${q('tx-comptroller-sales-tax/jrea-zgmq')},
      CASE WHEN _privacy_class IS NULL THEN taxpayer_number__trimmed || '-' || outlet_number__trimmed END, _privacy_class,
      CASE WHEN _privacy_class IS NULL THEN taxpayer_number__trimmed END,
      outlet_name__trimmed, NULL, taxpayer_organization_type__trimmed, NULL, NULL, NULL, outlet_naics_code__trimmed,
      outlet_address__trimmed, NULL, outlet_city__trimmed, outlet_state__trimmed, outlet_zip_code__trimmed, 'outlet', outlet_county_code__trimmed,
      CASE WHEN outlet_county_code__trimmed = '227' THEN 'travis' ELSE 'out_of_county' END, NULL,
      CASE WHEN _privacy_class IS NULL THEN ${printedExpr(stCols)} ELSE ${printedExpr(stCols, ['taxpayer_number'])} END,
      _capture_url, _capture_fetched_at, ${reqJson('_capture_url')}, _row_sha256, 'confirmed_present',
      ['record_id','name','organization_type','naics_code','address','county_code'],
      coalesce(nullif(taxpayer_number__trimmed, ''), 'withheld:' || _withheld_record_id)
    FROM read_parquet(${q(stFile)})
    UNION ALL
    SELECT ${recId(VO, 'v.filing_number__trimmed')}, ${q(VO)}, ${q('tx-sos-veteran-owned-business/2vfr-72e4')}, v.filing_number__trimmed, NULL, NULL,
      v.name__trimmed, v.filing_number__trimmed, v.corp_type__trimmed, v.status_description__trimmed, v.inactive_date__trimmed, NULL, NULL,
      v.entity_address1__trimmed, v.entity_address2__trimmed, v.entity_city__trimmed, v.entity_state__trimmed, v.entity_zip_code__trimmed, 'mailing', NULL,
      CASE WHEN j.match = 'travis' THEN 'travis' ELSE 'out_of_county' END, NULL, ${printedExpr(voCols, ['taxid']).replace(/(\w+)__trimmed/g, 'v.$1__trimmed')},
      v._capture_url, v._capture_fetched_at, ${reqJson('v._capture_url')}, v._row_sha256, 'confirmed_present',
      ['record_id','name','sos_file_number','organization_type','status_code','status_date','address'], v.filing_number__trimmed
    FROM read_parquet(${q(voFile)}) v LEFT JOIN read_parquet(${q(joinFile)}) j ON j.veteran_row_sha256 = v._row_sha256
    WHERE j.match = 'travis' OR v.filing_number__trimmed IN (SELECT entity_key FROM cand_keys WHERE source = ${q(VO)})`);
  const bizTotal = await db.scalar('SELECT count(*) FROM biz_raw');
  await db.run(
    `CREATE TEMP TABLE biz_dedup AS SELECT * FROM biz_raw QUALIFY row_number() OVER (PARTITION BY business_record_id ORDER BY row_sha256) = 1`,
  );
  const bizDistinct = await db.scalar('SELECT count(*) FROM biz_dedup');

  // ---- license records ---------------------------------------------------------------------------------------------------
  const tdlr = LIC('tdlr-license-files.parquet');
  const tsbpe = LIC('tsbpe-responsible-master-plumber.parquet');
  const arow = LIC('austin-row-contractor-licenses.parquet');
  const tdCols = await describeCols(db, tdlr);
  const tsCols = await describeCols(db, tsbpe);
  const arCols = await describeCols(db, arow);
  const TD = 'tdlr-license-files';
  const TS = 'tsbpe-responsible-master-plumber';
  const AR = 'austin-row-contractor-licenses';
  const date = (c: string) =>
    `coalesce(try_strptime(${c}, '%m/%d/%Y')::DATE, try_cast(left(${c}, 10) AS DATE))`;
  const tdKey = `license_type__trimmed || ${US} || coalesce(license_subtype__trimmed, '') || ${US} || license_number__trimmed`;
  await db.run(`CREATE TEMP TABLE lic_raw AS
    SELECT ${recId(TD, 'license_type__trimmed', "coalesce(license_subtype__trimmed, '')", 'license_number__trimmed')} AS license_record_id, ${q(TD)} AS source,
      ${q('tdlr-license-files')} AS dataset, license_number__trimmed AS license_number, license_type__trimmed AS license_type,
      license_subtype__trimmed AS license_subtype, name__trimmed AS holder_name, business_name__trimmed AS business_name,
      NULL::DATE AS issue_date, ${date('license_expiration_date__trimmed')} AS expiration_date,
      nullif(trim(split_part(business_city_state_zip__trimmed, ',', 1)), '') AS business_city, business_county__trimmed AS business_county,
      ${printedExpr(tdCols, ['mailing_address_line1', 'mailing_address_line2', 'mailing_address_city_state_zip', 'phone_number', 'mailing_address_that_mentions_box', 'phone_same_or_not', 'same_address_or_not'])} AS printed,
      _capture_url AS us_url, _capture_fetched_at AS us_fetched_at, ${reqJson('_capture_url')} AS us_source_http_request, _row_sha256 AS row_sha256,
      ['license_number','license_type','license_subtype','holder_name','business_name','expiration_date','business_city','business_county'] AS us_fields,
      (${tdKey}) AS entity_key, upper(coalesce(business_county__trimmed, '')) = 'TRAVIS' AS in_scope
    FROM read_parquet(${q(tdlr)})
    UNION ALL
    SELECT ${recId(TS, 'license_nbr__trimmed')}, ${q(TS)}, ${q('tsbpe-responsible-master-plumber')}, license_nbr__trimmed, 'Responsible Master Plumber', NULL,
      nullif(trim(concat_ws(' ', first_name__trimmed, middle_name__trimmed, last_name__trimmed, suffix__trimmed)), ''), plumb_company__trimmed,
      ${date('license_date__trimmed')}, ${date('expiration_dte__trimmed')}, NULL, county__trimmed,
      ${printedExpr(tsCols, ['addr1', 'addr2', 'addr3', 'city', 'state', 'zip', 'phone'])},
      _capture_url, _capture_fetched_at, ${reqJson('_capture_url')}, _row_sha256,
      ['license_number','license_type','holder_name','business_name','issue_date','expiration_date','business_county'], license_nbr__trimmed, TRUE
    FROM read_parquet(${q(tsbpe)})
    UNION ALL
    SELECT ${recId(AR, 'license_number__trimmed')}, ${q(AR)}, ${q('austin-row-contractor-licenses/8d92-wsiw')}, license_number__trimmed, 'Right of Way Contractor', NULL,
      contractor_name__trimmed, NULL, ${date('issue_date__trimmed')}, ${date('expiration_date__trimmed')}, NULL, NULL,
      ${printedExpr(arCols)}, _capture_url, _capture_fetched_at, ${reqJson('_capture_url')}, _row_sha256,
      ['license_number','license_type','holder_name','issue_date','expiration_date'], license_number__trimmed, TRUE
    FROM read_parquet(${q(arow)})`);
  const licTotal = await db.scalar('SELECT count(*) FROM lic_raw');
  await db.run(`CREATE TEMP TABLE lic_dedup AS SELECT * FROM lic_raw
    WHERE in_scope OR entity_key IN (SELECT entity_key FROM cand_keys WHERE source = ${q(TD)})
    QUALIFY row_number() OVER (PARTITION BY license_record_id ORDER BY row_sha256) = 1`);

  // ---- name normalization for name_norm (the kit's normalizer; asserted equal to the query layer's) -------------------------
  const raw = await db.rows<{ s: string }>(
    `SELECT DISTINCT s FROM (SELECT name AS s FROM biz_dedup UNION ALL SELECT holder_name FROM lic_dedup UNION ALL SELECT business_name FROM lic_dedup) WHERE s IS NOT NULL`,
  );
  let disagree = 0;
  const mapRows = raw.map((r) => {
    const a = normalizeName(r.s);
    if (a !== normalizeMatcherName(r.s)) disagree++;
    return { raw: r.s, norm: a ?? '' };
  });
  if (disagree)
    throw new Error(
      `the query layer's matcher normalizer disagrees with the kit's on ${disagree} loaded names`,
    );
  await db.run('CREATE TEMP TABLE norm_map (raw VARCHAR, norm VARCHAR)');
  await db.insertJson('norm_map', mapRows, tmp('norm_map.ndjson'));

  await db.run(`INSERT INTO business_records BY NAME
    SELECT b.* EXCLUDE (entity_key), coalesce(nm.norm, '') AS name_norm, 0 AS candidate_of_contractors, 0 AS candidate_of_owners
    FROM biz_dedup b LEFT JOIN norm_map nm ON nm.raw = b.name`);
  await db.run(`INSERT INTO license_records BY NAME
    SELECT l.* EXCLUDE (entity_key, in_scope), coalesce(n1.norm, '') AS name_norm, n2.norm AS business_name_norm, 'confirmed_present' AS evidence_state
    FROM lic_dedup l LEFT JOIN norm_map n1 ON n1.raw = l.holder_name LEFT JOIN norm_map n2 ON n2.raw = l.business_name`);

  // ---- candidates (exact_unique_normalized_name) ----------------------------------------------------------------------------
  await db.run(`INSERT INTO registry_candidates
    SELECT c.k, b.business_record_id, b.source, b.dataset, b.taxpayer_number, b.sos_file_number, b.name, b.scope, 'company_name', c.printed, c.norm,
      ${q(MATCH_METHOD)}, ${q(MATCHER_VERSION)}
    FROM cand_keys c JOIN biz_dedup b ON b.source = c.source AND b.entity_key = c.entity_key
    WHERE c.field = 'company_name' AND c.source IN (${q(FR)}, ${q(ST)}, ${q(VO)})
    QUALIFY row_number() OVER (PARTITION BY c.k, b.business_record_id ORDER BY c.norm) = 1`);
  await db.run(`INSERT INTO license_candidates
    SELECT c.k, l.license_record_id, l.source, l.dataset, l.license_number, l.license_type,
      CASE WHEN c.field = 'company_name' THEN coalesce(l.business_name, l.holder_name) ELSE l.holder_name END, c.field, c.printed, c.norm,
      ${q(MATCH_METHOD)}, ${q(MATCHER_VERSION)}
    FROM cand_keys c JOIN lic_dedup l ON l.source = c.source AND l.entity_key = c.entity_key
    WHERE c.source IN (${q(TD)}, ${q(TS)}, ${q(AR)})
    QUALIFY row_number() OVER (PARTITION BY c.k, l.license_record_id ORDER BY (c.field = 'company_name') DESC, c.norm) = 1`);
  await db.run(`UPDATE business_records SET candidate_of_contractors = x.n FROM (
      SELECT business_record_id, count(DISTINCT contractor_attribution_key)::INTEGER n FROM registry_candidates GROUP BY 1) x
    WHERE business_records.business_record_id = x.business_record_id`);
  // out-of-county rows are loaded only as candidates: drop any that did not match (veteran/franchise candidates are all matched by construction)
  const orphans = await db.scalar(
    `SELECT count(*) FROM business_records WHERE scope = 'out_of_county' AND candidate_of_contractors = 0 AND candidate_of_owners = 0`,
  );
  if (orphans)
    throw new Error(
      `${orphans} out-of-county business records are not a candidate of any contractor`,
    );

  // ---- source_loads and reads ----------------------------------------------------------------------------------------------
  const srcInfo = [
    { key: FR, kind: 'business', dataset: 'tx-comptroller-franchise-tax/9cir-efmm', read: frState },
    { key: ST, kind: 'business', dataset: 'tx-comptroller-sales-tax/jrea-zgmq', read: stFile },
    { key: VO, kind: 'business', dataset: 'tx-sos-veteran-owned-business/2vfr-72e4', read: voFile },
    { key: TD, kind: 'license', dataset: 'tdlr-license-files', read: tdlr },
    { key: TS, kind: 'license', dataset: 'tsbpe-responsible-master-plumber', read: tsbpe },
    { key: AR, kind: 'license', dataset: 'austin-row-contractor-licenses/8d92-wsiw', read: arow },
  ];
  const reads: object[] = [];
  const runSources = JSON.parse(
    (await import('node:fs')).readFileSync((await import('./env.js')).RUN_RECORD_PATH, 'utf8'),
  ).sources as any[];
  const shaOf = (name: string) => runSources.find((s) => s.dataset === name)?.sha256 as string;
  const sourceRunName: Record<string, string> = {
    [FR]: 'tx-comptroller-franchise-tax-statewide',
    [ST]: 'tx-comptroller-sales-tax-travis',
    [VO]: VO,
    [TD]: TD,
    [TS]: TS,
    [AR]: AR,
  };
  for (const s of srcInfo) {
    const t = s.kind === 'business' ? 'business_records' : 'license_records';
    const rowsRead = await db.scalar(`SELECT count(*) FROM read_parquet(${q(s.read)})`);
    const loaded = await db.scalar(`SELECT count(*) FROM ${t} WHERE source = ${q(s.key)}`);
    const scopeCol =
      s.kind === 'business'
        ? `scope = 'travis'`
        : s.key === TD
          ? `upper(coalesce(business_county, '')) = 'TRAVIS'`
          : 'TRUE';
    const inScope = await db.scalar(
      `SELECT count(*) FROM ${t} WHERE source = ${q(s.key)} AND ${scopeCol}`,
    );
    const withheld =
      s.kind === 'business'
        ? await db.scalar(
            `SELECT count(*) FROM business_records WHERE source = ${q(s.key)} AND record_id_withheld IS NOT NULL`,
          )
        : 0;
    const candidates = await db.scalar(
      `SELECT count(DISTINCT k) FROM cand_keys WHERE source = ${q(s.key)} AND entity_key IN (SELECT entity_key FROM ${s.kind === 'business' ? 'biz_dedup' : 'lic_dedup'} WHERE source = ${q(s.key)})`,
    );
    const fetched = await db.one<{ f: string }>(
      `SELECT max(us_fetched_at) AS f FROM ${t} WHERE source = ${q(s.key)}`,
    );
    const dupRows =
      s.kind === 'business'
        ? await db.scalar(
            `SELECT count(*) FROM biz_raw WHERE source = ${q(s.key)} AND business_record_id IN (SELECT business_record_id FROM biz_raw GROUP BY 1 HAVING count(*) > 1)`,
          )
        : await db.scalar(
            `SELECT count(*) FROM lic_raw WHERE source = ${q(s.key)} AND license_record_id IN (SELECT license_record_id FROM lic_raw GROUP BY 1 HAVING count(*) > 1)`,
          );
    await db.run(
      `INSERT INTO source_loads VALUES (${[q(s.key), q(s.kind), q(s.dataset), loaded, inScope, loaded - inScope, withheld, candidates, q(fetched.f), q(MATCHER_VERSION)].join(', ')})`,
    );
    const sha = shaOf(sourceRunName[s.key]!);
    // identical duplicate rows (TDLR repeats rows across its daily files) are not conflicts; differing ones are
    const conflicting = s.key === TD ? 0 : dupRows;
    reads.push({
      dataset: s.dataset,
      url: `kit capture of ${s.dataset}`,
      fetched_at: fetched.f,
      sha256: sha,
      rows: rowsRead,
      matched: loaded,
      unavailable: 0,
      conflicting,
    });
  }
  o.log(`  business rows ${bizTotal} -> ${bizDistinct}; license rows ${licTotal}`);
  return { reads };
}
