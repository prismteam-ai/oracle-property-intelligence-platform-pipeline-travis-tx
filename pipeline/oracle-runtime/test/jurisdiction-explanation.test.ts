// PO decision 2026-10-20: every non-supported permit row explains why it has no captured
// history, what was tried and what would unblock it, and says the request is not filed.
// Synthetic rows only (example.test); no request is made.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BBB_NEXT_STEP } from "../travis/discovery/assemble.js";
import type { Catalog, Jurisdiction } from "../travis/discovery/catalog.schema.js";
import { applyPoDecision, explainBlocked } from "../travis/discovery/explain-blocked.js";
import {
  BLOCKED_NOTE,
  explainJurisdiction,
  LEGACY_BLOCKED_NOTE,
  migrateBlockedNote,
  NOT_FILED,
} from "../travis/discovery/jurisdiction-explanation.js";
import { TCAD_NEXT_STEP } from "../travis/discovery/workflow.js";
import { readCatalog, writeCatalog } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const BASE = "https://example.test";
const AT = "2026-01-01T00:00:00Z";
const RR = {
  recipient_office: "Synthetic City Secretary",
  system_scope: "synthetic permits",
  route: "records-first" as const,
  request_portal_url: `${BASE}/records`,
};

function base(over: Partial<Jurisdiction>): Jurisdiction {
  return {
    jurisdiction: "Synthetic Town",
    key: "synthetic_town",
    spec_class: "records request",
    status: "manual-only",
    historical_records: false,
    evidence_url: `${BASE}/permits`,
    evidence_captured_at: AT,
    evidence_http_status: 200,
    records_request: RR,
    ...over,
  };
}

function blocked403(): Jurisdiction {
  return base({
    status: "blocked",
    evidence_http_status: 403,
    blocked_evidence: {
      http_status: 403,
      captured_at: AT,
      url: `${BASE}/permits`,
      evidence_path: "docs/evidence/blocked/jurisdiction-synthetic_town-20260101T000000Z.md",
      body_sha256: "0".repeat(64),
      attempts: 1,
      user_agent: "synthetic-agent",
      outcome: "blocked",
      geo_signal: "none",
    },
  });
}

