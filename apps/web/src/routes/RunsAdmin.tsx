// Admin controls of the Runs page (A-16 T043, AC-6..AC-9, FR-007, FR-009; board RunsAdmin1440,
// which is Runs1440 with `admin` on). Rendered only inside the Sync status card and only for a
// signed-in user that `admin.me` confirms as an admin; a signed-out visitor sees "Admin sign-in"
// and no control exists in the DOM. Buttons: Start run, Stop run, Retry. The status line comes
// from `admin.runs.live` (the bridge's live.json through the API): "Running · started {UTC}",
// "Bridge offline · command expired at {UTC}", "A run is already running", "stopped by admin".
// Justified differences from the board: it shows one contextual button; the test plan needs Start,
// Stop and Retry always visible, so the other two are disabled instead of hidden. The prototype's
// "pipeline host Online/Offline" preview switch is a prototype control and is not built.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { ROUTES } from "@countylens/shared/routes";
import { Icon } from "../components/Icon";
import {
  adminApi,
  ADMIN_TEXTS,
  AdminApiError,
  type AdminLive,
  type RunCommandAck,
} from "../auth/admin-api";
import { formatUtc } from "../components/Provenance";
import type { AdminAccess, LiveState } from "../auth/useAdmin";

type AccessAdmin = Extract<AdminAccess, { kind: "admin" }>;
import styles from "./RunsAdmin.module.css";

/** What the status banner says, derived from the bridge's status and the last command sent. */
export type LiveBanner =
  | { readonly kind: "none" }
  | { readonly kind: "running"; readonly text: string; readonly step: string | null }
  | { readonly kind: "queued"; readonly commandId: string; readonly expiresAt: string }
  | { readonly kind: "offline-expired"; readonly text: string }
  | { readonly kind: "already-running"; readonly text: string }
  | { readonly kind: "stopped"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string }
  | { readonly kind: "accepted"; readonly text: string };

export function describeLive(
  live: AdminLive | undefined,
  sent: RunCommandAck | undefined,
  now: number,
): LiveBanner {
  if (live !== undefined && (live.state === "running" || live.state === "stopping")) {
    const started = live.startedAt === null ? "just now" : `${formatUtc(live.startedAt)} UTC`;
    return {
      kind: "running",
      text:
        live.state === "stopping"
          ? `Stopping · started ${started}`
          : `Running · started ${started}`,
      step: live.step,
    };
  }
  const last = live?.lastCommand ?? null;
  const pending = sent ?? live?.lastSent;
  if (pending !== undefined && last?.commandId !== pending.commandId) {
    if (Date.parse(pending.expiresAt) > now) {
      return { kind: "queued", commandId: pending.commandId, expiresAt: pending.expiresAt };
    }
    return {
      kind: "offline-expired",
      text: `Bridge offline · command expired at ${formatUtc(pending.expiresAt)} UTC`,
    };
  }
  if (last?.outcome === "rejected_active_run") {
    return { kind: "already-running", text: ADMIN_TEXTS.alreadyRunning };
  }
  if (last?.outcome === "expired") {
    return {
      kind: "offline-expired",
      text: `Bridge offline · command expired at ${formatUtc(last.at)} UTC`,
    };
  }
  if (live?.state === "stopped") {
    const note = live.limitations.find((l) => /stopped by admin/i.test(l)) ?? "stopped by admin";
    return { kind: "stopped", text: `Run ${live.runId ?? ""} ${note}`.replace(/\s+/g, " ").trim() };
  }
  if (live?.state === "failed") {
    return {
      kind: "failed",
      text: `Run ${live.runId ?? ""} failed${live.step === null ? "" : ` at ${live.step}`}`
        .replace(/\s+/g, " ")
        .trim(),
    };
  }
  if (last?.outcome === "accepted") {
    return { kind: "accepted", text: "The bridge picked up the last command." };
  }
  return { kind: "none" };
}

const TONE: Readonly<Record<LiveBanner["kind"], { icon: string; tone: string }>> = {
  none: { icon: "info", tone: "toneInfo" },
  running: { icon: "sync", tone: "toneInfo" },
  queued: { icon: "schedule_send", tone: "toneInfo" },
  "offline-expired": { icon: "cloud_off", tone: "toneWarning" },
  "already-running": { icon: "info", tone: "toneWarning" },
  stopped: { icon: "stop_circle", tone: "toneWarning" },
  failed: { icon: "error", tone: "toneError" },
  accepted: { icon: "task_alt", tone: "toneSuccess" },
};

