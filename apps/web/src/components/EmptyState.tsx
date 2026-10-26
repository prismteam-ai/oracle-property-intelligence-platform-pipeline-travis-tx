// Atlas § 9 Empty, reduced for A-03 (T055; plan § "Atlas element map" → Extensions):
// headline-small title and one body-medium sentence; no illustration and no action (A-13
// restores the full pattern). The Permits list shows it only when `coverage.permits_emitted.count`
// = 0 and 0 rows (TC-029). Render-only.
import { useId, type ReactElement, type ReactNode } from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  /** headline-small, verbatim from the fixed texts (e.g. PERMITS_TEXTS.empty). */
  readonly title: string;
  /** The one body-medium sentence (it may carry a CID element with `data-cid`). */
  readonly children: ReactNode;
}

export function EmptyState({ title, children }: EmptyStateProps): ReactElement {
  const titleId = useId();
  return (
    <section className={styles.empty} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <p className={styles.body}>{children}</p>
    </section>
  );
}
