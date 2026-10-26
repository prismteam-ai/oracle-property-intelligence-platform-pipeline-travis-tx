// An Explore result (A-13 T025/T027/T031; AC-4, AC-5, AC-7, AC-8, FR-004, FR-005, FR-007,
// FR-008, FR-022; ERR-20). `PropertyFields` is the description list shared by the result card
// and the Property drawer: one `[data-field]` cell per field holding only its value or its
// missing reason in words (contracts/ui-routes.md), never blank. `MissingSummary` groups the
// row's `missing` entries by reason and names their fields (ERR-20: "{fields}: {reason}"); a
// no-carrier entry reads EXPLORE_TEXTS.noCarrier ("not in the published data model …"). `RowProvenance` is the § 8 line
// (source, collected, table CID, run) the drawer shows; `CompactProvenance` is its short form for
// the result rows (host · date, table CID, run; A-16 PO notes). `ResultRow` is the compact
// clickable Atlas card (Explore390 board); Enter/Space or its Details button open the drawer.
// Every value comes from the explore.search row. Render-only.
import { MISSING_REASONS, type MissingReason as Reason } from "@countylens/contract";
import type { ExploreRow, MissingEntry } from "@countylens/query-core";
import {
  BBB_SEARCH_LINK_LABEL,
  EXPLORE_TEXTS,
  MISSING_REASON_LABELS,
  missingLabel,
} from "@countylens/shared";
import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { safeHttpUrl } from "../data/safe-url";
import { CidDisplay, truncateCid } from "./CidDisplay";
import { ContractorBadge } from "./ContractorBadge";
import { Icon } from "./Icon";
import { MissingReason } from "./MissingReason";
import { PermitChip } from "./PermitChip";
import { Provenance, formatUtc } from "./Provenance";
import { StatusPill } from "./StatusPill";
import styles from "./ResultRow.module.css";

/** Shown in the permit cell of a property with no roofing permit in the run. */
/** A row with no permit: the permit source is the City of Austin only (docs/source-limits.md
 *  § 2), so outside Austin the absence means "not in the data", never "no permit exists". */
export const NO_PERMIT_TEXT =
  "No roofing permit in the data (permits cover the City of Austin only)";
/** Shown where a provenance value is absent from the row. */
const NOT_IN_ROW = "not in the published row";

const NO_CARRIER = "no_lexicon_carrier";

/** A gap pill: the reason in words, with the entry's field and reason as data. */
function Gap({
  text,
  short,
  reason,
  field,
}: {
  readonly text: string;
  /** The compact visible label; `text` stays the pill's text and tooltip. */
  readonly short?: string | undefined;
  readonly reason?: string | undefined;
  readonly field?: string | undefined;
}): ReactElement {
  const data: Record<string, string> = {};
  if (reason !== undefined) data["reason"] = reason;
  if (field !== undefined) data["field"] = field;
  return <StatusPill status="unavailable" text={text} data={data} short={short} />;
}

const isReason = (reason: string): reason is Reason =>
  (MISSING_REASONS as readonly string[]).includes(reason);

function missingFor(row: ExploreRow, field: string): MissingEntry | undefined {
  return row.missing.find((m) => m.field === field);
}

const ROOF_SHORT = "Roof age unknown";
const TENURE_SHORT = "Tenure unknown";
const BBB_SHORT = {
  not_checked: "BBB not checked",
  blocked: "BBB blocked",
  not_found: "No BBB profile",
} as const;

/** A roof gap for `field`: its own missing entry's label when the row has one, else roofUnknown. */
function gapFor(row: ExploreRow, field: string): ReactElement {
  const entry = missingFor(row, field);
  if (entry !== undefined && isReason(entry.reason) && entry.reason !== NO_CARRIER) {
    return <MissingReason field={entry.field} reason={entry.reason} short={ROOF_SHORT} />;
  }
  return (
    <Gap
      text={EXPLORE_TEXTS.roofUnknown}
      short={ROOF_SHORT}
      reason={entry?.reason}
      field={entry?.field}
    />
  );
}

export function bbbText(status: string | null, reason: string | null): string | null {
  switch (status) {
    case null:
      return null;
    case "not_checked":
      return EXPLORE_TEXTS.bbbNotChecked(reason ?? "");
    case "blocked":
      return EXPLORE_TEXTS.bbbBlocked;
    case "not_found":
      return EXPLORE_TEXTS.bbbNotFound;
    default:
      return `BBB ${status}`;
  }
}

