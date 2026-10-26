// Checkpoint screenshots for the walkthrough evidence (A-03): one PNG per assertion checkpoint,
// saved as docs/evidence/img/A-03-TC-{nnn}-{step}.png (repo-relative, directory created when
// missing) and attached to the Playwright report under the same name. Text-only specs attach
// their key output with `checkpointText` instead.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { repoRoot } from "./runtime.js";

export const EVIDENCE_IMG_DIR = resolve(repoRoot, "docs", "evidence", "img");

/** `"010"`, `"TC-010"`, `"A-03-TC-010"` and `"NF-03"` all become `TC-010` / `TC-NF-03`. */
export function tcId(tc: string): string {
  const bare = tc
    .trim()
    .replace(/^A-03-/i, "")
    .replace(/^TC-/i, "");
  if (bare === "") throw new Error("checkpoint: empty test case ID");
  return `TC-${bare.toUpperCase()}`;
}

/** A file-name-safe step slug: lowercase, `[a-z0-9-]` only. */
export function stepSlug(step: string): string {
  const slug = step
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`checkpoint: step "${step}" has no usable characters`);
  return slug;
}

/** `A-03-TC-{nnn}-{step}.png`. */
export function evidenceFileName(tc: string, step: string): string {
  return `A-03-${tcId(tc)}-${stepSlug(step)}.png`;
}

/**
 * Saves a viewport screenshot of `page` to docs/evidence/img/A-03-TC-{nnn}-{step}.png and
 * attaches it to the current test. Returns the repo-relative path.
 */
export async function checkpoint(
  page: Page,
  tc: string,
  step: string,
  options: { fullPage?: boolean } = {},
): Promise<string> {
  const name = evidenceFileName(tc, step);
  mkdirSync(EVIDENCE_IMG_DIR, { recursive: true });
  const path = resolve(EVIDENCE_IMG_DIR, name);
  const body = await page.screenshot({ path, fullPage: options.fullPage ?? false });
  await test.info().attach(name, { body, contentType: "image/png" });
  return `docs/evidence/img/${name}`;
}

/** Attaches a text checkpoint (`A-03-TC-{nnn}-{step}.txt`) for specs that show no page. */
export async function checkpointText(tc: string, step: string, body: string): Promise<void> {
  await test.info().attach(`A-03-${tcId(tc)}-${stepSlug(step)}.txt`, {
    body,
    contentType: "text/plain",
  });
}
