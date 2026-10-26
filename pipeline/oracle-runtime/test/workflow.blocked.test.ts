// T034: User Story 4 workflow tests (FR-006 to FR-006f). A blocked receipt moves the run to
// WAITING_HUMAN and waits on a durable promise; a human resolves it as "captured" or "still
// blocked"; a 429/5xx after 5 attempts waits as well; READY never starts seed.
// Synthetic responses only (test-only); an injected fetch answers every host, nothing real
// is called, and the clock is injected.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  USER_AGENT,
  createSourceClient,
  type FetchLike,
} from "../travis/lib/source-client.js";
import { CatalogSchema, type Catalog } from "../travis/discovery/catalog.schema.js";
import { checkCatalog } from "../travis/discovery/check-catalog.js";
import { emitCatalogYaml } from "../travis/discovery/write-catalog.js";
import type { JurisdictionProfileEntry } from "../travis/profiles/jurisdictions.js";
import {
  createJurisdictionProbes,
  createTravisDiscovery,
  createUs1Probes,
  PermanentFailure,
  planResolution,
  runTravisDiscovery,
  stoppedOnBlock,
  type DiscoveryDeps,
  type HumanIO,
  type Resolution,
  type RunRecord,
} from "../travis/discovery/workflow.js";
import { main as resolveMain } from "../travis/discovery/resolve.js";
import {
  fakeHttp,
  hangUntilAborted,
  json,
  silent,
  steppingClock,
  text,
  type RecordedCall,
  type Route,
} from "./fixtures/fake-http.js";
import { must } from "./helpers.js";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const HOUR = 3_600_000;
const FULL_PAGE = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ id: i })));
const LANDING = `<html><body><p>Certified on July 25, 2026.</p>
<a href="/files/2026-special-export.json">2026 Certified Special Export (JSON)</a>
<a href="/files/layouts.zip">Export Layouts</a>
<a href="/files/supp-1.zip">2026 Supplemental Appraisal Roll Export 1</a></body></html>`;
const EXPORT = JSON.stringify([{ prop_id: 1, deed_date: "2020-01-01" }, { prop_id: 2 }]);
const CENSUS_URL = "https://census.test/place_by_county.txt";
const CENSUS = [
  "STATE|STATEFP|COUNTYFP|COUNTYNAME|PLACEFP|PLACENS|PLACENAME|TYPE|CLASSFP|FUNCSTAT",
  "TX|48|453|Travis County|00001|00000001|Alpha city|INCORPORATED PLACE|C1|A",
].join("\n");
const REQUEST = {
  recipient_office: "Synthetic City Secretary",
  system_scope: "synthetic permits, 2000 to present",
  route: "records-first" as const,
  request_portal_url: "https://records.test/request",
};
const PROFILE: JurisdictionProfileEntry[] = [
  {
    key: "alpha",
    jurisdiction: "Alpha",
    census_placefp: "00001",
    spec_class: "supported",
    case: "history-online",
    portal_kind: "open-data-api",
    portal: "https://alpha.test/api",
    evidence_url: "https://alpha.test/permits",
    earliest_record_date: "1990-01-01",
    records_request: REQUEST,
  },
  {
    key: "synthetic_unincorporated",
    jurisdiction: "Synthetic County unincorporated",
    census_placefp: null,
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://county.test/permits",
    records_request: REQUEST,
  },
];

/** Mutable so a test can change a source's answer between the first probe and a re-probe. */
interface Scenario {
  tcadBlocked?: boolean;
  austinThrottled?: boolean;
  bbbBlocked?: boolean;
  alphaBlocked?: boolean;
  /** run-1 shape: the export answers HTTP 200 and the stream breaks part-way. */
  tcadBroken?: boolean;
  /** run-1 shape: BBB answers 403 with cf-mitigated: challenge and an interstitial. */
  bbbCfChallenge?: boolean;
  /** run-1 shape: a normal 200 permit page carrying the Cloudflare challenge-platform beacon. */
  alphaBeacon?: boolean;
  /** run-2 shape: a 403 Cloudflare interstitial whose <title> the challenge signal quotes. */
  alphaCfTitle?: boolean;
  /** run-2 shape: BBB answers 200 with a titled interstitial (no cf-mitigated header). */
  bbbTitle?: boolean;
  /** A network error whose message carries a quote, a backslash and a newline. */
  gisOddError?: boolean;
}

/** SYNTHETIC: a 200 response whose body stream errors after `sent` bytes (undici "terminated"). */
function brokenStream(sent: number, contentLength: number): Response {
  let done = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (!done) {
          done = true;
          controller.enqueue(new Uint8Array(sent));
          return;
        }
        controller.error(new TypeError("terminated"));
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(contentLength) },
    },
  );
}

const BEACON_PAGE = `<html><head><title>Building Permits | Alpha, TX</title></head><body>
<h1>Building Permits</h1><p>synthetic permits page</p>
<script>var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>
</body></html>`;

function socrata(host: string, counts: Record<string, string>, s: Scenario): Route[] {
  const throttled = (): boolean => host === "data.austintexas.gov" && s.austinThrottled === true;
  return [
    {
      match: (u) => u.host === host && throttled(),
      respond: () => json({ message: "synthetic: too many requests" }, 429),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$group") === "jurisdiction",
      respond: () => json([{ jurisdiction: "AUSTIN FULL PURPOSE", count: "100" }]),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$order") === ":id",
      respond: () => new Response(FULL_PAGE, { headers: { "content-type": "application/json" } }),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$select") === "count(*)",
      respond: (u) => json([{ count: counts[u.searchParams.get("$where") ?? ""] ?? "0" }]),
    },
  ];
}

