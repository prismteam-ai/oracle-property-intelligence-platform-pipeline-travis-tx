// Operator command `npm --prefix pipeline/oracle-runtime run rescan-tcad` (offline, no network).
//
// Re-reads the TCAD Certified Special Export that discovery ALREADY downloaded and refreshes
// only the parcel key fields of pipeline/docs/travis-sources.yaml (identifier_name,
// identifier_layout_name, identifier_proven, identifier_format), then re-runs the
// readiness validator.
//
// Provenance stays the original download's: the export receipt (URL, bytes, SHA-256,
// captured_at), the roll-count measurement and snapshot_time are never touched. Before any
// scan the file must match the receipt byte-for-byte (size and SHA-256), and the rescan's
// record count must equal the recorded assessed_parcel_count; any mismatch writes nothing
// and asks for a fresh discovery run instead. The change is recorded in `amendments[]`.
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { pathToFileURL } from "node:url";
import { redact } from "../lib/log.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import type { Parcel } from "./assemble.js";
import { FRESH_RUN, Refusal, verifyExportFile } from "./export-file-check.js";
import { scanExport, type ExportScan } from "./probes/tcad.js";
import { main as runValidatorMain } from "./run-validator.js";
import { amendCatalog, DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

export interface RescanOptions {
  repoRoot?: string;
  catalogPath?: string;
  /** Validator step; defaults to `npm run validate` (exit 0 PASS, 1 BLOCKED, 2 error). */
  validate?: () => Promise<number>;
  scan?: (path: string) => Promise<ExportScan>;
  out?: (line: string) => void;
  /** Amendment time (tests). */
  now?: () => Date;
}

export async function rescanTcad(options: RescanOptions = {}): Promise<number> {
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
    const {
      parcel: current,
      receipt,
      file,
    } = await verifyExportFile(catalog, root, say, "rescan-tcad");

    const scan = await (options.scan ?? ((p: string) => scanExport(p)))(file);
    const recorded = current.assessed_parcel_count;
    if (scan.count !== recorded) {
      throw new Refusal(
        `rescan count ${scan.count} != recorded assessed_parcel_count ${String(recorded)}; ${FRESH_RUN}`,
      );
    }
    if (
      current.deed_or_sale_dates_present !== undefined &&
      current.deed_or_sale_dates_present !== scan.deed_or_sale_dates_present
    ) {
      say(
        `rescan-tcad: note: deed_or_sale_dates_present would be ${String(scan.deed_or_sale_dates_present)} (left unchanged)`,
      );
    }

    const {
      identifier_name: _name,
      identifier_layout_name: _layout,
      identifier_format: _format,
      ...rest
    } = current;
    const parcel: Parcel = {
      ...rest,
      identifier_proven: scan.identifier_proven,
      ...(scan.identifier_name ? { identifier_name: scan.identifier_name } : {}),
      ...(scan.identifier_layout_name
        ? { identifier_layout_name: scan.identifier_layout_name }
        : {}),
      ...(scan.identifier_format ? { identifier_format: scan.identifier_format } : {}),
    };
    amendCatalog(
      { ...catalog, parcel },
      {
        command: "rescan-tcad",
        venue: "operator",
        fields: [
          "parcel.identifier_name",
          "parcel.identifier_layout_name",
          "parcel.identifier_proven",
          "parcel.identifier_format",
        ],
        ref: `${receipt.file_path} (export SHA-256 ${receipt.sha256})`,
      },
      catalogPath,
      (options.now ?? (() => new Date()))(),
    );
    for (const c of scan.identifier_candidates ?? []) {
      say(
        `rescan-tcad: candidate ${c.name}: present on ${c.present} of ${c.records} records, ${c.distinct} distinct, proven ${String(c.proven)}`,
      );
    }
    say(
      `rescan-tcad: parcel.identifier_name ${scan.identifier_name ?? "(none)"} (layout ${scan.identifier_layout_name ?? "none"}), identifier_proven ${String(scan.identifier_proven)}, identifier_format ${scan.identifier_format ?? "(none)"}; ${scan.count} records`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`rescan-tcad: refused: ${message}`);
    return 2;
  }

  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void rescanTcad().then((code) => {
    process.exitCode = code;
  });
}
