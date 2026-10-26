// Re-probe of failed permit-jurisdiction evidence pages. Every catalog row, profile entry,
// page and receipt here is synthetic (test-only): an injected fetch serves invented pages on
// example.test, no real source is called, DNS is an injected stand-in and the validator is
// an injected stand-in. A temporary repository root holds the catalog and evidence files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog, Jurisdiction } from "../travis/discovery/catalog.schema.js";
import { reprobeJurisdictions, reprobeRefusal } from "../travis/discovery/reprobe-jurisdictions.js";
import { readCatalog, writeCatalog } from "../travis/discovery/write-catalog.js";
import type { JurisdictionProfileEntry } from "../travis/profiles/jurisdictions.js";
import { createSourceClient, USER_AGENT } from "../travis/lib/source-client.js";
import { fakeHttp, silent, text, type Route } from "./fixtures/fake-http.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const CATALOG_REL = "pipeline/docs/travis-sources.yaml";
const EVIDENCE_DIR = "docs/evidence/blocked";
const OLD_AT = "2026-01-01T00:00:00Z";
const FIXED = new Date("2026-02-03T04:05:06.000Z");
const BASE = "https://example.test";
const SHA0 = "0".repeat(64);

const RR = {
  recipient_office: "Synthetic records office",
  system_scope: "synthetic permit system",
  route: "records-first" as const,
  request_portal_url: `${BASE}/records`,
};

const PROFILE: JurisdictionProfileEntry[] = [
  {
    key: "open_city",
    jurisdiction: "Open City",
    census_placefp: "00001",
    spec_class: "supported",
    case: "history-online",
    portal_kind: "open-data-api",
    portal: `${BASE}/open/resource.json`,
    vendor: "synthetic open data",
    evidence_url: `${BASE}/open/page`,
    earliest_record_date: "1990-01-01",
    records_request: RR,
    notes: "synthetic: open data profile note",
  },
  {
    key: "moved_city",
    jurisdiction: "Synthetic",
    census_placefp: "00002",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: "application-intake",
    vendor: "synthetic intake portal",
    evidence_url: `${BASE}/moved/new-page`,
    records_request: RR,
    notes: "synthetic: intake profile note",
  },
  {
    key: "walled_city",
    jurisdiction: "Walled City",
    census_placefp: "00003",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: "application-intake",
    evidence_url: `${BASE}/walled/page`,
    records_request: RR,
  },
];

function failedRow(
  key: string,
  name: string,
  url: string,
  stop: { http_status?: number; error?: string; outcome?: "failed" | "blocked" },
): Jurisdiction {
  return {
    jurisdiction: name,
    key,
    census_placefp: "00009",
    spec_class: "records request",
    status: "blocked",
    historical_records: false,
    evidence_url: url,
    evidence_captured_at: OLD_AT,
    records_request: RR,
    notes: "evidence page blocked at the live run (synthetic)",
    blocked_evidence: {
      ...(stop.http_status === undefined ? {} : { http_status: stop.http_status }),
      ...(stop.error === undefined ? {} : { error: stop.error }),
      captured_at: OLD_AT,
      url,
      evidence_path: `${EVIDENCE_DIR}/jurisdiction-${key}-20260101T000000Z.md`,
      body_sha256: SHA0,
      attempts: 1,
      user_agent: USER_AGENT,
      outcome: stop.outcome ?? "failed",
      geo_signal: "none",
    },
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  catalogPath: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "reprobe-jurisdictions-"));
  tmpDirs.push(root);
  const cat: Catalog = syntheticCatalog();
  const permits = must(cat.permits, "permits");
  permits.jurisdictions = [
    ...permits.jurisdictions,
    failedRow("open_city", "Open City", `${BASE}/open/page`, { error: "fetch failed" }),
    failedRow("moved_city", "Synthetic", `${BASE}/moved/old-page`, { http_status: 404 }),
    failedRow("walled_city", "Walled City", `${BASE}/walled/page`, {
      http_status: 403,
      outcome: "blocked",
    }),
  ];
  const catalogPath = join(root, CATALOG_REL);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeCatalog(cat, catalogPath);
  mkdirSync(join(root, EVIDENCE_DIR), { recursive: true });
  for (const row of permits.jurisdictions) {
    const path = row.blocked_evidence?.evidence_path;
    if (!path) continue;
    const blocked = row.blocked_evidence?.outcome === "blocked";
    writeFileSync(
      join(root, path),
      `---\nid: EV-synthetic\noutcome: ${blocked ? "blocked" : "failed"}\n${
        blocked ? "blocked_reason: challenge\nchallenge_signal: 'title: \"Cloudflare\"'\n" : ""
      }---\n\n# synthetic\n`,
    );
  }
  return { root, catalogPath };
}

