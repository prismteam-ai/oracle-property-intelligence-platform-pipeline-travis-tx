// SYNTHETIC TEST INPUT (test-only, A-04 G-TCAD). Export-shaped TCAD records and a ZIP holding
// them, laid out like the 2026 certified JSON (one-space indented top-level array). Every value
// is invented; owner names are synthetic text (never a real owner or mailing street).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tcadRecord, tcadExportText, type FixtureRecordOptions } from "../../tcad-records.js";
import { buildZip } from "../../synthetic-zip.js";

export const ENTRY_NAME = "Travis-protaxExport-20260719.json";

/** An improvement in the export's shape: stateCd, years and floor details with an area. */
export interface Improvement {
  stateCd: string;
  livingArea: number;
  actualYearBuilt: number;
  effectiveYearBuilt?: number;
  imprvType?: string;
}

export interface A04RecordOptions extends FixtureRecordOptions {
  improvements?: Improvement[];
  addrZip?: string | null;
  addrCountry?: string | null;
  addrInternational?: string | null;
  confidentialSale?: number | boolean;
  /** Extra sales (older first) besides the default one. */
  extraSales?: Array<{ saleDt: string | null; confidentialCode?: string | null }>;
  noSales?: boolean;
  noOwners?: boolean;
}

/** One synthetic export record with the A-04 fields (improvements, mailing country). */
export function a04Record(o: A04RecordOptions): Record<string, unknown> {
  const r = tcadRecord(o);
  const owners = r.owners as Array<Record<string, unknown>>;
  const owner = owners[0] as Record<string, unknown>;
  if (o.addrZip !== undefined) owner.addrZip = o.addrZip;
  if (o.addrCountry !== undefined) owner.addrCountry = o.addrCountry;
  owner.addrInternational = o.addrInternational ?? null;
  if (o.noOwners) r.owners = [];
  const sales = r.sales as Array<Record<string, unknown>>;
  const sale = sales[0] as Record<string, unknown>;
  if (o.confidentialSale !== undefined) sale.confidentialSale = o.confidentialSale;
  const extra = (o.extraSales ?? []).map((s, i) => ({
    ...sale,
    saleID: 100 + i,
    saleDt: s.saleDt,
    confidentialCode: s.confidentialCode ?? null,
  }));
  r.sales = o.noSales ? [] : [...extra, sale];
  r.valuations = [
    {
      pYear: 2026,
      details: {
        "cost-local": {
          improvements: (o.improvements ?? []).map((imp, i) => ({
            pImprovementID: i + 1,
            sequence: i,
            imprvType: imp.imprvType ?? "01",
            stateCd: imp.stateCd,
            actualYearBuilt: imp.actualYearBuilt,
            effYearBuilt: imp.effectiveYearBuilt ?? imp.actualYearBuilt,
            imprvComment: "",
            details: [
              { pDetailID: 1, imprvDetailType: "1ST", area: Math.ceil(imp.livingArea / 2) },
              { pDetailID: 2, imprvDetailType: "2ND", area: Math.floor(imp.livingArea / 2) },
              { pDetailID: 3, imprvDetailType: "011", area: 9999 },
            ],
          })),
        },
      },
    },
  ];
  return r;
}

export function exportText(records: Record<string, unknown>[]): string {
  return tcadExportText(records);
}

/** Writes a synthetic export ZIP to a temp dir and returns its path. */
export function writeExportZip(
  records: Record<string, unknown>[],
  name = "2026_20Certified_20JSON_20SUPP_200_2007182026.zip",
  dir: string = mkdtempSync(join(tmpdir(), "a04-tcad-")),
): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    buildZip([{ name: ENTRY_NAME, data: Buffer.from(exportText(records), "utf8") }]),
  );
  return path;
}
