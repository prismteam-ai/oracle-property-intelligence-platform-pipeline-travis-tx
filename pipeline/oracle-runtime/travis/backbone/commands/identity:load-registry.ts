// A-07 T019 (Track A, contracts/cli.md): `backbone identity:load-registry --source
// tx-comptroller --scope travis`. Talks to two boundaries only: the live Comptroller source
// (through travis/adapters/socrata/tx-comptroller.ts, the single shared adapter, T010) and
// the Restate ingress (Loader.merge on the `comptroller` track) -- never the database directly
// from this process. contracts/cli.md's db-env flag is dropped:
// it named a direct-DB write, which this CLI layer never does (same deviation note as T056's
// reconcile:merge redo).
//
// OR-B1: the egress country is read first (Cloudflare trace, never the IP) and checked. This
// is the first-ever run of this track, so there is no recorded reference egress yet
// (requireReference: false, matching discovery/discover.ts's own first-run case); the
// observed country is written into the report instead.
//
// Mints its own A-07 job id (travis-a07-identity-registry-<yyyymmddhhmmss>): RunContext.
// jobIdFor mints the A-04 travis-a04-... shape, which the A-07 tracks' job id pattern does
// not accept, so this verb reuses only the CLI's dispatch/flag-parsing/ingress client (not
// its job-id minting), same as T056.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { BackboneCommand } from "../cli.js";
import { checkEgress } from "../../lib/egress.js";
import { loadComptrollerRegistry } from "../../adapters/socrata/tx-comptroller.js";

const Args = z
  .object({ source: z.literal("tx-comptroller"), scope: z.enum(["travis", "statewide"]) })
  .strict();
type Args = z.infer<typeof Args>;

export const A07_JOB_ID = /^travis-a07-[a-z0-9-]+$/;

function mintA07JobId(kind: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = `travis-a07-${kind}-${stamp}`;
  if (!A07_JOB_ID.test(id)) throw new Error(`invalid A-07 job id: ${id}`);
  return id;
}

interface MergeResult {
  track: string;
  skipped: boolean;
  rowsWritten: number;
}

export const command: BackboneCommand<Args> = {
  verb: "identity:load-registry",
  args: Args,
  startsRun: () => false,
  async run(ctx, a) {
    ctx.diskGuard();
    const jobId = mintA07JobId("identity-registry", new Date());

    const egress = await checkEgress({ reference: null, requireReference: false });
    if (!egress.ok) {
      ctx.print(`identity:load-registry: refused: ${egress.reason}`);
      return { jobId, exitCode: 1, jobIdPrinted: false };
    }
    ctx.print(
      `identity:load-registry: egress country ${egress.egress.country} (recorded with the run)`,
    );

    const repoRoot = resolve(new URL("../../../../../", import.meta.url).pathname);
    const jobDir = resolve(repoRoot, `pipeline/data/identity/travis/${jobId}`);
    mkdirSync(jobDir, { recursive: true });

    const capturedAt = new Date().toISOString();
    const load = await loadComptrollerRegistry({
      client: ctx.sourceClient(),
      jobDir,
      scope: a.scope,
    });
    if (load.status !== "ok") {
      ctx.print(`identity:load-registry: ${load.status}: ${load.reason ?? "no reason given"}`);
      return { jobId, exitCode: load.status === "blocked" ? 2 : 1, jobIdPrinted: false };
    }
    ctx.print(
      `identity:load-registry: loaded ${load.rowCount} rows over ${load.pages} page(s); watermark=${load.watermark ?? "none"}; digest=${load.snapshotDigest}`,
    );

    const artifactPath = `${jobDir}/registry-rows.json`;
    const artifactSha256 = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");

    const mergeResult = await ctx.ingress.call<MergeResult>(
      "Loader",
      "merge",
      {
        track: "comptroller",
        input: {
          kind: "load_registry",
          jobId,
          artifactPath,
          artifactSha256,
          scope: a.scope,
          watermark: load.watermark,
          sourceUrl: load.sourceUrl,
          capturedAt,
        },
      },
      "travis",
    );
    ctx.print(
      `identity:load-registry: ${mergeResult.skipped ? "already loaded (skipped)" : "loaded"}, rowsWritten=${mergeResult.rowsWritten}`,
    );

    const reportPath = resolve(
      repoRoot,
      `pipeline/data/identity/travis/${jobId}/registry-load-report.json`,
    );
    const report = {
      jobId,
      source: a.source,
      scope: a.scope,
      sourceUrl: load.sourceUrl,
      rowCount: load.rowCount,
      watermark: load.watermark,
      snapshotDigest: load.snapshotDigest,
      pages: load.pages,
      artifactSha256,
      capturedAt,
      egress: egress.egress,
      mergeResult,
    };
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    ctx.print(`report: ${reportPath}`);

    return { jobId, exitCode: 0, jobIdPrinted: false };
  },
};
