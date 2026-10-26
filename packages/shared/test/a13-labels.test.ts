// T013 (A-13, FR-025, contracts/ui-routes.md): every fixed string of the contract's two tables
// lives in packages/shared/src/labels.ts, verbatim; page tests import these, never retype them.
// The oracle below is the contract text, copied once here. Template strings are functions; the
// test renders them with plain values. Also the A-13 routes and URL parameters (urls.ts).
// Written before the A-13 exports exist: the red run fails on the missing exports.
import { describe, expect, it } from "vitest";
import {
  COVERAGE_TEXTS,
  EXPLORE_TEXTS,
  EXPLORE_URL_PARAMS,
  PAGE_TEXTS,
  ROUTES,
  RUNS_TEXTS,
  VERIFY_TEXTS,
  verifyPath,
} from "../src/index.js";

describe("A-13 fixed strings equal contracts/ui-routes.md", () => {
  it("Runs, Compare and the run index", () => {
    expect(RUNS_TEXTS.nextSync).toBe("Next sync: none · scheduler off by default");
    expect(RUNS_TEXTS.oldManifestResolves).toBe(
      "old manifest still resolves on Pinata and orbitor",
    );
    expect(RUNS_TEXTS.firstRun).toBe("first run · nothing to compare against");
    expect(RUNS_TEXTS.indexUnavailable("HTTP 404")).toBe("Run index unavailable · HTTP 404");
    expect(RUNS_TEXTS.manifestUnavailable("bafkreiabc", "not JSON")).toBe(
      "Manifest unavailable · bafkreiabc · not JSON",
    );
  });

  it("Verify", () => {
    expect(VERIFY_TEXTS.rateLimited).toBe("rate-limited, retrying");
    expect(VERIFY_TEXTS.noReadableResponse).toBe(
      "no readable response (rate-limited or blocked), retrying",
    );
    expect(VERIFY_TEXTS.viaCar).toBe("Verify via CAR");
    expect(
      VERIFY_TEXTS.mismatch(
        { size: 10, sha256: "aaaa1111bbbb2222" },
        { size: 12, sha256: "cccc3333dddd4444" },
      ),
    ).toBe("Mismatch · size 10 vs 12 · SHA-256 aaaa…2222 vs cccc…4444");
  });

  it("Verify gateways (ARD § 16 AM-10): two independent lanes, Filebase a labelled fallback", () => {
    expect(VERIFY_TEXTS.gatewayOperators).toEqual({
      pinata: "Pinata",
      orbitor: "orbitor",
      filebase: "Filebase",
    });
    expect(VERIFY_TEXTS.laneRoles).toEqual({
      pinata: "Public gateway · also holds our second copy",
      orbitor: "Public gateway · holds no copy of ours",
      filebase: "Our main storage host · fallback, not counted",
    });
    expect(VERIFY_TEXTS.independentVerified).toBe(
      "Verified on Pinata and orbitor · two public gateways CountyLens does not operate; bytes match the manifest",
    );
    expect(VERIFY_TEXTS.independentNotVerified(VERIFY_TEXTS.noVerifiedAnswer("orbitor"))).toBe(
      "Not verified on two public gateways · no verified answer from orbitor",
    );
    expect(VERIFY_TEXTS.bytesDiffer("Pinata")).toBe("bytes differ on Pinata");
    expect(VERIFY_TEXTS.pinataGaveUp).toBe("Pinata may be rate-limiting; try again");
    expect(VERIFY_TEXTS.laneGaveUp).toBe("no readable answer after retries");
    expect(VERIFY_TEXTS.storedOn).toEqual([
      "Filebase: IPFS pin of every artifact (storage host)",
      "Pinata: second copy of every run manifest and of the latest run's table files that fit the free quota",
      "GitHub Release: CAR backup of the run, re-pinnable",
    ]);
    // Plain words on the page: no internal record ids (ARD, AM-nn).
    expect(VERIFY_TEXTS.storedOnProvenance).toBe(
      "Storage policy: a second copy on Pinata's free plan; CAR files on GitHub Releases",
    );
  });

  it("Explore", () => {
    expect(EXPLORE_TEXTS.header(12, 5, "Pflugerville", 15)).toBe(
      "12 within 5 mi of Pflugerville · roof ≥ 15 yrs",
    );
    expect(EXPLORE_TEXTS.stalledExpired(7)).toBe("Stalled 7 yrs · source says Expired");
    expect(EXPLORE_TEXTS.openSourceSays(6, "Active")).toBe("Open 6 yrs · source says Active");
    expect(EXPLORE_TEXTS.stalledNoCarrier(7)).toBe(
      "Stalled 7 yrs · open past expiry, never closed",
    );
    expect(EXPLORE_TEXTS.openNoCarrier(6)).toBe("Open 6 yrs · within its permit period");
    expect(EXPLORE_TEXTS.asPrinted).toBe("as printed on permit");
    expect(EXPLORE_TEXTS.noCarrier).toBe(
      "not in the published data model (status is derived from the permit dates)",
    );
    expect(EXPLORE_TEXTS.noOpenPermits).toBe(
      "no open roofing permits in this radius on the current run",
    );
    expect(EXPLORE_TEXTS.tenureUnknownCount(4)).toBe("tenure unknown: 4");
    expect(EXPLORE_TEXTS.engineBrowser).toBe("DuckDB-WASM in your browser · read-only");
    expect(EXPLORE_TEXTS.engineServer).toBe("DuckDB on the server · same views");
    expect(EXPLORE_TEXTS.zeroResults(5, 3)).toBe(
      "No properties within 5 mi · 3 close matches just outside",
    );
    expect(EXPLORE_TEXTS.milesOutside(0.4)).toBe("+0.4 mi");
    expect(EXPLORE_TEXTS.roofUnknown).toBe(
      "roof age unknown · no permit, new-construction or built-year record",
    );
    expect(EXPLORE_TEXTS.bbbNotChecked("contractor_unresolved")).toBe(
      "BBB not checked · contractor_unresolved",
    );
    expect(EXPLORE_TEXTS.bbbBlocked).toBe("BBB blocks automated lookups; not checked");
    expect(EXPLORE_TEXTS.addressNotInExport).toBe("Address not in the published export");
    expect(EXPLORE_TEXTS.contractorNotPrinted).toBe("No contractor printed on this permit");
    expect(EXPLORE_TEXTS.bbbNotFound).toBe("BBB: no profile found");
    expect(EXPLORE_TEXTS.tenureUnknown).toBe("tenure unknown · no dated sale on record");
    expect(EXPLORE_TEXTS.ownerAreaUnknown).toBe(
      "owner area unknown · mailing address not in the published export",
    );
  });

  it("Coverage, Catalog, Hub, Coming soon, county, Help · MCP", () => {
    expect(COVERAGE_TEXTS.denominatorMissing).toBe("denominator not in this run's manifest");
    expect(COVERAGE_TEXTS.denominatorMissingFor("tcad-2026-certified-json")).toBe(
      "denominator not in this run's manifest · source tcad-2026-certified-json",
    );
    expect(PAGE_TEXTS.comingSoonNotDeployed).toBe("Coming soon · Not deployed yet");
    expect(PAGE_TEXTS.comingSoon).toBe("Coming soon");
    expect(PAGE_TEXTS.travisOnly).toBe("CountyLens has data for Travis County, TX only");
    expect(PAGE_TEXTS.catalogUnavailable("HTTP 503")).toBe("Catalog unavailable · HTTP 503");
    expect(PAGE_TEXTS.tableExportMissing).toBe("table export not in this run's manifest");
    expect(PAGE_TEXTS.hubChip("Run 1", "2026-10-21T10:40:04.543Z")).toBe(
      "Run 1 · 2026-10-21 10:40 UTC",
    );
    // A-14 T034: the "not available" text is gone; Try a tool has real states (MCP_TRY_TEXTS).
    expect("mcpNotAvailable" in PAGE_TEXTS).toBe(false);
  });
});

