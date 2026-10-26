// T036 (A-14, AD-27 layer 1): one small helper so the 23 s abort covers every await in
// `agent.ask`, not only the model call. A promise that never settles (a hung tool, bind or
// engine call) still ends the request at the deadline.

/** The error `raceAbort` rejects with; `isAbortError` (ask.ts) recognises it by name. */
export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Resolves/rejects with `work`, unless `signal` aborts first, in which case it rejects with an
 * `AbortError`. The losing `work` promise keeps running (a DuckDB or S3 call cannot be
 * cancelled from here) but its later outcome is swallowed so it never becomes an unhandled
 * rejection. With no signal it returns `work` unchanged.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  work.catch(() => undefined);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