describe("explainJurisdiction", () => {
  it("a 403 challenge row: why, what was tried, what would unblock it, not filed", () => {
    const text = must(
      explainJurisdiction(blocked403(), {
        challengeSignal: 'title: "Attention Required! | Cloudflare"',
      }),
    );
    expect(text).toBe(
      "No permit history was captured: the official site refused automated access with HTTP 403 (a Cloudflare challenge) on 2026-01-01, and it is not requested again (no retry, no identity change, no challenge solved). " +
        "Tried: one identified request to https://example.test/permits on 2026-01-01 (HTTP 403); evidence docs/evidence/blocked/jurisdiction-synthetic_town-20260101T000000Z.md. " +
        "To unblock: a records request to Synthetic City Secretary via https://example.test/records; not filed (PO decision 2026-10-20).",
    );
    expect(text).not.toContain('"'); // the catalog writer refuses double quotes
  });

  it("names an Access Denied page; a plain 406 is never called a content-negotiation refusal", () => {
    expect(
      explainJurisdiction(blocked403(), { challengeSignal: 'title: "Access Denied"' }),
    ).toMatch(/HTTP 403 \(an Access Denied page\)/);
    const r = blocked403();
    const be = must(r.blocked_evidence);
    const failed406 = {
      ...r,
      blocked_evidence: { ...be, http_status: 406, outcome: "failed" as const },
    };
    const text = must(explainJurisdiction(failed406));
    expect(text).toMatch(/could not be read on 2026-01-01 \(HTTP 406\)/);
    expect(text).not.toMatch(/content-negotiation|not a block/);
  });

  it("OR-M2: a 406 whose body names Mod Security reads as a firewall block", () => {
    const r = blocked403();
    const be = must(r.blocked_evidence);
    const text = must(
      explainJurisdiction(
        { ...r, blocked_evidence: { ...be, http_status: 406, outcome: "failed" as const } },
        { firewall: "the site's web application firewall (Mod Security)" },
      ),
    );
    expect(text).toMatch(
      /^No permit history was captured: blocked by the site's web application firewall \(Mod Security\), HTTP 406, on 2026-01-01, and it is not requested again/,
    );
    expect(text).not.toContain('"');
  });

  it("OR-m5: a row resting only on the Census listing says the site did not answer", () => {
    const text = must(
      explainJurisdiction(
        base({
          status: "custodian-only",
          evidence_url:
            "https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st48_tx_place_by_county2020.txt",
          records_request: {
            recipient_office: "Village of Synthetic, Village Hall",
            system_scope: "synthetic",
            route: "records-first",
            request_portal_url: `${BASE}/village`,
            channel_verified: false,
          },
        }),
      ),
    );
    expect(text).toMatch(
      /^No permit history can be captured: the village site did not answer; permit system unknown\./,
    );
    expect(text).toMatch(
      /the only evidence is the Census place listing https:\/\/www2\.census\.gov\//,
    );
    expect(text).not.toMatch(/official page/);
    expect(text).toMatch(/\(channel unverified: it did not answer\); not filed/);
  });

  it("OR-m6: splits Austin-issued permits located here into full purpose and ETJ", () => {
    const m = (value: number) => ({ value, source_url: `${BASE}/g`, captured_at: AT, method: "x" });
    const row = base({
      jurisdiction: "Lakeside",
      austin_issued_located_here: m(42),
      austin_issued_full_purpose: m(40),
      austin_issued_etj: m(2),
    });
    expect(explainJurisdiction(row)).toContain(
      "Lakeside's own permits are not captured, but Austin-issued permits located here are captured through Austin dataset 3syk-w9eu: 40 permits inside the city limits (full purpose), 2 permits in its ETJ (outside the city limits).",
    );
  });

  it("a login-only intake portal and a paper process", () => {
    expect(explainJurisdiction(base({ vendor: "Synthetic MGO" }))).toMatch(
      /^No permit history can be captured: permits are filed in an account-based application portal that shows no public permit history \(portal: Synthetic MGO\)\. Tried: one identified request to the official page https:\/\/example\.test\/permits on 2026-01-01 answered HTTP 200\. To unblock: .*not filed \(PO decision 2026-10-20\)\.$/,
    );
    expect(explainJurisdiction(base({ status: "custodian-only" }))).toMatch(
      /^No permit history can be captured: permit files are kept on paper or in the office/,
    );
  });

  it("states Austin-issued permits located here in the same sentence", () => {
    const row = base({
      jurisdiction: "Lakeside",
      austin_issued_located_here: {
        value: 42,
        source_url: `${BASE}/g`,
        captured_at: AT,
        method: "x",
      },
    });
    expect(explainJurisdiction(row)).toMatch(
      /public permit history; Lakeside's own permits are not captured, but 42 Austin-issued permits located here are captured through Austin dataset 3syk-w9eu\. Tried:/,
    );
  });

  it("uses the singular for one permit and a plain apostrophe for names ending in s", () => {
    const one = base({
      jurisdiction: "The Hills",
      austin_issued_located_here: {
        value: 1,
        source_url: `${BASE}/g`,
        captured_at: AT,
        method: "x",
      },
    });
    expect(explainJurisdiction(one)).toContain(
      "The Hills' own permits are not captured, but 1 Austin-issued permit located here is captured through Austin dataset 3syk-w9eu",
    );
  });

  it("states a 406 in the reason and the short status in what was tried", () => {
    const r = blocked403();
    const be = must(r.blocked_evidence);
    const text = must(
      explainJurisdiction({
        ...r,
        blocked_evidence: { ...be, http_status: 406, outcome: "failed" },
      }),
    );
    expect(text.match(/HTTP 406/g)).toHaveLength(2);
    expect(text).toMatch(/on 2026-01-01 \(HTTP 406\); evidence/);
  });

  it("a supported row has no explanation, and wording never reads 'to be filed'", () => {
    expect(explainJurisdiction(base({ spec_class: "supported", status: "supported" }))).toBeNull();
    expect(NOT_FILED).toBe("not filed (PO decision 2026-10-20)");
    for (const t of [BBB_NEXT_STEP, TCAD_NEXT_STEP, BLOCKED_NOTE]) {
      expect(t).toContain(NOT_FILED);
      expect(t).not.toMatch(/to be filed|^File |^Apply /);
    }
  });

  it("migrates the pre-decision blocked note wording once", () => {
    const old = `evidence page blocked (x); ${LEGACY_BLOCKED_NOTE}. Profile: y`;
    const once = must(migrateBlockedNote(old));
    expect(once).toBe(`evidence page blocked (x); ${BLOCKED_NOTE}. Profile: y`);
    expect(migrateBlockedNote(once)).toBe(once);
    expect(migrateBlockedNote(undefined)).toBeUndefined();
    const draft =
      "x; classified records request (the records request is not filed (PO decision 2026-10-20)). y";
    expect(migrateBlockedNote(draft)).toBe(`x; ${BLOCKED_NOTE}. y`);
  });
});

