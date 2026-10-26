// A-04 T043: `GisImport`, the durable workflow behind `backbone coords` (key = the coords job id,
// `travis-a04-coords-…`). Bound by pipeline/local-stack/services/workflows/gis-import.ts with the
// local stack's single Restate SDK and a `merge` that calls the Loader (the only Query DB writer).
//
//   1. import (when artifactDir is given): inspect the US-runner artifact offline in a journaled
//      step (import.ts), then Loader.merge({track: "gis", kind: "import"}). An artifact without
//      complete.json imports as `blocked` with `gis: blocked at {ts}; coverage not complete`;
//      it is never reported complete.
//   1b. address points (when addressPointsDir is given): Loader.merge({track: "gis",
//      kind: "address_points"}) loads the City of Austin layer cache (ADR 0004) before assembly.
//   2. assemble (when asked): Loader.merge({track: "gis", kind: "assemble"}) ranks one
//      coordinate per account (assemble-coordinates.ts). Re-run after `permits --link`.
// The Restate SDK is imported type-only (one runtime instance, in local-stack).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as Restate from "@restatedev/restate-sdk";
import { z } from "zod";
import { inspectArtifact, type ImportDetail } from "./import.js";

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);

export const GisImportRequest = z
  .object({
    artifactDir: z.string().min(1).nullable(),
    assemble: z.boolean(),
    /** Limit assembly to one TCAD job's parcels (null = every parcel). */
    tcadJobId: JobId.nullable(),
    /**
     * A-11 Run 3 (ADR 0004): the cache directory written by `fetch-address-layer`. When given, the
     * layer is loaded into the Query DB (Loader gis track, kind address_points) before assembly.
     */
    addressPointsDir: z.string().min(1).nullable().default(null),
  })
  .strict();
export type GisImportRequest = z.infer<typeof GisImportRequest>;

/** The Loader `gis` track inputs (pipeline/local-stack/services/tracks/gis.ts). */
export type GisMergeInput =
  | {
      kind: "import";
      jobId: string;
      artifactPath: string;
      artifactSha256: string;
      artifactRunId: string;
    }
  | {
      kind: "assemble";
      jobId: string;
      artifactPath: string;
      artifactSha256: string;
      tcadJobId: string | null;
    }
  | {
      kind: "address_points";
      jobId: string;
      artifactPath: string;
      artifactSha256: string;
    };

export interface GisImportDeps {
  merge(
    ctx: Restate.WorkflowContext,
    input: GisMergeInput,
  ): PromiseLike<{ rowsWritten: number; skipped: boolean }>;
  /** Called once with the run's job id when the handler ends in a terminal failure. */
  onTerminalFailure?(ctx: Restate.WorkflowContext, jobId: string): PromiseLike<unknown>;
}

export interface GisImportResult {
  jobId: string;
  gis: null | {
    artifactRunId: string;
    artifactSha256: string;
    status: "complete" | "blocked";
    detail: ImportDetail;
    limitation: string | null;
    pages: number;
    sourceCount: number | null;
    rowsWritten: number;
    skipped: boolean;
  };
  addressPoints: null | {
    sha256: string;
    recordCount: number;
    rowsWritten: number;
    skipped: boolean;
  };
  assembled: null | { rowsWritten: number; skipped: boolean };
}

export function createGisImport(restate: typeof Restate, deps: GisImportDeps) {
  return restate.workflow({
    name: "GisImport",
    handlers: {
      run: async (ctx: Restate.WorkflowContext, raw: unknown): Promise<GisImportResult> => {
        const key = JobId.safeParse(ctx.key);
        if (!key.success)
          throw new restate.TerminalError("GisImport: key must be a travis-a04 job id");
        try {
          return await runBody(ctx, raw, key.data);
        } catch (error) {
          // a run that ends in a terminal failure must not stay `running` (FR-025 index)
          if (error instanceof restate.TerminalError) await deps.onTerminalFailure?.(ctx, key.data);
          throw error;
        }
      },
    },
  });

  async function runBody(
    ctx: Restate.WorkflowContext,
    raw: unknown,
    jobId: string,
  ): Promise<GisImportResult> {
    const parsed = GisImportRequest.safeParse(raw);
    if (!parsed.success) {
      throw new restate.TerminalError("GisImport.run: {artifactDir, assemble, tcadJobId} required");
    }
    const req = parsed.data;
    if (req.artifactDir === null && !req.assemble && req.addressPointsDir === null) {
      throw new restate.TerminalError(
        "GisImport.run: nothing to do (no artifact, no address points, no assemble)",
      );
    }
    let gis: GisImportResult["gis"] = null;
    if (req.artifactDir !== null) {
      const dir = req.artifactDir;
      const s = await ctx.run("inspect-artifact", () => {
        try {
          const x = inspectArtifact(dir);
          return {
            root: x.root,
            artifactRunId: x.artifactRunId,
            artifactSha256: x.artifactSha256,
            status: x.status,
            detail: x.detail,
            limitation: x.limitation,
            pages: x.pages.length,
            sourceCount: x.sourceCount,
          };
        } catch (error) {
          // a bad artifact is a human matter, never retried
          throw new restate.TerminalError(error instanceof Error ? error.message : String(error));
        }
      });
      const m = await deps.merge(ctx, {
        kind: "import",
        jobId,
        artifactPath: s.root,
        artifactSha256: s.artifactSha256,
        artifactRunId: s.artifactRunId,
      });
      const { root: _root, ...rest } = s;
      gis = { ...rest, rowsWritten: m.rowsWritten, skipped: m.skipped };
    }
    let addressPoints: GisImportResult["addressPoints"] = null;
    if (req.addressPointsDir !== null) {
      const dir = req.addressPointsDir;
      const r = await ctx.run("inspect-address-layer", () => {
        try {
          const receipt = JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")) as {
            sha256?: unknown;
            record_count?: unknown;
          };
          if (typeof receipt.sha256 !== "string" || typeof receipt.record_count !== "number")
            throw new Error("address layer receipt.json has no sha256 or record_count");
          return { sha256: receipt.sha256, recordCount: receipt.record_count };
        } catch (error) {
          // a missing or malformed cache is a human matter, never retried
          throw new restate.TerminalError(error instanceof Error ? error.message : String(error));
        }
      });
      const m = await deps.merge(ctx, {
        kind: "address_points",
        jobId,
        artifactPath: dir,
        artifactSha256: r.sha256,
      });
      addressPoints = { ...r, rowsWritten: m.rowsWritten, skipped: m.skipped };
    }
    let assembled: GisImportResult["assembled"] = null;
    if (req.assemble) {
      const m = await deps.merge(ctx, {
        kind: "assemble",
        jobId,
        artifactPath: `assemble:${jobId}`,
        artifactSha256: createHash("sha256").update(`assemble:${jobId}`).digest("hex"),
        tcadJobId: req.tcadJobId,
      });
      assembled = { rowsWritten: m.rowsWritten, skipped: m.skipped };
    }
    return { jobId, gis, addressPoints, assembled };
  }
}