describe("A-13 routes and URL parameters (contracts/ui-routes.md)", () => {
  it("names every route of the contract, /permits kept, plus the A-16 admin routes", () => {
    expect(Object.values(ROUTES).sort()).toEqual(
      [
        "/",
        "/runs",
        "/runs/compare",
        "/runs/log",
        "/tx/travis/coverage",
        "/tx/travis/explore",
        "/data/manifest",
        "/data/verify/:cid",
        "/data/catalog",
        "/help/mcp",
        "/legal/data",
        "/legal/privacy",
        "/legal/terms",
        "/soon/:item",
        "/permits",
        // A-16 (frozen interfaces): admin sign-in and Activity
        "/admin/sign-in",
        "/activity",
      ].sort(),
    );
    expect(verifyPath("bafkreiabc")).toBe("/data/verify/bafkreiabc");
  });

  it("lists the URL parameters (no z; view=list only)", () => {
    expect([...EXPLORE_URL_PARAMS].sort()).toEqual(
      [
        "at",
        "r",
        "roof",
        "permit",
        "openYrs",
        "tenure",
        "ooa",
        "sort",
        "sel",
        "mode",
        "place",
        "view",
        "page",
      ].sort(),
    );
    expect(EXPLORE_URL_PARAMS).not.toContain("z");
  });
});

describe("A-13 follow-up labels (shared by the app and the hosted tests)", () => {
  it("coverage kind absent and the fallback chip wording", () => {
    expect(COVERAGE_TEXTS.kindAbsent).toBe("not in this run's coverage section");
    expect(VERIFY_TEXTS.fallback("ipfs.filebase.io")).toBe("fallback · ipfs.filebase.io");
  });
});
