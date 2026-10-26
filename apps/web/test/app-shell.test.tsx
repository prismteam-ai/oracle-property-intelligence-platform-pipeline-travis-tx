// A-03 T006 (G-A2): the app shell of apps/web (plan § "Atlas element map" → Shell; FR-002).
// Written before src/App.tsx exists: the red run fails with "Cannot find module '../src/App'".
// A-13 T008 updates it: every route of route-list.ts is a lazy child that renders a heading,
// `/` renders the Hub (no redirect), the bar title links to `/`, the destinations are Explore,
// Runs, Coverage, Data and More (a sheet with the Coming soon items); `/permits` stays.
// Three fixed assertions from tasks.md: /runs and /permits are lazy routes, / redirects to /runs,
// and nothing in apps/web/src uses an inline style literal (Atlas tokens through CSS Modules only).
// The shell checks after them pin the A-03 bar (title only) and the two destinations.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PAGE_TEXTS, ROUTES } from "@countylens/shared";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../src/App";
import { DESTINATIONS } from "../src/components/AppShell";
import { COMING_SOON_ITEMS } from "../src/content/coming-soon";
import { ROUTE_LIST } from "../src/routes/route-list";

/** Every TSX source of the app, read as text (Vite raw import; no node: API in a jsdom test). */
const SOURCES = import.meta.glob<string>("../src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const INLINE_STYLE_LITERAL = /style=\{\{/;

function shellChildren(): RouteObject[] {
  const shell = routes[0];
  expect(shell, "the shell route").toBeDefined();
  expect(shell?.path).toBe("/");
  return shell?.children ?? [];
}

function childRoute(path: string): RouteObject {
  const route = shellChildren().find((r) => r.path === path);
  expect(route, `route ${path}`).toBeDefined();
  return route as RouteObject;
}

async function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.initialized).toBe(true));
  await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
  // React Router 7 applies router state inside a React transition: an idle router does not mean
  // React has committed the shell yet. On a slow runner the waitFor interval fired before the
  // commit and the queries below saw an empty container (CI 2026-10-21, ubuntu: `<body><div />`).
  // Wait for the committed shell itself.
  await screen.findByRole("navigation", { name: "Primary" }, { timeout: 20_000 });
  return { router, ...view };
}

afterEach(() => {
  document.body.innerHTML = "";
});

/** A concrete URL for a route pattern (`:cid`, `:item`, `:county` filled with plain values). */
function concrete(path: string): string {
  return path
    .replace(":cid", "bafkreiroutecheck")
    .replace(":item", COMING_SOON_ITEMS[0]?.id ?? "")
    .replace(":county", "williamson")
    .replace("/*", "/explore");
}

/** The kept A-03 page files (G2 extends Runs later). */
const A03_PAGES: readonly string[] = ["/runs", "/permits"];

describe("app shell routes (A-13 T015: every route of contracts/ui-routes.md, lazy)", () => {
  it("every route-list entry is a lazy child of the shell: a lazy loader, no eager element or Component", () => {
    const children = shellChildren();
    for (const entry of ROUTE_LIST) {
      const route =
        entry.path === "/"
          ? children.find((r) => r.index === true)
          : // `/data/verify/:cid?`: the CID segment is optional (a bare URL opens the latest).
            children.find((r) => `/${(r.path ?? "").replace(/\?$/, "")}` === entry.path);
      expect(route, `route ${entry.path}`).toBeDefined();
      expect(typeof route?.lazy, `${entry.path}.lazy`).toBe("function");
      expect(route?.element, `${entry.path}.element`).toBeUndefined();
      expect(route?.Component, `${entry.path}.Component`).toBeUndefined();
    }
    // Plus the `*` catch-all ("Page not found").
    expect(children).toHaveLength(ROUTE_LIST.length + 1);
  });

  it("an unknown address renders Page not found inside the shell", async () => {
    await renderAt("/no-such-page");
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });

  it("covers every route of the contract (ROUTES in packages/shared), /permits kept", () => {
    const paths = ROUTE_LIST.map((r) => r.path);
    for (const path of Object.values(ROUTES)) expect(paths, path).toContain(path);
    expect(paths).toContain("/permits");
    expect(childRoute("permits")).toBeDefined();
  });

  it("/ renders the Hub (no redirect to /runs)", async () => {
    const { router } = await renderAt("/");
    expect(router.state.location.pathname).toBe("/");
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { level: 2 })).toBeTruthy();
  });

  it("every route in route-list.ts renders a heading inside main", async () => {
    for (const entry of ROUTE_LIST) {
      const { unmount } = await renderAt(concrete(entry.path));
      const main = screen.getByRole("main");
      if (A03_PAGES.includes(entry.path)) {
        // The kept A-03 pages (Runs, Permits; not A-13 files) render their h2 only once their
        // data has loaded; without the VITE_* hosts they show the error banner inside their
        // labelled section, so the check is that labelled region.
        expect(
          await within(main).findByRole("region", { name: entry.title }, { timeout: 20_000 }),
        ).toBeTruthy();
      } else {
        const heading = await within(main).findByRole("heading", { level: 2 }, { timeout: 20_000 });
        expect(heading.textContent?.trim().length, entry.path).toBeGreaterThan(0);
      }
      unmount();
      document.body.innerHTML = "";
    }
  }, 60_000);
});

