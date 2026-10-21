import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ZodObject } from 'zod';
import {
  BusinessRecord,
  Contractor,
  LicenseCandidate,
  LicenseRecord,
  Meta,
  Owner,
  PermitSummary,
  PropertySummary,
  RegistryCandidate,
  Run,
  componentSchemas,
} from '../src/index.js';

const md = readFileSync(
  fileURLToPath(new URL('../../../docs/api-contract.md', import.meta.url)),
  'utf8',
);

/** Field names in the first column of the table that follows the bold heading `**Name**`. */
function tableFields(heading: string): string[] {
  const start = md.indexOf(`**${heading}**`);
  expect(start, `heading ${heading}`).toBeGreaterThan(-1);
  const lines = md.slice(start).split('\n').slice(1);
  const out: string[] = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('|')) {
      inTable = true;
      const first = line.split('|')[1] ?? '';
      if (/^\s*(Field|---)/.test(first)) continue;
      for (const m of first.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)(?:\[\])?`/g))
        out.push(m[1] as string);
    } else if (inTable) break;
  }
  return out;
}

const tables: [string, ZodObject][] = [
  ['PropertySummary', PropertySummary],
  ['Owner', Owner],
  ['PermitSummary', PermitSummary],
  ['Contractor', Contractor],
  ['RegistryCandidate', RegistryCandidate],
  ['LicenseCandidate', LicenseCandidate],
  ['BusinessRecord', BusinessRecord],
  ['LicenseRecord', LicenseRecord],
  ['Run', Run],
];

describe('every field in the contract tables exists in the Zod schema', () => {
  for (const [name, schema] of tables) {
    it(name, () => {
      const fields = tableFields(name);
      expect(fields.length).toBeGreaterThan(3);
      const missing = fields.filter((f) => !(f in schema.shape));
      expect(missing).toEqual([]);
    });
  }
});

function propertyNames(node: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => propertyNames(n, acc));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' && v && typeof v === 'object')
        Object.keys(v).forEach((p) => acc.add(p));
      propertyNames(v, acc);
    }
  }
  return acc;
}

describe('/v1/meta example', () => {
  it('every key of the contract JSON example is a property of Meta (open-map keys excepted)', () => {
    const at = md.indexOf('### `GET /v1/meta`');
    const block = md.slice(
      md.indexOf('```json', at),
      md.indexOf('```\n', md.indexOf('```json', at) + 7),
    );
    const keys = [...block.matchAll(/"([^"]+)":/g)].map((m) => m[1] as string);
    const openMapKeys = new Set([
      'county_group',
      'property_improvement',
      'search_permit_text',
      '/v1/agent/chat',
      '/v1/permits/text-search',
      'confirmed_present',
      'unknown',
      'invalid_quarantined',
    ]);
    const known = propertyNames(componentSchemas());
    const missing = keys.filter((k) => !known.has(k) && !openMapKeys.has(k) && !/[-/]/.test(k));
    // "county" appears both as a scalar field and as a group key; both are covered.
    expect([...new Set(missing)]).toEqual([]);
    expect(Meta.shape.deploy).toBeDefined();
  });
});
