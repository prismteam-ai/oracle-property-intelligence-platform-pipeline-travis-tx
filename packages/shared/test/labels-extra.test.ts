// T081 (A-03-TC-027, FR-002/005/009): the fixed UI texts of packages/shared equal plan.md
// § "Fixed texts and config keys" (= test plan § 3, G6 v1.1) verbatim, and the derivation map
// (AD-28) covers the contract's COVERAGE_DERIVATIONS and nothing else. Like
// missing-labels.test.ts, the whole file sits under one "A-03-TC-027" describe so
// `vitest run -t "A-03-TC-027"` (tests/e2e/build-checks.spec.ts) runs all of it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COVERAGE_DERIVATIONS } from "@countylens/contract";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PERMITS_TEXTS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  RUN_INDEX_TEXTS,
  type Derivation,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** plan.md § "Fixed texts and config keys", copied verbatim (the oracle for this test). */
const PLAN = {
  permitsPublished: "Permits published",
  derivations: {
    published_rows: "Counted from published rows",
    capture_receipt: "From the capture receipt",
    aggregate_match: "From the run's internal match (not recomputable from public data)",
  } satisfies Record<Derivation, string>,
  publicationState: "Public by CID · Atlas registration pending",
  runIndexUnreadable: "Run index could not be read from this site",
  runIndexEmpty: "No runs published yet",
  permitsEmpty: "No permits published in this run",
  countMismatch: (rows: number, count: number) =>
    `Row count does not match the manifest: ${rows} listed, ${count} published`,
  engineFailure: "Query engine could not start",
  rowsUnreadable: "Permit rows could not be read from this run",
  progressRuns: "Loading run",
  progressPermits: "Loading permits",
};