describe("no inline style literal (Atlas § 13 rule 4; ESLint no-restricted-syntax)", () => {
  it("has no `style={{…}}` in any apps/web/src TSX file", () => {
    const files = Object.keys(SOURCES);
    expect(files.length, "TSX sources under apps/web/src").toBeGreaterThan(0);
    for (const [file, text] of Object.entries(SOURCES)) {
      expect(text, file).not.toMatch(INLINE_STYLE_LITERAL);
    }
  });

  it("renders /runs and /permits without a style attribute on any element", async () => {
    for (const path of ["/runs", "/permits"]) {
      const { container, unmount } = await renderAt(path);
      expect(container.querySelectorAll("[style]"), path).toHaveLength(0);
      unmount();
    }
  });
});

describe("shell chrome (plan § Atlas element map → Shell; A-13 T015)", () => {
  // A-16 T050 (Shell1440/768/390 boards): title, then sync badge, help menu and Ask.
  it("shows the title CountyLens linking to /, the help menu and the Ask entry", async () => {
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { level: 1, name: "CountyLens" })).toBeTruthy();
    const title = within(bar).getByRole("link", { name: "CountyLens" });
    expect(title.getAttribute("href")).toBe("/");
    const ask = within(bar).getByRole("link", { name: "Ask" });
    expect(ask.getAttribute("href")).toBe("/tx/travis/explore?mode=ai");
    const help = within(bar).getByRole("button", { name: "Help" });
    expect(help.getAttribute("aria-haspopup")).toBe("menu");
    expect(help.getAttribute("aria-expanded")).toBe("false");
  });

  it("the help menu lists the board's entries and closes on Escape with focus back on Help", async () => {
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    const help = within(bar).getByRole("button", { name: "Help" });
    fireEvent.click(help);
    const menu = within(bar).getByRole("menu", { name: "Help" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.querySelector("[data-help-label]")?.textContent)).toEqual([
      "What can I ask?",
      "Field glossary",
      "MCP and API docs",
      "Data use and licences",
    ]);
    expect(items.map((i) => i.getAttribute("href"))).toEqual([
      "/tx/travis/explore?welcome=1",
      "/data/catalog",
      "/help/mcp",
      "/legal/data",
    ]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(within(bar).queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  it("the sync badge shows Run N · date from /runs/index.json and links to Runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          schema: "oracle-travis-runs-index.v1",
          runs: [
            { runId: "a", manifestCid: "bafkreia", finishedAt: "2026-10-17T10:00:00Z" },
            { runId: "b", manifestCid: "bafkreib", finishedAt: "2026-10-24T18:20:00Z" },
          ],
        }),
      ),
    );
    try {
      await renderAt("/runs");
      const bar = screen.getByRole("banner");
      await waitFor(() =>
        expect(bar.querySelector('[data-sync-badge="ready"]')?.textContent).toContain(
          "Run 2 · Oct 24",
        ),
      );
      expect(bar.querySelector('[data-sync-badge="ready"]')?.getAttribute("href")).toBe("/runs");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an unreadable run index shows Sync status unavailable with Retry, never a made-up run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("x", { status: 503 })),
    );
    try {
      await renderAt("/runs");
      const bar = screen.getByRole("banner");
      await waitFor(() => expect(bar.querySelector('[data-sync-badge="error"]')).not.toBeNull());
      expect(bar.textContent).toContain("Sync status unavailable");
      expect(bar.textContent).not.toMatch(/Run \d/);
      expect(within(bar).getByRole("button", { name: "Retry" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks Coverage and MCP hidden below 600 px and lists them in More for compact", async () => {
    await renderAt("/runs");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const coverage = within(nav).getByRole("link", { name: /Coverage/ });
    const css = cssModule("../src/components/AppShell.module.css") ?? "";
    expect(coverage.className).toMatch(/compactHidden/);
    expect(css).toMatch(/\.nav \.compactHidden \{\s*display: none;/);
    fireEvent.click(within(nav).getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    const compact = [...sheet.querySelectorAll("li")].filter((li) =>
      /compactOnly/.test(li.className),
    );
    expect(compact.map((li) => li.querySelector("a")?.getAttribute("href"))).toEqual([
      "/tx/travis/coverage",
      "/help/mcp",
      "/admin/sign-in",
    ]);
  });

  it("offers the destinations Explore, Runs, Coverage, Data, MCP and More, and marks the current one", async () => {
    await renderAt("/runs");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringContaining("Explore"),
      expect.stringContaining("Runs"),
      expect.stringContaining("Coverage"),
      expect.stringContaining("Data"),
      expect.stringContaining("MCP"),
      expect.stringContaining("Admin"),
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/tx/travis/explore",
      "/runs",
      "/tx/travis/coverage",
      "/data/manifest",
      "/help/mcp",
      "/admin/sign-in",
    ]);
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
    const more = within(nav).getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(within(nav).queryByRole("link", { name: "Permits" })).toBeNull();
    expect(DESTINATIONS.map((d) => d.label)).toEqual([
      "Explore",
      "Runs",
      "Coverage",
      "Data",
      "MCP",
    ]);
  });

  it("More opens a sheet listing every Coming soon item; the legal links are in the page footer; Escape closes it", async () => {
    await renderAt("/runs");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    fireEvent.click(within(nav).getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(nav).getByRole("button", { name: "More" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    const hrefs = within(sheet)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    for (const item of COMING_SOON_ITEMS) {
      if (item.linked) expect(hrefs).toContain(`/soon/${item.id}`);
      else expect(hrefs).not.toContain(`/soon/${item.id}`); // AI-user sign-in: listed, not linked
    }
    expect(within(sheet).getByText("AI-user sign-in")).toBeTruthy();
    // PO 2026-10-26: pages reachable from their own page or the help menu left the sheet.
    for (const path of ["/data/catalog", "/runs/log", "/runs/compare", "/legal/data"])
      expect(hrefs).not.toContain(path);
    const legal = screen.getByRole("navigation", { name: "Legal" });
    expect(
      within(legal)
        .getAllByRole("link")
        .map((l) => l.getAttribute("href")),
    ).toEqual(["/legal/terms", "/legal/privacy", "/legal/data"]);
    expect(within(sheet).getAllByText(PAGE_TEXTS.comingSoon).length).toBe(COMING_SOON_ITEMS.length);
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  });

  it("More is a modal: aria-modal, scrim, focus inside, Tab trapped, background inert, focus returns", async () => {
    const { container } = await renderAt("/runs");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const more = within(nav).getByRole("button", { name: "More" });
    fireEvent.click(more);
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(sheet);
    expect(container.querySelector("[data-more-scrim]")).not.toBeNull();
    expect(nav.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("main", { hidden: true }).hasAttribute("inert")).toBe(true);
    const focusable = sheet.querySelectorAll<HTMLElement>("a[href]");
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(nav.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(within(nav).getByRole("button", { name: "More" }));
  });

  it("the Coming soon list is the D-7 list: id, title and one sentence, no numbers or CIDs", () => {
    expect(COMING_SOON_ITEMS.map((i) => i.title)).toEqual([
      "Builder mode",
      "Other counties and states",
      "Street View",
      "AI-user sign-in",
      "Saved searches",
      "Similar properties",
      "Pipeline diagram and Gantt",
      "Area matrix",
      "Timeline scrubber",
      "Gateway race",
    ]);
    for (const item of COMING_SOON_ITEMS) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.sentence).toMatch(/^[^.]+\.$/); // one sentence
      expect(`${item.title} ${item.sentence}`).not.toMatch(/\d|baf[a-z2-7]{6,}/);
    }
  });
});

/** A CSS Module of the app, read as text by its glob-style path (`../src/…`); Vitest stubs CSS imports. */
function cssModule(path: string): string | undefined {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * The declarations of every rule of a CSS Module whose selector list contains the plain class
 * `.{name}` (alone or grouped: `.toggle,\n.chip { … }`), joined; compound or descendant selectors
 * such as `.toggle:hover` or `.x .toggle` do not count. `undefined` when no rule names it.
 */
function ruleBody(css: string, name: string): string | undefined {
  const bodies: string[] = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of plain.matchAll(/(?:^|\n)([^{}@]+)\{([^}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (selectors.includes(`.${name}`)) bodies.push(m[2] ?? "");
  }
  return bodies.length === 0 ? undefined : bodies.join("\n");
}

describe("ERR-12: every <button> sets its font from the tokens (a UA button font is Arial 13.33px)", () => {
  // `button` does not inherit the page font: without a font declaration it computes the user
  // agent's (smeargle 2026-10-21: Copy CID = Arial / 13.33px). stylelint cannot see a missing
  // declaration, so each button's CSS Module class must declare `font: inherit` or a token
  // font-family plus font-size.
  const buttons = Object.entries(SOURCES).flatMap(([file, source]) => {
    const module = /import styles from "\.\/([\w.]+\.module\.css)"/.exec(source)?.[1];
    return [...source.matchAll(/<button\b[^>]*className=\{styles\.(\w+)\}/g)].map((m) => ({
      file,
      cls: m[1] ?? "",
      css: module === undefined ? undefined : cssModule(file.replace(/[^/]+$/, module)),
    }));
  });

  it("finds the app's buttons (Copy CID, Retry, the shell's More, the Permits pager)", () => {
    expect(buttons.map((b) => b.cls)).toEqual(
      expect.arrayContaining(["copy", "retry", "more", "pagerButton"]),
    );
  });

  for (const name of [...new Set(buttons.map((b) => b.cls))]) {
    it(`.${name}: declares font: inherit, or a token font-family and font-size`, () => {
      const button = buttons.find((b) => b.cls === name);
      expect(button?.css, `${name}: CSS Module found`).toBeDefined();
      const body = ruleBody(button?.css ?? "", name) ?? "";
      const inherits = /(^|;|\s)font:\s*inherit\s*;/.test(body);
      const tokens = /font-family:\s*var\(--md-/.test(body) && /font-size:\s*var\(--md-/.test(body);
      expect(inherits || tokens, `.${name} {${body}}`).toBe(true);
    });
  }
});

describe("ERR-13: landmark order: banner, navigation, then main (keyboard reaches the rail first)", () => {
  it("renders the navigation before main in DOM order; the grid areas place them visually", async () => {
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const main = screen.getByRole("main");
    const precedes = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(precedes(bar, nav), "banner before navigation").toBe(true);
    expect(precedes(nav, main), "navigation before main").toBe(true);
  });

  it("keeps the layout in grid-template-areas (DOM order does not move anything visually)", () => {
    const css = cssModule("../src/components/AppShell.module.css") ?? "";
    expect(ruleBody(css, "nav")).toMatch(/grid-area:\s*nav/);
    expect(ruleBody(css, "main")).toMatch(/grid-area:\s*main/);
    expect(css).toMatch(/"nav main"/);
    expect(css).toMatch(/"bar"\s*"main"\s*"nav"/);
  });
});

describe("A13-7: <main> has an accessible name and an inset focus ring", () => {
  it("names the focusable main region", async () => {
    await renderAt("/runs");
    expect(screen.getByRole("main", { name: "Page content" }).getAttribute("tabindex")).toBe("0");
  });

  it("draws the main focus ring inside the region with the primary token, no negative offset", () => {
    const css = cssModule("../src/components/AppShell.module.css") ?? "";
    const ring = /\.main:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(ring).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--md-sys-color-primary\)/);
    expect(ring).toMatch(/outline:\s*none/);
    expect(ring).not.toMatch(/outline-offset:\s*-/);
  });
});
