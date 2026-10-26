// AM-10: the orbitor lane has a default host, so a web build made before the Web-stack deploy
// (which sets VITE_ORBITOR_GATEWAY_HOST) still shows both independent lanes instead of an error.
import { describe, expect, it } from "vitest";
import { DEFAULT_ORBITOR_GATEWAY_HOST, verifyUrlsFromEnv } from "../src/data/verify-lane";

const base: Record<string, string> = {
  VITE_CID_COPY_HOST: "copy.example",
  VITE_FILEBASE_GATEWAY_HOST: "ipfs.filebase.io",
  VITE_PINATA_GATEWAY_HOST: "gateway.pinata.cloud",
};
const cid = "bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm";

describe("verifyUrlsFromEnv orbitor host (AM-10)", () => {
  it("falls back to ipfs.orbitor.dev when VITE_ORBITOR_GATEWAY_HOST is unset", () => {
    const urls = verifyUrlsFromEnv((key) => base[key]);
    expect(DEFAULT_ORBITOR_GATEWAY_HOST).toBe("ipfs.orbitor.dev");
    expect(urls.gatewayUrl(cid, "orbitor")).toBe(`https://ipfs.orbitor.dev/ipfs/${cid}`);
  });

  it("uses VITE_ORBITOR_GATEWAY_HOST when set", () => {
    const env: Record<string, string> = { ...base, VITE_ORBITOR_GATEWAY_HOST: "orbitor.test" };
    expect(verifyUrlsFromEnv((key) => env[key]).gatewayUrl(cid, "orbitor")).toBe(
      `https://orbitor.test/ipfs/${cid}`,
    );
  });

  it("still requires the Pinata host (no silent default for it)", () => {
    const env: Record<string, string> = { ...base };
    delete env.VITE_PINATA_GATEWAY_HOST;
    expect(() => verifyUrlsFromEnv((key) => env[key])).toThrow(/VITE_PINATA_GATEWAY_HOST/);
  });
});
