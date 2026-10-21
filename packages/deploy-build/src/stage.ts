import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { RUN_DIR, RUN_RECORD_PATH, linkDir } from './env.js';
import { type Kit } from './kit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The served run's as-of date (its record's `roof_age.as_of_date`): permit durations and roof ages are as of it. */
export const ROOF_AGE_AS_OF: string = JSON.parse(readFileSync(RUN_RECORD_PATH, 'utf8')).roof_age
  .as_of_date;

/** NDJSON writer with backpressure. */
export class NdjsonWriter {
  private readonly stream: WriteStream;
  rows = 0;
  constructor(readonly file: string) {
    this.stream = createWriteStream(file, { highWaterMark: 8 << 20 });
  }
  async write(obj: unknown): Promise<void> {
    this.rows++;
    if (!this.stream.write(JSON.stringify(obj) + '\n'))
      await new Promise<void>((r) => this.stream.once('drain', () => r()));
  }
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

const blank = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.trim() === '' ? null : s;
};
const day = (v: unknown): string | null => {
  const s = blank(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const num = (v: unknown): number | null => {
  const s = blank(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** `travis-attribution-key.v1`: first 32 hex of SHA-256 of trim(company) U+001F trim(phone); company falls back to the full name. */
export function attributionKey(row: Record<string, string>): string | null {
  const company =
    (row.contractor_company_name ?? '').trim() || (row.contractor_full_name ?? '').trim();
  const phone = (row.contractor_phone ?? '').trim();
  // a permit that prints no company, no full name and no phone has no attribution (ruling: never a shared blank key)
  if (company === '' && phone === '') return null;
  return createHash('sha256').update(`${company}\u001f${phone}`, 'utf8').digest('hex').slice(0, 32);
}

export interface SeedStageResult {
  rows: number;
}

/**
 * One NDJSON row per TCAD seed row of every shard, with `tcad_row_sha256` = SHA-256 of the seed record text as stored in the
 * shard's seed.csv (the kit's `streamCsvRecords` record text, line terminator excluded).
 */
export async function stageSeed(
  kit: Kit,
  shards: string[],
  outFile: string,
): Promise<SeedStageResult> {
  const out = new NdjsonWriter(outFile);
  for (const shard of shards) {
    let header: string[] | null = null;
    for await (const rec of kit.shards.streamCsvRecords(
      path.join(RUN_DIR, 'shards', shard, 'seed.csv'),
    ) as AsyncGenerator<{ text: string; fields: string[] }>) {
      if (!header) {
        header = rec.fields;
        continue;
      }
      const r: Record<string, string> = {};
      header.forEach((h, i) => (r[h] = rec.fields[i] ?? ''));
      let mvqs: unknown;
      try {
        mvqs = JSON.parse(r.multiValueQueryString || '{}');
      } catch {
        mvqs = {};
      }
      await out.write({
        shard,
        property_id: r.source_prop_id,
        geo_id: blank(r.source_geo_id),
        situs_num: blank(r.source_situs_num),
        situs_prefix: blank(r.source_situs_street_prefx),
        situs_street: blank(r.source_situs_street),
        situs_suffix: blank(r.source_situs_street_suffix),
        situs_unit: blank(r.source_situs_unit),
        situs_city: blank(r.source_situs_city),
        situs_zip: blank(r.source_situs_zip),
        owner_name: blank(r.source_py_owner_name),
        addr1: blank(r.source_py_addr_line1),
        addr2: blank(r.source_py_addr_line2),
        addr3: blank(r.source_py_addr_line3),
        addr_city: blank(r.source_py_addr_city),
        addr_state: blank(r.source_py_addr_state),
        addr_zip: blank(r.source_py_addr_zip),
        owner_confidential: r.source_owner_confidential === 'T',
        deed_dt: blank(r.source_deed_dt),
        url: r.url,
        snapshot_at: r.source_snapshot_at,
        request: JSON.stringify({
          method: r.method || 'GET',
          url: r.url,
          multiValueQueryString: mvqs,
        }),
        row_sha256: createHash('sha256').update(rec.text, 'utf8').digest('hex'),
      });
    }
  }
  await out.close();
  return { rows: out.rows };
}

export interface PermitStageOptions {
  kit: Kit;
  shards: string[];
  /** property_id -> structure built year (lex.county_property) for the live parcels, per shard. */
  parcelsByShard: Map<string, { id: string; builtYear: number | null }[]>;
  permitsFile: string;
  roofAgeFile: string;
  log: (m: string) => void;
}

export interface PermitStageResult {
  permitRows: number;
  skippedNotLive: number;
  roofAgeRows: number;
  byStatusGroup: Record<string, number>;
  byRoofClass: Record<string, number>;
  roofAge: {
    eligible: number;
    byBasis: Record<string, number>;
    byConfidence: Record<string, number>;
  };
}

export async function stagePermitsAndRoofAge(o: PermitStageOptions): Promise<PermitStageResult> {
  const { kit } = o;
  const permitsOut = new NdjsonWriter(o.permitsFile);
  const roofOut = new NdjsonWriter(o.roofAgeFile);
  const res: PermitStageResult = {
    permitRows: 0,
    skippedNotLive: 0,
    roofAgeRows: 0,
    byStatusGroup: {},
    byRoofClass: {},
    roofAge: { eligible: 0, byBasis: {}, byConfidence: {} },
  };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  for (const shard of o.shards) {
    const parcels = o.parcelsByShard.get(shard) ?? [];
    const live = new Set(parcels.map((p) => p.id));
    const byProp = new Map<string, { row: any; link: any }[]>();
    const rl = createInterface({
      input: createReadStream(path.join(linkDir(), `${shard}.jsonl`), {
        highWaterMark: 4 << 20,
      }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      const d = JSON.parse(line) as any;
      const pid: string | null = d.link?.propertyId ?? null;
      if (pid === null || !live.has(pid)) {
        o.log(
          `  ${shard}: permit ${d.row?.permit_number} links to ${pid}, which is not a published parcel`,
        );
        res.skippedNotLive++;
        continue;
      }
      const row = d.row as Record<string, string>;
      const s = kit.profile.summarizePermitRow(row, { asOfDate: ROOF_AGE_AS_OF });
      const ev = s.completedDateEvidence;
      let list = byProp.get(pid);
      if (!list) byProp.set(pid, (list = []));
      list.push({ row, link: { propertyLink: d.link.propertyLink } });
      bump(res.byStatusGroup, s.statusGroup);
      bump(res.byRoofClass, s.roofWorkClass);
      await permitsOut.write({
        permit_id: String(row.permit_number).trim(),
        property_id: pid,
        shard,
        link_match_method: d.link.propertyLink.match_method,
        link_normalization_version: d.link.propertyLink.normalization_version ?? null,
        link_confidence: d.link.propertyLink.confidence,
        source_url: blank(row.link),
        geo_id: blank(row.tcad_id),
        permit_type: blank(row.permittype),
        permit_type_desc: blank(row.permit_type_desc),
        permit_class: blank(row.permit_class),
        work_class: blank(row.work_class),
        description: blank(row.description),
        status: blank(row.status_current),
        status_date: day(row.statusdate),
        applied_date: day(row.applieddate),
        issued_date: day(row.issue_date),
        expires_date: day(row.expiresdate),
        completed_date: ev.evidenceState === 'confirmed_present' ? ev.value : null,
        completed_date_raw:
          ev.evidenceState === 'invalid_quarantined' ? blank(row.completed_date) : null,
        completed_date_evidence: ev.evidenceState,
        lat: num(row.latitude),
        lon: num(row.longitude),
        contractor_trade: blank(row.contractor_trade),
        contractor_company_name: blank(row.contractor_company_name),
        contractor_full_name: blank(row.contractor_full_name),
        contractor_phone: blank(row.contractor_phone),
        contractor_address1: blank(row.contractor_address1),
        contractor_address2: blank(row.contractor_address2),
        contractor_city: blank(row.contractor_city),
        contractor_zip: blank(row.contractor_zip),
        contractor_attribution_key: attributionKey(row),
        roof_work_class: s.roofWorkClass,
        work_classifier_version: s.workClassifierVersion,
        is_roofing: s.isRoofing,
        is_reroof: s.isReroof,
        status_group: s.statusGroup,
        lifecycle_status: s.lifecycleStatus,
        status_observed_at: d.fetchedAt,
        capture_file: d.file,
        capture_row_index: d.index,
        capture_row_sha256: d.rowSha256,
        capture_receipt_sha256: d.receiptSha256,
      });
      res.permitRows++;
    }
    for (const p of parcels) {
      const est = kit.roofAge.estimateParcelRoofAge({
        propId: p.id,
        builtYear: p.builtYear,
        permits: byProp.get(p.id) ?? [],
        asOfDate: ROOF_AGE_AS_OF,
      });
      const a = est.roof_age_anchor;
      await roofOut.write({
        property_id: p.id,
        roof_age_as_of: est.roof_age_as_of,
        roof_year: est.roof_year,
        roof_age_years: est.roof_age_years,
        roof_age_basis: est.roof_age_basis,
        roof_age_confidence: est.roof_age_confidence,
        anchor_permit_id: a && 'permit_id' in a ? a.permit_id : null,
        anchor_date: a && 'permit_id' in a ? a.date : null,
        anchor_date_field: a && 'permit_id' in a ? a.date_field : null,
        anchor_year_built: Boolean(a && a.source_field === 'year_built'),
        caveats: est.roof_age_caveats,
      });
      res.roofAgeRows++;
      if (est.roof_age_basis !== null) res.roofAge.eligible++;
      bump(res.roofAge.byBasis, est.roof_age_basis ?? 'none');
      bump(res.roofAge.byConfidence, est.roof_age_confidence);
    }
    o.log(`  ${shard}: ${parcels.length} parcels, ${res.permitRows} permits so far`);
  }
  await permitsOut.close();
  await roofOut.close();
  return res;
}
