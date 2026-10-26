// A-02 acceptance tests named by test-case ID (testplans/A-02-test-cases.md v0.2.1), so
// `pnpm vitest run -t "A-02-TC-0NN"` runs exactly that case. The cases that read the pilot export
// are gated on PILOT_DIR and skip with an explicit message without it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COLUMN_ENUMS,
  RunManifestV1,
  UNCARRIED,
  VIEWS,
  rowSchema,
  type ViewName,
} from "@countylens/contract";
import { PROFILE, classifyStatus, digest } from "@countylens/profile-travis-austin";
import { openDuckDb, type DuckDbEngine } from "../../scripts/duckdb-engine.js";
import {
  PILOT_DIR,
  PILOT_MANIFEST,
  PILOT_MANIFEST_CID,
  ROOT,
  SKIP_MESSAGE,
  bindPilot,
  type Pilot,
} from "../helpers/pilot.js";

type Missing = { field: string; reason: string }[];
type Row = Record<string, unknown>;

const VIEWS_SQL = join(ROOT, "packages/query-core/views.sql");
const COLUMNS_JSON = join(ROOT, "contract/v1/columns.json");
const SAMPLE = join(ROOT, "contract/v1/sample.parquet");
const README = join(ROOT, "contract/v1/README.md");
const EXPIRED = ["2026-029405 BP", "2026-022834 BP", "2026-022879 BP"];
// v1.1 (ERR-66) turned contractor_name_raw, bbb_rating and bbb_url into columns
// (contractor_name_as_printed, bbb_rating, bbb_url); the rest still have no carrier.
const NO_CARRIER = ["status_raw", "expiry_date", "description", "work_class_raw"];
const TC011_GREP =
  /\b(i?like|similar to|regexp_[a-z_]+)\b|~|now\(\)|current_date|reroof|re-roof|roof replace|solar|photovoltaic|\brtu\b/i;

const manifestJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(PILOT_MANIFEST, "utf8")) as Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Static cases (no pilot needed)
// ---------------------------------------------------------------------------------------------

