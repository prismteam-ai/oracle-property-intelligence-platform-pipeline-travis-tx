// The Property drawer (A-13 T025, `sel=`; AC-4, AC-5, FR-004b, FR-005, FR-007, FR-022; TC-030,
// TC-032, TC-034; A-16 T050 per the Property1440/768/390 boards): a non-modal dialog beside the
// results from 840 px, a bottom sheet with a grabber below. Board order: title (the address, or
// "Property" + CID while the export carries no address, with that reason) with Copy link and
// Close icon buttons, the chip row (roof age · confidence, the permit chip, out-of-area owner),
// the Street View box (Coming soon: no imagery source), "Open the area in Google Maps" (the row's
// lat/lon), the actions (Show in the list, Ask about this property → the AI tab with the question
// filled in), the Roof section with its fields and evidence chain (basis → source → captured →
// table CID), the Permit, Owner and Location sections, then Metadata: the grouped missing data
// (ERR-20) and the § 8 provenance line. Close returns focus to the page and drops `sel`. It shows
// only the explore.search row; it fetches nothing and holds no licence line (AD-06).
import type { ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { useEffect, useId, useRef, type ReactElement } from "react";
import { Link } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { CidDisplay } from "../components/CidDisplay";
import { Icon } from "../components/Icon";
import { PermitChip } from "../components/PermitChip";
import {
  MissingSummary,
  PropertyFields,
  RowProvenance,
  plainWords,
  type RowField,
} from "../components/ResultRow";
import { StatusPill } from "../components/StatusPill";
import { askPath } from "../components/WelcomeCard";
import styles from "./Explore.module.css";

export interface PropertyDrawerProps {
  readonly row: ExploreRow;
  readonly onClose: () => void;
}

/** Property390NoImagery board: the Street View box text (no imagery source in this release). */
export const STREET_VIEW_TEXT = "No street photo yet. The property data below is unaffected.";

/** The question "Ask about this property" sends to the AI tab at once (`run=1`, PO 2026-10-26). */
export const askAboutProperty = (cid: string): string =>
  `Tell me about property ${cid}: roof age and its basis, roofing permits, owner tenure, with sources.`;

const host = (url: string | null): string | null => {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/** Property boards: "Open the area in Google Maps" (the row's own lat/lon; a plain outbound link). */
export const mapsUrl = (lat: number, lon: number): string =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

export function PropertyDrawer({ row, onClose }: PropertyDrawerProps): ReactElement {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [row.property_cid]);
  // Label audit 2026-10-26 (finding 3): a roof dated by a reroof permit cites the permit's own
  // source, capture time and table; any other basis cites the property record.
  const permitBased = row.roof_age_basis === "permit" && row.permit !== null;
  const p = permitBased
    ? {
        source_url: row.permit?.source_url ?? null,
        captured_at: row.permit?.captured_at ?? null,
        table_cid: row.permit?.table_cid ?? null,
      }
    : row.provenance;
  const showInList = (): void => {
    const target = document.querySelector<HTMLElement>(
      `[data-result-row][data-property-cid="${CSS.escape(row.property_cid)}"]`,
    );
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  };
  const copyLink = (): void => {
    void navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
  };
  const outOfArea = row.owner_area_class !== null && /out/i.test(row.owner_area_class);
  const sourceHost = host(p.source_url);
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={styles.drawer}
      data-property-cid={row.property_cid}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <span className={styles.grabber} aria-hidden="true" />
      <header className={styles.drawerHead}>
        <div className={styles.drawerTitleBlock}>
          <h3 id={titleId} className={styles.drawerTitle}>
            {row.address ?? "Property"} <CidDisplay cid={row.property_cid} />
          </h3>
          {row.address === null ? (
            // Audit #18: no situs text or TCAD account in the Run 3 export, so the title is the CID.
            <p className={styles.engine} data-address-reason="">
              {EXPLORE_TEXTS.addressNotInExport}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={copyLink}
          aria-label="Copy link"
        >
          <Icon name="content_copy" />
        </button>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className={styles.chipRow} data-drawer-chips="">
        {row.roof_age_years === null ? (
          <StatusPill status="unavailable" text={EXPLORE_TEXTS.roofUnknown} />
        ) : (
          <StatusPill
            status="info"
            icon="roofing"
            text={`Roof ${row.roof_age_years} yrs${
              row.roof_age_confidence === null ? "" : ` · ${row.roof_age_confidence}`
            }`}
          />
        )}
        {row.permit === null ? null : <PermitChip permit={row.permit} />}
        {outOfArea ? <StatusPill status="warning" icon="flight" text="Out-of-area owner" /> : null}
      </div>

      <div className={styles.streetView} data-street-view="">
        <Icon name="no_photography" />
        <div>
          <p className={styles.streetTitle}>Street View: coming soon</p>
          <p className={styles.engine}>{STREET_VIEW_TEXT}</p>
        </div>
      </div>
      <a
        className={styles.mapsLink}
        href={mapsUrl(row.lat, row.lon)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open the area in Google Maps
        <Icon name="location_on" size="small" />
      </a>

      <div className={styles.drawerActions}>
        <button type="button" className={styles.tonalButton} onClick={showInList}>
          <Icon name="view_list" size="medium" />
          Show in the list
        </button>
        <Link
          to={`${askPath(askAboutProperty(row.property_cid))}&run=1`}
          className={styles.tonalButton}
        >
          <Icon name="smart_toy" size="medium" />
          Ask about this property
        </Link>
      </div>

      <section className={styles.drawerSection} aria-label="Roof">
        <h4 className={styles.sectionTitle}>Roof</h4>
        <PropertyFields row={row} fields={ROOF_FIELDS} rows />
        <p className={styles.engine}>Evidence chain</p>
        <ol className={styles.chain} data-evidence-chain="">
          <li>
            {row.roof_age_basis === null || row.roof_age_basis === "unknown"
              ? EXPLORE_TEXTS.roofUnknown
              : plainWords(row.roof_age_basis)}
          </li>
          <li>
            <Icon name="arrow_forward" size="small" />
            {sourceHost ?? "source not in the published row"}
          </li>
          <li>
            <Icon name="arrow_forward" size="small" />
            {p.captured_at === null
              ? "capture date not in the row"
              : `Captured ${p.captured_at.slice(0, 10)}`}
          </li>
          <li>
            <Icon name="arrow_forward" size="small" />
            {p.table_cid === null ? "table CID not in the row" : <CidDisplay cid={p.table_cid} />}
          </li>
        </ol>
      </section>
      {SECTIONS.map((s) => (
        <section key={s.title} className={styles.drawerSection} aria-label={s.title}>
          <h4 className={styles.sectionTitle}>{s.title}</h4>
          <PropertyFields row={row} fields={s.fields} rows />
        </section>
      ))}
      {/* Task B PropertyDetail: "Not published" lists the gaps, then the metadata / provenance. */}
      <section className={styles.drawerSection} aria-label="Not published">
        <h4 className={styles.sectionTitle}>Not published</h4>
        {row.missing.length === 0 ? (
          <p className={styles.engine}>Every field of this property is published in this run.</p>
        ) : (
          <MissingSummary row={row} />
        )}
      </section>
      <section className={styles.drawerSection} aria-label="Metadata">
        <h4 className={styles.sectionTitle}>Metadata</h4>
        <RowProvenance row={row} />
      </section>
      <ComingSoonEntries ids={["street-view", "similar-properties"]} />
    </aside>
  );
}

/** Property boards: the Roof section's own fields (the evidence chain follows them). */
const ROOF_FIELDS: readonly RowField[] = [
  "roof_age_years",
  "roof_age_basis",
  "roof_age_confidence",
];

/** Property boards: Permit, Owner and Location sections, in board order, after Roof. */
const SECTIONS: readonly { readonly title: string; readonly fields: readonly RowField[] }[] = [
  {
    title: "Permit",
    fields: ["permit", "status_raw", "contractor_name", "contractor_resolution", "bbb", "bbb_link"],
  },
  {
    title: "Owner",
    fields: ["owner_name", "last_transfer", "tenure_years", "tenure_basis", "owner_area_class"],
  },
  { title: "Location", fields: ["address", "distance", "lat_lon"] },
];
