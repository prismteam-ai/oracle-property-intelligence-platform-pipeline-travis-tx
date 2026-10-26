// Data · Catalog field table and "view reads this table and adds" card (A-16, DataCatalog1440
// board). Field names and types are the table's Parquet footer (the caller passes them); Meaning,
// Source and Licence come from contract/v1 (packages/contract columns.ts: each view column names
// the lexicon `class.property` it reads) and from elephant-cli's export conventions (cid,
// property_cid, data_group_cid, relationship_cid, from_cid, to_cid). A field contract/v1 does not
// describe says so instead of a guessed meaning. Render-only.
import { PROVENANCE_COLUMNS, VIEWS, type Column, type ViewName } from "@countylens/contract";
import type { ReactElement } from "react";
import type { ParquetColumn } from "../data/parquet-meta";
import styles from "./CatalogFieldTable.module.css";

export const AS_PUBLISHED = "[As published]";
export const DERIVED = "[Derived]";
const ELEPHANT_CLI = "elephant-cli";
/** Missing-data reason for a field contract/v1 does not describe. */
export const MEANING_MISSING = "not described in the data contract";

/** Columns elephant-cli's export-tables adds to every row (not lexicon properties). */
const EXPORT_COLUMNS: Readonly<Record<string, string>> = {
  cid: "CID of this record",
  property_cid: "CID of the property the record was exported under",
  data_group_cid: "Data group the record was published in",
  relationship_cid: "CID of this relationship",
  from_cid: "CID of the record the relationship starts from",
  to_cid: "CID of the record the relationship points to",
};

/** `class.property` → the first contract/v1 column that reads it (directly or by alias). */
const CONTRACT_FIELDS: ReadonlyMap<string, Column> = (() => {
  const map = new Map<string, Column>();
  for (const columns of Object.values(VIEWS)) {
    for (const column of columns) {
      // Aliased columns (issue_date, final_date) name their lexicon property as the source too.
      const m = /^([a-z_]+)\.([a-z_]+)(?=$|[\s(])/.exec(column.source);
      if (m !== null && !map.has(`${m[1]}.${m[2]}`)) map.set(`${m[1]}.${m[2]}`, column);
    }
  }
  return map;
})();

export interface FieldInfo {
  readonly meaning: string;
  readonly meaningKnown: boolean;
  readonly source: string;
  readonly licence: string;
}

/** Meaning, Source and Licence of `field` in the table of lexicon class `klass`. */
export function fieldInfo(klass: string, field: string, sourceName: string | null): FieldInfo {
  const exported = EXPORT_COLUMNS[field];
  if (exported !== undefined) {
    return { meaning: exported, meaningKnown: true, source: ELEPHANT_CLI, licence: DERIVED };
  }
  const source = sourceName ?? "source not in this run's manifest";
  if (field === "source_http_request") {
    return {
      meaning: "The source request the record was made from",
      meaningKnown: true,
      source,
      licence: AS_PUBLISHED,
    };
  }
  const column = CONTRACT_FIELDS.get(`${klass}.${field}`);
  if (column === undefined) {
    return { meaning: MEANING_MISSING, meaningKnown: false, source, licence: AS_PUBLISHED };
  }
  if (column.source.includes("set only by the profile")) {
    return {
      meaning: column.meaning,
      meaningKnown: true,
      source: "Derived: source profile",
      licence: DERIVED,
    };
  }
  return { meaning: column.meaning, meaningKnown: true, source, licence: AS_PUBLISHED };
}

/** The contract view built on a lexicon class (its main record), when there is one. */
const VIEW_OF_CLASS: Readonly<Record<string, ViewName>> = {
  property: "v_property",
  property_improvement: "v_roofing_permit",
  company: "v_contractor",
};

const PROVENANCE = new Set(PROVENANCE_COLUMNS.map((c) => c.name));

/** The view on `klass` and the columns it derives (not read from `klass` itself). */
export function derivedColumns(
  klass: string,
): { readonly view: ViewName; readonly columns: readonly Column[] } | null {
  const view = VIEW_OF_CLASS[klass];
  if (view === undefined) return null;
  const own = new RegExp(`^${klass}\\.`);
  const columns = VIEWS[view].filter((c) => !own.test(c.source) && !PROVENANCE.has(c.name));
  return { view, columns };
}

export function CatalogFieldTable({
  table,
  klass,
  columns,
  sourceName,
}: {
  /** `{group}.{table}`, for the accessible name. */
  readonly table: string;
  readonly klass: string;
  readonly columns: readonly ParquetColumn[];
  readonly sourceName: string | null;
}): ReactElement {
  return (
    <div className={styles.wrap}>
      <table className={styles.table} aria-label={`Fields of ${table}`}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Meaning</th>
            <th scope="col">Source</th>
            <th scope="col">Licence</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => {
            const info = fieldInfo(klass, column.name, sourceName);
            return (
              <tr key={column.name} data-column="" data-name={column.name} data-type={column.type}>
                <td className={styles.mono}>{column.name}</td>
                <td className={styles.type}>{column.type}</td>
                <td className={info.meaningKnown ? undefined : styles.missing}>{info.meaning}</td>
                <td className={styles.source}>{info.source}</td>
                <td className={styles.licence}>{info.licence}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DerivedCard({ klass }: { readonly klass: string }): ReactElement | null {
  const derived = derivedColumns(klass);
  if (derived === null || derived.columns.length === 0) return null;
  return (
    <div className={styles.card} data-derived-view={derived.view}>
      <b className={styles.cardTitle}>{derived.view} reads this table and adds</b>
      <span className={styles.derivedList}>
        {derived.columns
          .map((c) => (c.enum === undefined ? c.name : `${c.name} (${c.enum.join(", ")})`))
          .join(" · ")}
      </span>
      <span className={styles.cardNote}>
        Each derived column&apos;s rule is in contract/v1. A null value names its reason in the
        row&apos;s missing list.
      </span>
    </div>
  );
}
