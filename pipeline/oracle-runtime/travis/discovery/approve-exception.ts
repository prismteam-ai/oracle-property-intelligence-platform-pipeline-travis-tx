// Operator command `npm --prefix pipeline/oracle-runtime run approve-exception -- --gate parcel
// --approved-by <PO> --approved-at <YYYY-MM-DD> --decision-ref <docs/decisions/...md>
// --gap-pct <n> --gis <n> --assessed <n>` (offline, no network; OR-M3).
//
// Writes one `approved_exceptions[]` entry for the readiness validator's parcel gate, bound
// to the values the PO approved. The kit validator reads only `gate` and `reason`; the
// other fields (approved_by, approved_at, approved_gap_pct, approved_gis_count,
// approved_assessed_count, coverage_effect, decision_ref) let check-catalog rule 10 fail as
// soon as the catalog's GIS count, roll count or gap differ from the approved ones, so the
// exception can never cover a different (for example much larger) gap.
//
// The confirmation flags must equal the catalog's current values, and the catalog must
// carry the gap reconciliation the approval rests on; otherwise nothing is written. The
// reason and coverage effect are generated from the reconciliation; the condominium and
// inventory readings are stated as state-code readings, unverified (OR-m1). An existing
// entry for the same gate is replaced; the change is recorded in `amendments[]`.
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { redact } from "../lib/log.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import {
  DateString,
  type ApprovedException,
  type Catalog,
  type GapReconciliation,
} from "./catalog.schema.js";
import { UNVERIFIED } from "./parcel-gap.js";
import { main as runValidatorMain } from "./run-validator.js";
import { amendCatalog, DEFAULT_CATALOG_PATH, readCatalog } from "./write-catalog.js";

const COMMAND = "approve-exception";

