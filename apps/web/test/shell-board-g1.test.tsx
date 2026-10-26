// A-16 board round G1 (Shell1440 / Shell390* / Welcome390 / Shell390ComingSoon / HelpMcp1440 /
// Hub boards; Task B's ShellTopBar, NavRail and MoreSheet patterns). Locks the layout decisions
// that the side-by-side review fixed, so a later edit cannot quietly undo them:
// - the app bar is one 64 px row at every width (no wrapping second row for the county chip);
// - the Apps menu (grid icon, from 600 px) switches apps: CountyLens current, Roofing CRM linked
//   only from an https crmUrl, otherwise "Coming soon · Not deployed yet";
// - Explore's modes (Filters, AI) sit nested under Explore in the rail, on Explore only (Builder is
//   a Coming soon item of the More sheet, PO 2026-10-26);
// - the More sheet groups the pages in one card, the planned items with a tonal "Coming soon"
//   pill, then Apps;
// - another county's URL names the county in a centred dialog-style card;
// - Help · MCP shows the client's file name with Copy, and search_properties' example request.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PAGE_TEXTS } from "@countylens/shared";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../src/App";

const css = (file: string): string => readFileSync(join(__dirname, "..", "src", file), "utf8");

function stubFetch(links: string | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/site-links.json" && links !== null) return new Response(links);
      return new Response("not found", { status: 404 });
    }),
  );
}

