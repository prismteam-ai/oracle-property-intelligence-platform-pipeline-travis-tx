// Review findings CR-A-01 (offline): the catalog write guard and amendments (CR-3, OR-M5),
// resolve's run-id rules (CR-3), the egress check (OR-B1), the evidence identity sentence
// (OR-B1), the firewall block (OR-M2), approve-exception and rule 10 (OR-M3), rule 11 and
// the sources.md sections (OR-M5, OR-m7, OR-n2), the coverage renderer and the backfill.
// SYNTHETIC values only, except the committed San Leanna evidence file, which is read as is.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveException,
  parseArgs,
  parcelException,
} from "../travis/discovery/approve-exception.js";
import {
  backfill,
  main as backfillMain,
  PAST_AMENDMENTS,
  venueOf,
} from "../travis/discovery/backfill-amendments.js";
import { withProfile } from "../travis/discovery/explain-blocked.js";
import {
  DEFAULT_REPO_ROOT,
  readEvidenceResponse,
  renderBlockedEvidence,
} from "../travis/discovery/blocked-evidence.js";
import type { Catalog, Jurisdiction, Source } from "../travis/discovery/catalog.schema.js";
import { CatalogSchema } from "../travis/discovery/catalog.schema.js";
import { checkCatalog } from "../travis/discovery/check-catalog.js";
import { firewallBlock } from "../travis/discovery/jurisdiction-explanation.js";
import { main as coverageMain, renderCoverage } from "../travis/discovery/render-coverage.js";
import { renderSourcesMd } from "../travis/discovery/render-sources-md.js";
import { reprobeRefusal } from "../travis/discovery/reprobe-jurisdictions.js";
import {
  main as resolveMain,
  resolutionWriteRefusal,
  runMismatch,
} from "../travis/discovery/resolve.js";
import {
  catalogWriteRefusal,
  readCatalog,
  withAmendment,
  writeCatalog,
} from "../travis/discovery/write-catalog.js";
import {
  catalogEgressReference,
  checkEgress,
  egressRefusal,
  traceCountry,
} from "../travis/lib/egress.js";
import { USER_AGENT, type CaptureReceipt } from "../travis/lib/source-client.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const SAN_LEANNA = "docs/evidence/blocked/jurisdiction-san_leanna-20261020T085313Z.md";
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "review-a01-"));
  tmpDirs.push(root);
  return root;
}

/** A synthetic catalog whose parcel block carries a reconciliation (roll 1010, GIS 1000). */
function reconciled(): Catalog {
  const c = syntheticCatalog();
  const p = must(c.parcel);
  c.parcel = {
    ...p,
    gap_reconciliation: {
      gap: 10,
      components: [
        { component: "non_land_accounts", count: 4, reason: "synthetic" },
        { component: "condo_accounts_without_export_point", count: 3, reason: "synthetic" },
        { component: "inventory_accounts_without_export_point", count: 1, reason: "synthetic" },
      ],
      explained: 8,
      residual: 2,
      residual_pct_of_roll: 0.2,
      method: "count-level",
      residual_note: "synthetic",
    },
  };
  return c;
}

