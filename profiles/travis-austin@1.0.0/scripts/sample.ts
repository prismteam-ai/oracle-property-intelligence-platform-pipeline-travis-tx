// T024: the AC-3 review sample (research R-10, oracle § E.2).
//
// Population: description or work class mentions the profile's sample term (SoQL from
// toSoqlSamplePopulation()). Count, key-page the population keys, re-count (one retry on
// a mismatch), rank every key by sha256(seed + "\n" + permit_number), take the 25
// smallest, fetch those 25 rows, classify them, and write the PO review sheet
// docs/evidence/A-02-classifier-review.md.
//
// Run: pnpm --filter @countylens/profile-travis-austin sample
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  PROFILE,
  PROFILE_ID,
  classifyPermit,
  classifyStatus,
  toSoqlSamplePopulation,
  type PermitClassification,
  type PermitRow,
  type StatusClassification,
} from "../index.js";
import { MAX_PAGE_SIZE, SocrataClient, StopError, type Receipt } from "./socrata.js";
import { FIELDS } from "./measure.js";

export const SEED = `${PROFILE_ID}/AC-3/2026-10-21`;
export const SAMPLE_SIZE = 25;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export const rankKey = (seed: string, permit_number: string): string =>
  sha256(`${seed}\n${permit_number}`);

export function drawSample(
  keys: readonly string[],
  seed: string,
  n: number = SAMPLE_SIZE,
): { sample: string[]; population_count: number; keys_sha256: string } {
  const sorted = [...new Set(keys)].sort();
  const ranked = sorted
    .map((k) => ({ k, d: rankKey(seed, k) }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.k < b.k ? -1 : 1));
  return {
    sample: ranked.slice(0, n).map((x) => x.k),
    population_count: sorted.length,
    keys_sha256: sha256(sorted.join("\n") + "\n"),
  };
}

export interface SampleMeta {
  id: string;
  story: string;
  seed: string;
  population_where: string;
  population_count: number;
  population_rows: number;
  captured_at: string;
  keys_sha256: string;
  profile: { name: string; version: string; sha256: string };
  attempts: number;
  query_urls: string[];
  receipts: Receipt[];
}

export interface SampleRow {
  rank: number;
  row: PermitRow;
  permit: PermitClassification;
  status: StatusClassification;
}

export type SampleResult =
  | { outcome: "ok"; meta: SampleMeta; rows: SampleRow[] }
  | { outcome: "blocked"; reason: string; receipt: Receipt }
  | { outcome: "stopped"; reason: string };

export async function sample(
  client: SocrataClient,
  opts: { seed?: string; pageSize?: number; n?: number } = {},
): Promise<SampleResult> {
  const seed = opts.seed ?? SEED;
  const pageSize = Math.min(opts.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const where = toSoqlSamplePopulation();
  let reason = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const captured_at = client.now().toISOString();
      const before = await client.count(where);
      const keys = (await client.fetchAllKeyed("permit_number", where, pageSize)).map((r) =>
        String(r["permit_number"]),
      );
      const after = await client.count(where);
      if (keys.length !== before || after !== before) {
        reason = `fetched ${keys.length} keys but population count ${before} (re-count ${after})`;
        continue;
      }
      const draw = drawSample(keys, seed, opts.n ?? SAMPLE_SIZE);
      const inList = draw.sample.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");
      const fetched = (await client.query({
        $select: FIELDS,
        $where: `permit_number in (${inList})`,
        $limit: "1000",
      })) as PermitRow[];
      const byKey = new Map<string, PermitRow>();
      for (const r of fetched) if (!byKey.has(r.permit_number)) byKey.set(r.permit_number, r);
      const rows: SampleRow[] = draw.sample.map((k, i) => {
        const row = byKey.get(k);
        if (!row) throw new Error(`sampled permit ${k} not returned`);
        return {
          rank: i + 1,
          row,
          permit: classifyPermit(row),
          status: classifyStatus(row.status_current),
        };
      });
      return {
        outcome: "ok",
        rows,
        meta: {
          id: "A-02-classifier-review",
          story: "A-02",
          seed,
          population_where: where,
          population_count: draw.population_count,
          population_rows: keys.length,
          captured_at,
          keys_sha256: draw.keys_sha256,
          profile: { name: PROFILE.name, version: PROFILE.version, sha256: PROFILE.sha256 },
          attempts: attempt,
          query_urls: client.queryUrls(),
          receipts: client.receipts,
        },
      };
    }
    return { outcome: "stopped", reason };
  } catch (e) {
    if (e instanceof StopError && e.receipt.outcome === "blocked") {
      return { outcome: "blocked", reason: e.message, receipt: e.receipt };
    }
    throw e;
  }
}

