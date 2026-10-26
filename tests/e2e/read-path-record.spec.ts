// A-03-TC-NF-06: the read-path decision record holds the spike's full-size measurements and
// states the accepted decision (T061; AC-4, FR-004, NFR-001; ARD § 16 AM-04, AM-06). A CLI
// case: step 0 reads the deployed `sha` from {RUNTIME_URL}/build.json and requires the local
// HEAD to equal it (the record checked is the deployed one), then parses
// docs/decisions/0001-read-path.md and requires, for the full Austin table and 20 timed runs:
// p50 / p95 of COUNT, radius and roof-age through the CID copy at the chosen part size `48m`;
// the first-load time; the gateway legs; the Filebase plan limits; the projected full-county
// size; the chosen part size. It then requires the record to STATE the decision, not numbers
// that cannot exist yet:
// - every browser query whose p95 is ≥ 3,000 ms at 48m is recorded as switched to the Lambda
//   DuckDB fallback; for COUNT that is the full-scale switch of AM-06, which the record quotes
//   under "PO decision (D-4)";
// - the browser keeps first load and small reads;
// - Filebase at full scale is a known gap until A-11, because only `elephant-cli` output may be
//   public (no full-size table is published to measure it).
// A missing field fails the test naming it. The row count is read from the record and compared
// with the capture receipt when that (gitignored) receipt is present; it is never a literal here.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { CaptureSummary, LIMITS, TIMED_RUNS, nfrConfig } from "./lib/perf.js";
import { fetchBuildInfo, localHeadSha, repoRoot } from "./lib/runtime.js";

const RECORD = resolve(repoRoot, "docs", "decisions", "0001-read-path.md");
const CHOSEN_PART_SIZE = "48m";

interface Section {
  heading: string;
  body: string;
}

