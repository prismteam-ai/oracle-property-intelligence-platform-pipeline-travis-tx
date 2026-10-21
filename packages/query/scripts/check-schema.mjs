// Applies schema.sql and post_load.sql to an in-memory DuckDB (syntax and constraint check).
import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync } from 'node:fs';
const db = await (await DuckDBInstance.create(':memory:')).connect();
for (const f of ['schema.sql', 'post_load.sql'])
  await db.run(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
console.log(
  (
    await db.runAndReadAll(
      `select count(*) n from information_schema.tables where table_schema in ('main','lex')`,
    )
  ).getRowObjects(),
);
