// The bridge loop (A-16 AC-7, AC-9): long-poll the command queue, validate, de-duplicate, check
// expiry, then act. A Start runs in the background while the loop keeps polling, so a Stop or a
// second Start is seen within one poll. A message is deleted only after its outcome is written to
// the idempotency file; a malformed message is left alone so SQS moves it to the DLQ (alarm).
import { RunCommandV1 } from "@countylens/contract";
import type { IdempotencyStore } from "./idempotency.js";
import type { LiveStatus } from "./live.js";
import type { StopFlag } from "./stop.js";
import type { CommandRunner, Logger, QueueClient, QueueMessage, RunOutcome } from "./types.js";

type Outcome = "accepted" | "rejected_active_run" | "expired" | "duplicate" | "cancelled";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BridgeDeps {
  queue: QueueClient;
  live: LiveStatus;
  idem: IdempotencyStore;
  stop: StopFlag;
  runner: CommandRunner;
  /** Takes the cross-process run lock; undefined when another live process holds it. */
  tryLock: () => (() => void) | undefined;
  now: () => number;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
  /** Tells the operator a run failed (machamp review M3): one SNS message to the Ops topic. */
  alert?: (subject: string, message: string) => Promise<void>;
  /** True when the operator asked the bridge to quit (kill file). */
  killSwitch?: () => boolean;
}

export class Bridge {
  readonly #d: BridgeDeps;
  #active: Promise<void> | undefined;
  #activeCommandId: string | undefined;

  constructor(deps: BridgeDeps) {
    this.#d = deps;
  }

  /** Resolves when the current run (if any) has ended. */
  async idle(): Promise<void> {
    await this.#active;
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.#d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let backoff = 1000;
    while (!signal.aborted) {
      if (this.#d.killSwitch?.() === true) {
        this.#d.log("kill switch set: asking the running step to finish, then exiting");
        this.#d.stop.request();
        await this.idle();
        return;
      }
      let msg: QueueMessage | undefined;
      try {
        msg = await this.#d.queue.receive();
        backoff = 1000;
      } catch (error) {
        this.#d.log(`receive failed: ${(error as Error).message}; retrying in ${backoff} ms`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
        continue;
      }
      if (msg === undefined) continue;
      try {
        await this.handle(msg);
      } catch (error) {
        // Never let one message end the loop; the message stays on the queue for redelivery.
        this.#d.log(`message ${msg.messageId} failed: ${(error as Error).message}`);
      }
    }
  }

