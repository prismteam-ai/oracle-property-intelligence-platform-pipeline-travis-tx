// The RUNTIME_URL guard (A-03 T023, TC-060, FR-010; constitution I "localhost is never
// evidence"). This module has no dependencies so playwright.config.ts can load it before
// anything else, and so the two fixed texts (plan § "Fixed texts and config keys",
// test plan § 3) live in exactly one place.

/** Thrown when RUNTIME_URL is missing or blank. Verbatim from the plan; never reworded. */
export const RUNTIME_URL_UNSET_TEXT = "RUNTIME_URL is not set; set it to the hosted URL";

/** Thrown for a loopback URL; `{value}` is the value exactly as given. */
export function runtimeUrlLocalhostText(value: string): string {
  return `RUNTIME_URL must be a hosted URL, not localhost: ${value}`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** True for localhost, any `*.localhost` name, the whole 127/8 range and the IPv6 loopback. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/**
 * Returns the hosted base URL (trailing slashes removed) or throws one of the fixed texts.
 * A value that is not a URL at all is refused with its own message: it is neither hosted nor
 * localhost, and silently treating it as hosted would let a typo pass as evidence.
 */
export function assertHostedRuntimeUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") throw new Error(RUNTIME_URL_UNSET_TEXT);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`RUNTIME_URL is not a URL: ${value ?? ""}`);
  }
  if (isLoopbackHost(url.hostname)) throw new Error(runtimeUrlLocalhostText(value ?? ""));
  return trimmed.replace(/\/+$/, "");
}

/** The hosted runtime every spec starts from. Reads `process.env.RUNTIME_URL` each call. */
export function runtimeUrl(): string {
  return assertHostedRuntimeUrl(process.env.RUNTIME_URL);
}