function routes(s: Scenario): Route[] {
  return [
    ...socrata("data.austintexas.gov", { "": "2400000", "tcad_id IS NULL": "1234" }, s),
    ...socrata("data.texas.gov", { "": "90000", "taxpayer_county_code='227'": "3000" }, s),
    {
      match: (u) => u.host === "traviscad.org",
      respond: (u) => {
        if (s.tcadBlocked)
          return text("<html>Forbidden</html>", 403, {
            "content-type": "text/html",
            "set-cookie": "session=synthetic-secret",
          });
        if (u.pathname === "/publicinformation") return text(LANDING);
        if (u.pathname === "/files/layouts.zip")
          return new Response("PK", { headers: { "content-type": "application/zip" } });
        if (s.tcadBroken) return brokenStream(4096, 100_000);
        return new Response(EXPORT, { headers: { "content-type": "application/json" } });
      },
    },
    {
      match: (u) => u.host === "gis.traviscountytx.gov",
      respond: () => {
        if (s.gisOddError) throw new TypeError('connect failed: "ECONNRESET" at a\\b\nnext line');
        return json({ count: 2 });
      },
    },
    {
      match: (u) => u.host.endsWith("bbb.org"),
      respond: () =>
        s.bbbTitle
          ? text("<html><head><title>Just a moment...</title></head></html>", 200)
          : s.bbbCfChallenge
            ? text("<html><head><title>Just a moment... | BBB</title></head></html>", 403, {
                "content-type": "text/html",
                "cf-mitigated": "challenge",
              })
            : s.bbbBlocked
              ? text("<html>Just a moment...</html>", 403)
              : text("<html>synthetic listing page</html>"),
    },
    {
      match: (u) => u.host === "census.test",
      respond: () => text(CENSUS, 200, { "content-type": "text/plain" }),
    },
    {
      match: (u) => u.host === "alpha.test",
      respond: () =>
        s.alphaCfTitle
          ? text("<html><head><title>Attention Required! | Cloudflare</title></head></html>", 403)
          : s.alphaBlocked
            ? text("Forbidden", 403)
            : s.alphaBeacon
              ? text(BEACON_PAGE, 200, { "content-type": "text/html", server: "cloudflare" })
              : text("<html>synthetic permits page</html>"),
    },
    { match: () => true, respond: () => text("<html>synthetic evidence page</html>") },
  ];
}

/** Thrown by the fake durable promise when no resolution is scripted: the run suspends. */
class Suspended extends Error {
  constructor(readonly names: readonly string[]) {
    super("suspended on durable promise");
  }
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});

interface Harness {
  scenario: Scenario;
  calls: RecordedCall[];
  journal: string[];
  saved: RunRecord[];
  awaited: string[][];
  catalogs: Catalog[];
  evidence: Map<string, string>;
  validatorRuns: number;
  sleeps: number;
  io: HumanIO;
  /** Extra dependencies merged into the run (Phase 6 wiring tests). */
  extra: Partial<DiscoveryDeps>;
  run: () => Promise<RunRecord>;
}

function harness(scenario: Scenario, resolutions: Resolution[] = []): Harness {
  const rawDir = mkdtempSync(join(tmpdir(), "us4-raw-"));
  tmpDirs.push(rawDir);
  const { fetch, calls } = fakeHttp(routes(scenario));
  let clock = START;
  const h: Harness = {
    scenario,
    calls,
    journal: [],
    saved: [],
    awaited: [],
    catalogs: [],
    evidence: new Map(),
    validatorRuns: 0,
    sleeps: 0,
    io: undefined as unknown as HumanIO,
    extra: {},
    run: async () => {
      throw new Error("unset");
    },
  };
  const client = createSourceClient({
    fetch: fetch as FetchLike,
    sleep: async () => {
      h.sleeps += 1;
    },
    random: () => 0,
    now: () => new Date(clock),
    log: silent,
  });
  const queue = [...resolutions];
  h.io = {
    now: async () => new Date(clock),
    run: async (name, fn) => {
      h.journal.push(name);
      return fn();
    },
    save: (r) => {
      h.saved.push(structuredClone(r));
    },
    awaitResolution: async (names) => {
      h.awaited.push([...names]);
      const next = queue.shift();
      if (!next) throw new Suspended(names);
      clock += 2 * HOUR; // the human answers two hours later
      return next;
    },
  };
  const probes = createUs1Probes({
    client,
    now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    rawDir,
    gisTimeoutMs: 20,
  });
  const jurisdictions = createJurisdictionProbes(
    { client, now: () => new Date(clock) },
    { censusUrl: CENSUS_URL },
  );
  h.run = () =>
    runTravisDiscovery(h.io, "run-us4", {
      probes,
      jurisdictions,
      profile: PROFILE,
      writeCatalog: (c) => {
        h.catalogs.push(structuredClone(c));
      },
      runValidator: async () => {
        h.validatorRuns += 1;
        return {
          exit_code: 0,
          report_path: "docs/evidence/A-01-readiness.json",
          vendored_sha256: "0".repeat(64),
        };
      },
      writeEvidence: (path, content) => {
        h.evidence.set(path, content);
      },
      ...h.extra,
    });
  return h;
}

function hostCalls(calls: readonly RecordedCall[], host: string): number {
  return calls.filter((c) => new URL(c.url).host === host).length;
}

function lastSaved(h: Harness): RunRecord {
  return must(h.saved.at(-1), "saved run record");
}

function source(catalog: Catalog, key: string) {
  return must(
    catalog.sources.find((s) => s.key === key),
    key,
  );
}

