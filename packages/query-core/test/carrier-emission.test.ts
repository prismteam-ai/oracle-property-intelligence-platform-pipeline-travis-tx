// A-02-TC-004 (AC-1, FR-001; story edge case 2, defect ERR-9): a carrier that exists in the lexicon
// but that export-tables does not emit as a column is treated as no carrier for the views until the
// export includes it. The checker is pure (src/carrier-emission.ts); DESCRIBE of the pilot Parquet
// runs here through the scripts/ DuckDB adapter. Pilot cases are gated on PILOT_DIR.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNCARRIED, VIEWS, type UncarriedField, type ViewName } from "@countylens/contract";
import {
  checkCarrierEmission,
  leadingCarrier,
  type CarrierRef,
  type TableColumns,
} from "../src/carrier-emission.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import { PILOT_DIR, ROOT, SKIP_MESSAGE } from "./helpers/pilot.js";

const ADR = join(ROOT, "docs/decisions/0002-lexicon-carriers.md");
const SCHEMAS = join(ROOT, "packages/query-core/test/fixtures/schemas");
/** Lexicon classes in the committed schema snapshot (keeps `tables.car …` and the like out). */
const LEXICON_CLASSES = new Set(
  readdirSync(SCHEMAS)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => f.replace(/\.json$/, "")),
);

/** The `carrier` rows of the ADR-0002 "## Verdicts" table as {field, class, property}. */
function adrCarriers(): CarrierRef[] {
  const text = readFileSync(ADR, "utf8");
  const start = text.indexOf("\n## Verdicts");
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ", 3);
  return (end < 0 ? rest : rest.slice(0, end))
    .split("\n")
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    )
    .filter((cells) => cells[2] === "carrier")
    .map((cells) => {
      const ref = leadingCarrier(cells[3] ?? "");
      if (!ref) throw new Error(`ADR carrier is not class.property: ${cells[3]}`);
      return { field: cells[1] ?? "", ...ref };
    });
}

/** Every v1 view column whose source starts with a lexicon class.property. */
function viewCarriers(): CarrierRef[] {
  return (Object.keys(VIEWS) as ViewName[]).flatMap((view) =>
    VIEWS[view].flatMap((c) => {
      const ref = leadingCarrier(c.source);
      return ref && LEXICON_CLASSES.has(ref.class) ? [{ field: `${view}.${c.name}`, ...ref }] : [];
    }),
  );
}

/** UNCARRIED fields with reason not_in_export, with the carrier they would have. */
function notInExport(): (CarrierRef & { view: string })[] {
  // Widened to the general field type: since v1.2 (ERR-74) no field has this reason, and the
  // literal types of UNCARRIED would otherwise make the filtered list `never`.
  return Object.entries(UNCARRIED as Record<string, readonly UncarriedField[]>).flatMap(
    ([view, fields]) =>
      fields
        .filter((u) => u.reason === "not_in_export")
        .map((u) => {
          const ref = leadingCarrier(u.carrier);
          if (!ref) throw new Error(`UNCARRIED ${view}.${u.field} names no class.property`);
          return { view, field: u.field, ...ref };
        }),
  );
}

