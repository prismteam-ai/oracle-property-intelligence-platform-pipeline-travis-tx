// T018a (A-14, agent-design.md § 5): executable spec for the citation registry's algorithm.
// `apps/api/src/agent/citations.ts` (owned by ash, built concurrently this wave in apps/api, not
// in this package) must match this behaviour. This file lives in packages/query-core because the
// real implementation does not exist yet (TDD red state is expected here before T019 lands in
// apps/api) and because query-core is the only package both builders already touch this wave.
//
// `referenceCitationRegistry()` below is a small, self-contained reference implementation of the
// algorithm described in agent-design.md § 5:
//   - every row any tool returns this turn is registered once, keyed by its `cid`
//   - the index `n` is stable and assigned in first-seen order (1-based, matching `[n]` in prose)
//   - registering the same `cid` again returns the same `n` (no duplicate rows, no renumbering)
//   - a post-check over a candidate `answer` string strips any `[n]` outside `1..matches.length`
//     and any unregistered CID-shaped token (`bafy…`/`bafk…`, 59 chars), counting each removal
// This is the spec ash's real citations.ts must satisfy, not a literal import of it.
import { describe, expect, it } from "vitest";

export interface CitationRow {
  cid: string;
  [key: string]: unknown;
}

export interface CitationMatch {
  n: number;
  cid: string;
  [key: string]: unknown;
}

export interface CitationRegistry {
  /** Registers a row by cid, first-seen order. Re-registering the same cid is a no-op that
   *  returns its existing index. */
  register(row: CitationRow): number;
  /** All registered rows as matches, in `n` order (1-based, matches[] index = n - 1). */
  matches(): CitationMatch[];
  /** Strips any `[n]` outside 1..matches.length and any unregistered CID-shaped token from
   *  `answer`. Returns the cleaned text plus a count of each kind removed. */
  postCheck(answer: string): {
    cleaned: string;
    outOfRangeCitations: number;
    ungroundedCids: number;
  };
}

const CID_SHAPED = /\b(bafy[0-9a-z]{55}|bafk[0-9a-z]{55})\b/gi;
const CITATION_TOKEN = /\[(\d+)\]/g;

/** Reference implementation of the citation-registry algorithm described in agent-design.md § 5.
 *  ash's apps/api/src/agent/citations.ts must behave the same way: same first-seen numbering,
 *  same idempotent re-registration, same post-check removals. */
export function referenceCitationRegistry(): CitationRegistry {
  const order: string[] = [];
  const rows = new Map<string, CitationRow>();

  return {
    register(row) {
      if (!rows.has(row.cid)) {
        rows.set(row.cid, row);
        order.push(row.cid);
      }
      return order.indexOf(row.cid) + 1;
    },

    matches() {
      return order.map((cid, i) => ({ n: i + 1, cid, ...rows.get(cid) }));
    },

    postCheck(answer) {
      const maxN = order.length;
      const registeredCids = new Set(order);
      let outOfRangeCitations = 0;
      let ungroundedCids = 0;

      let cleaned = answer.replace(CITATION_TOKEN, (full, nStr: string) => {
        const n = Number(nStr);
        if (n < 1 || n > maxN) {
          outOfRangeCitations += 1;
          return "";
        }
        return full;
      });

      cleaned = cleaned.replace(CID_SHAPED, (full) => {
        if (!registeredCids.has(full)) {
          ungroundedCids += 1;
          return "";
        }
        return full;
      });

      return { cleaned, outOfRangeCitations, ungroundedCids };
    },
  };
}