describe("A-01-TC-018 blocked receipt waits for a human (FR-006, FR-006a, FR-006d)", () => {
  it("a TCAD 403 moves the run to WAITING_HUMAN on a durable promise, with one request and no timer loop", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);

    const record = lastSaved(h);
    expect(record.state).toBe("WAITING_HUMAN");
    expect(record.auto_advance_to_seed).toBe(false);
    expect(must(h.awaited[0])).toEqual(
      expect.arrayContaining(["resolve:tcad_certified:1", "resolve:tcad_supplemental:1"]),
    );
    const tcad = must(record.blockers.find((b) => b.source_key === "tcad_certified"));
    expect(tcad).toMatchObject({ waiting: true, attempt: 1, promise: "resolve:tcad_certified:1" });
    expect(tcad.receipt.attempts).toBe(1);
    // exactly one request to the blocked host, no sleeps (no backoff on 403, no polling)
    expect(hostCalls(h.calls, "traviscad.org")).toBe(1);
    expect(h.sleeps).toBe(0);
    // the catalog is written once before waiting, with the TCAD rows blocked
    const catalog = must(h.catalogs.at(-1));
    expect(source(catalog, "tcad_certified").status).toBe("blocked");
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it("the workflow module has no timer loop: it waits only on the durable promise", () => {
    const path = fileURLToPath(new URL("../travis/discovery/workflow.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    expect(src).not.toMatch(/setTimeout|setInterval|ctx\.sleep|\.sleep\(/);
    expect(src).toMatch(/ctx\.promise/);
  });

  it("T038: blocked TCAD rows carry a complete records request (Public Information Act, 2026 certified + supplemental)", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const catalog = must(h.catalogs.at(-1));
    for (const key of ["tcad_certified", "tcad_supplemental"]) {
      const row = source(catalog, key);
      const req = must(row.records_request, `${key}.records_request`);
      expect(req.recipient_office).toMatch(/Travis Central Appraisal District/);
      expect(req.recipient_office).toMatch(/public information/i);
      expect(req.system_scope).toMatch(/Public Information Act/);
      expect(req.system_scope).toMatch(/2026 Certified/);
      expect(req.system_scope).toMatch(/supplemental/i);
      expect(["records-first", "api-first"]).toContain(req.route);
      expect(req.request_portal_url ?? req.request_email).toBeTruthy();
      expect(must(row.next_step)).toMatch(/records request/i);
    }
    expect(checkCatalog(catalog).filter((l) => /tcad/.test(l))).toEqual([]);
    const blocker = must(lastSaved(h).blockers.find((b) => b.source_key === "tcad_certified"));
    expect(must(blocker.records_request).recipient_office).toMatch(/Travis Central/);
  });

  it("T038: a BBB challenge records the official BBB API application as the next step (not filed, PO decision 2026-10-20)", async () => {
    const h = harness({ bbbBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const bbb = source(must(h.catalogs.at(-1)), "bbb");
    expect(bbb.status).toBe("blocked");
    expect(must(bbb.next_step)).toMatch(/BBB API/);
    expect(must(bbb.next_step)).toMatch(/not filed \(PO decision 2026-10-20\)/);
    expect(must(bbb.next_step)).toMatch(
      /bounded bbb-harvest that stops on 403 is the A-08 fallback/,
    );
    expect(must(bbb.records_request)).toMatchObject({ route: "api-first" });
    expect(must(must(bbb.records_request).request_portal_url)).toMatch(
      /^https:\/\/developer\.bbb\.org/,
    );
  });

  it("T037: an evidence file is written for each blocked source and jurisdiction row, at its evidence_path", async () => {
    const h = harness({ tcadBlocked: true, alphaBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const catalog = must(h.catalogs.at(-1));
    const paths = [
      must(source(catalog, "tcad_certified").blocked_evidence).evidence_path,
      must(source(catalog, "tcad_supplemental").blocked_evidence).evidence_path,
      must(must(catalog.permits).jurisdictions.find((j) => j.key === "alpha")?.blocked_evidence)
        .evidence_path,
    ];
    for (const p of paths) {
      expect(p.startsWith("docs/evidence/blocked/")).toBe(true);
      expect(h.evidence.has(p)).toBe(true);
      expect(must(h.evidence.get(p))).toMatch(/^---\nid: /);
    }
    expect([...h.evidence.values()].join("\n")).not.toContain("synthetic-secret");
  });
});

describe("run-1 regressions: next step, anti_bot and challenge classification", () => {
  it("bug 1: a broken TCAD download on a reachable source recommends one more captured attempt, not a records request", async () => {
    const h = harness({ tcadBroken: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const catalog = must(h.catalogs.at(-1));
    const row = source(catalog, "tcad_certified");
    expect(row.status).toBe("blocked");
    const next = must(row.next_step);
    expect(next).toMatch(/reachable/i);
    expect(next).toMatch(/HTTP 200/);
    expect(next).toMatch(/broke at 4096 of 100000 bytes/);
    expect(next).toContain("resolve -- tcad_certified captured");
    expect(next).not.toMatch(/^File the Public Information Act/);
    // the PIA request is kept only as a documented fallback note, not as the next step
    expect(row.records_request).toBeUndefined();
    expect(must(row.notes)).toMatch(/fallback/i);
    expect(must(row.notes)).toMatch(/Public Information Act/);
    expect(must(row.blocked_evidence)).toMatchObject({
      http_status: 200,
      outcome: "failed",
      error: "terminated",
    });
    expect(must(row.blocked_evidence).timeout_ms).toBeUndefined();
    expect(must(row.anti_bot)).toMatch(/challenge: none seen/);
    // automatic retry stays off: exactly one export request
    expect(
      h.calls.filter((c) => new URL(c.url).pathname === "/files/2026-special-export.json").length,
    ).toBe(1);
    const blocker = must(lastSaved(h).blockers.find((b) => b.source_key === "tcad_certified"));
    expect(blocker.records_request).toBeUndefined();
    expect(blocker.next_step).toContain("resolve -- tcad_certified captured");
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it("bug 1: a real TCAD block (403) still names the records request as the next step", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const row = source(must(h.catalogs.at(-1)), "tcad_certified");
    expect(must(row.next_step)).toMatch(/records request/i);
    expect(row.records_request).toBeDefined();
  });

  it("bug 4: BBB 403 with cf-mitigated: challenge says the challenge was seen in anti_bot", async () => {
    const h = harness({ bbbCfChallenge: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const bbb = source(must(h.catalogs.at(-1)), "bbb");
    expect(bbb.status).toBe("blocked");
    expect(must(bbb.anti_bot)).toMatch(/challenge: seen/);
    expect(must(bbb.anti_bot)).toContain("cf-mitigated: challenge");
    expect(must(bbb.anti_bot)).not.toMatch(/none seen/);
  });

  it("bug 4: a source with no challenge says none seen", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const catalog = must(h.catalogs.at(-1));
    expect(must(source(catalog, "tcad_certified").anti_bot)).toMatch(/challenge: none seen/);
    expect(must(source(catalog, "austin_permits").anti_bot)).toMatch(/challenge: none seen/);
  });

  it("bug 2: a 200 permit page with the challenge-platform beacon is not a blocked row", async () => {
    const h = harness({ alphaBeacon: true });
    const record = await h.run();
    expect(record.state).toBe("READY");
    const alpha = must(
      must(must(h.catalogs.at(-1)).permits).jurisdictions.find((j) => j.key === "alpha"),
    );
    expect(alpha.status).toBe("supported");
    expect(alpha.blocked_evidence).toBeUndefined();
  });
});

describe("run-2 regression: runtime text in the catalog stays writable", () => {
  // Live run "travis-2" stalled in catalog:write: a Cloudflare interstitial title is quoted
  // in the challenge signal (title: "Attention Required! | Cloudflare"), missingReason copied
  // it into the jurisdiction notes, and the writer refused the double quote.
  it("a quoted challenge title and an odd network error reach the catalog without quote, backslash or control characters", async () => {
    const h = harness({ alphaCfTitle: true, bbbTitle: true, gisOddError: true });
    const emitted: string[] = [];
    h.extra.writeCatalog = (c) => {
      emitted.push(emitCatalogYaml(c));
      h.catalogs.push(structuredClone(c));
    };
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    expect(h.journal.filter((n) => n.startsWith("catalog:write:"))).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    const catalog = must(h.catalogs.at(-1));
    const alpha = must(must(catalog.permits).jurisdictions.find((j) => j.key === "alpha"));
    expect(alpha.status).toBe("blocked");
    expect(must(alpha.notes)).toContain("title: 'Attention Required! | Cloudflare'");
    const bbb = source(catalog, "bbb");
    expect(must(bbb.anti_bot)).toContain("title: 'Just a moment...'");
    const gis = source(catalog, "tcad_gis");
    expect(must(gis.blocked_evidence).error).toBe("connect failed: 'ECONNRESET' at a/b next line");
    // every string anywhere in the catalog is in the writer's safe set
    // eslint-disable-next-line no-control-regex -- control characters are what we look for
    const unsafe = /["\\\u0000-\u001f\u007f]/;
    const strings: string[] = [];
    JSON.stringify(catalog, (_k, v: unknown) => {
      if (typeof v === "string") strings.push(v);
      return v;
    });
    expect(strings.filter((x) => unsafe.test(x))).toEqual([]);
    // the evidence file keeps the source's own text (only redaction applies there)
    const alphaEvidence = must(h.evidence.get(must(alpha.blocked_evidence).evidence_path));
    expect(alphaEvidence).toContain("Attention Required! | Cloudflare");
  });
});

describe("A-01-TC-027 resolve (FR-006f)", () => {
  it("captured: re-probes only that source once with the same User-Agent, rewrites the catalog and re-runs the validator", async () => {
    const scenario: Scenario = { tcadBlocked: true };
    const h = harness(scenario, [{ source_key: "tcad_certified", outcome: "captured" }]);
    // the human gets access before resolving: the next TCAD request succeeds
    const originalAwait = h.io.awaitResolution.bind(h.io);
    h.io.awaitResolution = async (names) => {
      scenario.tcadBlocked = false;
      return originalAwait(names);
    };
    const before = { journal: 0, calls: 0, austin: 0, gis: 0 };
    const originalRun = h.io.run.bind(h.io);
    let resolved = false;
    h.io.run = async (name, fn) => {
      if (!resolved && /reprobe/.test(name)) {
        resolved = true;
        before.calls = h.calls.length;
        before.austin = hostCalls(h.calls, "data.austintexas.gov");
        before.gis = hostCalls(h.calls, "gis.traviscountytx.gov");
      }
      return originalRun(name, fn);
    };

    const record = await h.run();

    const reprobes = h.journal.filter((k) => /reprobe/.test(k));
    expect(reprobes).toHaveLength(1);
    expect(must(reprobes[0])).toMatch(/^tcad_certified:export:\d{4}-\d{2}-\d{2}:reprobe:1$/);
    // only TCAD was asked again; every request carried the one project User-Agent
    const after = h.calls.slice(before.calls);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((c) => new URL(c.url).host === "traviscad.org")).toBe(true);
    expect(hostCalls(h.calls, "data.austintexas.gov")).toBe(before.austin);
    expect(hostCalls(h.calls, "gis.traviscountytx.gov")).toBe(before.gis);
    const agents = new Set(
      h.calls.map((c) => new Headers(c.init.headers as Record<string, string>).get("user-agent")),
    );
    expect([...agents]).toEqual([USER_AGENT]);

    // catalog rewritten with TCAD available, validator re-run once, run READY
    expect(h.catalogs.length).toBe(2);
    const catalog = must(h.catalogs.at(-1));
    expect(source(catalog, "tcad_certified").status).toBe("available");
    expect(must(catalog.parcel).assessed_parcel_count).toBe(2);
    // once on the first catalog (r0), once again after the re-probe
    expect(h.validatorRuns).toBe(2);
    expect(h.journal.filter((k) => k.startsWith("validator:run:"))).toEqual([
      "validator:run:r0",
      "validator:run:r1",
    ]);
    expect(record.validator).toMatchObject({ exit_code: 0 });
    expect(record.state).toBe("READY");
    expect(record.blockers).toEqual([]);
    expect(record.auto_advance_to_seed).toBe(false);
    // the run went WAITING_HUMAN -> DISCOVERING (re-probe) -> READY
    const states = h.saved.map((r) => r.state);
    const waitAt = states.indexOf("WAITING_HUMAN");
    expect(waitAt).toBeGreaterThan(-1);
    expect(states.slice(waitAt)).toContain("DISCOVERING");
  });

  it("still-blocked: stays WAITING_HUMAN with the blocker and records request documented; no new request", async () => {
    const h = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "still-blocked" },
      { source_key: "tcad_supplemental", outcome: "still-blocked" },
    ]);
    const record = await h.run();
    expect(record.state).toBe("WAITING_HUMAN");
    expect(hostCalls(h.calls, "traviscad.org")).toBe(1);
    expect(h.journal.some((k) => /reprobe/.test(k))).toBe(false);
    // only the first-catalog run; a still-blocked resolution does not re-run the validator
    expect(h.validatorRuns).toBe(1);
    for (const key of ["tcad_certified", "tcad_supplemental"] as const) {
      const b = must(record.blockers.find((x) => x.source_key === key));
      expect(b.waiting).toBe(false);
      expect(b.resolution).toBe("still-blocked");
      expect(b.next_step).toMatch(/still blocked/);
      expect(b.next_step).toMatch(/Travis Central Appraisal District/);
      expect(b.next_step).toMatch(/FR-006d/);
    }
    expect(record.resolutions.map((r) => `${r.source_key}:${r.outcome}`)).toEqual([
      "tcad_certified:still-blocked",
      "tcad_supplemental:still-blocked",
    ]);
    // the catalog keeps the blocked rows and is rewritten with the waiting time
    const catalog = must(h.catalogs.at(-1));
    expect(source(catalog, "tcad_certified").status).toBe("blocked");
  });

  it("captured but still blocked: the source waits again on a new promise (attempt 2), one more request only", async () => {
    const h = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "captured" },
    ]);
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    expect(hostCalls(h.calls, "traviscad.org")).toBe(2);
    const record = lastSaved(h);
    expect(record.state).toBe("WAITING_HUMAN");
    const b = must(record.blockers.find((x) => x.source_key === "tcad_certified"));
    expect(b).toMatchObject({ waiting: true, attempt: 2, promise: "resolve:tcad_certified:2" });
    expect(must(h.awaited.at(-1))).toContain("resolve:tcad_certified:2");
  });

  it("planResolution accepts a waiting source and refuses one that is not waiting", async () => {
    // T056: a 429-exhausted failure may be `captured`; a 403 block may not (see A-01-TC-019)
    const h = harness({ austinThrottled: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    expect(planResolution(record, { source_key: "austin_permits", outcome: "captured" })).toEqual({
      accepted: true,
      promise: "resolve:austin_permits:1",
    });
    expect(
      planResolution(record, { source_key: "tcad_certified", outcome: "captured" }),
    ).toMatchObject({ accepted: false });
    expect(
      planResolution(record, { source_key: "austin_permits", outcome: "maybe" }),
    ).toMatchObject({ accepted: false });
    expect(
      planResolution(null, { source_key: "austin_permits", outcome: "captured" }),
    ).toMatchObject({ accepted: false });
  });

  it("the Restate resolve handler resolves the durable promise only for a waiting source", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    let handlers: Record<string, (ctx: unknown, input?: unknown) => Promise<unknown>> = {};
    const sdk = {
      workflow: (def: { handlers: typeof handlers }) => {
        handlers = def.handlers;
        return def;
      },
    };
    createTravisDiscovery(sdk as unknown as Parameters<typeof createTravisDiscovery>[0]);
    expect(Object.keys(handlers).sort()).toEqual(["resolve", "run", "status"]);
    const resolved: Array<{ name: string; value: unknown }> = [];
    const ctx = {
      key: "run-us4",
      get: async () => record,
      promise: (name: string) => ({
        resolve: async (value: unknown) => {
          resolved.push({ name, value });
        },
      }),
    };
    const ok = await must(handlers.resolve)(ctx, {
      source_key: "tcad_certified",
      outcome: "still-blocked",
    });
    expect(ok).toMatchObject({ accepted: true });
    expect(resolved).toEqual([
      {
        name: "resolve:tcad_certified:1",
        value: { source_key: "tcad_certified", outcome: "still-blocked" },
      },
    ]);
    const refused = await must(handlers.resolve)(ctx, {
      source_key: "austin_permits",
      outcome: "captured",
    });
    expect(refused).toMatchObject({ accepted: false });
    expect(resolved).toHaveLength(1);
  });

  it("resolve CLI exits 0 for a waiting source and 1 for one that is not waiting", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    const ingress = (accepted: boolean) => async (url: string, init: RequestInit) => {
      if (url.endsWith("/status")) return json(null);
      posted.push({ url, body: JSON.parse(String(init.body)) as unknown });
      return json(
        accepted
          ? { accepted, promise: "resolve:tcad_certified:1" }
          : { accepted, reason: "not waiting" },
      );
    };
    const lines: string[] = [];
    const out = (l: string) => {
      lines.push(l);
    };
    const env = {
      RESTATE_INGRESS_URL: "http://ingress.test:8080",
      TRAVIS_DISCOVERY_RUN_ID: "run-x",
    };
    const offline = {
      readCatalog: () => null,
      egress: async () => ({
        ok: true as const,
        egress: { country: "EG", captured_at: "2026-01-01T00:00:00.000Z", method: "trace" },
      }),
    };

    expect(
      await resolveMain(["tcad_certified", "still-blocked"], {
        ...offline,
        fetch: ingress(true),
        env,
        out,
      }),
    ).toBe(0);
    expect(posted[0]).toEqual({
      url: "http://ingress.test:8080/TravisDiscovery/run-x/resolve",
      body: { source_key: "tcad_certified", outcome: "still-blocked" },
    });
    expect(
      await resolveMain(["austin_permits", "captured"], {
        ...offline,
        fetch: ingress(false),
        env,
        out,
      }),
    ).toBe(1);
    // bad arguments never reach the ingress
    const sent = posted.length;
    expect(
      await resolveMain(["tcad_certified", "maybe"], {
        ...offline,
        fetch: ingress(true),
        env,
        out,
      }),
    ).toBe(1);
    expect(
      await resolveMain(["not_a_source", "captured"], {
        ...offline,
        fetch: ingress(true),
        env,
        out,
      }),
    ).toBe(1);
    expect(await resolveMain([], { ...offline, fetch: ingress(true), env, out })).toBe(1);
    expect(posted.length).toBe(sent);
    // an unreachable stack is reported, not a crash
    const down = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    expect(
      await resolveMain(["tcad_certified", "captured"], { ...offline, fetch: down, env, out }),
    ).toBe(1);
    expect(lines.join("\n")).not.toMatch(/\/Users\//);
  });
});

describe("A-01-TC-019 / T056: a 403, challenge or WAF block is never re-probed (AC-6)", () => {
  const REFUSAL =
    /stopped on HTTP 403 \/ challenge; a blocked source is never re-probed \(AC-6\); only still-blocked is allowed/;

  /** The Restate handlers of the workflow, with a context reading `record`. */
  function resolveHandler(record: RunRecord) {
    let handlers: Record<string, (ctx: unknown, input?: unknown) => Promise<unknown>> = {};
    const sdk = {
      workflow: (def: { handlers: typeof handlers }) => {
        handlers = def.handlers;
        return def;
      },
    };
    createTravisDiscovery(sdk as unknown as Parameters<typeof createTravisDiscovery>[0]);
    const resolved: Array<{ name: string; value: unknown }> = [];
    const ctx = {
      key: "run-us4",
      get: async () => record,
      promise: (name: string) => ({
        resolve: async (value: unknown) => {
          resolved.push({ name, value });
        },
      }),
    };
    return {
      resolved,
      resolve: (input: unknown) => must(handlers.resolve)(ctx, input),
    };
  }

  const blockedCases: Array<{ name: string; scenario: Scenario; key: "tcad_certified" | "bbb" }> = [
    { name: "plain HTTP 403", scenario: { tcadBlocked: true }, key: "tcad_certified" },
    { name: "BBB 403 + cf-mitigated: challenge", scenario: { bbbCfChallenge: true }, key: "bbb" },
    { name: "BBB 200 challenge interstitial", scenario: { bbbTitle: true }, key: "bbb" },
  ];

  for (const c of blockedCases) {
    it(`${c.name}: captured is refused and nothing is probed; still-blocked is accepted`, async () => {
      const h = harness(c.scenario);
      await expect(h.run()).rejects.toBeInstanceOf(Suspended);
      const record = lastSaved(h);
      expect(must(record.blockers.find((b) => b.source_key === c.key)).waiting).toBe(true);
      const callsBefore = h.calls.length;

      const plan = planResolution(record, { source_key: c.key, outcome: "captured" });
      expect(plan.accepted).toBe(false);
      expect(plan.accepted ? "" : plan.reason).toMatch(REFUSAL);
      expect(plan.accepted ? "" : plan.reason).toContain(c.key);

      const handler = resolveHandler(record);
      expect(await handler.resolve({ source_key: c.key, outcome: "captured" })).toMatchObject({
        accepted: false,
      });
      // no durable promise completed, so the workflow never re-probes; no request was made
      expect(handler.resolved).toEqual([]);
      expect(h.calls.length).toBe(callsBefore);
      expect(h.journal.some((k) => /reprobe/.test(k))).toBe(false);

      expect(planResolution(record, { source_key: c.key, outcome: "still-blocked" })).toEqual({
        accepted: true,
        promise: `resolve:${c.key}:1`,
      });
      expect(await handler.resolve({ source_key: c.key, outcome: "still-blocked" })).toMatchObject({
        accepted: true,
      });
      expect(handler.resolved).toHaveLength(1);
    });
  }

  it("a WAF page (Mod Security, HTTP 406) is a block: captured is refused", () => {
    const body = "<html><body>This request has been blocked by Mod Security.</body></html>";
    const receipt = {
      status: 406,
      blocked_reason: null,
      stop_evidence: {
        headers: { "content-type": "text/html" },
        excerpt_base64: Buffer.from(body, "utf8").toString("base64"),
        body_bytes: body.length,
      },
    };
    expect(stoppedOnBlock(receipt)).toBe(true);
    expect(stoppedOnBlock({ status: 406, blocked_reason: null })).toBe(false);
    expect(stoppedOnBlock({ status: null, blocked_reason: "timeout" })).toBe(false);
    expect(stoppedOnBlock({ status: 200, challenge_signal: "cf-mitigated: challenge" })).toBe(true);
  });

  it("failures may still be captured (FR-006f): timeout, network error, 429 exhausted, broken download", async () => {
    const timeout = { status: null, blocked_reason: "timeout" as const, error: "timeout" };
    expect(stoppedOnBlock(timeout)).toBe(false);

    const cases: Array<{
      scenario: Scenario;
      key: "tcad_gis" | "austin_permits" | "tcad_certified";
    }> = [
      { scenario: { gisOddError: true }, key: "tcad_gis" },
      { scenario: { austinThrottled: true }, key: "austin_permits" },
      { scenario: { tcadBroken: true }, key: "tcad_certified" },
    ];
    for (const c of cases) {
      const h = harness(c.scenario);
      await expect(h.run()).rejects.toBeInstanceOf(Suspended);
      const record = lastSaved(h);
      expect(planResolution(record, { source_key: c.key, outcome: "captured" })).toEqual({
        accepted: true,
        promise: `resolve:${c.key}:1`,
      });
    }

    // a source that timed out is still re-probed once on `captured`
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = structuredClone(lastSaved(h));
    const tcad = must(record.blockers.find((b) => b.source_key === "tcad_certified"));
    tcad.receipt = {
      ...tcad.receipt,
      status: null,
      outcome: "blocked",
      blocked_reason: "timeout",
      timeout_ms: 60_000,
    };
    delete tcad.receipt.stop_evidence;
    delete tcad.receipt.challenge_signal;
    expect(planResolution(record, { source_key: "tcad_certified", outcome: "captured" })).toEqual({
      accepted: true,
      promise: "resolve:tcad_certified:1",
    });
  });

  it("resolve CLI: `bbb captured` on a 403 challenge exits 2 and sends no resolve request", async () => {
    const h = harness({ bbbCfChallenge: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    const posted: string[] = [];
    let egressCalls = 0;
    const lines: string[] = [];
    const deps = {
      readCatalog: () => null,
      egress: async () => {
        egressCalls += 1;
        return {
          ok: true as const,
          egress: { country: "EG", captured_at: "2026-01-01T00:00:00.000Z", method: "trace" },
        };
      },
      fetch: async (url: string) => {
        posted.push(url);
        if (url.endsWith("/status")) return json(record);
        return json({ accepted: true, promise: "resolve:bbb:1" });
      },
      env: { RESTATE_INGRESS_URL: "http://ingress.test:8080", TRAVIS_DISCOVERY_RUN_ID: "run-x" },
      out: (l: string) => {
        lines.push(l);
      },
    };
    expect(await resolveMain(["bbb", "captured"], deps)).toBe(2);
    expect(posted.some((u) => u.endsWith("/resolve"))).toBe(false);
    expect(egressCalls).toBe(0);
    expect(lines.join("\n")).toMatch(REFUSAL);
    expect(lines.join("\n")).toMatch(/nothing sent/);

    // still-blocked is still sent
    expect(await resolveMain(["bbb", "still-blocked"], deps)).toBe(0);
    expect(posted.filter((u) => u.endsWith("/resolve"))).toHaveLength(1);
  });
});

describe("A-01-TC-026 exhausted and download limits (FR-006e, FR-003)", () => {
  it("429 on all 5 attempts: measurement null with 'throttled: 5 attempts exhausted', outcome failed, WAITING_HUMAN for that source only", async () => {
    const h = harness({ austinThrottled: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    expect(record.state).toBe("WAITING_HUMAN");
    expect(record.blockers.map((b) => b.source_key)).toEqual(["austin_permits"]);
    expect(must(h.awaited[0])).toEqual(["resolve:austin_permits:1"]);

    const catalog = must(h.catalogs.at(-1));
    const austin = source(catalog, "austin_permits");
    expect(austin.status).toBe("blocked");
    expect(austin.denominator.value).toBeNull();
    expect(must(austin.denominator.missing_reason)).toContain("throttled: 5 attempts exhausted");
    expect(must(austin.blocked_evidence)).toMatchObject({
      outcome: "failed",
      attempts: MAX_ATTEMPTS,
      http_status: 429,
      user_agent: USER_AGENT,
    });
    // other sources finished
    for (const key of ["tx_comptroller", "tcad_certified", "tcad_gis"]) {
      expect(source(catalog, key).status).toBe("available");
    }
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it("a TCAD download with no data for 10 minutes is blocked with timeout_ms >= 600,000", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "us4-dl-"));
    tmpDirs.push(dir);
    const client = createSourceClient({
      fetch: (async (_url: string, init: RequestInit) => hangUntilAborted(init)) as FetchLike,
      log: silent,
      clock: () => Date.now(),
    });
    const pending = client.download({
      url: "https://traviscad.test/export.json",
      destPath: join(dir, "export.json"),
      inactivityMs: 600_000,
      totalMs: 7_200_000,
    });
    await vi.advanceTimersByTimeAsync(600_001);
    const result = await pending;
    expect(result.receipt.outcome).toBe("blocked");
    expect(result.receipt.blocked_reason).toBe("timeout");
    expect(must(result.receipt.timeout_ms)).toBeGreaterThanOrEqual(600_000);
    expect(result.receipt.attempts).toBe(1);
    expect(result.path).toBeNull();
  });

  it("a TCAD download still running after 2 hours is blocked with timeout_ms >= 7,200,000", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "us4-dl-"));
    tmpDirs.push(dir);
    // a server that trickles one byte every 5 minutes forever (until the client cancels)
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const trickle = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: (controller) =>
            new Promise<void>((resolve) => {
              timer = globalThis.setTimeout(() => {
                controller.enqueue(new Uint8Array([0x5b]));
                resolve();
              }, 300_000);
            }),
          cancel: () => {
            globalThis.clearTimeout(timer);
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    const client = createSourceClient({
      fetch: (async () => trickle()) as FetchLike,
      log: silent,
      clock: () => Date.now(),
    });
    const pending = client.download({
      url: "https://traviscad.test/export.json",
      destPath: join(dir, "export.json"),
      inactivityMs: 600_000,
      totalMs: 7_200_000,
    });
    await vi.advanceTimersByTimeAsync(7_500_000);
    const result = await pending;
    expect(result.receipt.outcome).toBe("blocked");
    expect(result.receipt.blocked_reason).toBe("timeout");
    expect(must(result.receipt.timeout_ms)).toBeGreaterThanOrEqual(7_200_000);
    expect(result.path).toBeNull();
  });
});

describe("A-01-TC-NF-03 waiting_human_hours (SC-006)", () => {
  it("records the hours spent waiting for a human in the run record and the rewritten catalog", async () => {
    const h = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "still-blocked" },
      { source_key: "tcad_supplemental", outcome: "still-blocked" },
    ]);
    const record = await h.run();
    // two resolutions, each answered two hours after the wait began
    expect(record.waiting_human_hours).toBeCloseTo(4, 6);
    expect(must(h.catalogs[0]).waiting_human_hours).toBe(0);
    expect(must(h.catalogs.at(-1)).waiting_human_hours).toBeCloseTo(4, 6);
  });
});

describe("READY never starts seed (FR-006d; kit default overridden)", () => {
  it("all sources reachable: READY, no wait, no auto-advance, no client call to another service", async () => {
    const h = harness({});
    const record = await h.run();
    expect(record.state).toBe("READY");
    expect(record.auto_advance_to_seed).toBe(false);
    expect(h.awaited).toEqual([]);
    expect(record.waiting_human_hours).toBe(0);
    const path = fileURLToPath(new URL("../travis/discovery/workflow.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    expect(src).not.toMatch(/serviceClient|objectClient|workflowClient|SendClient|genericSend/);
  });
});

describe("Phase 6 wiring: destination proof, first validator run, waiting and completion times", () => {
  it("journals the destination proof once and writes the destination block into the catalog", async () => {
    const h = harness({});
    let proofs = 0;
    h.extra.destinationProof = async () => {
      proofs += 1;
      return {
        writes_in_scope: true,
        proven: true,
        independent_identity_sources: ["docker-side: synthetic", "sql-side: synthetic"],
        captured_at: "2026-01-01T00:00:00Z",
      };
    };
    const record = await h.run();
    expect(proofs).toBe(1);
    expect(h.journal.filter((k) => k.startsWith("destination:proof:"))).toHaveLength(1);
    const catalog = must(h.catalogs.at(-1));
    expect(must(catalog.destination).proven).toBe(true);
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
    expect(record.validator).toMatchObject({ exit_code: 0 });
    expect(record.completed_at).not.toBeNull();
    expect(record.waiting_since).toBeNull();
  });

  it("sets waiting_since while waiting on a human and clears it after the resolution", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const waiting = lastSaved(h);
    expect(waiting.state).toBe("WAITING_HUMAN");
    expect(waiting.waiting_since).toMatch(/Z$/);
    expect(waiting.completed_at).toBeNull();

    const done = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "still-blocked" },
      { source_key: "tcad_supplemental", outcome: "still-blocked" },
    ]);
    const record = await done.run();
    expect(record.state).toBe("WAITING_HUMAN");
    expect(record.waiting_since).toBeNull();
    expect(record.completed_at).toMatch(/Z$/);
  });
});