function run(
  f: Fixture,
  keys: string[],
  routes: Record<string, () => Response | Promise<Response>>,
  extra: { dnsFails?: boolean; egressRefusal?: string } = {},
) {
  let egressChecks = 0;
  const http = fakeHttp(
    Object.entries(routes).map(([url, respond]): Route => ({
      match: (u) => u.href === url,
      respond: () => respond(),
    })),
  );
  const client = createSourceClient({
    fetch: http.fetch,
    sleep: async () => {},
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
  const lines: string[] = [];
  let validatorCalls = 0;
  const resolved: string[] = [];
  const done = reprobeJurisdictions(keys, {
    repoRoot: f.root,
    catalogPath: f.catalogPath,
    client,
    profile: PROFILE,
    resolveHost: async (host) => {
      resolved.push(host);
      if (extra.dnsFails) throw new Error("getaddrinfo ENOTFOUND");
    },
    now: () => FIXED,
    egress: async () => {
      egressChecks += 1;
      return extra.egressRefusal
        ? { ok: false as const, reason: extra.egressRefusal }
        : {
            ok: true as const,
            egress: { country: "EG", captured_at: FIXED.toISOString(), method: "trace" },
          };
    },
    validate: async () => {
      validatorCalls += 1;
      return 1;
    },
    out: (l) => lines.push(l),
  });
  return {
    done,
    http,
    lines,
    validatorCalls: () => validatorCalls,
    resolved,
    egressChecks: () => egressChecks,
  };
}

const row = (cat: Catalog, key: string): Jurisdiction =>
  must(
    must(cat.permits).jurisdictions.find((r) => r.key === key),
    key,
  );

/** The catalog text of one row (from its "- jurisdiction:" line to the next row). */
/** The catalog text without the appended amendments[] (OR-M5), which every command extends. */
function body(yaml: string): string {
  const end = yaml.indexOf("\namendments:");
  return end < 0 ? yaml : yaml.slice(0, end + 1);
}

function rowText(yaml: string, key: string): string {
  const parts = body(yaml).split(/\n(?= {4}- jurisdiction: )/);
  return must(
    parts.find((p) => p.includes(`key: "${key}"`)),
    key,
  );
}

function evidenceFiles(f: Fixture): string[] {
  return readdirSync(join(f.root, EVIDENCE_DIR)).sort();
}

describe("reprobe-jurisdictions: refusals before any request", () => {
  it("refuses the whole command when one named row was a 403 / challenge; nothing sent or written", async () => {
    const f = fixture();
    const before = readFileSync(f.catalogPath, "utf8");
    const files = evidenceFiles(f);
    const r = run(f, ["open_city", "walled_city"], {});
    expect(await r.done).toBe(2);
    expect(r.http.calls).toHaveLength(0);
    expect(r.resolved).toHaveLength(0);
    expect(r.validatorCalls()).toBe(0);
    expect(r.lines.join("\n")).toMatch(/walled_city .*never requested again/);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(evidenceFiles(f)).toEqual(files);
  });

  it("refuses a challenge recorded only in the evidence file", () => {
    const r = failedRow("x", "X", `${BASE}/x`, { http_status: 404 });
    expect(reprobeRefusal(r, { blocked_reason: "challenge" }, 1)).toMatch(/challenge/);
    expect(reprobeRefusal(r, { outcome: "blocked" }, 1)).toMatch(/blocked/);
    expect(reprobeRefusal(r, null, 1)).toBeNull();
  });

  it.each([["a timeout", { ...failedRow("x", "X", `${BASE}/x`, {}), status: "blocked" as const }]])(
    "refuses %s",
    (_label, r) => {
      const be = must(r.blocked_evidence);
      const timed: Jurisdiction = { ...r, blocked_evidence: { ...be, timeout_ms: 60000 } };
      expect(reprobeRefusal(timed, null, 1)).toMatch(/timed out/);
    },
  );

  it("refuses a status other than network error, 404, 406 or 5xx, a non-blocked row and a second re-probe", () => {
    expect(reprobeRefusal(failedRow("x", "X", `${BASE}/x`, { http_status: 429 }), null, 1)).toMatch(
      /only a network error, 404, 406 or 5xx/,
    );
    expect(reprobeRefusal(failedRow("x", "X", `${BASE}/x`, { http_status: 503 }), null, 1)).toBe(
      null,
    );
    expect(reprobeRefusal(failedRow("x", "X", `${BASE}/x`, { http_status: 406 }), null, 1)).toBe(
      null,
    );
    const supported = row(syntheticCatalog(), "synthetic_city");
    expect(reprobeRefusal(supported, null, 0)).toMatch(/only failed rows/);
    expect(reprobeRefusal(failedRow("x", "X", `${BASE}/x`, { http_status: 404 }), null, 2)).toMatch(
      /re-probed once already/,
    );
  });

  it("refuses unknown and duplicate keys", async () => {
    const f = fixture();
    expect(await run(f, ["nope"], {}).done).toBe(2);
    expect(await run(f, ["open_city", "open_city"], {}).done).toBe(2);
    expect(await run(f, [], {}).done).toBe(2);
  });

  it("refuses when the host does not resolve locally: nothing sent, nothing recorded", async () => {
    const f = fixture();
    const before = readFileSync(f.catalogPath, "utf8");
    const files = evidenceFiles(f);
    const r = run(f, ["open_city"], {}, { dnsFails: true });
    expect(await r.done).toBe(2);
    expect(r.http.calls).toHaveLength(0);
    expect(r.lines.join("\n")).toMatch(/local DNS failure\); nothing was sent, nothing recorded/);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(evidenceFiles(f)).toEqual(files);
  });
});

describe("reprobe-jurisdictions: one request per row, rebuilt by the workflow's assembly", () => {
  it("a re-probe that succeeds turns the open-data row into supported / available", async () => {
    const f = fixture();
    const before = readFileSync(f.catalogPath, "utf8");
    const r = run(f, ["open_city"], {
      [`${BASE}/open/page`]: () => text("<html><body>synthetic dataset page</body></html>"),
    });
    expect(await r.done).toBe(1); // the validator's own code passes through
    expect(r.validatorCalls()).toBe(1);
    expect(r.http.calls).toHaveLength(1);
    expect(new Headers(must(r.http.calls[0]).init.headers).get("user-agent")).toBe(USER_AGENT);

    const after = readCatalog(f.catalogPath);
    const open = row(after, "open_city");
    expect(open.spec_class).toBe("supported");
    expect(open.status).toBe("supported");
    expect(open.historical_records).toBe(true);
    expect(open.blocked_evidence).toBeUndefined();
    expect(open.blocked_explanation).toBeUndefined();
    expect(open.evidence_captured_at).toBe(FIXED.toISOString());
    expect(open.evidence_http_status).toBe(200);
    expect(open.earliest_record_date).toBe("1990-01-01");
    expect(open.notes).toBe("synthetic: open data profile note");

    // every other row is byte-identical
    const text1 = readFileSync(f.catalogPath, "utf8");
    for (const key of ["synthetic_city", "unincorporated", "moved_city", "walled_city"]) {
      expect(rowText(text1, key)).toBe(rowText(before, key));
    }
    expect(text1.split("\n    - jurisdiction: ")[0]).toBe(
      before.split("\n    - jurisdiction: ")[0],
    );
    const tail = (t: string) => body(t).slice(t.indexOf("\ndestination:"));
    expect(tail(text1)).toBe(tail(before));
  });

  it("a re-probe that fails again writes new evidence and keeps the row blocked", async () => {
    const f = fixture();
    const before = readFileSync(f.catalogPath, "utf8");
    const r = run(f, ["moved_city"], {
      [`${BASE}/moved/new-page`]: () => text("not here", 404),
    });
    expect(await r.done).toBe(1);
    expect(r.http.calls).toHaveLength(1); // attempt budget 1: no retry

    const moved = row(readCatalog(f.catalogPath), "moved_city");
    expect(moved.spec_class).toBe("records request");
    expect(moved.status).toBe("blocked");
    expect(moved.evidence_url).toBe(`${BASE}/moved/new-page`);
    const be = must(moved.blocked_evidence);
    expect(be.http_status).toBe(404);
    expect(be.url).toBe(`${BASE}/moved/new-page`);
    expect(be.evidence_path).toBe(`${EVIDENCE_DIR}/jurisdiction-moved_city-20260203T040506Z.md`);
    const evidence = readFileSync(join(f.root, be.evidence_path), "utf8");
    expect(evidence).toMatch(/http_status: 404/);
    expect(evidence).toMatch(/subject: jurisdiction:moved_city/);
    expect(
      existsSync(join(f.root, `${EVIDENCE_DIR}/jurisdiction-moved_city-20260101T000000Z.md`)),
    ).toBe(true);
    expect(moved.notes).toMatch(/not filed \(PO decision 2026-10-20\)/);
    expect(moved.blocked_explanation).toMatch(
      /^No permit history was captured: the official evidence page could not be read on 2026-02-03 \(HTTP 404\)/,
    );
    // Austin-issued permits located here (synthetic group-by) are stated in the explanation
    expect(moved.austin_issued_located_here?.value).toBe(5);
    expect(moved.blocked_explanation).toMatch(
      /Synthetic's own permits are not captured, but Austin-issued permits located here are captured through Austin dataset 3syk-w9eu: 5 permits inside the city limits \(full purpose\)/,
    );
    // OR-m2: the re-probe is recorded on the row, with the evidence it supersedes
    expect(moved.reprobe_count).toBe(1);
    expect(moved.reprobed_at).toBe(FIXED.toISOString());
    expect(moved.reprobe_url_changed).toBe(true);
    expect(moved.superseded_evidence).toEqual([
      {
        evidence_path: `${EVIDENCE_DIR}/jurisdiction-moved_city-20260101T000000Z.md`,
        superseded_by: be.evidence_path,
      },
    ]);
    const amendment = must(readCatalog(f.catalogPath).amendments?.at(-1));
    expect(amendment).toMatchObject({ command: "reprobe-jurisdictions", egress_country: "EG" });
    expect(readFileSync(join(f.root, be.evidence_path), "utf8")).toMatch(/egress_country: EG/);

    const text1 = readFileSync(f.catalogPath, "utf8");
    for (const key of ["synthetic_city", "unincorporated", "open_city", "walled_city"]) {
      expect(rowText(text1, key)).toBe(rowText(before, key));
    }

    // a second re-probe of the same row is refused (only once), from reprobe_count
    const again = run(f, ["moved_city"], {});
    expect(await again.done).toBe(2);
    expect(again.http.calls).toHaveLength(0);
    expect(again.lines.join("\n")).toMatch(/re-probed already \(reprobe_count 1/);
  });

  it("probes several rows one at a time", async () => {
    const f = fixture();
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = (body: string, status: number) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return text(body, status);
    };
    const r = run(f, ["open_city", "moved_city"], {
      [`${BASE}/open/page`]: slow("ok", 200),
      [`${BASE}/moved/new-page`]: slow("gone", 404),
    });
    expect(await r.done).toBe(1);
    expect(r.http.calls.map((c) => c.url)).toEqual([`${BASE}/open/page`, `${BASE}/moved/new-page`]);
    expect(maxInFlight).toBe(1);
  });
});