describe("referenceCitationRegistry (T018a executable spec for apps/api/src/agent/citations.ts)", () => {
  it("registers rows once by cid, in first-seen order, with a stable 1-based index", () => {
    const reg = referenceCitationRegistry();
    expect(reg.register({ cid: "bafy_A" })).toBe(1);
    expect(reg.register({ cid: "bafy_B" })).toBe(2);
    expect(reg.register({ cid: "bafy_C" })).toBe(3);

    const matches = reg.matches();
    expect(matches.map((m) => m.n)).toEqual([1, 2, 3]);
    expect(matches.map((m) => m.cid)).toEqual(["bafy_A", "bafy_B", "bafy_C"]);
  });

  it("re-registering the same cid is a no-op: same index, no duplicate row, no renumbering", () => {
    const reg = referenceCitationRegistry();
    expect(reg.register({ cid: "bafy_A" })).toBe(1);
    expect(reg.register({ cid: "bafy_B" })).toBe(2);
    // Re-seen row (e.g. returned again by a second tool call this turn) keeps index 1.
    expect(reg.register({ cid: "bafy_A", dist_mi: 2.1 })).toBe(1);
    expect(reg.register({ cid: "bafy_C" })).toBe(3);

    expect(reg.matches()).toHaveLength(3);
    expect(reg.matches()[0]?.n).toBe(1);
    expect(reg.matches()[0]?.cid).toBe("bafy_A");
  });

  it("matches() carries the row's own fields alongside n and cid", () => {
    const reg = referenceCitationRegistry();
    reg.register({ cid: "bafy_A", property_cid: "bafy_A", dist_mi: 1.2, roof_age_years: 20 });
    const [m] = reg.matches();
    expect(m).toMatchObject({
      n: 1,
      cid: "bafy_A",
      property_cid: "bafy_A",
      dist_mi: 1.2,
      roof_age_years: 20,
    });
  });

  it("post-check keeps in-range citations referencing registered rows untouched", () => {
    const reg = referenceCitationRegistry();
    reg.register({ cid: "bafy_A" });
    reg.register({ cid: "bafy_B" });

    const { cleaned, outOfRangeCitations, ungroundedCids } = reg.postCheck(
      "Two properties match: [1] is 2 mi away and [2] is 4 mi away.",
    );
    expect(cleaned).toBe("Two properties match: [1] is 2 mi away and [2] is 4 mi away.");
    expect(outOfRangeCitations).toBe(0);
    expect(ungroundedCids).toBe(0);
  });

  it("post-check strips any [n] outside 1..matches.length and counts it", () => {
    const reg = referenceCitationRegistry();
    reg.register({ cid: "bafy_A" });

    const { cleaned, outOfRangeCitations } = reg.postCheck("See [1] and also [7] and [0].");
    expect(cleaned).toBe("See [1] and also  and .");
    expect(outOfRangeCitations).toBe(2);
  });

  it("post-check strips any unregistered CID-shaped token and counts it", () => {
    const reg = referenceCitationRegistry();
    const registeredCid = `bafy${"a".repeat(55)}`;
    const unregisteredCid = `bafk${"b".repeat(55)}`;
    reg.register({ cid: registeredCid });

    const answer = `Row ${registeredCid} matches, but ${unregisteredCid} was never returned by a tool.`;
    const { cleaned, ungroundedCids } = reg.postCheck(answer);
    expect(cleaned).toContain(registeredCid);
    expect(cleaned).not.toContain(unregisteredCid);
    expect(ungroundedCids).toBe(1);
  });

  it("post-check handles an answer with no citations or CIDs at all (0 rows returned this turn)", () => {
    const reg = referenceCitationRegistry();
    const { cleaned, outOfRangeCitations, ungroundedCids } = reg.postCheck(
      "No properties matched the filter in this area.",
    );
    expect(cleaned).toBe("No properties matched the filter in this area.");
    expect(outOfRangeCitations).toBe(0);
    expect(ungroundedCids).toBe(0);
  });

  it("post-check on an empty registry strips every [n] and every CID-shaped token", () => {
    const reg = referenceCitationRegistry();
    const strayCid = `bafk${"c".repeat(55)}`;
    const { cleaned, outOfRangeCitations, ungroundedCids } = reg.postCheck(
      `See [1] (${strayCid}).`,
    );
    expect(cleaned).toBe("See  ().");
    expect(outOfRangeCitations).toBe(1);
    expect(ungroundedCids).toBe(1);
  });
});
