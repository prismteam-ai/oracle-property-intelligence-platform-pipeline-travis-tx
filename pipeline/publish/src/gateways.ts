// The Verify gateway roles, labels and refusal text, defined once (AM-10, PO wording 2026-10-26).
// Used by src/verify.ts (hosts) and scripts/verify-manifest.ts (https:// URLs). Dependency-free on
// purpose: scripts/ sits outside the pnpm workspace and imports this file by relative path.
// packages/shared keeps its own browser copy of the texts (VERIFY_TEXTS).
//
// "Independent" means what the README means: a public gateway CountyLens does not operate, with
// the bytes hash-checked. Pinata and orbitor are the two COUNTED gateways (both must match);
// Filebase, our main storage host, is a FALLBACK (shown, never counted).

export const PINATA_GATEWAY_HOST = "gateway.pinata.cloud";
export const ORBITOR_GATEWAY_HOST = "ipfs.orbitor.dev";
export const FILEBASE_GATEWAY_HOST = "ipfs.filebase.io";

/** The counted hosts, in display order. Success needs every one. */
export const COUNTED_GATEWAY_HOSTS: readonly string[] = [PINATA_GATEWAY_HOST, ORBITOR_GATEWAY_HOST];
/** Our main storage host's gateway: reported, never counted. */
export const FALLBACK_GATEWAY_HOSTS: readonly string[] = [FILEBASE_GATEWAY_HOST];
export const ALLOWED_GATEWAY_HOSTS: readonly string[] = [
  ...COUNTED_GATEWAY_HOSTS,
  ...FALLBACK_GATEWAY_HOSTS,
];
/** Never valid: retired (ipfs.io, dweb.link 2026-09-21) or Storacha's (uploads ended 2026-04-15). */
export const NEVER_GATEWAY_HOSTS: readonly string[] = [
  "ipfs.io",
  "dweb.link",
  "w3s.link",
  "storacha.link",
];

export const STORAGE_HOST_LABEL = "our main storage host · fallback, not counted";
/** The plain-facts label for each host. */
export const GATEWAY_LABELS: Readonly<Record<string, string>> = {
  [PINATA_GATEWAY_HOST]: "public gateway · also holds our second copy",
  [ORBITOR_GATEWAY_HOST]: "public gateway · holds no copy of ours",
  [FILEBASE_GATEWAY_HOST]: STORAGE_HOST_LABEL,
};
/** Whether the host's operator holds a copy of our files (Pinata: the AM-10 second copy). */
export const HOLDS_OUR_COPY: Readonly<Record<string, boolean>> = {
  [PINATA_GATEWAY_HOST]: true,
  [ORBITOR_GATEWAY_HOST]: false,
  [FILEBASE_GATEWAY_HOST]: true,
};

export type GatewayRole = "counted" | "fallback";

/** A host, or an `https://host` URL. */
export function hostOf(gateway: string): string {
  return gateway.includes("://") ? new URL(gateway).host : gateway;
}

export function gatewayRole(gateway: string): GatewayRole {
  return FALLBACK_GATEWAY_HOSTS.includes(hostOf(gateway)) ? "fallback" : "counted";
}

export function gatewayLabel(gateway: string): string {
  return GATEWAY_LABELS[hostOf(gateway)] ?? "unknown gateway";
}

export function holdsOurCopy(gateway: string): boolean {
  return HOLDS_OUR_COPY[hostOf(gateway)] ?? false;
}

/**
 * The exact refusal, naming each allowed gateway with its label. `display` turns a host into the
 * form the caller accepts (a bare host for src/verify.ts, `https://host` for the script).
 */
export function gatewayRefusalText(
  refused: string,
  display: (host: string) => string = (h) => h,
): string {
  const named = ALLOWED_GATEWAY_HOSTS.map((h) => `${display(h)} (${gatewayLabel(h)})`);
  return `Refused gateway ${refused}: verify-manifest only uses ${named.slice(0, -1).join(", ")} and ${named.at(-1) ?? ""}`;
}
