// The router's error page (2026-10-26): never React Router's developer screen. A page file that a
// newer deploy replaced ("Failed to fetch dynamically imported module", an open tab after a
// release) reloads the page once to pick up the new build; anything else says so in plain words
// with Reload and a way back to the Hub. Render-only apart from that one reload.
import { ROUTES } from "@countylens/shared/routes";
import { useEffect, type ReactElement } from "react";
import { Link, useRouteError } from "react-router";
import styles from "../routes/ComingSoon.module.css";

const RELOADED_KEY = "countylens.reloadedForNewBuild";
/** At most one automatic reload per this many milliseconds, so a real outage cannot loop. */
const RELOAD_WINDOW_MS = 60_000;

/** The browser's wording for a lazy page file that is no longer on the server (Chrome, Safari, Firefox). */
export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

/** Reloads once per window to load the new build; false when it already did recently. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? "0");
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    // Storage blocked: reload anyway; the browser's own reload limits apply.
  }
  window.location.reload();
  return true;
}

export function RouteError(): ReactElement {
  const error = useRouteError();
  const stale = isStaleBuildError(error);
  useEffect(() => {
    if (stale) reloadForNewBuild();
  }, [stale]);
  return (
    <section aria-label="Error" data-route="error" className={styles.page}>
      <h2 className={styles.title}>
        {stale ? "A new version of CountyLens is available" : "Something went wrong"}
      </h2>
      <p className={styles.sentence}>
        {stale
          ? "This page was opened before the latest release. Reload to load the new version."
          : "This page could not be shown. Reload to try again, or go back to the Hub."}
      </p>
      {/* A plain link to this address: following it is a full page load, i.e. a reload. */}
      <a href={window.location.href} className={styles.link}>
        Reload
      </a>
      <Link to={ROUTES.hub} className={styles.link}>
        Back to the Hub
      </Link>
    </section>
  );
}
