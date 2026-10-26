// A-16 A11-10(b): the run lock takes over a stale lock atomically. Only one of several racing
// acquirers wins; the rest fail closed, and a live owner's lock is never displaced.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireRunLock } from "../scripts/run-lock.js";

const dirOf = (): string => mkdtempSync(join(tmpdir(), "run-lock-"));
const DEAD = 999_999_001;

describe("acquireRunLock", () => {
  it("takes a free lock, records the pid, and release removes it (idempotent)", () => {
    const path = join(dirOf(), "run.lock");
    const release = acquireRunLock(path, { pid: 111 });
    expect(readFileSync(path, "utf8").trim()).toBe("111");
    release();
    release();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses while a live process holds it, and leaves the lock alone", () => {
    const path = join(dirOf(), "run.lock");
    writeFileSync(path, "222\n");
    expect(() => acquireRunLock(path, { pid: 111, alive: () => true })).toThrow(
      /held by running pid 222/,
    );
    expect(readFileSync(path, "utf8").trim()).toBe("222");
  });

  it("takes over a stale lock, leaving no .stale or .takeover file behind", () => {
    const dir = dirOf();
    const path = join(dir, "run.lock");
    writeFileSync(path, `${DEAD}\n`);
    const release = acquireRunLock(path, { pid: 111, alive: () => false });
    expect(readFileSync(path, "utf8").trim()).toBe("111");
    expect(readdirSync(dir)).toEqual(["run.lock"]);
    release();
  });

  it("takes over an unreadable lock", () => {
    const dir = dirOf();
    const path = join(dir, "run.lock");
    writeFileSync(path, "not-a-pid");
    acquireRunLock(path, { pid: 111, alive: () => true })();
    expect(existsSync(path)).toBe(false);
  });

  it("two acquirers racing for one stale lock: the second fails closed and the first keeps it", () => {
    const dir = dirOf();
    const path = join(dir, "run.lock");
    writeFileSync(path, `${DEAD}\n`);
    // B (pid 111) has read the stale owner but not yet taken over when A (pid 222) completes a
    // full takeover. B must not displace A's fresh lock.
    expect(() =>
      acquireRunLock(path, {
        pid: 111,
        alive: (pid) => pid !== DEAD,
        beforeTakeover: () => void acquireRunLock(path, { pid: 222, alive: (pid) => pid !== DEAD }),
      }),
    ).toThrow(/lost the race/);
    expect(readFileSync(path, "utf8").trim()).toBe("222");
    expect(readdirSync(dir)).toEqual(["run.lock"]);
  });

  it("an acquirer that finds the takeover guard held fails closed", () => {
    const dir = dirOf();
    const path = join(dir, "run.lock");
    writeFileSync(path, `${DEAD}\n`);
    let inner: unknown;
    acquireRunLock(path, {
      pid: 111,
      alive: (pid) => pid !== DEAD,
      afterGuard: () => {
        try {
          acquireRunLock(path, { pid: 222, alive: (pid) => pid !== DEAD });
        } catch (error) {
          inner = error;
        }
      },
    });
    expect(String(inner)).toMatch(/another process is taking over/);
    expect(readFileSync(path, "utf8").trim()).toBe("111");
  });

  it("does not displace a live lock that appeared after the stale owner was read", () => {
    const dir = dirOf();
    const path = join(dir, "run.lock");
    writeFileSync(path, `${DEAD}\n`);
    expect(() =>
      acquireRunLock(path, {
        pid: 111,
        alive: (pid) => pid !== DEAD,
        // a third process finishes a takeover between our read and our guard
        beforeTakeover: () => writeFileSync(path, "333\n"),
      }),
    ).toThrow(/lost the race/);
    expect(readFileSync(path, "utf8").trim()).toBe("333");
    expect(readdirSync(dir)).toEqual(["run.lock"]);
  });
});
