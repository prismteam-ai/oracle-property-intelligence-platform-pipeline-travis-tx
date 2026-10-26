// Atlas § 7 Progress, linear 4 px, indeterminate (A-03 T055; plan § "Atlas element map" → Shell
// → Progress): `role="progressbar"`, `aria-label` = `Loading run` / `Loading permits`
// (PROGRESS_LABELS), `aria-valuetext` = the stage text (TC-024). The stage text is also shown
// under the bar, hidden from assistive tech so it is not announced twice. Render-only.
import type { ReactElement } from "react";
import styles from "./LinearProgress.module.css";

export interface LinearProgressProps {
  /** The accessible name: PROGRESS_LABELS.runs or PROGRESS_LABELS.permits. */
  readonly label: string;
  /** What is happening now (the loader's stage text). */
  readonly stageText: string;
}

export function LinearProgress({ label, stageText }: LinearProgressProps): ReactElement {
  return (
    <div className={styles.progress}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={stageText}
        className={styles.track}
      >
        <div className={styles.indicator} />
      </div>
      <p className={styles.stage} aria-hidden="true">
        {stageText}
      </p>
    </div>
  );
}
