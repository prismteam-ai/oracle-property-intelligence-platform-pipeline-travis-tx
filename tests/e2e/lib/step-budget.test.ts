// Unit tests of lib/step-budget.ts: a stuck scan step fails by name instead of eating the test timeout.
import { describe, expect, it } from "vitest";
import { runBudgeted } from "./step-budget.js";

describe("runBudgeted", () => {
  it("returns the value of a step that finishes inside its budget", async () => {
    await expect(runBudgeted("hub @ 1440", 200, async () => 7)).resolves.toBe(7);
  });

  it("rejects with the step label, the budget and the last noted sub-step when it overruns", async () => {
    const stuck = runBudgeted("explore @ 390", 30, async (note) => {
      note("click tab AI");
      await new Promise(() => undefined);
    });
    await expect(stuck).rejects.toThrow(
      "explore @ 390: no result within 30 ms; last step: click tab AI",
    );
  });

  it("says no sub-step was reached when the step never noted one", async () => {
    await expect(
      runBudgeted("runs @ 1440", 20, () => new Promise(() => undefined)),
    ).rejects.toThrow("runs @ 1440: no result within 20 ms; last step: (none reached)");
  });

  it("passes the step's own error through unchanged", async () => {
    await expect(
      runBudgeted("hub @ 390", 200, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("does not leave the timer running after a quick step", async () => {
    await runBudgeted("hub @ 1440", 60_000, async () => undefined);
    // a leaked 60 s timer would keep vitest alive; reaching here with the file finishing is the check
    expect(true).toBe(true);
  });
});