export function LiveStatusBanner({ banner }: { readonly banner: LiveBanner }): ReactElement | null {
  if (banner.kind === "none") return null;
  const { icon, tone } = TONE[banner.kind];
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${styles.banner} ${styles[tone] ?? ""}`}
      data-live-banner={banner.kind}
    >
      <Icon name={icon} size="medium" />
      <p className={styles.bannerText}>
        {banner.kind === "queued" ? (
          <>
            <b>Command queued.</b> {banner.commandId} · waiting for the bridge to pick it up. It
            expires at {formatUtc(banner.expiresAt)} UTC.
          </>
        ) : banner.kind === "running" ? (
          <>
            <span data-live-text="">{banner.text}</span>
            {banner.step === null ? null : <> · step {banner.step}</>}
          </>
        ) : (
          <span data-live-text="">{banner.text}</span>
        )}
      </p>
    </div>
  );
}

export interface AdminActionsProps {
  readonly access: AccessAdmin;
  readonly liveState: LiveState;
  readonly refresh: () => void;
}

/** Start / Stop / Retry plus the signed-in line and the live status banner. */
export function AdminActions({ access, liveState, refresh }: AdminActionsProps): ReactElement {
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<RunCommandAck | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const live = liveState.kind === "ready" ? liveState.live : undefined;
  const running = live !== undefined && (live.state === "running" || live.state === "stopping");
  // Retry resumes the run that failed or was stopped (live.runId), never the latest published one.
  const retryRunId =
    live !== undefined && (live.state === "failed" || live.state === "stopped") ? live.runId : null;
  const canRetry = retryRunId !== null;
  const banner = describeLive(live, sent, now);

  const act = useCallback(
    (run: () => Promise<RunCommandAck | unknown>) => {
      setBusy(true);
      setMessage(null);
      run().then(
        (ack) => {
          setBusy(false);
          if (typeof ack === "object" && ack !== null && "commandId" in ack) {
            setSent(ack as RunCommandAck);
          }
          refresh();
        },
        (error: unknown) => {
          setBusy(false);
          setMessage(error instanceof AdminApiError ? error.message : ADMIN_TEXTS.unavailable);
          refresh();
        },
      );
    },
    [refresh],
  );

  const start = (): void => {
    if (running) {
      setMessage(ADMIN_TEXTS.alreadyRunning);
      return;
    }
    // A real Start publishes a new public run whose CIDs never change: ask once (review minor).
    if (!dryRun && !window.confirm(ADMIN_TEXTS.confirmPublish)) return;
    act(() => adminApi.start(dryRun ? "dry_run" : "publish"));
  };

  return (
    <div className={styles.admin} data-admin-controls="">
      <p className={styles.signedIn}>
        <Icon name="verified_user" size="small" />
        <span data-signed-in="">Signed in as admin</span>
        {access.identity.email === null ? null : (
          <span className={styles.who}> · {access.identity.email}</span>
        )}
        <button
          type="button"
          className={styles.text}
          onClick={() => {
            // The Cognito client loads only when someone signs out, not for every Runs visit.
            void import("../auth/signOut").then(({ signOut }) => {
              signOut();
              window.location.assign(ROUTES.runs);
            });
          }}
        >
          Sign out
        </button>
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.filled} onClick={start} disabled={busy}>
          <Icon name="play_arrow" size="medium" />
          Start run
        </button>
        <button
          type="button"
          className={styles.outlined}
          onClick={() => act(() => adminApi.stop(live?.commandId ?? undefined))}
          disabled={busy || !running}
        >
          <Icon name="stop" size="medium" />
          Stop run
        </button>
        <button
          type="button"
          className={styles.outlined}
          onClick={() => {
            if (retryRunId !== null)
              act(() => adminApi.retry(retryRunId, dryRun ? "dry_run" : "publish"));
          }}
          disabled={busy || !canRetry}
        >
          <Icon name="refresh" size="medium" />
          Retry
        </button>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={busy}
          />
          Dry run (check everything, publish nothing)
        </label>
      </div>
      {message === null ? null : (
        <div
          role="alert"
          className={`${styles.banner} ${styles.toneWarning}`}
          data-admin-message=""
        >
          <Icon name="info" size="medium" />
          <p className={styles.bannerText}>{message}</p>
        </div>
      )}
      {liveState.kind === "never-seen" ? (
        <p className={styles.helper} data-live-never-seen="">
          Bridge offline · the bridge has not reported a status yet. Start it on the operator
          machine.
        </p>
      ) : null}
      {liveState.kind === "unavailable" ? (
        <p className={styles.helper} data-live-unavailable="">
          Run status is not available right now: the bridge status could not be read.
        </p>
      ) : null}
      <LiveStatusBanner banner={banner} />
    </div>
  );
}

/** Signed-in user without admin rights, or a session the API refused. */
export function NotAdminNote({
  kind,
  email,
}: {
  readonly kind: "not-admin" | "expired" | "unavailable";
  readonly email: string | null;
}): ReactElement {
  if (kind === "expired") {
    return (
      <p className={styles.helper} data-admin-note="expired">
        {ADMIN_TEXTS.signedOut} <Link to={ROUTES.adminSignIn}>Admin sign-in</Link>
      </p>
    );
  }
  if (kind === "unavailable") {
    return (
      <p className={styles.helper} data-admin-note="unavailable">
        {ADMIN_TEXTS.unavailable}
      </p>
    );
  }
  return (
    <p className={styles.helper} data-admin-note="not-admin">
      Signed in{email === null ? "" : ` as ${email}`}. {ADMIN_TEXTS.notAdmin} Run controls are for
      admins.
    </p>
  );
}
