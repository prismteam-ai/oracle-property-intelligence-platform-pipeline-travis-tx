// Read-path URLs (contracts/storage.md "Public URL"; test plan § 3). Every URL is derived at
// call time from the configured hosts: CID_COPY_HOST (the CloudFront domain of the CID copy),
// FILEBASE_GATEWAY_HOST, PINATA_GATEWAY_HOST and ORBITOR_GATEWAY_HOST. This module stores no
// gateway URL and no host literal, and reads no environment: the app passes its validated config
// in (web: `VITE_CID_COPY_HOST` / `VITE_FILEBASE_GATEWAY_HOST` / `VITE_PINATA_GATEWAY_HOST` /
// `VITE_ORBITOR_GATEWAY_HOST`; Lambda: `process.env`), so the package stays browser-safe. The
// literal defaults live with the callers: infra web-stack (`DEFAULT_*_GATEWAY_HOST`) and, for
// orbitor only, apps/web data/verify-lane (`DEFAULT_ORBITOR_GATEWAY_HOST`, used when the build
// has no VITE_ORBITOR_GATEWAY_HOST; a missing VITE_PINATA_GATEWAY_HOST still
// fails loudly, an asymmetry kept so a build landing before the Web-stack deploy keeps orbitor).
// Verify (ARD § 16 AM-10, PO 2026-10-26): Pinata and orbitor are the two counted public gateways
// CountyLens does not operate (Pinata also holds our second copy, orbitor none); Filebase is our
// main storage host, so its lane is a labelled fallback that is never counted.
import { isCidV1 } from "@countylens/contract";

export interface ReadPathHosts {
  /** `CID_COPY_HOST`: the CloudFront domain of the CID copy (AD-02). */
  readonly cidCopyHost: string;
  /** `FILEBASE_GATEWAY_HOST`: the labelled fallback gateway (D-2). */
  readonly filebaseGatewayHost: string;
  /** `PINATA_GATEWAY_HOST`: an independent Verify gateway (AM-10); the Lambda does not have it. */
  readonly pinataGatewayHost?: string;
  /** `ORBITOR_GATEWAY_HOST`: the second independent Verify gateway (AM-10); the Lambda does not have it. */
  readonly orbitorGatewayHost?: string;
}

export type GatewayName = "filebase" | "pinata" | "orbitor";

/** The two Verify gateways this environment neither operates nor stores on (AM-10). */
export const INDEPENDENT_GATEWAYS: readonly GatewayName[] = Object.freeze(["pinata", "orbitor"]);

/** True for a gateway whose match counts as an independent check (never Filebase, AM-10). */
export function isIndependentGateway(gateway: GatewayName): boolean {
  return INDEPENDENT_GATEWAYS.includes(gateway);
}

export interface ReadPathUrls {
  /** `https://{CID_COPY_HOST}/{cid}`: the fast copy, tried first. */
  copyUrl(cid: string): string;
  /** `https://{*_GATEWAY_HOST}/ipfs/{cid}`: the public gateway, used as the labelled fallback. */
  gatewayUrl(cid: string, gateway: GatewayName): string;
  /** The configured host of a gateway, for the `fallback · {host}` label. */
  gatewayHost(gateway: GatewayName): string;
}

const CONFIG_KEY: Record<GatewayName, string> = {
  filebase: "FILEBASE_GATEWAY_HOST",
  pinata: "PINATA_GATEWAY_HOST",
  orbitor: "ORBITOR_GATEWAY_HOST",
};

/** A bare hostname: labels of letters, digits and hyphens, at least one dot; no scheme, port or path. */
const BARE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function bareHost(key: string, value: string): string {
  if (!BARE_HOST.test(value)) {
    throw new Error(`${key} must be a bare hostname (no scheme, port or path): "${value}"`);
  }
  return value;
}

function cidV1(cid: string): string {
  if (!isCidV1(cid)) throw new Error(`Not a CIDv1: "${cid}"`);
  return cid;
}

/** Binds the configured hosts once; every URL is then built from them on each call. */
export function readPathUrls(hosts: ReadPathHosts): ReadPathUrls {
  const copyHost = bareHost("CID_COPY_HOST", hosts.cidCopyHost);
  const gateways: Partial<Record<GatewayName, string>> = {
    filebase: bareHost(CONFIG_KEY.filebase, hosts.filebaseGatewayHost),
  };
  if (hosts.pinataGatewayHost !== undefined) {
    gateways.pinata = bareHost(CONFIG_KEY.pinata, hosts.pinataGatewayHost);
  }
  if (hosts.orbitorGatewayHost !== undefined) {
    gateways.orbitor = bareHost(CONFIG_KEY.orbitor, hosts.orbitorGatewayHost);
  }

  const gatewayHost = (gateway: GatewayName): string => {
    const host = gateways[gateway];
    if (host === undefined) throw new Error(`${CONFIG_KEY[gateway]} is not configured`);
    return host;
  };

  return {
    copyUrl: (cid) => `https://${copyHost}/${cidV1(cid)}`,
    gatewayUrl: (cid, gateway) => `https://${gatewayHost(gateway)}/ipfs/${cidV1(cid)}`,
    gatewayHost,
  };
}
