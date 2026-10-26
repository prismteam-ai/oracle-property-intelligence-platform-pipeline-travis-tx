// A-13 hosted smeargle defects D1-D5 (docs/evidence/A-13-smeargle.md): every interactive target
// is at least 48 x 48 px (Atlas § 14.1: min-width / min-height / width / height var(--space-9))
// and every form control takes its font from the tokens (ERR-12). Source-level checks on the CSS
// Modules, in the style of app-shell.test.tsx: jsdom computes no layout.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (file: string): string => readFileSync(join(__dirname, "../src", file), "utf8");

/** The declarations of every plain rule that names `.name` (comments stripped; `:hover` skipped). */
function ruleBody(css: string, name: string): string {
  const bodies: string[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of plain.matchAll(/(?:^|\n)([^{}@]+)\{([^}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (selectors.includes(`.${name}`)) bodies.push(m[2] ?? "");
  }
  return bodies.join("\n");
}

const TARGET = "var\\(--space-9\\)";
const has = (body: string, prop: string): boolean =>
  new RegExp(`(^|[;\\s])${prop}:\\s*${TARGET}\\s*;`).test(body);

describe("D1: the header wordmark is a 48 px target", () => {
  const body = ruleBody(src("components/AppShell.module.css"), "titleLink");
  it("has min-height var(--space-9) and is a flex box so the text stays centred", () => {
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/display:\s*inline-flex/);
    expect(body).toMatch(/align-items:\s*center/);
  });
});

describe("D2: Hub footer links are at least 48 wide", () => {
  const body = ruleBody(src("routes/Hub.module.css"), "link");
  it("has min-width and min-height var(--space-9)", () => {
    expect(has(body, "min-width"), body).toBe(true);
    expect(has(body, "min-height"), body).toBe(true);
  });
});

describe("D3: Data · Manifest controls are at least 48 x 48", () => {
  it("the Verify action links have both minimums", () => {
    const body = ruleBody(src("routes/DataManifest.module.css"), "actionLink");
    expect(has(body, "min-width"), body).toBe(true);
    expect(has(body, "min-height"), body).toBe(true);
  });
  it("the Copy CID button cannot shrink below 48 inside the flex CID display", () => {
    const body = ruleBody(src("components/CidDisplay.module.css"), "copy");
    expect(has(body, "min-width"), body).toBe(true);
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/flex:\s*none/);
  });
});

describe("D4: Explore checkboxes are 48 px targets with the token font", () => {
  const body = ruleBody(src("components/FilterSheet.module.css"), "box");
  it("the checkbox input is 48 x 48", () => {
    expect(has(body, "width"), body).toBe(true);
    expect(has(body, "height"), body).toBe(true);
  });
  it("takes its font from the tokens (a UA checkbox computes Arial)", () => {
    expect(body).toMatch(/(^|[;\s])font:\s*inherit\s*;/);
  });
  it("every input, select and textarea class sets a token font", () => {
    const uses: [string, string, string][] = [
      ["components/FilterSheet.module.css", "input", "FilterSheet.tsx"],
      ["components/CountySelect.module.css", "select", "CountySelect.tsx"],
    ];
    for (const [css, cls] of uses) {
      const b = ruleBody(src(css), cls);
      const ok = /font:\s*inherit\s*;/.test(b) || /font-family:\s*var\(--/.test(b);
      expect(ok, `${css} .${cls}`).toBe(true);
    }
  });
});

describe("D5: Property drawer source links and name", () => {
  it("the provenance link is a 48 px target that does not grow its line (ERR-47)", () => {
    // Inline with block padding: the box is at least 48 px high (16 + 16 + one 16 px line) but the
    // line box keeps the text height, so a 48 px target no longer pushes the CID line down.
    const body = ruleBody(src("components/Provenance.module.css"), "link");
    expect(body, body).toMatch(/(^|[;\s])display:\s*inline\s*;/);
    expect(body, body).toMatch(/(^|[;\s])padding-block:\s*var\(--space-4\)\s*;/);
    expect(body, body).not.toMatch(/min-height/);
  });
  it("the drawer dialog is named by its heading at every width", () => {
    const tsx = src("routes/PropertyDrawer.tsx");
    expect(tsx).toMatch(/aria-labelledby=\{titleId\}/);
    expect(tsx).toMatch(/<h3 id=\{titleId\}/);
  });
});

describe("N1: Runs and Compare in-page links are 48 px high (smeargle run 2, build a285dbe)", () => {
  const body = ruleBody(src("routes/Runs.module.css"), "link");
  it("is a flex box with min-height var(--space-9) so the text stays centred", () => {
    expect(has(body, "min-height"), body).toBe(true);
    expect(body).toMatch(/display:\s*inline-flex/);
    expect(body).toMatch(/align-items:\s*center/);
  });
});

describe("N2: icon glyphs have a fixed 1em box (TC-072 under load, build d3ae47e: 'more_horiz' 111 px wide)", () => {
  // Until the symbols font arrives, the glyph name shows as fallback text; without a clipped box it
  // widens the bottom nav to 406 px at 390 (horizontal scroll and layout shift on slow networks).
  const boxed = (body: string): void => {
    expect(body, body).toMatch(/(^|[;\s])width:\s*1em\s*;/);
    expect(body, body).toMatch(/(^|[;\s])height:\s*1em\s*;/);
    expect(body, body).toMatch(/overflow:\s*hidden/);
    expect(body, body).toMatch(/white-space:\s*nowrap/);
  };
  it("Icon `.icon` is a clipped 1em box", () => {
    boxed(ruleBody(src("components/Icon.module.css"), "icon"));
  });
  it("the app shell's `.glyph` is a clipped 1em box and Glyph uses it", () => {
    boxed(ruleBody(src("components/AppShell.module.css"), "glyph"));
    expect(src("components/AppShell.tsx")).toMatch(/material-symbols-rounded \$\{styles\.glyph\}/);
  });
});

describe("N3: Help · MCP snippet wrapper can shrink (smeargle run 3, build 015fbf9: main scrollWidth 693 at 390)", () => {
  // A grid item's automatic minimum width is its content's min-content: the unwrapped <pre> made
  // the whole card 677 px wide, so the page scrolled sideways inside `main`.
  it("the wrapper around each <pre> has min-width: 0 and HelpMcp uses it", () => {
    const body = ruleBody(src("routes/HelpMcp.module.css"), "snippetBox");
    expect(body, body).toMatch(/(^|[;\s])min-width:\s*0\s*;/);
    expect(src("routes/HelpMcp.tsx")).toMatch(
      /<div key=\{snippet\.id\} className=\{styles\.snippetBox\}>/,
    );
  });
});

describe("N4: the first permit provenance line stays inside 390 x 844 (ERR-47, A-03-TC-NF-03)", () => {
  // The 48 px source link (D5) and copy button (D3) are atomic boxes and cost ~30 px of height, so
  // the first [data-cid] of /permits ended at y 828-860 > 844. The fix compacts the first card:
  // each label/value pair shares one line (two-column grid, token gaps) at < 600 px, with no
  // negative or literal value anywhere (the hosted token audit reports a -16 px margin as a violation).
  const permits = src("routes/Permits.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  it("the card fields are a three-column grid (3fr 2fr 2fr, token column gap) with a token row gap", () => {
    const body = ruleBody(permits, "cardRows");
    expect(body, body).toMatch(/(^|[;\s])display:\s*grid\s*;/);
    expect(body, body).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*3fr\)\s+minmax\(0,\s*2fr\)\s+minmax\(0,\s*2fr\)\s*;/,
    );
    expect(body, body).toMatch(/column-gap:\s*var\(--space-3\)\s*;/);
    expect(body, body).toMatch(/row-gap:\s*var\(--space-1\)\s*;/);
  });
  it("the Contractor and Missing data rows (several wide pills) span the full card width", () => {
    expect(permits).toMatch(
      /\.cardRow:nth-last-child\(-n \+ 2\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*;/,
    );
  });
  it("the page and card stack one token step tighter (space-2) with 12 px top and bottom card padding", () => {
    expect(ruleBody(permits, "page")).toMatch(/(^|[;\s])gap:\s*var\(--space-2\)\s*;/);
    const card = ruleBody(permits, "card");
    expect(card).toMatch(/(^|[;\s])gap:\s*var\(--space-2\)\s*;/);
    expect(card).toMatch(/padding:\s*var\(--space-3\)\s+var\(--space-4\)\s*;/);
  });
  it("no stylesheet uses a negative margin (not a token value; ERR-47 first attempt)", () => {
    const dirs = ["components", "routes", "styles"];
    for (const dir of dirs) {
      for (const f of readdirSync(join(__dirname, "../src", dir)).filter((n) =>
        n.endsWith(".css"),
      )) {
        const css = src(`${dir}/${f}`).replace(/\/\*[\s\S]*?\*\//g, "");
        expect(css, `${dir}/${f}`).not.toMatch(/margin[a-z-]*:[^;]*((?<![\w-])-\s*\d|\*\s*-)/);
        expect(css, `${dir}/${f}`).not.toMatch(/calc\(var\(--space-\d+\)\s*\*\s*-/);
      }
    }
  });
  it("the copy button itself is still a fixed 48 x 48 box", () => {
    const body = ruleBody(src("components/CidDisplay.module.css"), "copy");
    for (const prop of ["width", "min-width", "height", "min-height"]) {
      expect(has(body, prop), `${prop}: ${body}`).toBe(true);
    }
    expect(body).toMatch(/flex:\s*none/);
  });
});
