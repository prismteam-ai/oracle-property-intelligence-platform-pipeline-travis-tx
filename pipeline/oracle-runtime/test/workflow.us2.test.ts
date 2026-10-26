// Supporting tests for T032: the jurisdiction steps of the workflow. Synthetic responses and a
// synthetic profile only (test-only); an injected fetch answers every host.
import { describe, expect, it } from "vitest";
import { USER_AGENT, createSourceClient, type FetchLike } from "../travis/lib/source-client.js";
import { CatalogSchema } from "../travis/discovery/catalog.schema.js";
import { checkCatalog } from "../travis/discovery/check-catalog.js";
import type { LocatedElsewhere } from "../travis/discovery/probes/socrata.js";
import type { JurisdictionProfileEntry } from "../travis/profiles/jurisdictions.js";
import {
  createJurisdictionProbes,
  runJurisdictionDiscovery,
  withJurisdictions,
  type DiscoveryIO,
  type RunRecord,
} from "../travis/discovery/workflow.js";
import { fakeHttp, silent, text, type Route } from "./fixtures/fake-http.js";
import { syntheticUs1Catalog } from "./fixtures/synthetic-us1-catalog.js";
import { must } from "./helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");
const CENSUS_URL = "https://census.test/place_by_county.txt";
const HEADER = "STATE|STATEFP|COUNTYFP|COUNTYNAME|PLACEFP|PLACENS|PLACENAME|TYPE|CLASSFP|FUNCSTAT";
const CENSUS_TWO = [
  HEADER,
  "TX|48|453|Travis County|00001|00000001|Alpha city|INCORPORATED PLACE|C1|A",
  "TX|48|453|Travis County|00002|00000002|Beta village|INCORPORATED PLACE|C1|A",
  "TX|48|453|Travis County|00009|00000009|Gamma CDP|CENSUS DESIGNATED PLACE|U1|S",
].join("\n");
const CENSUS_THREE = `${CENSUS_TWO}\nTX|48|453|Travis County|00003|00000003|Delta city|INCORPORATED PLACE|C1|A`;

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
    key: "beta",
    jurisdiction: "Beta",
    census_placefp: "00002",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: "application-intake",
    portal: "https://beta.test/apply",
    evidence_url: "https://beta.test/permits",
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

const LOCATED: LocatedElsewhere[] = [
  {
    jurisdiction: "BETA FULL PURPOSE",
    value: 7,
    source_url: "https://austin.test/g",
    captured_at: "2026-01-01T00:00:00.000Z",
  },
  {
    jurisdiction: "BETA ETJ",
    value: 2,
    source_url: "https://austin.test/g",
    captured_at: "2026-01-01T00:00:00.000Z",
  },
];

interface Scenario {
  census?: string;
  censusBlocked?: boolean;
  betaBlocked?: boolean;
}

function routes(s: Scenario): Route[] {
  return [
    {
      match: (u) => u.host === "census.test",
      respond: () =>
        s.censusBlocked
          ? text("Forbidden", 403)
          : text(s.census ?? CENSUS_TWO, 200, { "content-type": "text/plain" }),
    },
    {
      match: (u) => u.host === "beta.test",
      respond: () =>
        s.betaBlocked ? text("Forbidden", 403) : text("<html>synthetic permits page</html>"),
    },
    { match: () => true, respond: () => text("<html>synthetic evidence page</html>") },
  ];
}

