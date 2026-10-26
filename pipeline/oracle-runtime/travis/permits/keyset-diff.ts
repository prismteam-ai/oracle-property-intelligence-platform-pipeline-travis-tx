// A-04 T052 (FR-021): which rows a page writes, and which source rows went away.
//
// planPageMerge: the permit is `(issuing_jurisdiction = austin, permit_number)`; several
// source rows (`:id`s) can carry one permit number. The current row is chosen with A-03's
// pickPermitRow (identical rows keep the first, else the latest `:updated_at`, ties broken by
// canonical JSON), between the current row and every row of the page with that number. A row
// is written only when the chosen row is a new one AND its content digest differs from the
// current row's (`ON CONFLICT … WHERE content_sha256 IS DISTINCT FROM excluded…` in SQL), so a
// re-stamp with unchanged content writes nothing. History stays in receipts and source rows.
//
// diffKeySets (full page-through only): a stored `:id` missing from the new pass is
//   - a re-key when its permit number is still present under another `:id` (no tombstone);
//   - removed (`source_removed` tombstone, the permit row downgraded, never deleted) when the
//     permit number is gone too.
import { pickPermitRow } from "../adapters/socrata/socrata.js";

export const WATERMARK_FIELD = ":updated_at";
export const TOMBSTONE_REASON = "source_removed";

export interface SourceRowIn {
  rowId: string;
  permitNumber: string;
  contentSha256: string;
  updatedAt: string | null;
  payload: Record<string, unknown>;
}

export interface CurrentRow {
  permitNumber: string;
  rowId: string;
  contentSha256: string;
  payload: Record<string, unknown>;
}

export interface PlannedUpsert {
  row: SourceRowIn;
  previousContentSha256: string | null;
  change: "added" | "changed";
}

export interface PagePlan {
  upserts: PlannedUpsert[];
  unchanged: number;
  /** Extra rows of a permit number inside this page (counted, never dropped silently). */
  duplicates: number;
}

export function planPageMerge(
  existing: ReadonlyMap<string, CurrentRow>,
  incoming: readonly SourceRowIn[],
): PagePlan {
  const groups = new Map<string, SourceRowIn[]>();
  for (const r of incoming) {
    const g = groups.get(r.permitNumber);
    if (g) g.push(r);
    else groups.set(r.permitNumber, [r]);
  }
  const upserts: PlannedUpsert[] = [];
  let unchanged = 0;
  let duplicates = 0;
  for (const [permitNumber, group] of groups) {
    duplicates += group.length - 1;
    const current = existing.get(permitNumber);
    const candidates = [...(current ? [current.payload] : []), ...group.map((g) => g.payload)];
    const { row } = pickPermitRow(candidates, WATERMARK_FIELD);
    const winner = group.find((g) => g.payload === row);
    if (winner === undefined || (current && current.contentSha256 === winner.contentSha256)) {
      unchanged += group.length;
      continue;
    }
    upserts.push({
      row: winner,
      previousContentSha256: current?.contentSha256 ?? null,
      change: current ? "changed" : "added",
    });
    unchanged += group.length - 1;
  }
  return { upserts, unchanged, duplicates };
}

export interface KeyRow {
  rowId: string;
  permitNumber: string;
}

export interface KeyDiff {
  removed: KeyRow[];
  rekeyed: { permitNumber: string; fromRowId: string }[];
}

/** Classifies stored rows missing from a full pass (`permitSeen`: the number is still listed). */
export function classifyMissing(missing: readonly (KeyRow & { permitSeen: boolean })[]): KeyDiff {
  const out: KeyDiff = { removed: [], rekeyed: [] };
  for (const m of missing) {
    if (m.permitSeen) out.rekeyed.push({ permitNumber: m.permitNumber, fromRowId: m.rowId });
    else out.removed.push({ rowId: m.rowId, permitNumber: m.permitNumber });
  }
  return out;
}

/** The key-set diff of a stored set against the keys seen by a full page-through. */
export function diffKeySets(existing: readonly KeyRow[], seen: readonly KeyRow[]): KeyDiff {
  const seenIds = new Set(seen.map((s) => s.rowId));
  const seenNumbers = new Set(seen.map((s) => s.permitNumber));
  return classifyMissing(
    existing
      .filter((e) => !seenIds.has(e.rowId))
      .map((e) => ({
        rowId: e.rowId,
        permitNumber: e.permitNumber,
        permitSeen: seenNumbers.has(e.permitNumber),
      })),
  );
}