/** {table → column names} over every data group of the pilot export (DESCRIBE per part glob). */
async function describePilot(db: DuckDbEngine, tablesDir: string): Promise<TableColumns> {
  const out: Record<string, string[]> = {};
  for (const group of readdirSync(tablesDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const table of readdirSync(join(tablesDir, group.name), { withFileTypes: true })) {
      if (!table.isDirectory()) continue;
      const glob = join(tablesDir, group.name, table.name, "*.parquet").replace(/'/g, "''");
      const rows = await db.all(`DESCRIBE SELECT * FROM read_parquet('${glob}')`);
      const names = rows.map((r) => String(r.column_name));
      out[table.name] = [...new Set([...(out[table.name] ?? []), ...names])];
    }
  }
  return out;
}

describe("A-02-TC-004 a carrier the export does not emit becomes no carrier (not emitted by the export)", () => {
  it("fixture: a table whose DESCRIBE lacks the property → no_carrier_not_emitted", () => {
    const tables: TableColumns = {
      address: ["cid", "request_identifier", "source_http_request"],
      sales_history: ["cid", "ownership_transfer_date"],
    };
    const result = checkCarrierEmission(tables, [
      { field: "postal_code", class: "address", property: "postal_code" },
      { field: "owner sale date", class: "sales_history", property: "ownership_transfer_date" },
      { field: "name", class: "company", property: "name" },
    ]);
    expect(result).toEqual([
      {
        field: "postal_code",
        class: "address",
        property: "postal_code",
        verdict: "no_carrier_not_emitted",
      },
      {
        field: "owner sale date",
        class: "sales_history",
        property: "ownership_transfer_date",
        verdict: "carrier",
      },
      { field: "name", class: "company", property: "name", verdict: "no_carrier_not_emitted" },
    ]);
  });

  it("leadingCarrier reads only a leading class.property", () => {
    expect(leadingCarrier("property.property_type (lexicon enum)")).toEqual({
      class: "property",
      property: "property_type",
    });
    expect(leadingCarrier("geometry.latitude via property_has_parcel")).toEqual({
      class: "geometry",
      property: "latitude",
    });
    expect(leadingCarrier("derived: whole years from roof_date to as_of")).toBeNull();
    expect(leadingCarrier("manifest sources[].url")).toBeNull();
    expect(leadingCarrier("—")).toBeNull();
  });

  it("every not_in_export field appears in no view's column list", () => {
    // Since v1.2 (Run 3.1, ERR-74) the export emits the address fields, so the list is empty;
    // the rule still holds for any field that is added to it later.
    const fields = notInExport();
    const all = new Set(Object.values(VIEWS).flatMap((cols) => cols.map((c) => c.name)));
    for (const f of fields) expect(all.has(f.field), `${f.view}.${f.field}`).toBe(false);
  });

  if (!PILOT_DIR) {
    it.skip(SKIP_MESSAGE, () => undefined);
  } else {
    const tablesDir = join(PILOT_DIR, "tables");
    let db: DuckDbEngine;
    let tables: TableColumns;

    beforeAll(async () => {
      expect(existsSync(ADR), ADR).toBe(true);
      db = await openDuckDb();
      tables = await describePilot(db, tablesDir);
    });
    afterAll(() => db.close());

    it("pilot: every ADR-0002 carrier is a column of its table in the export", () => {
      const refs = adrCarriers();
      expect(refs.map((r) => `${r.class}.${r.property}`)).toEqual([
        "sales_history.ownership_transfer_date",
      ]);
      for (const r of checkCarrierEmission(tables, refs))
        expect(r.verdict, `${r.field} ${r.class}.${r.property}`).toBe("carrier");
    });

    it("pilot: every v1 view column sourced from class.property is emitted by the export", () => {
      // A class with no records in the run has no table at all (bindManifest binds an empty typed
      // relation); that is absent data, not a column the export drops. The pilot has no person
      // records (owner_name's person branch), so only that class is skipped here.
      const all = viewCarriers();
      const refs = all.filter((r) => r.class in tables);
      expect([...new Set(all.filter((r) => !(r.class in tables)).map((r) => r.class))]).toEqual([
        "person",
      ]);
      expect(refs.length).toBeGreaterThan(0);
      for (const r of checkCarrierEmission(tables, refs))
        expect(r.verdict, `${r.field} ← ${r.class}.${r.property}`).toBe("carrier");
    });

    it("pilot: every UNCARRIED not_in_export field is absent from its table (list not stale)", () => {
      const fields = notInExport();
      for (const r of checkCarrierEmission(tables, fields))
        expect(r.verdict, `${r.field} ${r.class}.${r.property}`).toBe("no_carrier_not_emitted");
    });
  }
});
