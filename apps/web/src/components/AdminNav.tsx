// The shell's admin entries (A-16 T050 with G2a; Shell1440 / RunsAdmin1440 boards). Signed out
// (or not an admin): one "Admin" item to /admin/sign-in. Signed in as an admin (the API's
// `admin.me` says so, through useAdminAccess): "Activity" (/activity) and an "Admin" chip in the
// app bar. A visitor with no stored session triggers no request and never sees admin controls.
// The chip's visible word is "Admin" (title "Signed in as admin"), so the Runs page's own
// "Signed in as admin" line stays the only element with that text.
import { ROUTES } from "@countylens/shared/routes";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link, NavLink } from "react-router";
import { Icon } from "./Icon";

/** What the shell needs to know; the full AdminAccess lives in auth/useAdmin (a lazy chunk). */
type ShellAccess = { readonly kind: "admin" } | { readonly kind: "other" };

const AccessContext = createContext<ShellAccess>({ kind: "other" });

/**
 * The session key auth/session.ts stores (SESSION_STORAGE_KEY), read here without importing that
 * module: it brings zod and the API client, which must stay out of the Hub's initial graph.
 */
const SESSION_KEY = "countylens.session";

/** True when this browser holds a stored session (no parsing; the API decides the rest). */
export function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Asks `admin.me` once per shell, and only when a session is stored: the auth modules load then,
 * never for a signed-out visitor. Key it by `hasStoredSession()` so a sign-in or sign-out asks
 * again.
 */
export function AdminAccessProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [access, setAccess] = useState<ShellAccess>({ kind: "other" });
  useEffect(() => {
    if (!hasStoredSession()) return undefined;
    let live = true;
    void import("../auth/admin-api")
      .then(async ({ adminApi }) => adminApi.me())
      .then(
        (me) => {
          if (live && me.isAdmin) setAccess({ kind: "admin" });
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, []);
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export interface AdminNavClasses {
  readonly item: string | undefined;
  readonly itemActive: string | undefined;
  readonly pill: string | undefined;
  readonly label: string | undefined;
}

/** The rail / More item: Admin (sign in) or, for an admin, Activity. */
export function AdminNavItem({ classes }: { readonly classes: AdminNavClasses }): ReactElement {
  const admin = useContext(AccessContext).kind === "admin";
  return (
    <NavLink
      to={admin ? ROUTES.activity : ROUTES.adminSignIn}
      className={({ isActive }) =>
        isActive ? `${classes.item ?? ""} ${classes.itemActive ?? ""}` : classes.item
      }
      data-admin-nav={admin ? "activity" : "sign-in"}
    >
      <span className={classes.pill}>
        {admin ? <Icon name="monitoring" /> : <Icon name="admin_panel_settings" />}
      </span>
      <span className={classes.label}>{admin ? "Activity" : "Admin"}</span>
    </NavLink>
  );
}

/** The compact More sheet row (Shell390More board: "Admin sign-in"; Activity for an admin). */
export function AdminMoreLink({
  className,
  onClick,
}: {
  readonly className: string | undefined;
  readonly onClick: () => void;
}): ReactElement {
  const admin = useContext(AccessContext).kind === "admin";
  return (
    <Link to={admin ? ROUTES.activity : ROUTES.adminSignIn} className={className} onClick={onClick}>
      {admin ? "Activity" : "Admin sign-in"}
    </Link>
  );
}

/** The app bar chip shown only to a signed-in admin. */
export function AdminChip({
  className,
}: {
  readonly className: string | undefined;
}): ReactElement | null {
  if (useContext(AccessContext).kind !== "admin") return null;
  return (
    <Link to={ROUTES.activity} className={className} title="Signed in as admin" data-admin-chip="">
      <Icon name="verified_user" size="medium" />
      <span>Admin</span>
    </Link>
  );
}
