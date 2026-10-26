// @vitest-environment node
// A-13 review round: byte caps on the data modules. A host that ignores Range, or sends more
// bytes than the manifest promises, is never downloaded in full.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  readParquetFooter,
  readTableMeta,
  FOOTER_FIRST_READ_BYTES,
  FOOTER_MAX_BYTES,
} from "../src/data/parquet-meta";
import { checkManifestResolves, RUN_MANIFEST_MAX_BYTES } from "../src/data/run-chain";
import { runVerifyLane } from "../src/data/verify-lane";
import { readPathUrls } from "@countylens/shared";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PARQUET = new Uint8Array(readFileSync(join(ROOT, "contract/v1/sample.parquet")));

/** A body that records whether it was cancelled and how many bytes were pulled. */
function endless(chunk: number, cap: number) {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      state.pulled += chunk;
      c.enqueue(new Uint8Array(chunk));
      if (state.pulled > cap) c.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { state, body };
}

describe("parquet-meta Range guard", () => {
  it("a host that answers 200 to a Range is refused and its body cancelled", async () => {
    const { state, body } = endless(65536, 1 << 30);
    const f = (async () => new Response(body, { status: 200 })) as typeof fetch;
    await expect(
      readParquetFooter("https://h.test/p", PARQUET.length, { fetch: f }),
    ).rejects.toThrow("footer unavailable · host ignored Range");
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(1 << 20);
  });

  it("a 206 whose Content-Length exceeds the slice asked for is refused", async () => {
    const f = (async () =>
      new Response(PARQUET, {
        status: 206,
        headers: { "Content-Length": String(PARQUET.length * 10) },
      })) as typeof fetch;
    await expect(
      readParquetFooter("https://h.test/p", PARQUET.length, { fetch: f }),
    ).rejects.toThrow("footer unavailable · host ignored Range");
  });

  it("caps the footer slice size", () => {
    expect(FOOTER_MAX_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it("asks for at most 64 KB from the end of a part, not hyparquet's 512 KB default", async () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    big.set(PARQUET, big.length - PARQUET.length); // the footer sits at the end
    const ranges: string[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range") ?? "";
      ranges.push(range);
      const m = /^bytes=(\d+)-(\d+)$/.exec(range) ?? [];
      return new Response(big.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    }) as typeof fetch;
    await readParquetFooter("https://h.test/p", big.length, { fetch: f }).catch(() => undefined);
    const [first] = ranges;
    const m = /^bytes=(\d+)-(\d+)$/.exec(first ?? "") ?? [];
    expect(Number(m[2]) - Number(m[1]) + 1).toBeLessThanOrEqual(FOOTER_FIRST_READ_BYTES);
  });

  it("readTableMeta takes columns from the first part and sums rows (one at a time by default)", async () => {
    let live = 0;
    let peak = 0;
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      const m = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("Range") ?? "") ?? [];
      return new Response(PARQUET.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    }) as typeof fetch;
    const parts = [0, 1, 2].map((i) => ({ name: `p${i}`, cid: `c${i}`, size: PARQUET.length }));
    const meta = await readTableMeta(parts, (p) => `https://h.test/${p.name}`, { fetch: f });
    expect(meta.rows).toBe(60);
    expect(meta.columns).toHaveLength(61); // contract v1.2 (A-11 Run 3.1) adds unnormalized_address, owner_mailing_postal_code, owner_mailing_state_code to v1.1's 58
    expect(peak).toBe(1);
  });

  it("readTableMeta reads up to `concurrency` part footers at once, same rows and columns", async () => {
    let live = 0;
    let peak = 0;
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      const m = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("Range") ?? "") ?? [];
      return new Response(PARQUET.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    }) as typeof fetch;
    const parts = [0, 1, 2, 3, 4, 5].map((i) => ({
      name: `p${i}`,
      cid: `c${i}`,
      size: PARQUET.length,
    }));
    const meta = await readTableMeta(parts, (p) => `https://h.test/${p.name}`, {
      fetch: f,
      concurrency: 4,
    });
    expect(meta.rows).toBe(120);
    expect(meta.columns).toHaveLength(61);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("verify-lane byte cap", () => {
  const bytes = new TextEncoder().encode("published bytes");
  const target = {
    cid: "bafkreiaaaa",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "table" as const,
    codec: "dag-pb",
  };
  it("an oversized Content-Length is a mismatch, never verified", async () => {
    const f = (async () =>
      new Response(bytes, {
        status: 200,
        headers: { "Content-Length": String(bytes.length * 100) },
      })) as typeof fetch;
    const final = await runVerifyLane({ url: "https://g.test/ipfs/x", target, fetch: f });
    expect(final.kind).toBe("mismatch");
    expect(final.kind === "mismatch" && final.text).toContain("bytes exceed the manifest size");
  });
  it("an endless body with no Content-Length is stopped at size + 1 and cancelled", async () => {
    const { state, body } = endless(1024, 1 << 30);
    const f = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const final = await runVerifyLane({ url: "https://g.test/ipfs/x", target, fetch: f });
    expect(final.kind).toBe("mismatch");
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(64 * 1024);
  });
});

describe("run-chain manifest cap", () => {
  const urls = readPathUrls({
    cidCopyHost: "copy.test",
    filebaseGatewayHost: "filebase.test",
    pinataGatewayHost: "pinata.test",
    orbitorGatewayHost: "orbitor.test",
  });
  it("a manifest answer over the cap fails without being read in full", async () => {
    const states: { cancelled: boolean }[] = [];
    const f = (async () => {
      const { state, body } = endless(65536, 1 << 30);
      states.push(state);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const r = await checkManifestResolves(
      "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
      { urls, fetch: f },
    );
    expect(r).toEqual({ pinata: "fails", orbitor: "fails", filebase: "fails" });
    expect(states.map((x) => x.cancelled)).toEqual([true, true, true]);
    expect(RUN_MANIFEST_MAX_BYTES).toBe(1024 * 1024);
  });
});
