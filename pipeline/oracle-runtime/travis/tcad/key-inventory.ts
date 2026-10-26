// A-04 T020: strict export record schema + full key inventory (agent-design § 1, risk R6).
// The record key set is closed: a top-level, `owners[]` or `sales[]` key not in KNOWN_KEYS
// fails the run naming the key, so a new confidentiality or owner field can never pass
// silently (A-03's /^confid/ check would miss a §25.025 flag named otherwise). Only key
// NAMES are counted; no value is read here.
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Keys as printed in the 2026 certified JSON (Travis-protaxExport-20260719.json), from the
 * full local key scan (geometry-census.ts `key_inventory`, 493,246 records).
 */
export const KNOWN_KEYS: {
  readonly top: readonly string[];
  readonly owners: readonly string[];
  readonly sales: readonly string[];
} = {
  top: [
    "appeals",
    "deeds",
    "events",
    "exemptionReset",
    "exemptionResetReason",
    "geometry",
    "inactive",
    "inactiveDt",
    "inactiveNotes",
    "inactiveReason",
    "inspections",
    "inspectionYr",
    "isUDI",
    "lastAppraisalDt",
    "links",
    "notes",
    "noticeDt",
    "owners",
    "permits",
    "pID",
    "pRollCorr",
    "propCreateDt",
    "propertyCharacteristics",
    "propertyIdentification",
    "propertyLegalDescription",
    "propertyProfile",
    "propType",
    "pVersion",
    "pYear",
    "reactivateDt",
    "reactivateNotes",
    "reactivateReason",
    "rollCorrCode",
    "rollCorrReason",
    "sales",
    "sitProperty",
    "situses",
    "smartgroups",
    "tags",
    "taxingUnitPercentCalculation",
    "taxingUnitPercentCalculationComment",
    "taxingunits",
    "taxingUnitSplitBoundaryLines",
    "valuations",
  ],
  owners: [
    "addrCity",
    "addrCountry",
    "addrDeliveryLine",
    "addrFreeForm",
    "addrFreeForm1",
    "addrFreeForm2",
    "addrFreeForm3",
    "addrInternational",
    "addrState",
    "addrUnitDesignator",
    "addrZip",
    "agents",
    "applyPctExemptions",
    "autoCass",
    "carrierRoute",
    "cassValidationBy",
    "cassValidationDt",
    "cassValidationService",
    "deliveryPoint",
    "deliveryPointCheckDigit",
    "exemptions",
    "firstName",
    "lastName",
    "latitude",
    "longitude",
    "name",
    "nameSecondary",
    "ownerID",
    "ownerPct",
    "ownerTaxable",
    "ownerValue",
    "pAccountID",
    "pID",
    "plus4Code",
    "referenceID",
    "regTag",
    "source",
    "spouseFirstName",
    "spouseLastName",
  ],
  sales: [
    "buyerLine",
    "charAnnualIncome",
    "charDaysOnMarket",
    "charDBA",
    "charImpClass",
    "charImpLivingArea",
    "charImpNumUnits",
    "charImpPctComplete",
    "charImpQuality",
    "charImpStateCd",
    "charImpType",
    "charImpUnitPrice",
    "charImpYearBuilt",
    "charLandSizeAcres",
    "charLandSizeEffectiveDepth",
    "charLandSizeEffectiveFront",
    "charLandSizeLot",
    "charLandSizeSqft",
    "charLandType",
    "charLandUnitPrice",
    "charListingDate",
    "charListingPrice",
    "charLocationCity",
    "charLocationMarketArea",
    "charLocationPropertyCategory",
    "charLocationPropertyUse",
    "charLocationRegion",
    "charLocationSchool",
    "charLocationSubdivision",
    "charLocationSubset",
    "charLocationZoning",
    "charMonthlyIncome",
    "comparableUseSaleData",
    "confidentialCode",
    "confidentialSale",
    "deedID",
    "financeCode",
    "financeComment",
    "financeLoan1AmtDown",
    "financeLoan1AmtFinanced",
    "financeLoan1FinanceYears",
    "financeLoan1InterestRate",
    "financeLoan2AmtDown",
    "financeLoan2AmtFinanced",
    "financeLoan2FinanceYears",
    "financeLoan2InterestRate",
    "frozenCharacteristics",
    "landOnlySale",
    "multiProperty",
    "notes",
    "outlier",
    "pID",
    "properties",
    "realtor",
    "reportIncludeReportNoCalculation",
    "reportIncludeReportNoCalculationReason",
    "reportSupressCode",
    "reportSupressFromReport",
    "reportSupressFromReportReason",
    "saleAdjustmentAmount",
    "saleAdjustmentPct",
    "saleAdjustmentReason",
    "saleAdjustmentReasonCode",
    "saleAdjustmentType",
    "saleDt",
    "saleExported",
    "saleID",
    "salePrice",
    "salePriceAdjusted",
    "saleQualify",
    "saleRatioType",
    "saleType",
    "sellerLine",
    "sourceOfSale",
  ],
};

