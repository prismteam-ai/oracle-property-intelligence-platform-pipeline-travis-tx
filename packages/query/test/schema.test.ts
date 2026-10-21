import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';

const sql = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');

async function fresh() {
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  await conn.run(sql('schema.sql'));
  return conn;
}

describe('schema.sql + post_load.sql', () => {
  it('apply cleanly on DuckDB 1.5.6 and create the FTS index', async () => {
    const conn = await fresh();
    await conn.run(sql('post_load.sql'));
    const v = (await conn.runAndReadAll('select version() v')).getRowObjects()[0] as { v: string };
    expect(v.v).toBe('v1.5.6');
    const t = (
      await conn.runAndReadAll(
        "select count(*) n from information_schema.tables where table_schema in ('main','lex')",
      )
    ).getRowObjects()[0] as { n: bigint };
    expect(Number(t.n)).toBeGreaterThanOrEqual(50);
    await conn.runAndReadAll('select * from fts_main_permit_text.docs limit 1');
  });

  it('travis-t3-privacy.v2: a sole-owner row cannot carry a taxpayer number', async () => {
    const conn = await fresh();
    const insert = (idCols: string) => `insert into business_records
      (business_record_id, source, dataset, record_id, record_id_withheld, taxpayer_number, name, name_norm, scope, printed,
       us_url, us_fetched_at, us_source_http_request, row_sha256, evidence_state, us_fields)
      values ('x','s','d', ${idCols}, 'n','n','travis','{}','u','t','{}','h','confirmed_present',['name'])`;
    await expect(conn.run(insert("'123', 'individual_owner', NULL"))).rejects.toThrow();
    await expect(conn.run(insert("NULL, 'individual_owner', '123'"))).rejects.toThrow();
    await conn.run(insert("NULL, 'individual_owner', NULL"));
    const bad = (
      await conn.runAndReadAll('select count(*) n from v_privacy_violations')
    ).getRowObjects()[0] as { n: bigint };
    expect(Number(bad.n)).toBe(0);
  });
});
