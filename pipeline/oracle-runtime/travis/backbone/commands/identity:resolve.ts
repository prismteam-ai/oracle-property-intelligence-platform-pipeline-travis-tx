// A-07 T020 (Track A, contracts/cli.md): `backbone identity:resolve --scope austin-roofing-permits
// --registry-snapshot <digest>`. Talks only to the Restate ingress (Loader.merge on the
// `comptroller` track's `resolve_permits` kind, then IdentityReport.summary) -- never
// the database directly from this process, same pattern as T019/T056.
//
// `--registry-snapshot` is the digest the caller expects to resolve against (normally the
// value T019's registry-load-report.json printed); the server recomputes its own digest from
// the live `comptroller_registry` table and the two are compared. A mismatch is reported as
// a limitation, not a hard failure here -- the registry can only have grown monotonically
// since the load (no deletes), and the resolver's correctness does not depend on which
// snapshot digest string is attached, only on which rows it actually read.
//
// Mints its own A-07 job id, same reasoning as identity:load-registry.ts and T056.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";

const Args = z
  .object({
    scope: z.literal("austin-roofing-permits"),
    registrySnapshot: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type Args = z.infer<typeof Args>;

export const A07_JOB_ID = /^travis-a07-[a-z0-9-]+$/;

function mintA07JobId(kind: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = `travis-a07-${kind}-${stamp}`;
  if (!A07_JOB_ID.test(id)) throw new Error(`invalid A-07 job id: ${id}`);
  return id;
}

/**
 * A full-table sweep (not an artifact-scoped load), so the idempotency key is content-
 * independent of the *permit* data, same reasoning as T056's reconcileArtifactSha256 -- but
 * it does depend on the registry snapshot: a corrected or updated registry is a genuinely
 * different resolution (the ledger is append-only, a later resolution is a new row with a
 * later effectiveOn, never an update in place), so folding `--registry-snapshot` into the
 * digest lets a changed registry re-run, while a repeat of the same registry digest is
 * correctly skipped.
 */
export function resolveArtifactSha256(scope: string, registrySnapshot: string): string {
  return createHash("sha256")
    .update(`identity-resolve-full-sweep:${scope}:${registrySnapshot}`)
    .digest("hex");
}

interface MergeResult {
  track: string;
  skipped: boolean;
  rowsWritten: number;
}

interface IdentityResolutionSummary {
  fiveStateTotals: {
    resolved: number;
    candidate: number;
    ambiguous: number;
    conflicting: number;
    unresolved: number;
  };
  permitTotal: number;
  matchRule: string | null;
  resolverVersion: string | null;
  registrySnapshotDigest: string | null;
  registryRowCount: number;
}

export const command: BackboneCommand<Args> = {
  verb: "identity:resolve",
  args: Args,
  startsRun: () => false,
  async run(ctx, a) {
    const jobId = mintA07JobId("identity-resolve", new Date());
    const effectiveOn = new Date().toISOString();
    const artifactPath = `query-db://property_improvements+comptroller_registry/${a.scope}`;
    const artifactSha256 = resolveArtifactSha256(a.scope, a.registrySnapshot);

    const mergeResult = await ctx.ingress.call<MergeResult>(
      "Loader",
      "merge",
      {
        track: "comptroller",
        input: {
          kind: "resolve_permits",
          jobId,
          artifactPath,
          artifactSha256,
          scope: a.scope,
          effectiveOn,
        },
      },
      "travis",
    );
    ctx.print(
      `identity:resolve ${a.scope} — ${mergeResult.skipped ? "already resolved (skipped)" : "resolved"}, rowsWritten=${mergeResult.rowsWritten}`,
    );

    const summary = await ctx.ingress.call<IdentityResolutionSummary>(
      "IdentityReport",
      "summary",
      null,
    );
    const sum = Object.values(summary.fiveStateTotals).reduce((x, y) => x + y, 0);
    ctx.print(
      `identity:resolve — resolved=${summary.fiveStateTotals.resolved} candidate=${summary.fiveStateTotals.candidate} ` +
        `ambiguous=${summary.fiveStateTotals.ambiguous} conflicting=${summary.fiveStateTotals.conflicting} ` +
        `unresolved=${summary.fiveStateTotals.unresolved} (sum=${sum}, permitTotal=${summary.permitTotal})`,
    );
    const registrySnapshotMatches = summary.registrySnapshotDigest === a.registrySnapshot;
    if (!registrySnapshotMatches) {
      ctx.print(
        `identity:resolve: note — the registry snapshot digest used by this run (${summary.registrySnapshotDigest}) ` +
          `differs from --registry-snapshot ${a.registrySnapshot}; recorded as a limitation, not a failure`,
      );
    }

    const repoRoot = resolve(new URL("../../../../../", import.meta.url).pathname);
    const reportPath = resolve(
      repoRoot,
      `pipeline/data/identity/travis/${jobId}/resolution-report.json`,
    );
    const report = {
      jobId,
      scope: a.scope,
      mergeResult,
      fiveStateTotals: summary.fiveStateTotals,
      fiveStateSum: sum,
      permitTotal: summary.permitTotal,
      sumMatchesPermitTotal: sum === summary.permitTotal,
      matchRule: summary.matchRule,
      resolverVersion: summary.resolverVersion,
      registrySnapshotDigest: summary.registrySnapshotDigest,
      registryRowCount: summary.registryRowCount,
      requestedRegistrySnapshot: a.registrySnapshot,
      registrySnapshotMatches,
      limitations: registrySnapshotMatches
        ? []
        : [
            `registry snapshot digest differs from --registry-snapshot (${a.registrySnapshot}); resolved against the live registry at run time instead`,
          ],
    };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    ctx.print(`report: ${reportPath}`);

    return { jobId, exitCode: 0, jobIdPrinted: false };
  },
};
