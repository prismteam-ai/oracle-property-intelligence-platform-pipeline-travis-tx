// Gateway behaviour probe on already-public elephant-cli CIDs (PO D-3 option c).
// Per gateway x CID, N rounds of: plain GET (no Range), Range GET bytes=0-1023,
// CORS GET with Origin, CORS preflight (OPTIONS, Range). Records status, TTFB, size, SHA-256 vs CID digest.
import { createHash } from "node:crypto";
const ORIGIN = "https://countylens.example-origin.test";
const CIDS: Record<string, string> = {
  "jackson-county-archive": "baguqeerafpmumlr6x2iood2tismucos6w6eu6clge3z3pbwpogs5u5wkk6cq",
  "jackson-county-tables": "baguqeerau5cozk6j4p5p32zlsqwlc2va4eigqqptkl6xhlns5wxpl4vsilmq",
};
const GW: Record<string, (c: string) => string> = {
  filebase: (c) => `https://ipfs.filebase.io/ipfs/${c}`,
  "ipfs.io": (c) => `https://ipfs.io/ipfs/${c}`,
  "dweb.link": (c) => `https://dweb.link/ipfs/${c}`,
  pinata: (c) => `https://gateway.pinata.cloud/ipfs/${c}`,
};
const N = Number(process.argv[2] ?? 5);
function cidDigest(cid: string): { codec: number; digest: string } {
  const a = "abcdefghijklmnopqrstuvwxyz234567"; let bits = 0, val = 0; const out: number[] = [];
  for (const ch of cid.slice(1)) { val = (val << 5) | a.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  let i = 0; const varint = () => { let x = 0, s = 0, b; do { b = out[i++]; x |= (b & 127) << s; s += 7; } while (b & 128); return x; };
  varint(); const codec = varint(); const mh = varint(); const len = varint();
  if (mh !== 0x12 || len !== 32) throw new Error("not sha2-256");
  return { codec, digest: Buffer.from(out.slice(i, i + 32)).toString("hex") };
}
async function timed(url: string, init: RequestInit) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(60_000) });
    const reader = r.body?.getReader(); let ttfb = performance.now() - t0; const chunks: Uint8Array[] = []; let first = true;
    if (reader) for (;;) { const { done, value } = await reader.read(); if (first) { ttfb = performance.now() - t0; first = false; } if (done) break; chunks.push(value); }
    const body = Buffer.concat(chunks);
    return { status: r.status, ttfbMs: Math.round(ttfb), totalMs: Math.round(performance.now() - t0), bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"), finalUrl: new URL(r.url).host,
      acao: r.headers.get("access-control-allow-origin"), aceh: r.headers.get("access-control-expose-headers"),
      acah: r.headers.get("access-control-allow-headers"), acceptRanges: r.headers.get("accept-ranges"),
      contentRange: r.headers.get("content-range"), contentType: r.headers.get("content-type") };
  } catch (e) { return { status: 0, error: String(e), ttfbMs: Math.round(performance.now() - t0) }; }
}
const rows: unknown[] = [];
const at = new Date().toISOString();
for (let round = 0; round < N; round++) for (const [cn, cid] of Object.entries(CIDS)) for (const [gn, f] of Object.entries(GW)) {
  const url = f(cid); const exp = cidDigest(cid);
  const plain = await timed(url, {});
  const range = await timed(url, { headers: { Range: "bytes=0-1023" } });
  const cors = await timed(url, { headers: { Origin: ORIGIN, Range: "bytes=0-1023" } });
  const pre = await timed(url, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" } });
  rows.push({ round, cid: cn, gw: gn, codec: exp.codec.toString(16), plain: { ...plain, shaMatch: (plain as any).sha256 === exp.digest },
    range, cors: { status: cors.status, acao: (cors as any).acao, aceh: (cors as any).aceh }, preflight: { status: pre.status, acao: (pre as any).acao, acah: (pre as any).acah } });
  console.log(`${round} ${cn} ${gn} plain ${plain.status} ttfb ${plain.ttfbMs} ${(plain as any).bytes}B sha=${(plain as any).sha256 === exp.digest} | range ${range.status} ${(range as any).contentRange} ${(range as any).bytes}B | cors ${(cors as any).acao} expose=${(cors as any).aceh} | preflight ${pre.status} ${(pre as any).acah}`);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(JSON.stringify({ at, finished: new Date().toISOString() }));
await import("node:fs").then((fs) => fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ at, rows }, null, 2)));
