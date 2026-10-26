// A-11: a run lock for scripts that wipe and rewrite a shared output (re-export, batch export).
// The lock is a file holding the owner's PID, placed OUTSIDE any hashed directory. A live owner
// makes a second instance refuse to start; a lock whose PID is gone is stale and is taken over.
//
// A-16 A11-10(b): the takeover is atomic.
//  - Creating the lock writes the pid to a private temp file and publishes it with a hard link
//    (link fails if the lock exists), so a reader never sees a half-written, empty owner and
//    mistakes it for stale.
//  - Only the process that creates the takeover guard (`<lock>.takeover`, exclusive create) may
//    replace a stale lock. It re-reads the owner after taking the guard (a rival may already have
//    finished a takeover), renames the stale file aside (rename is atomic), then creates the lock
//    exclusively. Every other racer fails closed.
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

function defaultAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

export interface RunLockOptions {
  /** Owner pid to record (default: this process). */
  pid?: number;
  alive?: (pid: number) => boolean;
  /** Test hook: runs after the stale owner is read, before the takeover guard is taken. */
  beforeTakeover?: () => void;
  /** Test hook: runs while this process holds the takeover guard. */
  afterGuard?: () => void;
  /** Age after which a leftover takeover guard is stale (default GUARD_STALE_MS). */
  guardStaleMs?: number;
}

function readOwner(path: string): number {
  try {
    return Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  } catch {
    return Number.NaN; // vanished or unreadable
  }
}

function tryCreate(path: string, pid: number): boolean {
  const tmp = `${path}.${pid}.${process.pid}.tmp`;
  writeFileSync(tmp, `${pid}\n`);
  try {
    linkSync(tmp, path); // atomic: fails with EEXIST if the lock is there
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** A takeover guard older than this is stale (its process died mid-takeover). */
export const GUARD_STALE_MS = 60_000;

function clearStaleGuard(guard: string, staleMs: number): boolean {
  try {
    if (Date.now() - statSync(guard).mtimeMs < staleMs) return false;
    rmSync(guard, { force: true });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT"; // gone already: try again
  }
}

function tryGuard(path: string): boolean {
  try {
    closeSync(openSync(path, "wx"));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/** Takes the lock or throws naming the live owner. Returns a release function (idempotent). */
export function acquireRunLock(path: string, options: RunLockOptions = {}): () => void {
  const pid = options.pid ?? process.pid;
  const alive = options.alive ?? defaultAlive;
  if (!tryCreate(path, pid)) {
    const owner = readOwner(path);
    if (Number.isInteger(owner) && owner > 0 && alive(owner)) {
      throw new Error(`${path} is held by running pid ${owner}; refusing to start a second run`);
    }
    options.beforeTakeover?.();
    const guard = `${path}.takeover`;
    if (!tryGuard(guard)) {
      // A takeover takes milliseconds; a guard older than this was left by a killed process
      // (code-review finding 5) and must not block every later takeover.
      if (!clearStaleGuard(guard, options.guardStaleMs ?? GUARD_STALE_MS) || !tryGuard(guard)) {
        throw new Error(`${path}: another process is taking over (${guard}); not starting`);
      }
    }
    try {
      options.afterGuard?.();
      const now = readOwner(path);
      // The lock changed hands since we judged it stale (or its new owner is alive): not ours.
      if (!Object.is(now, owner) && !Number.isNaN(now)) {
        throw new Error(`${path}: lost the race for the lock (now pid ${now}); not starting`);
      }
      const aside = `${path}.stale.${pid}.${process.pid}`;
      try {
        renameSync(path, aside); // atomic; ENOENT means someone else already removed it
        rmSync(aside, { force: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (!tryCreate(path, pid))
        throw new Error(`${path}: lost the race for the lock; not starting`);
    } finally {
      rmSync(guard, { force: true });
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (readOwner(path) === pid) rmSync(path, { force: true });
  };
}
