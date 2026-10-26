// Recording the PO-approved US-runner GIS count (A-01 AC-6, ARD § 8) offline. Every artifact,
// header, workflow, evidence file and catalog value here is synthetic (test-only): a temporary
// repository root holds them, no request is made, and the validator is an injected stand-in.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog, Source } from "../travis/discovery/catalog.schema.js";
import { gisCountUrl, TCAD_GIS_LAYER_URL } from "../travis/discovery/probes/arcgis.js";
import {
  CAPTURED_VIA,
  EVIDENCE_REL,
  gapPct,
  OPERATOR_EVIDENCE_REL,
  PROBE_REPOSITORY_URL,
  recordGisRunner,
  WORKFLOW_REL,
} from "../travis/discovery/record-gis-runner.js";
import { readCatalog, writeCatalog } from "../travis/discovery/write-catalog.js";
import { USER_AGENT } from "../travis/lib/source-client.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const CATALOG_REL = "pipeline/docs/travis-sources.yaml";
const RUN_ID = "123456789";
const ARTIFACT_REL = `pipeline/data/raw/gis/us-runner-${RUN_ID}`;
const OLD_AT = "2026-01-01T00:00:00Z";
const BODY = '{"count":800}';
const SYNTHETIC_COOKIE = "synthetic-session-value-never-copied";

const tmpDirs: string[] = [];

const RECONCILIATION = (gap: number) => ({
  gap,
  components: [{ component: "non_land_accounts", count: gap - 10, reason: "synthetic" }],
  explained: gap - 10,
  residual: 10,
  residual_pct_of_roll: 1,
  method: "count-level",
  residual_note: "synthetic residual",
});

const RECEIPT = {
  url: "https://example.test/export.zip",
  method: "GET" as const,
  status: 200,
  bytes: 10,
  sha256: "a".repeat(64),
  captured_at: "2026-01-01T00:00:00Z",
  user_agent: USER_AGENT,
  attempts: 1,
  outcome: "ok" as const,
  file_path: "pipeline/data/raw/tcad/export.zip",
  seconds: 1,
  megabytes_per_minute: 1,
  roll_year: 2026,
};
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function gisRow(): Source {
  const url = gisCountUrl();
  return {
    key: "tcad_gis",
    url: TCAD_GIS_LAYER_URL,
    status: "blocked",
    denominator: {
      value: null,
      missing_reason: "synthetic: fetch failed",
      source_url: url,
      captured_at: OLD_AT,
      method: "returnCountOnly",
    },
    decision: "ingest",
    decision_reason: "synthetic: count only",
    captured_at: OLD_AT,
    blocked_evidence: {
      error: "fetch failed",
      captured_at: OLD_AT,
      url,
      evidence_path: "docs/evidence/blocked/synthetic-old.md",
      body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      attempts: 1,
      user_agent: USER_AGENT,
      outcome: "failed",
      geo_signal: "none",
    },
  };
}

interface Files {
  egress?: string;
  captured_at?: string;
  result?: string;
  error?: string;
  headers?: string;
  body?: string;
  workflowUrl?: string;
  workflowUa?: string;
}

