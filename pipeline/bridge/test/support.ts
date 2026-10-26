// Test doubles for the bridge: a fake SQS client, a manual clock, and command builders.
import { randomUUID } from "node:crypto";
import { RUN_COMMAND_SCHEMA } from "@countylens/contract";
import type { RunCommandV1 } from "@countylens/contract";
import type { QueueClient, QueueMessage } from "../src/types.js";

export class FakeQueue implements QueueClient {
  readonly deleted: string[] = [];
  private readonly pending: QueueMessage[] = [];
  push(body: unknown, id = randomUUID()): QueueMessage {
    const msg = {
      messageId: id,
      receiptHandle: `rh-${id}`,
      body: typeof body === "string" ? body : JSON.stringify(body),
    };
    this.pending.push(msg);
    return msg;
  }
  async receive(): Promise<QueueMessage | undefined> {
    return this.pending.shift();
  }
  async delete(receiptHandle: string): Promise<void> {
    this.deleted.push(receiptHandle);
  }
}

export const T0 = Date.parse("2026-10-26T10:00:00.000Z");

export function command(over: Partial<RunCommandV1> = {}): RunCommandV1 {
  const requestedAt = over.requestedAt ?? new Date(T0).toISOString();
  return {
    schema: RUN_COMMAND_SCHEMA,
    commandId: randomUUID(),
    action: "start",
    window: { kind: "austin_permits_since_watermark", sinceRunId: "travis-full-run2-20261024" },
    mode: "dry_run",
    requestedBy: "sub-123",
    requestedAt,
    expiresAt: new Date(Date.parse(requestedAt) + 15 * 60 * 1000).toISOString(),
    ...over,
  } as RunCommandV1;
}

/** Asserts a value is present (the repo bans non-null assertions). */
export function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value, got none");
  return value;
}

/** A promise you resolve by hand, to hold a fake run open. */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