/** key_inventory_sha256 of the 2026-07-19 export scan (geometry-census.json, 2026-10-21). */
export const EXPORT_KEY_INVENTORY_SHA256 =
  "cd7897a6e6c57bdf9709491d3cb15be36fa0718535b8bb332b64b423515a2016";

export class UnknownKeyError extends Error {
  readonly code = "unknown_export_key";
  constructor(readonly key: string) {
    super(
      `tcad export: unknown key ${key}; the record key set is closed (update KNOWN_KEYS only after reading what it holds)`,
    );
    this.name = "UnknownKeyError";
  }
}

export interface KeyInventory {
  /** Counts the record's top-level, owners[] and sales[] key names. */
  add(record: Record<string, unknown>): void;
  /** `{key: count}`, sorted by key (owners[] / sales[] keys counted once per item). */
  counts(): Record<string, number>;
  /** SHA-256 of the sorted key list (report `roll.key_inventory_sha256`). */
  sha256(): string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function createKeyInventory(): KeyInventory {
  const counts = new Map<string, number>();
  const bump = (k: string): void => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  return {
    add(record) {
      for (const [key, value] of Object.entries(record)) {
        bump(key);
        if ((key === "owners" || key === "sales") && Array.isArray(value)) {
          for (const item of value) {
            if (isObject(item)) for (const k of Object.keys(item)) bump(`${key}[].${k}`);
          }
        }
      }
    },
    counts() {
      return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    },
    sha256() {
      const keys = [...counts.keys()].sort().join("\n");
      return createHash("sha256").update(keys).digest("hex");
    },
  };
}

const shape = (keys: readonly string[]): Record<string, z.ZodType> =>
  Object.fromEntries(keys.map((k) => [k, z.unknown().optional()]));

/** The strict record schema built from a key set (exported for tests). */
export function strictRecordSchema(known: typeof KNOWN_KEYS) {
  const item = (keys: readonly string[]) => z.object(shape(keys)).strict();
  return z
    .object({
      ...shape(known.top),
      owners: z.array(item(known.owners)).nullable().optional(),
      sales: z.array(item(known.sales)).nullable().optional(),
    })
    .strict();
}

const DEFAULT_SCHEMA = strictRecordSchema(KNOWN_KEYS);

/**
 * Parses one export record against the closed key set and adds it to the inventory. An
 * unknown key throws UnknownKeyError naming it (`owners[].<key>` for an owner key).
 */
export function parseExportRecord(
  value: unknown,
  inventory: KeyInventory,
  schema: ReturnType<typeof strictRecordSchema> = DEFAULT_SCHEMA,
): Record<string, unknown> {
  if (!isObject(value)) throw new Error("tcad export: a record is not an object");
  inventory.add(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        const where = issue.path.find((p) => p === "owners" || p === "sales");
        const key = issue.keys[0] ?? "?";
        throw new UnknownKeyError(where === undefined ? key : `${String(where)}[].${key}`);
      }
    }
    throw new Error(
      `tcad export: record does not match the export shape: ${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  return value;
}