describe("CR-3: catalogWriteRefusal and amendments", () => {
  const next = (over: Partial<Catalog> = {}): Catalog => ({
    ...syntheticCatalog(),
    discovery_run_id: "run-a",
    snapshot_time: "2026-02-01T00:00:00Z",
    ...over,
  });

  it("allows a first write and a later round of the same run", () => {
    expect(catalogWriteRefusal(null, next())).toBeNull();
    expect(catalogWriteRefusal(next({ snapshot_time: "2026-01-31T00:00:00Z" }), next())).toBeNull();
  });

  it("refuses amendments, approved exceptions, another run and a newer change", () => {
    const amended = withAmendment(
      next(),
      { command: "rescan-tcad", venue: "operator", fields: ["parcel.identifier_name"], ref: "r" },
      new Date("2026-01-15T00:00:00Z"),
    );
    expect(catalogWriteRefusal(amended, next())).toMatch(
      /1 offline amendment\(s\) \(rescan-tcad\)/,
    );
    expect(
      catalogWriteRefusal(next({ approved_exceptions: [{ gate: "parcel", reason: "x" }] }), next()),
    ).toMatch(/approved_exceptions/);
    expect(catalogWriteRefusal(next({ discovery_run_id: "travis" }), next())).toMatch(
      /written by run travis/,
    );
    expect(catalogWriteRefusal(next({ snapshot_time: "2026-03-01T00:00:00Z" }), next())).toMatch(
      /after this snapshot/,
    );
  });

  it("withAmendment stamps the time and keeps earlier entries; the schema accepts it", () => {
    const one = withAmendment(
      next(),
      { command: "a", venue: "operator", fields: ["x"], ref: "r" },
      new Date(0),
    );
    const two = withAmendment(
      one,
      { command: "b", venue: "operator", fields: ["y"], ref: "r", egress_country: "EG" },
      new Date(1000),
    );
    expect(two.amendments?.map((a) => [a.command, a.at])).toEqual([
      ["a", "1970-01-01T00:00:00.000Z"],
      ["b", "1970-01-01T00:00:01.000Z"],
    ]);
    expect(CatalogSchema.safeParse(two).success).toBe(true);
  });
});

describe("CR-3: resolve refuses a run that did not write the catalog", () => {
  const offline = (catalog: Catalog | null, egressOk = true) => {
    const posted: string[] = [];
    let egressCalls = 0;
    return {
      posted,
      egressCalls: () => egressCalls,
      deps: {
        readCatalog: () => catalog,
        egress: async () => {
          egressCalls += 1;
          return egressOk
            ? { ok: true as const, egress: { country: "EG", captured_at: "x", method: "m" } }
            : { ok: false as const, reason: "egress country is GB, but the run recorded EG" };
        },
        fetch: async (url: string) => {
          posted.push(url);
          if (url.endsWith("/status")) return Response.json({ egress: { country: "EG" } });
          return Response.json({ accepted: true, promise: "resolve:bbb:1" });
        },
        out: () => {},
      },
    };
  };

  it("runMismatch: none for the writer, a reason for another run or an unknown writer", () => {
    const c = { ...syntheticCatalog(), discovery_run_id: "travis-2" };
    expect(runMismatch(c, "travis-2")).toBeNull();
    expect(runMismatch(c, "travis")).toMatch(/run travis did not write the committed catalog/);
    expect(runMismatch(syntheticCatalog(), "travis-2")).toMatch(/records no discovery_run_id/);
    expect(runMismatch(null, "x")).toBeNull();
  });

  it("exit 2 without a run id, and for a superseded run; nothing sent", async () => {
    const c = { ...syntheticCatalog(), discovery_run_id: "travis-2" };
    const a = offline(c);
    expect(await resolveMain(["bbb", "still-blocked"], { ...a.deps, env: {} })).toBe(2);
    expect(
      await resolveMain(["bbb", "still-blocked"], {
        ...a.deps,
        env: { TRAVIS_DISCOVERY_RUN_ID: "travis" },
      }),
    ).toBe(2);
    expect(a.posted).toEqual([]);
  });

  it("OR-B1: `captured` checks the egress against the run's; a mismatch sends nothing", async () => {
    const c = { ...syntheticCatalog(), discovery_run_id: "travis-2" };
    const env = { TRAVIS_DISCOVERY_RUN_ID: "travis-2" };
    const bad = offline(c, false);
    expect(await resolveMain(["bbb", "captured"], { ...bad.deps, env })).toBe(2);
    expect(bad.posted.some((u) => u.endsWith("/resolve"))).toBe(false);
    const good = offline(c);
    expect(await resolveMain(["bbb", "captured"], { ...good.deps, env })).toBe(0);
    expect(good.egressCalls()).toBe(1);
    const still = offline(c);
    expect(await resolveMain(["bbb", "still-blocked"], { ...still.deps, env })).toBe(0);
    expect(still.egressCalls()).toBe(0);
  });

  it("CR2-1 / OR-N5: refuses (exit 2, nothing sent) when the workflow could not write the result", async () => {
    const env = { TRAVIS_DISCOVERY_RUN_ID: "travis-2" };
    const base = { ...syntheticCatalog(), discovery_run_id: "travis-2" };
    const amended = withAmendment(
      base,
      { command: "rescan-tcad", venue: "operator", fields: ["parcel.identifier_name"], ref: "r" },
      new Date("2026-01-15T00:00:00Z"),
    );
    const excepted: Catalog = { ...base, approved_exceptions: [{ gate: "parcel", reason: "x" }] };
    expect(resolutionWriteRefusal(amended, new Date())).toMatch(/offline amendment/);
    expect(resolutionWriteRefusal(base, new Date())).toBeNull();
    expect(resolutionWriteRefusal(null, new Date())).toBeNull();
    for (const catalog of [amended, excepted]) {
      for (const outcome of ["captured", "still-blocked"]) {
        const lines: string[] = [];
        const run = offline(catalog);
        const code = await resolveMain(["bbb", outcome], {
          ...run.deps,
          env,
          out: (l: string) => lines.push(l),
        });
        expect(code).toBe(2);
        expect(run.posted).toEqual([]);
        expect(run.egressCalls()).toBe(0);
        expect(lines.join("\n")).toMatch(/refused: catalog write refused .*nothing sent/);
      }
    }
  });
});