function Cell({
  label,
  field,
  children,
}: {
  readonly label: string;
  readonly field: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.cell}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value} data-field={field}>
        {children}
      </dd>
    </div>
  );
}

const unknownRoof = (basis: string | null): boolean => basis === null || basis === "unknown";

/** Contract enum codes in plain words (hosted review 2026-10-26: no raw `snake_case` in the UI);
 *  the code stays in the tooltip. Unlisted codes show with spaces for underscores. */
export const PLAIN_WORDS: Readonly<Record<string, string>> = {
  permit: "reroof permit",
  new_construction: "new build",
  sale_date: "latest sale",
  deed_date: "latest deed",
  in_county: "in Travis County",
  regional: "in the region, outside Travis County",
  out_of_area: "outside the region",
  resolved: "matched to a registered company",
  unresolved: "not matched to a registered company",
};

export const plainWords = (code: string): string => PLAIN_WORDS[code] ?? code.replaceAll("_", " ");

/**
 * TCAD's built year 1900 is a placeholder for old buildings of unknown year: Run 3.1 has 233
 * structures in 1900 against 1 in 1899 and 5 in 1901. A roof age from it is shown as approximate.
 */
export const PLACEHOLDER_BUILT_YEAR = 1900;
export const PLACEHOLDER_BUILT_YEAR_NOTE =
  "1900 is a frequent TCAD default for old buildings of unknown year, so this age is approximate";

/** "1934", or "1900 (approx.)" for TCAD's placeholder year. */
export const builtYearWords = (year: number): string =>
  year === PLACEHOLDER_BUILT_YEAR ? `${String(year)} (approx.)` : String(year);

/** "Owned 1 yr", "Owned 12 yrs", "Owned < 1 yr". */
export const ownedText = (years: number): string =>
  years < 1 ? "Owned < 1 yr" : `Owned ${String(years)} ${years === 1 ? "yr" : "yrs"}`;

/**
 * A-16 data audit (#2, #9, #15, #16): optional fields the Explore row carries once the query-core
 * row mapping adds them. Read defensively: absent (an older API) means "not in this row yet", null
 * means the run has no value and the row's `missing` entry says why.
 */
interface RowExtras {
  readonly year_built?: number | null;
  readonly owner_name?: string | null;
  readonly last_ownership_transfer_date?: string | null;
  readonly bbb_url?: string | null;
  readonly contractor_name_as_printed?: string | null;
}
const extras = (row: ExploreRow): RowExtras => row as ExploreRow & RowExtras;

/** The contractor name as printed on the permit, wherever the row carries it. */
export function printedName(row: ExploreRow): string | null {
  const nested = (row.contractor as { name_as_printed?: string | null } | null)?.name_as_printed;
  const onPermit = (row.permit as { contractor_name_as_printed?: string | null } | null)
    ?.contractor_name_as_printed;
  return nested ?? onPermit ?? extras(row).contractor_name_as_printed ?? null;
}

/** The BBB search link (built from the printed name), wherever the row carries it. */
function bbbUrl(row: ExploreRow): string | null {
  const onPermit = (row.permit as { bbb_url?: string | null } | null)?.bbb_url;
  return onPermit ?? extras(row).bbb_url ?? null;
}

/** Every field a result row shows, in board order (the table, the card and the drawer). */
export type RowField =
  | "address"
  | "roof_age_years"
  | "roof_age_basis"
  | "roof_age_confidence"
  | "distance"
  | "lat_lon"
  | "permit"
  | "status_raw"
  | "contractor_name"
  | "contractor_resolution"
  | "bbb"
  | "bbb_link"
  | "owner_name"
  | "last_transfer"
  | "tenure_years"
  | "tenure_basis"
  | "owner_area_class";