/** `## ` and `### ` sections, in order. */
function sections(markdown: string): Section[] {
  const out: Section[] = [];
  let current: Section | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^#{2,3}\s+(.*)$/.exec(line);
    if (m) {
      current = { heading: m[1] ?? "", body: "" };
      out.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  return out;
}

const section = (all: Section[], pattern: RegExp): Section | undefined =>
  all.find((s) => pattern.test(s.heading));

interface Table {
  header: string[];
  rows: string[][];
}

/** Every markdown table in a text block. */
function tables(text: string): Table[] {
  const out: Table[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    const next = lines[i + 1]?.trim() ?? "";
    if (!line.startsWith("|") || !/^\|\s*-{3}/.test(next)) continue;
    const cells = (row: string): string[] =>
      row
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
    const table: Table = { header: cells(line), rows: [] };
    let j = i + 2;
    while ((lines[j]?.trim() ?? "").startsWith("|")) {
      table.rows.push(cells(lines[j]?.trim() ?? ""));
      j += 1;
    }
    out.push(table);
    i = j - 1;
  }
  return out;
}

const num = (text: string): number => Number(text.replace(/[,*\s]/g, ""));

/** The first `p50 / p95` pair in a cell, in ms. */
function pair(cell: string | undefined): { p50: number; p95: number } | undefined {
  const m = /([\d,]+(?:\.\d+)?)\s*\**\s*\/\s*\**\s*([\d,]+(?:\.\d+)?)/.exec(cell ?? "");
  if (!m) return undefined;
  const p50 = num(m[1] ?? "");
  const p95 = num(m[2] ?? "");
  return Number.isFinite(p50) && Number.isFinite(p95) ? { p50, p95 } : undefined;
}

const column = (table: Table, pattern: RegExp): number =>
  table.header.findIndex((h) => pattern.test(h));

const QUERIES = [
  { name: "COUNT", header: /^COUNT/i, switchName: /\bCOUNT\b/i },
  { name: "radius", header: /^Radius/i, switchName: /\bradius\b/i },
  { name: "roof-age", header: /^Roof-age(?!.*warm)/i, switchName: /\broof-age\b/i },
] as const;

test.describe("A-03-TC-NF-06 decision record holds the spike's full-size measurements", () => {
  test("@scenario:A-03-TC-NF-06", async () => {
    const testInfo = test.info();
    // Step 0: the deployed commit is the one checked out.
    const build = await fetchBuildInfo();
    const head = localHeadSha();
    expect(
      head,
      `local HEAD ${head} must equal the deployed sha ${build.sha} (run: git checkout ${build.sha})`,
    ).toBe(build.sha);

    expect(existsSync(RECORD), `${RECORD} exists`).toBe(true);
    const markdown = readFileSync(RECORD, "utf8");
    const all = sections(markdown);
    const missing: string[] = [];
    const found: Record<string, unknown> = {};

    // Full table: the captured row count.
    const capture = section(all, /Austin capture/i);
    const capturedRow = capture
      ? tables(capture.body)
          .flatMap((t) => t.rows)
          .find((r) => /Rows captured/i.test(r[0] ?? ""))
      : undefined;
    const capturedRows = capturedRow
      ? num(/([\d,]{7,})/.exec(capturedRow[1] ?? "")?.[1] ?? "")
      : Number.NaN;
    if (!Number.isFinite(capturedRows) || capturedRows <= 0)
      missing.push("Austin capture: rows captured (full table)");
    found.capturedRows = capturedRows;
    const receiptPath = nfrConfig().austinCaptureSummary;
    if (existsSync(receiptPath)) {
      const receipt = CaptureSummary.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
      found.receiptTotal = receipt.total;
      if (receipt.total !== capturedRows) {
        missing.push(
          `Austin capture: rows captured ${capturedRows} ≠ capture receipt total ${receipt.total}`,
        );
      }
    } else {
      testInfo.annotations.push({
        type: "note",
        description: `capture receipt ${receiptPath} not present in this checkout; row count read from the record only`,
      });
    }

    // Browser through the CID copy: the per-variant table at the chosen part size, 20 runs.
    const browser = section(all, /p50 \/ p95 per query and part-size variant/i);
    if (!browser) missing.push("browser (CID copy): the p50 / p95 per query and part-size table");
    if (browser && !new RegExp(`${TIMED_RUNS} runs`).test(browser.heading + browser.body)) {
      missing.push(`browser (CID copy): ${TIMED_RUNS} timed runs stated`);
    }
    const variantTable = browser
      ? tables(browser.body).find((t) => /Variant/i.test(t.header[0] ?? ""))
      : undefined;
    const chosen = variantTable?.rows.find(
      (r) => (r[0] ?? "").replace(/\*/g, "").trim() === CHOSEN_PART_SIZE,
    );
    const browserP95: Record<string, number> = {};
    if (!variantTable || !chosen) {
      missing.push(`browser (CID copy): the ${CHOSEN_PART_SIZE} row`);
    } else {
      const firstLoad = pair(chosen[column(variantTable, /First load/i)]);
      if (!firstLoad)
        missing.push(`browser (CID copy): first load p50 / p95 at ${CHOSEN_PART_SIZE}`);
      found.firstLoad = firstLoad;
      for (const q of QUERIES) {
        const p = pair(chosen[column(variantTable, q.header)]);
        if (!p) missing.push(`browser (CID copy): ${q.name} p50 / p95 at ${CHOSEN_PART_SIZE}`);
        else browserP95[q.name] = p.p95;
      }
    }
    found.browserP95 = browserP95;

    // First load (dedicated table), gateway legs, Filebase plan limits, projected size, part size.
    const firstLoadTable = tables(markdown).find((t) => /First load/i.test(t.header[0] ?? ""));
    if (!firstLoadTable?.rows.some((r) => r.some((c) => /[\d,]+\s*ms/.test(c))))
      missing.push("first-load time table (ms)");
    const legs = section(all, /gateway legs/i);
    const legRow = legs
      ? tables(legs.body)
          .flatMap((t) => t.rows)
          .find((r) => /ipfs\.filebase\.io/.test(r[0] ?? ""))
      : undefined;
    if (!legRow?.some((c) => /\d/.test(c)))
      missing.push("gateway legs: measured row for ipfs.filebase.io");
    const plan = section(all, /Filebase plan limits/i);
    const freeRow = plan
      ? tables(plan.body)
          .flatMap((t) => t.rows)
          .find((r) => /^Free$/i.test(r[0] ?? ""))
      : undefined;
    if (!freeRow?.some((c) => /\d/.test(c)))
      missing.push("Filebase plan limits: the Free plan's limits");
    const projected = section(all, /Projected full-county size/i);
    const totalRow = projected
      ? tables(projected.body)
          .flatMap((t) => t.rows)
          .find((r) => /Total/i.test(r[0] ?? ""))
      : undefined;
    if (!totalRow?.some((c) => /[\d.]+\s*GB/.test(c)))
      missing.push("projected full-county size: total in GB");
    const decision = section(all, /^Decision$/i);
    if (!decision || !new RegExp(`--part-size ${CHOSEN_PART_SIZE}`).test(decision.body)) {
      missing.push(`decision: chosen part size ${CHOSEN_PART_SIZE}`);
    }

    // The accepted decision (D-4; ARD § 16 AM-04, AM-06), stated in the record itself.
    const d4 = section(all, /^PO decision \(D-4/i);
    if (!d4) missing.push('the "PO decision (D-4, …)" section');
    if (!d4 || !/AM-06/.test(d4.body) || !/COUNT also runs on the Lambda/i.test(d4.body)) {
      missing.push(
        "PO decision (D-4): a dated note quoting AM-06 (full-scale COUNT on the Lambda)",
      );
    }
    const stated = `${d4?.body ?? ""}\n${decision?.body ?? ""}`;
    const sentences = stated.split(/(?<=[.:])\s+/);
    const fullScale = /full[ -](?:scale|county)/i;
    const switched = (q: (typeof QUERIES)[number], atFullScale: boolean): boolean =>
      sentences.some(
        (s) =>
          /switch/i.test(s) &&
          q.switchName.test(s) &&
          /Lambda/i.test(s) &&
          (!atFullScale || fullScale.test(s)),
      );
    // Every browser p95 ≥ 3 s at 48m has a recorded switch; radius and roof-age at any scale
    // (AM-04), COUNT at full scale (AM-06: A-03's slice stays in the browser).
    for (const q of QUERIES) {
      const p95 = browserP95[q.name];
      if (p95 !== undefined && p95 >= LIMITS.queryP95Ms && !switched(q, q.name === "COUNT")) {
        missing.push(
          `switch: browser ${q.name} p95 ${p95} ms ≥ ${LIMITS.queryP95Ms} ms at ${CHOSEN_PART_SIZE} with no recorded ${q.name === "COUNT" ? "full-scale " : ""}switch to the Lambda DuckDB fallback`,
        );
      }
    }
    const keeps = sentences.filter((s) => /browser keeps/i.test(s)).join(" ");
    for (const kept of [/first load/i, /small reads/i]) {
      if (!kept.test(keeps))
        missing.push(`decision: the browser keeps ${kept.source.replace(/\\/g, "")}`);
    }
    // Filebase at full scale: a documented known gap until A-11, with its reason.
    const filebaseGap =
      /Filebase at (?:full )?scale[^.]*?(?:known gap|unmeasured)[^.]*?A-11|Filebase at (?:full )?scale[^.]*?A-11[^.]*?(?:known gap|unmeasured)/i;
    const known = section(all, /^Known gaps$/i);
    if (!filebaseGap.test(d4?.body ?? "") && !filebaseGap.test(known?.body ?? "")) {
      missing.push("known gap: Filebase at full scale is unmeasured until A-11");
    }
    if (!/only `?elephant-cli`? output may be public/i.test(markdown)) {
      missing.push("known gap reason: only `elephant-cli` output may be public");
    }

    await testInfo.attach("tc-nf-06-parsed.json", {
      body: JSON.stringify(
        { record: "docs/decisions/0001-read-path.md", sha: build.sha, found, missing },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(missing, "fields the decision record must hold").toEqual([]);
  });
});
