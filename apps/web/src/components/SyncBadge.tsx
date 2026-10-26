// Header sync badge (A-16 T050; ShellStates board): the latest published run as "Run N · Mon D"
// (or "Pilot slice · Mon D"; the name from latestChip, the one numbering rule),
// read from /runs/index.json only (the Hub's light reader), linking to Runs. States from the board
// that real data can fill: loading ("Checking sync…"), populated, no runs ("No runs yet for this
// county") and unavailable ("Sync status unavailable" with Retry). Stale, partial and rate-limited
// are not shown: the index carries no sync schedule or per-source state to derive them from.
import { ROUTES } from "@countylens/shared/routes";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { HubIndexError, latestChip, loadHubRuns } from "../data/hub-index";
import { Icon } from "./Icon";
import styles from "./SyncBadge.module.css";

export const SYNC_TEXTS = Object.freeze({
  loading: "Checking sync…",
  empty: "No runs yet for this county",
  unavailable: "Sync status unavailable",
  retry: "Retry",
  run: (name: string, finishedAt: string): string =>
    `${name} · ${new Date(finishedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })}`,
});

type BadgeState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly text: string; readonly finishedAt: string }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly reason: string };

export function SyncBadge(): ReactElement {
  const [state, setState] = useState<BadgeState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadHubRuns(controller.signal).then(
      (runs) => {
        if (controller.signal.aborted) return;
        const { name, finishedAt } = latestChip(runs);
        setState({ kind: "ready", text: SYNC_TEXTS.run(name, finishedAt), finishedAt });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof HubIndexError && error.message === "no runs published yet")
          setState({ kind: "empty" });
        else
          setState({
            kind: "error",
            reason: error instanceof Error ? error.message : "the run index could not be read",
          });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  if (state.kind === "ready")
    return (
      <Link
        to={ROUTES.runs}
        className={styles.target}
        data-sync-badge="ready"
        title={`Latest published run, finished ${state.finishedAt}`}
      >
        <span className={`${styles.badge} ${styles.ready}`}>
          <Icon name="cloud_done" size="medium" />
          <span className={styles.text}>{state.text}</span>
        </span>
      </Link>
    );
  if (state.kind === "error")
    return (
      <span
        className={`${styles.badge} ${styles.error}`}
        data-sync-badge="error"
        title={state.reason}
      >
        <Icon name="cloud_off" size="medium" />
        <span className={styles.text}>{SYNC_TEXTS.unavailable}</span>
        <button type="button" className={styles.retry} onClick={retry}>
          {SYNC_TEXTS.retry}
        </button>
      </span>
    );
  return (
    <span className={styles.badge} data-sync-badge={state.kind} role="status">
      {state.kind === "empty" ? (
        <Icon name="cloud_queue" size="medium" />
      ) : (
        <Icon name="cloud_sync" size="medium" />
      )}
      <span className={styles.text}>
        {state.kind === "empty" ? SYNC_TEXTS.empty : SYNC_TEXTS.loading}
      </span>
    </span>
  );
}
