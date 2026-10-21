import { existsSync, readFileSync } from 'node:fs';

/** Absolute paths of the schema files, for deploy-build and for tests. */
export const SCHEMA_SQL_URL = new URL('../schema.sql', import.meta.url);
export const POST_LOAD_SQL_URL = new URL('../post_load.sql', import.meta.url);
export const readSchemaSql = (): string => readFileSync(SCHEMA_SQL_URL, 'utf8');
export const readPostLoadSql = (): string => readFileSync(POST_LOAD_SQL_URL, 'utf8');

/** Where the fixture DB (built by deploy-build from a small real subset) lives; tests skip until it exists. */
export const FIXTURE_DB_URL = new URL('../fixtures/travis-fixture.duckdb', import.meta.url);

/** Tests that need the fixture DB use `describe.skipIf(!fixtureExists())` and print FIXTURE_SKIP_MESSAGE. */
export const fixtureExists = (): boolean => existsSync(FIXTURE_DB_URL);
export const FIXTURE_SKIP_MESSAGE =
  'packages/query/fixtures/travis-fixture.duckdb is missing: build it with packages/deploy-build (small real subset) to run these tests.';

export * from './text.js';
export * from './errors.js';
export * from './service.js';
