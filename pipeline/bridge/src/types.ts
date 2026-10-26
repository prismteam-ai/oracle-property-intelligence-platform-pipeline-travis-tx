// Shared bridge types. Everything with an effect (SQS, S3, child processes, the clock) is behind
// one of these so the loop and the runner are tested with fakes and never touch AWS.
import type { RunCommandV1 } from "@countylens/contract";

export interface QueueMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
}

export interface QueueClient {
  /** Long poll (20 s), at most one message; undefined when the wait ends empty. */
  receive(): Promise<QueueMessage | undefined>;
  delete(receiptHandle: string): Promise<void>;
}

export type RunOutcome =
  | { outcome: "succeeded"; runId: string }
  | { outcome: "stopped"; runId: string }
  | { outcome: "failed"; runId: string | null; reason: string };

/** Runs one command to its end; resolves with the outcome, never rejects. */
export type CommandRunner = (command: RunCommandV1) => Promise<RunOutcome>;

export type Logger = (line: string) => void;
