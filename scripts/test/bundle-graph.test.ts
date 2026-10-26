// A-13 T010: the Hub initial-graph check of scripts/bundle-size.ts (research R2, R9; plan
// § Performance). The JS and CSS that `/` loads before any lazy route (the entry chunk, its
// static imports, and the Hub route chunk with its static imports) must stay at or under
// 150 KB gzipped, and must hold no DuckDB chunk and no .wasm asset. The graph is read from
// Vite's manifest (dist/.vite/manifest.json, `build.manifest: true`) when present, otherwise
// from dist/index.html plus the static `import … from "./x.js"` statements of each chunk and the
// `Hub-*.js` chunk Vite names after src/routes/Hub.tsx. The 300 KB total gate is unchanged
// (gates.test.ts).
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HUB_LIMIT_BYTES, checkHubGraph, checkPlacement, formatHubReport } from "../bundle-size.ts";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const tsxBin = resolve(repoRoot, "node_modules", ".bin", "tsx");
const bundleScript = resolve(repoRoot, "scripts", "bundle-size.ts");

/** Base64 text of `kib` × 768 random bytes: about `kib` × 0.75 KiB gzipped (incompressible payload). */
const filler = (kib: number): string => randomBytes(kib * 768).toString("base64");

function makeDist(files: Record<string, string>): string {
  const dist = join(mkdtempSync(join(tmpdir(), "bundle-graph-")), "dist");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dist, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dist;
}

function viteManifest(entries: Record<string, unknown>): string {
  return JSON.stringify(entries);
}

