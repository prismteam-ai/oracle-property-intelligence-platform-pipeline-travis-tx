// Per-unit upload lock for two filebase workers (ERR-67 follow-up).
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tryUnitLock, unitSelected } from "../src/publish-run.js";

const lockIn = (): string =>
  join(mkdtempSync(join(tmpdir(), "unit-lock-")), "county-b01-car.json.lock");

describe("tryUnitLock", () => {
  it("takes a free lock, records the pid and releases it", () => {
    const path = lockIn();
    const release = tryUnitLock(path, 111, () => true);
    expect(release).toBeTypeOf("function");
    expect(readFileSync(path, "utf8")).toBe("111");
    release?.();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a lock held by another live worker", () => {
    const path = lockIn();
    writeFileSync(path, "222");
    expect(tryUnitLock(path, 111, () => true)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("222");
  });

  it("takes over a lock whose owner is gone", () => {
    const path = lockIn();
    writeFileSync(path, "333");
    const release = tryUnitLock(path, 111, () => false);
    expect(release).toBeTypeOf("function");
    expect(readFileSync(path, "utf8")).toBe("111");
  });

  it("takes over an unreadable lock", () => {
    const path = lockIn();
    writeFileSync(path, "not-a-pid");
    expect(tryUnitLock(path, 111, () => true)).toBeTypeOf("function");
  });

  it("A11-17 R5: a takeover leaves no temp, stale or guard file behind", () => {
    const path = lockIn();
    writeFileSync(path, "333");
    tryUnitLock(path, 111, () => false)?.();
    expect(readdirSync(dirname(path))).toEqual([]);
  });

  it("A11-17 R5: a rival that finishes its takeover first keeps the lock; the second worker backs off", () => {
    const path = lockIn();
    writeFileSync(path, "333");
    let rivalDone = false;
    // Asking whether the stale owner is alive is the moment between "read the owner" and "take
    // over": the rival (pid 222) completes a whole takeover right there.
    const alive = (pid: number): boolean => {
      if (pid === 333 && !rivalDone) {
        rivalDone = true;
        tryUnitLock(path, 222, (p) => p === 222);
      }
      return false;
    };
    expect(tryUnitLock(path, 111, alive)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("222");
    expect(readdirSync(dirname(path))).toEqual([basename(path)]);
  });

  it("A11-17 R5: a held takeover guard makes the second worker back off", () => {
    const path = lockIn();
    writeFileSync(path, "333");
    writeFileSync(`${path}.takeover`, "");
    expect(tryUnitLock(path, 111, () => false)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("333");
  });
});

describe("unitSelected", () => {
  it("uploads every kind when no limit is set", () => {
    expect(unitSelected("tables", undefined)).toBe(true);
    expect(unitSelected("tables", [])).toBe(true);
  });
  it("limits a worker to the listed kinds", () => {
    expect(unitSelected("car", ["car"])).toBe(true);
    expect(unitSelected("tables", ["car"])).toBe(false);
  });
});