describe("OR-B1: the egress check", () => {
  it("reads only loc from the trace (the ip line is never returned)", () => {
    expect(traceCountry("fl=1\nh=www.cloudflare.com\nip=203.0.113.9\nloc=EG\ncolo=CAI\n")).toBe(
      "EG",
    );
    expect(traceCountry("ip=203.0.113.9\n")).toBeNull();
  });

  it("refuses a mismatch with ORACLE_EXPECT_EGRESS or the run's egress, and a missing reference", () => {
    expect(egressRefusal("EG", null, "EG", true)).toBeNull();
    expect(egressRefusal("GB", null, "EG", false)).toMatch(/ORACLE_EXPECT_EGRESS is EG/);
    expect(egressRefusal("GB", "EG", undefined, false)).toMatch(/the run recorded EG/);
    expect(egressRefusal("EG", null, undefined, true)).toMatch(/set ORACLE_EXPECT_EGRESS/);
    expect(egressRefusal("EG", null, undefined, false)).toBeNull();
    expect(egressRefusal("EG", null, "egypt", false)).toMatch(/two-letter/);
  });

  it("checkEgress sends one identified trace request and never returns the IP", async () => {
    const seen: Array<{ url: string; ua: string | null }> = [];
    const check = await checkEgress({
      fetch: async (url, init) => {
        seen.push({ url, ua: new Headers(init.headers).get("user-agent") });
        return new Response("ip=203.0.113.9\nloc=EG\n");
      },
      env: {},
      reference: "EG",
      requireReference: true,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(check.ok).toBe(true);
    expect(JSON.stringify(check)).not.toContain("203.0.113.9");
    expect(seen).toEqual([{ url: "https://www.cloudflare.com/cdn-cgi/trace", ua: USER_AGENT }]);
    const failed = await checkEgress({
      fetch: async () => {
        throw new Error("offline");
      },
      env: {},
      reference: null,
      requireReference: false,
    });
    expect(failed).toMatchObject({ ok: false });
  });

  it("CR2-3 / OR-N2: the reference is the newest operator amendment's egress, else the run's", () => {
    const c = syntheticCatalog();
    expect(catalogEgressReference(c)).toBeNull();
    const operator = withAmendment(
      c,
      { command: "x", venue: "operator", fields: ["y"], ref: "r", egress_country: "EG" },
      new Date(0),
    );
    expect(catalogEgressReference(operator)).toBe("EG");
    // a newer amendment from the US CI runner is never the operator's reference
    const runner = withAmendment(
      operator,
      {
        command: "record-gis-runner",
        venue: "runner",
        fields: ["y"],
        ref: "r",
        egress_country: "US",
      },
      new Date(1000),
    );
    expect(catalogEgressReference(runner)).toBe("EG");
    const run = { country: "GB", captured_at: "2026-01-01T00:00:00Z", method: "m" };
    // a runner-only (or venue-less) history falls back to the run's own egress, else none
    const runnerOnly = withAmendment(
      c,
      {
        command: "record-gis-runner",
        venue: "runner",
        fields: ["y"],
        ref: "r",
        egress_country: "US",
      },
      new Date(0),
    );
    expect(catalogEgressReference(runnerOnly)).toBeNull();
    expect(catalogEgressReference({ ...runnerOnly, discovery_egress: run })).toBe("GB");
    expect(
      catalogEgressReference({
        discovery_egress: run,
        amendments: [{ egress_country: "US" }],
      }),
    ).toBe("GB");
    // an operator amendment after the run is the newer operator reference
    expect(catalogEgressReference({ ...runner, discovery_egress: run })).toBe("EG");
  });

  it("CR2-3: backfill-amendments --venue stamps runner on record-gis-runner, operator elsewhere, once", () => {
    const root = tmpRoot();
    const catalogPath = join(root, "travis-sources.yaml");
    const base = syntheticCatalog();
    writeCatalog(
      {
        ...base,
        amendments: [
          { command: "rescan-tcad", at: "2026-01-01T00:00:00Z", fields: ["a"], ref: "r" },
          {
            command: "record-gis-runner",
            at: "2026-01-02T00:00:00Z",
            fields: ["b"],
            ref: "r",
            egress_country: "US",
          },
        ],
      },
      catalogPath,
    );
    const lines: string[] = [];
    const opts = {
      venue: true,
      catalogPath,
      now: () => new Date("2026-01-03T00:00:00Z"),
      out: (l: string) => lines.push(l),
    };
    expect(backfillMain(opts)).toBe(0);
    const after = readCatalog(catalogPath);
    expect(after.amendments?.map((a) => [a.command, a.venue])).toEqual([
      ["rescan-tcad", "operator"],
      ["record-gis-runner", "runner"],
      ["backfill-amendments --venue", "operator"],
    ]);
    expect(catalogEgressReference(after)).toBeNull();
    expect(backfillMain(opts)).toBe(2);
    expect(lines.at(-1)).toMatch(/already records its venue/);
    expect(PAST_AMENDMENTS.every((a) => a.venue === venueOf(a.command))).toBe(true);
  });
});

describe("OR-B1: the evidence identity sentence is written only when true", () => {
  const receipt: CaptureReceipt = {
    url: "https://example.test/x",
    method: "GET",
    status: 403,
    bytes: 0,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    captured_at: "2026-01-01T00:00:00.000Z",
    user_agent: USER_AGENT,
    attempts: 1,
    outcome: "blocked",
    geo_signal: "none",
    app_token_used: false,
    timeout_ms: null,
    blocked_reason: "http-403",
    rate_limits_observed: null,
  };
  const path = "docs/evidence/blocked/source-x-20260101T000000Z.md";

  it("workflow / checked command: the sentence and the egress country", () => {
    const text = renderBlockedEvidence({
      path,
      subject: { kind: "source", key: "bbb" },
      receipt,
      egressCountry: "EG",
    });
    expect(text).toMatch(/No retry with a changed identity was made/);
    expect(text).toMatch(/\negress_country: EG\n/);
  });

  it("operator retest: never the no-retry sentence", () => {
    const text = renderBlockedEvidence({
      path,
      subject: { kind: "source", key: "bbb" },
      receipt,
      identity: "operator-retest",
    });
    expect(text).not.toMatch(/No retry with a changed identity was made/);
    expect(text).toMatch(/operator retest outside the discovery workflow/);
  });
});

describe("OR-M2: San Leanna's committed HTTP 406 body is a firewall block", () => {
  const saved = must(readEvidenceResponse(DEFAULT_REPO_ROOT, SAN_LEANNA));

  it("reads the saved response of the evidence file exactly", () => {
    expect(saved.status).toBe(406);
    expect(saved.headers["server"]).toBe("Apache");
    expect(saved.body).toMatch(/^<html><head><title>Error 406 - Not Acceptable<\/title>/);
    expect(Buffer.byteLength(saved.body)).toBe(300);
    expect(firewallBlock(saved)).toBe("the site's web application firewall (Mod Security)");
  });

  it("reprobe-jurisdictions refuses the row before any request", () => {
    const row: Jurisdiction = {
      jurisdiction: "San Leanna",
      key: "san_leanna",
      spec_class: "records request",
      status: "blocked",
      historical_records: false,
      evidence_url: "https://example.test/packet.pdf",
      evidence_captured_at: "2026-01-01T00:00:00Z",
      blocked_evidence: {
        http_status: 406,
        captured_at: "2026-01-01T00:00:00Z",
        url: "https://example.test/packet.pdf",
        evidence_path: SAN_LEANNA,
        body_sha256: "8970d3ea6059606600e849b7d48adcae7d56b01a70cc5fa34b558cab199eb021",
        attempts: 1,
        user_agent: USER_AGENT,
        outcome: "failed",
        geo_signal: "none",
      },
    };
    expect(reprobeRefusal(row, null, 1, saved)).toMatch(
      /blocked by the site's web application firewall \(Mod Security\) \(HTTP 406\); it is never requested again/,
    );
    expect(reprobeRefusal(row, null, 1, null)).toBeNull();
  });
});

describe("OR-M3: approve-exception and check-catalog rule 10", () => {
  const approval = {
    gate: "parcel",
    approved_by: "Synthetic PO",
    approved_at: "2026-01-02",
    decision_ref: "docs/decisions/DEC-synthetic.md",
    gap_pct: 0.99,
    gis: 1000,
    assessed: 1010,
  } as const;

  it("generates the entry from the reconciliation, bound to the approved values", () => {
    const e = parcelException(reconciled(), approval);
    expect(e).toMatchObject({
      gate: "parcel",
      approved_by: "Synthetic PO",
      approved_gap_pct: 0.99,
      approved_gis_count: 1000,
      approved_assessed_count: 1010,
      decision_ref: "docs/decisions/DEC-synthetic.md",
    });
    expect(e.reason).toMatch(/state-code reading, unverified/);
    expect(e.reason).toMatch(/no export geometry point/);
    expect(e.reason).not.toContain('"');
    expect(must(e.coverage_effect)).toMatch(/stays the denominator/);
  });

  it("refuses values that differ from the catalog, and a missing reconciliation", () => {
    expect(() => parcelException(reconciled(), { ...approval, gis: 999 })).toThrow(/--gis 999/);
    expect(() => parcelException(reconciled(), { ...approval, gap_pct: 5 })).toThrow(/--gap-pct/);
    expect(() => parcelException(syntheticCatalog(), approval)).toThrow(/reconcile-parcel-gap/);
  });

  it("the command writes the entry and an amendment, replacing an older entry", async () => {
    const root = tmpRoot();
    const catalogPath = join(root, "pipeline/docs/travis-sources.yaml");
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeCatalog(
      { ...reconciled(), approved_exceptions: [{ gate: "parcel", reason: "hand-written" }] },
      catalogPath,
    );
    mkdirSync(join(root, "docs/decisions"), { recursive: true });
    writeFileSync(join(root, approval.decision_ref), "# synthetic\n");
    const code = await approveException(approval, {
      repoRoot: root,
      catalogPath,
      validate: async () => 0,
      out: () => {},
      now: () => new Date("2026-01-03T00:00:00Z"),
    });
    expect(code).toBe(0);
    const c = readCatalog(catalogPath);
    expect(c.approved_exceptions).toHaveLength(1);
    expect(must(c.approved_exceptions?.[0]).reason).not.toBe("hand-written");
    expect(must(c.amendments?.at(-1))).toMatchObject({
      command: "approve-exception",
      at: "2026-01-03T00:00:00.000Z",
      ref: approval.decision_ref,
    });
    // a missing decision record or an unknown flag is refused
    expect(
      await approveException(
        { ...approval, decision_ref: "docs/decisions/none.md" },
        {
          repoRoot: root,
          catalogPath,
          validate: async () => 0,
          out: () => {},
        },
      ),
    ).toBe(2);
    expect(parseArgs(["--gate", "parcel", "--bogus", "x"])).toMatchObject({ __invalid: "--bogus" });
  });

  it("rule 10 fails when the catalog no longer carries the approved values", () => {
    const c = reconciled();
    const ok = { ...c, approved_exceptions: [parcelException(c, approval)] };
    expect(checkCatalog(ok).filter((l) => l.startsWith("FAIL rule 10"))).toEqual([]);
    const p = must(ok.parcel);
    const moved = {
      ...ok,
      parcel: {
        ...p,
        gis_feature_count: 500,
        gis_feature_count_measurement: { ...p.gis_feature_count_measurement, value: 500 },
        gap_pct: 50.495,
      },
    };
    const lines = checkCatalog(moved).filter((l) => l.startsWith("FAIL rule 10"));
    expect(lines.join("\n")).toMatch(/gis_feature_count 500 differs from approved_gis_count 1000/);
    expect(lines.join("\n")).toMatch(/gap_pct 50.495 differs from approved_gap_pct 0.99/);
    const bare = { ...c, approved_exceptions: [{ gate: "parcel", reason: "hand-written" }] };
    expect(checkCatalog(bare).filter((l) => l.startsWith("FAIL rule 10")).length).toBeGreaterThan(
      3,
    );
  });
});

describe("OR-M5: rule 11 and the sources.md sections", () => {
  const gisRow = (
    status: "available" | "blocked",
    field: "blocked_evidence" | "operator_blocked_evidence",
  ): Source => ({
    key: "tcad_gis",
    url: "https://example.test/gis",
    status,
    denominator: {
      value: 1000,
      source_url: "https://example.test/gis/query",
      captured_at: "2026-01-02T00:00:00Z",
      captured_via: "synthetic US runner",
    },
    decision: "ingest",
    decision_reason: "synthetic",
    captured_at: "2026-01-02T00:00:00Z",
    [field]: {
      timeout_ms: 60000,
      captured_at: "2026-01-01T00:00:00Z",
      url: "https://example.test/gis/query",
      evidence_path: "docs/evidence/blocked/tcad_gis-synthetic.md",
      body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      attempts: 1,
      user_agent: USER_AGENT,
      outcome: "blocked",
      geo_signal: "suspected",
    },
  });
  const withGis = (row: Source): Catalog => {
    const c = syntheticCatalog();
    return { ...c, sources: [...c.sources.filter((s) => s.key !== "tcad_gis"), row] };
  };

  it("rule 11: an available source never carries blocked_evidence", () => {
    const bad = checkCatalog(withGis(gisRow("available", "blocked_evidence")));
    expect(bad.join("\n")).toMatch(
      /FAIL rule 11: tcad_gis is available but carries blocked_evidence/,
    );
    const good = checkCatalog(withGis(gisRow("available", "operator_blocked_evidence")));
    expect(good.filter((l) => l.startsWith("FAIL rule 11"))).toEqual([]);
  });

  it("sources.md lists it as an operator-side block, never as blocked", () => {
    const md = renderSourcesMd(withGis(gisRow("available", "operator_blocked_evidence")));
    const blocked = md.slice(md.indexOf("## Blocked sources"), md.indexOf("Operator-side blocks"));
    expect(blocked).not.toMatch(/tcad_gis/);
    expect(md).toMatch(
      /\| `tcad_gis` \| available \| operator egress blocked; captured via US runner \| timeout after 60,000 ms; geo signal: suspected \| captured via synthetic US runner \|/,
    );
  });

  it("renders the run id, seed gating, approved exceptions and amendments", () => {
    const c = reconciled();
    const approved = {
      ...c,
      discovery_run_id: "run-a",
      approved_exceptions: [
        parcelException(c, {
          gate: "parcel",
          approved_by: "Synthetic PO",
          approved_at: "2026-01-02",
          decision_ref: "docs/decisions/DEC-synthetic.md",
          gap_pct: 0.99,
          gis: 1000,
          assessed: 1010,
        }),
      ],
    };
    const md = renderSourcesMd(
      withAmendment(
        approved,
        {
          command: "approve-exception",
          venue: "operator",
          fields: ["approved_exceptions[parcel]"],
          ref: "docs/decisions/DEC-synthetic.md",
        },
        new Date("2026-01-03T00:00:00Z"),
      ),
    );
    expect(md).toMatch(/Time the discovery run `run-a` spent waiting for a human/);
    expect(md).toMatch(/the kit's auto-advance on PASS is overridden; seed is A-04 behind G4–G7/);
    // T066: the resolve wording matches T056 (never `captured` after a 403, challenge or WAF block).
    expect(md).toMatch(
      /still-blocked` after a 403, challenge or WAF block \(such a source is never re-probed\)/,
    );
    expect(md).not.toMatch(/captured\|still-blocked/);
    expect(md).toMatch(
      /## Approved exceptions\n\n### Gate `parcel`\n\nThe readiness validator reports the parcel gate as \*\*PASS because of this exception\*\*; the raw gap stays 0.99%/,
    );
    expect(md).toMatch(/\| GIS features \(gis_feature_count\) \| 1,000 \| https?:\/\//);
    // ERR-5 (FR-007a, A-01-TC-022 step 5): no numeric table row without a URL and a UTC time.
    const bare = md
      .split("\n")
      .filter((l) => /\| *[0-9][0-9,]* *\|/.test(l))
      .filter((l) => !/https?:\/\/.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z/.test(l));
    expect(bare).toEqual([]);
    expect(md).toMatch(/## Amendments\n\n.*\n\n\| At \(UTC\) \| Command \|/);
    expect(md).toMatch(
      /\| 2026-01-03T00:00:00Z \| `approve-exception` \| approved_exceptions\[parcel\] \|/,
    );
    expect(renderSourcesMd(syntheticCatalog())).toMatch(
      /No offline command has changed the catalog/,
    );
  });
});

describe("OR-M5: the coverage renderer and the one-off backfill", () => {
  it("renders every denominator from the catalog, a null with its reason", () => {
    const md = renderCoverage(syntheticCatalog());
    expect(md).toMatch(/^---\nid: EV-A-01-coverage\nparent: A-01\n/);
    expect(md).toMatch(/Do not edit by hand/);
    expect(md).toMatch(
      /\| Source \| Denominator \| Denominator source \| Captured \(UTC\) \| Published \| Coverage \|/,
    );
    expect(md).not.toMatch(/GIS service not reached/);
    expect(renderCoverage(syntheticCatalog())).toBe(md); // deterministic
  });

  it("records the history once, sets the run id and moves the GIS stop; refuses a second run", () => {
    const c = syntheticCatalog();
    const gis: Source = { ...must(c.sources[0]), key: "tcad_gis" };
    const withStop: Catalog = {
      ...c,
      sources: [...c.sources.filter((s) => s.key !== "tcad_gis"), gis].map((s) =>
        s.key === "tcad_gis"
          ? {
              ...gis,
              status: "available",
              blocked_evidence: {
                timeout_ms: 60000,
                captured_at: "2026-01-01T00:00:00Z",
                url: "https://example.test/gis",
                evidence_path: "docs/evidence/blocked/tcad_gis-x.md",
                body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                attempts: 1,
                user_agent: USER_AGENT,
                outcome: "blocked",
                geo_signal: "none",
              },
            }
          : s,
      ),
    };
    const out = backfill(withStop);
    expect(out.discovery_run_id).toBe("travis-2");
    expect(Object.keys(out).slice(0, 7)).toEqual([
      "county",
      "state",
      "slug",
      "fips",
      "snapshot_time",
      "discovery_run_id",
      "waiting_human_hours",
    ]);
    expect(out.amendments?.map((a) => a.command)).toEqual(PAST_AMENDMENTS.map((a) => a.command));
    const row = must(out.sources.find((s) => s.key === "tcad_gis"));
    expect(row.blocked_evidence).toBeUndefined();
    expect(row.operator_blocked_evidence?.evidence_path).toBe(
      "docs/evidence/blocked/tcad_gis-x.md",
    );
    expect(CatalogSchema.safeParse(out).success).toBe(true);
    expect(() => backfill(out)).toThrow(/runs once only/);
  });

  it("the past amendments are in time order", () => {
    const times = PAST_AMENDMENTS.map((a) => Date.parse(a.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("the committed San Leanna evidence file is untouched by these commands", () => {
  it("still says outcome failed, as recorded", () => {
    expect(readFileSync(join(DEFAULT_REPO_ROOT, SAN_LEANNA), "utf8")).toMatch(
      /\noutcome: failed\n/,
    );
  });
});

describe("CLI entry points of the new offline commands (temp catalogs only)", () => {
  function tempCatalog(c: Catalog): { root: string; catalogPath: string } {
    const root = tmpRoot();
    const catalogPath = join(root, "pipeline/docs/travis-sources.yaml");
    mkdirSync(dirname(catalogPath), { recursive: true });
    writeCatalog(c, catalogPath);
    return { root, catalogPath };
  }

  it("backfill-amendments writes once, then refuses with exit 2", () => {
    const f = tempCatalog(syntheticCatalog());
    const lines: string[] = [];
    const now = () => new Date("2026-01-05T00:00:00Z");
    expect(backfillMain({ catalogPath: f.catalogPath, now, out: (l) => lines.push(l) })).toBe(0);
    const c = readCatalog(f.catalogPath);
    expect(must(c.amendments?.at(-1)).command).toBe("backfill-amendments");
    expect(c.amendments).toHaveLength(PAST_AMENDMENTS.length + 1);
    expect(backfillMain({ catalogPath: f.catalogPath, now, out: (l) => lines.push(l) })).toBe(2);
    expect(lines.at(-1)).toMatch(/refused: the catalog already carries amendments/);
  });

  it("render-coverage writes docs/evidence/A-01-coverage.md under the repo root", () => {
    const f = tempCatalog(syntheticCatalog());
    const lines: string[] = [];
    expect(
      coverageMain({ repoRoot: f.root, catalogPath: f.catalogPath, out: (l) => lines.push(l) }),
    ).toBe(0);
    const md = readFileSync(join(f.root, "docs/evidence/A-01-coverage.md"), "utf8");
    expect(md).toBe(renderCoverage(syntheticCatalog()));
    expect(
      coverageMain({ repoRoot: f.root, catalogPath: join(f.root, "none.yaml"), out: () => {} }),
    ).toBe(1);
  });

  it("explain-blocked re-reads a row's notes and records request from the profile", () => {
    const row: Jurisdiction = {
      jurisdiction: "Synthetic",
      key: "synthetic",
      spec_class: "records request",
      status: "blocked",
      historical_records: false,
      evidence_url: "https://example.test/p",
      evidence_captured_at: "2026-01-01T00:00:00Z",
      notes: "evidence page blocked at the live run (x); classified. Profile: old profile text",
    };
    const entry = {
      key: "synthetic",
      jurisdiction: "Synthetic",
      census_placefp: "00001",
      spec_class: "records request" as const,
      case: "custodian-only" as const,
      evidence_url: "https://example.test/p",
      notes: "new profile text",
      records_request: {
        recipient_office: "Synthetic office",
        system_scope: "synthetic",
        route: "records-first" as const,
        request_portal_url: "https://example.test/r",
        channel_verified: false,
      },
    };
    const out = withProfile(row, entry);
    expect(out.notes).toBe(
      "evidence page blocked at the live run (x); classified. Profile: new profile text",
    );
    expect(out.records_request?.channel_verified).toBe(false);
    const plain = withProfile({ ...row, notes: "old profile text" }, entry);
    expect(plain.notes).toBe("new profile text");
  });
});
