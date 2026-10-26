// Atlas § 7 Badge / status pill (A-03 T055; interface fixed by T007): 24 px, corner-full,
// label-medium, icon plus text, colours from § 2.4. Used for the publication state (Info /
// pending, `schedule`), the fallback chip (Warning / partial, `warning`), the contractor cell
// (Verified `check_circle` / Not available `do_not_disturb_on`) and, through MissingReason, the
// Not-available pill. Render-only: it decides nothing (agent-design metagross § 8).
import type { ReactElement } from "react";
import { Icon } from "./Icon";
import styles from "./StatusPill.module.css";

/** Atlas § 2.4 semantic statuses. */
export type StatusKind = "verified" | "warning" | "error" | "info" | "unavailable";

/** The § 2.4 default glyph per status; `icon` overrides it (e.g. `schedule` for pending). */
export const STATUS_ICONS: Readonly<Record<StatusKind, string>> = {
  verified: "check_circle",
  warning: "warning",
  error: "error",
  info: "info",
  unavailable: "do_not_disturb_on",
};

export interface StatusPillProps {
  readonly status: StatusKind;
  /** Visible text, verbatim from the fixed texts or the row value. */
  readonly text: string;
  /** Material Symbols Rounded glyph name; defaults to STATUS_ICONS[status]. */
  readonly icon?: string;
  /** Extra `data-*` attributes on the pill (MissingReason adds `field` and `reason`). */
  readonly data?: Readonly<Record<string, string>>;
  /**
   * A compact visible label ("No address"): drawn instead of `text`, which stays the pill's text
   * content (screen readers, tests) and its tooltip.
   */
  readonly short?: string | undefined;
}

export function StatusPill({
  status,
  text,
  icon,
  data = {},
  short,
}: StatusPillProps): ReactElement {
  const dataAttributes = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <span
      className={`${styles.pill} ${styles[status]}`}
      data-status={status}
      data-short={short}
      title={short && text}
      {...dataAttributes}
    >
      <Icon name={icon ?? STATUS_ICONS[status]} size="small" />
      <span className={styles.text}>{text}</span>
    </span>
  );
}
