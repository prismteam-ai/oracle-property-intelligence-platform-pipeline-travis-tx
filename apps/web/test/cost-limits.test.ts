// A-16 T040 (AC-4, AC-5; TC-007 data side): scripts/build-cost-limits.mjs turns docs/cost.md and
// docs/source-limits.md into cost-limits.generated.json. The committed file must equal what the
// docs produce now (drift test), match the row schema, and the build must stop, naming the row,
// on a missing date, a blocked source without dates, a "not measured" source without a reason, or
// a not-available figure written as a zero.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCostLimits,
  clean,
  COST_DOC,
  LIMITS_DOC,
  OUTPUT_FILE,
  parseCost,
  parseLimits,
  tables,
} from "../../../scripts/build-cost-limits.mjs";
import { CostLimits } from "../src/content/cost-limits.schema";

const costMd = readFileSync(COST_DOC, "utf8");
const limitsMd = readFileSync(LIMITS_DOC, "utf8");

describe("cost-limits.generated.json", () => {
  it("equals what the two docs produce now (a doc edit without a rebuild fails here)", () => {
    const committed: unknown = JSON.parse(readFileSync(OUTPUT_FILE, "utf8"));
    expect(committed).toEqual(buildCostLimits(costMd, limitsMd));
  });

  it("matches the row schema", () => {
    const parsed = CostLimits.parse(JSON.parse(readFileSync(OUTPUT_FILE, "utf8")));
    expect(parsed.cost.rows.length).toBeGreaterThan(5);
    expect(parsed.limits.rows.length).toBeGreaterThan(5);
  });

  it("states the Filebase usage as not available with its reason, never a number", () => {
    const parsed = CostLimits.parse(JSON.parse(readFileSync(OUTPUT_FILE, "utf8")));
    const row = parsed.cost.rows.find((r) => r.component.startsWith("Filebase"));
    expect(row?.idle).toBeNull();
    expect(row?.missingReason?.length ?? 0).toBeGreaterThan(10);
  });

  it("marks a source that never became reachable as blocked, with dates and no throughput", () => {
    const parsed = CostLimits.parse(JSON.parse(readFileSync(OUTPUT_FILE, "utf8")));
    const bbb = parsed.limits.rows.find((r) => r.source.startsWith("BBB"));
    expect(bbb?.status).toBe("blocked");
    expect(bbb?.blockedDates.length).toBeGreaterThan(0);
    const tcad = parsed.limits.rows.find((r) => r.source.startsWith("TCAD supplemental"));
    expect(tcad?.status).toBe("blocked");
  });
});

describe("parsers stop the build on a doc that would let the page lie", () => {
  it("cost: no billing date", () => {
    expect(() =>
      parseCost(
        costMd.replace(/As of billing date \*\*\d{4}-\d{2}-\d{2}\*\*/, "As of billing date"),
      ),
    ).toThrow(/no date|As of billing date/);
  });

  it("cost: Filebase usage written as a bare zero", () => {
    const zero = costMd.replace(
      /Filebase usage:\s*\*\*not available[\s\S]*?\*\*/,
      "Filebase usage: **0**",
    );
    expect(() => parseCost(zero)).toThrow(/bare zero/);
  });

  it("cost: Filebase usage not available without a reason", () => {
    const bare = costMd.replace(
      /Filebase usage:\s*\*\*not available[\s\S]*?\*\*/,
      "Filebase usage: **not available · reason: **",
    );
    expect(() => parseCost(bare)).toThrow(/reason/);
  });

  it("limits: no Updated date", () => {
    expect(() => parseLimits(limitsMd.replace(/Updated \d{4}-\d{2}-\d{2}/, "Updated"))).toThrow(
      /no date/,
    );
  });

  it("limits: a blocked source with no date", () => {
    const undated = limitsMd.replace(
      /\*\*Blocked\*\*: HTTP 403 Cloudflare challenge[^|]*\|/,
      "**Blocked**: HTTP 403 |",
    );
    expect(undated).not.toBe(limitsMd);
    expect(() => parseLimits(undated)).toThrow(/blocked but no date/);
  });

  it("limits: a 'not measured' source with no reason", () => {
    const rows = limitsMd
      .split("\n")
      .map((line) =>
        line.startsWith("| **Overture places**")
          ? line.replace(/Not measured \(reason: [^)]*\)/g, "Not measured")
          : line,
      )
      .join("\n");
    expect(() => parseLimits(rows)).toThrow(/without a reason/);
  });
});

describe("table helpers", () => {
  it("clean() strips markdown markers and links", () => {
    expect(clean("**a** `b` [c](http://x)")).toBe("a b c");
  });

  it("tables() reads header and rows", () => {
    const [t] = tables("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(t?.header).toEqual(["a", "b"]);
    expect(t?.rows).toEqual([["1", "2"]]);
  });
});
