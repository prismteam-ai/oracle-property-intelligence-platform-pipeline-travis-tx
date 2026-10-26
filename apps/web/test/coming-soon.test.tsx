// A-13 T041 (G3): Coming soon (US10, AC-13, FR-013; TC-060…TC-070) and ComingSoonSkeleton.
import { PAGE_TEXTS } from "@countylens/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ComingSoonSkeleton } from "../src/components/ComingSoonSkeleton";
import { COMING_SOON_ITEMS } from "../src/content/coming-soon";

const skeletonCss = (): string =>
  readFileSync(join(__dirname, "../src/components/ComingSoonSkeleton.module.css"), "utf8");

afterEach(cleanup);

async function renderItem(item: string): Promise<HTMLElement> {
  const { Component } = await import("../src/routes/ComingSoon");
  render(
    <MemoryRouter initialEntries={[`/soon/${item}`]}>
      <Routes>
        <Route path="/soon/:item" element={<Component />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole("region");
}

describe("ComingSoonSkeleton", () => {
  for (const layout of ["list", "map", "chart", "form"] as const) {
    it(`${layout}: aria-hidden, no text node, no table or row, no progress or busy state`, () => {
      const { container } = render(<ComingSoonSkeleton layout={layout} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.getAttribute("aria-hidden")).toBe("true");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      expect(walker.nextNode()).toBeNull();
      expect(
        root.querySelector("table, [role=row], [role=progressbar], [aria-busy], ul, ol"),
      ).toBeNull();
      expect(root.querySelectorAll("div, span").length).toBeGreaterThan(0);
    });
  }

  it("styles are static: no animation, transition or keyframes; blocks use surface-container-highest", () => {
    expect(skeletonCss()).not.toMatch(/animation|transition|@keyframes/);
    expect(skeletonCss()).toMatch(/--md-sys-color-surface-container-highest/);
    expect(skeletonCss()).toMatch(/height:/);
  });
});

describe("ComingSoon route", () => {
  for (const item of COMING_SOON_ITEMS.filter((i) => i.linked)) {
    it(`${item.id}: heading, label, exactly one sentence, a skeleton outside the text`, async () => {
      const page = await renderItem(item.id);
      expect(page.getAttribute("data-route")).toBe("coming-soon");
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(item.title);
      expect(screen.getByText(PAGE_TEXTS.comingSoon)).toBeTruthy();
      expect(screen.getByText(item.sentence)).toBeTruthy();
      const skeleton = page.querySelector("[aria-hidden=true][data-skeleton]");
      expect(skeleton).not.toBeNull();
      expect(skeleton?.textContent).toBe("");
    });
  }

  it("AI-user sign-in is not linked anywhere: its id has no page", async () => {
    const page = await renderItem("ai-user-sign-in");
    expect(page.getAttribute("data-state")).toBe("not-found");
    expect(page.querySelector("[data-skeleton]")).toBeNull();
  });

  it("an unknown item is not found, with a link back to the Hub", async () => {
    const page = await renderItem("nope");
    expect(page.getAttribute("data-state")).toBe("not-found");
    expect(page.querySelector("a")?.getAttribute("href")).toBe("/");
  });
});
