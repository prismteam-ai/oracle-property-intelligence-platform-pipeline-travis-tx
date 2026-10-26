// A-16 T031: the bridge loop against a fake SQS client (AC-7, AC-9).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveRunV1 } from "@countylens/contract";
import { describe, expect, it } from "vitest";
import { IdempotencyStore } from "../src/idempotency.js";
import { LiveStatus } from "../src/live.js";
import { Bridge } from "../src/loop.js";
import { StopFlag } from "../src/stop.js";
import type { RunOutcome } from "../src/types.js";
import { FakeQueue, T0, command, deferred, must } from "./support.js";

function setup(opts: { now?: () => number; lockHeld?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bridge-"));
  const queue = new FakeQueue();
  const puts: string[] = [];
  const now = opts.now ?? (() => T0 + 1000);
  const live = new LiveStatus({ put: async (b) => void puts.push(b), now: () => new Date(now()) });
  const idem = new IdempotencyStore(join(dir, "commands.json"), () => new Date(now()));
  const stop = new StopFlag();
  const runs: { id: string; hold: ReturnType<typeof deferred<RunOutcome>> }[] = [];
  let locks = 0;
  const bridge = new Bridge({
    queue,
    live,
    idem,
    stop,
    now,
    log: () => {},
    tryLock: () => {
      if (opts.lockHeld === true) return undefined;
      locks++;
      return () => void locks--;
    },
    runner: (cmd) => {
      const hold = deferred<RunOutcome>();
      runs.push({ id: cmd.commandId, hold });
      return hold.promise;
    },
  });
  return { dir, queue, puts, live, idem, stop, runs, bridge, locks: () => locks, now };
}

const last = (puts: string[]): LiveRunV1 =>
  LiveRunV1.parse(JSON.parse(must(puts[puts.length - 1])));

describe("Bridge.handle", () => {
  it("accepts a Start, records it, deletes the message, and starts the run", async () => {
    const s = setup();
    const cmd = command();
    const msg = s.queue.push(cmd);
    await s.bridge.handle(msg);
    expect(s.runs.map((r) => r.id)).toEqual([cmd.commandId]);
    expect(s.idem.get(cmd.commandId)?.outcome).toBe("accepted");
    expect(s.queue.deleted).toEqual([msg.receiptHandle]);
    expect(last(s.puts).state).toBe("running");
    expect(last(s.puts).lastCommand?.outcome).toBe("accepted");
    expect(s.locks()).toBe(1);
    must(s.runs[0]).hold.resolve({ outcome: "succeeded", runId: "r1" });
    await s.bridge.idle();
    expect(last(s.puts).state).toBe("succeeded");
    expect(s.locks()).toBe(0);
  });

  it("does not rerun a duplicate commandId; deletes it and says duplicate", async () => {
    const s = setup();
    const cmd = command();
    await s.bridge.handle(s.queue.push(cmd));
    must(s.runs[0]).hold.resolve({ outcome: "succeeded", runId: "r1" });
    await s.bridge.idle();
    const again = s.queue.push(cmd);
    await s.bridge.handle(again);
    expect(s.runs).toHaveLength(1);
    expect(s.queue.deleted).toContain(again.receiptHandle);
    expect(last(s.puts).lastCommand?.outcome).toBe("duplicate");
    // the stored outcome stays the original one
    expect(s.idem.get(cmd.commandId)?.outcome).toBe("accepted");
  });

  it("drops an expired command without running it", async () => {
    const s = setup({ now: () => T0 + 16 * 60 * 1000 });
    const cmd = command();
    const msg = s.queue.push(cmd);
    await s.bridge.handle(msg);
    expect(s.runs).toHaveLength(0);
    expect(s.idem.get(cmd.commandId)?.outcome).toBe("expired");
    expect(s.queue.deleted).toEqual([msg.receiptHandle]);
    expect(last(s.puts).lastCommand?.outcome).toBe("expired");
  });

  it("rejects a second Start while a run is active", async () => {
    const s = setup();
    await s.bridge.handle(s.queue.push(command()));
    const second = command();
    const msg = s.queue.push(second);
    await s.bridge.handle(msg);
    expect(s.runs).toHaveLength(1);
    expect(s.idem.get(second.commandId)?.outcome).toBe("rejected_active_run");
    expect(s.queue.deleted).toContain(msg.receiptHandle);
    const status = last(s.puts);
    expect(status.state).toBe("running");
    expect(status.lastCommand).toMatchObject({
      commandId: second.commandId,
      outcome: "rejected_active_run",
    });
  });

  it("rejects a Start when another process holds the run lock", async () => {
    const s = setup({ lockHeld: true });
    const cmd = command();
    await s.bridge.handle(s.queue.push(cmd));
    expect(s.runs).toHaveLength(0);
    expect(s.idem.get(cmd.commandId)?.outcome).toBe("rejected_active_run");
    expect(last(s.puts).state).toBe("idle");
  });

  it("leaves an invalid message undeleted so it reaches the DLQ", async () => {
    const s = setup();
    const msg = s.queue.push({ nope: true });
    await s.bridge.handle(msg);
    expect(s.queue.deleted).toEqual([]);
    expect(s.runs).toHaveLength(0);
    const garbage = s.queue.push("not json");
    await s.bridge.handle(garbage);
    expect(s.queue.deleted).toEqual([]);
  });

  it("Stop sets the flag, shows stopping, and the run ends as stopped by admin", async () => {
    const s = setup();
    await s.bridge.handle(s.queue.push(command()));
    const stopCmd = command({ action: "stop", window: null });
    await s.bridge.handle(s.queue.push(stopCmd));
    expect(s.stop.requested).toBe(true);
    expect(last(s.puts).state).toBe("stopping");
    expect(s.idem.get(stopCmd.commandId)?.outcome).toBe("accepted");
    must(s.runs[0]).hold.resolve({ outcome: "stopped", runId: "r1" });
    await s.bridge.idle();
    const status = last(s.puts);
    expect(status.state).toBe("stopped");
    expect(status.limitations).toContain("stopped by admin");
    expect(s.stop.requested).toBe(false);
  });

  it("a Stop naming a command that has not started cancels that Start later", async () => {
    const s = setup();
    const startCmd = command();
    const stopCmd = command({ action: "stop", window: null, targetRunId: startCmd.commandId });
    await s.bridge.handle(s.queue.push(stopCmd));
    expect(s.idem.get(stopCmd.commandId)?.outcome).toBe("accepted");
    await s.bridge.handle(s.queue.push(startCmd));
    expect(s.runs).toHaveLength(0);
    expect(s.idem.get(startCmd.commandId)?.outcome).toBe("cancelled");
  });

  it("records a failed run", async () => {
    const s = setup();
    await s.bridge.handle(s.queue.push(command()));
    must(s.runs[0]).hold.resolve({ outcome: "failed", runId: "r1", reason: "step gate exited 1" });
    await s.bridge.idle();
    const status = last(s.puts);
    expect(status.state).toBe("failed");
    expect(status.limitations.join(" ")).toContain("step gate exited 1");
  });
});

describe("Bridge.run loop", () => {
  it("long-polls until aborted and processes queued messages in order", async () => {
    const s = setup();
    const a = command();
    s.queue.push(a);
    const controller = new AbortController();
    let polls = 0;
    const origReceive = s.queue.receive.bind(s.queue);
    s.queue.receive = async () => {
      polls++;
      if (polls > 3) controller.abort();
      return origReceive();
    };
    await s.bridge.run(controller.signal);
    expect(s.runs).toHaveLength(1);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("stops polling and requests a stop when the kill switch is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-kill-"));
    const queue = new FakeQueue();
    const stop = new StopFlag();
    let killed = false;
    const bridge = new Bridge({
      queue,
      live: new LiveStatus({ put: async () => {}, now: () => new Date(T0) }),
      idem: new IdempotencyStore(join(dir, "c.json"), () => new Date(T0)),
      stop,
      now: () => T0,
      log: () => {},
      tryLock: () => () => {},
      runner: async () => ({ outcome: "succeeded", runId: "r" }),
      killSwitch: () => killed,
    });
    queue.receive = async () => {
      killed = true;
      return undefined;
    };
    await bridge.run(new AbortController().signal);
    expect(stop.requested).toBe(true);
  });

  it("backs off and keeps going when a receive fails", async () => {
    const s = setup();
    const controller = new AbortController();
    let calls = 0;
    const sleeps: number[] = [];
    s.queue.receive = async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      controller.abort();
      return undefined;
    };
    const bridge2 = new Bridge({
      queue: s.queue,
      live: s.live,
      idem: s.idem,
      stop: s.stop,
      now: s.now,
      log: () => {},
      tryLock: () => () => {},
      runner: async () => ({ outcome: "succeeded", runId: "r" }),
      sleep: async (ms) => void sleeps.push(ms),
    });
    await bridge2.run(controller.signal);
    expect(calls).toBe(2);
    expect(sleeps).toHaveLength(1);
  });
});
