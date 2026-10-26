// The router's error page (2026-10-26): a tab opened before a release asked for a page file the
// new deploy had removed and showed React Router's developer screen. Now a stale page file reloads
// once, and any route error shows RouteError.
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteError, isStaleBuildError, reloadForNewBuild } from "../src/components/RouteError";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("isStaleBuildError", () => {
  it("recognises the browsers' wording for a removed page file", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://countylens.aldarraj.com/assets/Coverage-w_DjXj0Z.js",
      "Importing a module script failed.",
      "error loading dynamically imported module",
    ]) {
      expect(isStaleBuildError(new TypeError(message)), message).toBe(true);
    }
    expect(isStaleBuildError(new Error("boom"))).toBe(false);
  });
});

describe("reloadForNewBuild", () => {
  it("reloads once, then not again within the window", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(reloadForNewBuild()).toBe(true);
    expect(reloadForNewBuild()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("RouteError", () => {
  it("shows plain words with Reload and the Hub link, never the developer screen", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          ErrorBoundary: RouteError,
          loader: () => {
            throw new Error("boom");
          },
          Component: () => null,
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reload" }).getAttribute("href")).toBe(
      window.location.href,
    );
    expect(screen.getByRole("link", { name: "Back to the Hub" }).getAttribute("href")).toBe("/");
    expect(document.body.textContent).not.toContain("Hey developer");
  });
});
