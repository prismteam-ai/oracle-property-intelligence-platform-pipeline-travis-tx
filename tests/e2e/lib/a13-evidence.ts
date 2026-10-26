// Evidence file docs/evidence/A-13-pages.md: one marked section per case (TC-058, TC-073, TC-080, TC-081).
// Pure Node, no Playwright import, so Vitest can test it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { repoRoot } from "./runtime.js";

export const PAGES_EVIDENCE = resolve(repoRoot, "docs", "evidence", "A-13-pages.md");

/** Replaces (or appends) the marked section `id` of a Markdown text. */
export function upsertSection(text: string, id: string, body: string): string {
  const start = `<!-- ${id}:start -->`;
  const end = `<!-- ${id}:end -->`;
  const block = `${start}\n${body.trimEnd()}\n${end}`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from >= 0 && to > from) return `${text.slice(0, from)}${block}${text.slice(to + end.length)}`;
  return `${text.trimEnd()}${text.trim() === "" ? "" : "\n\n"}${block}\n`;
}

/** Writes one case's section of docs/evidence/A-13-pages.md (workers = 1, so no write race). */
export function writeEvidenceSection(id: string, body: string, file = PAGES_EVIDENCE): string {
  mkdirSync(dirname(file), { recursive: true });
  const existing = existsSync(file)
    ? readFileSync(file, "utf8")
    : "# A-13 pages evidence\n\nWritten by tests/e2e/A-13-pages.spec.ts, A-13-scan.spec.ts and A-13-vitals.spec.ts against the hosted URL.\n";
  writeFileSync(file, upsertSection(existing, id, body));
  return "docs/evidence/A-13-pages.md";
}
