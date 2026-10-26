// A-16 port of Task B's search box: searchSuggest parsing and the combobox keyboard.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_LABEL } from "../src/components/AppShell";
import { SEARCH_BOX_LABEL, SearchBox, targetFor } from "../src/components/SearchBox";
import {
  ADDRESS_UNAVAILABLE,
  classifyQuery,
  normalisePermit,
  optionsFor,
} from "../src/components/searchSuggest";

afterEach(() => cleanup());

describe("searchSuggest", () => {
  it("classifies places, ZIPs, permits, TCAD ids and addresses", () => {
    expect(classifyQuery("  ")).toBe("empty");
    expect(classifyQuery("Pflugerville")).toBe("place");
    expect(classifyQuery("78753")).toBe("zip");
    expect(classifyQuery("zip 787")).toBe("zip");
    expect(classifyQuery("2026-121002 BP")).toBe("permit");
    expect(classifyQuery("2026-121002")).toBe("permit");
    expect(classifyQuery("138273")).toBe("tcad");
    expect(classifyQuery("101 Sample Ln")).toBe("address");
  });

  it("normalises permit numbers to the printed form", () => {
    expect(normalisePermit("2026-121002")).toBe("2026-121002 BP");
    expect(normalisePermit("2026-121002bp")).toBe("2026-121002 BP");
  });

  it("suggests gazetteer places and ZIPs, with the place as the Explore value", () => {
    const places = optionsFor("pfluger");
    expect(places[0]?.kind).toBe("place");
    expect(places[0]?.label).toMatch(/^Pflugerville/);
    expect(places.at(-1)?.kind).toBe("ask");
    const zips = optionsFor("78753");
    expect(zips).toHaveLength(1);
    expect(zips[0]).toMatchObject({ kind: "zip", label: "78753", place: "78753" });
    expect(optionsFor("787").every((o) => o.kind === "zip" && o.label.startsWith("787"))).toBe(
      true,
    );
  });

  it("hands permit and TCAD lookups to the AI tab and disables street addresses", () => {
    expect(optionsFor("2026-121002")[0]?.question).toContain("2026-121002 BP");
    expect(optionsFor("138273")[0]).toMatchObject({ kind: "tcad" });
    const address = optionsFor("101 Sample Ln")[0];
    expect(address).toMatchObject({ disabled: true, detail: ADDRESS_UNAVAILABLE });
  });

  it("targets Explore with place= (dropping at/sel) or the AI tab with q=", () => {
    const [zip] = optionsFor("78753");
    const [tcad] = optionsFor("138273");
    if (zip === undefined || tcad === undefined) throw new Error("options");
    const url = new URL("https://x/tx/travis/explore?at=1,2&sel=c&r=3");
    const target = targetFor(zip, url) ?? "";
    expect(target).toContain("place=78753");
    expect(target).toContain("r=3");
    expect(target).not.toMatch(/[?&](at|sel)=/);
    expect(targetFor(tcad, url)).toMatch(/mode=ai&q=/);
    // A new place starts the AI tab afresh: the last question does not survive the search.
    const asked = new URL("https://x/tx/travis/explore?mode=ai&q=old%20question&place=Austin&r=5");
    const next = targetFor(zip, asked) ?? "";
    expect(next).toContain("place=78753");
    expect(next).not.toMatch(/[?&](q|mode)=/);
  });
});

function Where(): React.ReactElement {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderBox(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <SearchBox />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SearchBox combobox", () => {
  it("shares the header's accessible name", () => {
    expect(SEARCH_LABEL).toBe(SEARCH_BOX_LABEL);
  });

  it("moves through options with the arrows and picks with Enter", () => {
    renderBox();
    const box = screen.getByRole("combobox", { name: SEARCH_BOX_LABEL });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "787" } });
    expect(box.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const active = box.getAttribute("aria-activedescendant");
    const second = screen.getAllByRole("option")[1];
    expect(active).toBe(second?.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("where").textContent).toContain(
      `place=${second?.textContent?.slice(0, 5)}`,
    );
  });

  it("closes with Escape, then clears", () => {
    renderBox();
    const box = screen.getByRole("combobox", { name: SEARCH_BOX_LABEL });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Austin" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLInputElement).value).toBe("");
  });
});
