// SHA-256 off the main thread: part files reach 128 MB.
interface WorkerScope {
  onmessage: ((event: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => void) | null;
  postMessage(message: unknown): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (event) => {
  const { id, bytes } = event.data;
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    scope.postMessage({ id, hex });
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