  async handle(msg: QueueMessage): Promise<void> {
    const { idem, queue, live, log } = this.#d;
    let raw: unknown;
    try {
      raw = JSON.parse(msg.body);
    } catch {
      log(`message ${msg.messageId}: not JSON; left on the queue for the DLQ`);
      return;
    }
    const parsed = RunCommandV1.safeParse(raw);
    if (!parsed.success) {
      log(`message ${msg.messageId}: not a RunCommandV1; left on the queue for the DLQ`);
      return;
    }
    const cmd = parsed.data;

    const seen = idem.get(cmd.commandId);
    if (seen !== undefined) {
      log(`command ${cmd.commandId}: duplicate of an earlier ${seen.outcome}; deleted`);
      await live.update({ lastCommand: this.#last(cmd.commandId, "duplicate") });
      await queue.delete(msg.receiptHandle);
      return;
    }
    if (this.#d.now() >= Date.parse(cmd.expiresAt)) {
      log(`command ${cmd.commandId}: expired at ${cmd.expiresAt}; not run`);
      await this.#finish(msg, cmd.commandId, "expired");
      return;
    }
    if (cmd.action === "stop") return this.#handleStop(msg, cmd);
    if (idem.isCancelled(cmd.commandId)) {
      log(`command ${cmd.commandId}: cancelled by an earlier Stop; not run`);
      await this.#finish(msg, cmd.commandId, "cancelled");
      return;
    }
    return this.#handleStart(msg, cmd);
  }

  #last(commandId: string, outcome: Outcome) {
    return { commandId, outcome, at: new Date(this.#d.now()).toISOString() };
  }

  /** Record the outcome, then update live.json, then delete the message (in that order). */
  async #finish(msg: QueueMessage, commandId: string, outcome: Outcome): Promise<void> {
    this.#d.idem.record(commandId, outcome);
    await this.#d.live.update({ lastCommand: this.#last(commandId, outcome) });
    await this.#d.queue.delete(msg.receiptHandle);
  }

  async #handleStop(msg: QueueMessage, cmd: RunCommandV1): Promise<void> {
    const { idem, live, stop, log } = this.#d;
    const target = cmd.targetRunId;
    const aimsElsewhere =
      target !== undefined && target !== this.#activeCommandId && target !== live.state.runId;
    if (aimsElsewhere) {
      // Cancel a command that has not started: its Start is dropped if it arrives later.
      if (UUID.test(target)) idem.cancel(target);
      log(`stop ${cmd.commandId}: cancelled command ${target}`);
      await this.#finish(msg, cmd.commandId, "accepted");
      return;
    }
    if (this.#active !== undefined) {
      stop.request();
      log(`stop ${cmd.commandId}: the run will stop before its next step`);
      idem.record(cmd.commandId, "accepted");
      await live.update({ state: "stopping", lastCommand: this.#last(cmd.commandId, "accepted") });
      await this.#d.queue.delete(msg.receiptHandle);
      return;
    }
    log(`stop ${cmd.commandId}: nothing is running`);
    await this.#finish(msg, cmd.commandId, "accepted");
  }

  async #handleStart(msg: QueueMessage, cmd: RunCommandV1): Promise<void> {
    const { idem, live, log } = this.#d;
    const running = live.state.state === "running" || live.state.state === "stopping";
    const release = running || this.#active !== undefined ? undefined : this.#d.tryLock();
    if (release === undefined) {
      log(`command ${cmd.commandId}: a run is already running; rejected`);
      await this.#finish(msg, cmd.commandId, "rejected_active_run");
      return;
    }
    // From here the lock is held: any throw before #drive takes it over must release it
    // (code-review finding 3), or every later Start is refused until the bridge restarts.
    try {
      idem.record(cmd.commandId, "accepted");
      await live.update({
        state: "running",
        runId: null,
        commandId: cmd.commandId,
        startedAt: new Date(this.#d.now()).toISOString(),
        step: null,
        limitations: [],
        lastCommand: this.#last(cmd.commandId, "accepted"),
      });
      await this.#d.queue.delete(msg.receiptHandle);
    } catch (error) {
      release();
      throw error;
    }
    log(`command ${cmd.commandId}: accepted (${cmd.action}, ${cmd.mode})`);
    this.#activeCommandId = cmd.commandId;
    this.#active = this.#drive(cmd, release);
  }

  async #drive(cmd: RunCommandV1, release: () => void): Promise<void> {
    let result: RunOutcome;
    try {
      result = await this.#d.runner(cmd);
    } catch (error) {
      result = { outcome: "failed", runId: null, reason: (error as Error).message };
    }
    // An empty reason would fail LiveRunV1 (min length 1) and leave live.json "running" (finding 7).
    if (result.outcome === "failed" && result.reason.trim() === "") {
      result = { ...result, reason: "the run failed without a message (see the bridge log)" };
    }
    try {
      const live = this.#d.live;
      if (result.outcome === "succeeded") {
        await live.update({ state: "succeeded", runId: result.runId, step: null });
      } else if (result.outcome === "stopped") {
        await live.update({
          state: "stopped",
          runId: result.runId,
          step: null,
          limitations: ["stopped by admin"],
        });
      } else {
        await live.update({
          state: "failed",
          runId: result.runId,
          limitations: [result.reason],
        });
      }
      this.#d.log(`command ${cmd.commandId}: ${result.outcome}`);
      if (result.outcome === "failed" && this.#d.alert !== undefined) {
        try {
          await this.#d.alert(
            "CountyLens run failed",
            `Run ${result.runId ?? "(not started)"} for command ${cmd.commandId} failed: ${result.reason}`,
          );
        } catch (error) {
          this.#d.log(`command ${cmd.commandId}: alert not sent: ${(error as Error).message}`);
        }
      }
    } finally {
      this.#d.stop.clear();
      release();
      this.#active = undefined;
      this.#activeCommandId = undefined;
    }
  }
}
