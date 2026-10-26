// A-03 T021: the bundle gate (plan § Constitution Check X; agent-design metagross § 7). The
// gzipped size of `apps/web/dist/assets/*.js`, DuckDB chunks excluded, must stay at or under
// 300 KB; the DuckDB-WASM engine is lazy-loaded and measured separately by the hosted perf
// cases, not here. A chunk counts as DuckDB when its file name contains `duckdb`.
//
// A-13 T010 adds the Hub initial-graph check (research R2, R9): the JS and CSS that `/` loads
// before any lazy route (the entry chunk and its static imports, plus the Hub route chunk and its
// static imports) must stay at or under 150 KB gzipped and must hold no DuckDB chunk and no .wasm
// asset. The graph is read from Vite's manifest (dist/.vite/manifest.json) when the build writes
// one (`build.manifest: true`; the Hub is the manifest key src/routes/Hub.tsx). Without a
// manifest it is read from dist/index.html (module script, modulepreload and stylesheet links)
// plus each chunk's static `import … from "./x.js"` / `import "./x.js"` statements, and the Hub
// is the chunk Vite names `Hub-<hash>.js` after src/routes/Hub.tsx (assumption: the route file
// keeps that name, plan § Project Structure; CSS imported only by the Hub chunk is then not
// seen). Dynamic `import()` is never followed, so the lazy DuckDB engine stays out of the graph.
// With neither index.html nor a manifest the check is reported as SKIPPED.
//
//   pnpm exec tsx scripts/bundle-size.ts [--dist apps/web/dist] [--limit-kb 300] [--hub-limit-kb 150]
//
// Exit 0 when both checks pass, 1 when either fails or the dist folder is missing (a build
// that did not run is not a pass), 2 on a usage error.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// 310 KB since A-16 (PO decision 2026-10-26): the board-matched UI and the Task B search box
// port; 315 KB since AM-10 (PO decision 2026-10-26): the Verify page's two counted gateways,
// fallback lane and Stored on card (+1.6 KB); 320 KB since the demo polish (PO decision
// 2026-10-26): the Explore results table and drawer head, and the rewritten Coverage page. The Hub
// first-load graph limit (150 KB) is unchanged and is what a first visit loads.
export const DEFAULT_LIMIT_BYTES = 320 * 1024;
export const DEFAULT_DIST = "apps/web/dist";
export const DUCKDB_CHUNK = /duckdb/i;

export interface BundleFile {
  name: string;
  bytes: number;
  gzipBytes: number;
  /** DuckDB chunk: listed for information, not counted. */
  excluded: boolean;
}

export interface BundleReport {
  distDir: string;
  files: BundleFile[];
  /** Sum of `gzipBytes` over the files that are not excluded. */
  totalGzipBytes: number;
  limitBytes: number;
  ok: boolean;
}

export interface CheckOptions {
  distDir: string;
  limitBytes?: number;
}

/** Measures `assets/*.js` under `distDir` (one level, as Vite writes them). */
export function checkBundle({
  distDir,
  limitBytes = DEFAULT_LIMIT_BYTES,
}: CheckOptions): BundleReport {
  const assets = join(distDir, "assets");
  if (!existsSync(assets)) {
    throw new Error(`bundle-size: not found: ${assets} (run the web build first)`);
  }
  const files = readdirSync(assets)
    .filter((name) => name.endsWith(".js") && statSync(join(assets, name)).isFile())
    .sort()
    .map((name): BundleFile => {
      const content = readFileSync(join(assets, name));
      return {
        name,
        bytes: content.byteLength,
        gzipBytes: gzipSync(content).byteLength,
        excluded: DUCKDB_CHUNK.test(name),
      };
    });
  const totalGzipBytes = files.filter((f) => !f.excluded).reduce((sum, f) => sum + f.gzipBytes, 0);
  return { distDir, files, totalGzipBytes, limitBytes, ok: totalGzipBytes <= limitBytes };
}

// ---------------------------------------------------------------------------------------
// The Hub initial graph (A-13 T010)
// ---------------------------------------------------------------------------------------

export const HUB_LIMIT_BYTES = 150 * 1024;
/** Vite manifest key of the Hub route (plan § Project Structure). */
export const HUB_MANIFEST_KEY = /(^|\/)src\/routes\/Hub\.tsx?$/;
/** Vite's chunk name for that route when there is no manifest. */
export const HUB_CHUNK_NAME = /^Hub-[\w-]+\.js$/;
/** Never in the `/` graph: a DuckDB chunk or any WebAssembly asset. */
export const FORBIDDEN_IN_HUB = /duckdb|\.wasm(\.gz)?$/i;