describe("applyPoDecision / explain-blocked (offline)", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function catalogWithRows(): Catalog {
    const cat = syntheticCatalog();
    const p = must(cat.permits);
    p.jurisdictions.push({ ...blocked403(), notes: `blocked; ${LEGACY_BLOCKED_NOTE}` });
    const bbbIndex = cat.sources.findIndex((s) => s.key === "bbb");
    if (bbbIndex < 0) {
      cat.sources.push({
        key: "bbb",
        url: `${BASE}/bbb`,
        status: "blocked",
        denominator: {
          value: null,
          missing_reason: "synthetic",
          source_url: `${BASE}/bbb`,
          captured_at: AT,
        },
        decision: "runtime retrieval",
        decision_reason: "synthetic old reason",
        captured_at: AT,
        next_step: "Apply for the synthetic API",
        blocked_evidence: {
          http_status: 403,
          captured_at: AT,
          url: `${BASE}/bbb`,
          evidence_path: "docs/evidence/blocked/bbb-20260101T000000Z.md",
          body_sha256: "0".repeat(64),
          attempts: 1,
          user_agent: "synthetic-agent",
          outcome: "blocked",
          geo_signal: "none",
        },
      });
    }
    return cat;
  }

  it("explains every non-supported row, keeps classes, rewrites BBB texts, and is idempotent", () => {
    const cat = catalogWithRows();
    const next = applyPoDecision(cat, () => 'title: "Attention Required! | Cloudflare"');
    const rows = must(next.permits).jurisdictions;
    for (const [i, r] of rows.entries()) {
      const was = must(must(cat.permits).jurisdictions[i]);
      expect(r.spec_class).toBe(was.spec_class);
      expect(r.status).toBe(was.status);
      expect(r.historical_records).toBe(was.historical_records);
      if (r.status === "supported") expect(r.blocked_explanation).toBeUndefined();
      else expect(r.blocked_explanation).toContain(NOT_FILED);
    }
    const town = must(rows.find((r) => r.key === "synthetic_town"));
    expect(town.blocked_explanation).toMatch(/a Cloudflare challenge/);
    expect(town.notes).toBe(`blocked; ${BLOCKED_NOTE}`);
    const bbb = must(next.sources.find((s) => s.key === "bbb"));
    expect(bbb.next_step).toBe(BBB_NEXT_STEP);
    expect(bbb.decision_reason).toContain(NOT_FILED);
    expect(must(next.enrichment).bbb.next_step).toBe(BBB_NEXT_STEP);
    expect(applyPoDecision(next, () => 'title: "Attention Required! | Cloudflare"')).toEqual(next);
  });

  it("the command reads the challenge marker from the evidence file and makes no request", async () => {
    const root = mkdtempSync(join(tmpdir(), "explain-blocked-"));
    tmpDirs.push(root);
    const catalogPath = join(root, "pipeline/docs/travis-sources.yaml");
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeCatalog(catalogWithRows(), catalogPath);
    const ev = join(root, "docs/evidence/blocked/jurisdiction-synthetic_town-20260101T000000Z.md");
    mkdirSync(dirname(ev), { recursive: true });
    writeFileSync(ev, "---\nchallenge_signal: 'title: \"Access Denied\"'\n---\n\n# synthetic\n");
    const lines: string[] = [];
    const code = await explainBlocked({
      repoRoot: root,
      catalogPath,
      validate: async () => 1,
      out: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    const town = must(
      must(readCatalog(catalogPath).permits).jurisdictions.find((r) => r.key === "synthetic_town"),
    );
    expect(town.blocked_explanation).toMatch(/HTTP 403 \(an Access Denied page\)/);
    expect(lines.join("\n")).toMatch(/no request made/);
    const strip = (c: Catalog) => {
      const { amendments: _a, ...rest } = c;
      return rest;
    };
    const once = readCatalog(catalogPath);
    expect(must(once.amendments?.at(-1)).command).toBe("explain-blocked");
    await explainBlocked({ repoRoot: root, catalogPath, validate: async () => 1, out: () => {} });
    expect(strip(readCatalog(catalogPath))).toEqual(strip(once));
  });
});
