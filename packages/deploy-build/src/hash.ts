import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

export function sha256FileRaw(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file, { highWaterMark: 4 << 20 })
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
}

/** SHA-256 of files with a (path, size, mtime) cache, so a re-run over unchanged inputs only stats them. */
export class HashCache {
  private entries: Record<string, CacheEntry> = {};
  private dirty = false;
  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        this.entries = JSON.parse(readFileSync(file, 'utf8')) as Record<string, CacheEntry>;
      } catch {
        this.entries = {};
      }
    }
  }
  async sha256(file: string): Promise<string> {
    const st = statSync(file);
    const hit = this.entries[file];
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha256;
    const sha256 = await sha256FileRaw(file);
    this.entries[file] = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
    this.dirty = true;
    return sha256;
  }
  save(): void {
    if (!this.file || !this.dirty) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries));
    this.dirty = false;
  }
}

/** Run `fn` over `items` with bounded concurrency. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
