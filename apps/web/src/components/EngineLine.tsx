// The engine line of the Permits list (A-03 T055; plan § "Atlas element map" → Extensions):
// a body-small line with the `memory` icon and the fixed text, verbatim (TC-023). The fallback
// chip sits beside it as `children` when the Filebase gateway served the page. This file is the
// emitter of the text (plan § "Fixed texts and config keys"). Render-only.
import type { ReactElement, ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./EngineLine.module.css";

/** plan § "Fixed texts": the engine line, exactly. */
export const ENGINE_LINE_TEXT = "DuckDB-WASM in your browser · read-only";

export interface EngineLineProps {
  /** The fallback chip (a Warning status pill), when the fallback host served the read. */
  readonly children?: ReactNode;
}

export function EngineLine({ children }: EngineLineProps): ReactElement {
  return (
    <div className={styles.line} data-engine-line="">
      <Icon name="memory" size="small" />
      <span className={styles.text}>{ENGINE_LINE_TEXT}</span>
      {children}
    </div>
  );
}
