// A-03 ERR-14 (TC-023, TC-028): vendor the DuckDB-WASM extensions the engine needs into the
// repository, gzip -9 compressed, so the browser never fetches from extensions.duckdb.org. This is
// a maintainer step, run only when @duckdb/duckdb-wasm (and with it the DuckDB version) changes;
// neither the build nor the browser downloads anything from the extension host.
//
//   pnpm --filter @countylens/web exec tsx scripts/vendor-duckdb-extensions.ts
//
// For each name in VENDORED_EXTENSIONS it downloads
// `${EXTENSION_HOST}/${DUCKDB_VERSION}/${PLATFORM}/<name>.duckdb_extension.wasm` (the URL DuckDB's
// own autoloader used, ERR-14), checks the WebAssembly magic, writes
// `vendor/duckdb-extensions/<version>/<platform>/<name>.duckdb_extension.wasm.gz` and records the
// raw SHA-256 and sizes in `vendor/duckdb-extensions/manifest.json`. The unit test
// `test/duckdb-extensions.test.ts` gunzips every vendored file and checks it against that record
// and the DuckDB version inside the bundled engine. The binaries are DuckDB's signed builds:
// DuckDB verifies the signature on LOAD (allow_unsigned_extensions stays off).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

/** The DuckDB release inside @duckdb/duckdb-wasm 1.33.1-dev57.0 (the version its autoloader asked for). */
export const DUCKDB_VERSION = "v1.5.4";
/** The eh bundle's extension platform. */
export const PLATFORM = "wasm_eh";
export const EXTENSION_HOST = "https://extensions.duckdb.org";
/** parquet: read_parquet; json: CAST(… AS JSON) in bindManifest; icu: SET TimeZone / TIMESTAMPTZ. */
export const VENDORED_EXTENSIONS = ["parquet", "json", "icu"] as const;
export type VendoredExtension = (typeof VENDORED_EXTENSIONS)[number];

const HERE = dirname(fileURLToPath(import.meta.url));
export const VENDOR_DIR = resolve(HERE, "..", "vendor", "duckdb-extensions");
export const VENDOR_MANIFEST = join(VENDOR_DIR, "manifest.json");

export interface VendoredFile {
  /** Path under VENDOR_DIR. */
  readonly path: string;
  readonly source: string;
  readonly rawBytes: number;
  readonly rawSha256: string;
  readonly gzipBytes: number;
}

export interface VendorManifest {
  readonly duckdbVersion: string;
  readonly platform: string;
  readonly extensions: Readonly<Record<VendoredExtension, VendoredFile>>;
}

export const extensionFileName = (name: string): string => `${name}.duckdb_extension.wasm`;

export const vendoredPath = (name: string): string =>
  `${DUCKDB_VERSION}/${PLATFORM}/${extensionFileName(name)}.gz`;

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

async function vendorOne(name: VendoredExtension): Promise<VendoredFile> {
  const source = `${EXTENSION_HOST}/${DUCKDB_VERSION}/${PLATFORM}/${extensionFileName(name)}`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${source} answered HTTP ${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (!raw.subarray(0, 4).equals(WASM_MAGIC)) throw new Error(`${source} is not WebAssembly`);
  const gz = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION });
  const path = vendoredPath(name);
  mkdirSync(dirname(join(VENDOR_DIR, path)), { recursive: true });
  writeFileSync(join(VENDOR_DIR, path), gz);
  return {
    path,
    source,
    rawBytes: raw.length,
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    gzipBytes: gz.length,
  };
}

export async function main(): Promise<number> {
  const entries: [VendoredExtension, VendoredFile][] = [];
  for (const name of VENDORED_EXTENSIONS) {
    const file = await vendorOne(name);
    entries.push([name, file]);
    console.log(`  ${name}: ${file.rawBytes} B → ${file.gzipBytes} B gzip  ${file.path}`);
  }
  const manifest: VendorManifest = {
    duckdbVersion: DUCKDB_VERSION,
    platform: PLATFORM,
    extensions: Object.fromEntries(entries) as Record<VendoredExtension, VendoredFile>,
  };
  writeFileSync(VENDOR_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`vendor-duckdb-extensions: OK: ${entries.length} extension(s) in ${VENDOR_DIR}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
