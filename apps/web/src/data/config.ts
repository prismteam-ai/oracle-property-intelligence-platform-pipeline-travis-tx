// Read-path configuration of the browser app (A-03 T042, G-C3; plan § "Fixed texts and config
// keys"). The hosts arrive as `VITE_CID_COPY_HOST` (the CloudFront domain of the CID copy) and
// `VITE_FILEBASE_GATEWAY_HOST` (`ipfs.filebase.io`) from the Amplify app environment (T043);
// neither is a secret. Nothing here stores a host literal: a missing key fails loudly, naming
// it, and `readPathUrls` validates the value as a bare hostname. The Verify gateways (Pinata,
// orbitor) are read in data/verify-lane: Pinata is required like these keys, while orbitor falls
// back to the literal `ipfs.orbitor.dev` there (AM-10), the one gateway default in the web app.
import { readPathUrls, type ReadPathHosts, type ReadPathUrls } from "@countylens/shared";

export const CID_COPY_HOST_KEY = "VITE_CID_COPY_HOST";
export const FILEBASE_GATEWAY_HOST_KEY = "VITE_FILEBASE_GATEWAY_HOST";

/** One environment lookup; the default reads Vite's build-time `import.meta.env`. */
export type WebEnv = (key: string) => string | undefined;

export const viteEnv: WebEnv = (key) => {
  const value: unknown = import.meta.env[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

function required(env: WebEnv, key: string): string {
  const value = env(key);
  if (value === undefined) throw new Error(`${key} is not set in the web build environment`);
  return value;
}

export function readPathHosts(env: WebEnv = viteEnv): ReadPathHosts {
  return {
    cidCopyHost: required(env, CID_COPY_HOST_KEY),
    filebaseGatewayHost: required(env, FILEBASE_GATEWAY_HOST_KEY),
  };
}

/** `readPathUrls` bound to the configured hosts; throws naming the missing or malformed key. */
export function readPathUrlsFromEnv(env: WebEnv = viteEnv): ReadPathUrls {
  return readPathUrls(readPathHosts(env));
}
