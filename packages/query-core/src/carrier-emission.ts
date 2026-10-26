// A-02 story edge case 2 (ADR-0002 Decision 3, ERR-9): a lexicon carrier that export-tables does
// not emit as a column is treated as no carrier for the views until the export includes it.
// Pure: the caller supplies {table → column names} (e.g. from DESCRIBE); no engine import here.

export type EmissionVerdict = "carrier" | "no_carrier_not_emitted";

/** A field and the lexicon class.property that would carry it (class = export table name). */
export interface CarrierRef {
  field: string;
  class: string;
  property: string;
}

export type EmissionResult<T extends CarrierRef = CarrierRef> = T & { verdict: EmissionVerdict };

/** Export table name → its column names. */
export type TableColumns = Readonly<Record<string, readonly string[]>>;

/** Per field: `carrier` when its table exists and has the property as a column, else not emitted. */
export function checkCarrierEmission<T extends CarrierRef>(
  tables: TableColumns,
  carriers: readonly T[],
): EmissionResult<T>[] {
  return carriers.map((c) => ({
    ...c,
    verdict: tables[c.class]?.includes(c.property) ? "carrier" : "no_carrier_not_emitted",
  }));
}

const LEADING = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)(?![a-z0-9_.[])/;

/** The class.property a source text starts with (`geometry.latitude via …`), else null. */
export function leadingCarrier(source: string): { class: string; property: string } | null {
  const m = LEADING.exec(source.trim());
  return m ? { class: m[1] as string, property: m[2] as string } : null;
}
