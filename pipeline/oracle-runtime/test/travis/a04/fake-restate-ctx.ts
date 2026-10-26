// A fake Restate context that records a journal and replays it, to prove a handler is
// deterministic: the second pass (a replay) must issue the same operations with byte-identical
// payloads, even when the wall clock and Math.random differ. Mirrors Restate's "journal mismatch"
// check (RT0016) on every ctx.set / ctx.run / ctx.sleep / call. Synthetic; no network.
import { vi } from "vitest";

export type Op = { kind: string; name: string; payload: string };
type Entry = Op & { result: unknown; thrown?: string };

export class JournalMismatch extends Error {
  constructor(index: number, want: Op, got: Op) {
    super(
      `[570 Journal mismatch] index ${index}: ${JSON.stringify(want)} != ${JSON.stringify(got)}`,
    );
  }
}

/**
 * Strict like the real SDK (external_progress_channel.ts): a RestatePromise that is not yet
 * settled registers an awaitNext on its first .then/.catch/.finally/await, and only ONE may be
 * pending per context; a second throws "awaitNext already pending". Combinators (strictRace)
 * poll as one, without touching their children. Promises are lazy: a rejection with no
 * handler is not an unhandledRejection.
 */
export class FakeRestatePromise<T> implements PromiseLike<T> {
  settled = false;
  polling = false;
  constructor(
    readonly gate: { pending: number },
    readonly inner: Promise<T>,
    presettled = false,
  ) {
    this.settled = presettled;
    const done = (): void => {
      this.settled = true;
      if (this.polling) {
        this.polling = false;
        gate.pending -= 1;
      }
    };
    // marks the rejection as handled (a RestatePromise is lazy) without registering an await
    inner.then(done, done);
  }
  private poll(): void {
    if (this.settled || this.polling) return;
    if (this.gate.pending > 0) throw new Error("[500 Internal] awaitNext already pending");
    this.polling = true;
    this.gate.pending += 1;
  }
  then<A = T, B = never>(
    onfulfilled?: ((v: T) => A | PromiseLike<A>) | null,
    onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.poll();
    return this.inner.then(onfulfilled, onrejected);
  }
  catch<B = never>(onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    this.poll();
    return this.inner.catch(onrejected);
  }
  finally(onfinally?: (() => void) | null): Promise<T> {
    this.poll();
    return this.inner.finally(onfinally);
  }
  map<U>(
    mapper: (value: T | undefined, failure?: unknown) => U | PromiseLike<U>,
  ): FakeRestatePromise<U> {
    return new FakeRestatePromise(
      this.gate,
      this.inner.then(
        (v) => mapper(v, undefined),
        (e) => mapper(undefined, e),
      ),
    );
  }
}

/** RestatePromise.race over fake promises: one await for the whole set, children untouched. */
export function strictRace<T>(values: ReadonlyArray<FakeRestatePromise<T>>): FakeRestatePromise<T> {
  const first = values[0];
  if (first === undefined) throw new Error("race of nothing");
  return new FakeRestatePromise(first.gate, Promise.race(values.map((v) => v.inner)));
}

type Call = (req: unknown) => Promise<unknown>;
export interface FakeClient {
  merge: Call;
  run: Call;
}

export interface FakeCtx {
  key: string;
  run<T>(name: string, fn: () => Promise<T>, opts?: unknown): Promise<T>;
  sleep(ms: number, name?: string): Promise<void>;
  set(key: string, value: unknown): void;
  get(key: string): Promise<unknown>;
  rand: { uuidv4(): string; random(): number };
  date: { now(): Promise<number> };
  objectClient(def: unknown, key: string): FakeClient;
  serviceClient(def: unknown): FakeClient;
  promise(name: string): { get(): Promise<unknown> };
}

/** Answers the calls (Loader.merge, TcadChunk.run, ...) of the code under test. */
export type CallHandler = (target: string, method: string, request: unknown) => unknown;

export class FakeJournal {
  private entries: Entry[] = [];
  /** Operations issued by the latest pass, in order. */
  ops: Op[] = [];
  state = new Map<string, string>();

