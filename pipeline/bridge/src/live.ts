// live.json: the bridge's status object (LiveRunV1) at s3://<bucket>/live/live.json. The bridge is
// its only writer. Every write is schema-checked, writes are serialised, and a failed PutObject is
// logged by the caller's put() and never kills a run. Heartbeat every 30 s so the Runs page can
// tell "Bridge offline" (bridgeSeenAt older than 3 min).
import { LIVE_RUN_SCHEMA, LiveRunV1 } from "@countylens/contract";

export const LIVE_KEY = "live/live.json";
export const HEARTBEAT_MS = 30_000;

export interface LiveDeps {
  /** Writes the JSON body to the live object. May throw; the error is swallowed after one log. */
  put: (body: string) => Promise<void>;
  now: () => Date;
  onPutError?: (error: unknown) => void;
}

export type StartTimer = (fn: () => void, ms: number) => () => void;

export class LiveStatus {
  readonly #deps: LiveDeps;
  #state: LiveRunV1;
  #chain: Promise<void> = Promise.resolve();

  constructor(deps: LiveDeps) {
    this.#deps = deps;
    const at = deps.now().toISOString();
    this.#state = {
      schema: LIVE_RUN_SCHEMA,
      state: "idle",
      runId: null,
      commandId: null,
      startedAt: null,
      updatedAt: at,
      step: null,
      bridgeSeenAt: at,
      lastCommand: null,
      limitations: [],
    };
  }

  get state(): LiveRunV1 {
    return this.#state;
  }

  /** Merge a patch, validate, and write. Rejects only when the merged object breaks the schema. */
  async update(patch: Partial<Omit<LiveRunV1, "schema">>): Promise<void> {
    const at = this.#deps.now().toISOString();
    const next = LiveRunV1.parse({ ...this.#state, ...patch, updatedAt: at, bridgeSeenAt: at });
    this.#state = next;
    await this.#write(next);
  }

  async heartbeat(): Promise<void> {
    await this.update({});
  }

  /** Waits for queued writes (tests, shutdown). */
  flush(): Promise<void> {
    return this.#chain;
  }

  startHeartbeat(startTimer: StartTimer = defaultTimer): () => void {
    return startTimer(() => void this.heartbeat().catch(() => {}), HEARTBEAT_MS);
  }

  #write(state: LiveRunV1): Promise<void> {
    const body = `${JSON.stringify(state)}\n`;
    this.#chain = this.#chain.then(async () => {
      try {
        await this.#deps.put(body);
      } catch (error) {
        this.#deps.onPutError?.(error);
      }
    });
    return this.#chain;
  }
}

const defaultTimer: StartTimer = (fn, ms) => {
  const handle = setInterval(fn, ms);
  handle.unref();
  return () => clearInterval(handle);
};
