// commandId -> outcome, in a JSON file (pipeline/data/bridge/commands.json). A command seen
// before is deleted from the queue and never run again. Writes are temp file + rename, so a crash
// leaves the old file or the new one. A corrupt file is an error, not a reset: starting over would
// let an old command run twice.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LastCommandOutcome } from "@countylens/contract";
import { z } from "zod";

type Outcome = z.infer<typeof LastCommandOutcome>;

const File = z.object({
  commands: z.record(z.string(), z.object({ outcome: LastCommandOutcome, at: z.string() })),
  cancelled: z.array(z.string()),
});
type FileShape = z.infer<typeof File>;

export class IdempotencyStore {
  readonly #path: string;
  readonly #now: () => Date;
  #data: FileShape;

  constructor(path: string, now: () => Date) {
    this.#path = path;
    this.#now = now;
    this.#data = { commands: {}, cancelled: [] };
    if (existsSync(path)) {
      try {
        this.#data = File.parse(JSON.parse(readFileSync(path, "utf8")));
      } catch (error) {
        throw new Error(
          `${path} is corrupt (${(error as Error).message}); fix or remove it by hand`,
          { cause: error },
        );
      }
    }
  }

  get(commandId: string): { outcome: Outcome; at: string } | undefined {
    return this.#data.commands[commandId];
  }

  record(commandId: string, outcome: Outcome): void {
    this.#data.commands[commandId] = { outcome, at: this.#now().toISOString() };
    this.#flush();
  }

  /** Remember a command ID that a Stop cancelled before its Start arrived. */
  cancel(commandId: string): void {
    if (!this.#data.cancelled.includes(commandId)) this.#data.cancelled.push(commandId);
    this.#flush();
  }

  isCancelled(commandId: string): boolean {
    return this.#data.cancelled.includes(commandId);
  }

  #flush(): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.#data, null, 2)}\n`);
    renameSync(tmp, this.#path);
  }
}