describe("A-02 acceptance: static", () => {
  it("A-02-TC-010 no-carrier fields are not columns (grep of columns.json counts 0)", () => {
    const json = readFileSync(COLUMNS_JSON, "utf8");
    const hits = json
      .split("\n")
      .filter((l) => new RegExp(`"(${NO_CARRIER.join("|")})"`).test(l) && l.includes('"name"'));
    expect(hits).toEqual([]);
    const names = Object.values(VIEWS).flatMap((cols) => cols.map((c) => c.name));
    for (const f of NO_CARRIER) expect(names).not.toContain(f);
    expect(UNCARRIED.v_roofing_permit.map((u) => u.field)).toEqual(NO_CARRIER);
  });

  it("A-02-TC-011 no text classification in views.sql (the grep prints nothing)", () => {
    const sql = readFileSync(VIEWS_SQL, "utf8");
    expect(sql.split("\n").filter((l) => TC011_GREP.test(l))).toEqual([]);
    expect(sql).toMatch(/improvement_type = 'Roofing' AND \w+\.improvement_action = 'Replacement'/);
  });

  it("A-02-TC-025 the sample file has exactly 20 rows; no other Parquet file is tracked", async () => {
    const db = await openDuckDb();
    try {
      const n = await db.all(`SELECT count(*)::INTEGER AS n FROM '${SAMPLE}'`);
      expect(n[0]?.n).toBe(20);
    } finally {
      db.close();
    }
    const tracked = execFileSync("git", ["ls-files", "*.parquet"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const f of tracked) expect(f).toBe("contract/v1/sample.parquet");
  });

  it("A-02-TC-026 sample rows: 0 null provenance, ≥ 1 stalled, ≥ 1 roof age, one run", async () => {
    const db = await openDuckDb();
    try {
      const [r] = await db.all(`SELECT
        count(*) FILTER (WHERE source_url IS NULL OR captured_at IS NULL OR "table" IS NULL
          OR table_cid IS NULL OR run_id IS NULL OR manifest_cid IS NULL)::INTEGER AS null_prov,
        count(*) FILTER (WHERE status_class = 'stalled')::INTEGER AS stalled,
        count(*) FILTER (WHERE roof_age_years IS NOT NULL)::INTEGER AS with_roof_age,
        count(DISTINCT run_id)::INTEGER AS runs,
        min(run_id) AS run_id
        FROM '${SAMPLE}'`);
      expect(r?.null_prov).toBe(0);
      expect(r?.stalled).toBeGreaterThanOrEqual(1);
      expect(r?.with_roof_age).toBeGreaterThanOrEqual(1);
      expect(r?.runs).toBe(1);
      expect(r?.run_id).toBe("travis-pilot-20261020");
    } finally {
      db.close();
    }
  });

  it("A-02-TC-027 README documents every sample column, every gap, and the five statements", async () => {
    const readme = readFileSync(README, "utf8");
    const db = await openDuckDb();
    try {
      for (const c of await db.all(`DESCRIBE SELECT * FROM '${SAMPLE}'`)) {
        expect(readme, String(c.column_name)).toContain(
          `| \`${String(c.column_name)}\` | \`${String(c.column_type)}\` |`,
        );
      }
    } finally {
      db.close();
    }
    for (const u of Object.values(UNCARRIED).flat()) {
      expect(readme).toContain(`| \`${u.field}\` | \`${u.reason}\` |`);
    }
    expect(readme).toMatch(/empty status means stalled/i);
    expect(readme).toMatch(/real content addresses of unpublished local files, replaced in A-03/);
    expect(readme).toMatch(/recompute `manifest_cid`/i);
    expect(readme).toMatch(/contract\/v2/);
    expect(readme).toMatch(/never published to IPFS or shown on the hosted site/i);
  });

  it("A-02-TC-028 RunManifestV1 accepts the pilot manifest and rejects CIDv0, gateway URLs, a bare directory and ipns", () => {
    const m = manifestJson();
    expect(RunManifestV1.safeParse(m).success).toBe(true);
    const artifacts = m.artifacts as Record<string, unknown>[];
    const issue = (bad: unknown): { path: string; message: string; code: string }[] => {
      const r = RunManifestV1.safeParse(bad);
      expect(r.success).toBe(false);
      return (r.error?.issues ?? []).map((i) => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code,
      }));
    };
    const v0 = structuredClone(m);
    (v0.artifacts as Record<string, unknown>[])[0] = {
      ...artifacts[0],
      cid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    };
    expect(issue(v0).map((i) => i.path)).toContain("artifacts.0.cid");

    const gw = structuredClone(m);
    (gw.sources as Record<string, unknown>[])[0] = {
      ...(m.sources as Record<string, unknown>[])[0],
      url: `https://ipfs.io/ipfs/${PILOT_MANIFEST_CID}`,
    };
    const gwIssue = issue(gw).find((i) => i.path === "sources.0.url");
    expect(gwIssue?.message).toMatch(/^gateway URLs are derived, never stored/);

    const dirIndex = artifacts.findIndex((a) => a.kind === "directory");
    const noCar = structuredClone(m);
    delete (noCar.artifacts as Record<string, unknown>[])[dirIndex]?.carCid;
    const noCarIssue = issue(noCar).find((i) => i.path === `artifacts.${dirIndex}.carCid`);
    expect(noCarIssue?.message).toMatch(/^directory artifacts need carCid/);

    const withIpns = {
      ...m,
      ipns: "k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04",
    };
    const ipnsIssue = issue(withIpns).find((i) => i.code === "unrecognized_keys");
    expect(ipnsIssue?.path).toBe("");
    expect(ipnsIssue?.message).toContain("ipns");
  });
});

// ---------------------------------------------------------------------------------------------
// Pilot cases (PILOT_DIR)
// ---------------------------------------------------------------------------------------------

