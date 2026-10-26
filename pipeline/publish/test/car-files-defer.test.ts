// PO 2026-10-25: the carCid-file readback can run on Filebase only; Pinata deferred to A-16 item 14.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { receiptCoversGateways, uploadCarFile } from "../src/car-files.js";
import { READBACK_GATEWAYS } from "../src/gateway-readback.js";
import type { KuboAdded } from "../src/kubo-add.js";
import { FILEBASE_GATEWAY } from "../src/sequence.js";

const BYTES = 1234;
const PINATA = "https://gateway.pinata.cloud";

function target() {
  const dir = mkdtempSync(join(tmpdir(), "carfile-"));
  const path = join(dir, "travis-county-b01.car");
  writeFileSync(path, Buffer.alloc(BYTES, 1));
  return { name: "cars/travis-county-b01.car", kind: "car" as const, path, carCid: "bafkreitest" };
}

const add = async (): Promise<KuboAdded> => ({
  cid: "bafkreitest",
  name: "travis-county-b01.car",
  size: BYTES,
});

/** Filebase serves the file; any other gateway (Pinata) is too slow and errors. */
const fetchImpl = (async (url: string | URL | Request) => {
  if (String(url).startsWith(FILEBASE_GATEWAY)) return new Response(new Uint8Array(BYTES));
  throw new TypeError("fetch failed");
}) as typeof fetch;

describe("car-files readback gateways", () => {
  it("fails by default when one of the two gateways cannot serve the file", async () => {
    const result = await uploadCarFile(target(), { env: {}, add, fetch: fetchImpl });
    expect(READBACK_GATEWAYS.length).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("passes on Filebase alone when Pinata is deferred, and logs the deferral", async () => {
    const lines: string[] = [];
    const result = await uploadCarFile(target(), {
      env: {},
      add,
      fetch: fetchImpl,
      readbackGateways: [FILEBASE_GATEWAY],
      log: (line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    expect(result.gateways.map((g) => g.gateway)).toEqual([FILEBASE_GATEWAY]);
    expect(lines.some((l) => l.startsWith("DEFER") && l.includes("A-16 item 14"))).toBe(true);
  });
});

describe("A11-17 R4: deferredGateways", () => {
  it("lists the gateway that was not read back; empty when both were", async () => {
    const deferred = await uploadCarFile(target(), {
      env: {},
      add,
      fetch: fetchImpl,
      readbackGateways: [FILEBASE_GATEWAY],
    });
    expect(deferred.deferredGateways).toEqual([PINATA]);

    const both = (async () => new Response(new Uint8Array(BYTES))) as unknown as typeof fetch;
    const full = await uploadCarFile(target(), { env: {}, add, fetch: both });
    expect(full.ok).toBe(true);
    expect(full.deferredGateways).toEqual([]);
  });
});

describe("A11-17 R4: receiptCoversGateways", () => {
  it("a receipt that deferred a required gateway does not cover it", () => {
    expect(receiptCoversGateways({ deferredGateways: [PINATA] }, READBACK_GATEWAYS)).toBe(false);
  });

  it("covers it when this run defers the same gateway", () => {
    expect(receiptCoversGateways({ deferredGateways: [PINATA] }, [FILEBASE_GATEWAY])).toBe(true);
  });

  it("an old receipt without the field is judged by the gateways it recorded", () => {
    const filebaseOnly = { gateways: [{ gateway: FILEBASE_GATEWAY, ok: true }] };
    expect(receiptCoversGateways(filebaseOnly, READBACK_GATEWAYS)).toBe(false);
    expect(receiptCoversGateways(filebaseOnly, [FILEBASE_GATEWAY])).toBe(true);
    const both = {
      gateways: [
        { gateway: PINATA, ok: true },
        { gateway: FILEBASE_GATEWAY, ok: true },
      ],
    };
    expect(receiptCoversGateways(both, READBACK_GATEWAYS)).toBe(true);
  });

  it("a receipt with neither field covers nothing", () => {
    expect(receiptCoversGateways({}, READBACK_GATEWAYS)).toBe(false);
  });
});
