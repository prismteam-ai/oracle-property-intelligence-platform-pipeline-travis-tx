// A-04 T043: binds `GisImport` (oracle-runtime travis/gis/workflow.ts) with this stack's Restate
// SDK (type-only import here; app.ts hands in the one runtime instance). Every write goes through
// the Loader virtual object (key `travis`), the only Query DB writer, on its `gis` track.
import type * as Restate from "@restatedev/restate-sdk";
import { createGisImport } from "../../../oracle-runtime/travis/gis/workflow.js";
import { LOADER_KEY, type createLoader } from "../loader.js";

type LoaderDefinition = ReturnType<typeof createLoader>;

export function createService(restate: typeof Restate) {
  return createGisImport(restate, {
    merge: (ctx, input) =>
      ctx
        .objectClient<LoaderDefinition>({ name: "Loader" } as LoaderDefinition, LOADER_KEY)
        .merge({ track: "gis", input }),
    // a terminal failure closes the run row so it cannot hold the FR-025 unique index
    onTerminalFailure: (ctx, jobId) =>
      ctx
        .objectClient<LoaderDefinition>({ name: "Loader" } as LoaderDefinition, LOADER_KEY)
        .failRun({ jobId }),
  });
}
