// React hooks over the admin calls (A-16 T043/T044). `useAdminAccess` asks the API who the session
// is (`admin.me`, the authority) and exposes one of: signed-out (no stored session; nothing is
// requested), checking, admin, not-admin, expired (the API said 401) or unavailable. A signed-out
// visitor never triggers a request, so the public Runs page costs nothing extra.
// `useLiveRun` polls `admin.runs.live` (response max-age 5 s on the API) while the page is open.
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi, type AdminLive, type AdminMe } from "./admin-api";
import { identityFromSession, type SessionIdentity } from "./identity";
import { loadSession } from "./session";

export type AdminAccess =
  | { readonly kind: "signed-out" }
  | { readonly kind: "checking"; readonly identity: SessionIdentity }
  | { readonly kind: "admin"; readonly identity: SessionIdentity; readonly me: AdminMe }
  | { readonly kind: "not-admin"; readonly identity: SessionIdentity }
  | { readonly kind: "expired" }
  | { readonly kind: "unavailable"; readonly identity: SessionIdentity };

export function useAdminAccess(): AdminAccess {
  const [access, setAccess] = useState<AdminAccess>(() => {
    const session = loadSession();
    return session === undefined
      ? { kind: "signed-out" }
      : { kind: "checking", identity: identityFromSession(session) };
  });
  useEffect(() => {
    const session = loadSession();
    if (session === undefined) return undefined;
    const identity = identityFromSession(session);
    let live = true;
    adminApi.me().then(
      (me) => {
        if (live)
          setAccess(me.isAdmin ? { kind: "admin", identity, me } : { kind: "not-admin", identity });
      },
      (error: unknown) => {
        if (!live) return;
        const code = error instanceof AdminApiError ? error.code : "UNAVAILABLE";
        if (code === "UNAUTHORIZED") setAccess({ kind: "expired" });
        else if (code === "FORBIDDEN") setAccess({ kind: "not-admin", identity });
        else setAccess({ kind: "unavailable", identity });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return access;
}

export type LiveState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly live: AdminLive }
  /** The API answered NOT_FOUND: the bridge has never written its status object. */
  | { readonly kind: "never-seen" }
  | { readonly kind: "unavailable" };

export const LIVE_POLL_MS = 5000;

export function useLiveRun(enabled: boolean): { state: LiveState; refresh: () => void } {
  const [state, setState] = useState<LiveState>({ kind: "loading" });
  const alive = useRef(true);
  const refresh = useCallback(() => {
    adminApi.live().then(
      (live) => {
        if (alive.current) setState({ kind: "ready", live });
      },
      (error: unknown) => {
        if (!alive.current) return;
        const notFound = error instanceof AdminApiError && error.code === "NOT_FOUND";
        setState({ kind: notFound ? "never-seen" : "unavailable" });
      },
    );
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!enabled) return undefined;
    refresh();
    const timer = setInterval(refresh, LIVE_POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [enabled, refresh]);
  return { state, refresh };
}
