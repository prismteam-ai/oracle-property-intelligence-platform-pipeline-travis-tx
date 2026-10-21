import { z } from 'zod';
import { registry } from './shared.js';

export type Json = Record<string, unknown>;
const SAFE = 9007199254740991;
export const REF_PREFIX = '#/components/schemas/';

/** Normalizes Zod's JSON Schema output: open objects, no ids, no safe-integer bounds. */
export function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === 'object') {
    const o: Json = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$schema' || k === '$id') continue;
      if (k === 'additionalProperties' && v && typeof v === 'object' && Object.keys(v).length === 0)
        continue;
      if ((k === 'minimum' && v === -SAFE) || (k === 'maximum' && v === SAFE)) continue;
      o[k] = clean(v);
    }
    return o;
  }
  return node;
}

/** Every registered component schema as JSON Schema (output mode), refs as `#/components/schemas/<id>`. */
export function componentSchemas(): Json {
  const generated = z.toJSONSchema(registry, {
    io: 'output',
    target: 'draft-2020-12',
    unrepresentable: 'any',
    uri: (id) => `${REF_PREFIX}${id}`,
  }) as { schemas: Record<string, unknown> };
  const schemas: Json = {};
  for (const id of Object.keys(generated.schemas).sort())
    schemas[id] = clean(generated.schemas[id]);
  return schemas;
}

export function idOf(schema: z.ZodType): string {
  const meta = registry.get(schema);
  if (!meta) throw new Error('schema is not registered with def()');
  return meta.id;
}

function refsIn(node: unknown, acc: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => refsIn(n, acc));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith(REF_PREFIX))
        acc.add(v.slice(REF_PREFIX.length));
      else refsIn(v, acc);
    }
  }
}

/** A self-contained schema for one registered id: the schema itself plus `$defs` of everything it references. */
export function selfContained(id: string, schemas: Json): Json {
  const need = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.pop() as string;
    const found = new Set<string>();
    refsIn(schemas[cur], found);
    for (const f of found)
      if (!need.has(f) && f !== id) {
        need.add(f);
        queue.push(f);
      }
  }
  const defs: Json = {};
  for (const n of [...need].sort()) defs[n] = schemas[n];
  const rewrite = (x: unknown): unknown =>
    JSON.parse(JSON.stringify(x).split(REF_PREFIX).join('#/$defs/'));
  const root = rewrite(schemas[id]) as Json;
  return Object.keys(defs).length ? { ...root, $defs: rewrite(defs) } : root;
}
