import { toHex } from './cid.js';

export type Hasher = (bytes: ArrayBuffer) => Promise<string>;

/** Main-thread SHA-256 (tests, and browsers without module workers). */
export const hashOnMainThread: Hasher = async (bytes) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (hex: string) => void; reject: (e: Error) => void }>();

/** SHA-256 in a Web Worker; the buffer is transferred, so callers must not reuse it afterwards. */
export const hashInWorker: Hasher = (bytes) => {
  if (typeof Worker === 'undefined') return hashOnMainThread(bytes);
  if (!worker) {
    worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; hex?: string; error?: string }>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.hex) entry.resolve(event.data.hex);
      else entry.reject(new Error(event.data.error ?? 'hash failed'));
    };
  }
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker?.postMessage({ id, bytes }, [bytes]);
  });
};
