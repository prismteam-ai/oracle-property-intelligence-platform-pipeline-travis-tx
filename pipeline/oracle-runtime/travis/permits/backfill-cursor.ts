// A-04: the backfill resume cursor (AC-17). A backfill that ends failed (a page still timing
// out after 5 attempts, a Loader outage) must not start over at page 1 when `permits --mode
// backfill` is started again. This file, `backfill-cursor.json` in the permits artifacts root,
// records the last COMMITTED page (captured and merged), so the next run asks `:id > <lastId>`
// and continues the page numbering. A page that was captured but not yet merged is recorded
// as `pending`; the next run re-merges it from the on-disk raw page when the decoded bytes
// still match the recorded sha256, otherwise it fetches that page again. The Loader merge is
// idempotent on the page digest, so a merged-but-not-committed page is harmless.
//
// The file holds no row data (ids and digests only) and is gitignored with the artifacts.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const PageRef = z.object({
  index: z.number().int().min(1),
  sha256: z.string().min(1),
  /** The job whose folder holds `raw/pages/page-NNNNNN.json.gz`. */
  jobId: z.string().min(1),
});
export type PageRef = z.infer<typeof PageRef>;

const Pending = PageRef.extend({
  lastId: z.string().nullable(),
  rows: z.number().int().min(0),
  maxUpdatedAt: z.string().nullable(),
});
export type PendingPage = z.infer<typeof Pending>;

export const BackfillCursor = z.object({
  originJobId: z.string().min(1),
  complete: z.boolean(),
  /** Last `:id` of the last committed page (server order); null before the first page. */
  lastId: z.string().nullable(),
  /** Index of the next page to commit (1 for a fresh backfill). */
  nextIndex: z.number().int().min(1),
  /** Committed pages that carried rows (the key-set diff reads them back). */
  pages: z.array(PageRef),
  rows: z.number().int().min(0),
  written: z.number().int().min(0),
  maxUpdatedAt: z.string().nullable(),
  pending: Pending.nullable(),
  /**
   * What produced the cursor (profile SHA-256 and a fingerprint of the page code/config).
   * Absent on a cursor written before this check: such a cursor is resumed and stamped.
   */
  profileSha256: z.string().optional(),
  codeSha: z.string().optional(),
});
export type BackfillCursor = z.infer<typeof BackfillCursor>;

export const CURSOR_FILE = "backfill-cursor.json";

export const freshCursor = (
  originJobId: string,
  stamp: { profileSha256?: string; codeSha?: string } = {},
): BackfillCursor => ({
  ...stamp,
  originJobId,
  complete: false,
  lastId: null,
  nextIndex: 1,
  pages: [],
  rows: 0,
  written: 0,
  maxUpdatedAt: null,
  pending: null,
});

export function loadCursor(root: string): BackfillCursor | null {
  const path = join(root, CURSOR_FILE);
  if (!existsSync(path)) return null;
  const parsed = BackfillCursor.safeParse(JSON.parse(readFileSync(path, "utf8")));
  return parsed.success ? parsed.data : null;
}

/** Atomic write (tmp file, then rename), so an interrupted step never leaves half a cursor. */
export function saveCursor(root: string, cursor: BackfillCursor): void {
  mkdirSync(root, { recursive: true });
  const path = join(root, CURSOR_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cursor, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Records a captured page that is not merged yet (idempotent). */
export function markPending(root: string, originJobId: string, pending: PendingPage): void {
  const cursor = loadCursor(root) ?? freshCursor(originJobId);
  saveCursor(root, { ...cursor, pending });
}

/** Commits a merged page: the cursor moves past it (idempotent for the same page). */
export function commitPage(
  root: string,
  originJobId: string,
  page: PendingPage,
  written: number,
): void {
  const cursor = loadCursor(root) ?? freshCursor(originJobId);
  if (cursor.nextIndex > page.index) return; // already committed (a replay)
  saveCursor(root, {
    ...cursor,
    lastId: page.lastId ?? cursor.lastId,
    nextIndex: page.index + 1,
    pages:
      page.rows > 0
        ? [...cursor.pages, { index: page.index, sha256: page.sha256, jobId: page.jobId }]
        : cursor.pages,
    rows: cursor.rows + page.rows,
    written: cursor.written + written,
    maxUpdatedAt:
      page.maxUpdatedAt !== null &&
      (cursor.maxUpdatedAt === null || page.maxUpdatedAt > cursor.maxUpdatedAt)
        ? page.maxUpdatedAt
        : cursor.maxUpdatedAt,
    pending: null,
  });
}

/** Why a cursor must not be resumed (null: it may be). A cursor with no stamp is accepted. */
export function cursorMismatch(
  cursor: BackfillCursor,
  current: { profileSha256: string; codeSha: string },
): string | null {
  const diffs: string[] = [];
  if (cursor.profileSha256 !== undefined && cursor.profileSha256 !== current.profileSha256) {
    diffs.push(`profile SHA-256 ${cursor.profileSha256} != ${current.profileSha256}`);
  }
  if (cursor.codeSha !== undefined && cursor.codeSha !== current.codeSha) {
    diffs.push(`code SHA ${cursor.codeSha} != ${current.codeSha}`);
  }
  return diffs.length === 0 ? null : diffs.join("; ");
}

/** Moves the active cursor aside (never deleted) and returns the archive file name, or null. */
export function archiveCursor(root: string, tag: string): string | null {
  const path = join(root, CURSOR_FILE);
  if (!existsSync(path)) return null;
  const name = `backfill-cursor.${tag}.json`;
  renameSync(path, join(root, name));
  return name;
}

export function markComplete(root: string): void {
  const cursor = loadCursor(root);
  if (cursor !== null) saveCursor(root, { ...cursor, complete: true, pending: null });
}
