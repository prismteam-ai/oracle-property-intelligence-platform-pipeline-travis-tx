import { readFileSync } from 'node:fs';
import { ROOFING_CLASSES, classSignalColumns } from '@travis/query';
import type { BuildOptions } from './build.js';
import type { Db } from './db.js';
import { MANIFEST_PATH, RUN_RECORD_PATH } from './env.js';
import type { PermitsInternalSummary } from './meta.js';
import type { PermitStageResult } from './stage.js';

/** The T5 record's own numbers (docs/decisions.md section 27; runs/20261018T143520Z-t5-full.json), stated by the task. */
export const T5 = {
  seed: 441961,
  properties: 441939,
  dead: 22,
  publishedPermits: 1986484,
  parcelsWithPermits: 237531,
  capturedPermits: 2380707,
  roofAgeEligible: 390212,
  high: 12199,
  medium: 96601,
  low: 281412,
  none: 51727,
} as const;

/**
 * The served run's own numbers, read from its record (decisions.md section 33: run 2 is served). Run 1's record equals
 * {@link T5}, which the build still checks when run 1 is served.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function expectedOf(run: any): Record<keyof typeof T5, number> {
  const a = run.counts.appraisal;
  const p = run.counts.permits;
  const r = run.roof_age;
  return {
    seed: a.seed,
    properties: a.ready,
    dead: a.dead,
    publishedPermits: p.published,
    parcelsWithPermits: p.parcels_with_permits,
    capturedPermits: p.captured,
    roofAgeEligible: r.eligible,
    high: r.by_confidence.high,
    medium: r.by_confidence.medium,
    low: r.by_confidence.low,
    none: a.ready - r.eligible,
  };
}

export interface ReconcileReport {
  ok: boolean;
  textIndexRows: number;
  numbers: Record<string, number>;
  checks: { name: string; expected: unknown; actual: unknown; ok: boolean }[];
}

/** Compares the built database with the T5 record, the manifest and the kit's own reference files; throws when anything is off. */
export async function reconcile(
  db: Db,
  o: BuildOptions,
  ctx: { staged: PermitStageResult; permitsInternal: PermitsInternalSummary },
): Promise<ReconcileReport> {
  const run = JSON.parse(readFileSync(RUN_RECORD_PATH, 'utf8'));
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const checks: ReconcileReport['checks'] = [];
  const numbers: Record<string, number> = {};
  const eq = (name: string, actual: unknown, expected: unknown) =>
    checks.push({ name, expected, actual, ok: actual === expected });
  const n = (name: string, v: number) => (numbers[name] = v);

  const expected = expectedOf(run);
  if (run.run_id === '20261018T143520Z-t5-full')
    for (const [key, value] of Object.entries(T5))
      eq(`run 1 record ${key} = T5`, expected[key as keyof typeof T5], value);
  const counts = Object.fromEntries(
    (await db.rows<{ name: string; value: string }>('SELECT * FROM meta_counts')).map((r) => [
      r.name,
      Number(r.value),
    ]),
  );
  for (const [k, v] of Object.entries(counts)) n(k, v);

  // internal consistency of the pieces regardless of scope
  eq('privacy violations', await db.scalar('SELECT count(*) FROM v_privacy_violations'), 0);
  const ftsRows = await db.scalar('SELECT count(*) FROM fts_main_permit_text.docs');
  const textRows = await db.scalar('SELECT count(*) FROM permit_text');
  eq('fts docs = permit_text rows', ftsRows, textRows);
  eq(
    'permit_text = text-indexed permits',
    textRows,
    await db.scalar('SELECT count(*) FROM permits WHERE is_text_indexed'),
  );
  n('text_index_rows', textRows);

  // the kit's own roof-age estimates, parcel by parcel
  const refMismatch =
    await db.scalar(`SELECT count(*) FROM properties p JOIN roof_age_reference r USING (property_id)
    WHERE p.roof_year IS DISTINCT FROM r.roof_year OR p.roof_age_years IS DISTINCT FROM r.roof_age_years
      OR p.roof_age_basis IS DISTINCT FROM r.roof_age_basis OR p.roof_age_confidence IS DISTINCT FROM r.roof_age_confidence`);
  eq(
    'roof age: parcels differing from the kit reference (reconcile-a<n>/roof-age.jsonl)',
    refMismatch,
    0,
  );
  eq(
    'roof age reference rows = properties',
    await db.scalar('SELECT count(*) FROM roof_age_reference'),
    counts.properties,
  );

  // the profile's classification vs the kit's permits-internal.jsonl, permit by permit
  const clsMismatch =
    await db.scalar(`SELECT count(*) FROM permits p JOIN permits_internal i ON i.permit_number = p.permit_id
    WHERE p.status_group_profile <> i.status_group OR p.roof_work_class <> i.roof_work_class OR p.is_roofing <> i.is_roofing
      OR p.is_reroof <> i.is_reroof OR p.lifecycle_status <> i.lifecycle_status OR p.completed_date_evidence <> i.completed_date_evidence
      OR p.property_id <> i.property_id`);
  eq('permit classification: permits differing from permits-internal.jsonl', clsMismatch, 0);
  n(
    'permits_closed_by_completed_date',
    await db.scalar(`SELECT count(*) FROM permits WHERE status_group_basis = 'completed_date'`),
  );
  eq(
    'served open or stalled permits with a completed_date',
    await db.scalar(
      `SELECT count(*) FROM permits WHERE status_group IN ('open', 'stalled') AND completed_date IS NOT NULL`,
    ),
    0,
  );
  const sum = (k: 'open' | 'stalled') =>
    ROOFING_CLASSES.map((c) => classSignalColumns(c)[k]).join(' + ');
  eq(
    'properties whose per-class open and stalled counts do not add up',
    await db.scalar(`SELECT count(*) FROM properties
      WHERE ${sum('open')} <> roofing_open_count OR ${sum('stalled')} <> roofing_stalled_count`),
    0,
  );
  eq(
    'every published permit is in permits-internal',
    await db.scalar(
      'SELECT count(*) FROM permits p JOIN permits_internal i ON i.permit_number = p.permit_id',
    ),
    counts.permits_published,
  );

  // lexicon tables vs the manifest's own coverage
  if (!o.subset) {
    const cov = manifest.coverage.tables as Record<string, Record<string, number>>;
    for (const [group, tables] of Object.entries(cov)) {
      if (group === 'internal') continue;
      for (const [table, rows] of Object.entries(tables)) {
        const target =
          table === 'properties' ? null : `lex.${group === 'county' ? 'county' : 'pi'}_${table}`;
        if (!target) continue;
        eq(
          `manifest coverage ${group}.${table}`,
          await db.scalar(`SELECT count(*) FROM ${target}`),
          rows,
        );
      }
    }
    // the served run's totals (its own record)
    eq('seed rows (properties + dead)', counts.seed_rows, expected.seed);
    eq('ready properties', counts.properties, expected.properties);
    eq('dead accounts', counts.properties_dead, expected.dead);
    eq('published permits', counts.permits_published, expected.publishedPermits);
    eq('parcels with permits', counts.parcels_with_permits, expected.parcelsWithPermits);
    eq('captured permits', counts.captured_permits, expected.capturedPermits);
    eq('permits-internal rows = capture rows', ctx.permitsInternal.total, expected.capturedPermits);
    eq('roof age on', counts.with_roof_age, expected.roofAgeEligible);
    eq('roof age high', counts.roof_age_high, expected.high);
    eq('roof age medium', counts.roof_age_medium, expected.medium);
    eq('roof age low', counts.roof_age_low, expected.low);
    eq('roof age none', counts.properties! - counts.with_roof_age!, expected.none);
    // and the run record itself still says the same
    eq('run record roof_age.eligible', run.roof_age.eligible, expected.roofAgeEligible);
    eq('run record published', run.counts.permits.published, expected.publishedPermits);
    eq(
      'run record permits out_of_county',
      run.unlinked_reasons.out_of_county,
      ctx.permitsInternal.outOfCounty,
    );
    eq(
      'linked-to-dead permits skipped',
      ctx.staged.skippedNotLive,
      run.counts.permits.linked - run.counts.permits.published,
    );
    // roofing counts: the profile's recount of the published permits vs the run record's linked-roofing numbers
    const g = run.counts.permits.roofing.by_status_group_linked as Record<string, number>;
    const linkedRoofing = await db.rows<{ status_group: string; n: string }>(
      `SELECT status_group_profile AS status_group, count(*) n FROM permits WHERE is_roofing GROUP BY 1`,
    );
    for (const r of linkedRoofing) {
      const want = g[r.status_group] ?? 0;
      // 39 linked permits on dead accounts are not published (6 of them roofing)
      if (Math.abs(Number(r.n) - want) > 6)
        checks.push({
          name: `roofing ${r.status_group}`,
          expected: want,
          actual: Number(r.n),
          ok: false,
        });
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const report: ReconcileReport = {
    ok: failed.length === 0,
    textIndexRows: textRows,
    numbers,
    checks,
  };
  if (failed.length) {
    throw new Error(
      `reconciliation failed:\n${failed.map((c) => `  ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`).join('\n')}`,
    );
  }
  return report;
}
