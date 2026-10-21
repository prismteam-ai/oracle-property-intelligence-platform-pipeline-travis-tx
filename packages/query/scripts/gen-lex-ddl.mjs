// Prints the CREATE TABLE statements for the published lexicon tables (schema `lex`), from shard s0001.
// Usage: node scripts/gen-lex-ddl.mjs <shards-dir>
import { DuckDBInstance } from '@duckdb/node-api';
import { readdirSync } from 'node:fs';
const root = process.argv[2];
const db = await (await DuckDBInstance.create(':memory:')).connect();
const out = [];
for (const [group, prefix, dir] of [
  ['county', 'county', 'county-a1'],
  ['property_improvement', 'pi', 'property_improvement-a1'],
]) {
  const base = `${root}/s0001/${dir}/tables`;
  for (const t of readdirSync(base)
    .filter((n) => !n.endsWith('.car'))
    .sort()) {
    if (t === 'properties') continue;
    const rows = (
      await db.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet('${base}/${t}/*.parquet')`)
    ).getRowObjects();
    const cols = rows.map((r) => `  ${r.column_name} ${r.column_type}`);
    cols.push('  shard VARCHAR NOT NULL');
    out.push(
      `-- group ${group}, published table ${t}\nCREATE TABLE lex.${prefix}_${t} (\n${cols.join(',\n')}\n);\n`,
    );
  }
}
console.log(out.join('\n'));
