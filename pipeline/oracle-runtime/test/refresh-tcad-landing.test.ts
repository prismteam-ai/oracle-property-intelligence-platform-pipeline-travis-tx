// Certification-date refresh from the TCAD public-information page (PO decision 2026-10-20,
// FR-003a). Every page, catalog value and receipt here is synthetic (test-only): an injected
// fetch serves an invented page, traviscad.org is never called, and the validator is an
// injected stand-in. A temporary repository root holds the catalog and the saved page.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Catalog } from "../travis/discovery/catalog.schema.js";
import { TCAD_PUBLIC_INFO_URL } from "../travis/discovery/probes/tcad.js";
import {
  CERTIFICATION_METHOD,
  refreshTcadLanding,
} from "../travis/discovery/refresh-tcad-landing.js";
import { readCatalog, writeCatalog } from "../travis/discovery/write-catalog.js";
import { createSourceClient, USER_AGENT } from "../travis/lib/source-client.js";
import { fakeHttp, silent, text, type Route } from "./fixtures/fake-http.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const CATALOG_REL = "pipeline/docs/travis-sources.yaml";
const RAW_REL = "pipeline/data/raw/tcad";
const FIXED = new Date("2026-02-03T04:05:06.000Z");

const PAGE_WITH_DATE = `<!doctype html><html><body>
<p>The 2026 appraisal roll was certified on July 24, 2026.</p>
<a href="/f/2026%20Certified%20JSON%2007182026.zip">2026 Certified Special Export</a>
</body></html>`;
// The only date on this page sits in an export file name: it must NOT become the date.
const PAGE_WITHOUT_DATE = `<!doctype html><html><body>
<p>Download the appraisal exports below.</p>
<a href="/f/2026%20Certified%20JSON%2007182026.zip">2026 Certified JSON SUPP 0 07182026</a>
</body></html>`;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture(): { root: string; catalogPath: string } {
  const root = mkdtempSync(join(tmpdir(), "refresh-tcad-landing-"));
  tmpDirs.push(root);
  const cat = syntheticCatalog();
  const { certification_date: _drop, ...parcel } = must(cat.parcel, "parcel");
  cat.parcel = parcel;
  const catalogPath = join(root, CATALOG_REL);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeCatalog(cat, catalogPath);
  return { root, catalogPath };
}

function run(
  f: { root: string; catalogPath: string },
  routes: Record<string, () => Response>,
  extra: { htmlPath?: string; validatorCode?: number; egressRefusal?: string } = {},
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
  const done = refreshTcadLanding({
    repoRoot: f.root,
    catalogPath: f.catalogPath,
    client,
    ...(extra.htmlPath ? { htmlPath: extra.htmlPath } : {}),
    egress: async () => {
      egressChecks += 1;
      return extra.egressRefusal
        ? { ok: false as const, reason: extra.egressRefusal }
        : {
            ok: true as const,
            egress: { country: "EG", captured_at: FIXED.toISOString(), method: "trace" },
          };
    },
    now: () => FIXED,
    validate: async () => {
      validatorCalls += 1;
      return extra.validatorCode ?? 0;
    },
    out: (l) => lines.push(l),
  });
  return done.then((code) => ({
    code,
    lines,
    http,
    validatorCalls: () => validatorCalls,
    egressChecks: () => egressChecks,
  }));
}

const parcelOf = (c: Catalog) => must(c.parcel, "parcel");
const strip = (c: Catalog) => {
  const { certification_date: _d, certification_date_measurement: _m, ...rest } = parcelOf(c);
  const { amendments: _a, ...cat } = c;
  return { ...cat, parcel: rest };
};

