// SYNTHETIC TEST FIXTURE: a workflow file shaped like services/workflows/<name>.ts. It imports
// the Restate SDK type-only and records the SDK instance it was handed.
import type * as Restate from "@restatedev/restate-sdk";

export const seen: Array<typeof Restate> = [];

export function createService(restate: typeof Restate) {
  seen.push(restate);
  return restate.workflow({
    name: "FakeBackbone",
    handlers: { run: async (_ctx: Restate.WorkflowContext) => ({ ok: true }) },
  });
}
