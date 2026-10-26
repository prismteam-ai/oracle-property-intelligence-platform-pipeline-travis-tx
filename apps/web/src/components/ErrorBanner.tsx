// Atlas § 9 Error (A-03 T055; interface fixed by T007): an error-container banner with the
// `error` icon, what failed, and "Retry"; the app bar and navigation keep working. `message` is
// one of the fixed texts (plan § "Fixed texts and config keys"): both hosts down, run index
// unreadable / empty, count mismatch, engine failure, permit rows unreadable (ERR-11: the schema
// detail goes to the console, never into the banner). Render-only.
import type { ReactElement, ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./ErrorBanner.module.css";

export interface ErrorBannerProps {
  /** What failed, verbatim from the fixed texts: a string, or nodes that keep its wording. */
  readonly message: ReactNode;
  /** "Retry" re-runs the load; when absent the banner shows no action. */
  readonly onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps): ReactElement {
  return (
    <div role="alert" className={styles.banner}>
      <Icon name="error" size="medium" />
      <p className={styles.message}>{message}</p>
      {onRetry === undefined ? null : (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