async function renderAt(path: string): Promise<void> {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole("navigation", { name: "Primary" }, { timeout: 20_000 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("G1 · app bar (Shell1440, Welcome390)", () => {
  it("is one row at every width: no flex-wrap, the chip collapses to a 48 px pin below 600 px", () => {
    const shell = css("components/AppShell.module.css");
    expect(shell).not.toMatch(/\.bar \{[^}]*flex-wrap:\s*wrap/);
    expect(shell).not.toMatch(/flex-basis:\s*100%/);
    expect(shell).toMatch(/border-bottom: 1px solid var\(--md-sys-color-outline-variant\)/);
    const chip = css("components/CountySelect.module.css");
    // Compact: the select is laid transparently over the 48 px pin.
    expect(chip).toMatch(/\.select \{[^}]*position: absolute;[^}]*opacity: 0;/s);
    expect(chip).toMatch(
      /\.chip \{[^}]*min-width: var\(--space-9\);[^}]*min-height: var\(--space-9\);/s,
    );
    // From 600 px: the outlined, corner-small chip with the caret.
    expect(chip).toMatch(
      /@media \(min-width: 600px\)[\s\S]*\.chip \{[^}]*border: 1px solid var\(--md-sys-color-outline-variant\);[^}]*border-radius: var\(--md-sys-shape-corner-small\);/,
    );
  });

  it("has no Other counties link in the bar; the More sheet lists it (PO 2026-10-26)", async () => {
    stubFetch(null);
    await renderAt("/tx/travis/explore");
    const bar = screen.getAllByRole("banner")[0] as HTMLElement;
    expect(bar.querySelector('a[href="/soon/other-counties"]')).toBeNull();
    expect(bar.textContent).not.toContain("Other counties");
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", {
        name: "More",
      }),
    );
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(
      within(sheet)
        .getByRole("link", { name: /Other counties and states/ })
        .getAttribute("href"),
    ).toBe("/soon/other-counties");
  });

  it("Apps lists CountyLens (current) and Roofing CRM as not deployed without a crmUrl", async () => {
    stubFetch(JSON.stringify({ crmUrl: "" }));
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    const apps = within(bar).getByRole("button", { name: "Apps" });
    expect(apps.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(apps);
    const menu = within(bar).getByRole("menu", { name: "Apps" });
    const current = within(menu).getByRole("menuitem", { name: /CountyLens/ });
    expect(current.getAttribute("href")).toBe("/");
    expect(current.getAttribute("aria-current")).toBe("page");
    await waitFor(() =>
      expect(menu.textContent).toContain(`Roofing CRM${PAGE_TEXTS.comingSoonNotDeployed}`),
    );
    expect(within(menu).queryByRole("link", { name: /Roofing CRM/ })).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(within(bar).queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(apps);
    // Apps from 600 px only (the More sheet carries the rows below it, as in Task B).
    expect(css("components/AppShell.module.css")).toMatch(/\.apps \{\s*display: none;/);
  });

  it("Apps links Roofing CRM when crmUrl is https", async () => {
    stubFetch(JSON.stringify({ crmUrl: "https://crm.example.invalid/" }));
    await renderAt("/runs");
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Apps" }));
    const crm = await screen.findByRole("menuitem", { name: "Roofing CRM" });
    expect(crm.getAttribute("href")).toBe("https://crm.example.invalid/");
  });
});

describe("G1 · rail (Shell1440; Task B CrmShell1440)", () => {
  it("nests Filters and AI under Explore on Explore only, the current mode marked", async () => {
    stubFetch(null);
    await renderAt("/tx/travis/explore?mode=ai");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const nested = [...nav.querySelectorAll<HTMLAnchorElement>("a[data-nested]")];
    expect(nested.map((a) => a.lastElementChild?.textContent)).toEqual(["Filters", "AI"]);
    expect(nested.map((a) => a.getAttribute("href"))).toEqual([
      "/tx/travis/explore",
      "/tx/travis/explore?mode=ai",
    ]);
    expect(nested[1]?.getAttribute("aria-current")).toBe("page");
    expect(nested[0]?.getAttribute("aria-current")).toBeNull();
    cleanup();
    await renderAt("/runs");
    expect(
      screen.getByRole("navigation", { name: "Primary" }).querySelector("a[data-nested]"),
    ).toBeNull();
    // Hidden in the bottom navigation; a smaller pill in the rail.
    const shell = css("components/AppShell.module.css");
    expect(shell).toMatch(/\.nav \.itemNested \{\s*display: none;/);
    expect(shell).toMatch(
      /\.itemNested \.pill \{\s*width: var\(--space-9\);\s*height: var\(--space-6\);/,
    );
  });
});

describe("G1 · More sheet (Shell390More; Task B MoreSheet)", () => {
  it("compact pages in one card, then Planned with tonal Coming soon pills, then Apps", async () => {
    stubFetch(null);
    await renderAt("/runs");
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", {
        name: "More",
      }),
    );
    const sheet = screen.getByRole("dialog", { name: "More" });
    const lists = [...sheet.querySelectorAll("ul")].map((ul) => ul.getAttribute("aria-label"));
    expect(lists).toEqual(["Pages", "Planned", "Apps"]);
    // PO 2026-10-26: "What can I ask?" lives in the header help menu, not the sheet.
    expect(within(sheet).queryByRole("link", { name: "What can I ask?" })).toBeNull();
    const shell = css("components/AppShell.module.css");
    expect(shell).toMatch(/\.soon \{[^}]*background: var\(--status-unavailable-container\);/s);
    expect(shell).toMatch(
      /\.sheetCard \{[^}]*border: 1px solid var\(--md-sys-color-outline-variant\);/s,
    );
    // The side sheet's single column never grows past the sheet (no clipped pills).
    expect(shell).toMatch(/\.sheet \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});

describe("G1 · other county (Shell390ComingSoon)", () => {
  it("names the county from the URL in a centred card and keeps the Travis-only line", async () => {
    const { Component } = await import("../src/routes/ComingSoon");
    const { Route, Routes } = await import("react-router");
    render(
      <MemoryRouter initialEntries={["/tx/williamson/explore"]}>
        <Routes>
          <Route path="/tx/:county/*" element={<Component />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Williamson County, TX is coming soon",
    );
    expect(document.querySelector("[data-county-message]")?.textContent).toBe(
      PAGE_TEXTS.travisOnly,
    );
    expect(screen.getByRole("link", { name: "Stay on Travis County" }).getAttribute("href")).toBe(
      "/tx/travis/explore",
    );
    expect(css("routes/ComingSoon.module.css")).toMatch(
      /\.countyPage \{\s*display: grid;\s*place-items: center;\s*min-height: 100%;/,
    );
  });
});

describe("G1 · Help · MCP (HelpMcp1440)", () => {
  it("shows the client's file name with Copy and search_properties' example tools/call request", async () => {
    const { Component } = await import("../src/routes/HelpMcp");
    render(
      <MemoryRouter initialEntries={["/help/mcp"]}>
        <Component />
      </MemoryRouter>,
    );
    expect(screen.getByText("claude_desktop_config.json")).toBeDefined();
    const example = document.querySelector("[data-example-request]");
    expect(example?.closest('[data-tool="search_properties"]')).not.toBeNull();
    const request = JSON.parse(example?.textContent ?? "{}") as {
      method?: string;
      params?: { name?: string };
    };
    expect(request.method).toBe("tools/call");
    expect(request.params?.name).toBe("search_properties");
  });
});
