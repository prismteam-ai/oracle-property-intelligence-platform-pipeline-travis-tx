import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Run } from '@travis/contract';
import { normalizeRun } from '../src/index.js';
import { normalizeCenterName, normalizeMatcherName, normalizeText } from '../src/index.js';

const record = (id: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../runs/${id}.json`, import.meta.url)), 'utf8'),
  );

describe('the real run records', () => {
  for (const id of ['20261017T072132Z-pilot', '20261018T143520Z-t5-full']) {
    it(`${id} satisfies the Run schema once mapped onto the contract shape`, () => {
      const run = normalizeRun(record(id), null, []);
      const r = Run.safeParse(run);
      expect(
        r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      ).toEqual([]);
    });
  }
  it('maps free-text records_request into the limitation detail instead of inventing an object', () => {
    const raw = record('20261018T143520Z-t5-full');
    const text = raw.limitations.find(
      (l: { records_request: unknown }) => typeof l.records_request === 'string',
    );
    expect(text).toBeDefined();
    const run = normalizeRun(raw, null, []);
    const mapped = run.limitations.find(
      (l: { source: string; detail: string }) =>
        l.source === text.source && l.detail.includes(text.records_request),
    );
    expect(mapped.records_request).toBeNull();
  });
  it('fills window from/to with null and the empty groups from the group roots', () => {
    const run = normalizeRun(record('20261018T143520Z-t5-full'), 'bafycid', [
      { group_name: 'county', shard: 's0001', archive_cid: 'a', schema_cid: 's', tables_cid: 't' },
    ]);
    expect(run.window.permits.from).toBeNull();
    expect(run.groups).toEqual({ 'county/s0001': { cid: 'a', schema: 's', tables: 't' } });
    expect(run.manifest_cid).toBe('bafycid');
  });
});

describe('text normalization', () => {
  it('rewrites the re-roof variants to one token and strips accents', () => {
    for (const v of ['re-roof', 'Re Roof', 'RE-ROOFING', 'reroof'])
      expect(normalizeText(v).startsWith('reroof')).toBe(true);
    expect(normalizeText('Café')).toBe('cafe');
    expect(normalizeText('pre roof')).toBe('pre roof');
  });
  it('center names drop punctuation and spaces', () => {
    expect(normalizeCenterName('West Lake Hills')).toBe('westlakehills');
    expect(normalizeCenterName('Dripping Spr.')).toBe('drippingspr');
  });
  it('the matcher normalizer drops legal-form words', () => {
    expect(normalizeMatcherName('Acme Roofing, L.L.C.')).toBe('ACME ROOFING');
    expect(normalizeMatcherName('   ')).toBeNull();
  });
});