describe("A-03-TC-027: fixed UI texts of packages/shared (plan § Fixed texts and config keys)", () => {
  describe("COVERAGE_LABELS (Runs page counts)", () => {
    it('labels permits_emitted "Permits published" (TC-012)', () => {
      expect(COVERAGE_LABELS.permits_emitted).toBe(PLAN.permitsPublished);
    });

    it("keeps the W1 permits_no_tcad_geoid label (TC-031)", () => {
      expect(COVERAGE_LABELS.permits_no_tcad_geoid).toBe("TCAD id matches no property account");
    });

    it("names the County ownership and coordinates counts in plain words", () => {
      expect(COVERAGE_LABELS.owner_sales_published).toBe("Ownership sales published");
      expect(COVERAGE_LABELS.owner_persons_published).toBe("Owners published as persons");
      expect(COVERAGE_LABELS.owner_companies_published).toBe("Owners published as companies");
      expect(COVERAGE_LABELS.coordinates_published).toBe("Parcel coordinates published");
    });
  });

  describe("DERIVATION_LABELS (AD-28, Record<Derivation, string>)", () => {
    it("labels the three derivations with the plan strings, verbatim (TC-031)", () => {
      expect(DERIVATION_LABELS.published_rows).toBe(PLAN.derivations.published_rows);
      expect(DERIVATION_LABELS.capture_receipt).toBe(PLAN.derivations.capture_receipt);
      expect(DERIVATION_LABELS.aggregate_match).toBe(PLAN.derivations.aggregate_match);
    });

    it("covers the contract's COVERAGE_DERIVATIONS and nothing else", () => {
      expect([...Object.keys(DERIVATION_LABELS)].sort()).toEqual([...COVERAGE_DERIVATIONS].sort());
      for (const derivation of COVERAGE_DERIVATIONS) {
        expect(DERIVATION_LABELS[derivation]).not.toBe("");
      }
    });

    it("is exhaustive at compile time: a missing or an unknown key fails tsc", () => {
      // Both directives are verified by `pnpm typecheck` (root tsconfig includes test/**):
      // an unused @ts-expect-error is itself a type error, so each line below must fail.
      // @ts-expect-error a map without every derivation does not satisfy Record<Derivation, string>
      const missingKey = { published_rows: "a", capture_receipt: "b" } satisfies Record<
        Derivation,
        string
      >;
      const unknownKey = {
        published_rows: "a",
        capture_receipt: "b",
        aggregate_match: "c",
        // @ts-expect-error a derivation outside the contract list is an excess property
        guessed: "d",
      } satisfies Record<Derivation, string>;
      expect(Object.keys(missingKey)).toHaveLength(2);
      expect(Object.keys(unknownKey)).toHaveLength(4);
    });
  });

  describe("PUBLICATION_STATE_TEXT (P0-4, TC-010)", () => {
    it('is "Public by CID · Atlas registration pending"', () => {
      expect(PUBLICATION_STATE_TEXT).toBe(PLAN.publicationState);
    });

    it('never says "published to Atlas" (grep gate, T020/T021)', () => {
      expect(PUBLICATION_STATE_TEXT).not.toMatch(/published to Atlas/i);
      const source = readFileSync(resolve(HERE, "../src/labels.ts"), "utf8");
      expect(source).not.toMatch(/published to Atlas/i);
    });
  });

  describe("RUN_INDEX_TEXTS (TC-014)", () => {
    it("has the unreadable and empty texts, verbatim, and no other key", () => {
      expect(RUN_INDEX_TEXTS.unreadable).toBe(PLAN.runIndexUnreadable);
      expect(RUN_INDEX_TEXTS.empty).toBe(PLAN.runIndexEmpty);
      expect(Object.keys(RUN_INDEX_TEXTS).sort()).toEqual(["empty", "unreadable"]);
    });
  });

  describe("PERMITS_TEXTS (TC-029 and the engine failure banner)", () => {
    it("has the empty-state and engine-failure texts, verbatim", () => {
      expect(PERMITS_TEXTS.empty).toBe(PLAN.permitsEmpty);
      expect(PERMITS_TEXTS.engineFailure).toBe(PLAN.engineFailure);
    });

    it("has the rows-unreadable text (ERR-11), verbatim", () => {
      expect(PERMITS_TEXTS.rowsUnreadable).toBe(PLAN.rowsUnreadable);
    });

    it("countMismatch(rows, count) fills the plan template with the two numbers", () => {
      expect(PERMITS_TEXTS.countMismatch(37, 38)).toBe(PLAN.countMismatch(37, 38));
      expect(PERMITS_TEXTS.countMismatch(37, 38)).toBe(
        "Row count does not match the manifest: 37 listed, 38 published",
      );
      expect(PERMITS_TEXTS.countMismatch(0, 1)).toBe(
        "Row count does not match the manifest: 0 listed, 1 published",
      );
    });

    it("has exactly the state/error keys plus the A-11 pager keys", () => {
      expect(Object.keys(PERMITS_TEXTS).sort()).toEqual([
        "countMismatch",
        "empty",
        "engineFailure",
        "nextPage",
        "pagesLabel",
        "previousPage",
        "rowsUnreadable",
        "showing",
      ]);
    });
  });

  describe("PROGRESS_LABELS (accessible names of the progress bars, TC-024)", () => {
    it('is { runs: "Loading run", permits: "Loading permits" } and nothing else', () => {
      expect(PROGRESS_LABELS.runs).toBe(PLAN.progressRuns);
      expect(PROGRESS_LABELS.permits).toBe(PLAN.progressPermits);
      expect(Object.keys(PROGRESS_LABELS).sort()).toEqual(["permits", "runs"]);
    });
  });

  describe("the maps are frozen (no app can edit a fixed text at run time)", () => {
    it("Object.isFrozen on every exported map", () => {
      for (const map of [
        COVERAGE_LABELS,
        DERIVATION_LABELS,
        RUN_INDEX_TEXTS,
        PERMITS_TEXTS,
        PROGRESS_LABELS,
      ]) {
        expect(Object.isFrozen(map)).toBe(true);
      }
    });
  });
});
