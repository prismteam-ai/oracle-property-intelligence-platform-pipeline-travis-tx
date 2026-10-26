// A-16 T040 (AC-4, AC-5; agent-design metagross § 3): turns the two evidence docs into the data
// file the Coverage page renders, `apps/web/src/content/cost-limits.generated.json`.
//
//   docs/cost.md          -> cost  { asOf, source, fixedPerMonth, gross, credits, partialDay, budget, rows }
//   docs/source-limits.md -> limits { asOf, rows, readPath }
//
// The page never types a number: every figure on it is a cell of one of these tables, so the page
// can only say what the docs say. The file is committed (a doc change shows up in the diff) and a
// unit test (apps/web/test/cost-limits.test.ts) regenerates it from the docs and compares, so a
// doc edit without a rebuild fails CI. The build stops, with the row named, when:
//   - a section has no date (cost: "As of billing date", limits: "Updated"),
//   - a blocked source has no date it was refused on,
//   - a "not measured" source gives no reason,
//   - a figure the doc calls "not available" is a number or a zero in the table.
// Plain Node (no tsx): `node scripts/build-cost-limits.mjs [--check]`. `--check` writes nothing and
// exits 1 when the committed file differs from what the docs produce.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const COST_DOC = resolve(REPO_ROOT, "docs", "cost.md");
export const LIMITS_DOC = resolve(REPO_ROOT, "docs", "source-limits.md");
export const OUTPUT_FILE = resolve(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "content",
  "cost-limits.generated.json",
);

const DAY = /\d{4}-\d{2}-\d{2}/g;

/** A cell as display text: markdown markers and links removed, whitespace collapsed. */
export function clean(cell) {
  return (
    cell
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      // Internal story IDs (A-01, A-13 …) stay in the docs, never on the page.
      .replace(/,\s*A-\d{2}(?=\))/g, "")
      .replace(/\s*\(A-\d{2}[^)]*\)/g, "")
      .replace(/\bA-\d{2}\b\s*/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Every pipe table of a markdown text: { header, rows } with raw (unstripped) cells. */
export function tables(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (!line.trimStart().startsWith("|") || !/^\s*\|[\s:|-]+\|\s*$/.test(next)) continue;
    const split = (l) =>
      l
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
    const header = split(line).map(clean);
    const rows = [];
    let j = i + 2;
    while (j < lines.length && (lines[j] ?? "").trimStart().startsWith("|")) {
      rows.push(split(lines[j] ?? ""));
      j += 1;
    }
    out.push({ header, rows });
    i = j - 1;
  }
  return out;
}

function columnIndexes(table, names, what) {
  return names.map((name) => {
    const index = table.header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (index === -1) {
      throw new Error(
        `${what}: the table has no "${name}" column (found: ${table.header.join(", ")})`,
      );
    }
    return index;
  });
}

function findTable(md, firstHeader, what) {
  const found = tables(md).find((t) => t.header[0]?.toLowerCase() === firstHeader.toLowerCase());
  if (found === undefined) throw new Error(`${what}: no table starting with "${firstHeader}"`);
  return found;
}

const number = (text) => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text.replace(/[$]/g, ""));
  return m === null ? null : Number(m[0].replace(/,/g, ""));
};

// ---------------------------------------------------------------------------------------------
// docs/cost.md
// ---------------------------------------------------------------------------------------------

