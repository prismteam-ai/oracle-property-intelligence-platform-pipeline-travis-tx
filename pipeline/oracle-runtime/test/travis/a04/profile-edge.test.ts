// A-04 T055 (A-04-TC-047, AC-14, FR-023): classification only through the frozen profile
// travis-austin@1.0.0, its SHA-256 stamped on every result; include + exclude → the profile
// decides; undecidable → needs_review; Expired never relabelled. Synthetic test input.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES_SHA256 } from "../../../../../profiles/travis-austin@1.0.0/index.js";
import {
  PROFILE_SHA256,
  STATUS_BASELINE_2026_10_19,
  classifyRun,
  statusVsBaseline,
  verifyProfile,
} from "../../../travis/permits/classify-run.js";

const SHA = "c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6";

describe("A-04-TC-047 the A-02 profile decides", () => {
  it('A-04-TC-047 "REROOF AND SOLAR" → not_roofing / solar_pv, decided by travis-austin@1.0.0 with its SHA-256', () => {
    const r = classifyRun({
      permit_number: "2026-000001 BP",
      permittype: "BP",
      work_class: "Remodel",
      description: "REROOF AND SOLAR",
      status_current: "Active",
    });
    expect(r.permit).toMatchObject({
      roofing: "not_roofing",
      reason: "solar_pv",
      profile: "travis-austin@1.0.0",
      profile_sha256: SHA,
    });
    expect(r.includeTerm).toBe(true); // a candidate by the include terms, excluded by the profile
    expect(r.profileSha256).toBe(SHA);
    expect(PROFILE_SHA256).toBe(RULES_SHA256);
  });

  it("A-04-TC-047 undecidable → needs_review (an unknown status word; Roof work class without an include term)", () => {
    const unknownStatus = classifyRun({ permit_number: "X-1", status_current: "Brand New Word" });
    expect(unknownStatus.statusClass).toBe("needs_review");
    expect(unknownStatus.statusRaw).toBe("Brand New Word");
    const noStatus = classifyRun({ permit_number: "X-2" });
    expect(noStatus.statusClass).toBe("needs_review");
    const roofClass = classifyRun({
      permit_number: "X-3",
      permittype: "BP",
      work_class: "Roof",
      description: "SYNTHETIC",
    });
    expect(roofClass.permit.roofing).toBe("needs_review");
  });

  it("A-04-TC-047 Expired is never relabelled: status_raw kept, class stalled; Suspended → open", () => {
    const e = classifyRun({ permit_number: "X-4", status_current: "Expired" });
    expect(e.statusRaw).toBe("Expired");
    expect(e.statusClass).toBe("stalled");
    expect(
      classifyRun({ permit_number: "1982-012866 BP", status_current: "Suspended" }).statusClass,
    ).toBe("open");
    expect(classifyRun({ permit_number: "X-5", status_current: "Final" }).statusClass).toBe(
      "closed",
    );
    expect(classifyRun({ permit_number: "X-6", status_current: "Withdrawn" }).statusClass).toBe(
      "exclude",
    );
  });

  it("A-04-TC-047 the profile digest is recomputed and equals the stamped SHA-256", () => {
    expect(verifyProfile()).toBe(SHA);
  });

  it("A-04-TC-045 status split vs the 2026-10-19 baseline (open 129, stalled 2,213, closed 17,251, exclude 2,491)", () => {
    expect(STATUS_BASELINE_2026_10_19).toEqual({
      open: 129,
      stalled: 2213,
      closed: 17251,
      exclude: 2491,
    });
    expect(
      statusVsBaseline({ open: 130, stalled: 2200, closed: 17300, exclude: 2490, needs_review: 4 }),
    ).toEqual({
      open: { run: 130, baseline: 129, delta: 1 },
      stalled: { run: 2200, baseline: 2213, delta: -13 },
      closed: { run: 17300, baseline: 17251, delta: 49 },
      exclude: { run: 2490, baseline: 2491, delta: -1 },
    });
  });

  it("A-04-TC-047 no classification term in the A-04 permit code (grep gate P0-9)", () => {
    const dir = fileURLToPath(new URL("../../../travis/permits/", import.meta.url));
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => join(dir, f)),
      fileURLToPath(new URL("../../../travis/adapters/socrata/socrata-pages.ts", import.meta.url)),
    ];
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/reroof|(^|[^A-Za-z0-9_])roof|shingle/i);
    }
  });
});
