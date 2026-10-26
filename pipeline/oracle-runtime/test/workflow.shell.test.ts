// Supporting tests for T014 (TravisDiscovery workflow shell). Synthetic receipts only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CaptureReceipt } from "../travis/lib/source-client.js";
import type { PriorExport } from "../travis/discovery/probes/tcad.js";
import {
  PRIOR_EXPORT_STEP,
  WORKFLOW_NAME,
  createTravisDiscovery,
  type ProbeContext,
  runDiscovery,
  stepKey,
  type DiscoveryIO,
  type ProbeStep,
  type RunRecord,
} from "../travis/discovery/workflow.js";
import { must } from "./helpers.js";

function receipt(outcome: CaptureReceipt["outcome"], status: number | null): CaptureReceipt {
  return {
    url: "https://example.test/x",
    method: "GET",
    status,
    bytes: 0,
    sha256: "0".repeat(64),
    captured_at: "2026-01-01T00:00:00.000Z",
    user_agent: "synthetic",
    attempts: 1,
    outcome,
    geo_signal: "none",
    app_token_used: false,
    timeout_ms: null,
    blocked_reason: outcome === "blocked" ? "http-403" : null,
    rate_limits_observed: null,
  };
}

function fakeIO(): { io: DiscoveryIO; saved: RunRecord[]; journal: string[] } {
  const saved: RunRecord[] = [];
  const journal: string[] = [];
  const io: DiscoveryIO = {
    now: async () => new Date("2026-01-01T00:00:00Z"),
    run: async (name, fn) => {
      journal.push(name);
      return fn();
    },
    save: (record) => {
      saved.push(structuredClone(record));
    },
  };
  return { io, saved, journal };
}

describe("stepKey", () => {
  it("is source:measurement:captured_date", () => {
    expect(
      stepKey("tcad_certified", "assessed_parcel_count", new Date("2026-10-19T23:59:00Z")),
    ).toBe("tcad_certified:assessed_parcel_count:2026-10-19");
  });

  it("rejects parts that contain a colon", () => {
    expect(() => stepKey("tcad_certified", "a:b", new Date("2026-10-19T00:00:00Z"))).toThrow();
  });
});

describe("runDiscovery (workflow shell)", () => {
  it("records an empty run: DISCOVERING then READY, no blockers, no auto-advance", async () => {
    const { io, saved, journal } = fakeIO();
    const record = await runDiscovery(io, "run-1", []);
    expect(saved.map((r) => r.state)).toEqual(["DISCOVERING", "READY"]);
    expect(journal).toEqual([]);
    expect(record).toMatchObject({
      run_id: "run-1",
      started_at: "2026-01-01T00:00:00.000Z",
      state: "READY",
      blockers: [],
      steps: [],
      validator: null,
      auto_advance_to_seed: false,
    });
  });

  it("journals each probe under its idempotency key", async () => {
    const { io, journal } = fakeIO();
    const steps: ProbeStep[] = [
      { source_key: "austin_permits", measurement: "count", probe: async () => receipt("ok", 200) },
      { source_key: "tx_comptroller", measurement: "count", probe: async () => receipt("ok", 200) },
    ];
    const record = await runDiscovery(io, "run-2", steps);
    expect(journal).toEqual(["austin_permits:count:2026-01-01", "tx_comptroller:count:2026-01-01"]);
    expect(record.state).toBe("READY");
    expect(record.steps.map((s) => s.key)).toEqual(journal);
  });

  it("a blocked or failed probe moves the run to WAITING_HUMAN with a blocker", async () => {
    const { io, saved } = fakeIO();
    const steps: ProbeStep[] = [
      {
        source_key: "tcad_certified",
        measurement: "export",
        probe: async () => receipt("blocked", 403),
      },
      {
        source_key: "tx_comptroller",
        measurement: "count",
        probe: async () => receipt("failed", 503),
      },
      { source_key: "austin_permits", measurement: "count", probe: async () => receipt("ok", 200) },
    ];
    const record = await runDiscovery(io, "run-3", steps);
    expect(record.state).toBe("WAITING_HUMAN");
    expect(record.blockers.map((b) => b.source_key)).toEqual(["tcad_certified", "tx_comptroller"]);
    expect(must(record.blockers[0]).receipt.status).toBe(403);
    expect(must(saved.at(-1)).state).toBe("WAITING_HUMAN");
    expect(record.auto_advance_to_seed).toBe(false);
  });
});

