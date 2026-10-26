// Operator command `npm --prefix pipeline/oracle-runtime run reconcile-parcel-gap` (offline,
// no network; PO decision 2026-10-20: explain the GIS gap from data already held).
//
// Re-reads the TCAD Certified Special Export that discovery ALREADY downloaded, in one
// streaming pass, and writes ONLY these parcel fields of pipeline/docs/travis-sources.yaml:
// - account_breakdown: counts by propType, real-estate geoIDs and geometry points, and the
//   no-geometry real-estate accounts by state code, with the export receipt's provenance;
// - gap_reconciliation: each explained component, explained, residual, residual % of roll;
// - separately_assessed_without_geometry: "acknowledged", only when the measured condo
//   units without geometry are more than zero (otherwise the field is left as it was);
// - gap_reason and discrepancy_explanation, rewritten with the numbers;
// and records the change in `amendments[]` (OR-M5).
// The raw gap_pct, the roll count (canonical denominator), the GIS count and every other
// catalog value stay byte-identical. GIS is never substituted for the roll.
//
// Refusal rules match rescan-tcad: the file must match its receipt (size, SHA-256) and the
// scan's record count must equal assessed_parcel_count; the GIS count must be recorded and
// below the roll. A refusal writes nothing and asks for a fresh discovery run.
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { pathToFileURL } from "node:url";
import { redact } from "../lib/log.js";
import type { Parcel } from "./assemble.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import { FRESH_RUN, Refusal, verifyExportFile } from "./export-file-check.js";
import {
  accountBreakdownBlock,
  condoUnitsWithoutGeometry,
  discrepancyExplanationText,
  gapReasonText,
  reconcileGap,
} from "./parcel-gap.js";
import { scanExport, type ExportScan } from "./probes/tcad.js";
import { main as runValidatorMain } from "./run-validator.js";
import { amendCatalog, DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

export interface ReconcileOptions {
  repoRoot?: string;
  catalogPath?: string;
  /** Validator step; defaults to `npm run validate` (exit 0 PASS, 1 BLOCKED, 2 error). */
  validate?: () => Promise<number>;
  scan?: (path: string) => Promise<ExportScan>;
  out?: (line: string) => void;
  /** Amendment time (tests). */
  now?: () => Date;
}

const COMMAND = "reconcile-parcel-gap";

export async function reconcileParcelGap(options: ReconcileOptions = {}): Promise<number> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));

  try {
    const catalog = readCatalog(catalogPath);
    const { parcel: current, receipt, file } = await verifyExportFile(catalog, root, say, COMMAND);
    const assessed = current.assessed_parcel_count;
    const gis = current.gis_feature_count;
    if (assessed === null) throw new Refusal(`assessed_parcel_count is not recorded; ${FRESH_RUN}`);
    if (gis === null) {
      throw new Refusal(
        "gis_feature_count is not recorded; record the GIS count first (record-gis-runner)",
      );
    }
    if (current.gap_pct === "unknown") {
      throw new Refusal("gap_pct is unknown; record the GIS count first (record-gis-runner)");
    }

    const scan = await (options.scan ?? ((p: string) => scanExport(p)))(file);
    if (scan.count !== assessed) {
      throw new Refusal(
        `rescan count ${scan.count} != recorded assessed_parcel_count ${String(assessed)}; ${FRESH_RUN}`,
      );
    }
    const breakdown = scan.account_breakdown;
    if (!breakdown) throw new Refusal("the export scan returned no account breakdown");

    let reconciliation;
    try {
      reconciliation = reconcileGap(breakdown, assessed, gis);
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error));
    }
    const condos = condoUnitsWithoutGeometry(breakdown);
    const gisMeasurement = current.gis_feature_count_measurement;
    const parcel: Parcel = {
      ...current,
      gap_reason: gapReasonText(assessed, gisMeasurement, current.gap_pct, reconciliation, receipt),
      discrepancy_explanation: discrepancyExplanationText(
        assessed,
        gisMeasurement,
        current.gap_pct,
        current.discrepancy_threshold_pct,
        reconciliation,
        receipt,
      ),
      ...(condos > 0 ? { separately_assessed_without_geometry: "acknowledged" as const } : {}),
      account_breakdown: accountBreakdownBlock(breakdown, receipt, scan.zip_entry),
      gap_reconciliation: reconciliation,
    };
    amendCatalog(
      { ...catalog, parcel },
      {
        command: COMMAND,
        venue: "operator",
        fields: [
          "parcel.account_breakdown",
          "parcel.gap_reconciliation",
          "parcel.gap_reason",
          "parcel.discrepancy_explanation",
          ...(condos > 0 ? ["parcel.separately_assessed_without_geometry"] : []),
        ],
        ref: `${receipt.file_path} (export SHA-256 ${receipt.sha256})`,
      },
      catalogPath,
      (options.now ?? (() => new Date()))(),
    );

    say(
      `${COMMAND}: ${breakdown.records} records; by propType ${breakdown.by_prop_type.map((r) => `${r.prop_type} ${r.count}`).join(", ")}; inactive flagged ${breakdown.inactive_flagged}`,
    );
    const re = breakdown.real_estate;
    say(
      `${COMMAND}: real estate ${re.accounts}: ${re.distinct_geo_ids} distinct geoIDs, ${re.accounts_sharing_a_geo_id} sharing a geoID, ${re.accounts_without_geo_id} without geoID; geometry point ${re.with_geometry_point}, none ${re.without_geometry_point}`,
    );
    say(
      `${COMMAND}: no-geometry real estate by stateCd: ${re.without_geometry_by_state_cd.map((r) => `${r.state_cd} ${r.count} (condoUnit ${r.with_condo_unit})`).join(", ")}`,
    );
    for (const c of reconciliation.components) say(`${COMMAND}: ${c.component} ${c.count}`);
    say(
      `${COMMAND}: gap ${reconciliation.gap}, explained ${reconciliation.explained}, residual ${reconciliation.residual} (${reconciliation.residual_pct_of_roll.toFixed(2)}% of the roll); separately_assessed_without_geometry ${condos > 0 ? "acknowledged" : `left as ${current.separately_assessed_without_geometry ?? "(absent)"} (no condo units measured)`}`,
    );
    if (scan.identifier_name) {
      say(
        `${COMMAND}: note: the scan found key ${scan.identifier_name} (proven ${String(scan.identifier_proven)}); identifier fields are left unchanged (rescan-tcad refreshes them)`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`${COMMAND}: refused: ${message}`);
    return 2;
  }

  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void reconcileParcelGap().then((code) => {
    process.exitCode = code;
  });
}