describe("CR-3 / OR-M1 and CR-4: the catalog write guard and permanent failures", () => {
  const amendedOnDisk = (c: Catalog): Catalog => ({
    ...c,
    amendments: [
      { command: "explain-blocked", at: "2026-01-02T00:00:00Z", fields: ["x"], ref: "y" },
    ],
  });

  it("records its run id (and the egress discover checked) in the catalog", async () => {
    const h = harness({});
    h.extra.egress = { country: "EG", captured_at: "2026-01-01T00:00:00.000Z", method: "trace" };
    const record = await h.run();
    const catalog = must(h.catalogs.at(-1));
    expect(catalog.discovery_run_id).toBe("run-us4");
    expect(catalog.discovery_egress?.country).toBe("EG");
    expect(record.egress?.country).toBe("EG");
  });

  it("refuses, as a permanent failure, to overwrite a catalog that offline commands amended", async () => {
    const first = harness({});
    await first.run();
    const onDisk = amendedOnDisk(must(first.catalogs.at(-1)));
    const h = harness({});
    h.extra.readCatalog = () => onDisk;
    const failure = await h.run().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PermanentFailure);
    expect(String((failure as Error).message)).toMatch(
      /catalog write refused for run run-us4: it carries 1 offline amendment\(s\) \(explain-blocked\)/,
    );
    expect(h.catalogs).toEqual([]);
  });

  it("refuses a catalog written by another run, and one with approved exceptions", async () => {
    const first = harness({});
    await first.run();
    const base = must(first.catalogs.at(-1));
    for (const onDisk of [
      { ...base, discovery_run_id: "travis-old" },
      { ...base, approved_exceptions: [{ gate: "parcel", reason: "synthetic" }] },
    ]) {
      const h = harness({});
      h.extra.readCatalog = () => onDisk;
      await expect(h.run()).rejects.toBeInstanceOf(PermanentFailure);
      expect(h.catalogs).toEqual([]);
    }
  });

  it("uses the host's terminal error when the IO supplies one (Restate TerminalError)", async () => {
    class Terminal extends Error {}
    const first = harness({});
    await first.run();
    const onDisk = amendedOnDisk(must(first.catalogs.at(-1)));
    const h = harness({});
    h.extra.readCatalog = () => onDisk;
    h.io.fail = (message) => new Terminal(message);
    await expect(h.run()).rejects.toBeInstanceOf(Terminal);
  });

  it("CR-4: a validator crash or hash mismatch is permanent, not retried", async () => {
    const h = harness({});
    h.extra.runValidator = async () => {
      throw new Error("run-validator: vendored validator SHA-256 abc does not match");
    };
    const failure = await h.run().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PermanentFailure);
    expect(String((failure as Error).message)).toMatch(/validator step failed: run-validator/);
  });

  it("CR-4: a schema-invalid catalog (writer throws) is permanent", async () => {
    const h = harness({});
    h.extra.writeCatalog = () => {
      throw new Error("write-catalog: catalog.x contains a quote");
    };
    const failure = await h.run().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PermanentFailure);
    expect(String((failure as Error).message)).toMatch(/catalog write failed \(schema or emit\)/);
  });
});
