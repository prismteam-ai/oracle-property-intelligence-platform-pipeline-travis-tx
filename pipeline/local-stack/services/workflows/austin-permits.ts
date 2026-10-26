// A-04 T051: the Restate binding of the AustinPermits workflow (logic in oracle-runtime
// travis/permits/workflow.ts; durable-workflow-builder). Auto-registered by app.ts through
// `createService(restate)`, which receives app.ts's one SDK instance (the SDK is imported
// type-only here).
//
// Key: `austin-3syk-w9eu-<mode>-<stamp>` (the `backbone permits` verb mints it). One journaled
// `ctx.run` per keyset page (returning only {lastId, sha256, rows, maxUpdatedAt}); every page,
// the final counts and any stop go to the single writer, the Loader virtual object (`travis`),
// as a journaled call. Requests go through one source client with host spacing on
// (data.austintexas.gov: 1 in flight, ≥ 1 s apart), the project User-Agent and no app token.
import type * as Restate from "@restatedev/restate-sdk";
import { createSourceClient } from "../../../oracle-runtime/travis/lib/source-client.js";
import { readCatalog } from "../../../oracle-runtime/travis/discovery/write-catalog.js";
import { jurisdictionLimitations } from "../../../oracle-runtime/travis/permits/jurisdictions-report.js";
import { AustinWatermark, PERMITS_SOURCE_KEY } from "../../../oracle-runtime/travis/permits/merge-input.js";
import {
  DEFAULT_ARTIFACTS_ROOT,
  PermitsRunInput,
  WORKFLOW_NAME,
  runAustinPermits,
  type PermitsDeps,
  type PermitsIO,
  type PermitsRunResult,
} from "../../../oracle-runtime/travis/permits/workflow.js";
import { LOADER_KEY, failRunOnTerminal, lazyQueryDb, type createLoader } from "../loader.js";

type LoaderDefinition = ReturnType<typeof createLoader>;

const queryDb = lazyQueryDb();

/** Read-only: the last Austin watermark (the Loader wrote it with its merge). */
async function readWatermark(): Promise<AustinWatermark | null> {
  const rows = await queryDb()<{ value: unknown }[]>`
    SELECT value FROM watermarks WHERE track = 'permits' AND source_key = ${PERMITS_SOURCE_KEY}`;
  const parsed = AustinWatermark.safeParse(rows[0]?.value);
  return parsed.success ? parsed.data : null;
}

export function createService(restate: typeof Restate) {
  const deps: PermitsDeps = {
    client: createSourceClient({ hostSpacing: true, appToken: "" }),
    artifactsRoot: DEFAULT_ARTIFACTS_ROOT,
    readWatermark,
    limitations: () => jurisdictionLimitations(readCatalog().permits?.jurisdictions ?? []),
  };
  return restate.workflow({
    name: WORKFLOW_NAME,
    handlers: {
      run: async (ctx: Restate.WorkflowContext, input: unknown): Promise<PermitsRunResult> => {
        const loader = ctx.objectClient<LoaderDefinition>({ name: "Loader" } as LoaderDefinition, LOADER_KEY);
        const io: PermitsIO = {
          now: async () => new Date(await ctx.date.now()),
          sleep: (ms) => ctx.sleep(ms),
          // the page loop owns its 5 attempts; a Restate retry on top would re-request an ~88 MB page
          run: (name, fn) => ctx.run(name, fn, { maxRetryAttempts: 1 }),
          merge: async (_name, mergeInput) => loader.merge({ track: "permits", input: mergeInput }),
          fail: (message) => new restate.TerminalError(message),
        };
        const id = PermitsRunInput.safeParse(input);
        try {
          // a terminal failure (a source error, a refused page order) closes the run row
          return await failRunOnTerminal(restate, ctx, id.success ? id.data.jobId : null, () =>
            runAustinPermits(io, input, deps),
          );
        } catch (error) {
          if (error instanceof Error && error.name === "ZodError") {
            throw new restate.TerminalError(`AustinPermits.run: invalid input: ${error.message}`);
          }
          throw error;
        }
      },
    },
    options: {
      inactivityTimeout: { minutes: 30 },
      abortTimeout: { minutes: 60 },
    },
  });
}
