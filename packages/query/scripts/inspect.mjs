import { DuckDBInstance } from '@duckdb/node-api';
const [, , glob] = process.argv;
const db = await (await DuckDBInstance.create(':memory:')).connect();
const r = await db.runAndReadAll(
  `DESCRIBE SELECT * FROM read_parquet('${glob}', union_by_name=true)`,
);
const c = await db.runAndReadAll(
  `SELECT count(*) n FROM read_parquet('${glob}', union_by_name=true)`,
);
console.log(
  glob.split('/').slice(-3, -1).join('/'),
  'rows',
  c.getRowObjects()[0].n,
  r
    .getRowObjects()
    .map((x) => `${x.column_name}:${x.column_type}`)
    .join(', '),
);
