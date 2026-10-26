// A-13 T019 (AC-2, FR-002, FR-007, FR-022; TC-003, TC-016, TC-017): Coverage
// (`/tx/travis/coverage`). One card per record kind; every count is a manifest `coverage` key
// (`data-coverage-key`) under its derivation label, with the kind's collection time, source table
// and notes; a kind the section lacks says so with one short reason; each source row shows the
// records read at capture (or its `source_total:{source}` key) against its published rows, "—"
// where there are none. The manifest CID and run are said once per section (PO 2026-10-26).
// Fixture built in the test; fetches are vi.fn, no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { DERIVATION_LABELS } from "@countylens/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COVERAGE_KINDS,
  COVERAGE_KIND_MISSING,
  COVERAGE_NOT_PUBLISHED,
  COVERAGE_TOTAL_MISSING,
} from "../src/routes/Coverage.kinds";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

async function buildRun(extraCoverage: RunManifestV1["coverage"] = {}) {
  const cid = (seed: string): Promise<string> => rawCid(encode(seed));
  const permitsPart = await cid("permits part");
  const propertyPart = await cid("property part");
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "travis-test-coverage",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T08:00:00.000Z",
    finishedAt: "2026-10-21T08:10:00.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: null,
        captured_at: "2026-10-21T08:01:00.000Z",
        records: 5,
        added: 5,
        changed: 0,
        removed: 0,
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: null,
        captured_at: "2026-10-21T08:02:00.000Z",
        records: 3,
        added: 3,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "tables/property_improvement/property_improvement/part-00000.parquet",
        cid: permitsPart,
        codec: "raw",
        size: 10,
        sha256: "0".repeat(64),
        kind: "table",
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: propertyPart,
        codec: "raw",
        size: 10,
        sha256: "0".repeat(64),
        kind: "table",
      },
    ],
    profiles: [],
    coverage: {
      permits_emitted: { count: 5, derivation: "published_rows" },
      permits_captured: { count: 7, derivation: "capture_receipt", note: "test note" },
      parcels_published: { count: 3, derivation: "published_rows" },
      contractor_unresolved: { count: 5, derivation: "aggregate_match" },
      some_future_key: { count: 2, derivation: "aggregate_match" },
      ...extraCoverage,
    },
    limitations: [],
  };
  const bytes = encode(JSON.stringify(manifest));
  const manifestCid = await rawCid(bytes);
  const index = JSON.stringify({
    schema: RUNS_INDEX_SCHEMA,
    runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
  });
  return { manifest, bytes, manifestCid, index, permitsPart, propertyPart };
}

type Built = Awaited<ReturnType<typeof buildRun>>;

function install(built: Built): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/runs/index.json") return new Response(built.index);
      if (new URL(url).host === COPY_HOST) return new Response(built.bytes);
      throw new TypeError(`unexpected request ${url}`);
    }),
  );
}

async function renderCoverage(): Promise<void> {
  const { Component } = await import("../src/routes/Coverage");
  render(
    <MemoryRouter initialEntries={["/tx/travis/coverage"]}>
      <Component />
    </MemoryRouter>,
  );
}

