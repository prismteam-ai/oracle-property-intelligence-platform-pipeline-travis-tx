import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_DB_URL, Queries, fixtureExists } from '@travis/query';
import {
  REMOTE_TABLES,
  SERVING_DB_FILE,
  buildServing,
  type ServingReport,
} from '../src/serving.js';
import { opSample, servingOps, startRangeServer, type OpSample } from './serving-ops.js';

/**
 * decisions.md section 30: the serving set of the fixture, read through httpfs from a local Range server, answers every
 * operation exactly as the full file does.
 */
describe.skipIf(!fixtureExists())('serving set of the fixture database', () => {
  const fixture = fileURLToPath(FIXTURE_DB_URL);
  const dir = mkdtempSync(path.join(tmpdir(), 'travis-serving-'));
  let report: ServingReport;
  let server: Awaited<ReturnType<typeof startRangeServer>>;
  let full: Queries;
  let serving: Queries;
  let sample: OpSample;

  beforeAll(async () => {
    // fts and httpfs are installed once per machine (the image bundles both; autoinstall stays off in Queries).
    const probe = await DuckDBInstance.create(':memory:');
    const c = await probe.connect();
    await c.run('INSTALL fts');
    await c.run('INSTALL httpfs');
    c.closeSync();
    probe.closeSync();
    report = await buildServing({
      fullDb: fixture,
      outDir: path.join(dir, 'out'),
      threads: 2,
      memoryLimit: '1GB',
      log: () => {},
    });
    server = await startRangeServer(path.join(dir, 'out'));
    full = await Queries.open({ dbPath: fixture, memoryLimit: '1GB', threads: 2 });
    const deployId = (
      await full.conn.runAndReadAll('SELECT deploy_id FROM deploy')
    ).getRowObjectsJson()[0]!.deploy_id as string;
    serving = await Queries.open({
      dbPath: path.join(dir, 'out', SERVING_DB_FILE),
      memoryLimit: '1GB',
      threads: 2,
      // the server ignores the path prefix: it maps /<deploy_id>/<file> to <dir>/<file>
      serving: { base: `${server.url}/serving` },
    });
    expect(serving.deployId).toBe(deployId);
    sample = await opSample(full);
  }, 120_000);

  afterAll(async () => {
    full?.close();
    serving?.close();
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('exports the large tables as content-named Parquet and keeps the rest in the serving file', () => {
    expect(report.files.map((f) => f.table_name).sort()).toEqual(Object.keys(REMOTE_TABLES).sort());
    for (const f of report.files) {
      expect(f.file).toBe(`${f.table_name}.${f.sha256.slice(0, 16)}.parquet`);
      expect(f.rows).toBeGreaterThan(0);
    }
    expect(report.localTables).toContain('permit_text');
    expect(report.localTables).toContain('deploy');
    expect(report.localTables).not.toContain('permits');
  });

  it('reads the large tables through httpfs, not from the serving file', async () => {
    server.reset();
    await serving.getProperty({ property_id: sample.propertyId });
    expect(server.stats().requests).toBeGreaterThan(0);
  });

  it('reaches no URL or file outside the serving prefix, and the setting is locked', async () => {
    const fails = async (sql: string) => {
      let err = '';
      try {
        await serving.conn.run(sql);
      } catch (e) {
        err = String(e);
      }
      expect(err, sql).not.toBe('');
    };
    const other = report.files[0]!.file;
    await fails(`SELECT * FROM read_parquet('${server.url}/elsewhere/${other}')`);
    await fails(`SELECT * FROM read_csv('${fixture}')`);
    await fails(`SELECT * FROM read_csv('/etc/hosts')`);
    await fails('SET enable_external_access = true');
  });

  it('answers every operation exactly as the full file does', async () => {
    for (const op of servingOps(sample)) {
      const a = JSON.stringify(await op.run(full));
      const b = JSON.stringify(await op.run(serving));
      expect(b, op.name).toBe(a);
    }
  }, 120_000);
});