const INDEX_HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-a1.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-b2.js">
<link rel="stylesheet" crossorigin href="/assets/index-c3.css">
</head><body><div id="root"></div></body></html>`;

describe("scripts/bundle-size.ts: the Hub initial graph (A-13 T010)", () => {
  it("targets 150 KB gzipped", () => {
    expect(HUB_LIMIT_BYTES).toBe(150 * 1024);
  });

  it("manifest: entry + static imports + the Hub route chunk; dynamic DuckDB chunks stay out", () => {
    const dist = makeDist({
      ".vite/manifest.json": viteManifest({
        "index.html": {
          file: "assets/index-a1.js",
          isEntry: true,
          imports: ["_vendor-b2.js"],
          dynamicImports: ["src/routes/Hub.tsx", "src/engine/duckdb-wasm.ts"],
          css: ["assets/index-c3.css"],
        },
        "_vendor-b2.js": { file: "assets/vendor-b2.js" },
        "_shared-d4.js": { file: "assets/shared-d4.js" },
        "src/routes/Hub.tsx": {
          file: "assets/Hub-e5.js",
          isDynamicEntry: true,
          imports: ["_shared-d4.js", "index.html"],
        },
        "src/engine/duckdb-wasm.ts": {
          file: "assets/duckdb-wasm-f6.js",
          isDynamicEntry: true,
          assets: ["assets/duckdb-eh-g7.wasm"],
        },
      }),
      "assets/index-a1.js": filler(20),
      "assets/vendor-b2.js": filler(40),
      "assets/shared-d4.js": filler(5),
      "assets/Hub-e5.js": filler(10),
      "assets/index-c3.css": filler(5),
      "assets/duckdb-wasm-f6.js": filler(400),
      "assets/duckdb-eh-g7.wasm": filler(400),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.source).toBe("manifest");
    expect(report.hubChunk).toBe("assets/Hub-e5.js");
    expect(report.files.map((f) => f.name).sort()).toEqual(
      [
        "assets/Hub-e5.js",
        "assets/index-a1.js",
        "assets/index-c3.css",
        "assets/shared-d4.js",
        "assets/vendor-b2.js",
      ].sort(),
    );
    expect(report.forbidden).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.totalGzipBytes).toBeLessThan(HUB_LIMIT_BYTES);
  });

  it("manifest: a DuckDB chunk statically imported by the Hub fails the check", () => {
    const dist = makeDist({
      ".vite/manifest.json": viteManifest({
        "index.html": {
          file: "assets/index-a1.js",
          isEntry: true,
          dynamicImports: ["src/routes/Hub.tsx"],
        },
        "src/routes/Hub.tsx": { file: "assets/Hub-e5.js", imports: ["_duckdb-browser-h8.js"] },
        "_duckdb-browser-h8.js": { file: "assets/duckdb-browser-h8.js" },
      }),
      "assets/index-a1.js": filler(5),
      "assets/Hub-e5.js": filler(5),
      "assets/duckdb-browser-h8.js": filler(5),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual(["assets/duckdb-browser-h8.js"]);
    expect(formatHubReport(report)).toMatch(/hub-graph: FAIL.*duckdb-browser-h8\.js/s);
  });

  it("manifest: a .wasm asset in the graph fails the check", () => {
    const dist = makeDist({
      ".vite/manifest.json": viteManifest({
        "index.html": { file: "assets/index-a1.js", isEntry: true, assets: ["assets/x-i9.wasm"] },
      }),
      "assets/index-a1.js": filler(5),
      "assets/x-i9.wasm": filler(5),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual(["assets/x-i9.wasm"]);
  });

  it("over 150 KB gzipped fails, with the total against the limit", () => {
    const dist = makeDist({
      ".vite/manifest.json": viteManifest({
        "index.html": { file: "assets/index-a1.js", isEntry: true, imports: ["_vendor-b2.js"] },
        "_vendor-b2.js": { file: "assets/vendor-b2.js" },
      }),
      "assets/index-a1.js": filler(110),
      "assets/vendor-b2.js": filler(110),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual([]);
    expect(report.totalGzipBytes).toBeGreaterThan(HUB_LIMIT_BYTES);
    expect(formatHubReport(report)).toMatch(/limit 153600/);
  });

  it("no manifest: index.html + static imports + Hub-*.js; dynamic import() is not followed", () => {
    const dist = makeDist({
      "index.html": INDEX_HTML,
      "assets/index-a1.js": `import{a as b}from"./shared-d4.js";const l=()=>import("./duckdb-wasm-f6.js");${filler(10)}`,
      "assets/vendor-b2.js": filler(20),
      "assets/index-c3.css": filler(2),
      "assets/shared-d4.js": filler(5),
      "assets/Hub-e5.js": `import"./shared-d4.js";export{x}from"./card-j1.js";${filler(5)}`,
      "assets/card-j1.js": filler(1),
      "assets/duckdb-wasm-f6.js": filler(400),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.source).toBe("html");
    expect(report.hubChunk).toBe("assets/Hub-e5.js");
    expect(report.files.map((f) => f.name).sort()).toEqual(
      [
        "assets/Hub-e5.js",
        "assets/card-j1.js",
        "assets/index-a1.js",
        "assets/index-c3.css",
        "assets/shared-d4.js",
        "assets/vendor-b2.js",
      ].sort(),
    );
    expect(report.ok).toBe(true);
  });

  it("no manifest: a static import of a DuckDB chunk from the entry fails", () => {
    const dist = makeDist({
      "index.html": INDEX_HTML,
      "assets/index-a1.js": `import{d}from"./duckdb-eh-k2.js";${filler(2)}`,
      "assets/vendor-b2.js": filler(2),
      "assets/index-c3.css": filler(1),
      "assets/duckdb-eh-k2.js": filler(2),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.ok).toBe(false);
    expect(report.forbidden).toEqual(["assets/duckdb-eh-k2.js"]);
  });

  it("no Hub route chunk yet: measures the entry graph and says so", () => {
    const dist = makeDist({
      "index.html": INDEX_HTML,
      "assets/index-a1.js": filler(2),
      "assets/vendor-b2.js": filler(2),
      "assets/index-c3.css": filler(1),
    });
    const report = checkHubGraph({ distDir: dist });
    expect(report.hubChunk).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.notes.join(" ")).toMatch(/no Hub route chunk/);
  });

  it("no index.html and no manifest: skipped with a note, not a pass of anything measured", () => {
    const dist = makeDist({ "assets/index-a1.js": filler(2) });
    const report = checkHubGraph({ distDir: dist });
    expect(report.source).toBe("none");
    expect(report.files).toEqual([]);
    expect(formatHubReport(report)).toMatch(/hub-graph: SKIPPED/);
  });

  it("as a CLI exits 1 when the Hub graph holds a DuckDB chunk, though the 300 KB total passes", () => {
    const dist = makeDist({
      "index.html": INDEX_HTML,
      "assets/index-a1.js": `import"./duckdb-eh-k2.js";${filler(2)}`,
      "assets/vendor-b2.js": filler(2),
      "assets/index-c3.css": filler(1),
      "assets/duckdb-eh-k2.js": filler(2),
    });
    const r = spawnSync(tsxBin, [bundleScript, "--dist", dist], {
      encoding: "utf8",
      cwd: repoRoot,
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/bundle-size: OK/);
    expect(out).toMatch(/hub-graph: FAIL/);
    expect(r.status).toBe(1);
  });

  it("as a CLI exits 0 when both checks pass", () => {
    const dist = makeDist({
      "index.html": INDEX_HTML,
      "assets/index-a1.js": filler(2),
      "assets/vendor-b2.js": filler(2),
      "assets/index-c3.css": filler(1),
    });
    const r = spawnSync(tsxBin, [bundleScript, "--dist", dist], {
      encoding: "utf8",
      cwd: repoRoot,
    });
    expect(`${r.stdout}${r.stderr}`).toMatch(/hub-graph: OK/);
    expect(r.status).toBe(0);
  });
});

describe("scripts/bundle-size.ts: heavy-library placement (A-13 review round)", () => {
  const manifest = (hubImports: string[]) =>
    viteManifest({
      "index.html": { file: "assets/index-a1.js", isEntry: true },
      "_http-x.js": { file: "assets/http-x.js" },
      "_zod-z.js": { file: "assets/zod-z.js" },
      "_hq-h.js": { file: "assets/hq-h.js" },
      "src/routes/Hub.tsx": { file: "assets/Hub-h1.js", imports: ["index.html", ...hubImports] },
      "src/routes/Runs.tsx": { file: "assets/Runs-r1.js", imports: ["index.html"] },
      "src/routes/DataCatalog.tsx": {
        file: "assets/DataCatalog-c1.js",
        imports: ["index.html", "_hq-h.js"],
      },
    });
  const files = {
    "assets/index-a1.js": "export{};",
    "assets/http-x.js": "export{};",
    "assets/zod-z.js": 'throw new Error("ZodError")',
    "assets/hq-h.js": 'throw new Error("parquet file invalid (footer != PAR1)")',
    "assets/Hub-h1.js": "export{};",
    "assets/Runs-r1.js": "export{};",
    "assets/DataCatalog-c1.js": "export{};",
  };

  it("passes when / is clean and hyparquet is Catalog-only", () => {
    const dist = makeDist({ ".vite/manifest.json": manifest(["_http-x.js"]), ...files });
    const report = checkPlacement({ distDir: dist });
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails when / reaches zod, and when hyparquet leaks into / or Runs", () => {
    const dist = makeDist({
      ".vite/manifest.json": manifest(["_zod-z.js", "_hq-h.js"]),
      ...files,
    });
    const report = checkPlacement({ distDir: dist });
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/\/ graph holds zod/);
    expect(report.violations.join("\n")).toMatch(/\/ graph holds hyparquet/);
  });

  it("fails when hyparquet sits in a chunk the Catalog does not reach", () => {
    const m = JSON.parse(manifest(["_http-x.js"])) as Record<string, { imports?: string[] }>;
    m["src/routes/DataCatalog.tsx"] = {
      ...m["src/routes/DataCatalog.tsx"],
      imports: ["index.html"],
    };
    const dist = makeDist({ ".vite/manifest.json": JSON.stringify(m), ...files });
    const report = checkPlacement({ distDir: dist });
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/not Catalog-only/);
  });

  it("fails on a query-core barrel module key in the / graph", () => {
    const m = JSON.parse(manifest(["_http-x.js"])) as Record<string, unknown>;
    m["../../packages/query-core/src/index.ts"] = { file: "assets/qc.js" };
    (m["src/routes/Hub.tsx"] as { imports: string[] }).imports.push(
      "../../packages/query-core/src/index.ts",
    );
    const dist = makeDist({
      ".vite/manifest.json": JSON.stringify(m),
      "assets/qc.js": "export{};",
      ...files,
    });
    expect(checkPlacement({ distDir: dist }).violations.join("\n")).toMatch(/query-core barrel/);
  });
});