const kind = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-kind="${id}"]`);
  expect(el, `kind ${id}`).not.toBeNull();
  return el as HTMLElement;
};

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", FILEBASE_HOST);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Coverage counts come only from the manifest (FR-002, TC-016)", () => {
  it("shows every coverage key once with its grouped count under its derivation label", async () => {
    const built = await buildRun({
      parcels_matched: { count: 12345, derivation: "aggregate_match" },
    });
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const keys = [...document.querySelectorAll<HTMLElement>("[data-coverage-key]")];
    expect(keys.map((k) => k.dataset["coverageKey"]).sort()).toEqual(
      Object.keys(built.manifest.coverage).sort(),
    );
    for (const el of keys) {
      const c = built.manifest.coverage[el.dataset["coverageKey"] ?? ""];
      const count = el.querySelector<HTMLElement>("[data-count]");
      expect(count?.dataset["count"]).toBe(String(c?.count));
      expect(count?.textContent).toBe(c?.count.toLocaleString("en-US"));
      const group = el.closest<HTMLElement>("[data-derivation]");
      expect(group?.dataset["derivation"]).toBe(c?.derivation);
      expect(
        within(group as HTMLElement).getByText(
          DERIVATION_LABELS[c?.derivation ?? "published_rows"],
        ),
      ).toBeDefined();
      // The derivation is said once per group, not on every row (PO 2026-10-26).
      expect(el.textContent).not.toContain(DERIVATION_LABELS[c?.derivation ?? "published_rows"]);
    }
    expect(screen.getByText("12,345")).toBeDefined();
    expect(screen.getByText("test note")).toBeDefined();
  });

  it("names the kind's source table with its CID and the collection time once, provenance once per section", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const permit = kind("permit");
    const table = permit.querySelector("[data-table]");
    expect(table?.getAttribute("data-table")).toBe("property_improvement/property_improvement");
    expect(table?.querySelector(`[data-cid="${built.permitsPart}"]`)).not.toBeNull();
    expect(permit.querySelectorAll("time[datetime]")).toHaveLength(1);
    expect(permit.textContent).toContain("2026-10-21 08:01:00 UTC");
    expect(permit.textContent).toContain("Austin building permits");
    expect(kind("property").querySelector(`[data-cid="${built.propertyPart}"]`)).not.toBeNull();
    const kinds = document.querySelector<HTMLElement>('[data-section="kinds"]');
    expect(kinds?.querySelectorAll(`[data-cid="${built.manifestCid}"]`)).toHaveLength(1);
    expect(kinds?.textContent).toContain(built.manifest.runId);
  });

  it("finds a full-county run's batched parts (`…/tables/bNN/<table>/…`), contractor links included", async () => {
    const built = await buildRun();
    const batched = (dir: string, table: string, cid: string) => ({
      name: `pipeline/data/runs/r3/${dir}/tables/b01/${table}/part-00000.parquet`,
      cid,
      codec: "raw" as const,
      size: 10,
      sha256: "0".repeat(64),
      kind: "table" as const,
    });
    const manifest: RunManifestV1 = {
      ...built.manifest,
      artifacts: [
        batched("county-batched", "property", built.propertyPart),
        batched("county-batched", "parcel", built.propertyPart),
        batched("permits-batched", "property_improvement", built.permitsPart),
        batched("permits-batched", "property_improvement_has_contractor", built.permitsPart),
      ],
    };
    const bytes = encode(JSON.stringify(manifest));
    const manifestCid = await rawCid(bytes);
    const index = JSON.stringify({
      schema: RUNS_INDEX_SCHEMA,
      runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
    });
    install({ ...built, manifest, bytes, manifestCid, index });
    await renderCoverage();
    await screen.findAllByRole("article");

    expect(kind("property").querySelector("[data-table]")?.getAttribute("data-table")).toBe(
      "county/property",
    );
    const contractor = kind("contractor").querySelector("[data-table]");
    expect(contractor?.getAttribute("data-table")).toBe(
      "property_improvement/property_improvement_has_contractor",
    );
    expect(contractor?.querySelector(`[data-cid="${built.permitsPart}"]`)).not.toBeNull();
  });
});

describe("Coverage gaps say why, once (FR-002, FR-007, TC-017)", () => {
  it("shows one short reason per record kind with no key, no stack of pills", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    for (const id of ["bbb", "business", "places", "coordinates"]) {
      const card = kind(id);
      expect(card.textContent).toContain(COVERAGE_KIND_MISSING);
      expect(card.querySelector("[data-coverage-key]")).toBeNull();
      expect(card.querySelector("[data-count]")).toBeNull();
      // PO 2026-10-26: a kind whose rows are published but not counted draws no pill.
      const published = id === "coordinates" && card.querySelector("[data-table]") !== null;
      expect(card.querySelectorAll("[data-status]"), `${id}: pills`).toHaveLength(
        published ? 0 : 1,
      );
      const reason = COVERAGE_KINDS.find((k) => k.id === id)?.reason;
      if (reason !== null && reason !== undefined) {
        expect(card.querySelector("[data-short]")?.getAttribute("data-short")).toBe(reason);
      }
    }
    expect(kind("bbb").querySelector("[data-short]")?.getAttribute("data-short")).toMatch(
      /bbb\.org blocks automated access/,
    );
  });

  it("binds each source's published rows against its records read, '—' where none", async () => {
    const built = await buildRun({ parcels_published: { count: 2, derivation: "published_rows" } });
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const region = screen.getByRole("region", { name: /own total/i });
    const tcad = region.querySelector<HTMLElement>('[data-denominator="tcad-2026-certified-json"]');
    expect(tcad?.querySelector("[data-records]")?.getAttribute("data-records")).toBe("3");
    expect(tcad?.querySelector("[data-published]")?.getAttribute("data-published")).toBe("2");
    expect(tcad?.querySelector("[data-published]")?.getAttribute("data-published-key")).toBe(
      "parcels_published",
    );
    expect(tcad?.textContent).toContain("66.7%");
    expect(tcad?.textContent).toContain("TCAD 2026 certified roll");
    const austin = region.querySelector<HTMLElement>('[data-denominator="austin-3syk-w9eu"]');
    expect(austin?.querySelector("[data-published]")?.getAttribute("data-published")).toBe("5");
    expect(austin?.textContent).toContain("100.0%");
    // No hatched bar and no long pill in the source table.
    expect(region.querySelector("[data-status]")).toBeNull();
  });

  it("shows '—' and a short reason for a source with no published rows", async () => {
    const built = await buildRun();
    const manifest: RunManifestV1 = {
      ...built.manifest,
      sources: [
        ...built.manifest.sources,
        {
          name: "austin-address-points",
          url: "https://services.arcgis.com/x/FeatureServer/0",
          watermark: null,
          captured_at: "2026-10-21T08:03:00.000Z",
          records: 9,
          added: 9,
          changed: 0,
          removed: 0,
          limitations: [],
        },
      ],
    };
    const bytes = encode(JSON.stringify(manifest));
    const manifestCid = await rawCid(bytes);
    const index = JSON.stringify({
      schema: RUNS_INDEX_SCHEMA,
      runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
    });
    install({ ...built, manifest, bytes, manifestCid, index });
    await renderCoverage();
    await screen.findAllByRole("article");

    const row = document.querySelector<HTMLElement>('[data-denominator="austin-address-points"]');
    expect(row?.textContent).toContain("—");
    expect(row?.textContent).toContain(COVERAGE_NOT_PUBLISHED);
    expect(row?.querySelector("[data-published]")).toBeNull();
    expect(row?.querySelector("progress")).toBeNull();
  });

  it("uses a `source_total:{source}` key as the source's total when present", async () => {
    const built = await buildRun({
      "source_total:austin-3syk-w9eu": { count: 4321, derivation: "capture_receipt" },
    });
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const region = screen.getByRole("region", { name: /own total/i });
    const row = region.querySelector<HTMLElement>('[data-denominator="austin-3syk-w9eu"]');
    expect(row?.querySelector("[data-count]")?.getAttribute("data-count")).toBe("4321");
    expect(row?.textContent).toContain("4,321");
    expect(
      document.querySelector('[data-coverage-key="source_total:austin-3syk-w9eu"]'),
    ).toBeNull();
  });

  it("draws Coverage by area as one line, not a hatched panel", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const area = document.querySelector<HTMLElement>('[data-section="by-area"]');
    expect(area?.querySelectorAll("[data-status]")).toHaveLength(1);
    expect(area?.textContent).toContain("no per-area counts");
  });
});

describe("Each kind card shows its own source and denominator (FR-002, AC-2)", () => {
  it("says the source, records read and the missing total in one line per kind", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const expected: Record<string, string> = {
      property: "tcad-2026-certified-json",
      ownership: "tcad-2026-certified-json",
      permit: "austin-3syk-w9eu",
      contractor: "austin-3syk-w9eu",
      coordinates: "tcad-2026-certified-json",
      bbb: "none",
      business: "none",
      places: "none",
    };
    for (const [id, source] of Object.entries(expected)) {
      const el = kind(id).querySelectorAll<HTMLElement>("[data-kind-denominator]");
      expect(el, `denominator in ${id}`).toHaveLength(1);
      expect(el[0]?.getAttribute("data-kind-denominator")).toBe(source);
      if (source !== "none") expect(el[0]?.textContent).toContain(COVERAGE_TOTAL_MISSING);
    }
    expect(kind("property").querySelector("[data-kind-denominator]")?.textContent).toContain(
      "3 records read",
    );
  });

  it("shows the manifest's source_total value and derivation label in the kind card", async () => {
    const built = await buildRun({
      "source_total:austin-3syk-w9eu": { count: 4321, derivation: "capture_receipt" },
    });
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    for (const id of ["permit", "contractor"]) {
      const el = kind(id).querySelector<HTMLElement>("[data-kind-denominator]");
      expect(el?.getAttribute("data-kind-denominator")).toBe("austin-3syk-w9eu");
      expect(el?.textContent).toContain("4,321");
      expect(el?.textContent).toContain(DERIVATION_LABELS["capture_receipt"]);
      expect(el?.textContent).toContain("2026-10-21 08:01:00 UTC");
      expect(el?.textContent).not.toContain(COVERAGE_TOTAL_MISSING);
    }
    expect(kind("property").querySelector("[data-kind-denominator]")?.textContent).toContain(
      COVERAGE_TOTAL_MISSING,
    );
  });
});

describe("Coverage errors (FR-021, TC-013)", () => {
  it("says `Manifest unavailable · {cid} · {reason}` when no host serves the manifest", async () => {
    const built = await buildRun();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/runs/index.json") return new Response(built.index);
        return new Response(null, { status: 503 });
      }),
    );
    await renderCoverage();
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-error-text]")?.textContent).toMatch(
      new RegExp(`^Manifest unavailable · ${built.manifestCid} · .+`),
    );
    expect(document.querySelector("[data-coverage-key]")).toBeNull();
  });
});
