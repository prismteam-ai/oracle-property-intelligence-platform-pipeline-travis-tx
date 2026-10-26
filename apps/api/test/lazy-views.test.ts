import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { QueryEngine } from "@countylens/query-core";
import { lazyViewEngine } from "../src/engine/lazy-views.js";

function setup(bindImpl?: () => Promise<unknown>) {
  const log: string[] = [];
  const engine: QueryEngine = {
    all: vi.fn(async (sql: string) => {
      log.push(`all:${sql}`);
      return [];
    }),
    run: vi.fn(async (sql: string) => {
      log.push(`run:${sql}`);
    }),
  };
  const bind = vi.fn(async (_cid: string, _views: string[]) => {
    log.push("bind");
    return bindImpl?.();
  });
  return { engine, bind, log, lazy: lazyViewEngine(engine, "bafycid", bind) };
}

describe("lazyViewEngine", () => {
  it("binds only v_property for a v_property-only query, never all four", async () => {
    const { lazy, bind, log } = setup();
    await lazy.all("SELECT * FROM v_property LIMIT 1");
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith("bafycid", ["v_property"]);
    expect(log[0]).toBe("bind");
  });

  it("binds both views a join names", async () => {
    const { lazy, bind } = setup();
    await lazy.all("SELECT 1 FROM v_property p JOIN v_roofing_permit r ON r.folio = p.folio");
    expect(bind).toHaveBeenCalledWith("bafycid", ["v_property", "v_roofing_permit"]);
  });

  it("binds nothing when the SQL names no contract view", async () => {
    const { lazy, bind, engine } = setup();
    await lazy.all("SELECT 1");
    await lazy.run("SET threads = 2");
    expect(bind).not.toHaveBeenCalled();
    expect(engine.all).toHaveBeenCalledTimes(1);
    expect(engine.run).toHaveBeenCalledTimes(1);
  });

  it("run() binds before running", async () => {
    const { lazy, bind, log } = setup();
    await lazy.run("CREATE TEMP TABLE t AS SELECT * FROM v_run");
    expect(bind).toHaveBeenCalledWith("bafycid", ["v_run"]);
    expect(log[0]).toBe("bind");
  });

  it("propagates bind failures and does not run the statement", async () => {
    const { lazy, engine } = setup(async () => {
      throw new Error("bind failed");
    });
    await expect(lazy.all("SELECT * FROM v_contractor")).rejects.toThrow("bind failed");
    expect(engine.all).not.toHaveBeenCalled();
  });

  it("is safe under concurrent calls", async () => {
    const { lazy, bind, engine } = setup();
    await Promise.all([
      lazy.all("SELECT * FROM v_property"),
      lazy.all("SELECT * FROM v_roofing_permit"),
    ]);
    expect(bind).toHaveBeenCalledTimes(2);
    expect(engine.all).toHaveBeenCalledTimes(2);
  });
});

describe("agent and MCP wiring (ERR-19 follow-up)", () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("ask.ts and mcp/deps.ts never call bindOnce with the default all-views argument", () => {
    for (const file of ["../src/agent/ask.ts", "../src/mcp/deps.ts"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/bindOnce\(\s*[\w.]+\s*\)/);
      expect(src, file).toContain('["v_run"]');
      expect(src, file).toContain("lazyViewEngine(");
    }
  });
});