if (!PILOT_DIR) {
  describe("A-02 acceptance: pilot", () => {
    it.skip(`A-02-TC-008/009/018/024/028/030/NF-03 pilot cases: ${SKIP_MESSAGE}`, () => undefined);
  });
} else {
  const pilotDir = PILOT_DIR;
  let pilot: Pilot;
  let db: DuckDbEngine;
  const rows: Partial<Record<ViewName, Row[]>> = {};
  const viewRows = (v: ViewName): Row[] => rows[v] ?? [];

  beforeAll(async () => {
    pilot = await bindPilot();
    db = pilot.db;
    for (const v of Object.keys(VIEWS) as ViewName[]) rows[v] = await db.all(`SELECT * FROM ${v}`);
  });
  afterAll(() => db.close());

  describe("A-02 acceptance: pilot", () => {
    it("A-02-TC-008 the four views compile; DESCRIBE equals contract/v1/columns.json", async () => {
      const json = JSON.parse(readFileSync(COLUMNS_JSON, "utf8")) as {
        views: Record<string, { name: string; type: string }[]>;
      };
      expect(Object.keys(json.views).sort()).toEqual(Object.keys(VIEWS).sort());
      for (const v of Object.keys(VIEWS) as ViewName[]) {
        const described = await db.all(`DESCRIBE SELECT * FROM ${v}`);
        expect(
          described.map((r) => [r.column_name, r.column_type]),
          v,
        ).toEqual((json.views[v] ?? []).map((c) => [c.name, c.type]));
      }
      const names = (json.views.v_property ?? []).map((c) => c.name);
      for (const c of [
        "roof_age_years",
        "roof_age_basis",
        "tenure_years",
        "tenure_basis",
        "owner_is_out_of_area",
        "owner_area_class",
        "coordinate_source",
      ])
        expect(names).toContain(c);
      const permit = (json.views.v_roofing_permit ?? []).map((c) => c.name);
      for (const c of [
        "issue_date",
        "final_date",
        "open_days",
        "contractor_company_cid",
        "bbb_status",
      ])
        expect(permit).toContain(c);
    });

    it("A-02-TC-009 enum columns hold only their frozen values", async () => {
      for (const v of Object.keys(VIEWS) as ViewName[]) {
        for (const col of VIEWS[v].filter((c) => c.kind === "enum")) {
          const distinct = await db.all(`SELECT DISTINCT ${col.name} AS e FROM ${v}`);
          const allowed = COLUMN_ENUMS[col.name as keyof typeof COLUMN_ENUMS] as readonly string[];
          for (const r of distinct) expect(allowed, `${v}.${col.name}`).toContain(r.e);
        }
      }
      const basis = await db.all(
        "SELECT roof_age_basis AS b, count(*)::INTEGER AS n FROM v_property GROUP BY 1 ORDER BY 1",
      );
      expect(basis).toEqual([
        { b: "built_year", n: 12 },
        { b: "permit", n: 10 },
      ]);
    });

    it("A-02-TC-018 the 3 published Expired permits are stalled and never relabelled", async () => {
      const receipts = readFileSync(join(pilotDir, "capture/austin/receipts.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { permit_number: string; url: string });
      const asOf = Date.parse(String(viewRows("v_run")[0]?.finished_at));
      for (const number of EXPIRED) {
        const row = viewRows("v_roofing_permit").find((r) => r.permit_number === number);
        expect(row, number).toBeDefined();
        expect(row?.improvement_status).toBeNull();
        expect(row?.status_class).toBe("stalled");
        const issued = Date.parse(`${String(row?.issue_date)}T00:00:00Z`);
        const expected = Math.floor((asOf - issued) / 86_400_000);
        expect(row?.open_days).toBe(expected);
        expect(Number(row?.open_days)).toBeGreaterThanOrEqual(0);
        expect(row?.missing).toEqual(
          expect.arrayContaining([
            { field: "status_raw", reason: "no_lexicon_carrier" },
            { field: "expiry_date", reason: "no_lexicon_carrier" },
            { field: "improvement_status", reason: "enum_lacks_value" },
          ]),
        );
        // source_url is the Socrata record URL; that record shows "Expired".
        expect(row?.source_url).toBe(receipts.find((r) => r.permit_number === number)?.url);
        const body = JSON.parse(
          readFileSync(join(pilotDir, `capture/austin/${number.replace(" ", "_")}.json`), "utf8"),
        ) as { status_current: string }[];
        expect(body[0]?.status_current).toBe("Expired");
      }
    });

    it("A-02-TC-024 no blanks: every empty value has a reason", () => {
      for (const v of ["v_property", "v_roofing_permit", "v_contractor"] as const) {
        for (const row of viewRows(v)) {
          const reasons = new Map((row.missing as Missing).map((m) => [m.field, m.reason]));
          for (const col of VIEWS[v].filter((c) => c.nullable)) {
            if (row[col.name] === null)
              expect(reasons.has(col.name), `${v}.${col.name}`).toBe(true);
          }
        }
      }
      for (const row of viewRows("v_roofing_permit")) {
        expect(row.bbb_status).toBe("not_checked");
        expect(["contractor_unresolved", "no_lexicon_carrier"]).toContain(row.bbb_status_reason);
        expect(row.missing).toEqual(
          expect.arrayContaining([{ field: "contractor_name_raw", reason: "no_lexicon_carrier" }]),
        );
        if (row.status_class === "closed") {
          expect(row.open_days).toBeNull();
          expect(row.missing).toEqual(
            expect.arrayContaining([{ field: "open_days", reason: "not_open" }]),
          );
        }
      }
      const undated = viewRows("v_property").filter((r) => r.last_ownership_transfer_date === null);
      expect(undated.length).toBeGreaterThan(0);
      for (const row of undated) {
        expect(row.tenure_basis).toBe("unknown");
        expect(row.is_long_tenure).toBeNull();
        expect(row.missing).toEqual(
          expect.arrayContaining([{ field: "is_long_tenure", reason: "no_dated_sale" }]),
        );
      }
    });

    it("A-02-TC-028 the row schemas parse 100% of pilot view rows", () => {
      let n = 0;
      for (const v of Object.keys(VIEWS) as ViewName[]) {
        const schema = rowSchema(v);
        for (const row of viewRows(v)) {
          expect(schema.safeParse(row).success, v).toBe(true);
          n += 1;
        }
      }
      expect(n).toBe(22 + 41 + 0 + 1);
    });

    it("A-02-TC-030 no excluded or needs_review permit is published", async () => {
      const ledger = readFileSync(join(pilotDir, "ledger/classification.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map(
          (l) => JSON.parse(l) as { permit_number: string; status_class: string; emitted: boolean },
        );
      const file = join(pilotDir, "tables/property_improvement/property_improvement/*.parquet");
      const published = await db.all(
        `SELECT permit_number, improvement_status, permit_issue_date FROM '${file}'`,
      );
      expect(published.length).toBe(43);
      for (const p of published) {
        const entry = ledger.find((l) => l.permit_number === p.permit_number);
        expect(["open", "stalled", "closed"], String(p.permit_number)).toContain(
          entry?.status_class,
        );
        if (p.improvement_status === null) {
          expect(p.permit_issue_date).not.toBeNull();
          const body = JSON.parse(
            readFileSync(
              join(pilotDir, `capture/austin/${String(p.permit_number).replace(" ", "_")}.json`),
              "utf8",
            ),
          ) as { status_current: string }[];
          expect(body[0]?.status_current).toBe("Expired");
        }
      }
      const numbers = new Set(published.map((p) => p.permit_number));
      for (const l of ledger.filter((x) => ["exclude", "needs_review"].includes(x.status_class))) {
        expect(numbers.has(l.permit_number)).toBe(false);
      }
      const coverage = manifestJson().coverage as Record<string, { count: number }>;
      expect(coverage.permits_excluded?.count).toBe(
        ledger.filter((l) => l.status_class === "exclude").length,
      );
      expect(coverage.permits_needs_review?.count).toBe(
        ledger.filter((l) => l.status_class === "needs_review").length,
      );
    });

    it("A-02-TC-NF-03 the profile SHA-256 is stamped on every classification and every permit row", () => {
      const sha = readFileSync(join(ROOT, "profiles/travis-austin@1.0.0/DIGEST"), "utf8").trim();
      expect(digest()).toBe(sha);
      expect(PROFILE.sha256).toBe(sha);
      expect(classifyStatus("Expired").profile_sha256).toBe(sha);
      const expectations = JSON.parse(
        readFileSync(join(ROOT, "profiles/travis-austin@1.0.0/expectations.json"), "utf8"),
      ) as { rules_sha256: string };
      expect(expectations.rules_sha256).toBe(sha);
      const profiles = manifestJson().profiles as {
        name: string;
        version: string;
        sha256: string;
      }[];
      expect(profiles.find((p) => p.name === "travis-austin")).toMatchObject({
        version: "1.0.0",
        sha256: sha,
      });
      for (const row of viewRows("v_roofing_permit")) {
        expect(row.profile_sha256).toBe(sha);
        expect(row.profile_version).toBe("travis-austin@1.0.0");
      }
      expect(viewRows("v_run")[0]?.profile_sha256).toBe(sha);
    });
  });
}
