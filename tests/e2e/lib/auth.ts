// Admin sign-in for the hosted Playwright specs (A-16 T039; copied in spirit from Task B's
// tests/e2e/lib/auth.ts). The test users' credentials come from `~/.config/assessment/
// countylens-test.env` (or the process environment) and are never committed, printed or attached:
//   COUNTYLENS_TEST_USERNAME / COUNTYLENS_TEST_PASSWORD                  an admin (group `admin`)
//   COUNTYLENS_TEST_NONADMIN_USERNAME / COUNTYLENS_TEST_NONADMIN_PASSWORD  a signed-in non-admin
// When they are unset, a spec skips with a stated reason; a skipped case is never counted as
// passed. The web app keeps its whole Cognito session in localStorage `countylens.session`
// (apps/web/src/auth/session.ts), origin-scoped and independent of the viewport, so one saved
// storageState serves the 390, 768 and 1440 runs. The state file holds live tokens: it lives under
// `test-results/` (gitignored), is never attached to a report and is never uploaded.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { e2eRoot, repoRoot } from "./runtime.js";
import { stepSlug } from "./evidence.js";

export const TEST_ENV_FILE = resolve(homedir(), ".config", "assessment", "countylens-test.env");
export const SESSION_STORAGE_KEY = "countylens.session";

/** Saved signed-in states, under the gitignored test-results/ folder. */
export const ADMIN_STATE_PATH = resolve(e2eRoot, "test-results", ".auth", "admin.json");
export const NONADMIN_STATE_PATH = resolve(e2eRoot, "test-results", ".auth", "nonadmin.json");

export const NO_ADMIN_CREDENTIALS_REASON =
  "COUNTYLENS_TEST_USERNAME / COUNTYLENS_TEST_PASSWORD not set (~/.config/assessment/countylens-test.env)";
export const NO_NONADMIN_CREDENTIALS_REASON =
  "COUNTYLENS_TEST_NONADMIN_USERNAME / COUNTYLENS_TEST_NONADMIN_PASSWORD not set (~/.config/assessment/countylens-test.env)";

/** `KEY=value` lines (an `export ` prefix and one pair of quotes are tolerated); `#` starts a comment. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match === null) continue;
    let value = (match[2] ?? "").trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1] ?? ""] = value;
  }
  return out;
}

function fileEnv(path: string = TEST_ENV_FILE): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

export interface Credentials {
  readonly username: string;
  readonly password: string;
}

function pick(
  env: Record<string, string | undefined>,
  userKey: string,
  passKey: string,
): Credentials | undefined {
  const username = env[userKey]?.trim();
  const password = env[passKey];
  return username === undefined || username === "" || password === undefined || password === ""
    ? undefined
    : { username, password };
}

/** The process environment wins over the file. */
export function readCredentials(
  env: Record<string, string | undefined> = { ...fileEnv(), ...process.env },
): { admin: Credentials | undefined; nonAdmin: Credentials | undefined } {
  return {
    admin: pick(env, "COUNTYLENS_TEST_USERNAME", "COUNTYLENS_TEST_PASSWORD"),
    nonAdmin: pick(env, "COUNTYLENS_TEST_NONADMIN_USERNAME", "COUNTYLENS_TEST_NONADMIN_PASSWORD"),
  };
}

export const credentials = readCredentials();

/** The real sign-in form, waiting until Runs proves the session landed. */
export async function signInThroughForm(page: Page, creds: Credentials): Promise<void> {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Admin email").fill(creds.username);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page.locator('[data-route="runs"]')).toBeVisible({ timeout: 30_000 });
}

const signedIn = new Map<string, Promise<string>>();

/**
 * Signs in once per Playwright worker and returns the path of the saved storageState, so a spec
 * that only needs a signed-in page opens it with `browser.newContext({ storageState })`.
 */
export function savedState(
  browser: Browser,
  baseURL: string,
  creds: Credentials,
  path: string,
): Promise<string> {
  const cached = signedIn.get(path);
  if (cached !== undefined) return cached;
  const made = (async (): Promise<string> => {
    mkdirSync(dirname(path), { recursive: true });
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await signInThroughForm(page, creds);
      await context.storageState({ path });
    } finally {
      await context.close();
    }
    return path;
  })();
  signedIn.set(path, made);
  return made;
}

/** The access token of a signed-in page, for the API checks (never logged or attached). */
export async function accessTokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && "accessToken" in parsed
      ? String((parsed as { accessToken: unknown }).accessToken)
      : null;
  }, SESSION_STORAGE_KEY);
  if (token === null) throw new Error("no countylens.session in this page's localStorage");
  return token;
}

/**
 * A checkpoint screenshot saved as docs/evidence/img/A-16-TC-{nnn}-{step}.png and attached to the
 * test (the A-16 evidence naming). The page shows no token, so nothing secret is captured.
 */
export async function checkpoint(page: Page, tc: string, step: string): Promise<string> {
  const id = tc
    .trim()
    .replace(/^A-16-/i, "")
    .replace(/^TC-/i, "")
    .toUpperCase();
  const name = `A-16-TC-${id}-${stepSlug(step)}.png`;
  const dir = resolve(repoRoot, "docs", "evidence", "img");
  mkdirSync(dir, { recursive: true });
  const body = await page.screenshot({ path: resolve(dir, name) });
  await test.info().attach(name, { body, contentType: "image/png" });
  return `docs/evidence/img/${name}`;
}