function fixture(files: Files = {}): { root: string; catalogPath: string; artifact: string } {
  const root = mkdtempSync(join(tmpdir(), "record-gis-runner-"));
  tmpDirs.push(root);

  const cat = syntheticCatalog();
  const {
    separately_assessed_without_geometry: _sep,
    discrepancy_explanation: _exp,
    ...parcel
  } = must(cat.parcel, "parcel");
  cat.parcel = {
    ...parcel,
    assessed_parcel_count: 1000,
    assessed_parcel_count_measurement: {
      ...parcel.assessed_parcel_count_measurement,
      value: 1000,
    },
    gis_feature_count: null,
    gis_feature_count_measurement: {
      value: null,
      missing_reason: "synthetic: fetch failed",
      source_url: gisCountUrl(),
      captured_at: OLD_AT,
      method: "returnCountOnly",
    },
    gap_pct: "unknown",
    gap_reason: "synthetic: GIS count missing",
  };
  cat.sources = [...cat.sources, gisRow()];
  const catalogPath = join(root, CATALOG_REL);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeCatalog(cat, catalogPath);

  const write = (rel: string, text: string): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write(
    WORKFLOW_REL,
    [
      "name: synthetic",
      "jobs:",
      "  probe:",
      "    env:",
      `      URL: "${files.workflowUrl ?? gisCountUrl()}"`,
      `      UA: "${files.workflowUa ?? USER_AGENT}"`,
      "",
    ].join("\n"),
  );
  write(
    OPERATOR_EVIDENCE_REL,
    [
      "---",
      "id: EV-synthetic",
      "parent: A-01",
      "timeout_ms: 60000",
      "captured_at: 2026-01-02T00:00:00Z",
      `url: ${gisCountUrl()}`,
      "attempts: 1",
      `user_agent: ${USER_AGENT}`,
      "outcome: blocked",
      'geo_signal: "synthetic: TCP connect never completes"',
      "body_sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "---",
      "",
      "# synthetic",
      "",
    ].join("\n"),
  );
  const body = files.body ?? BODY;
  write(`${ARTIFACT_REL}/egress.txt`, files.egress ?? "colo=MSP\nloc=US\n");
  write(`${ARTIFACT_REL}/captured_at.txt`, files.captured_at ?? "2026-01-03T04:05:06Z\n");
  write(`${ARTIFACT_REL}/result.txt`, files.result ?? "http=200 time=0.5s\ncurl_exit=0\n");
  write(`${ARTIFACT_REL}/error.txt`, files.error ?? "");
  write(
    `${ARTIFACT_REL}/headers.txt`,
    files.headers ??
      [
        "HTTP/1.1 200 OK",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Content-Type: application/json; charset=UTF-8",
        `Set-Cookie: AWSALB=${SYNTHETIC_COOKIE}; Path=/`,
        "Date: Sat, 03 Jan 2026 04:05:06 GMT",
        "",
        "",
      ].join("\r\n"),
  );
  write(`${ARTIFACT_REL}/body.json`, body);
  return { root, catalogPath, artifact: join(root, ARTIFACT_REL) };
}

async function run(
  f: { root: string; catalogPath: string; artifact: string },
  extra: { artifactDir?: string; runUrl?: string; validatorCode?: number } = {},
) {
  const lines: string[] = [];
  let validatorCalls = 0;
  const code = await recordGisRunner({
    artifactDir: extra.artifactDir ?? f.artifact,
    ...(extra.runUrl ? { runUrl: extra.runUrl } : {}),
    repoRoot: f.root,
    catalogPath: f.catalogPath,
    validate: async () => {
      validatorCalls += 1;
      return extra.validatorCode ?? 1;
    },
    out: (l) => lines.push(l),
  });
  return { code, lines, validatorCalls };
}

const gisOf = (c: Catalog) => must(c.sources.find((s) => s.key === "tcad_gis"));

/** Everything the command may change, removed, so the rest can be compared exactly. */
function untouched(c: Catalog) {
  const {
    gis_feature_count: _a,
    gis_feature_count_measurement: _b,
    gap_pct: _c,
    gap_reason: _d,
    discrepancy_explanation: _e,
    ...parcel
  } = must(c.parcel);
  const { amendments: _f, ...rest } = c;
  return { ...rest, parcel, sources: c.sources.filter((s) => s.key !== "tcad_gis") };
}

