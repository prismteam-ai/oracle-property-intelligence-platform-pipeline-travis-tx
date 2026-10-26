// CIDv1 string checks shared by every contract schema (constitution A3: CIDv1 only).
// A CIDv1 in base32 always starts with "b" (multibase) then "a" (the version byte 0x01).
// CIDv0 ("Qm…"), base36 IPNS keys ("k51…") and gateway URLs are rejected.
import { z } from "zod";

const CID_V1_BASE32 = /^ba[a-z2-7]{50,}$/;

/** True when `value` is a base32 CIDv1 string (no gateway URL, no CIDv0, no IPNS key). */
export function isCidV1(value: string): boolean {
  return CID_V1_BASE32.test(value);
}

export const CidV1 = z.string().refine(isCidV1, { message: "expected a base32 CIDv1 string" });

/** Hostnames and path shapes that make a string a gateway URL. */
const GATEWAY_URL =
  /\/ip[fn]s\/|^https?:\/\/[^/\s]*(ipfs|dweb\.link|gateway|pinata|filebase|w3s\.link|nftstorage)/i;

export function isGatewayUrl(value: string): boolean {
  return GATEWAY_URL.test(value);
}

export const Sha256Hex = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "expected a lowercase sha256 hex digest");

export const IsoDateTime = z.iso.datetime({ offset: true });
