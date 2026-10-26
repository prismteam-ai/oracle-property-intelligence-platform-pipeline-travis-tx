// The admin session (A-16 T042): entirely Cognito plus browser storage, no CountyLens table. It
// survives a reload through localStorage under `countylens.session` (origin-scoped, so one saved
// Playwright storageState serves the three viewports). An expired session is dropped and the
// visitor is signed out, never shown a blank screen. The tokens are never logged or rendered.
import { z } from "zod";

export const SESSION_STORAGE_KEY = "countylens.session";

export const Session = z.object({
  idToken: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string(),
  /** Access-token expiry, epoch milliseconds. */
  expiresAt: z.number(),
});
export type Session = z.infer<typeof Session>;

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private window): the visitor stays signed in for this page view only.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export function loadSession(now: number = Date.now()): Session | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const parsed = Session.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;
    if (parsed.data.expiresAt <= now) {
      clearSession();
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}