describe("recordGisRunner", () => {
  it("records the runner count with provenance, keeps the roll as denominator, writes evidence, re-runs the validator", async () => {
    const f = fixture();
    const before = readCatalog(f.catalogPath);
    const { code, validatorCalls } = await run(f);
    expect(code).toBe(1); // the validator stand-in's BLOCKED is passed through
    expect(validatorCalls).toBe(1);

    const after = readCatalog(f.catalogPath);
    const p = must(after.parcel);
    const expected = {
      value: 800,
      source_url: gisCountUrl(),
      captured_at: "2026-01-03T04:05:06Z",
      method: "returnCountOnly",
      captured_via: CAPTURED_VIA,
      run_url: `${PROBE_REPOSITORY_URL}/actions/runs/${RUN_ID}`,
      egress_country: "US",
    };
    expect(p.gis_feature_count).toBe(800);
    expect(p.gis_feature_count_measurement).toMatchObject(expected);
    expect(p.gis_feature_count_measurement.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.assessed_parcel_count).toBe(1000);
    expect(p.gap_pct).toBe(20);
    expect(p.gap_reason).toMatch(/GIS 800 features vs certified roll 1000/);
    expect(p.gap_reason).toMatch(/gap not yet explained/);
    expect(p.discrepancy_explanation).toMatch(/GIS-only seeding is blocked/);
    expect(p.discrepancy_explanation).toMatch(/GIS is never substituted/);
    // the gap is stated, not explained: the geometry-null policy is not set by this command
    expect(p.separately_assessed_without_geometry).toBeUndefined();

    const row = gisOf(after);
    expect(row.status).toBe("available");
    expect(row.denominator).toEqual(p.gis_feature_count_measurement);
    expect(row.captured_at).toBe("2026-01-03T04:05:06Z");
    expect(row.anti_bot).toMatch(/requests: 1 from US runner/);
    expect(row.decision).toBe("ingest");
    expect(row.decision_reason).toMatch(/US runner/);
    // OR-M5: an available row keeps its operator-side stop apart from blocked_evidence
    expect(row.blocked_evidence).toBeUndefined();
    expect(must(row.operator_blocked_evidence)).toMatchObject({
      timeout_ms: 60000,
      evidence_path: OPERATOR_EVIDENCE_REL,
      outcome: "blocked",
    });

    expect(untouched(after)).toEqual(untouched(before));

    const evidence = readFileSync(join(f.root, EVIDENCE_REL), "utf8");
    expect(evidence).toMatch(/^---\nid: EV-A-01-us-gis-runner\nparent: A-01\n/);
    expect(evidence).toContain(BODY);
    expect(evidence).toContain("loc=US");
    expect(evidence).toContain(`actions/runs/${RUN_ID}`);
    expect(evidence).toContain("`content-type`");
    expect(evidence).not.toMatch(/set-cookie/i);
    expect(evidence).not.toContain(SYNTHETIC_COOKIE);
    expect(readFileSync(f.catalogPath, "utf8")).not.toContain(SYNTHETIC_COOKIE);
  });

  it("CR-9: rounds the gap with computeGap (3 decimals) against the roll", () => {
    expect(gapPct(493246, 373683)).toBe(24.24);
    expect(gapPct(1000, 1000)).toBe(0);
    expect(gapPct(3, 2)).toBe(33.333);
  });

  it("passes the validator's PASS through", async () => {
    const f = fixture();
    expect((await run(f, { validatorCode: 0 })).code).toBe(0);
  });

  it("is idempotent: a second run on the same artifact gives the same catalog (plus one amendment)", async () => {
    const f = fixture();
    await run(f);
    const once = readCatalog(f.catalogPath);
    await run(f);
    const twice = readCatalog(f.catalogPath);
    const { amendments: a1, ...c1 } = once;
    const { amendments: a2, ...c2 } = twice;
    expect(c2).toEqual(c1);
    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(2);
    expect(must(a2?.[1])).toMatchObject({ command: "record-gis-runner", egress_country: "US" });
  });

  it("CR-5: drops a gap_reconciliation made for a different GIS count and says to rerun reconcile-parcel-gap", async () => {
    const f = fixture();
    const cat = readCatalog(f.catalogPath);
    const parcel = must(cat.parcel);
    writeCatalog(
      {
        ...cat,
        parcel: {
          ...parcel,
          separately_assessed_without_geometry: "acknowledged",
          gap_reconciliation: RECONCILIATION(150),
        },
      },
      f.catalogPath,
    );
    const { lines } = await run(f);
    const p = must(readCatalog(f.catalogPath).parcel);
    expect(p.gap_reconciliation).toBeUndefined();
    expect(p.gap_reason).toMatch(/rerun reconcile-parcel-gap/);
    // from the export alone, not from GIS: kept
    expect(p.separately_assessed_without_geometry).toBe("acknowledged");
    expect(lines.join("\n")).toMatch(/earlier reconciliation was dropped/);
    expect(must(readCatalog(f.catalogPath).amendments?.at(-1)).fields).toContain(
      "parcel.gap_reconciliation (dropped: stale)",
    );
  });

  it("CR-5: keeps a gap_reconciliation made for this GIS count and rebuilds the gap texts from it", async () => {
    const f = fixture();
    const cat = readCatalog(f.catalogPath);
    const parcel = must(cat.parcel);
    writeCatalog(
      {
        ...cat,
        parcel: { ...parcel, gap_reconciliation: RECONCILIATION(200), export_receipt: RECEIPT },
      },
      f.catalogPath,
    );
    await run(f);
    const p = must(readCatalog(f.catalogPath).parcel);
    expect(p.gap_reconciliation?.gap).toBe(200);
    expect(p.gap_reason).toMatch(/reconciled by count from the certified export/);
    expect(p.gap_reason).not.toMatch(/not yet explained/);
  });

  const refusals: Array<[string, Files, RegExp]> = [
    ["a non-US egress", { egress: "colo=CAI\nloc=EG\n" }, /not a US runner/],
    ["a non-200 result", { result: "http=403 time=0.5s\ncurl_exit=0\n" }, /not 200/],
    ["a curl failure", { result: "http=000 time=60s\ncurl_exit=28\n" }, /not 200/],
    ["error output", { error: "curl: (28) timed out\n" }, /error\.txt/],
    ["a body that is not a count", { body: '{"error":{"code":400}}' }, /count/],
    ["a negative count", { body: '{"count":-1}' }, /count/],
    ["a non-UTC capture time", { captured_at: "2026-01-03 04:05:06\n" }, /UTC/],
    [
      "a Content-Length that differs from the body",
      { headers: "HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n" },
      /Content-Length/,
    ],
    [
      "a workflow URL that differs from the catalog",
      { workflowUrl: `${TCAD_GIS_LAYER_URL}/query?where=1%3D1&returnCountOnly=true&f=pjson` },
      /URL differs/,
    ],
    ["a workflow UA that differs", { workflowUa: "curl/8.0" }, /UA differs/],
  ];
  for (const [what, files, message] of refusals) {
    it(`refuses ${what}: exit 2, nothing written, no validator`, async () => {
      const f = fixture(files);
      const before = readFileSync(f.catalogPath, "utf8");
      const { code, lines, validatorCalls } = await run(f);
      expect(code).toBe(2);
      expect(validatorCalls).toBe(0);
      expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
      expect(existsSync(join(f.root, EVIDENCE_REL))).toBe(false);
      expect(lines.join("\n")).toMatch(message);
    });
  }

  it("refuses an artifact directory outside pipeline/data/raw/gis/", async () => {
    const f = fixture();
    const { code, lines } = await run(f, { artifactDir: join(f.root, "elsewhere") });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/pipeline\/data\/raw\/gis\/us-runner-/);
  });

  it("refuses a run URL for a different run", async () => {
    const f = fixture();
    const { code, lines } = await run(f, {
      runUrl: "https://github.com/someone/repo/actions/runs/1",
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/run 123456789/);
  });
});

// A-04 T004 (CR2-9): gapPct calls the pure gapPercent; no placeholder measurements remain.
describe("CR2-9 record-gis-runner gap", () => {
  const source = readFileSync(
    join(dirname(new URL(import.meta.url).pathname), "../travis/discovery/record-gis-runner.ts"),
    "utf8",
  );

  it("gapPct calls gapPercent directly", () => {
    const body = /export function gapPct\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    expect(body).toMatch(/\bgapPercent\(/);
    expect(body).not.toMatch(/computeGap/);
    expect(gapPct(493246, 373683)).toBe(24.24);
  });

  it("the module holds no example.invalid placeholder", () => {
    expect(source).not.toContain("example.invalid");
  });
});