describe("createTravisDiscovery (Restate binding)", () => {
  it("defines the TravisDiscovery workflow through the injected SDK", () => {
    const captured: Array<{ name: string; handlers: Record<string, unknown> }> = [];
    const sdk = {
      workflow: (def: { name: string; handlers: Record<string, unknown> }) => {
        captured.push(def);
        return def;
      },
    };
    createTravisDiscovery(sdk as unknown as Parameters<typeof createTravisDiscovery>[0]);
    expect(WORKFLOW_NAME).toBe("TravisDiscovery");
    expect(captured).toHaveLength(1);
    expect(must(captured[0]).name).toBe("TravisDiscovery");
    expect(Object.keys(must(captured[0]).handlers).sort()).toEqual(["resolve", "run", "status"]);
  });

  it("imports the Restate SDK type-only, so the host's single SDK instance is used", () => {
    const path = fileURLToPath(new URL("../travis/discovery/workflow.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const sdkImports = source
      .split("\n")
      .filter((line) => line.includes("@restatedev/restate-sdk"));
    expect(sdkImports.length).toBeGreaterThan(0);
    for (const line of sdkImports) expect(line).toMatch(/^import type /);
  });
});

describe("CR2-5: the prior export is read from the catalog inside a journaled step", () => {
  class Stop extends Error {}
  class Terminal extends Error {}
  const prior: PriorExport = {
    receipt: receipt("ok", 200),
    path: "/synthetic/export.zip",
    seconds: 1,
  };

  /** Runs the `run` handler until the probes are built; `journal` replays recorded steps. */
  async function runUntilProbes(
    readPriorExport: () => PriorExport | null,
    journal: Map<string, unknown>,
  ): Promise<{ steps: string[]; reads: number; context: ProbeContext | null; error: unknown }> {
    let handlers: Record<string, (ctx: unknown, input?: unknown) => Promise<unknown>> = {};
    const sdk = {
      workflow: (def: { handlers: typeof handlers }) => {
        handlers = def.handlers;
        return def;
      },
      TerminalError: Terminal,
    };
    let reads = 0;
    let context: ProbeContext | null = null;
    createTravisDiscovery(sdk as unknown as Parameters<typeof createTravisDiscovery>[0], {
      readPriorExport: () => {
        reads += 1;
        return readPriorExport();
      },
      probes: (c) => {
        context = c;
        throw new Stop("probes built");
      },
    });
    const steps: string[] = [];
    const ctx = {
      key: "run-cr2-5",
      date: { now: async () => 0 },
      set: () => undefined,
      run: async (name: string, fn: () => Promise<unknown>) => {
        steps.push(name);
        if (journal.has(name)) return journal.get(name);
        const value = await fn();
        journal.set(name, JSON.parse(JSON.stringify(value)) as unknown);
        return value;
      },
    };
    let error: unknown = null;
    try {
      await must(handlers.run)(ctx, {});
    } catch (e) {
      error = e;
    }
    return { steps, reads, context, error };
  }

  it("journals the read and hands the probes its value; a replay does not read again", async () => {
    const journal = new Map<string, unknown>();
    const first = await runUntilProbes(() => prior, journal);
    expect(first.error).toBeInstanceOf(Stop);
    expect(first.steps).toEqual([PRIOR_EXPORT_STEP]);
    expect(first.reads).toBe(1);
    expect(first.context).toEqual({ priorExport: prior });
    // replay: the catalog now says something else, but the journaled value is used
    const replay = await runUntilProbes(() => null, journal);
    expect(replay.reads).toBe(0);
    expect(replay.context).toEqual({ priorExport: prior });
  });

  it("a catalog with no export receipt gives null", async () => {
    const r = await runUntilProbes(() => null, new Map());
    expect(r.context).toEqual({ priorExport: null });
  });

  it("an unreadable catalog is a terminal error inside the step; the probes are not built", async () => {
    const r = await runUntilProbes(() => {
      throw new Error("catalog schema: parcel.export_receipt.sha256 invalid");
    }, new Map());
    expect(r.error).toBeInstanceOf(Terminal);
    expect(String((r.error as Error).message)).toMatch(
      /reading the prior TCAD export from the catalog failed: catalog schema/,
    );
    expect(r.steps).toEqual([PRIOR_EXPORT_STEP]);
    expect(r.context).toBeNull();
  });
});