/** The field's label, as the card and drawer show it. */
export const FIELD_LABELS: Readonly<Record<RowField, string>> = {
  address: "Address",
  roof_age_years: "Roof age",
  roof_age_basis: "Basis",
  roof_age_confidence: "Confidence",
  distance: "Distance",
  lat_lon: "Lat, lon",
  permit: "Roofing permit",
  status_raw: "Status as printed",
  contractor_name: "Contractor as printed",
  contractor_resolution: "Contractor match",
  bbb: "BBB",
  bbb_link: "BBB search",
  owner_name: "Owner",
  last_transfer: "Last sale or deed",
  tenure_years: "Tenure",
  tenure_basis: "Tenure basis",
  owner_area_class: "Owner area",
};

/** Whether the row has the field at all (permit, contractor and BBB cells exist only with data). */
export function hasField(row: ExploreRow, field: RowField): boolean {
  if (field === "status_raw") return row.permit !== null;
  if (field === "contractor_name" || field === "contractor_resolution")
    return row.contractor !== null;
  if (field === "bbb") return bbbText(row.bbb_status, row.bbb_status_reason) !== null;
  if (field === "bbb_link") return bbbUrl(row) !== null;
  if (field === "owner_name") return "owner_name" in row;
  if (field === "last_transfer") return "last_ownership_transfer_date" in row;
  return true;
}

/** A row's own missing-reason label for a field ("No owner record on the TCAD account"), or null. */
function reasonLabel(row: ExploreRow, field: string): string | null {
  const entry = missingFor(row, field);
  return entry !== undefined && isReason(entry.reason) ? missingLabel(field, entry.reason) : null;
}

/** One field's value, or its missing reason in words (never blank). */
export function FieldValue({
  row,
  field,
}: {
  readonly row: ExploreRow;
  readonly field: RowField;
}): ReactElement | null {
  switch (field) {
    case "address":
      return row.address !== null ? (
        <>{row.address}</>
      ) : (
        // Audit #18: the carrier exists; the run's export omits the situs text for this property.
        <Gap
          text={EXPLORE_TEXTS.addressNotInExport}
          short="No address"
          reason={missingFor(row, "address")?.reason ?? "not_in_export"}
          field="address"
        />
      );
    case "roof_age_years":
      return row.roof_age_years === null ? (
        gapFor(row, "roof_age_years")
      ) : (
        <>{`${row.roof_age_years} yrs`}</>
      );
    case "roof_age_basis":
      return unknownRoof(row.roof_age_basis) ? (
        gapFor(row, "roof_age_basis")
      ) : row.roof_age_basis === "built_year" ? (
        // Task B B-03 / audit #15: the roof dates from the building, with its year when carried.
        <span title="built_year">
          {typeof extras(row).year_built === "number"
            ? `Year built ${builtYearWords(extras(row).year_built as number)} (no reroof permit found)`
            : "Year built (no reroof permit found)"}
        </span>
      ) : (
        <span title={row.roof_age_basis ?? undefined}>{plainWords(row.roof_age_basis ?? "")}</span>
      );
    case "roof_age_confidence":
      return row.roof_age_confidence === null ? (
        gapFor(row, "roof_age_confidence")
      ) : (
        <>{row.roof_age_confidence}</>
      );
    case "distance":
      return <>{`${row.dist_mi} mi ${row.bearing}`}</>;
    case "lat_lon":
      // 5 decimals (about 1 m), so float noise such as 30.266854499999997 never shows.
      return <>{`${Number(row.lat.toFixed(5))}, ${Number(row.lon.toFixed(5))}`}</>;
    case "permit":
      return row.permit === null ? (
        <span>{NO_PERMIT_TEXT}</span>
      ) : (
        <PermitChip permit={row.permit} />
      );
    case "status_raw":
      return row.permit === null ? null : (
        <Gap
          text={EXPLORE_TEXTS.noCarrier}
          short="Status not published"
          reason={NO_CARRIER}
          field="permit.status_raw"
        />
      );
    case "contractor_name": {
      // Audit #1: the printed name when the permit has one (unverified), else why it is empty.
      if (row.contractor === null) return null;
      const name = printedName(row);
      return name !== null ? (
        <span title={EXPLORE_TEXTS.asPrinted}>{name}</span>
      ) : (
        <Gap
          text={EXPLORE_TEXTS.contractorNotPrinted}
          short="No contractor printed"
          reason="source_missing"
          field="contractor.name_as_printed"
        />
      );
    }
    case "bbb_link": {
      const href = safeHttpUrl(bbbUrl(row) ?? "");
      return href === undefined ? null : (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {BBB_SEARCH_LINK_LABEL}
        </a>
      );
    }
    case "owner_name": {
      const owner = extras(row).owner_name;
      return typeof owner === "string" ? (
        <>{owner}</>
      ) : (
        <Gap
          text={reasonLabel(row, "owner_name") ?? MISSING_REASON_LABELS.no_owner_record}
          short="No owner record"
          reason={missingFor(row, "owner_name")?.reason ?? "no_owner_record"}
          field="owner_name"
        />
      );
    }
    case "last_transfer": {
      const date = extras(row).last_ownership_transfer_date;
      return typeof date === "string" ? (
        <>{date.slice(0, 10)}</>
      ) : (
        <Gap
          text={MISSING_REASON_LABELS.no_dated_sale}
          short="No dated sale"
          reason="no_dated_sale"
          field="last_ownership_transfer_date"
        />
      );
    }
    case "contractor_resolution":
      return row.contractor === null ? null : (
        <ContractorBadge resolution={row.contractor.resolution} />
      );
    case "bbb": {
      const bbb = bbbText(row.bbb_status, row.bbb_status_reason);
      if (bbb === null) return null;
      return row.bbb_status === "not_checked" ||
        row.bbb_status === "blocked" ||
        row.bbb_status === "not_found" ? (
        <Gap
          text={bbb}
          short={BBB_SHORT[row.bbb_status]}
          reason={`bbb_${row.bbb_status}`}
          field="bbb_status"
        />
      ) : (
        <>{bbb}</>
      );
    }
    case "tenure_years":
      return row.tenure_years === null ? (
        <Gap
          text={EXPLORE_TEXTS.tenureUnknown}
          short={TENURE_SHORT}
          reason={missingFor(row, "tenure_years")?.reason}
        />
      ) : (
        <>{ownedText(row.tenure_years)}</>
      );
    case "tenure_basis":
      return row.tenure_basis === null ? (
        <Gap text={EXPLORE_TEXTS.tenureUnknown} short={TENURE_SHORT} />
      ) : (
        <span title={row.tenure_basis}>{plainWords(row.tenure_basis)}</span>
      );
    case "owner_area_class":
      // Contract v1.2: the run says why (e.g. zip_not_zcta); the generic text only when it does not.
      return row.owner_area_class === null || row.owner_area_class === "unknown" ? (
        <Gap
          text={reasonLabel(row, "owner_area_class") ?? EXPLORE_TEXTS.ownerAreaUnknown}
          short="Owner area unknown"
          reason={missingFor(row, "owner_area_class")?.reason}
        />
      ) : (
        <span title={row.owner_area_class}>{plainWords(row.owner_area_class)}</span>
      );
  }
}

