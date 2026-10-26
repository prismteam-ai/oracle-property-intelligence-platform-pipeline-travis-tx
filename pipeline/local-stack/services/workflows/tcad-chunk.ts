// A-04 T026: binds `TcadChunk` (oracle-runtime travis/tcad/chunk.ts), one child per ~10k export
// records. Each part is journaled: prepare (parse → redact → map → mapped artifact, pilot
// zips) as one ctx.run, then ONE Loader merge (track tcad, the only writer), then cleanup; a
// retry after a crash never re-reads a deleted input (prepareChunk returns the recorded outcome).
// Deterministic failures are TerminalErrors (no endless retry); on any terminal failure the
// unredacted chunk input and the mapped artifact are removed (OR-m2). Below 5 GiB free the chunk
// stops before it prepares and before it merges (OR-M5).
import type * as Restate from "@restatedev/restate-sdk";
import { MIN_FREE_BYTES, freeBytesAt } from "../../../oracle-runtime/travis/backbone/disk-guard.js";
import { cleanupChunk, prepareChunk, type ChunkOutcome, type ChunkSpec } from "../../../oracle-runtime/travis/tcad/chunk.js";
import { loaderInput } from "../../../oracle-runtime/travis/tcad/workflow.js";
import { LOADER_KEY, MERGE_MAX_RETRIES, asTerminal, type createLoader } from "../loader.js";

type LoaderDefinition = ReturnType<typeof createLoader>;

export const TCAD_CHUNK = "TcadChunk";

export interface ChunkServiceOptions {
  /** Free bytes on the run volume (injectable for tests). */
  freeBytes?: (path: string) => number;
}

export function createService(restate: typeof Restate, options: ChunkServiceOptions = {}) {
  const free = options.freeBytes ?? freeBytesAt;
  // The free-space reading differs between a run and its replay and decides the control flow, so
  // it is journaled (ctx.run); a terminal throw inside is journaled too.
  const guardDisk = (ctx: Restate.Context, name: string, path: string): Promise<boolean> =>
    ctx.run(name, async () => {
      let bytes: number;
      try {
        bytes = free(path);
      } catch {
        return true; // the volume cannot be read: the writes will fail loudly if it is full
      }
      if (bytes < MIN_FREE_BYTES) throw new restate.TerminalError("disk below 5 GiB");
      return true;
    });
  return restate.service({
    name: TCAD_CHUNK,
    handlers: {
      run: async (ctx: Restate.Context, spec: ChunkSpec): Promise<ChunkOutcome> => {
        try {
          await guardDisk(ctx, `disk-before-prepare-c${spec.n}`, spec.mappedPath.replace(/\/[^/]*$/, ""));
          const out = await ctx.run(
            `prepare-c${spec.n}`,
            async () => {
              try {
                return await prepareChunk(spec);
              } catch (error) {
                throw asTerminal(restate, error) ?? error;
              }
            },
            { maxRetryAttempts: MERGE_MAX_RETRIES },
          );
          await guardDisk(ctx, `disk-before-merge-c${spec.n}`, spec.mappedPath.replace(/\/[^/]*$/, ""));
          await ctx
            .objectClient<LoaderDefinition>({ name: "Loader" } as LoaderDefinition, LOADER_KEY)
            .merge({
              track: "tcad",
              input: loaderInput(spec.jobId, { kind: "chunk", artifactPath: spec.mappedPath, artifactSha256: out.mappedSha256 }),
            });
          await ctx.run(`cleanup-c${spec.n}`, async () => {
            cleanupChunk(spec);
            return true;
          });
          return out;
        } catch (error) {
          const terminal = asTerminal(restate, error);
          if (terminal !== null) {
            cleanupChunk(spec); // never leave an unredacted input behind a failed run
            throw terminal;
          }
          throw error;
        }
      },
    },
    options: { inactivityTimeout: { minutes: 30 }, abortTimeout: { minutes: 60 } },
  });
}
