// A-16 T050 (shell + G2a): the rail's admin entries. Signed out: "Admin" → /admin/sign-in, no
// admin.me request, no admin chip. Signed in as an admin (admin.me says so): "Activity" →
// /activity and the "Admin" chip (title "Signed in as admin"). Signed in but not an admin: the
// sign-in entry stays and no chip shows.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../src/App";
import { SESSION_STORAGE_KEY, clearSession, saveSession } from "../src/auth/session";
import { hasStoredSession } from "../src/components/AdminNav";

const me = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock("../src/auth/admin-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/auth/admin-api")>();
  return { ...original, adminApi: { ...original.adminApi, me } };
});

const b64 = (value: object): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object): string => `${b64({ alg: "none" })}.${b64(payload)}.sig`;

function sign(groups: string[]): void {
  saveSession({
    idToken: jwt({ email: "a@example.test", "cognito:groups": groups, "cognito:username": "u1" }),
    accessToken: "access-token-fixture",
    refreshToken: "refresh-fixture",
    expiresAt: Date.now() + 3_600_000,
  });
}

async function renderAt(path: string): Promise<HTMLElement> {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
  return screen.findByRole("navigation", { name: "Primary" }, { timeout: 20_000 });
}

beforeEach(() => {
  me.mockReset();
  clearSession();
});
afterEach(() => {
  cleanup();
  clearSession();
});

describe("shell admin entries", () => {
  it("reads the same storage key as auth/session without importing it", () => {
    expect(hasStoredSession()).toBe(false);
    sign(["admin"]);
    expect(hasStoredSession()).toBe(true);
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("signed out: Admin links to sign-in, no request, no chip", async () => {
    const nav = await renderAt("/runs");
    const admin = within(nav).getByRole("link", { name: /Admin/ });
    expect(admin.getAttribute("href")).toBe("/admin/sign-in");
    expect(me).not.toHaveBeenCalled();
    expect(document.querySelector("[data-admin-chip]")).toBeNull();
    expect(within(nav).queryByRole("link", { name: /Activity/ })).toBeNull();
  });

  it("signed in as an admin: Activity and the Admin chip", async () => {
    sign(["admin"]);
    me.mockResolvedValue({ email: "a@example.test", groups: ["admin"], isAdmin: true });
    // A page that makes no admin call itself, so the count is the shell's own.
    const nav = await renderAt("/legal/terms");
    await waitFor(() =>
      expect(
        within(nav)
          .getByRole("link", { name: /Activity/ })
          .getAttribute("href"),
      ).toBe("/activity"),
    );
    const chip = document.querySelector("[data-admin-chip]");
    expect(chip?.getAttribute("title")).toBe("Signed in as admin");
    expect(screen.getByRole("banner").contains(chip)).toBe(true);
    expect(me).toHaveBeenCalledTimes(1);
  });

  it("signed in without the admin group: no chip, the sign-in entry stays", async () => {
    sign([]);
    me.mockResolvedValue({ email: "a@example.test", groups: [], isAdmin: false });
    const nav = await renderAt("/runs");
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(within(nav).getByRole("link", { name: /Admin/ }).getAttribute("href")).toBe(
      "/admin/sign-in",
    );
    expect(document.querySelector("[data-admin-chip]")).toBeNull();
  });
});
