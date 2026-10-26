// T010 (A-03, metagross "Findings from the code"): query-core must bundle for the browser.
// The SQL files and the digests that used to be read or hashed with node:fs / node:crypto at
// module load are generated constants (scripts/gen-sql.ts → src/sql.generated.ts, and the marked
// RULES_SHA256 line of the profile). This Node test proves the constants equal the files and the
// recomputed SHA-256s, and that nothing reachable from src/index.ts imports a `node:` module or
// uses the `Buffer` global.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROFILE, canonicalize as canonicalRules } from "@countylens/profile-travis-austin";
import { GAZETTEER_SHA256, STATUS_MAP_SQL, VIEWS_SQL } from "../src/sql.generated.js";
import { GAZETTEER } from "../gazetteer/travis-places@1.0.0/index.js";
import {
  OwnerAreaFile,
  PlaceRow,
  SourcesFile,
  ZctaRow,
  GAZETTEER_VERSION,
  canonicalize,
  decodeZctaBitmap,
} from "../gazetteer/travis-places@1.0.0/schema.js";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const ROOT = resolve(PKG, "../../");
const GAZ = join(PKG, "gazetteer/travis-places@1.0.0");
const PROFILE_DIR = join(ROOT, "profiles/travis-austin@1.0.0");

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const committedDigest = (dir: string): string => readFileSync(join(dir, "DIGEST"), "utf8").trim();

describe("generated SQL constants (T010)", () => {
  it("VIEWS_SQL equals views.sql byte for byte", () => {
    expect(VIEWS_SQL).toBe(readFileSync(join(PKG, "views.sql"), "utf8"));
  });

  it("STATUS_MAP_SQL equals the generated status-map file byte for byte", () => {
    const file = readFileSync(join(PKG, "generated/travis-austin@1.0.0.status-map.sql"), "utf8");
    expect(STATUS_MAP_SQL).toBe(file);
  });
});

describe("generated digest constants (T010)", () => {
  it("GAZETTEER_SHA256 is the recomputed digest of the gazetteer files and the committed DIGEST", () => {
    const body = {
      version: GAZETTEER_VERSION,
      places: PlaceRow.array().parse(readJson(join(GAZ, "places.json"))),
      zctas: ZctaRow.array().parse(readJson(join(GAZ, "zctas.json"))),
      "owner-area": OwnerAreaFile.parse(readJson(join(GAZ, "owner-area.json"))),
      sources: SourcesFile.parse(readJson(join(GAZ, "sources.json"))),
    };
    const recomputed = sha256(canonicalize(body));
    expect(GAZETTEER_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(GAZETTEER_SHA256).toBe(recomputed);
    expect(GAZETTEER_SHA256).toBe(committedDigest(GAZ));
    expect(GAZETTEER.sha256).toBe(GAZETTEER_SHA256);
  });

  it("the all-US ZCTA bitmap matches its recorded count and sha256 (checked here, not at load)", () => {
    const meta = OwnerAreaFile.parse(readJson(join(GAZ, "owner-area.json"))).all_us_zctas;
    const list = decodeZctaBitmap(meta.bitmap_base64);
    expect(list.length).toBe(meta.count);
    expect(sha256(list.join("\n"))).toBe(meta.sha256);
  });

  it("PROFILE.sha256 is the recomputed digest of rules.json, the committed DIGEST and the generated line", () => {
    const recomputed = sha256(canonicalRules(readJson(join(PROFILE_DIR, "rules.json"))));
    expect(PROFILE.sha256).toBe(recomputed);
    expect(PROFILE.sha256).toBe(committedDigest(PROFILE_DIR));
    const source = readFileSync(join(PROFILE_DIR, "index.ts"), "utf8");
    const line = /^export const RULES_SHA256 = "([0-9a-f]{64})";$/m.exec(source);
    expect(line?.[1], "profile index.ts has one generated RULES_SHA256 line").toBe(recomputed);
  });
});

// ---------------------------------------------------------------------------------------
// Static scan: every module reachable from src/index.ts
// ---------------------------------------------------------------------------------------

/** Workspace packages reachable from query-core, resolved to their source entry. */
const WORKSPACE: Record<string, string> = {
  "@countylens/contract": join(ROOT, "packages/contract/src/index.ts"),
  "@countylens/profile-travis-austin": join(PROFILE_DIR, "index.ts"),
};
/** npm packages the browser bundle may carry. */
const ALLOWED_NPM = new Set(["zod"]);

const SPECIFIER =
  /^\s*(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/gm;

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(SPECIFIER)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
  return out.filter((s) => s !== "");
}

function resolveSpecifier(from: string, spec: string): string | null {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(from), spec);
    if (target.endsWith(".json")) return null; // data, bundled as JSON
    const ts = target.replace(/\.js$/, ".ts");
    if (!existsSync(ts)) throw new Error(`${relative(ROOT, from)} imports missing ${spec}`);
    return ts;
  }
  return WORKSPACE[spec] ?? null;
}

/** All .ts files reachable from src/index.ts, plus every bare (npm or node:) specifier seen. */
function reachable(): { files: string[]; bare: Map<string, string[]> } {
  const start = join(PKG, "src/index.ts");
  const seen = new Set<string>();
  const bare = new Map<string, string[]>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      const next = resolveSpecifier(file, spec);
      if (next) queue.push(next);
      else if (!spec.startsWith(".") && !(spec in WORKSPACE))
        bare.set(spec, [...(bare.get(spec) ?? []), relative(ROOT, file)]);
    }
  }
  return { files: [...seen].sort(), bare };
}

describe("browser safety of the modules reachable from src/index.ts (T010)", () => {
  const graph = reachable();

  it("reaches the profile, the gazetteer and the contract", () => {
    const rel = graph.files.map((f) => relative(ROOT, f));
    expect(rel).toEqual(
      expect.arrayContaining([
        "packages/query-core/src/bind-manifest.ts",
        "packages/query-core/src/sql.generated.ts",
        "packages/query-core/gazetteer/travis-places@1.0.0/index.ts",
        "packages/query-core/gazetteer/travis-places@1.0.0/schema.ts",
        "profiles/travis-austin@1.0.0/index.ts",
        "packages/contract/src/index.ts",
      ]),
    );
  });

  it("has no `node:` or bare Node built-in import (static, dynamic or require)", () => {
    const NODE_BUILTINS = new Set(["fs", "crypto", "path", "url", "os", "buffer", "process"]);
    const offenders = [...graph.bare.entries()]
      .filter(([spec]) => spec.startsWith("node:") || NODE_BUILTINS.has(spec))
      .map(([spec, files]) => `${spec} ← ${files.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("carries only the allowed npm packages into the bundle", () => {
    const npm = [...graph.bare.keys()].filter((s) => !s.startsWith("node:"));
    expect(npm.filter((s) => !ALLOWED_NPM.has(s))).toEqual([]);
  });

  it("never touches the `Buffer` global (undefined in a browser)", () => {
    const offenders = graph.files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /\bBuffer\b/.test(line) && !/^\s*(\/\/|\*)/.test(line))
        .map(({ n }) => `${relative(ROOT, f)}:${n}`),
    );
    expect(offenders).toEqual([]);
  });
});
