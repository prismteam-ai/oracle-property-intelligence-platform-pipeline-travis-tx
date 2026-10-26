// Atlas § 9 Loading skeletons (A-03 T055; interface fixed by T007). The rows (table) or cards
// live in a `role="status" aria-busy="true"` container, carry no data cells and are never a
// `<table>`; the data table / cards mount only in `ready` (FR-008, TC-024). The page-level
// linear progress bar is a separate component (LinearProgress). Render-only.
import type { ReactElement } from "react";
import styles from "./Skeleton.module.css";

export const DEFAULT_SKELETON_COUNT = 5;

export interface SkeletonProps {
  /** `rows` for the ≥ 600 px table layout, `cards` for compact widths and the Runs card. */
  readonly variant: "rows" | "cards";
  /** Number of placeholders; defaults to DEFAULT_SKELETON_COUNT. */
  readonly count?: number;
}

export function Skeleton({ variant, count = DEFAULT_SKELETON_COUNT }: SkeletonProps): ReactElement {
  const placeholders = Array.from({ length: count }, (_, index) => index);
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={variant === "rows" ? styles.rows : styles.cards}
      data-variant={variant}
    >
      {placeholders.map((index) => (
        <div key={index} className={styles.placeholder} aria-hidden="true">
          <span className={styles.line} />
          <span className={styles.lineShort} />
        </div>
      ))}
    </div>
  );
}
