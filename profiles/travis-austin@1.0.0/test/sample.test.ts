// T018: the AC-3 review sample (research R-10).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PROFILE, toSoqlSamplePopulation, type PermitRow } from "../index.js";
import { SEED, drawSample, rankKey, renderReview, sample } from "../scripts/sample.js";
import { SocrataClient } from "../scripts/socrata.js";
import { fakeSocrata } from "./fake-socrata.js";

const keys = Array.from({ length: 200 }, (_, i) => `2026-${String(100000 + i)} BP`);

describe("drawSample", () => {
  it("ranks by sha256(seed + newline + permit_number)", () => {
    expect(rankKey("s", "2026-1 BP")).toBe(
      createHash("sha256").update("s\n2026-1 BP").digest("hex"),
    );
  });

  it("is deterministic and independent of input order", () => {
    const a = drawSample(keys, SEED);
    const b = drawSample([...keys].reverse(), SEED);
    const shuffled = [...keys].sort((x, y) =>
      rankKey("other", x).localeCompare(rankKey("other", y)),
    );
    expect(b.sample).toEqual(a.sample);
    expect(drawSample(shuffled, SEED).sample).toEqual(a.sample);
    expect(drawSample(keys, "another seed").sample).not.toEqual(a.sample);
  });

  it("draws exactly 25 rows: the 25 smallest digests", () => {
    const d = drawSample(keys, SEED);
    expect(d.sample).toHaveLength(25);
    const expected = [...keys]
      .sort((x, y) => (rankKey(SEED, x) < rankKey(SEED, y) ? -1 : 1))
      .slice(0, 25);
    expect(d.sample).toEqual(expected);
  });

  it("records population count and the sha256 of the sorted key list", () => {
    const d = drawSample([...keys, "2026-100000 BP"], SEED);
    expect(d.population_count).toBe(200);
    const sorted = [...keys].sort();
    expect(d.keys_sha256).toBe(
      createHash("sha256")
        .update(sorted.join("\n") + "\n")
        .digest("hex"),
    );
  });

  it("uses the recorded seed", () => {
    expect(SEED).toBe("travis-austin@1.0.0/AC-3/2026-10-21");
  });
});

describe("sample (live flow on a fake endpoint)", () => {
  const rows: PermitRow[] = keys.map((permit_number, i) => ({
    permit_number,
    permittype: i % 7 === 0 ? "EP" : "BP",
    work_class: i % 5 === 0 ? "Auxiliary Power" : "Remodel",
    status_current: i % 3 === 0 ? "Expired" : "Final",
    description: i % 2 === 0 ? "Reroof | existing\nresidence" : "Roof repair only",
  }));
  const pop = toSoqlSamplePopulation();

  it("records seed, population count, captured_at, keys sha256 and the profile, and renders 25 rows", async () => {
    const f = fakeSocrata({ rows, predicates: { [pop]: () => true } });
    const c = new SocrataClient({
      get: f.get,
      sleep: async () => {},
      now: () => new Date("2026-10-21T11:00:00Z"),
    });
    const res = await sample(c, { seed: SEED, pageSize: 60 });
    if (res.outcome !== "ok") throw new Error(res.outcome);
    expect(res.meta.seed).toBe(SEED);
    expect(res.meta.population_count).toBe(200);
    expect(res.meta.captured_at).toBe("2026-10-21T11:00:00.000Z");
    expect(res.meta.keys_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.meta.profile).toEqual({
      name: PROFILE.name,
      version: PROFILE.version,
      sha256: PROFILE.sha256,
    });
    expect(res.rows).toHaveLength(25);
    const md = renderReview(res);
    expect(md).toMatch(/^---\nid: /);
    expect(md).toContain(`seed: "${SEED}"`);
    expect(md).toContain(`sha256: ${PROFILE.sha256}`);
    const tableRows = md.split("\n").filter((l) => /^\| \d+ \| \d{4}-\d+ [A-Z]+ \|/.test(l));
    expect(tableRows).toHaveLength(25);
    expect(md).toContain("Reroof \\| existing<br>residence");
  });

  it("a population that changes between count and fetch stops after one retry", async () => {
    const f = fakeSocrata({ rows, predicates: { [pop]: () => true }, countOverride: () => 201 });
    const c = new SocrataClient({ get: f.get, sleep: async () => {} });
    const res = await sample(c, { seed: SEED, pageSize: 60 });
    expect(res.outcome).toBe("stopped");
  });
});
