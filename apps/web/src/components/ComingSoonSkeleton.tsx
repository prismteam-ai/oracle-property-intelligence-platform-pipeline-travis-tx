// Coming soon skeleton (A-13 T042, AC-13, FR-013): static Atlas blocks in
// `surface-container-highest` that hint at the layout a planned item will have. It is decoration
// only: `aria-hidden`, no text node, no list, table or row, no animation, no `aria-busy` or
// progress role, so it can never read as data or as a loading state. The label and the one
// sentence sit outside it. Render-only.
import type { ReactElement } from "react";
import type { ComingSoonSkeletonLayout } from "../content/coming-soon";
import styles from "./ComingSoonSkeleton.module.css";

export interface ComingSoonSkeletonProps {
  readonly layout: ComingSoonSkeletonLayout;
}

function Block({ className }: { readonly className: string }): ReactElement {
  return <span className={`${styles.block} ${className}`} />;
}

export function ComingSoonSkeleton({ layout }: ComingSoonSkeletonProps): ReactElement {
  return (
    <div className={styles.skeleton} aria-hidden="true" data-skeleton="" data-layout={layout}>
      {layout === "list" ? (
        <>
          <Block className={styles.line ?? ""} />
          <Block className={styles.lineShort ?? ""} />
          <Block className={styles.line ?? ""} />
          <Block className={styles.lineShort ?? ""} />
          <Block className={styles.line ?? ""} />
        </>
      ) : null}
      {layout === "map" ? <Block className={styles.map ?? ""} /> : null}
      {layout === "chart" ? (
        <div className={styles.bars}>
          {[styles.bar1, styles.bar2, styles.bar3, styles.bar4, styles.bar5].map((height, i) => (
            <Block key={i} className={`${styles.bar ?? ""} ${height ?? ""}`} />
          ))}
        </div>
      ) : null}
      {layout === "form" ? (
        <>
          <Block className={styles.lineShort ?? ""} />
          <Block className={styles.field ?? ""} />
          <Block className={styles.lineShort ?? ""} />
          <Block className={styles.field ?? ""} />
          <Block className={styles.button ?? ""} />
        </>
      ) : null}
    </div>
  );
}
