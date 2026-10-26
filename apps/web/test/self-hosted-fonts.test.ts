// @vitest-environment node
// ERR-46 (TC-081, TC-040, TC-073): the web fonts are self-hosted. A render-blocking Google Fonts
// stylesheet plus its font files cost 1-3 s per page and varied with the network of the moment.
// Source-level checks (no browser): no Google font URL anywhere, every @font-face file exists as
// a real woff2, the icon subset covers every icon name the code uses, font-display values, and the
// built dist/index.html when a build exists.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/components/AppShell";
import { STATUS_ICONS } from "../src/components/StatusPill";

const WEB = join(__dirname, "..");
const SRC = join(WEB, "src");
const FONTS = join(WEB, "public", "fonts");
const read = (path: string): string => readFileSync(path, "utf8");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const sources = walk(SRC);
const cssFiles = sources.filter((f) => f.endsWith(".css"));
const codeFiles = sources.filter((f) => /\.tsx?$/.test(f));

const fontsCss = read(join(SRC, "styles", "fonts.css"));
const faces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
const prop = (face: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(face)?.[1]?.trim().replaceAll('"', "'");

describe("no third-party font requests", () => {
  it("index.html and every CSS/TS source name no Google font host", () => {
    for (const file of [join(WEB, "index.html"), ...cssFiles, ...codeFiles]) {
      const text = read(file);
      expect(text, file).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    }
  });

  it("is imported before tokens.css and the app CSS in main.tsx", () => {
    const main = read(join(SRC, "main.tsx"));
    const fonts = main.indexOf('"./styles/fonts.css"');
    expect(fonts).toBeGreaterThanOrEqual(0);
    expect(fonts).toBeLessThan(main.indexOf('"./styles/tokens.css"'));
    expect(fonts).toBeLessThan(main.indexOf('"./App"'));
  });
});

describe("@font-face rules", () => {
  it("declare Roboto, Roboto Mono and Material Symbols Rounded", () => {
    const families = faces.map((f) => prop(f, "font-family"));
    expect(families).toEqual(
      expect.arrayContaining(["'Roboto'", "'Roboto Mono'", "'Material Symbols Rounded'"]),
    );
  });

  it.each(faces.map((face) => [prop(face, "font-family") ?? "", face] as const))(
    "%s: every src file is a woff2 in public/fonts, at most 60 KB",
    (_family, face) => {
      const urls = [...face.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1] ?? "");
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toMatch(/^\/fonts\/[a-z0-9-]+\.woff2$/);
        const file = join(FONTS, url.replace("/fonts/", ""));
        expect(existsSync(file), file).toBe(true);
        expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("wOF2");
        expect(statSync(file).size).toBeLessThanOrEqual(60 * 1024);
      }
    },
  );

  it("uses font-display swap for text and block for the icon font", () => {
    for (const face of faces) {
      const family = prop(face, "font-family");
      expect(prop(face, "font-display")).toBe(
        family === "'Material Symbols Rounded'" ? "block" : "swap",
      );
    }
  });

  it("matches the family names tokens.css uses and has no Google @import", () => {
    const tokens = read(join(SRC, "styles", "tokens.css"));
    expect(tokens).not.toMatch(/@import/);
    expect(tokens).toContain("'Material Symbols Rounded'");
    expect(tokens).toMatch(/--md-ref-typeface-plain:\s*Roboto,/);
    expect(tokens).toMatch(/--md-ref-typeface-mono:\s*"Roboto Mono",/);
  });

  it("ships a licence file naming the fonts and Apache License 2.0", () => {
    const licence = read(join(FONTS, "LICENSE-fonts.txt"));
    for (const word of ["Roboto", "Roboto Mono", "Material Symbols", "Apache License"]) {
      expect(licence).toContain(word);
    }
  });
});

describe("Material Symbols subset", () => {
  const recorded: string[] = JSON.parse(read(join(FONTS, "icons.json"))).icon_names;

  const used = (): Set<string> => {
    const names = new Set<string>([
      ...Object.values(STATUS_ICONS),
      ...DESTINATIONS.map((d) => d.icon),
    ]);
    const patterns = [
      /\bicon\s*[=:]\s*["']([a-z0-9_]+)["']/g,
      /<(?:Icon|Glyph)\s+name="([a-z0-9_]+)"/g,
      /\bdata-icon=["']([a-z0-9_]+)["']/g,
    ];
    for (const file of codeFiles) {
      for (const pattern of patterns) {
        for (const m of read(file).matchAll(pattern)) names.add(m[1] ?? "");
      }
    }
    return names;
  };

  it("records icon_names alphabetically (the Google Fonts API requires it)", () => {
    expect(recorded).toEqual([...recorded].sort());
  });

  it("covers every icon name the source uses; regenerate the subset when you add one", () => {
    const missing = [...used()].filter((name) => !recorded.includes(name));
    expect(missing, "add to public/fonts/icons.json and refetch the subset").toEqual([]);
  });

  // The subset keeps one URL per icon set: a regenerated file under an old name let browsers
  // that cached the earlier subset draw new icons as their clipped first letter.
  it("names its file after the first 8 hex of its SHA-256, so a new icon set gets a new URL", () => {
    const url = /url\(\s*["']?(\/fonts\/material-symbols-rounded-subset-[^"')]+)/.exec(
      fontsCss,
    )?.[1];
    const file = join(FONTS, (url ?? "").replace("/fonts/", ""));
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
    expect(url).toBe(`/fonts/material-symbols-rounded-subset-${digest}.woff2`);
  });

  it("does not carry names the source no longer uses", () => {
    const stale = recorded.filter((name) => !used().has(name));
    expect(stale).toEqual([]);
  });
});

describe("built dist/index.html", () => {
  const dist = join(WEB, "dist", "index.html");
  it.skipIf(!existsSync(dist))("preloads the two critical fonts and names no Google URL", () => {
    const html = read(dist);
    expect(html).not.toMatch(/googleapis|gstatic/);
    const preloads = html.match(/<link\b[^>]*rel="preload"[^>]*as="font"[^>]*>/g) ?? [];
    const hrefs = preloads.map((t) => /href="([^"]+)"/.exec(t)?.[1]);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/fonts/roboto-latin.woff2",
        // The symbols subset's URL as fonts.css names it (fingerprinted, see above).
        /url\(\s*["']?(\/fonts\/material-symbols-rounded-subset-[^"')]+)/.exec(fontsCss)?.[1],
      ]),
    );
    for (const tag of preloads) {
      expect(tag).toContain('type="font/woff2"');
      expect(tag).toContain("crossorigin");
    }
  });
});