export interface GraphFile {
  /** Path relative to the dist folder, e.g. assets/index-a1.js. */
  name: string;
  gzipBytes: number;
}

export interface HubGraphReport {
  distDir: string;
  /** Where the graph came from; "none" = no index.html and no manifest (skipped). */
  source: "manifest" | "html" | "none";
  hubChunk: string | null;
  /** The JS and CSS in the graph, with their gzipped sizes. */
  files: GraphFile[];
  /** Graph members that must not be there (DuckDB chunks, .wasm assets). */
  forbidden: string[];
  totalGzipBytes: number;
  limitBytes: number;
  notes: string[];
  ok: boolean;
}

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
  assets?: string[];
}

function graphFromManifest(
  manifest: Record<string, ManifestChunk>,
  notes: string[],
): { members: Set<string>; hubChunk: string | null } {
  const members = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    members.add(chunk.file);
    for (const css of chunk.css ?? []) members.add(css);
    for (const asset of chunk.assets ?? []) members.add(asset);
    for (const next of chunk.imports ?? []) visit(next);
  };
  const keys = Object.keys(manifest);
  for (const key of keys) if (manifest[key]?.isEntry) visit(key);
  const hubKey = keys.find((key) => HUB_MANIFEST_KEY.test(key));
  if (hubKey) visit(hubKey);
  else notes.push("no Hub route chunk (src/routes/Hub.tsx) in the manifest: entry graph only");
  return { members, hubChunk: hubKey ? (manifest[hubKey]?.file ?? null) : null };
}

