// A-13 T041 (G3): the county selector in the shell's location slot (US10, AC-13, FR-013; TC-061,
// TC-071). Travis is the active county; any other choice shows the Travis-only text and changes
// nothing.
import { PAGE_TEXTS, ROUTES } from "@countylens/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../src/App";
import { CountySelect } from "../src/components/CountySelect";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("CountySelect", () => {
  it("lists Travis County, TX as the selected county", () => {
    render(
      <MemoryRouter>
        <CountySelect />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox", { name: "County" }) as HTMLSelectElement;
    expect(select.value).toBe("travis");
    expect(select.selectedOptions[0]?.textContent).toBe("Travis County, TX");
  });

  it("choosing another county shows the Travis-only text and keeps Travis active", () => {
    render(
      <MemoryRouter>
        <CountySelect />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox", { name: "County" }) as HTMLSelectElement;
    expect(screen.queryByText(PAGE_TEXTS.travisOnly)).toBeNull();
    fireEvent.change(select, { target: { value: "harris" } });
    expect(screen.getByRole("status").textContent).toBe(PAGE_TEXTS.travisOnly);
    expect(select.value).toBe("travis");
  });

  it("has no Other counties link next to the chip (Shell boards; PO 2026-10-26: it is in More)", () => {
    render(
      <MemoryRouter>
        <CountySelect />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("shell location slot", () => {
  async function renderAt(path: string): Promise<void> {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("navigation", { name: "Primary" }, { timeout: 20_000 });
  }

  it("is the app bar's location chip under /tx/ and absent elsewhere (Shell boards, A-16)", async () => {
    await renderAt("/runs");
    expect(screen.queryByRole("combobox", { name: "County" })).toBeNull();
    cleanup();
    await renderAt("/tx/harris/explore");
    const select = await screen.findByRole("combobox", { name: "County" });
    expect(screen.getByRole("banner").contains(select)).toBe(true);
    expect(screen.getByRole("main").querySelector("select[data-county-picker]")).toBeNull();
  });

  it("/tx/{other}/… renders the Travis-only text with a link to Explore", async () => {
    await renderAt("/tx/harris/explore");
    const page = await screen.findByRole("region", { name: "Other county" }, { timeout: 20_000 });
    await waitFor(() => expect(page.textContent).toContain(PAGE_TEXTS.travisOnly));
    const link = page.querySelector("a");
    expect(link?.getAttribute("href")).toBe(ROUTES.explore);
    expect(page.querySelector("[data-cid], table")).toBeNull();
    expect(page.textContent).not.toMatch(/\d/);
  });
});
