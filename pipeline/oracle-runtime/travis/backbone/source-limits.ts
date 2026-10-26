// A-04 T011 (A-04-TC-NF-01): one measured throughput row for docs/source-limits.md (GIS
// runner pages, Austin keyset pages). The lead writes the file from real run figures; this
// only formats them. Every field is required; a missing or impossible one fails naming it.
import { z } from "zod";

export const SOURCE_LIMITS_HEADER =
  "| Source | Pages | Rows | Duration (s) | Rows/s | Concurrency | Started | Finished |\n" +
  "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |";

const Input = z
  .object({
    source: z.string().min(1),
    pages: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    concurrency: z.number().int().positive(),
  })
  .strict()
  .refine((x) => Date.parse(x.finishedAt) > Date.parse(x.startedAt), {
    message: "finishedAt must be after startedAt",
    path: ["finishedAt"],
  });

export interface ThroughputRow {
  pages: number;
  duration_s: number;
  rows_per_s: number;
  markdown: string;
}

export function throughputRow(x: {
  source: string;
  pages: number;
  rows: number;
  startedAt: string;
  finishedAt: string;
  concurrency: number;
}): ThroughputRow {
  const parsed = Input.safeParse(x);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    throw new Error(`throughputRow: ${issues.join("; ")}`);
  }
  const v = parsed.data;
  const durationS = Math.round((Date.parse(v.finishedAt) - Date.parse(v.startedAt)) / 10) / 100;
  const rowsPerS = Math.round((v.rows / durationS) * 100) / 100;
  return {
    pages: v.pages,
    duration_s: durationS,
    rows_per_s: rowsPerS,
    markdown: `| ${v.source} | ${v.pages} | ${v.rows} | ${durationS} | ${rowsPerS.toFixed(2)} | ${v.concurrency} | ${v.startedAt} | ${v.finishedAt} |`,
  };
}
