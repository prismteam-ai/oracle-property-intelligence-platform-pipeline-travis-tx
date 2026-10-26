// A Material Symbols glyph (Atlas § 6) drawn from CSS generated content (`data-icon` → `::before`
// in Icon.module.css), so the glyph name never enters an element's text: pills, provenance
// lines and the engine line read as their visible words alone (TC-022, TC-023 and the hosted
// tests compare text exactly). Decorative, hence aria-hidden. Render-only.
import type { ReactElement } from "react";
import styles from "./Icon.module.css";

/** `small` = 16 px (pills, provenance lines), `medium` = 20 px (buttons), `large` = the 24 px default. */
export type IconSize = "small" | "medium" | "large";

export interface IconProps {
  /** Material Symbols Rounded glyph name, e.g. `description`. */
  readonly name: string;
  readonly size?: IconSize;
}

export function Icon({ name, size = "large" }: IconProps): ReactElement {
  const sizeClass = size === "small" ? styles.small : size === "medium" ? styles.medium : "";
  return (
    <span
      className={`material-symbols-rounded ${styles.icon} ${sizeClass}`}
      data-icon={name}
      aria-hidden="true"
    />
  );
}
