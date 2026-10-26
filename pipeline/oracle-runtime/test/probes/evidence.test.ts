// Supporting tests for T024 evidence probes. Synthetic responses only (test-only); BBB,
// Overture, TDLR and the Texas Legislature site are never called.
import { describe, expect, it } from "vitest";
import { USER_AGENT, createSourceClient, type FetchLike } from "../../travis/lib/source-client.js";
import {
  BBB_URL,
  HB3344_URL,
  NO_STATEWIDE_ROOFING_LICENCE,
  OVERTURE_LICENCE_URL,
  OVERTURE_MISSING_REASON,
  TDLR_URL,
  listTcadSupplemental,
  probeBbb,
  probeContractorLicensing,
  probeOverture,
  type PriorObservation,
} from "../../travis/discovery/probes/evidence.js";
import { fakeHttp, json, silent, text } from "../fixtures/fake-http.js";
import { must } from "../helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");

function client(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
}

describe("constants", () => {
  it("fixes the Overture reason and the licensing wording", () => {
    expect(OVERTURE_MISSING_REASON).toBe(
      "not measured in A-01: optional source; licence gate decided in A-09",
    );
    expect(NO_STATEWIDE_ROOFING_LICENCE).toBe("no statewide roofing licence");
    for (const u of [BBB_URL, OVERTURE_LICENCE_URL, TDLR_URL, HB3344_URL]) {
      expect(new URL(u).protocol).toBe("https:");
    }
  });
});

describe("probeBbb (never solves a challenge)", () => {
  it("a challenge page is recorded as blocked after exactly one request", async () => {
    const { fetch, calls } = fakeHttp([
      {
        match: () => true,
        respond: () =>
          text('<html><title>Just a moment...</title><div id="cf-chl-widget"></div></html>', 403, {
            "content-type": "text/html",
            "cf-mitigated": "challenge",
          }),
      },
    ]);
    const r = await probeBbb({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("blocked");
    expect(r.reused).toBe(false);
    expect(must(r.blocked_receipt).attempts).toBe(1);
  });

  it("a 200 challenge page (no 403) is still blocked, not 'available'", async () => {
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text("<html>Attention Required! | Cloudflare</html>") },
    ]);
    const r = await probeBbb({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("blocked");
    expect(must(r.blocked_receipt).blocked_reason).toBe("challenge");
  });

  it("a 429 is not retried: at most one observation", async () => {
    const { fetch, calls } = fakeHttp([{ match: () => true, respond: () => json({}, 429) }]);
    const r = await probeBbb({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("blocked");
  });

  it("reusing the recorded observation makes no request at all", async () => {
    const { fetch, calls } = fakeHttp([]);
    const prior: PriorObservation = {
      http_status: 403,
      captured_at: "2026-01-01T00:00:00Z",
      url: BBB_URL,
      evidence_path: "docs/evidence/blocked/bbb-synthetic.md",
      body_sha256: "a".repeat(64),
      attempts: 1,
      user_agent: USER_AGENT,
      outcome: "blocked",
      geo_signal: "none",
    };
    const r = await probeBbb({ client: client(fetch), now: () => FIXED }, prior);
    expect(calls).toHaveLength(0);
    expect(r.status).toBe("blocked");
    expect(r.reused).toBe(true);
    expect(must(r.blocked_receipt)).toMatchObject({ status: 403, sha256: "a".repeat(64) });
  });
});

describe("probeOverture", () => {
  it("captures the licence page once; the denominator stays null with the fixed reason", async () => {
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text("<html>Overture licence: CDLA / ODbL</html>") },
    ]);
    const r = await probeOverture({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("available");
    expect(r.denominator).toEqual({
      value: null,
      missing_reason: OVERTURE_MISSING_REASON,
      source_url: OVERTURE_LICENCE_URL,
      captured_at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("probeContractorLicensing", () => {
  it("captures TDLR and HB 3344 status pages and records 'no statewide roofing licence'", async () => {
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text("<html>synthetic page</html>") },
    ]);
    const r = await probeContractorLicensing({ client: client(fetch), now: () => FIXED });
    expect(calls.map((c) => c.url).sort()).toEqual([HB3344_URL, TDLR_URL].sort());
    expect(r.decision_reason).toContain(NO_STATEWIDE_ROOFING_LICENCE);
    expect(r.pages.map((p) => p.url).sort()).toEqual([HB3344_URL, TDLR_URL].sort());
    expect(r.denominator.value).toBeNull();
    expect(r.denominator.missing_reason).toContain(NO_STATEWIDE_ROOFING_LICENCE);
  });
});

describe("listTcadSupplemental", () => {
  it("lists supplemental exports without downloading them", () => {
    const listing = listTcadSupplemental({
      certified_special_export: null,
      export_layouts: null,
      supplemental: [
        { label: "2026 Supplemental 01", url: "https://traviscad.test/s1.zip" },
        { label: "2026 Supplemental 02", url: "https://traviscad.test/s2.zip" },
      ],
      certification_date: null,
    });
    expect(listing.count).toBe(2);
    expect(listing.urls).toEqual([
      "https://traviscad.test/s1.zip",
      "https://traviscad.test/s2.zip",
    ]);
  });

  it("no links (landing page blocked) lists nothing", () => {
    expect(listTcadSupplemental(null)).toEqual({ count: 0, urls: [] });
  });
});
