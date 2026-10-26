// A-13 T036 (G3): Legal pages (US8, AC-11, FR-011; TC-055, TC-056). Static text: facts with links,
// no legal advice, no data request.
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_RULES, ACCESS_RULES_HEADING, LEGAL_SOURCES } from "../src/content/legal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPage(file: "LegalData" | "LegalPrivacy" | "LegalTerms", name: string) {
  const mod = (await import(`../src/routes/${file}.tsx`)) as {
    Component: () => React.ReactElement;
  };
  render(
    <MemoryRouter>
      <mod.Component />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name });
}

describe("content/legal.ts", () => {
  it("has the eight sources, each with an https terms link, a status and an access date", () => {
    expect(LEGAL_SOURCES.map((s) => s.id)).toEqual([
      "tcad",
      "travis-county-gis",
      "city-of-austin",
      "austin-address-points",
      "tx-comptroller",
      "bbb",
      "overture",
      "census-gazetteer",
    ]);
    for (const source of LEGAL_SOURCES) {
      expect(source.termsUrl, source.id).toMatch(/^https:\/\//);
      expect(source.checkedStatus, source.id).toBeGreaterThanOrEqual(100);
      expect(source.checkedOn, source.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.fact.length, source.id).toBeGreaterThan(20);
    }
  });

  it("states the four access rules", () => {
    expect(ACCESS_RULES).toHaveLength(4);
    const text = ACCESS_RULES.join(" ");
    expect(text).toMatch(/public/i);
    expect(text).toMatch(/403/);
    expect(text).toMatch(/CAPTCHA/i);
    expect(text).toMatch(/Query DB/);
  });
});

describe("Legal · Data sources", () => {
  it("names the eight sources with a terms link each, and the four rules", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const page = await renderPage("LegalData", "Legal · Data sources");
    expect(page.getAttribute("data-route")).toBe("legal-data");
    const list = within(page).getByRole("list", { name: "Data sources" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    LEGAL_SOURCES.forEach((source, i) => {
      const item = items[i] as HTMLElement;
      expect(item.textContent).toContain(source.name);
      const link = within(item).getByRole("link");
      expect(link.getAttribute("href")).toBe(source.termsUrl);
    });
    const rules = within(page).getByRole("list", { name: ACCESS_RULES_HEADING });
    expect(
      within(rules)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([...ACCESS_RULES]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says BBB answered with a 403 challenge and is not harvested around", async () => {
    const page = await renderPage("LegalData", "Legal · Data sources");
    const bbb = LEGAL_SOURCES.find((s) => s.id === "bbb");
    expect(bbb?.fact).toMatch(/403/);
    expect(page.textContent).toContain(bbb?.fact ?? "");
  });

  it("gives no legal advice", async () => {
    const page = await renderPage("LegalData", "Legal · Data sources");
    expect(page.textContent).toMatch(/not legal advice/i);
  });
});

describe("Legal · Privacy and Terms", () => {
  for (const [file, name, route] of [
    ["LegalPrivacy", "Legal · Privacy", "legal-privacy"],
    ["LegalTerms", "Legal · Terms", "legal-terms"],
  ] as const) {
    it(`${name}: heading, static text, a link to /legal/data, no data request`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const page = await renderPage(file, name);
      expect(page.getAttribute("data-route")).toBe(route);
      expect(within(page).getByRole("heading", { level: 2 }).textContent).toBe(name);
      expect(
        within(page)
          .getByRole("link", { name: /Data sources/ })
          .getAttribute("href"),
      ).toBe("/legal/data");
      expect(page.querySelector("[data-cid]")).toBeNull();
      expect(page.textContent).not.toMatch(/\d/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});
