// Who is signed in, for display only (A-16 T042): read from the Cognito ID token payload in the
// stored session. The API (`admin.me`, `adminProcedure`) is what decides admin rights; this only
// words the page. A token this cannot read gives nulls, never an invented name or role.
import type { Session } from "./session";

export interface SessionIdentity {
  readonly email: string | null;
  readonly username: string | null;
  readonly groups: readonly string[];
}

const NOBODY: SessionIdentity = { email: null, username: null, groups: [] };

function decodePayload(jwt: string): Record<string, unknown> | undefined {
  const part = jwt.split(".")[1];
  if (part === undefined || part === "") return undefined;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

export function identityFromSession(session: Session | undefined): SessionIdentity {
  if (session === undefined) return NOBODY;
  const payload = decodePayload(session.idToken);
  if (payload === undefined) return NOBODY;
  const groups = payload["cognito:groups"];
  return {
    email: text(payload["email"]),
    username: text(payload["cognito:username"]),
    groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === "string") : [],
  };
}