const HTML_REFS = [
  /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g,
  /<link\b[^>]*\brel=["'](?:modulepreload|stylesheet)["'][^>]*\bhref=["']([^"']+)["']/g,
];
const STATIC_IMPORTS = [
  /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g,
  /\bimport\s*["'](\.{1,2}\/[^"']+)["']/g,
];

function graphFromHtml(
  distDir: string,
  html: string,
  notes: string[],
): { members: Set<string>; hubChunk: string | null } {
  const members = new Set<string>();
  const roots: string[] = [];
  for (const pattern of HTML_REFS) {
    for (const match of html.matchAll(pattern)) {
      const ref = match[1];
      if (ref && !/^[a-z]+:/i.test(ref)) roots.push(ref.replace(/^\.?\//, ""));
    }
  }
  const assets = join(distDir, "assets");
  const hubName = existsSync(assets)
    ? readdirSync(assets).find((name) => HUB_CHUNK_NAME.test(name))
    : undefined;
  const hubChunk = hubName ? `assets/${hubName}` : null;
  if (hubChunk) roots.push(hubChunk);
  else notes.push("no Hub route chunk (assets/Hub-*.js) in the build: entry graph only");
  notes.push("no Vite manifest: graph read from index.html and static imports");
  const visit = (rel: string): void => {
    if (members.has(rel)) return;
    members.add(rel);
    const full = join(distDir, rel);
    if (!rel.endsWith(".js") || !existsSync(full)) return;
    const code = readFileSync(full, "utf8");
    for (const pattern of STATIC_IMPORTS) {
      for (const match of code.matchAll(pattern)) {
        const spec = match[1];
        if (spec) visit(posix.normalize(posix.join(posix.dirname(rel), spec)));
      }
    }
  };
  for (const root of roots) visit(root);
  return { members, hubChunk };
}

/** Measures the graph `/` loads first (entry + static imports + Hub route chunk). */
export function checkHubGraph({
  distDir,
  limitBytes = HUB_LIMIT_BYTES,
}: CheckOptions): HubGraphReport {
  const notes: string[] = [];
  const manifestPath = join(distDir, ".vite", "manifest.json");
  const htmlPath = join(distDir, "index.html");
  let source: HubGraphReport["source"];
  let graph: { members: Set<string>; hubChunk: string | null };
  if (existsSync(manifestPath)) {
    source = "manifest";
    graph = graphFromManifest(
      JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, ManifestChunk>,
      notes,
    );
  } else if (existsSync(htmlPath)) {
    source = "html";
    graph = graphFromHtml(distDir, readFileSync(htmlPath, "utf8"), notes);
  } else {
    source = "none";
    graph = { members: new Set(), hubChunk: null };
    notes.push("no index.html and no .vite/manifest.json under the dist folder");
  }
  const members = [...graph.members].sort();
  const forbidden = members.filter((name) => FORBIDDEN_IN_HUB.test(name));
  const files = members
    .filter((name) => /\.(js|css)$/.test(name) && existsSync(join(distDir, name)))
    .map((name) => ({ name, gzipBytes: gzipSync(readFileSync(join(distDir, name))).byteLength }));
  const totalGzipBytes = files.reduce((sum, f) => sum + f.gzipBytes, 0);
  return {
    distDir,
    source,
    hubChunk: graph.hubChunk,
    files,
    forbidden,
    totalGzipBytes,
    limitBytes,
    notes,
    ok: forbidden.length === 0 && totalGzipBytes <= limitBytes,
  };
}

// ---------------------------------------------------------------------------------------
// Heavy-library placement (A-13 review round)
// ---------------------------------------------------------------------------------------
// The Vite manifest lists chunks, not modules, so a library is recognised by a distinctive string
// that survives minification (an error message or a SQL view name) in the chunk file.
export const MARKERS = {
  zod: /ZodError|Invalid input/,
  hyparquet: /footer != PAR1/,
  "query-core": /v_roofing_permit|exploreSearchSql/,
} as const;
/** A manifest key for the query-core barrel module itself. */
export const QUERY_CORE_BARREL_KEY = /query-core\/src\/index\.[jt]s$/;
export const CATALOG_ROUTE_KEY = /(^|\/)src\/routes\/DataCatalog\.tsx?$/;
const ROUTE_KEY = /(^|\/)src\/routes\/[^/]+\.tsx?$/;

export interface PlacementReport {
  distDir: string;
  /** "none" = no manifest, so the check cannot run (skipped). */
  source: "manifest" | "none";
  violations: string[];
  ok: boolean;
}

/** Library names (MARKERS keys) found in a chunk file. */
function librariesIn(distDir: string, file: string): string[] {
  const full = join(distDir, file);
  if (!file.endsWith(".js") || !existsSync(full)) return [];
  const code = readFileSync(full, "utf8");
  return Object.entries(MARKERS)
    .filter(([, marker]) => marker.test(code))
    .map(([name]) => name);
}

/**
 * (a) the `/` (Hub) initial graph holds no zod, hyparquet, DuckDB/.wasm or query-core barrel;
 * (b) hyparquet appears only in chunks reachable from the Catalog route, never in the initial
 * graph of any other route (`/`, `/runs`, Explore, …).
 */
export function checkPlacement({ distDir }: { distDir: string }): PlacementReport {
  const manifestPath = join(distDir, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    return { distDir, source: "none", violations: [], ok: true };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, ManifestChunk>;
  const keys = Object.keys(manifest);
  const reach = (roots: string[]): Set<string> => {
    const seen = new Set<string>();
    const visit = (key: string): void => {
      if (seen.has(key) || !manifest[key]) return;
      seen.add(key);
      for (const next of manifest[key]?.imports ?? []) visit(next);
    };
    for (const root of roots) visit(root);
    return seen;
  };
  const entryKeys = keys.filter((key) => manifest[key]?.isEntry);
  const filesOf = (graph: Set<string>): string[] =>
    [...graph].flatMap((key) => {
      const chunk = manifest[key];
      return chunk ? [chunk.file, ...(chunk.assets ?? [])] : [];
    });
  const violations: string[] = [];

  const hubKey = keys.find((key) => HUB_MANIFEST_KEY.test(key));
  if (hubKey === undefined) {
    violations.push("no Hub route (src/routes/Hub.tsx) in the manifest: / graph cannot be checked");
  } else {
    const hub = reach([...entryKeys, hubKey]);
    for (const key of hub) {
      if (QUERY_CORE_BARREL_KEY.test(key))
        violations.push(`/ graph holds the query-core barrel (${key})`);
    }
    for (const file of filesOf(hub)) {
      if (FORBIDDEN_IN_HUB.test(file)) violations.push(`/ graph holds ${file} (DuckDB or .wasm)`);
      for (const lib of librariesIn(distDir, file)) {
        violations.push(`/ graph holds ${lib} (${file})`);
      }
    }
  }

  const catalogKey = keys.find((key) => CATALOG_ROUTE_KEY.test(key));
  const catalog = catalogKey === undefined ? new Set<string>() : reach([catalogKey]);
  const catalogFiles = new Set(filesOf(catalog));
  const entryGraph = reach(entryKeys);
  for (const key of keys) {
    const chunk = manifest[key];
    if (!chunk || !librariesIn(distDir, chunk.file).includes("hyparquet")) continue;
    if (!catalogFiles.has(chunk.file) || entryGraph.has(key)) {
      violations.push(`hyparquet is in ${chunk.file}, which is not Catalog-only`);
    }
  }
  for (const key of keys.filter((k) => ROUTE_KEY.test(k) && !CATALOG_ROUTE_KEY.test(k))) {
    for (const file of filesOf(reach([...entryKeys, key]))) {
      if (librariesIn(distDir, file).includes("hyparquet")) {
        violations.push(`hyparquet is in the initial graph of ${key} (${file})`);
      }
    }
  }
  return {
    distDir,
    source: "manifest",
    violations: [...new Set(violations)],
    ok: violations.length === 0,
  };
}

export function formatPlacementReport(report: PlacementReport): string {
  if (report.source === "none")
    return `placement: SKIPPED: no .vite/manifest.json (${report.distDir})`;
  return report.ok
    ? "placement: OK: / holds no zod, hyparquet, DuckDB/.wasm or query-core barrel; hyparquet is Catalog-only"
    : `placement: FAIL:\n${report.violations.map((v) => `  ${v}`).join("\n")}`;
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

export function formatReport(report: BundleReport): string {
  const lines = report.files.map(
    (f) =>
      `  ${f.excluded ? "excluded" : "counted "}  ${kb(f.gzipBytes).padStart(10)} gz  ${kb(f.bytes).padStart(10)} raw  ${f.name}`,
  );
  const verdict = report.ok ? "OK" : "FAIL";
  lines.push(
    `bundle-size: ${verdict}: ${report.totalGzipBytes} bytes gzipped (${kb(report.totalGzipBytes)}) against limit ${report.limitBytes} (${kb(report.limitBytes)}) for ${report.distDir}/assets/*.js, DuckDB chunks excluded`,
  );
  return lines.join("\n");
}

export function formatHubReport(report: HubGraphReport): string {
  if (report.source === "none") {
    return `hub-graph: SKIPPED: ${report.notes.join("; ")} (${report.distDir})`;
  }
  const lines = report.files.map(
    (f) => `  graph     ${kb(f.gzipBytes).padStart(10)} gz  ${f.name}`,
  );
  for (const note of report.notes) lines.push(`  note: ${note}`);
  const forbidden =
    report.forbidden.length > 0
      ? `; forbidden in the / graph (DuckDB or .wasm): ${report.forbidden.join(", ")}`
      : "";
  lines.push(
    `hub-graph: ${report.ok ? "OK" : "FAIL"}: ${report.totalGzipBytes} bytes gzipped (${kb(report.totalGzipBytes)}) against limit ${report.limitBytes} (${kb(report.limitBytes)}) for the initial graph of / (source: ${report.source}, Hub chunk: ${report.hubChunk ?? "none"})${forbidden}`,
  );
  return lines.join("\n");
}

interface CliOptions {
  distDir: string;
  limitBytes: number;
  hubLimitBytes: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    distDir: DEFAULT_DIST,
    limitBytes: DEFAULT_LIMIT_BYTES,
    hubLimitBytes: HUB_LIMIT_BYTES,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--dist" && value !== undefined) {
      options.distDir = value;
      i += 1;
    } else if (arg === "--limit-kb" && value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`bundle-size: bad --limit-kb ${value}`);
      options.limitBytes = Math.round(n * 1024);
      i += 1;
    } else if (arg === "--hub-limit-kb" && value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error(`bundle-size: bad --hub-limit-kb ${value}`);
      options.hubLimitBytes = Math.round(n * 1024);
      i += 1;
    } else {
      throw new Error(`bundle-size: unknown argument ${arg}`);
    }
  }
  return options;
}

/** Runs the gate; returns the process exit code. */
export function main(argv: string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    const report = checkBundle({
      distDir: resolve(options.distDir),
      limitBytes: options.limitBytes,
    });
    console.log(formatReport(report));
    const hub = checkHubGraph({
      distDir: resolve(options.distDir),
      limitBytes: options.hubLimitBytes,
    });
    console.log(formatHubReport(hub));
    const placement = checkPlacement({ distDir: resolve(options.distDir) });
    console.log(formatPlacementReport(placement));
    return report.ok && hub.ok && placement.ok ? 0 : 1;
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
