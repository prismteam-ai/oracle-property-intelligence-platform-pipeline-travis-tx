// A-07 T056 (Track D, contracts/cli.md): `backbone reconcile:merge --entity-type
// property|owner|contractor`. Talks only to the Restate ingress (Loader.merge on the
// `reconcile` track, then ReconcileReport.summary) — never the database directly from this
// process (the direct-DB script this replaced was a contract deviation and has been removed).
//
// Mints its own A-07 job id (`travis-a07-reconcile-<yyyymmddhhmmss>`): RunContext.jobIdFor
// always mints the A-04 `travis-a04-...` shape, which the A-07 Loader tracks' job id pattern
// does not accept (contracts/cli.md's A-07 verbs are a separate story from A-04's backbone
// ingest; this verb only reuses the CLI's command-dispatch/flag-parsing and ingress client, not
// its job-id minting). Writes the exact T056 report shape
// (`pipeline/data/reconcile/travis/<jobId>/merge-property-owner-report.json`) from the ingress
// response only — plain JSON serialization to disk, not a database write.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";

const ENTITY_TYPES = ["property", "owner", "contractor"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const Args = z.object({ entityType: z.enum(ENTITY_TYPES) }).strict();
type Args = z.infer<typeof Args>;

export const A07_JOB_ID = /^travis-a07-[a-z0-9-]+$/;

function mintA07JobId(kind: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = `travis-a07-${kind}-${stamp}`;
  if (!A07_JOB_ID.test(id)) throw new Error(`invalid A-07 job id: ${id}`);
  return id;
}

/** A content-independent, per-entity-type digest: this is a full-table reconciliation sweep
 *  (not an artifact-scoped load), so the Loader's idempotency check is scoped to "has this
 *  entity type's merge ever run", matching the roof-age re-run contract's "rowsWritten: 0". */
export function reconcileArtifactSha256(entityType: EntityType): string {
  return createHash("sha256").update(`reconcile-full-sweep:${entityType}`).digest("hex");
}

interface MergeResult {
  track: string;
  skipped: boolean;
  rowsWritten: number;
}

interface ReconcileEntitySummary {
  jobId: string | null;
  inputRecords: number;
  canonical: number;
  refused: number;
}

interface ReconcileSummary {
  property: ReconcileEntitySummary;
  owner: ReconcileEntitySummary;
  contractor: ReconcileEntitySummary;
  refusedMerges: Array<{
    entityType: EntityType;
    clusterId: string;
    tcadIds: string[];
    reason: string;
  }>;
}

export const command: BackboneCommand<Args> = {
  verb: "reconcile:merge",
  args: Args,
  startsRun: () => false,
  async run(ctx, a) {
    const jobId = mintA07JobId("reconcile", new Date());
    const artifactPath = `query-db://roll_reconciliation+parcels/${a.entityType}`;
    const artifactSha256 = reconcileArtifactSha256(a.entityType);

    const mergeResult = await ctx.ingress.call<MergeResult>(
      "Loader",
      "merge",
      {
        track: "reconcile",
        input: { kind: "merge", jobId, artifactPath, artifactSha256, entityType: a.entityType },
      },
      "travis",
    );
    ctx.print(
      `reconcile:merge ${a.entityType} — ${mergeResult.skipped ? "already merged (skipped)" : "merged"}, rowsWritten=${mergeResult.rowsWritten}`,
    );

    const summary = await ctx.ingress.call<ReconcileSummary>("ReconcileReport", "summary", null);
    const entity = summary[a.entityType];
    ctx.print(
      `reconcile:merge ${a.entityType} — inputRecords=${entity.inputRecords} canonical=${entity.canonical} refused=${entity.refused}`,
    );

    const repoRoot = resolve(new URL("../../../../../", import.meta.url).pathname);
    // T056 (property/owner) and T057 (contractor) write distinctly named report files per
    // tasks.md, even though both share this one verb and the same ReconcileReport summary.
    const reportName =
      a.entityType === "contractor"
        ? "merge-contractor-report.json"
        : "merge-property-owner-report.json";
    const reportPath = resolve(repoRoot, `pipeline/data/reconcile/travis/${jobId}/${reportName}`);
    const report = {
      jobId,
      entityType: a.entityType,
      mergeResult,
      entityTypes: {
        property: summary.property,
        owner: summary.owner,
        contractor: summary.contractor,
      },
      refusedMerges: summary.refusedMerges,
    };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    ctx.print(`report: ${reportPath}`);

    return { jobId, exitCode: 0, jobIdPrinted: false };
  },
};
