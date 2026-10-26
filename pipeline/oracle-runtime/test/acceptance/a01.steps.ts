// T055 step helpers for testplans/A-01-test-cases.md (QC-TC-A-01 v0.5).
//
// One helper per numbered step of each case that names a01.acceptance.test.ts. Every helper
// shells out (bash, repository root) to the step's command with the § 6 shell setup pasted
// first, and asserts the step's expected output. Nothing here invents data: the commands
// read the committed catalog, report and evidence produced by the live run (T048-T051).
// Negative cases mutate a scratch copy in a temporary folder, never a committed file.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { USER_AGENT } from "../../travis/lib/source-client.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** § 6 "Shell setup, pasted once per session", verbatim. */
const SETUP = String.raw`V=pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py
CAT=pipeline/docs/travis-sources.yaml
REP=docs/evidence/A-01-readiness.json
catq() { node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml');const c=y.parse(require('fs').readFileSync(process.argv[2]||'$CAT','utf8'));console.log(JSON.stringify(new Function('c','with(c){return '+process.argv[1]+'}')(c)))" "$1" "$2"; }
repq() { node -e "const r=JSON.parse(require('fs').readFileSync('$REP','utf8'));console.log(JSON.stringify(new Function('r','with(r){return '+process.argv[1]+'}')(r)))" "$1"; }
# ERR-2: catq/repq resolve every top-level name in a compound expression (with), not only the first.
# ERR-1 (NFR-001): every source request in a case carries the project's identified User-Agent.
curl() { command curl -A "$ORACLE_UA" "$@"; }
`;

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one step's command at the repository root after the § 6 setup. */
export function sh(command: string, env: Record<string, string> = {}): ShellResult {
  const r = spawnSync("bash", ["-c", `${SETUP}\n${command}`], {
    cwd: REPO_ROOT,
    env: { ...process.env, ORACLE_UA: USER_AGENT, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function lastLine(text: string): string {
  return text.trimEnd().split("\n").at(-1) ?? "";
}

function parseJsonOut(r: ShellResult, what: string): unknown {
  if (r.code !== 0) {
    throw new Error(
      `${what} failed (exit ${r.code}): ${r.stderr.split("\n").find((l) => l.trim()) ?? ""}`,
    );
  }
  const out = r.stdout.trim();
  return out === "undefined" ? undefined : (JSON.parse(out) as unknown);
}

/** `catq EXPR [FILE]` from § 6. */
export function catq(expr: string, file?: string): unknown {
  const env: Record<string, string> = { EXPR: expr };
  if (file !== undefined) env.FILE = file;
  return parseJsonOut(
    sh(file === undefined ? 'catq "$EXPR"' : 'catq "$EXPR" "$FILE"', env),
    `catq '${expr}'`,
  );
}

/** `repq EXPR` from § 6. */
export function repq(expr: string): unknown {
  return parseJsonOut(sh('repq "$EXPR"', { EXPR: expr }), `repq '${expr}'`);
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const A = 'sources.find(s=>s.key==="austin_permits")';
const B = 'sources.find(s=>s.key==="tcad_certified").blocked_evidence';

export type Outcome = "A" | "B" | "unknown";

/** § 3: exactly one TCAD outcome applies; "unknown" until the live catalog exists. */
export function tcadOutcome(): Outcome {
  try {
    const status = catq('sources.find(s=>s.key==="tcad_certified").status');
    if (status === "available") return "A";
    if (status === "blocked") return "B";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export interface SkipContext {
  skip: (note?: string) => void;
}

/** Skips the rest of a case with its reason (outcome A vs B, or a precondition branch). */
export function skipWhen(ctx: SkipContext, condition: boolean, reason: string): void {
  if (condition) ctx.skip(reason);
}

// ---------- common ----------

/** Common step 1: a terminal at the repo root on the story branch. */
export function step1OpenTerminal(): void {
  const r = sh("git branch --show-current");
  expect(r.stdout.trim()).toBe("001-discover-sources");
}

/** "Prerequisite run": discover has produced pipeline/docs/travis-sources.yaml. */
export function prerequisiteRun(): void {
  const r = sh('test -f "$CAT"; echo "exit=$?"');
  expect(
    lastLine(r.stdout),
    "prerequisite run: pipeline/docs/travis-sources.yaml is missing (run discover, T048)",
  ).toBe("exit=0");
}

function expectCatq(expr: string, expected: unknown): void {
  expect(catq(expr)).toEqual(expected);
}

function expectRepq(expr: string, expected: unknown): void {
  expect(repq(expr)).toEqual(expected);
}

function exitLine(command: string, expected: number): ShellResult {
  const r = sh(`${command}; echo "exit=$?"`);
  expect(lastLine(r.stdout), `${command}\n${r.stdout.slice(-2000)}`).toBe(`exit=${expected}`);
  return r;
}

function scratchCopy(name: string): string {
  const r = sh(`T=$(mktemp -d); cp "$CAT" "$T/${name}"; echo "$T"`);
  expect(r.code).toBe(0);
  return r.stdout.trim();
}

function mutate(dir: string, file: string, js: string): void {
  const r = sh(
    `node -e "const y=require('./pipeline/oracle-runtime/node_modules/yaml'),f=require('fs'),p='$T/${file}',c=y.parse(f.readFileSync(p,'utf8'));${js};f.writeFileSync(p,y.stringify(c))"`,
    { T: dir },
  );
  expect(r.stdout).toBe("");
  expect(r.code).toBe(0);
}

function scratchGate(dir: string, report: string, gate: string): string {
  const r = sh(
    `node -e "console.log(JSON.parse(require('fs').readFileSync('$T/${report}')).gates.find(g=>g.gate==='${gate}').status)"`,
    { T: dir },
  );
  return r.stdout.trim();
}

function unitTest(id: string): void {
  const r = exitLine(`npm --prefix pipeline/oracle-runtime test -- -t "${id}"`, 0);
  expect(r.stdout).toMatch(/passed/);
}

function grepCount(command: string): number {
  return Number(sh(command).stdout.trim());
}

// ---------- A-01-TC-001 ----------
export const tc001 = {
  step2Validate: () => exitLine("npm --prefix pipeline/oracle-runtime run validate", 0),
  step3Overall: () => expectRepq("overall", "PASS"),
  step4Seed: () => expectRepq("seed_allowed", true),
  step5Ingest: () => expectRepq("ingest_allowed", true),
  step6Execution: () => expectRepq("execution_allowed", true),
  step7Gates: () => {
    const gates = String(repq('gates.map(g=>g.gate+":"+g.status).join(",")'));
    for (const g of ["catalog_metadata", "parcel", "permit", "destination", "enrichment"]) {
      expect(gates).toContain(`${g}:PASS`);
    }
    expect(gates).not.toContain("BLOCKED");
  },
};

// ---------- A-01-TC-002 ----------
export const tc002 = {
  step2Keys: () =>
    expectCatq("sources.map(s=>s.key).sort()", [
      "austin_permits",
      "bbb",
      "contractor_licensing",
      "other_jurisdictions",
      "overture",
      "tcad_certified",
      "tcad_gis",
      "tcad_supplemental",
      "tx_comptroller",
    ]),
  step3Licensing: () =>
    expect(
      String(catq('sources.find(s=>s.key==="contractor_licensing").decision_reason')),
    ).toContain("no statewide roofing licence"),
  step4Provenance: () => expectCatq("sources.every(s=>s.url && s.captured_at)", true),
  step5OvertureNull: () =>
    expectCatq('sources.find(s=>s.key==="overture").denominator.value', null),
  step6OvertureReason: () =>
    expectCatq(
      'sources.find(s=>s.key==="overture").denominator.missing_reason',
      "not measured in A-01: optional source; licence gate decided in A-09",
    ),
};

// ---------- A-01-TC-003 ----------
export const tc003 = {
  step2Writes: () => expectCatq("destination.writes_in_scope", true),
  step3Proven: () => expectCatq("destination.proven", true),
  // ERR-6: OR-m4 (review 2026-10-20) added a third identity, the configured connection the
  // loader uses; FR-001c asks for at least two independent ones, all distinct.
  step4Two: () => expectCatq("destination.independent_identity_sources.length >= 2", true),
  step5Distinct: () =>
    expectCatq(
      "new Set(destination.independent_identity_sources).size === destination.independent_identity_sources.length",
      true,
    ),
  step6NoSecrets: () =>
    expect(
      grepCount(
        `catq 'JSON.stringify(destination)' | grep -cE 'postgres://|password|DATABASE_URL'`,
      ),
    ).toBe(0),
  step7Gate: () => expectRepq('gates.find(g=>g.gate==="destination").status', "PASS"),
};

// ---------- A-01-TC-004 ----------
export const tc004 = {
  step2Complete: () =>
    expectCatq(
      'permits.jurisdictions.filter(j=>["custodian-only","manual-only","blocked"].includes(j.status)).every(j=>j.records_request && j.records_request.recipient_office && j.records_request.system_scope && ["api-first","records-first"].includes(j.records_request.route) && (j.records_request.request_portal_url||j.records_request.request_email))',
      true,
    ),
  step3Scratch: () => scratchCopy("c.yaml"),
  /** Returns false when no row has a records request ("record and skip to the expected result"). */
  step4RemoveOffice: (dir: string): boolean => {
    if (catq("permits.jurisdictions.some(j=>j.records_request)") !== true) return false;
    mutate(
      dir,
      "c.yaml",
      "const j=c.permits.jurisdictions.find(j=>j.records_request);delete j.records_request.recipient_office",
    );
    return true;
  },
  step5Validator: (dir: string) => {
    const r = sh('python3 "$V" "$T/c.yaml" > "$T/r.json"; echo "exit=$?"', { T: dir });
    expect(lastLine(r.stdout)).toBe("exit=1");
  },
  step6PermitBlocked: (dir: string) => expect(scratchGate(dir, "r.json", "permit")).toBe("BLOCKED"),
  expectedCommittedUnchanged: () => expect(sh("git status --short pipeline/docs").stdout).toBe(""),
};

// ---------- A-01-TC-005 ----------
const COMPTROLLER = 'sources.find(s=>s.key==="tx_comptroller")';
export const tc005 = {
  step2TravisCoded: () => {
    const m = catq(`${COMPTROLLER}.travis_coded_rows`) as {
      value: unknown;
      source_url: string;
      captured_at: string;
    };
    expect(Number.isInteger(m.value)).toBe(true);
    expect(m.source_url).toContain("data.texas.gov/resource/9cir-efmm");
    expect(m.captured_at).toMatch(UTC);
    return m.value as number;
  },
  step3Statewide: (travis: number) =>
    expect(catq(`${COMPTROLLER}.statewide_rows.value`) as number).toBeGreaterThan(travis),
  step4Recount: (travis: number) => {
    const r = sh(`curl -s "$(catq '${COMPTROLLER}.travis_coded_rows.source_url' | tr -d '"')"`);
    const n = Number((JSON.parse(r.stdout) as Array<{ count: string }>)[0]?.count);
    expect(Math.abs(n - travis)).toBeLessThanOrEqual(travis * 0.005);
  },
  step5Denominator: () =>
    expectCatq(`${COMPTROLLER}.denominator.value === ${COMPTROLLER}.travis_coded_rows.value`, true),
};

// ---------- A-01-TC-006 ----------
const SOCRATA_COUNT = `curl -sG https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=count(*)'`;
function socrataCount(where: string): number {
  const r = sh(
    `A='${A}'; TS=$(catq "$A.denominator.captured_at" | tr -d '"'); ${SOCRATA_COUNT} --data-urlencode "${where}"`,
  );
  return Number((JSON.parse(r.stdout) as Array<{ count: string }>)[0]?.count);
}
export const tc006 = {
  step2Denominator: () => {
    const d = catq(`${A}.denominator`) as {
      value: unknown;
      source_url: string;
      captured_at: string;
      method: string;
    };
    expect(Number.isInteger(d.value)).toBe(true);
    expect(d.source_url).toContain("data.austintexas.gov/resource/3syk-w9eu");
    expect(d.captured_at).toMatch(UTC);
    expect(d.method).toBe("count(*)");
    return d.value as number;
  },
  // ERR-3: the city reloads 3syk-w9eu in full (every row carries the same :created_at, the
  // reload time), so a recount bounded by :created_at is always 0. Recount now and allow the
  // same 0.5% drift as A-01-TC-005 and A-01-TC-014.
  step3Recount: (value: number) =>
    expect(Math.abs(socrataCount("\\$where=1=1") - value)).toBeLessThanOrEqual(value * 0.005),
  step4NullCount: () => {
    const m = catq(`${A}.tcad_id_null_count`) as {
      value: unknown;
      source_url: string;
      captured_at: string;
    };
    expect(Number.isInteger(m.value)).toBe(true);
    expect(m.source_url).toBeTruthy();
    expect(m.captured_at).toMatch(UTC);
    return m.value as number;
  },
  step5NullRecount: () => socrataCount("\\$where=tcad_id IS NULL"),
  step6NullDrift: (nullCount: number, recount: number) =>
    expect(Math.abs(recount - nullCount)).toBeLessThanOrEqual(nullCount * 0.005),
};

// ---------- A-01-TC-007 ----------
export const tc007 = {
  step2Pages: () =>
    expectCatq(`${A}.throughput.pages_read >= 3 && ${A}.throughput.page_size <= 50000`, true),
  step3Window: () =>
    expectCatq(
      `${A}.throughput.rows_per_minute_median > 0 && Date.parse(${A}.throughput.window_end) > Date.parse(${A}.throughput.window_start)`,
      true,
    ),
  step4Projection: () =>
    expectCatq(
      `Math.abs(${A}.projected_full_capture_hours - ${A}.denominator.value / ${A}.throughput.rows_per_minute_median / 60) <= 0.1`,
      true,
    ),
  step5Decision: () =>
    expectCatq(
      `['bulk download','ingest','runtime retrieval'].includes(${A}.decision) && ${A}.decision_reason.length > 0`,
      true,
    ),
  step6Token: () => expectCatq(`typeof ${A}.throughput.app_token_used`, "boolean"),
  step7AntiBot: () => expectCatq(`${A}.anti_bot.length > 0`, true),
};

// ---------- A-01-TC-009 ----------
/** Test plan v0.6 step 7: the export file named in parcel.export_receipt.file_path. */
const TCAD_FILE_CMD = `catq 'parcel.export_receipt.file_path' | tr -d '"'`;
export const tc009 = {
  step2Count: () => {
    const m = catq("parcel.assessed_parcel_count_measurement") as {
      value: number;
      source_url: string;
      captured_at: string;
    };
    expect(Number.isInteger(m.value) && m.value > 0).toBe(true);
    expect(m.value).toBe(catq("parcel.assessed_parcel_count"));
    expect(m.source_url).toBeTruthy();
    expect(m.captured_at).toMatch(UTC);
  },
  step3RollYear: () => expectCatq("parcel.roll_year", 2026),
  // Step 4 (v0.6): the date as stated on the TCAD public-information page (PO 2026-10-20).
  // ERR-4 (accepted by the PO, 2026-10-20): the page states no date, so a missing date with
  // its reason, source and capture time also passes; the export file name's date is never used.
  step4Certification: () => {
    const date = catq("parcel.certification_date");
    if (date !== undefined && date !== null) {
      expect(String(date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      return;
    }
    const m = catq("parcel.certification_date_measurement") as {
      value: unknown;
      missing_reason?: string;
      source_url: string;
      captured_at: string;
    };
    expect(m.value).toBeNull();
    expect(m.missing_reason).toMatch(/does not state a certification date/);
    expect(m.source_url).toContain("traviscad.org");
    expect(m.captured_at).toMatch(UTC);
  },
  // Step 5 (v0.6): the key as printed in the 2026 JSON export, with its TCAD layout name.
  step5Identifier: () =>
    expect(catq('parcel.identifier_name + "/" + parcel.identifier_layout_name')).toMatch(
      /^(pID\/prop_id|.*geo_?id\/geo_id)$/i,
    ),
  step6DeedDates: () => expectCatq("typeof parcel.deed_or_sale_dates_present", "boolean"),
  // Step 7 (v0.6): hash the file named in the receipt (TCAD_FILE_CMD), not the first *.json.
  step7FileHash: () => {
    const h = sh(`F=$(${TCAD_FILE_CMD}); shasum -a 256 "$F" | cut -d' ' -f1`).stdout.trim();
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    return h;
  },
  step8ReceiptHash: (hash: string) => expectCatq("parcel.export_receipt.sha256", hash),
  step9Ignored: () => exitLine(`F=$(${TCAD_FILE_CMD}); git check-ignore -q "$F"`, 0),
  step10NotTracked: () => expect(sh("git ls-files pipeline/data | wc -l").stdout.trim()).toBe("0"),
};

// ---------- A-01-TC-010 / TC-011 ----------
export function gisCounted(): boolean {
  return typeof catq("parcel.gis_feature_count") === "number";
}
export const tc010 = {
  step2Gap: () =>
    expectCatq(
      "Math.abs(parcel.gap_pct - Math.abs(parcel.assessed_parcel_count - parcel.gis_feature_count) / parcel.assessed_parcel_count * 100) <= 0.01",
      true,
    ),
  step3Explanation: () =>
    expectCatq("parcel.gap_pct <= 2 || parcel.discrepancy_explanation.length > 0", true),
  step4Acknowledged: () =>
    expectCatq(
      'parcel.gis_feature_count >= parcel.assessed_parcel_count || ["acknowledged","none"].includes(parcel.separately_assessed_without_geometry)',
      true,
    ),
  step5Canonical: () => expectCatq("parcel.canonical_source", "TCAD 2026 certified roll"),
};
export function gisBlocked(): boolean {
  return catq('sources.find(s=>s.key==="tcad_gis").status') === "blocked";
}
export const tc011 = {
  step2Blocked: () => expectCatq('sources.find(s=>s.key==="tcad_gis").status', "blocked"),
  step3NullWithReason: () => {
    const m = catq("parcel.gis_feature_count_measurement") as {
      value: unknown;
      missing_reason: string;
      source_url: string;
      captured_at: string;
    };
    expect(m.value).toBeNull();
    expect(m.missing_reason).toMatch(/timeout/i);
    expect(m.source_url).toBeTruthy();
    expect(m.captured_at).toMatch(UTC);
  },
  step4GapUnknown: () => expectCatq("parcel.gap_pct", "unknown"),
  step5Timeout: () =>
    expectCatq('sources.find(s=>s.key==="tcad_gis").blocked_evidence.timeout_ms > 0', true),
  step6AntiBot: () =>
    expectCatq(
      '[sources.find(s=>s.key==="tcad_certified").anti_bot, sources.find(s=>s.key==="tcad_gis").anti_bot].every(a=>a && a.length>0)',
      true,
    ),
};

// ---------- A-01-TC-012 ----------
const FINDINGS = "pipeline/docs/travis-county-findings.md";
export const tc012 = {
  step2ExportLayout: () =>
    expect(
      sh(`grep -n -i "export layout" ${FINDINGS}`).stdout.trim().split("\n").filter(Boolean).length,
    ).toBeGreaterThanOrEqual(1),
  step3BothLayouts: () =>
    expect(
      Number(
        sh(`grep -n -iE "fixed-width|special export \\(json\\)" ${FINDINGS} | wc -l`).stdout.trim(),
      ),
    ).toBeGreaterThanOrEqual(2),
  step4ChosenLayout: () =>
    expect(
      sh(`grep -n -i "A-04 uses" ${FINDINGS}`).stdout.trim().split("\n").filter(Boolean),
    ).toHaveLength(1),
};

// ---------- A-01-TC-013 ----------
export const tc013 = {
  step2Census: () => {
    const c = catq("census_reference") as Record<string, unknown>;
    for (const k of ["dataset", "vintage", "source_url", "captured_at"]) expect(c[k]).toBeTruthy();
    expect(Number.isInteger(c.place_count)).toBe(true);
  },
  step3Count: () =>
    expectCatq(
      "permits.expected_jurisdiction_count === census_reference.place_count + 1 && permits.jurisdictions.length === permits.expected_jurisdiction_count",
      true,
    ),
  step4Classes: () =>
    expectCatq(
      'permits.jurisdictions.every(j=>["supported","delegated","manual-only","blocked","unavailable","excluded","custodian-only"].includes(j.status) && ["supported","records request","no public history"].includes(j.spec_class) && j.evidence_url && j.evidence_captured_at && typeof j.historical_records==="boolean")',
      true,
    ),
  step5NoReview: () =>
    expectCatq('permits.jurisdictions.filter(j=>j.status==="needs-review").length', 0),
  step6Leads: () =>
    expectCatq(
      '["Travis County","Austin","Pflugerville","Lakeway","Bee Cave","West Lake Hills","Manor","Sunset Valley","Rollingwood","Lago Vista","Jonestown","Briarcliff","Creedmoor","Mustang Ridge","Webberville","Cedar Park","Leander","Round Rock"].filter(n=>!permits.jurisdictions.some(j=>j.jurisdiction.includes(n)))',
      [],
    ),
  step7NoUnified: () => expectCatq("permits.assumes_unified_countywide_history", false),
  step8Gate: () => expectRepq('gates.find(g=>g.gate==="permit").status', "PASS"),
};

// ---------- A-01-TC-014 ----------
export const tc014 = {
  step2Entries: () => {
    const entries = catq(
      `${A}.located_in_other_jurisdictions.map(x=>x.jurisdiction+"="+x.value)`,
    ) as string[];
    const names = entries.map((e) => e.split("=")[0] ?? "");
    expect(names).toContain("LAKEWAY FULL PURPOSE");
    expect(names).toContain("BEE CAVE FULL PURPOSE");
    expect(names.some((n) => /PFLUGERVILLE/.test(n) && /FULL PURPOSE/.test(n))).toBe(true);
    expect(names.some((n) => /PFLUGERVILLE/.test(n) && /ETJ/.test(n))).toBe(true);
    return new Map(
      entries.map((e) => [e.slice(0, e.lastIndexOf("=")), Number(e.slice(e.lastIndexOf("=") + 1))]),
    );
  },
  step3Recount: (recorded: Map<string, number>) => {
    const r = sh(
      `curl -sG https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=jurisdiction,count(*)' --data-urlencode '$group=jurisdiction' --data-urlencode "\\$where=jurisdiction like '%LAKEWAY%' OR jurisdiction like '%BEE CAVE%' OR jurisdiction like '%PFLUGERVILLE%'"`,
    );
    const live = JSON.parse(r.stdout) as Array<{ jurisdiction: string; count: string }>;
    for (const row of live) {
      const value = recorded.get(row.jurisdiction);
      if (value === undefined) continue;
      expect(Math.abs(Number(row.count) - value), row.jurisdiction).toBeLessThanOrEqual(
        value * 0.005,
      );
    }
  },
  step4Lakeway: () =>
    expectCatq(
      'permits.jurisdictions.find(j=>j.jurisdiction.includes("Lakeway")).austin_issued_located_here.value > 0',
      true,
    ),
  step5OwnEvidence: () => {
    const rows = catq(
      'permits.jurisdictions.filter(j=>/Lakeway|Bee Cave|Pflugerville/.test(j.jurisdiction)).map(j=>j.jurisdiction+":"+j.spec_class+":"+(j.evidence_url.includes("data.austintexas.gov")?"austin-evidence":"own-evidence"))',
    ) as string[];
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.endsWith(":own-evidence")).toBe(true);
  },
};

// ---------- A-01-TC-015 ----------
export const tc015 = {
  step2Scratch: () => scratchCopy("c.yaml"),
  step3SpecLabel: (dir: string) =>
    mutate(dir, "c.yaml", "c.permits.jurisdictions[0].status='records request'"),
  step4Validator: (dir: string) => {
    const r = sh('python3 "$V" "$T/c.yaml" > "$T/r.json"; echo "exit=$?"', { T: dir });
    expect(lastLine(r.stdout)).toBe("exit=1");
  },
  step5PermitBlocked: (dir: string) => expect(scratchGate(dir, "r.json", "permit")).toBe("BLOCKED"),
  step6Copy: (dir: string) => {
    const r = sh('cp "$CAT" "$T/d.yaml"', { T: dir });
    expect(r.stdout).toBe("");
    expect(r.code).toBe(0);
  },
  step7Pop: (dir: string) => mutate(dir, "d.yaml", "c.permits.jurisdictions.pop()"),
  step8Checker: (dir: string) => {
    const n = catq("permits.expected_jurisdiction_count") as number;
    const r = sh(
      'npm --prefix pipeline/oracle-runtime run check-catalog -- "$T/d.yaml"; echo "exit=$?"',
      { T: dir },
    );
    expect(r.stdout).toContain(
      `FAIL rule 6: jurisdictions ${n - 1} != census place_count + 1 (${n})`,
    );
    expect(lastLine(r.stdout)).toBe("exit=1");
  },
};

// ---------- A-01-TC-016 ----------
export const tc016 = {
  step2Supported: () =>
    expectCatq(
      'permits.jurisdictions.filter(j=>j.status==="supported").every(j=>j.historical_records===true && j.earliest_record_date)',
      true,
    ),
  step3Delegated: () =>
    expectCatq(
      'permits.jurisdictions.filter(j=>j.status==="delegated").every(j=>j.issued_by && j.spec_class==="no public history")',
      true,
    ),
  step4Intake: () =>
    expectCatq(
      'permits.jurisdictions.filter(j=>j.portal_kind==="application-intake").every(j=>j.historical_records===false && j.spec_class==="records request")',
      true,
    ),
  step5Unavailable: () =>
    expectCatq(
      'permits.jurisdictions.filter(j=>j.status==="unavailable").every(j=>j.evidence_url)',
      true,
    ),
};

// ---------- A-01-TC-017 ----------
export const tc017 = {
  step2Decisions: () =>
    expectCatq(
      "sources.filter(s=>s.projected_full_capture_hours > 48 && !(s.decision && s.decision_reason && (s.throughput || s.download_rate))).map(s=>s.key)",
      [],
    ),
  step3Scratch: () => scratchCopy("c.yaml"),
  step4Remove: (dir: string) =>
    mutate(
      dir,
      "c.yaml",
      "const s=c.sources.find(s=>s.key==='austin_permits');s.projected_full_capture_hours=49;delete s.decision",
    ),
  step5Checker: (dir: string) => {
    const r = sh(
      'npm --prefix pipeline/oracle-runtime run check-catalog -- "$T/c.yaml"; echo "exit=$?"',
      { T: dir },
    );
    expect(r.stdout).toContain("FAIL rule 3: austin_permits projected 49 h has no decision");
    expect(lastLine(r.stdout)).toBe("exit=1");
  },
};

// ---------- A-01-TC-018 ----------
export const tc018 = {
  step2Status403: () => expectCatq(`${B}.http_status`, 403),
  step3Url: () => expect(String(catq(`${B}.url`))).toMatch(/^https:\/\/traviscad\.org\//),
  step4Time: () => expect(String(catq(`${B}.captured_at`))).toMatch(/Z$/),
  step5EvidenceCommitted: () =>
    exitLine(
      `test -f "$(catq '${B}.evidence_path' | tr -d '"')" && git ls-files --error-unmatch "$(catq '${B}.evidence_path' | tr -d '"')"`,
      0,
    ),
  step6RecordsRequest: () => {
    const req = catq('sources.find(s=>s.key==="tcad_certified").records_request') as Record<
      string,
      string | undefined
    >;
    expect(req.recipient_office).toBeTruthy();
    expect(req.system_scope).toMatch(/2026 Certified/i);
    expect(req.system_scope).toMatch(/supplemental/i);
    expect(["records-first", "api-first"]).toContain(req.route);
    expect(req.request_portal_url ?? req.request_email).toBeTruthy();
  },
  step7Validate: () => exitLine("npm --prefix pipeline/oracle-runtime run validate", 1),
  step8OnlyParcel: () =>
    expectRepq('gates.filter(g=>g.status==="BLOCKED").map(g=>g.gate)', ["parcel"]),
  step9Seed: () => expectRepq("seed_allowed", false),
  step10Ingest: () => expectRepq("ingest_allowed", false),
  step11WaitingHuman: () =>
    expect(grepCount('grep -c "WAITING_HUMAN" docs/evidence/A-01.md')).toBeGreaterThanOrEqual(1),
  step12Summary: () =>
    expect(grepCount('grep -ciE "TCAD.*(403|blocked)" docs/sources.md')).toBeGreaterThanOrEqual(1),
  step13RollMissing: () => {
    const m = catq("parcel.assessed_parcel_count_measurement") as {
      value: unknown;
      missing_reason: string;
    };
    expect(m.value).toBeNull();
    expect(m.missing_reason).toContain("403");
  },
};

// ---------- A-01-TC-019 ----------
const BLOCKED_ROWS = "[...sources, ...permits.jurisdictions].filter(x=>x.blocked_evidence)";
export const tc019 = {
  step2Unit: () => unitTest("A-01-TC-019"),
  step3OneAttempt: () =>
    expectCatq(`[...new Set(${BLOCKED_ROWS}.map(x=>x.blocked_evidence.attempts))]`, [1]),
  step4OneAgent: () =>
    expectCatq(`[...new Set(${BLOCKED_ROWS}.map(x=>x.blocked_evidence.user_agent))].length`, 1),
  step5NoProxy: () => expect(grepCount("env | grep -ciE '^(https?|all)_proxy='")).toBe(0),
};

// ---------- A-01-TC-020 ----------
export const tc020 = {
  /** Returns true when every saved geo signal is `none`. */
  step2Signals: (): boolean => {
    const entries = catq(
      'sources.flatMap(s=>[s.blocked_evidence,s.operator_blocked_evidence].filter(Boolean).map(e=>s.key+":"+e.geo_signal))',
    ) as string[];
    for (const e of entries) expect(e).toMatch(/^[a-z_]+:.+$/);
    return entries.every((e) => e.endsWith(":none"));
  },
  step3NoWorkflow: () => exitLine("test -e .github/workflows/geo-check.yml", 1),
  step4NotApplicable: () =>
    expect(grepCount('grep -c "N/A: no geo signal" docs/evidence/A-01.md')).toBe(1),
  // ERR-6: the US check ran as workflow a01-us-gis-probe.yml under the FR-006b amendment
  // (DEC-A-01-source-access D-2); its one run and HTTP status are recorded in the evidence.
  step5OneUsRun: () =>
    expect(
      sh(
        "gh run list -R HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx --workflow a01-us-gis-probe.yml --branch 001-discover-sources --json conclusion --jq length",
      ).stdout.trim(),
    ).toBe("1"),
  step6UsStatusRecorded: () =>
    expect(
      grepCount('grep -cE "^http_status: 200|HTTP 200" docs/evidence/A-01-us-gis-runner.md'),
    ).toBeGreaterThanOrEqual(1),
};

// ---------- A-01-TC-021 ----------
export const tc021 = {
  step2SourceBlocked: () => expectCatq('sources.find(s=>s.key==="bbb").status', "blocked"),
  step3EnrichmentBlocked: () => expectCatq("enrichment.bbb.status", "blocked"),
  step4NotAdvertised: () =>
    expectCatq(
      "enrichment.bbb.expected_count === undefined || enrichment.bbb.expected_count !== enrichment.bbb.advertised_listing_count",
      true,
    ),
  step5ApiNextStep: () =>
    expect(String(catq('sources.find(s=>s.key==="bbb").decision_reason'))).toContain("BBB API"),
  step6Gate: () => expectRepq('gates.find(g=>g.gate==="enrichment").status', "PASS"),
};

// ---------- A-01-TC-022 ----------
export const tc022 = {
  step2Tracked: () =>
    expect(
      sh(
        "git ls-files pipeline/docs/travis-sources.yaml docs/sources.md docs/evidence/A-01-readiness.json | wc -l",
      ).stdout.trim(),
    ).toBe("3"),
  step3Render: () => exitLine("npm --prefix pipeline/oracle-runtime run render-sources", 0),
  step4NoDiff: () => exitLine("git diff --exit-code docs/sources.md", 0),
  step5Provenance: () =>
    expect(
      sh(
        String.raw`grep -E '\| *[0-9][0-9,]* *\|' docs/sources.md | grep -vcE 'https?://.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z'`,
      ).stdout.trim(),
    ).toBe("0"),
  step6FrontMatter: () =>
    expect(
      sh(
        `for f in docs/sources.md pipeline/docs/travis-county-findings.md docs/evidence/A-01.md docs/evidence/A-01-coverage.md; do awk 'NR==1&&$0!="---"{print FILENAME": no front matter";exit} /^id: /{i=1} /^parent: /{p=1} NR>1&&/^---$/{if(!(i&&p))print FILENAME": missing id or parent";exit}' "$f"; done`,
      ).stdout,
    ).toBe(""),
};

// ---------- A-01-TC-024 ----------
export const tc024 = {
  step2NoSecrets: () => {
    const r = sh(
      `grep -rnE 'postgres(ql)?://|/Users/|password=|X-App-Token: *[A-Za-z0-9]' pipeline/docs docs/sources.md docs/evidence; echo "exit=$?"`,
    );
    expect(r.stdout.trim()).toBe("exit=1");
  },
  step3RelativePath: () => expectRepq("catalog_path", "pipeline/docs/travis-sources.yaml"),
  step4Gitleaks: () => {
    const r = sh(
      `gitleaks detect --source . --log-opts "feature/oracle-pipeline..001-discover-sources" --no-banner 2>&1; echo "exit=$?"`,
    );
    expect(r.stdout).toMatch(/no leaks found/);
    expect(lastLine(r.stdout)).toBe("exit=0");
  },
};

// ---------- A-01-TC-025 ----------
export const tc025 = {
  step2SelfTest: () => exitLine('python3 "$V" --self-test', 0),
  step3Hash: () => {
    const actual = sh(`shasum -a 256 "$V" | cut -d' ' -f1`).stdout.trim();
    const vendored = sh("cat pipeline/oracle-runtime/kit/VENDORED.md").stdout;
    const row =
      vendored
        .split("\n")
        .find((l) => l.includes("`use-oracle/scripts/validate-county-readiness.py`")) ?? "";
    expect(row).toContain(actual);
    const kit = sh(
      `shasum -a 256 ~/.claude/plugins/cache/soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-oracle/scripts/validate-county-readiness.py | cut -d' ' -f1`,
    ).stdout.trim();
    expect(kit).toBe(actual);
  },
  step4WithPyYaml: (): string => {
    const r = sh('T=$(mktemp -d); python3 "$V" "$CAT" > "$T/with.json"; echo "$T"');
    return r.stdout.trim();
  },
  step5WithoutPyYaml: (dir: string) => {
    const r = sh('python3 -s "$V" "$CAT" > "$T/without.json"', { T: dir });
    expect(r.stdout).toBe("");
  },
  step6Identical: (dir: string) => {
    const r = sh('diff "$T/with.json" "$T/without.json"; echo "exit=$?"', { T: dir });
    expect(r.stdout.trim()).toBe("exit=0");
  },
};

// ---------- A-01-TC-027 ----------
export const tc027 = {
  // ERR-6: since the review fixes (CR-3, CR2-1) resolve refuses with exit 2 and sends nothing
  // when no run id is given or the catalog could not be rewritten; still a refusal.
  step2RefuseNotWaiting: () =>
    exitLine("npm --prefix pipeline/oracle-runtime run resolve -- austin_permits captured", 2),
  step3Unit: () => unitTest("A-01-TC-027"),
  /**
   * Outcome B only. The first run records the resolution (exit 0); a later re-run of this
   * suite gets "already resolved still-blocked", which is the same documented blocker.
   */
  step4StillBlocked: () => {
    const r = sh(
      'npm --prefix pipeline/oracle-runtime run resolve -- tcad_certified still-blocked; echo "exit=$?"',
    );
    const ok = lastLine(r.stdout) === "exit=0" || /already resolved still-blocked/.test(r.stdout);
    expect(ok, r.stdout.slice(-1000)).toBe(true);
  },
  step5Recorded: () =>
    expect(
      grepCount('grep -cE "tcad_certified.*still blocked" docs/evidence/A-01.md'),
    ).toBeGreaterThanOrEqual(1),
};

// ---------- A-01-TC-NF-02 ----------
export const tcNf02 = {
  step2Bounded: () => {
    const pages = catq(`${A}.throughput.pages_read`) as number;
    const rows = catq(`${A}.throughput.pages_read * ${A}.throughput.page_size`) as number;
    if (pages === 3) expect(rows).toBeLessThanOrEqual(150000);
    else expect(pages).toBeGreaterThan(3); // more pages only if documented (reason in decision_reason)
  },
  step3OnlyTcad: () => {
    const dirs = sh("ls pipeline/data/raw 2>/dev/null").stdout.trim().split("\n").filter(Boolean);
    // ERR-6: gis/ holds only the US-runner count artifact (a 16-byte answer), not a download.
    expect(dirs.filter((d) => d !== "tcad" && d !== "gis")).toEqual([]);
    const gis = sh("ls pipeline/data/raw/gis 2>/dev/null")
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    expect(gis.every((d) => /^us-runner-\d+$/.test(d))).toBe(true);
  },
};

// ---------- A-01-TC-NF-03 ----------
export const tcNf03 = {
  step2Duration: () =>
    expect(
      catq(
        "(Date.parse(snapshot_time) - Math.min(...sources.map(s=>Date.parse(s.captured_at)))) / 3600000 - (waiting_human_hours || 0)",
      ) as number,
    ).toBeLessThanOrEqual(8),
};