function setup(s: Scenario = {}) {
  const { fetch, calls } = fakeHttp(routes(s));
  const client = createSourceClient({
    fetch: fetch as FetchLike,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
  const journal: string[] = [];
  const io: DiscoveryIO = {
    now: async () => FIXED,
    run: async (name, fn) => {
      journal.push(name);
      return fn();
    },
    save: () => undefined,
  };
  const record: RunRecord = {
    run_id: "run-us2",
    started_at: FIXED.toISOString(),
    state: "DISCOVERING",
    blockers: [],
    steps: [],
    validator: null,
    waiting_human_hours: 0,
    resolutions: [],
    waiting_since: null,
    completed_at: null,
    auto_advance_to_seed: false,
  };
  const probes = createJurisdictionProbes({ client, now: () => FIXED }, { censusUrl: CENSUS_URL });
  return { io, record, probes, journal, calls };
}

/** The synthetic full catalog with the produced permits/census and Austin's located list. */
function catalogWith(blocks: Awaited<ReturnType<typeof runJurisdictionDiscovery>>) {
  const base = syntheticUs1Catalog();
  const austin = must(base.sources.find((x) => x.key === "austin_permits"));
  austin.located_in_other_jurisdictions = LOCATED;
  const { permits: _permits, census_reference: _census, ...rest } = base;
  return withJurisdictions(rest, blocks);
}

describe("jurisdiction steps", () => {
  it("builds one classified row per Census place + unincorporated, with dated evidence", async () => {
    const { io, record, probes, journal } = setup();
    const blocks = await runJurisdictionDiscovery(io, record, probes, PROFILE, LOCATED);

    expect(must(blocks.census_reference).place_count).toBe(2);
    expect(blocks.profile_mismatch).toEqual({ missing: [], extra: [] });
    const permits = blocks.permits;
    expect(permits.assumes_unified_countywide_history).toBe(false);
    expect(permits.expected_jurisdiction_count).toBe(3);
    expect(permits.jurisdictions.map((j) => j.key)).toEqual([
      "alpha",
      "beta",
      "synthetic_unincorporated",
    ]);
    expect(permits.jurisdictions.map((j) => j.status)).toEqual([
      "supported",
      "manual-only",
      "custodian-only",
    ]);
    for (const j of permits.jurisdictions) {
      expect(j.evidence_captured_at).toBe("2026-01-01T00:00:00.000Z");
      expect(j.evidence_http_status).toBe(200);
    }
    expect(permits.jurisdictions[0]?.historical_records).toBe(true);
    expect(permits.jurisdictions[1]?.historical_records).toBe(false);
    expect(permits.jurisdictions[0]?.census_placefp).toBe("00001");

    expect(journal).toEqual([
      "other_jurisdictions:census_places:2026-01-01",
      "other_jurisdictions:evidence_alpha:2026-01-01",
      "other_jurisdictions:evidence_beta:2026-01-01",
      "other_jurisdictions:evidence_synthetic_unincorporated:2026-01-01",
    ]);
    expect(record.steps.map((s) => s.key)).toEqual(journal);
    expect(record.blockers).toEqual([]);
  });

  it("attaches the summed Austin-issued count to the city row without changing its status", async () => {
    const { io, record, probes } = setup();
    const blocks = await runJurisdictionDiscovery(io, record, probes, PROFILE, LOCATED);
    const beta = must(blocks.permits.jurisdictions.find((j) => j.key === "beta"));
    expect(must(beta.austin_issued_located_here).value).toBe(9);
    expect(beta.status).toBe("manual-only");
    expect(beta.spec_class).toBe("records request");
    const alpha = must(blocks.permits.jurisdictions.find((j) => j.key === "alpha"));
    expect(alpha.austin_issued_located_here).toBeUndefined();
  });

  it("the full catalog passes the schema and every checker rule", async () => {
    const { io, record, probes } = setup();
    const blocks = await runJurisdictionDiscovery(io, record, probes, PROFILE, LOCATED);
    const catalog = catalogWith(blocks);
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
    expect(checkCatalog(catalog)).toEqual([]);
  });

  it("a blocked evidence page makes that row blocked with evidence and its records request", async () => {
    const { io, record, probes, calls } = setup({ betaBlocked: true });
    const blocks = await runJurisdictionDiscovery(io, record, probes, PROFILE, LOCATED);
    expect(calls.filter((c) => c.url.startsWith("https://beta.test"))).toHaveLength(1);
    const beta = must(blocks.permits.jurisdictions.find((j) => j.key === "beta"));
    expect(beta.status).toBe("blocked");
    expect(beta.spec_class).toBe("records request");
    expect(beta.historical_records).toBe(false);
    expect(beta.evidence_http_status).toBe(403);
    expect(must(beta.blocked_evidence)).toMatchObject({
      http_status: 403,
      attempts: 1,
      user_agent: USER_AGENT,
      geo_signal: "none",
      outcome: "blocked",
    });
    expect(beta.records_request).toEqual(REQUEST);
    expect(must(beta.notes)).toMatch(/blocked/);
    expect(checkCatalog(catalogWith(blocks))).toEqual([]);
  });

  it("a blocked Census file leaves no reference, records a blocker, and fails rule 6", async () => {
    const { io, record, probes } = setup({ censusBlocked: true });
    const blocks = await runJurisdictionDiscovery(io, record, probes, PROFILE, LOCATED);
    expect(blocks.census_reference).toBeNull();
    expect(record.blockers.map((b) => b.source_key)).toEqual(["other_jurisdictions"]);
    expect(checkCatalog(catalogWith(blocks))).toContain("FAIL rule 6: census_reference missing");
  });

  it("a Census place missing from the profile is reported and fails the count", async () => {
    const { io, record, probes } = setup({ census: CENSUS_THREE });
    const blocks = await runJurisdictionDiscovery(io, record, probes, PROFILE, LOCATED);
    expect(blocks.profile_mismatch).toEqual({ missing: ["00003 Delta city"], extra: [] });
    expect(blocks.permits.expected_jurisdiction_count).toBe(4);
    expect(checkCatalog(catalogWith(blocks))).toContain(
      "FAIL rule 6: jurisdictions 3 != census place_count + 1 (4)",
    );
  });
});