const CARD_FIELDS: readonly RowField[] = [
  "address",
  "roof_age_years",
  "roof_age_basis",
  "roof_age_confidence",
  "distance",
  "lat_lon",
  "permit",
  "status_raw",
  "contractor_name",
  "contractor_resolution",
  "bbb",
  "bbb_link",
  "owner_name",
  "last_transfer",
  "tenure_years",
  "tenure_basis",
  "owner_area_class",
];

/** The row's fields (default: every field) as a description list; absent permit/contractor cells are skipped. */
export function PropertyFields({
  row,
  fields = CARD_FIELDS,
  rows = false,
}: {
  readonly row: ExploreRow;
  readonly fields?: readonly RowField[];
  /** Task B drawer rows: label left, value right (PropertyDetail permitFields). */
  readonly rows?: boolean;
}): ReactElement {
  return (
    <dl className={rows ? `${styles.fields} ${styles.rows}` : styles.fields}>
      {fields
        .filter((f) => hasField(row, f))
        .map((field) => (
          <Cell key={field} label={FIELD_LABELS[field]} field={field}>
            <FieldValue row={row} field={field} />
          </Cell>
        ))}
    </dl>
  );
}

/** ERR-20: the row's missing entries grouped by reason, each group naming its fields. */
export function MissingSummary({ row }: { readonly row: ExploreRow }): ReactElement | null {
  if (row.missing.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const m of row.missing) groups.set(m.reason, [...(groups.get(m.reason) ?? []), m.field]);
  return (
    <ul className={styles.missing} aria-label="Missing data">
      {[...groups].map(([reason, fields]) => {
        const label =
          reason === NO_CARRIER
            ? EXPLORE_TEXTS.noCarrier
            : isReason(reason)
              ? missingLabel(fields[0] ?? "", reason)
              : reason.replaceAll("_", " ");
        return (
          <li
            key={reason}
            className={styles.missingGroup}
            data-missing-group={reason}
            aria-label={`${fields.join(", ")}: ${label}`}
          >
            <code className={styles.fieldNames}>{fields.join(", ")}</code>
            {reason === NO_CARRIER || !isReason(reason) ? (
              <Gap
                text={label}
                short={reason === NO_CARRIER ? "Not published" : undefined}
                reason={reason}
              />
            ) : (
              // No data-field here: each [data-field] appears once per row (the field's own cell).
              <StatusPill
                status="unavailable"
                text={missingLabel(fields[0] ?? "", reason)}
                data={{ reason }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RowProvenance({ row }: { readonly row: ExploreRow }): ReactElement {
  const p = row.provenance;
  return (
    <div data-provenance="">
      {p.table_cid !== null && p.captured_at !== null && p.run_id !== null ? (
        <Provenance
          sourceUrl={p.source_url}
          capturedAt={p.captured_at}
          tableCid={p.table_cid}
          runId={p.run_id}
        />
      ) : (
        <Provenance>
          Source: {p.source_url ?? <Gap text={NOT_IN_ROW} short="Not in row" />} · table{" "}
          {p.table_cid === null ? (
            <Gap text={NOT_IN_ROW} short="Not in row" />
          ) : (
            <CidDisplay cid={p.table_cid} />
          )}{" "}
          · run {p.run_id ?? <Gap text={NOT_IN_ROW} short="Not in row" />}
        </Provenance>
      )}
    </div>
  );
}

/** A source URL's host ("traviscad.org") for the compact line; null when it is not a URL. */
export function sourceHost(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The compact § 8 line of a result (PO 2026-10-26: no long URLs in the rows): the source host as a
 * link with the full URL as its tooltip, the collected date (UTC time as tooltip), the table CID
 * (truncated, full in `data-cid`/tooltip; the Property drawer has the copy button) and the run.
 */
export function CompactProvenance({ row }: { readonly row: ExploreRow }): ReactElement {
  const p = row.provenance;
  const host = sourceHost(p.source_url);
  const href = p.source_url === null ? undefined : safeHttpUrl(p.source_url);
  const notInRow = <Gap text={NOT_IN_ROW} short="Not in row" />;
  return (
    <div data-provenance="" className={styles.prov}>
      <span className={styles.provLine}>
        <Icon name="description" size="small" />
        {p.source_url === null ? (
          notInRow
        ) : href !== undefined && host !== null ? (
          <a href={href} title={p.source_url} rel="noopener noreferrer" target="_blank">
            {host}
          </a>
        ) : (
          <span title={p.source_url}>{host ?? p.source_url}</span>
        )}
        {" · "}
        {p.captured_at === null ? (
          notInRow
        ) : (
          <time dateTime={p.captured_at} title={`collected ${formatUtc(p.captured_at)} UTC`}>
            {p.captured_at.slice(0, 10)}
          </time>
        )}
      </span>
      <span className={styles.provLine}>
        table{" "}
        {p.table_cid === null ? (
          notInRow
        ) : (
          <code className={styles.mono} data-cid={p.table_cid} title={p.table_cid}>
            {truncateCid(p.table_cid)}
          </code>
        )}
      </span>
      <span className={styles.provLine} title={p.run_id ?? undefined}>
        run {p.run_id ?? notInRow}
      </span>
    </div>
  );
}

export interface ResultRowProps {
  readonly row: ExploreRow;
  readonly onSelect?: (propertyCid: string) => void;
  readonly selected?: boolean;
  /** False for a close match: it is outside the radius, so not a `[data-result-row]`. */
  readonly inRadius?: boolean;
}

/** The fields the compact card keeps behind its expand button (the rest show in its summary). */
const MORE_FIELDS: readonly RowField[] = CARD_FIELDS.filter(
  (f) =>
    ![
      "address",
      "distance",
      "roof_age_years",
      "roof_age_confidence",
      "permit",
      "tenure_years",
    ].includes(f),
);

/**
 * A compact result card (Explore390 board): the address and distance, Details and expand icon
 * buttons, the roof and permit chips, then the compact provenance; every other field and the
 * grouped missing data sit behind the expand button. Each `[data-field]` appears once.
 */
export function ResultRow({
  row,
  onSelect,
  selected = false,
  inRadius = true,
}: ResultRowProps): ReactElement {
  const [open, setOpen] = useState(false);
  const select = (): void => onSelect?.(row.property_cid);
  const onClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("a, button") !== null) return;
    select();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  };
  const titleId = `row-${row.property_cid}`;
  return (
    <article
      className={`${styles.row} ${selected ? styles.selected : ""}`}
      data-result-row={inRadius ? "" : undefined}
      data-property-cid={row.property_cid}
      aria-labelledby={titleId}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {/* Task B listing order (B-03 ResultRow): title (id, then why there is no address),
          distance, Open details, expand; then the roof and confidence pills, the permit chip,
          owned years and owner area; then the short provenance. */}
      <header className={styles.head}>
        <h4 id={titleId} className={styles.title}>
          <span className={styles.titleStack}>
            <span className={styles.titleMain}>
              Property{" "}
              <code className={styles.mono} title={row.property_cid}>
                {truncateCid(row.property_cid)}
              </code>
            </span>
            <span className={styles.titleSub} data-field="address">
              <FieldValue row={row} field="address" />
            </span>
          </span>
        </h4>
        <span className={styles.distance} data-field="distance">
          <FieldValue row={row} field="distance" />
        </span>
        {onSelect === undefined ? null : (
          <button
            type="button"
            className={styles.iconButton}
            onClick={select}
            aria-label={`Details, property ${row.property_cid}`}
            title="Open the property"
          >
            <Icon name="info" />
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          aria-expanded={open}
          aria-controls={`${titleId}-more`}
          aria-label={open ? "Collapse details" : "Expand details"}
          title={open ? "Show less" : "Show more"}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="arrow_drop_down" />
        </button>
      </header>
      <div className={styles.chips}>
        {row.roof_age_years === null ? (
          <span data-field="roof_age_years">
            <FieldValue row={row} field="roof_age_years" />
          </span>
        ) : (
          <span className={`${styles.pill} ${styles.pillInfo}`}>
            <Icon name="roofing" size="small" />
            Roof{" "}
            <span data-field="roof_age_years">
              <FieldValue row={row} field="roof_age_years" />
            </span>
          </span>
        )}
        {row.roof_age_confidence === null ? (
          <span data-field="roof_age_confidence">
            <FieldValue row={row} field="roof_age_confidence" />
          </span>
        ) : (
          <span
            className={`${styles.pill} ${row.roof_age_confidence === "high" ? styles.pillHigh : styles.pillWarn}`}
          >
            Confidence{" "}
            <span data-field="roof_age_confidence">
              <FieldValue row={row} field="roof_age_confidence" />
            </span>
          </span>
        )}
        <span className={styles.meta} data-field="permit">
          <FieldValue row={row} field="permit" />
        </span>
        {/* Final review: year built and owner on the card when the row carries them (the
            drawer's Owner and Roof sections hold the fields with their reasons). */}
        {typeof extras(row).year_built === "number" ? (
          <span
            className={styles.meta}
          >{`Year built ${builtYearWords(extras(row).year_built as number)}`}</span>
        ) : null}
        {typeof extras(row).owner_name === "string" ? (
          <span className={styles.meta}>{extras(row).owner_name}</span>
        ) : null}
        <span className={styles.meta} data-field="tenure_years">
          <FieldValue row={row} field="tenure_years" />
        </span>
        {row.owner_area_class !== null && /out/i.test(row.owner_area_class) ? (
          <StatusPill status="warning" icon="flight" text="Out-of-area owner" />
        ) : null}
      </div>
      <CompactProvenance row={row} />
      <div id={`${titleId}-more`} className={styles.more} hidden={!open}>
        <p className={styles.cidLine}>
          Property <CidDisplay cid={row.property_cid} />
        </p>
        <PropertyFields row={row} fields={MORE_FIELDS} />
        <MissingSummary row={row} />
      </div>
    </article>
  );
}
