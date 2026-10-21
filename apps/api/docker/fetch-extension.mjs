// Build-time download of a DuckDB extension, pinned by the SHA-256 of the .gz as served by extensions.duckdb.org.
// Usage: node fetch-extension.mjs <name> <duckdb-version> <platform> <sha256-of-gz> <extension-dir>
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [name, version, platform, expectedSha, extDir] = process.argv.slice(2);
if (!name || !version || !platform || !expectedSha || !extDir) {
  throw new Error(
    'usage: fetch-extension.mjs <name> <duckdb-version> <platform> <sha256> <extension-dir>',
  );
}

const url = `http://extensions.duckdb.org/v${version}/${platform}/${name}.duckdb_extension.gz`;
const res = await fetch(url);
if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
const gz = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(gz).digest('hex');
if (actual !== expectedSha) {
  throw new Error(`checksum mismatch for ${url}: expected ${expectedSha}, got ${actual}`);
}

const dir = join(extDir, `v${version}`, platform);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${name}.duckdb_extension`), gunzipSync(gz));
console.log(`installed ${name} ${version} ${platform} (${actual})`);