describe("refreshTcadLanding", () => {
  it("makes ONE identified request, saves the page, records the date with provenance, re-runs the validator", async () => {
    const f = fixture();
    const before = readCatalog(f.catalogPath);
    const { code, http, validatorCalls } = await run(f, {
      [TCAD_PUBLIC_INFO_URL]: () => text(PAGE_WITH_DATE),
    });
    expect(code).toBe(0);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.url).toBe(TCAD_PUBLIC_INFO_URL);
    expect(new Headers(http.calls[0]?.init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(validatorCalls()).toBe(1);

    const after = readCatalog(f.catalogPath);
    const p = parcelOf(after);
    expect(p.certification_date).toBe("2026-07-24");
    const m = must(p.certification_date_measurement, "certification_date_measurement");
    expect(m).toMatchObject({
      value: "2026-07-24",
      source_url: TCAD_PUBLIC_INFO_URL,
      captured_at: FIXED.toISOString(),
      method: CERTIFICATION_METHOD,
    });
    expect(m.missing_reason).toBeUndefined();
    // the saved page is gitignored raw data under pipeline/data/raw/tcad/ and matches the digest
    expect(m.page_path).toMatch(/^pipeline\/data\/raw\/tcad\/publicinformation-[0-9TZ]+\.html$/);
    const saved = readFileSync(join(f.root, must(m.page_path)), "utf8");
    expect(saved).toBe(PAGE_WITH_DATE);
    expect(m.page_sha256).toMatch(/^[0-9a-f]{64}$/);
    // nothing else in the catalog changed
    expect(strip(after)).toEqual(strip(before));
  });

  it("records the date as missing with the reason when the page states none (never the file-name date)", async () => {
    const f = fixture();
    const { code } = await run(f, {
      [TCAD_PUBLIC_INFO_URL]: () => text(PAGE_WITHOUT_DATE),
    });
    expect(code).toBe(0);
    const p = parcelOf(readCatalog(f.catalogPath));
    expect(p.certification_date).toBeUndefined();
    const m = must(p.certification_date_measurement);
    expect(m.value).toBeNull();
    expect(m.missing_reason).toMatch(/does not state a certification date/);
    expect(m.missing_reason).toMatch(/file name/);
    expect(JSON.stringify(p)).not.toContain("2026-07-18");
  });

  it("refuses on a blocked page: one attempt only, nothing written, no validator", async () => {
    const f = fixture();
    const before = readFileSync(f.catalogPath, "utf8");
    const { code, http, validatorCalls, lines } = await run(f, {
      [TCAD_PUBLIC_INFO_URL]: () => text("Forbidden", 403, { "content-type": "text/plain" }),
    });
    expect(code).toBe(2);
    expect(http.calls).toHaveLength(1);
    expect(validatorCalls()).toBe(0);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(lines.join("\n")).toMatch(/refused/);
  });

  it("does not retry a 429 (one identified request, attempt budget 1)", async () => {
    const f = fixture();
    const { code, http } = await run(f, {
      [TCAD_PUBLIC_INFO_URL]: () => text("slow down", 429, { "content-type": "text/plain" }),
    });
    expect(code).toBe(2);
    expect(http.calls).toHaveLength(1);
  });

  it("re-parses a saved page offline (--html) with the saved receipt's provenance, no request", async () => {
    const f = fixture();
    const first = await run(f, { [TCAD_PUBLIC_INFO_URL]: () => text(PAGE_WITH_DATE) });
    expect(first.code).toBe(0);
    const m1 = must(parcelOf(readCatalog(f.catalogPath)).certification_date_measurement);
    const pagePath = join(f.root, must(m1.page_path));
    expect(existsSync(`${pagePath}.receipt.json`)).toBe(true);

    const again = await run(f, {}, { htmlPath: pagePath });
    expect(again.code).toBe(0);
    expect(again.http.calls).toHaveLength(0);
    const m2 = must(parcelOf(readCatalog(f.catalogPath)).certification_date_measurement);
    expect(m2).toEqual(m1);
    expect(readdirSync(join(f.root, RAW_REL)).filter((n) => n.endsWith(".html"))).toHaveLength(1);
  });

  it("refuses an offline page that has no saved receipt", async () => {
    const f = fixture();
    const { code, lines } = await run(f, {}, { htmlPath: join(f.root, "nope.html") });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/receipt/);
  });

  it("passes the validator's exit code through (1 = BLOCKED for another gate)", async () => {
    const f = fixture();
    const { code } = await run(
      f,
      { [TCAD_PUBLIC_INFO_URL]: () => text(PAGE_WITH_DATE) },
      { validatorCode: 1 },
    );
    expect(code).toBe(1);
  });

  it("OR-B1: refuses before any request when the egress check fails; nothing written", async () => {
    const f = fixture();
    const before = readFileSync(f.catalogPath, "utf8");
    const r = await run(
      f,
      { [TCAD_PUBLIC_INFO_URL]: () => text(PAGE_WITH_DATE) },
      { egressRefusal: "egress country is GB, but the run recorded EG; nothing was sent" },
    );
    expect(r.code).toBe(2);
    expect(r.http.calls).toHaveLength(0);
    expect(readFileSync(f.catalogPath, "utf8")).toBe(before);
    expect(r.lines.join("\n")).toMatch(/refused: egress country is GB/);
  });

  it("OR-M5: records an amendment with the egress country; --html makes no egress check", async () => {
    const f = fixture();
    const r = await run(f, { [TCAD_PUBLIC_INFO_URL]: () => text(PAGE_WITH_DATE) });
    expect(r.code).toBe(0);
    const amendment = must(readCatalog(f.catalogPath).amendments?.at(-1));
    expect(amendment.command).toBe("refresh-tcad-landing");
    expect(amendment.egress_country).toBe("EG");
    expect(amendment.fields).toContain("parcel.certification_date_measurement");
    expect(r.egressChecks()).toBe(1);
  });
});
