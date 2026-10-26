// The Data pages' tab bar (A-16 T050; DataManifest/DataVerify/DataCatalog boards): Manifest,
// Verify and Catalog as Atlas § 7 primary tabs (links, the current one marked). Verify needs a
// CID: it opens the latest manifest's check when the page knows that CID, and on the Verify page
// itself it is the current tab. Render-only.
import { ROUTES, verifyPath } from "@countylens/shared/routes";
import type { ReactElement } from "react";
import { Link } from "react-router";
import styles from "./DataTabs.module.css";

export type DataTab = "manifest" | "verify" | "catalog";

export function DataTabs({
  current,
  verifyCid,
}: {
  readonly current: DataTab;
  /** The CID the Verify tab opens (the latest manifest); null until it is known. */
  readonly verifyCid: string | null;
}): ReactElement {
  const tabs: readonly {
    readonly id: DataTab;
    readonly label: string;
    readonly to: string | null;
  }[] = [
    { id: "manifest", label: "Manifest", to: ROUTES.dataManifest },
    { id: "verify", label: "Verify", to: verifyCid === null ? null : verifyPath(verifyCid) },
    { id: "catalog", label: "Catalog", to: ROUTES.dataCatalog },
  ];
  return (
    <nav className={styles.tabs} aria-label="Data pages" data-data-tabs="">
      {tabs.map((tab) =>
        tab.id === current ? (
          <span key={tab.id} className={`${styles.tab} ${styles.current}`} aria-current="page">
            {tab.label}
          </span>
        ) : tab.to === null ? (
          <span key={tab.id} className={styles.tab} aria-disabled="true">
            {tab.label}
          </span>
        ) : (
          <Link key={tab.id} to={tab.to} className={styles.tab}>
            {tab.label}
          </Link>
        ),
      )}
    </nav>
  );
}
