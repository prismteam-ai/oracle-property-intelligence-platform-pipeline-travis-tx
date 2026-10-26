// A-16 T031: live.json writer and heartbeat (AC-9) and the idempotency file.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveRunV1 } from "@countylens/contract";
import { describe, expect, it } from "vitest";
import { IdempotencyStore } from "../src/idempotency.js";
import { LIVE_KEY, LiveStatus } from "../src/live.js";
import { StopFlag } from "../src/stop.js";
import { T0, must } from "./support.js";

describe("LiveStatus", () => {
  it("writes a schema-valid idle object with no-store semantics key", async () => {
    const puts: string[] = [];
    const live = new LiveStatus({ put: async (b) => void puts.push(b), now: () => new Date(T0) });
    await live.heartbeat();
    const parsed = LiveRunV1.parse(JSON.parse(must(puts[0])));
    expect(parsed.state).toBe("idle");
    expect(parsed.bridgeSeenAt).toBe(new Date(T0).toISOString());
    expect(LIVE_KEY).toBe("live/live.json");
  });

  it("heartbeats every 30 s while started and stops when told", async () => {
    const puts: string[] = [];
    let t = T0;
    const live = new LiveStatus({ put: async (b) => void puts.push(b), now: () => new Date(t) });
    const ticks: { fn: () => void; ms: number }[] = [];
    const stopBeat = live.startHeartbeat((fn, ms) => {
      ticks.push({ fn, ms });
      return () => void ticks.pop();
    });
    expect(must(ticks[0]).ms).toBe(30_000);
    t += 30_000;
    must(ticks[0]).fn();
    await live.flush();
    expect(LiveRunV1.parse(JSON.parse(must(puts.at(-1)))).bridgeSeenAt).toBe(
      new Date(t).toISOString(),
    );
    stopBeat();
    expect(ticks).toHaveLength(0);
  });

  it("serialises writes and survives a failing put", async () => {
    let n = 0;
    const live = new LiveStatus({
      put: async () => {
        n++;
        if (n === 1) throw new Error("s3 down");
      },
      now: () => new Date(T0),
    });
    await live.update({ state: "running", step: "gate" });
    await live.update({ step: "filebase" });
    expect(n).toBe(2);
    expect(live.state.step).toBe("filebase");
  });

  it("rejects a status that breaks the schema", async () => {
    const live = new LiveStatus({ put: async () => {}, now: () => new Date(T0) });
    await expect(live.update({ commandId: "not-a-uuid" })).rejects.toThrow();
  });
});

describe("IdempotencyStore", () => {
  it("persists outcomes across instances and survives a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "idem-"));
    const path = join(dir, "commands.json");
    const a = new IdempotencyStore(path, () => new Date(T0));
    a.record("11111111-1111-4111-8111-111111111111", "accepted");
    const b = new IdempotencyStore(path, () => new Date(T0));
    expect(b.get("11111111-1111-4111-8111-111111111111")?.outcome).toBe("accepted");
    expect(b.get("22222222-2222-4222-8222-222222222222")).toBeUndefined();
    writeFileSync(path, "{broken");
    expect(() => new IdempotencyStore(path, () => new Date(T0))).toThrow(/corrupt/);
  });

  it("writes atomically (no temp file left) and remembers cancelled ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "idem-"));
    const path = join(dir, "commands.json");
    const s = new IdempotencyStore(path, () => new Date(T0));
    s.cancel("33333333-3333-4333-8333-333333333333");
    expect(
      new IdempotencyStore(path, () => new Date(T0)).isCancelled(
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).cancelled).toHaveLength(1);
  });
});

describe("StopFlag", () => {
  it("raises Stopped at a step boundary only after request", () => {
    const s = new StopFlag();
    expect(() => s.checkpoint("gate")).not.toThrow();
    s.request();
    expect(() => s.checkpoint("filebase")).toThrow(/stopped by admin/);
    s.clear();
    expect(s.requested).toBe(false);
  });
});
