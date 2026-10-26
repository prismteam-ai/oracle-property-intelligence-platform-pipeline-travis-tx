// A-11 Run 3: the schema of the facts file one incremental Austin permits refresh produces
// (pipeline/local-stack/scripts/incremental-facts.ts writes it, pipeline/publish/src/run-manifest.ts
// reads it). Kept apart from austin-run.ts so the database script imports only zod, never the
// manifest builder's dependency graph.
import { z } from "zod";

const Count = z.number().int().nonnegative();
const Iso = z.string().min(1);

/** The five unmatched reasons plus linked: every captured permit is exactly one of them. */
export const PermitLinkTotals = z
  .object({
    linkedPermits: Count,
    permits_no_tcad_geoid: Count,
    permits_no_tcad_id: Count,
    permits_ambiguous_geoid: Count,
    permits_address_unmatched: Count,
    permits_ambiguous_address: Count,
  })
  .strict();
export type PermitLinkTotals = z.infer<typeof PermitLinkTotals>;

export const AustinIncrementalFacts = z
  .object({
    schema: z.literal("oracle-travis-austin-incremental-facts.v1"),
    /** Loader job that captured and merged the window (`travis-a04-permits-incremental-...`). */
    jobId: z.string().min(1),
    /** The watermark the run started from: must equal the base manifest's Austin watermark. */
    watermarkUsed: Iso,
    /** The watermark the run commits (max `:updated_at` of the source at the end of the pass). */
    watermarkNew: Iso,
    /** Rows the capture read this run (the window, or the whole dataset after a re-stamp). */
    recordsRead: Count,
    /** Source rows at the new watermark (the source's own count at the end of the pass). */
    totalAfter: Count,
    /** Source rows before this run (the base manifest's `records`). */
    totalBefore: Count,
    capturedAt: Iso,
    /** How the capture was windowed. */
    mode: z.enum(["window", "full_pass"]),
    restampDetected: z.boolean(),
    delta: z.object({ added: Count, changed: Count, removed: Count }).strict(),
    /** Rows read that were already stored with the same content digest. */
    unchanged: Count,
    /** How removals were found: by key-set diff of a full pass, or not looked for. */
    removalDetection: z.enum(["keyset_diff", "not_checked"]),
    /** Permit-link totals over every live captured permit, after the link step re-ran. */
    permitLink: PermitLinkTotals,
  })
  .strict();
export type AustinIncrementalFacts = z.infer<typeof AustinIncrementalFacts>;

export function parseAustinFacts(raw: unknown): AustinIncrementalFacts {
  return AustinIncrementalFacts.parse(raw);
}
