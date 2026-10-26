// A-11: the shared gateway checks. Pinata's public gateway rate-limits and bot-challenges
// automated clients (429/403): that is "no answer", not "the file is missing", so it must not
// send a 230 MB CAR back through the uploader when Filebase's gateway already serves it.
import { describe, expect, it } from "vitest";
import {
  gatewaysAgree,
  probeBothGateways,
  probeGateway,
  readbackWhole,
  type GatewayCheck,
} from "../src/gateway-readback.js";
import type { FetchLike } from "../src/kubo-add.js";

const CID = "bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu";
const range = (total: number) =>
  new Response(null, { status: 206, headers: { "content-range": `bytes 0-0/${total}` } });

describe("probeGateway", () => {
  it("compares the size a 1-byte range request reports", async () => {
    const f: FetchLike = async () => range(10);
    expect(await probeGateway("https://g", CID, 10, f)).toMatchObject({ ok: true });
    expect(await probeGateway("https://g", CID, 11, f)).toMatchObject({
      ok: false,
      reason: "size 10 (want 11)",
    });
  });

  it("falls back to Content-Length for a gateway that ignores Range", async () => {
    const f: FetchLike = async () =>
      new Response(null, { status: 200, headers: { "content-length": "10" } });
    expect(await probeGateway("https://g", CID, 10, f)).toMatchObject({ ok: true });
  });

  it("marks 429 and 403 inconclusive, and 404 or a transport error a plain failure", async () => {
    const status =
      (n: number): FetchLike =>
      async () =>
        new Response("x", { status: n });
    expect(await probeGateway("https://g", CID, 1, status(429))).toMatchObject({
      ok: false,
      inconclusive: true,
    });
    expect(await probeGateway("https://g", CID, 1, status(403))).toMatchObject({
      inconclusive: true,
    });
    const notFound = await probeGateway("https://g", CID, 1, status(404));
    expect(notFound.ok).toBe(false);
    expect(notFound.inconclusive).toBeUndefined();
    const boom = await probeGateway("https://g", CID, 1, async () => {
      throw new Error("timeout");
    });
    expect(boom).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("gatewaysAgree", () => {
  const ok: GatewayCheck = { gateway: "a", ok: true };
  const blocked: GatewayCheck = { gateway: "b", ok: false, inconclusive: true };
  const missing: GatewayCheck = { gateway: "c", ok: false, reason: "HTTP 404" };

  it("needs one confirmation and no disagreement", () => {
    expect(gatewaysAgree([ok, ok])).toBe(true);
    expect(gatewaysAgree([blocked, ok])).toBe(true);
    expect(gatewaysAgree([blocked, blocked])).toBe(false); // nothing confirmed it
    expect(gatewaysAgree([ok, missing])).toBe(false);
    expect(gatewaysAgree([])).toBe(false);
  });
});

describe("probeBothGateways / readbackWhole", () => {
  it("Pinata challenged and Filebase serving counts as published", async () => {
    const f: FetchLike = async (url) =>
      url.includes("pinata") ? new Response("challenge", { status: 429 }) : range(5);
    expect(gatewaysAgree(await probeBothGateways(CID, 5, f))).toBe(true);
  });

  it("a whole-file readback flags a 429 as inconclusive and a wrong size as a failure", async () => {
    const blocked = await readbackWhole(
      "https://g",
      CID,
      { size: 3 },
      async () => new Response("x", { status: 429 }),
    );
    expect(blocked).toMatchObject({ ok: false, inconclusive: true });
    const wrong = await readbackWhole(
      "https://g",
      CID,
      { size: 3 },
      async () => new Response("four"),
    );
    expect(wrong.ok).toBe(false);
    expect(wrong.inconclusive).toBeUndefined();
    expect(
      await readbackWhole("https://g", CID, { size: 3 }, async () => new Response("abc")),
    ).toMatchObject({ ok: true });
  });
});
