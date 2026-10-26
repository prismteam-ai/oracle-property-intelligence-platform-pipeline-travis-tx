// A-04 T028: report sections `roll` and `confidentiality` (contracts/report.md), counts only:
// never an owner name, a mailing line or a payload. Read-only SQL (the Loader is the only writer).
// report.ts loads one `section` per file, so `confidentiality` is re-exported by
// report-sections/tcad-confidentiality.ts.
import type postgres from "postgres";
import type { ReportSection } from "../report.js";

export const ROLL_CLASSES = ["loaded", "dead", "invalid", "transform_failure"] as const;

export interface RollSection {
  n: number;
  by_prop_type: Record<string, number>;
  loaded: number;
  dead: number;
  invalid: number;
  transform_failure: number;
  difference: number;
  difference_pct: number;
  unexplained: number;
  export_sha256: string | null;
  key_inventory_sha256: string | null;
}

export async function buildRoll(sql: postgres.Sql, jobId: string): Promise<RollSection> {
  const classes = await sql<Array<{ class: string; n: number; unexplained?: number }>>`
    SELECT class, count(*)::int AS n,
      count(*) FILTER (WHERE class <> 'loaded' AND detail IS NULL)::int AS unexplained
    FROM roll_reconciliation WHERE job_id = ${jobId} GROUP BY class`;
  const types = await sql<Array<{ prop_type: string; n: number }>>`
    SELECT prop_type, count(*)::int AS n FROM parcels WHERE job_id = ${jobId} GROUP BY prop_type`;
  const run = await sql<Array<{ export_sha256: string | null }>>`
    SELECT export_sha256 FROM backbone_runs WHERE job_id = ${jobId}`;
  const mark = await sql<Array<{ value: { keyInventorySha256?: string } | null }>>`
    SELECT value FROM watermarks WHERE track = 'tcad' AND job_id = ${jobId}`;
  const count = (c: string): number => classes.find((r) => r.class === c)?.n ?? 0;
  const n = classes.reduce((s, r) => s + r.n, 0);
  const loaded = count("loaded");
  const difference = n - loaded;
  const unknown = classes
    .filter((r) => !(ROLL_CLASSES as readonly string[]).includes(r.class))
    .reduce((s, r) => s + r.n, 0);
  return {
    n,
    by_prop_type: Object.fromEntries(types.map((t) => [t.prop_type, t.n])),
    loaded,
    dead: count("dead"),
    invalid: count("invalid"),
    transform_failure: count("transform_failure"),
    difference,
    difference_pct: n === 0 ? 0 : Math.round((difference / n) * 100_000) / 1000,
    unexplained: unknown + classes.reduce((s, r) => s + (r.unexplained ?? 0), 0),
    export_sha256: run[0]?.export_sha256 ?? null,
    key_inventory_sha256: mark[0]?.value?.keyInventorySha256 ?? null,
  };
}

export const section: ReportSection = { key: "roll", build: buildRoll };

export const OWNER_REDACTION_RULE = "sales_confidential_code";

export const confidentialitySection: ReportSection = {
  key: "confidentiality",
  async build(sql, jobId) {
    const rows = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM parcels WHERE job_id = ${jobId} AND owner_redacted`;
    return { redacted: rows[0]?.n ?? 0, rule: OWNER_REDACTION_RULE };
  },
};
