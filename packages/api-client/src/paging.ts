import { ApiError } from './errors.js';

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

export interface CollectOptions {
  /** Stop once this many items are held (default 500). */
  maxItems?: number;
  /** Restarts from the first page after `stale_cursor` (default 1). */
  maxRestarts?: number;
}

/**
 * Walks `next_cursor` pages. A `stale_cursor` (400: the cursor belongs to another snapshot or day) restarts from the
 * first page, discarding what was collected, so the result is always one consistent snapshot.
 */
export async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: CollectOptions = {},
): Promise<{ items: T[]; restarts: number; truncated: boolean }> {
  const maxItems = options.maxItems ?? 500;
  const maxRestarts = options.maxRestarts ?? 1;
  let restarts = 0;
  for (;;) {
    const items: T[] = [];
    let cursor: string | undefined;
    try {
      for (;;) {
        const page = await fetchPage(cursor);
        items.push(...page.items);
        if (!page.next_cursor) return { items, restarts, truncated: false };
        if (items.length >= maxItems) {
          return { items: items.slice(0, maxItems), restarts, truncated: true };
        }
        cursor = page.next_cursor;
      }
    } catch (error) {
      if (error instanceof ApiError && error.isStaleCursor && restarts < maxRestarts) {
        restarts += 1;
        continue;
      }
      throw error;
    }
  }
}

/** One page with the same restart rule: a stale cursor falls back to the first page. */
export async function pageWithRestart<P extends { next_cursor: string | null }>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
  cursor: string | undefined,
): Promise<{ page: P; restarted: boolean }> {
  try {
    return { page: await fetchPage(cursor), restarted: false };
  } catch (error) {
    if (cursor !== undefined && error instanceof ApiError && error.isStaleCursor) {
      return { page: await fetchPage(undefined), restarted: true };
    }
    throw error;
  }
}