export function parseCost(md) {
  const asOf = /As of billing date \*\*(\d{4}-\d{2}-\d{2})\*\*/.exec(md)?.[1];
  if (asOf === undefined) {
    throw new Error(
      'docs/cost.md: no "As of billing date **YYYY-MM-DD**" line, so the Cost section has no date',
    );
  }
  const sourceLine = /Source:\s*([^\n]+)/.exec(md)?.[1];
  if (sourceLine === undefined) throw new Error('docs/cost.md: no "Source:" sentence');
  const source = clean(sourceLine.split(/\.\s+(?=The window)/)[0] ?? sourceLine).replace(/\.$/, "");

  const fixed = /Fixed \(idle\) cost:\s*(\$[\d.,]+) per month/.exec(md)?.[1];
  if (fixed === undefined) {
    throw new Error('docs/cost.md: no "Fixed (idle) cost: **$N per month" headline');
  }

  // Gross versus credits (Cost Explorer by record type).
  const grossTable = findTable(md, "UTC day", "docs/cost.md gross table");
  const [usageCol, creditCol] = columnIndexes(
    grossTable,
    ["Usage (gross)", "Credit"],
    "docs/cost.md gross table",
  );
  const totalRow = grossTable.rows.find((r) =>
    clean(r[0] ?? "")
      .toLowerCase()
      .startsWith("total"),
  );
  const partialRow = grossTable.rows.find((r) =>
    /^\d{4}-\d{2}-\d{2} \(partial/i.test(clean(r[0] ?? "")),
  );
  const window =
    totalRow === undefined ? null : clean(totalRow[0] ?? "").replace(/^Total,?\s*/i, "");
  const grossUsd = totalRow === undefined ? null : number(totalRow[usageCol ?? 1] ?? "");
  const creditUsd = totalRow === undefined ? null : number(totalRow[creditCol ?? 2] ?? "");
  const noTotal = "docs/cost.md has no total row in the gross-versus-credits table";
  const gross = {
    usd: grossUsd,
    window: window === null ? "not available" : `${window} to ${asOf}`,
    missingReason: grossUsd === null ? noTotal : null,
  };
  const credits = {
    usd: creditUsd,
    window: gross.window,
    missingReason: creditUsd === null ? noTotal : null,
  };
  const partialDay =
    partialRow === undefined
      ? null
      : {
          day: /^(\d{4}-\d{2}-\d{2})/.exec(clean(partialRow[0] ?? ""))?.[1] ?? asOf,
          grossUsd: number(partialRow[usageCol ?? 1] ?? "") ?? 0,
          creditUsd: number(partialRow[creditCol ?? 2] ?? "") ?? 0,
        };

  // The monthly budget the CDK Ops stack owns.
  const budgetMatch =
    /`(countylens-monthly-[^`]+)` budget exists, \$(\d+(?:\.\d+)?) per month[^.]*?alerts at ([^.;]*?)(?=[.;])/.exec(
      md,
    );
  const budget =
    budgetMatch === null
      ? {
          text: null,
          limitUsd: null,
          missingReason: "docs/cost.md names no CDK-managed monthly budget",
        }
      : {
          text: `$${budgetMatch[2]} / month · alerts at ${clean(budgetMatch[3] ?? "")}`,
          limitUsd: Number(budgetMatch[2]),
          missingReason: null,
        };

  // Component map: idle versus per use.
  const map = tables(md).find((t) => t.header[0]?.toLowerCase().startsWith("component"));
  if (map === undefined) throw new Error('docs/cost.md: no "Component" table');
  const [idleCol, useCol, paysCol, billCol] = columnIndexes(
    map,
    ["Idle cost per month", "Cost per use", "Who pays", "Seen in the bill"],
    "docs/cost.md component table",
  );
  const rows = map.rows.map((r) => ({
    component: clean(r[0] ?? ""),
    idle: clean(r[idleCol ?? 1] ?? "") || null,
    perUse: clean(r[useCol ?? 2] ?? "") || null,
    whoPays: clean(r[paysCol ?? 3] ?? "") || null,
    seenInBill: clean(r[billCol ?? 4] ?? "") || null,
    missingReason: null,
  }));
  for (const row of rows) {
    if (row.component === "" || row.idle === null) {
      throw new Error(
        `docs/cost.md component table: a row has no component or no idle cost (${row.component})`,
      );
    }
  }

  // Filebase: the doc states the usage is not available, with the reason; never a filled zero.
  const filebase = /Filebase usage:\s*\*\*not available\s*·\s*reason:\s*([\s\S]*?)\*\*/.exec(md);
  const filebaseKnown = /Known from the run log:\s*([^\n]*?)\s*Who pays:\s*([^.\n]*)/.exec(md);
  if (filebase === null) {
    const stated = /Filebase usage:\s*\*\*([^*]+)\*\*/.exec(md)?.[1];
    if (stated === undefined) throw new Error('docs/cost.md: no "Filebase usage:" statement');
    if (/^\$?0(\.0+)?$/.test(stated.trim())) {
      throw new Error(
        "docs/cost.md: Filebase usage is a bare zero; state a reason or a measured figure",
      );
    }
    rows.push({
      component: "Filebase (pinning vendor)",
      idle: clean(stated),
      perUse: filebaseKnown === null ? null : clean(filebaseKnown[1] ?? ""),
      whoPays: filebaseKnown === null ? null : clean(filebaseKnown[2] ?? ""),
      seenInBill: null,
      missingReason: null,
    });
  } else {
    const reason = clean(filebase[1] ?? "");
    if (reason === "")
      throw new Error("docs/cost.md: Filebase usage is not available without a reason");
    rows.push({
      component: "Filebase (pinning vendor)",
      idle: null,
      perUse: filebaseKnown === null ? null : clean(filebaseKnown[1] ?? ""),
      whoPays: filebaseKnown === null ? null : clean(filebaseKnown[2] ?? ""),
      seenInBill: null,
      missingReason: reason,
    });
  }

  return { asOf, source, fixedPerMonth: fixed, gross, credits, partialDay, budget, rows };
}

// ---------------------------------------------------------------------------------------------
// docs/source-limits.md
// ---------------------------------------------------------------------------------------------

const uniqueDays = (text) => [...new Set(text.match(DAY) ?? [])].sort();

function notMeasuredReason(throughput, fullCapture) {
  const rest = throughput.replace(/^not measured/i, "").trim();
  const parenthetical = /\(([^)]*)\)/.exec(rest)?.[1];
  const fromThroughput = (parenthetical ?? rest.replace(/^[:,;\s]+/, ""))
    .replace(/^reason:\s*/i, "")
    .trim();
  if (fromThroughput !== "") return fromThroughput.replace(/\.$/, "");
  const fromCapture = /\((?:reason:\s*)?([^)]*)\)/.exec(fullCapture)?.[1]?.trim();
  return fromCapture === undefined || fromCapture === "" ? null : fromCapture;
}

export function parseLimits(md) {
  const asOf = /Updated (\d{4}-\d{2}-\d{2})/.exec(md)?.[1];
  if (asOf === undefined) {
    throw new Error(
      'docs/source-limits.md: no "Updated YYYY-MM-DD" date, so the Limits section has no date',
    );
  }
  const sources = findTable(md, "Source", "docs/source-limits.md sources table");
  const [pageCol, thrCol, capCol, rateCol, botCol, optCol] = columnIndexes(
    sources,
    [
      "Access and page size",
      "Throughput",
      "Full-capture duration at full scale",
      "Rate limits and etiquette",
      "Anti-bot posture",
      "Optimisation applied",
    ],
    "docs/source-limits.md sources table",
  );
  const rows = sources.rows.map((r) => {
    const cell = (i) => clean(r[i] ?? "");
    const source = cell(0);
    const throughput = cell(thrCol ?? 1);
    const fullCapture = cell(capCol ?? 2);
    const antiBot = cell(botCol ?? 4);
    const notMeasured = /^not measured/i.test(throughput);
    const blocked =
      /^blocked/i.test(fullCapture) || (notMeasured && /\b403\b|\b406\b|challenge/i.test(antiBot));
    let status = "measured";
    let missingReason = null;
    let blockedDates = [];
    if (blocked) {
      status = "blocked";
      blockedDates = uniqueDays(/^blocked/i.test(fullCapture) ? fullCapture : antiBot);
      if (blockedDates.length === 0) {
        throw new Error(`docs/source-limits.md: "${source}" is blocked but no date is given`);
      }
    } else if (notMeasured) {
      status = "not_measured";
      missingReason = notMeasuredReason(throughput, fullCapture);
      if (missingReason === null) {
        throw new Error(`docs/source-limits.md: "${source}" is "not measured" without a reason`);
      }
    }
    if (status !== "measured" && /^0(\.0+)?$/.test(throughput)) {
      throw new Error(
        `docs/source-limits.md: "${source}" shows a zero where the doc says not available`,
      );
    }
    return {
      source,
      throughput: throughput || null,
      pageSize: cell(pageCol ?? 1) || null,
      fullCapture: fullCapture || null,
      rateLimit: cell(rateCol ?? 3) || null,
      antiBot: antiBot || null,
      optimisation: cell(optCol ?? 5) || null,
      status,
      blockedDates,
      missingReason,
    };
  });

  const readPathTable = findTable(md, "Step", "docs/source-limits.md publication table");
  const [measCol, limCol] = columnIndexes(
    readPathTable,
    ["Measured", "Limit and effect"],
    "docs/source-limits.md publication table",
  );
  const readPath = readPathTable.rows.map((r) => ({
    step: clean(r[0] ?? ""),
    measured: clean(r[measCol ?? 1] ?? ""),
    limit: clean(r[limCol ?? 2] ?? ""),
  }));
  return { asOf, rows, readPath };
}

export function buildCostLimits(costMd, limitsMd) {
  return { cost: parseCost(costMd), limits: parseLimits(limitsMd) };
}

function main() {
  const check = process.argv.includes("--check");
  const built = buildCostLimits(readFileSync(COST_DOC, "utf8"), readFileSync(LIMITS_DOC, "utf8"));
  const readCurrent = () => {
    try {
      return JSON.parse(readFileSync(OUTPUT_FILE, "utf8"));
    } catch {
      return null;
    }
  };
  const current = readCurrent();
  const same = JSON.stringify(current) === JSON.stringify(built);
  if (check) {
    if (!same) {
      process.stderr.write(
        "cost-limits.generated.json is out of date: run `node scripts/build-cost-limits.mjs`\n",
      );
      process.exit(1);
    }
    return;
  }
  // An unchanged result is left alone, so a Prettier-formatted committed file is not rewritten.
  if (!same) writeFileSync(OUTPUT_FILE, `${JSON.stringify(built, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
