// A-16 T042..T044 (AC-6..AC-10; TC-010, 011, 012, 014, 018, 020, 021): admin sign-in, the Runs
// admin controls and their live states, and Activity. The Cognito client and the admin API are
// mocked at their module boundary; no network, no AWS. Tokens in these tests are fixtures.
import type { AdminLive } from "../src/auth/admin-api";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_TEXTS, SignInError, classifySignInError } from "../src/auth/signIn";
import { SESSION_STORAGE_KEY, loadSession, saveSession } from "../src/auth/session";
import { identityFromSession } from "../src/auth/identity";
import { loadCognitoWebConfig } from "../src/auth/config";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn<(u: string, p: string) => Promise<unknown>>(),
  me: vi.fn<() => Promise<unknown>>(),
  live: vi.fn<() => Promise<unknown>>(),
  start: vi.fn<(mode: string) => Promise<unknown>>(),
  stop: vi.fn<(id?: string) => Promise<unknown>>(),
  retry: vi.fn<(id: string, mode: string) => Promise<unknown>>(),
  activity: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../src/auth/signIn", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/auth/signIn")>();
  return { ...original, signIn: mocks.signIn };
});

vi.mock("../src/auth/admin-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/auth/admin-api")>();
  return {
    ...original,
    adminApi: {
      me: mocks.me,
      live: mocks.live,
      start: mocks.start,
      stop: mocks.stop,
      retry: mocks.retry,
      activity: mocks.activity,
    },
  };
});

const b64 = (value: object): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object): string => `${b64({ alg: "none" })}.${b64(payload)}.sig`;

function sign(groups: string[], email = "admin@example.test", expiresAt = Date.now() + 3_600_000) {
  saveSession({
    idToken: jwt({ email, "cognito:groups": groups, "cognito:username": "u1" }),
    accessToken: "access-token-fixture",
    refreshToken: "refresh-fixture",
    expiresAt,
  });
}

function Where(): null {
  const location = useLocation();
  document.body.setAttribute("data-path", location.pathname);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.removeAttribute("data-path");
});

describe("sign-in errors are typed, fixed wording", () => {
  it("wrong password never says which of email or password was wrong", () => {
    const out = classifySignInError(
      Object.assign(new Error("Incorrect username or password."), {
        code: "NotAuthorizedException",
      }),
    );
    expect(out).toEqual({ kind: "invalid-credentials", message: SIGN_IN_TEXTS.invalid });
    // Names both fields, so it cannot reveal which one was wrong; no Cognito wording leaks.
    expect(out.message).not.toMatch(/incorrect|not found|no such|exist/i);
    const unknownUser = classifySignInError(
      Object.assign(new Error("User does not exist."), { code: "UserNotFoundException" }),
    );
    expect(unknownUser.message).toBe(out.message);
  });

  it("rate and limit errors read 'Sign-in is not available right now, try later'", () => {
    for (const code of ["TooManyRequestsException", "LimitExceededException"]) {
      const out = classifySignInError(Object.assign(new Error("x"), { code }));
      expect(out.kind).toBe("unavailable");
      expect(out.message).toBe("Sign-in is not available right now, try later");
    }
  });

  it("a network failure and a missing build configuration are 'not available' too", () => {
    expect(classifySignInError(new TypeError("Failed to fetch")).kind).toBe("unavailable");
    expect(() => loadCognitoWebConfig({})).toThrow(/Cognito web config missing/);
  });

  it("Cognito's own lockout reads as the lockout message", () => {
    const out = classifySignInError(
      Object.assign(new Error("Password attempts exceeded"), { code: "NotAuthorizedException" }),
    );
    expect(out.kind).toBe("locked");
  });
});

