// A bounded body read (A-13 review round): a gateway or copy host that answers with more bytes
// than the manifest promises must never be downloaded in full. `readCapped` refuses a larger
// `Content-Length` up front, otherwise streams the body and stops (cancelling it) at maxBytes + 1.
export type CappedRead =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | { readonly kind: "too_large"; readonly seen: number };

/** At most `maxBytes` of `response`'s body; anything longer is `too_large` and cancelled. */
export async function readCapped(response: Response, maxBytes: number): Promise<CappedRead> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: "too_large", seen: declared };
  }
  const body = response.body;
  if (body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > maxBytes
      ? { kind: "too_large", seen: bytes.length }
      : { kind: "bytes", bytes };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too_large", seen: total };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { kind: "bytes", bytes };
}