  /** A context over this journal: records while it is empty, replays (and verifies) afterwards. */
  ctx(key: string, onCall: CallHandler, sleepAdvances = true): FakeCtx {
    let cursor = 0;
    this.ops = [];
    const gate = { pending: 0 };
    const wrap = <T>(inner: Promise<T>, presettled: boolean): Promise<T> =>
      new FakeRestatePromise(gate, inner, presettled) as unknown as Promise<T>;
    const step = <T>(op: Op, live: () => Promise<T> | T): Promise<T> => {
      const at = cursor;
      const replayed = this.entries[at] !== undefined && this.entries[at]?.thrown === undefined;
      return wrap(run(op, live), replayed);
    };
    const run = async <T>(op: Op, live: () => Promise<T> | T): Promise<T> => {
      this.ops.push(op);
      const at = cursor++;
      const prior = this.entries[at];
      if (prior !== undefined) {
        if (prior.kind !== op.kind || prior.name !== op.name || prior.payload !== op.payload) {
          throw new JournalMismatch(at, prior, op);
        }
        if (prior.thrown !== undefined) throw new Error(prior.thrown);
        return prior.result as T;
      }
      // the slot is reserved now so concurrent calls keep their issue order
      const slot: Entry = { ...op, result: null };
      this.entries[at] = slot;
      try {
        slot.result = await live();
        return slot.result as T;
      } catch (error) {
        slot.thrown = (error as Error).message;
        throw error;
      }
    };
    const client = (target: string) =>
      new Proxy(
        {},
        {
          get: (_t, method: string) => (request: unknown) =>
            step(
              { kind: "call", name: `${target}.${method}`, payload: JSON.stringify(request) },
              () => onCall(target, method, request),
            ),
        },
      ) as FakeClient;
    return {
      key,
      run: (name, fn) => step({ kind: "run", name, payload: "" }, fn),
      sleep: (ms, name) =>
        step({ kind: "sleep", name: name ?? "", payload: String(ms) }, () => {
          if (sleepAdvances) vi.setSystemTime(Date.now() + ms);
        }),
      set: (k, v) => {
        // Restate journals a set without suspending; a mismatch surfaces at the next await
        const op: Op = { kind: "set", name: k, payload: JSON.stringify(v) };
        this.ops.push(op);
        const at = cursor++;
        const prior = this.entries[at];
        if (prior === undefined) this.entries[at] = { ...op, result: null };
        else if (prior.kind !== op.kind || prior.name !== op.name || prior.payload !== op.payload) {
          throw new JournalMismatch(at, prior, op);
        }
        this.state.set(k, op.payload);
      },
      get: (k) => {
        const v = this.state.get(k);
        return wrap(Promise.resolve(v === undefined ? null : JSON.parse(v)), true);
      },
      rand: {
        uuidv4: () => {
          // journaled by the SDK from the invocation id: stable across replays
          return "00000000-0000-4000-8000-000000000001";
        },
        random: () => 0.5,
      },
      date: { now: () => step({ kind: "date", name: "now", payload: "" }, () => Date.now()) },
      objectClient: (def, k) => client(`${(def as { name: string }).name}/${k}`),
      serviceClient: (def) => client((def as { name: string }).name),
      promise: (name) => ({
        get: () =>
          step({ kind: "promise", name, payload: "" }, () => Promise.reject(new Error("no human"))),
      }),
    };
  }
}

/** Run `pass` once to record, then again as a replay with the clock shifted and Math.random changed. */
export async function recordThenReplay<T>(
  journal: FakeJournal,
  pass: (n: 1 | 2) => Promise<T>,
  shiftMs = 37_000,
): Promise<{ first: Op[]; second: Op[]; a: T; b: T }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  const base = Date.UTC(2026, 9, 22, 5, 0, 0);
  try {
    vi.setSystemTime(base);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.11);
    const a = await pass(1);
    const first = [...journal.ops];
    random.mockReturnValue(0.97);
    vi.setSystemTime(base + shiftMs);
    const b = await pass(2);
    return { first, second: [...journal.ops], a, b };
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
}
