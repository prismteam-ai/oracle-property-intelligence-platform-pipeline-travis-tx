// A-03 T057 (ADR-0001 Finding 2; TC-028; plan R2 fallback, 2026-10-21): gzip the self-hosted
// DuckDB-WASM eh bundle in the Vite output to `<name>.wasm.gz` and delete the raw `.wasm`, so the
// 34 MB binary is never served uncompressed. The engine (src/engine/duckdb-wasm.ts) fetches the
// .gz as a plain file and gunzips it with DecompressionStream; no Content-Encoding header is
// needed (Amplify rejects that header in customHeaders: content-length, transfer-encoding,
// content-encoding, warning and via are read-only). CloudFront compresses only files of
// 1 KB–10 MB, so it would never compress this one on its own (first load p95 8.6 s raw).
//
//   pnpm --filter @countylens/web exec tsx scripts/compress-wasm.ts [--dist dist]
//
// Runs after `vite build` (package.json `build`, amplify.yml). Idempotent: a `.wasm.gz` whose raw
// `.wasm` is already gone is reported as already compressed and left alone. Exit 0 when the
// bundle was compressed (or already was), 1 when no eh bundle is in the output (the engine is not
// bundled: not a pass), 2 on a usage error.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

/** `duckdb-eh.wasm` as Vite emits it: the base name plus an optional content hash. */
export const WASM_FILE_PATTERN = /^duckdb-eh(?:-[A-Za-z0-9_-]+)?\.wasm$/;
export const DEFAULT_DIST = "dist";
/** gzip level 9 (zlib's best); DecompressionStream('gzip') reads it in every evergreen browser. */
export const GZIP_LEVEL = constants.Z_BEST_COMPRESSION;
export const GZIP_SUFFIX = ".gz";

export interface CompressedFile {
  /** The `.wasm.gz` written (or found). */
  path: string;
  /** Raw size; when skipped, the size of the .gz as found. */
  bytes: number;
  compressedBytes: number;
  /** Already compressed on an earlier run: left as is. */
  skipped: boolean;
}

export interface CompressReport {
  distDir: string;
  level: number;
  files: CompressedFile[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Gzips every eh-bundle WASM under `distDir` to `<path>.gz` and deletes the original. */
export function compressWasm(distDir: string): CompressReport {
  const all = walk(distDir);
  const raw = all.filter((path) => WASM_FILE_PATTERN.test(basename(path)));
  const rawSet = new Set(raw);
  const done = all.filter(
    (path) =>
      path.endsWith(GZIP_SUFFIX) &&
      WASM_FILE_PATTERN.test(basename(path.slice(0, -GZIP_SUFFIX.length))) &&
      !rawSet.has(path.slice(0, -GZIP_SUFFIX.length)),
  );
  const files = [
    ...raw.map((path): CompressedFile => {
      const original = readFileSync(path);
      const compressed = gzipSync(original, { level: GZIP_LEVEL });
      const target = `${path}${GZIP_SUFFIX}`;
      writeFileSync(target, compressed);
      rmSync(path);
      return {
        path: target,
        bytes: original.length,
        compressedBytes: compressed.length,
        skipped: false,
      };
    }),
    ...done.map((path): CompressedFile => {
      const size = statSync(path).size;
      return { path, bytes: size, compressedBytes: size, skipped: true };
    }),
  ].sort((a, b) => a.path.localeCompare(b.path));
  return { distDir, level: GZIP_LEVEL, files };
}

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function formatReport(report: CompressReport): string {
  const lines = report.files.map((f) =>
    f.skipped
      ? `  already compressed  ${mb(f.bytes).padStart(9)}  ${f.path}`
      : `  gzip -${report.level}  ${mb(f.bytes).padStart(9)} → ${mb(f.compressedBytes).padStart(9)}  ${f.path} (raw .wasm deleted)`,
  );
  lines.push(
    report.files.length === 0
      ? `compress-wasm: FAIL: no ${WASM_FILE_PATTERN.source} under ${report.distDir} (is the engine bundled?)`
      : `compress-wasm: OK: ${report.files.length} file(s) under ${report.distDir}`,
  );
  return lines.join("\n");
}

function parseArgs(argv: string[]): { distDir: string } {
  const options = { distDir: DEFAULT_DIST };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--dist" && value !== undefined) {
      options.distDir = value;
      i += 1;
    } else {
      throw new Error(`compress-wasm: unknown argument ${String(arg)}`);
    }
  }
  return options;
}

/** Runs the step; returns the process exit code. */
export function main(argv: string[]): number {
  let options: { distDir: string };
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    const report = compressWasm(resolve(options.distDir));
    console.log(formatReport(report));
    return report.files.length === 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