const cell = (v: string | null | undefined): string =>
  v === null || v === undefined || v === ""
    ? "(none)"
    : v.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

const verdictOf = (p: PermitClassification): string =>
  p.roofing === "roofing"
    ? `roofing (${p.improvement_type} / ${p.improvement_action})`
    : p.roofing.replace("_", " ");

const statusNote = (s: StatusClassification): string => {
  const word = s.status_word ?? "(none)";
  if (!s.emit) return `status ${word} → ${s.class} (not emitted)`;
  return `status ${word} → ${s.class} (${s.improvement_status ?? "improvement_status null"})`;
};

export function renderReview(res: Extract<SampleResult, { outcome: "ok" }>): string {
  const m = res.meta;
  const counts = { roofing: 0, not_roofing: 0, needs_review: 0 };
  for (const r of res.rows) counts[r.permit.roofing] += 1;
  const lines = [
    "---",
    `id: ${m.id}`,
    `story: ${m.story}`,
    `seed: "${m.seed}"`,
    `population: "${m.population_where}"`,
    `population_count: ${m.population_count}`,
    `population_rows: ${m.population_rows}`,
    `captured_at: ${m.captured_at}`,
    `sorted_keys_sha256: ${m.keys_sha256}`,
    "profile:",
    `  name: ${m.profile.name}`,
    `  version: ${m.profile.version}`,
    `  sha256: ${m.profile.sha256}`,
    `source: ${m.receipts[0] ? new URL(m.receipts[0].url).origin + new URL(m.receipts[0].url).pathname : ""}`,
    "---",
    "",
    "# A-02 classifier review (AC-3, PO decision D-7)",
    "",
    `Profile \`${PROFILE_ID}\` (sha256 \`${m.profile.sha256}\`) applied to ${SAMPLE_SIZE} Austin permits drawn from the ${m.population_count} permits whose description or work class mentions ROOF (captured ${m.captured_at}).`,
    "",
    `**How they were drawn:** every permit number in the population was ranked by \`sha256(seed + "\\n" + permit_number)\` with the seed above; the ${SAMPLE_SIZE} smallest digests are listed in rank order. Anyone can redo the draw from the seed and the population.`,
    "",
    "**Pass (FR-003, NFR-001):** at least 24 of 25 marked right, at most 1 `needs_review`, and 0 solar/PV/RTU permits accepted as roofing.",
    "",
    `**Profile verdicts:** ${counts.roofing} roofing, ${counts.not_roofing} not roofing, ${counts.needs_review} needs_review.`,
    "",
    "Mark the last column ✔ (the verdict is right) or ✘ (wrong). The status note says how the status word is published (D-4a: Expired stays Expired and is published with improvement_status null).",
    "",
    "| # | permit_number | permittype | work_class | status_current | description | profile verdict | reason | PO ✔/✘ |",
    "|---|---|---|---|---|---|---|---|---|",
    ...res.rows.map(
      (r) =>
        `| ${r.rank} | ${cell(r.row.permit_number)} | ${cell(r.row.permittype)} | ${cell(r.row.work_class)} | ${cell(r.row.status_current)} | ${cell(r.row.description)} | ${verdictOf(r.permit)} | \`${r.permit.reason}\`; ${statusNote(r.status)} |  |`,
    ),
    "",
    "## Queries",
    "",
    ...m.query_urls.map((u) => `- ${u}`),
    "",
    "## Receipts",
    "",
    "| # | status | bytes | sha256 | captured_at |",
    "|---|---|---|---|---|",
    ...m.receipts.map(
      (r, i) => `| ${i + 1} | ${r.status} | ${r.bytes} | \`${r.sha256}\` | ${r.captured_at} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const res = await sample(new SocrataClient());
  if (res.outcome !== "ok") {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exitCode = 2;
    return;
  }
  const out = new URL("../../../docs/evidence/A-02-classifier-review.md", import.meta.url);
  writeFileSync(out, renderReview(res));
  const { receipts: _r, ...meta } = res.meta;
  process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
