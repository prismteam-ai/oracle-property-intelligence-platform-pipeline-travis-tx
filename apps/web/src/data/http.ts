// Small browser-side helpers shared by the data modules (A-03 T042, G-C3). The default fetch is
// a wrapper so `globalThis.fetch` keeps its `this` in browsers and tests can stub the global.
export const browserFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** Throws the signal's own reason when the caller has already given up (navigation, unmount). */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const reason: unknown = signal.reason;
  throw reason === undefined ? new DOMException("The read was aborted", "AbortError") : reason;
}

/** `{ signal }` only when one is given: `RequestInit.signal` rejects an explicit `undefined`. */
export function requestInit(signal: AbortSignal | undefined): RequestInit {
  return signal === undefined ? {} : { signal };
}
