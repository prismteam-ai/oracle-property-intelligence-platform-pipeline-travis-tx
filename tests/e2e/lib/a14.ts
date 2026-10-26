// Shared helpers of the A-14 hosted specs (A-14.spec.ts for the Explore · AI tab and Help · MCP,
// A-14-mcp.spec.ts for the hosted /mcp endpoint). Nothing here reads a secret into a file: the MCP
// token is read from process.env.MCP_TOKEN only, and evidence files hold bodies and timings, never
// request headers.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { isLoopbackHost, repoRoot } from "./runtime.js";

export const A14_EVIDENCE_IMG_DIR = resolve(repoRoot, "docs", "evidence", "img");
export const A14_MCP_EVIDENCE_DIR = resolve(repoRoot, "docs", "evidence", "mcp");

/** The small run (14 properties, 35 reroof permits). Run 2 (full county) is too heavy for the
 *  server, so every data call of the MCP spec pins this manifest. */
export const SMALL_RUN_MANIFEST_CID = "bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i";

/** Golden queries G1-G6, word for word (assessment-guide reference/checks.md § 7.1). */
export const GOLDEN = {
  G1: "Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?",
  G2: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?",
  G3: "Show me open roofing permits older than five years within five miles of Manor",
  G4: "Which homes near Lakeway haven't changed owners in 10+ years and have owners outside the area?",
  G5: "What's the BBB rating of the contractor on permit 1982-012866 BP?",
  G6: "How many properties have roofs older than 40 years in ZIP 99999?",
  ROUND_ROCK: "Which properties within five miles of Round Rock have roofs older than 15 years?",
} as const;

/** `A-14-TC-001`, `A-14-TC-NF-01`. Accepts `1`, `001`, `TC-001`, `NF-01`. */
export function a14TcId(tc: string): string {
  const bare = tc
    .trim()
    .replace(/^A-14-/i, "")
    .replace(/^TC-/i, "");
  if (bare === "") throw new Error("A-14 checkpoint: empty test case ID");
  return `TC-${/^\d+$/.test(bare) ? bare.padStart(3, "0") : bare.toUpperCase()}`;
}

export function a14Slug(step: string): string {
  const slug = step
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`A-14 checkpoint: step "${step}" has no usable characters`);
  return slug;
}

/** Title of a case: `@scenario:A-14-TC-{nnn}`. */
export const scenario14 = (tc: string): string => `@scenario:A-14-${a14TcId(tc)}`;

/** Saves docs/evidence/img/A-14-TC-{nnn}-{step}.png and attaches it to the report. */
export async function a14Checkpoint(
  page: Page,
  tc: string,
  step: string,
  options: { fullPage?: boolean } = {},
): Promise<string> {
  const name = `A-14-${a14TcId(tc)}-${a14Slug(step)}.png`;
  mkdirSync(A14_EVIDENCE_IMG_DIR, { recursive: true });
  const body = await page.screenshot({
    path: resolve(A14_EVIDENCE_IMG_DIR, name),
    fullPage: options.fullPage ?? false,
  });
  await test.info().attach(name, { body, contentType: "image/png" });
  return `docs/evidence/img/${name}`;
}

/** The hosted MCP base URL. Throws for a missing or loopback value (localhost is never evidence). */
export function mcpUrl(): string {
  const value = (process.env.MCP_URL ?? "").trim();
  if (value === "") throw new Error("MCP_URL is not set; set it to the hosted MCP URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MCP_URL is not a URL: ${value}`);
  }
  if (isLoopbackHost(url.hostname)) {
    throw new Error(`MCP_URL must be a hosted URL, not localhost: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

/** Writes a token-free evidence file under docs/evidence/mcp/. Returns the repo-relative path. */
export function saveMcpEvidence(name: string, value: unknown): string {
  mkdirSync(A14_MCP_EVIDENCE_DIR, { recursive: true });
  writeFileSync(resolve(A14_MCP_EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
  return `docs/evidence/mcp/${name}`;
}

/** Nearest-rank percentile of a list of numbers. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile: no values");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}
