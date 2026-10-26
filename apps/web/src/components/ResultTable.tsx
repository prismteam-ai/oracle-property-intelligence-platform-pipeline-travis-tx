// Explore results as the board's compact data table (Explore1440 board; PO 2026-10-26 "fix the
// table list styling"): one `tr[data-result-row]` per property (`data-property-cid`): #, the
// address with its distance and lat, lon, the roof (age, basis in short words, confidence), the
// roofing permit (compact chip and number), the contractor as printed with its BBB status, the
// owner with tenure and owner area, the compact provenance and a Details button. Values come from
// the same FieldValue the card and the drawer use, so a missing value shows its short pill with
// the reason. Row click opens the Property drawer. Shown from 1360 px (Explore picks it); the
// cards (ResultRow) below. Render-only.
import type { ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { truncateCid } from "./CidDisplay";
import { Icon } from "./Icon";
import { PermitChip } from "./PermitChip";
import {
  CompactProvenance,
  FieldValue,
  NO_PERMIT_TEXT,
  PLACEHOLDER_BUILT_YEAR,
  PLACEHOLDER_BUILT_YEAR_NOTE,
  bbbText,
  builtYearWords,
  plainWords,
  printedName,
} from "./ResultRow";
import styles from "./ResultTable.module.css";

/** The roof-age basis in the board's short words ("year built 1934"); null when unknown. */
export function shortBasis(row: ExploreRow): string | null {
  const basis = row.roof_age_basis;
  if (basis === null || basis === "unknown") return null;
  const words = basis === "built_year" ? "year built" : plainWords(basis);
  return basis !== "permit" && typeof row.year_built === "number"
    ? `${words} ${builtYearWords(row.year_built)}`
    : words;
}

/** The board's roof marker: older roofs read warmer (≥ 25 yrs, ≥ 15 yrs, younger). */
function roofTone(years: number | null): string {
  if (years === null) return "";
  if (years >= 25) return styles.roofOld ?? "";
  if (years >= 15) return styles.roofAged ?? "";
  return styles.roofYoung ?? "";
}

function confidenceClass(value: string | null): string {
  if (value === "high") return styles.confHigh ?? "";
  if (value === "medium") return styles.confMedium ?? "";
  return styles.confLow ?? "";
}

export interface ResultTableProps {
  readonly rows: readonly ExploreRow[];
  /** 1-based number of the first row (the pager's offset). */
  readonly first: number;
  readonly onSelect: (propertyCid: string) => void;
  readonly selected: string | null;
  /** The run every row comes from, named once under the table. */
  readonly runId?: string;
}

export function ResultTable({
  rows,
  first,
  onSelect,
  selected,
  runId,
}: ResultTableProps): ReactElement {
  return (
    <div className={styles.box}>
      <table className={styles.table} aria-label="Results">
        {runId === undefined ? null : (
          <caption className={styles.caption} data-table-run={runId}>
            Every row is from run {runId}; each row names its source, collection date and table.
          </caption>
        )}
        <thead>
          <tr>
            <th scope="col" className={styles.num}>
              #
            </th>
            <th scope="col">Address · distance</th>
            <th scope="col">Roof · basis · confidence</th>
            <th scope="col">Permit</th>
            <th scope="col">Contractor</th>
            <th scope="col">Owner</th>
            <th scope="col" className={styles.optional}>
              Source
            </th>
            <th scope="col">
              <span className={styles.srOnly}>Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <Row
              key={row.property_cid}
              row={row}
              n={first + i}
              onSelect={onSelect}
              selected={selected === row.property_cid}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  n,
  onSelect,
  selected,
}: {
  readonly row: ExploreRow;
  readonly n: number;
  readonly onSelect: (cid: string) => void;
  readonly selected: boolean;
}): ReactElement {
  const select = (): void => onSelect(row.property_cid);
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
  const basis = shortBasis(row);
  return (
    <tr
      className={selected ? styles.selected : undefined}
      data-result-row=""
      data-property-cid={row.property_cid}
      tabIndex={0}
      aria-selected={selected}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td className={styles.num}>{n}</td>
      <td>
        {/* Explore1440 board: the address, then its lat, lon (the short CID when there is no address). */}
        <span className={styles.stack}>
          <span data-field="address" className={styles.address}>
            <FieldValue row={row} field="address" />
          </span>
          <span className={styles.sub}>
            <span data-field="distance">
              <FieldValue row={row} field="distance" />
            </span>{" "}
            ·{" "}
            <span data-field="lat_lon" className={styles.mono}>
              <FieldValue row={row} field="lat_lon" />
            </span>
          </span>
          {row.address === null ? (
            <code className={`${styles.sub} ${styles.mono}`} title={row.property_cid}>
              {truncateCid(row.property_cid)}
            </code>
          ) : null}
        </span>
      </td>
      <td>
        {/* Roof age, its basis and the confidence in one column, so the table fits beside the
            drawer; an unknown basis says so in words, never a dash. */}
        <span className={styles.stack}>
          <span className={styles.roof}>
            <span
              className={`${styles.marker} ${roofTone(row.roof_age_years)}`}
              aria-hidden="true"
            />
            <span data-field="roof_age_years">
              <FieldValue row={row} field="roof_age_years" />
            </span>
          </span>
          <span
            data-field="roof_age_basis"
            className={`${styles.sub} ${styles.basis}`}
            title={
              row.year_built === PLACEHOLDER_BUILT_YEAR && row.roof_age_basis === "built_year"
                ? PLACEHOLDER_BUILT_YEAR_NOTE
                : (row.roof_age_basis ?? "the run has no roof-age basis for this property")
            }
          >
            {basis ?? "basis unknown"}
          </span>
          {row.roof_age_confidence === null ? (
            <span data-field="roof_age_confidence">
              <FieldValue row={row} field="roof_age_confidence" />
            </span>
          ) : (
            <span>
              <span
                className={`${styles.conf} ${confidenceClass(row.roof_age_confidence)}`}
                data-field="roof_age_confidence"
              >
                {row.roof_age_confidence}
              </span>
            </span>
          )}
        </span>
      </td>
      <td data-field="permit" className={styles.permit}>
        {row.permit === null ? (
          <span className={styles.sub} title={NO_PERMIT_TEXT}>
            None
          </span>
        ) : (
          <span className={styles.stack}>
            <PermitChip permit={row.permit} compact />
            <span className={`${styles.sub} ${styles.mono}`}>{row.permit.number}</span>
          </span>
        )}
      </td>
      <td className={styles.party}>
        {/* README demo: the contractor as printed on the permit and its BBB status. */}
        {row.permit === null ? (
          <span className={styles.sub}>—</span>
        ) : printedName(row) === null ? (
          // PO 2026-10-26: no printed contractor reads as a plain dash, like a row with no permit.
          // The reasons stay in the cell for screen readers and the hosted checks, and on hover.
          <span className={styles.stack}>
            <span
              data-field="contractor_name"
              className={`${styles.sub} ${styles.dash}`}
              title={EXPLORE_TEXTS.contractorNotPrinted}
            >
              <span className={styles.srOnly}>{EXPLORE_TEXTS.contractorNotPrinted}</span>
            </span>
            {bbbText(row.bbb_status, row.bbb_status_reason) !== null && (
              <span data-field="bbb" className={styles.srOnly}>
                <FieldValue row={row} field="bbb" />
              </span>
            )}
          </span>
        ) : (
          <span className={styles.stack}>
            <span data-field="contractor_name">
              <FieldValue row={row} field="contractor_name" />
            </span>
            <span data-field="bbb" className={styles.sub}>
              <FieldValue row={row} field="bbb" />
            </span>
          </span>
        )}
      </td>
      <td className={styles.party}>
        <span className={styles.stack}>
          <span data-field="owner_name">
            <FieldValue row={row} field="owner_name" />
          </span>
          <span className={styles.sub}>
            <span data-field="tenure_years">
              <FieldValue row={row} field="tenure_years" />
            </span>{" "}
            ·{" "}
            <span data-field="tenure_basis">
              <FieldValue row={row} field="tenure_basis" />
            </span>
          </span>
          <span data-field="owner_area_class" className={styles.sub}>
            <FieldValue row={row} field="owner_area_class" />
          </span>
        </span>
      </td>
      <td className={`${styles.source} ${styles.optional}`}>
        <CompactProvenance row={row} />
      </td>
      <td>
        <button
          type="button"
          className={styles.iconButton}
          onClick={select}
          aria-label={`Details, property ${row.property_cid}`}
          title="Open the property"
        >
          <Icon name="info" />
        </button>
      </td>
    </tr>
  );
}
