// An in-context entry point to a Coming soon item (A-13 T042; TC-060…TC-070): a link to
// `/soon/{id}` with the "Coming soon" label next to the item's title. Pages that show a planned
// control (Explore's Builder mode, the property drawer's Street View, …) render this instead of
// a dead button. Render-only.
import { comingSoonPath } from "@countylens/shared/routes";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { comingSoonItem } from "../content/coming-soon";
import styles from "./ComingSoonEntry.module.css";

/** A wrapping row of entries for one page area (Explore toolbar, drawer, Runs, Verify). */
export function ComingSoonEntries({ ids }: { readonly ids: readonly string[] }): ReactElement {
  return (
    <div className={styles.row}>
      {ids.map((id) => (
        <ComingSoonEntry key={id} id={id} />
      ))}
    </div>
  );
}

export function ComingSoonEntry({ id }: { readonly id: string }): ReactElement | null {
  const item = comingSoonItem(id);
  if (item === undefined || !item.linked) return null;
  return (
    <Link to={comingSoonPath(item.id)} className={styles.entry} data-coming-soon-entry={item.id}>
      <span>{item.title}</span>
      <span className={styles.label}>{PAGE_TEXTS.comingSoon}</span>
    </Link>
  );
}