export const ApprovalSchema = z.strictObject({
  gate: z.literal("parcel"),
  approved_by: z.string().regex(/^[A-Za-z][A-Za-z0-9 ._-]{0,63}$/, "a plain name"),
  approved_at: DateString,
  decision_ref: z
    .string()
    .regex(/^docs\/decisions\/[A-Za-z0-9._-]+\.md$/, "docs/decisions/<file>.md"),
  gap_pct: z.number().nonnegative(),
  gis: z.int().nonnegative(),
  assessed: z.int().positive(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export interface ApproveOptions {
  repoRoot?: string;
  catalogPath?: string;
  validate?: () => Promise<number>;
  out?: (line: string) => void;
  now?: () => Date;
}

class Refusal extends Error {}

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function component(g: GapReconciliation, name: string): number {
  return g.components.find((c) => c.component === name)?.count ?? 0;
}

/** The exception entry for the parcel gate, generated from the catalog. Pure. */
export function parcelException(catalog: Catalog, a: Approval): ApprovedException {
  const p = catalog.parcel;
  if (!p) throw new Refusal("catalog has no parcel block");
  if (p.assessed_parcel_count !== a.assessed) {
    throw new Refusal(
      `--assessed ${a.assessed} != catalog assessed_parcel_count ${String(p.assessed_parcel_count)}`,
    );
  }
  if (p.gis_feature_count !== a.gis) {
    throw new Refusal(`--gis ${a.gis} != catalog gis_feature_count ${String(p.gis_feature_count)}`);
  }
  if (p.gap_pct === "unknown" || Math.abs(p.gap_pct - a.gap_pct) > 0.005) {
    throw new Refusal(`--gap-pct ${a.gap_pct} != catalog gap_pct ${String(p.gap_pct)}`);
  }
  const g = p.gap_reconciliation;
  if (!g || g.gap !== a.assessed - a.gis) {
    throw new Refusal(
      "catalog has no gap_reconciliation for these counts; run reconcile-parcel-gap first",
    );
  }
  const nonLand = component(g, "non_land_accounts");
  const condo = component(g, "condo_accounts_without_export_point");
  const inventory = component(g, "inventory_accounts_without_export_point");
  const residual = `${thousands(g.residual)} (${g.residual_pct_of_roll.toFixed(2)}% of the roll)`;
  const reason =
    `PO-approved ${a.approved_at} (${a.approved_by}) for the raw GIS-vs-roll gap ${a.gap_pct}% ` +
    `(GIS ${thousands(a.gis)} vs certified roll ${thousands(a.assessed)}; ${thousands(g.gap)} accounts). ` +
    `${thousands(g.explained)} are explained by count from the certified export: ` +
    `${thousands(nonLand)} non-land accounts (business personal property, mobile homes, minerals), ` +
    `${thousands(condo)} real-estate accounts with state codes A4 or F4 and no export geometry point, read as condominium units (${UNVERIFIED}), ` +
    `and ${thousands(inventory)} with state code O1 and no export geometry point (inventory; mostly condo inventory by the condoUnit field; ${UNVERIFIED}); ` +
    `the residual ${residual} is unexplained. This is a count-level reconciliation, not a feature-to-account join. ` +
    "The exception is bound to these values (check-catalog rule 10); the certified roll stays the denominator and GIS never seeds alone.";
  const coverage =
    `The certified roll (${thousands(a.assessed)} accounts) stays the denominator and GIS never seeds alone or replaces it; ` +
    `${thousands(nonLand)} non-land accounts and about ${thousands(condo)} accounts read as condominium units are not expected to get a parcel polygon of their own, ` +
    "so A-05 reports coordinate coverage against real-estate accounts and says how condominium units get coordinates; " +
    `${thousands(g.residual)} accounts remain unexplained.`;
  return {
    gate: a.gate,
    reason,
    approved_by: a.approved_by,
    approved_at: a.approved_at,
    approved_gap_pct: a.gap_pct,
    approved_gis_count: a.gis,
    approved_assessed_count: a.assessed,
    coverage_effect: coverage,
    decision_ref: a.decision_ref,
  };
}

/** The catalog with the gate's exception replaced (or added). Pure. */
export function withException(catalog: Catalog, entry: ApprovedException): Catalog {
  const others = (catalog.approved_exceptions ?? []).filter((e) => e.gate !== entry.gate);
  return { ...catalog, approved_exceptions: [...others, entry] };
}

export async function approveException(
  approval: unknown,
  options: ApproveOptions = {},
): Promise<number> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));
  try {
    const parsed = ApprovalSchema.safeParse(approval);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Refusal(
        `invalid arguments: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`,
      );
    }
    const a = parsed.data;
    if (!existsSync(join(root, a.decision_ref))) {
      throw new Refusal(`decision record ${a.decision_ref} not found`);
    }
    const catalog = readCatalog(catalogPath);
    const entry = parcelException(catalog, a);
    amendCatalog(
      withException(catalog, entry),
      {
        command: COMMAND,
        venue: "operator",
        fields: [`approved_exceptions[${a.gate}]`],
        ref: a.decision_ref,
        note: `approved by ${a.approved_by} on ${a.approved_at}; bound to gap ${a.gap_pct}%, GIS ${a.gis}, roll ${a.assessed}`,
      },
      catalogPath,
      (options.now ?? (() => new Date()))(),
    );
    say(
      `${COMMAND}: approved_exceptions[${a.gate}] written (gap ${a.gap_pct}%, GIS ${a.gis}, roll ${a.assessed}; ${a.decision_ref})`,
    );
  } catch (error) {
    say(`${COMMAND}: refused: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

/** `--flag value` pairs into the approval input (numbers parsed; anything else refused). */
export function parseArgs(argv: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const names: Record<string, string> = {
    "--gate": "gate",
    "--approved-by": "approved_by",
    "--approved-at": "approved_at",
    "--decision-ref": "decision_ref",
    "--gap-pct": "gap_pct",
    "--gis": "gis",
    "--assessed": "assessed",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const name = names[argv[i] ?? ""];
    const value = argv[i + 1];
    if (name === undefined || value === undefined) {
      out.__invalid = argv[i];
      continue;
    }
    out[name] = ["gap_pct", "gis", "assessed"].includes(name) ? Number(value) : value;
  }
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void approveException(parseArgs(process.argv.slice(2))).then((code) => {
    process.exitCode = code;
  });
}
