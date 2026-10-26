// The head of Explore's left drawer (Explore1440 and ExploreQ-ai boards): the two Explore modes
// as tabs (Filters, AI; the drawer holds that mode's query controls) and, from 840 px, the button
// that collapses the drawer to a narrow strip so the results get the width. Collapsed, the tabs
// keep their accessible names (the labels are only visually hidden). Render-only.
import type { ReactElement } from "react";
import { Icon } from "./Icon";
import styles from "./ExploreDrawerHead.module.css";

export type ExploreMode = "filters" | "ai";

const MODES: readonly {
  readonly id: ExploreMode;
  readonly label: string;
  readonly icon: string;
}[] = [
  { id: "filters", label: "Filters", icon: "tune" },
  { id: "ai", label: "AI", icon: "auto_awesome" },
];

/** The collapse button's glyph per state (named as `icon:` so the font-subset check sees them). */
const PANEL_ICONS = {
  collapsed: { icon: "left_panel_open" },
  open: { icon: "left_panel_close" },
} as const;

export interface ExploreDrawerHeadProps {
  readonly mode: ExploreMode;
  readonly onMode: (mode: ExploreMode) => void;
  readonly collapsed: boolean;
  readonly onCollapse: (collapsed: boolean) => void;
}

export function ExploreDrawerHead({
  mode,
  onMode,
  collapsed,
  onCollapse,
}: ExploreDrawerHeadProps): ReactElement {
  return (
    <div className={collapsed ? `${styles.head} ${styles.collapsed}` : styles.head}>
      <div role="tablist" aria-label="Explore mode" className={styles.modes}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            title={m.label}
            className={`${styles.mode} ${mode === m.id ? styles.modeOn : ""}`}
            onClick={() => {
              if (m.id !== mode) onMode(m.id);
            }}
          >
            <Icon name={m.icon} size="medium" />
            <span className={styles.modeLabel}>{m.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={styles.collapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show the query panel" : "Hide the query panel"}
        title={collapsed ? "Show the query panel" : "Hide the query panel"}
        onClick={() => onCollapse(!collapsed)}
      >
        <Icon name={collapsed ? PANEL_ICONS.collapsed.icon : PANEL_ICONS.open.icon} />
      </button>
    </div>
  );
}