describe("session storage", () => {
  it("round-trips, and drops an expired session", () => {
    sign(["admin"]);
    expect(loadSession()?.accessToken).toBe("access-token-fixture");
    expect(identityFromSession(loadSession())).toMatchObject({
      email: "admin@example.test",
      groups: ["admin"],
    });
    sign(["admin"], "a@b.test", Date.now() - 1000);
    expect(loadSession()).toBeUndefined();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("an unreadable token gives nobody, never an invented name", () => {
    saveSession({
      idToken: "not-a-jwt",
      accessToken: "a",
      refreshToken: "",
      expiresAt: Date.now() + 1000,
    });
    expect(identityFromSession(loadSession())).toEqual({ email: null, username: null, groups: [] });
  });
});

async function renderSignIn(): Promise<void> {
  const { Component } = await import("../src/routes/AdminSignIn");
  render(
    <MemoryRouter initialEntries={["/admin/sign-in"]}>
      <Where />
      <Routes>
        <Route path="/admin/sign-in" element={<Component />} />
        <Route path="/runs" element={<p>Runs page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminSignIn (TC-010, TC-011, TC-012)", () => {
  it("shows the email and password fields and a Sign in button", async () => {
    await renderSignIn();
    expect(screen.getByLabelText("Admin email")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Admin sign-in" })).toBeDefined();
  });

  it("empty fields show a field error and do not navigate or call Cognito", async () => {
    await renderSignIn();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(SIGN_IN_TEXTS.emailRequired)).toBeDefined();
    expect(screen.getByText(SIGN_IN_TEXTS.passwordRequired)).toBeDefined();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(document.body.getAttribute("data-path")).toBe("/admin/sign-in");
  });

  it("a wrong password shows the refusal and stays on the page", async () => {
    mocks.signIn.mockRejectedValue(new SignInError("invalid-credentials"));
    await renderSignIn();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: "a@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password-A16" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(SIGN_IN_TEXTS.invalid);
    expect(document.body.getAttribute("data-path")).toBe("/admin/sign-in");
    expect(loadSession()).toBeUndefined();
  });

  it("Cognito unavailable shows the exact 'try later' sentence", async () => {
    mocks.signIn.mockRejectedValue(new SignInError("unavailable"));
    await renderSignIn();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: "a@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign-in is not available right now, try later",
    );
  });

  it("success stores the session and lands on Runs", async () => {
    mocks.signIn.mockResolvedValue({
      idToken: jwt({ email: "a@example.test", "cognito:groups": ["admin"] }),
      accessToken: "access-token-fixture",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
    });
    await renderSignIn();
    fireEvent.change(screen.getByLabelText("Admin email"), { target: { value: "a@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(document.body.getAttribute("data-path")).toBe("/runs"));
    expect(loadSession()?.accessToken).toBe("access-token-fixture");
  });
});

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const live = (over: Partial<AdminLive>): AdminLive => ({
  schema: "oracle-travis-live-run.v1",
  state: "idle",
  runId: null,
  commandId: null,
  startedAt: null,
  updatedAt: "2026-10-26T11:59:00.000Z",
  step: null,
  bridgeSeenAt: "2026-10-26T11:59:00.000Z",
  lastCommand: null,
  limitations: [],
  bridgeOnline: true,
  ...over,
});

describe("describeLive: the status line of the admin controls (AC-7, AC-9)", () => {
  it("running: 'Running · started {UTC}'", async () => {
    const { describeLive } = await import("../src/routes/RunsAdmin");
    const banner = describeLive(
      live({ state: "running", startedAt: "2026-10-26T11:30:00.000Z", step: "gate" }),
      undefined,
      NOW,
    );
    expect(banner).toMatchObject({
      kind: "running",
      text: "Running · started 2026-10-26 11:30:00 UTC",
    });
  });

  it("a command the bridge never picked up is queued, then 'Bridge offline · command expired at {time}'", async () => {
    const { describeLive } = await import("../src/routes/RunsAdmin");
    const sent = { commandId: "c1", expiresAt: "2026-10-26T12:10:00.000Z" };
    expect(describeLive(live({ bridgeOnline: false }), sent, NOW).kind).toBe("queued");
    const later = Date.parse("2026-10-26T12:10:01.000Z");
    expect(describeLive(live({ bridgeOnline: false }), sent, later)).toEqual({
      kind: "offline-expired",
      text: "Bridge offline · command expired at 2026-10-26 12:10:00 UTC",
    });
  });

  it("a rejected second Start says 'A run is already running'", async () => {
    const { describeLive } = await import("../src/routes/RunsAdmin");
    const banner = describeLive(
      live({
        lastCommand: {
          commandId: "11111111-1111-4111-8111-111111111111",
          outcome: "rejected_active_run",
          at: "2026-10-26T11:58:00.000Z",
        },
      }),
      undefined,
      NOW,
    );
    expect(banner).toEqual({ kind: "already-running", text: "A run is already running" });
  });

  it("a stopped run carries 'stopped by admin'; a failed one names its step", async () => {
    const { describeLive } = await import("../src/routes/RunsAdmin");
    expect(
      describeLive(
        live({ state: "stopped", runId: "r4", limitations: ["stopped by admin"] }),
        undefined,
        NOW,
      ),
    ).toMatchObject({ kind: "stopped", text: "Run r4 stopped by admin" });
    expect(
      describeLive(live({ state: "failed", runId: "r4", step: "publish" }), undefined, NOW),
    ).toMatchObject({
      kind: "failed",
      text: "Run r4 failed at publish",
    });
  });

  it("nothing to say when the bridge is idle and no command is pending", async () => {
    const { describeLive } = await import("../src/routes/RunsAdmin");
    expect(describeLive(live({}), undefined, NOW)).toEqual({ kind: "none" });
  });
});

async function renderActions(
  state: ReturnType<typeof live> | "unavailable",
): Promise<{ refresh: ReturnType<typeof vi.fn> }> {
  const { AdminActions } = await import("../src/routes/RunsAdmin");
  const refresh = vi.fn();
  render(
    <MemoryRouter>
      <AdminActions
        access={{
          kind: "admin",
          identity: { email: "admin@example.test", username: "u1", groups: ["admin"] },
          me: { email: "admin@example.test", groups: ["admin"], isAdmin: true },
        }}
        liveState={
          state === "unavailable" ? { kind: "unavailable" } : { kind: "ready", live: state }
        }
        refresh={refresh}
      />
    </MemoryRouter>,
  );
  return { refresh };
}

describe("AdminActions (TC-010, TC-013, TC-014)", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("asks before a real publish and sends nothing when the admin cancels", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.start.mockClear();
    await renderActions(live({ state: "idle" }));
    fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("shows 'Signed in as admin' and Start, Stop, Retry", async () => {
    await renderActions(live({}));
    expect(screen.getByText("Signed in as admin")).toBeDefined();
    expect(screen.getByRole("button", { name: /start run/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /stop run/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /^retry$/i }).hasAttribute("disabled")).toBe(true);
  });

  it("Start sends a publish command and shows it queued with its command ID", async () => {
    mocks.start.mockResolvedValue({
      commandId: "cmd-1",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    const { refresh } = await renderActions(live({}));
    fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    await screen.findByText(/cmd-1/);
    expect(mocks.start).toHaveBeenCalledWith("publish");
    expect(refresh).toHaveBeenCalled();
  });

  it("the dry-run box sends mode dry_run", async () => {
    mocks.start.mockResolvedValue({
      commandId: "cmd-2",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    await renderActions(live({}));
    fireEvent.click(screen.getByLabelText(/dry run/i));
    fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith("dry_run"));
  });

  it("a second Start while a run is running says 'A run is already running' without queueing", async () => {
    await renderActions(live({ state: "running", startedAt: "2026-10-26T11:30:00.000Z" }));
    fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect((await screen.findByText("A run is already running")).textContent).toBe(
      "A run is already running",
    );
    expect(mocks.start).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /stop run/i }).hasAttribute("disabled")).toBe(false);
  });

  it("the API's 409 shows the same sentence", async () => {
    const { AdminApiError } = await import("../src/auth/admin-api");
    mocks.start.mockRejectedValue(new AdminApiError("CONFLICT", "A run is already running"));
    await renderActions(live({}));
    fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    expect(await screen.findByText("A run is already running")).toBeDefined();
  });

  it("Retry is enabled after a failed run and targets that failed run, not the latest published one", async () => {
    mocks.retry.mockResolvedValue({
      commandId: "cmd-3",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    await renderActions(live({ state: "failed", runId: "run-4-failed", step: "publish" }));
    const retry = screen.getByRole("button", { name: /^retry$/i });
    expect(retry.hasAttribute("disabled")).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("run-4-failed", "publish"));
  });

  it("says why when the bridge status cannot be read", async () => {
    await renderActions("unavailable");
    expect(document.querySelector("[data-live-unavailable]")?.textContent).toMatch(/not available/);
  });
});

async function renderActivity(): Promise<void> {
  const { Component } = await import("../src/routes/Activity");
  render(
    <MemoryRouter initialEntries={["/activity"]}>
      <Where />
      <Routes>
        <Route path="/activity" element={<Component />} />
        <Route path="/admin/sign-in" element={<p>sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const CONSOLE =
  "https://eu-north-1.console.aws.amazon.com/cloudwatch/home?region=eu-north-1#logsV2:logs-insights";

describe("Activity (TC-020, TC-021)", () => {
  it("sends a signed-out visitor to the admin sign-in", async () => {
    await renderActivity();
    await waitFor(() => expect(document.body.getAttribute("data-path")).toBe("/admin/sign-in"));
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("tells a signed-in non-admin why there is nothing here", async () => {
    sign([], "user@example.test");
    mocks.me.mockResolvedValue({ email: "user@example.test", groups: [], isAdmin: false });
    await renderActivity();
    expect(await screen.findByText("This account is not an admin.")).toBeDefined();
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("shows each metric as a link to its Logs Insights query, and the query text on request", async () => {
    sign(["admin"]);
    mocks.me.mockResolvedValue({ email: "admin@example.test", groups: ["admin"], isAdmin: true });
    mocks.activity.mockResolvedValue({
      cachedAt: "2026-10-26T11:55:00.000Z",
      metrics: [
        {
          id: "questions",
          label: "Questions",
          value: 42,
          unit: null,
          query: "stats count(*) by bin(1d)",
          consoleUrl: CONSOLE,
        },
        {
          id: "p95",
          label: "p95 duration",
          value: 1240,
          unit: "ms",
          query: "stats pct(duration, 95)",
          consoleUrl: CONSOLE,
        },
        {
          id: "fail",
          label: "Failures by outcome",
          value: null,
          unit: null,
          query: "filter outcome != 'ok'",
          consoleUrl: "javascript:alert(1)",
        },
      ],
      perDay: [
        { day: "2026-10-25", questions: 30 },
        { day: "2026-10-26", questions: 12 },
      ],
    });
    await renderActivity();
    const link = await screen.findByRole("link", { name: /questions: 42/i });
    expect(link.getAttribute("href")).toBe(CONSOLE);
    expect(screen.getByRole("link", { name: /p95 duration: 1,240 ms/i })).toBeDefined();
    const failures = document.querySelector('[data-metric="fail"]') as HTMLElement;
    expect(within(failures).queryByRole("link")).toBeNull();
    expect(within(failures).getByText(/Not available · /)).toBeDefined();
    expect(screen.getByText("stats count(*) by bin(1d)")).toBeDefined();
    expect(document.querySelector("[data-cached-at]")?.textContent).toContain(
      "2026-10-26 11:55:00",
    );
    expect(document.querySelector('[data-day="2026-10-25"]')?.textContent).toContain("30");
  });

  it("an empty log says 'Not enough activity yet', not a measured zero", async () => {
    sign(["admin"]);
    mocks.me.mockResolvedValue({ email: "a@example.test", groups: ["admin"], isAdmin: true });
    mocks.activity.mockResolvedValue({
      cachedAt: "2026-10-26T11:55:00.000Z",
      metrics: [
        {
          id: "questions",
          label: "Questions",
          value: null,
          unit: null,
          query: "q",
          consoleUrl: CONSOLE,
        },
      ],
      perDay: [],
    });
    await renderActivity();
    expect(await screen.findByText("Not enough activity yet")).toBeDefined();
  });

  it("an API error shows 'The query log could not load.' with Retry, and Retry reloads", async () => {
    sign(["admin"]);
    mocks.me.mockResolvedValue({ email: "a@example.test", groups: ["admin"], isAdmin: true });
    const { AdminApiError } = await import("../src/auth/admin-api");
    mocks.activity.mockRejectedValueOnce(new AdminApiError("UNAVAILABLE", "x"));
    mocks.activity.mockResolvedValueOnce({
      cachedAt: "2026-10-26T11:55:00.000Z",
      metrics: [
        { id: "q", label: "Questions", value: 3, unit: null, query: "q", consoleUrl: CONSOLE },
      ],
      perDay: [{ day: "2026-10-26", questions: 3 }],
    });
    await renderActivity();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The query log could not load.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /questions: 3/i })).toBeDefined();
  });
});
