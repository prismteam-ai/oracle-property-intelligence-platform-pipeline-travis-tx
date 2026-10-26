// A-13 T036 (G3): Data · Catalog (`/data/catalog`), US8, AC-10, FR-010, FR-019, FR-024; TC-053,
// TC-054. One row per table of the latest manifest's artifacts; columns and row counts come from
// the Parquet footers (mocked here at the readParquetFooter seam: hyparquet's own reads are
// covered by data-modules tests); nothing is cached or sampled.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { PAGE_TEXTS, ROUTES } from "@countylens/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const COPY_HOST = "copy.example.test";
const SHA = "0".repeat(64);
const encode = (t: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(t);

const footer = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/data/parquet-meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/data/parquet-meta")>();
  // readTableMeta mirrors the real one (columns from part 1, rows summed over the parts, one
  // after another) on top of the mocked footer reader; its Range guard and caps are covered by
  // data-caps.test.ts.
  const readTableMeta: typeof actual.readTableMeta = async (parts, urlOf, options) => {
    const [first, ...rest] = parts;
    if (first === undefined) throw new Error("the table has no part in the manifest");
    const head = await footer.read(urlOf(first), first.size, options);
    let rows: number = head.rows;
    for (const part of rest) rows += (await footer.read(urlOf(part), part.size, options)).rows;
    return { columns: head.columns, rows };
  };
  return { ...actual, readParquetFooter: footer.read, readTableMeta };
});

interface Fixture {
  manifest: RunManifestV1;
  bytes: Uint8Array<ArrayBuffer>;
  cid: string;
  parts: { name: string; cid: string }[];
}
let fx: Fixture;

async function build(
  withExport: boolean,
  extra: readonly string[] = [],
  dirs: readonly string[] = ["tables/county"],
): Promise<Fixture> {
  const names = [
    "tables/county/property/part-00000.parquet",
    "tables/county/property/part-00001.parquet",
    "tables/property_improvement/property_improvement/part-00000.parquet",
    ...extra,
  ];
  const parts = await Promise.all(
    names.map(async (name) => ({ name, cid: await rawCid(encode(name)) })),
  );
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "test-run",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T08:00:00.000Z",
    finishedAt: "2026-10-21T08:12:34.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "tcad-2026-certified-json",
        url: "https://example.test/source",
        watermark: null,
        captured_at: "2026-10-21T08:05:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      ...(await Promise.all(
        dirs.map(async (name) => ({
          name,
          cid: await rawCid(encode(`dir ${name}`)),
          codec: "dag-pb" as const,
          size: 5,
          sha256: SHA,
          kind: "directory" as const,
          carCid: await rawCid(encode(`dir-car ${name}`)),
        })),
      )),
      ...parts.map((p, i) => ({
        name: p.name,
        cid: p.cid,
        codec: "raw" as const,
        size: 100 + i,
        sha256: SHA,
        kind: "table" as const,
      })),
      ...(withExport
        ? [
            {
              name: "tables-export.json",
              cid: await rawCid(encode("export")),
              codec: "raw" as const,
              size: 9,
              sha256: SHA,
              kind: "table" as const,
            },
          ]
        : []),
    ],
    profiles: [],
    coverage: {
      parcels_emitted: { count: 7, derivation: "published_rows" },
      permits_captured: { count: 99, derivation: "capture_receipt" },
    },
    limitations: [],
  };
  const bytes = encode(JSON.stringify(manifest));
  return { manifest, bytes, cid: await rawCid(bytes), parts };
}

beforeAll(async () => {
  fx = await build(false);
});

function install(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/runs/index.json") {
        return new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: [{ runId: "test-run", manifestCid: fx.cid, finishedAt: fx.manifest.finishedAt }],
          }),
        );
      }
      if (new URL(url).host === COPY_HOST && url.includes(fx.cid)) return new Response(fx.bytes);
      return new Response("x", { status: 503 });
    }),
  );
}

async function renderCatalog(): Promise<HTMLElement> {
  const { Component } = await import("../src/routes/DataCatalog");
  render(
    <MemoryRouter initialEntries={["/data/catalog"]}>
      <Component />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Data · Catalog" });
}

/** A-16 board: clicking a table's list row shows its header card and field table on the right. */
function detailOf(page: HTMLElement, table: string): HTMLElement {
  const row = page.querySelector<HTMLElement>(`[data-table="${table}"]`);
  expect(row, table).not.toBeNull();
  fireEvent.click(row as HTMLElement);
  const detail = page.querySelector<HTMLElement>(`[data-catalog-detail="${table}"]`);
  expect(detail, `${table} detail`).not.toBeNull();
  return detail as HTMLElement;
}

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", "ipfs.filebase.io");
  footer.read.mockReset();
  footer.read.mockImplementation(async (url: string) =>
    url.includes(fx.parts[2]?.cid ?? "")
      ? { columns: [{ name: "improvement_type", type: "STRING" }], rows: 4 }
      : {
          columns: [
            { name: "parcel_identifier", type: "STRING" },
            { name: "year_built", type: "INT_32" },
          ],
          rows: 10,
        },
  );
  install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Catalog: one row per table (TC-053)", () => {
  it("lists each table of the manifest once, with CIDs linking to Verify, size and sums", async () => {
    const page = await renderCatalog();
    const rows = await vi.waitFor(() => {
      const found = page.querySelectorAll<HTMLElement>("[data-table]");
      expect(found.length).toBe(2);
      expect(page.querySelectorAll("[data-rows]").length).toBe(2);
      expect(page.getAttribute("data-state")).toBe("ready");
      return found;
    });
    const property = [...rows].find((r) => r.getAttribute("data-table") === "county.property");
    expect(property).toBeDefined();
    // Two parts of 100 and 101 bytes; footers say 10 rows each: the list row shows the sum.
    expect(property?.querySelector("[data-rows]")?.getAttribute("data-value")).toBe("20");
    const p = detailOf(page, "county.property");
    expect(within(p).getByText("parcel_identifier")).toBeTruthy();
    expect(within(p).getByText("year_built")).toBeTruthy();
    const hrefs = [...p.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const part of fx.parts.slice(0, 2)) expect(hrefs).toContain(`/data/verify/${part.cid}`);
    expect(p.textContent).toContain("201");
  });

  it("shows published_rows beside it where a coverage key maps to the table", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() =>
      expect(page.getAttribute("data-state"), page.textContent ?? "").toBe("ready"),
    );
    const p = detailOf(page, "county.property");
    expect(p.textContent).toContain("published_rows");
    expect(p.querySelector('[data-coverage-key="parcels_emitted"]')?.textContent).toContain("7");
    const other = detailOf(page, "property_improvement.property_improvement");
    expect(other.textContent).not.toContain("published_rows");
  });

  it("says the table export is not in this run's manifest while there is no tables-export.json", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(screen.getByText(PAGE_TEXTS.tableExportMissing)).toBeTruthy();
  });

  it("does not say it when the manifest lists tables-export.json", async () => {
    fx = await build(true);
    install();
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(screen.queryByText(PAGE_TEXTS.tableExportMissing)).toBeNull();
    fx = await build(false);
  });

  it("does not say it when the run ships batched table directories (Run 3.1 layout)", async () => {
    fx = await build(
      false,
      [],
      [
        "pipeline/data/runs/r/publish/county-batched/tables/b01",
        "pipeline/data/runs/r/publish/permits-batched/tables/b02",
      ],
    );
    install();
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(screen.queryByText(PAGE_TEXTS.tableExportMissing)).toBeNull();
    fx = await build(false);
  });

  it("reads each footer from the CID copy host, never from a gateway fallback list", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    // The footers are read after `ready` (ERR-41, concurrency 2): wait for all three.
    await vi.waitFor(() => expect(footer.read.mock.calls.length).toBe(3));
    const urls = footer.read.mock.calls.map((c) => String(c[0]));
    for (const url of urls) expect(new URL(url).host).toBe(COPY_HOST);
  });

  it("shows the progress bar only until the manifest is loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const page = await renderCatalog();
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    expect(page.getAttribute("data-state")).toBe("loading");
  });
});

describe("Catalog: field table and derived columns (A-16, DataCatalog1440 board)", () => {
  const cells = (detail: HTMLElement, field: string): string[] =>
    [...(detail.querySelector(`[data-column][data-name="${field}"]`)?.children ?? [])].map(
      (c) => c.textContent ?? "",
    );

  it("names each field's meaning, source and licence from contract/v1, or says it is not described", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.querySelectorAll("[data-rows]").length).toBe(2));
    const property = detailOf(page, "county.property");
    expect(cells(property, "parcel_identifier")).toEqual([
      "parcel_identifier",
      "STRING",
      "Parcel identifier",
      "tcad-2026-certified-json",
      "[As published]",
    ]);
    expect(cells(property, "year_built")[2]).toBe("not described in the data contract");
    const permit = detailOf(page, "property_improvement.property_improvement");
    expect(cells(permit, "improvement_type").slice(2)).toEqual([
      "Lexicon improvement type",
      "Derived: source profile",
      "[Derived]",
    ]);
    const derived = permit.querySelector('[data-derived-view="v_roofing_permit"]');
    expect(derived?.textContent).toContain("v_roofing_permit reads this table and adds");
    expect(derived?.textContent).toContain("status_class (open, stalled, closed)");
    expect(derived?.textContent).not.toContain("improvement_type");
  });
});

describe("Catalog: progressive render (ERR-41, NFR-002)", () => {
  const NEVER = (): Promise<never> => new Promise(() => undefined);
  const improvementCid = (): string => fx.parts[2]?.cid ?? "";

  it("paints the table list from the manifest while no footer has resolved", async () => {
    footer.read.mockImplementation(NEVER);
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(page.querySelectorAll("[data-catalog-row]")).toHaveLength(2);
    const p = detailOf(page, "county.property");
    expect(p.querySelector("[data-size]")?.getAttribute("data-value")).toBe("201");
    for (const part of fx.parts.slice(0, 2)) {
      expect(p.querySelector(`a[data-cid="${part.cid}"]`)?.getAttribute("href")).toBe(
        `/data/verify/${part.cid}`,
      );
    }
    // published_rows still shows where a coverage key maps to the table.
    expect(p.querySelector('[data-coverage-key="parcels_emitted"]')?.textContent).toContain("7");
    // Pending rows claim neither a row count nor columns, and say what they wait for.
    expect(page.querySelectorAll("[data-rows]")).toHaveLength(0);
    expect(page.querySelectorAll("[data-column]")).toHaveLength(0);
    expect(page.querySelectorAll("[data-footer-status='pending']").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(p.textContent).toContain("reading the Parquet footer");
    expect(page.querySelector("[role='alert']")).toBeNull();
  });

  it("fills in only the table whose footer arrived; the others stay pending", async () => {
    footer.read.mockImplementation((url: string) =>
      url.includes(improvementCid())
        ? Promise.resolve({ columns: [{ name: "improvement_type", type: "STRING" }], rows: 4 })
        : NEVER(),
    );
    const page = await renderCatalog();
    await vi.waitFor(() => {
      const el = page.querySelector<HTMLElement>(
        '[data-table="property_improvement.property_improvement"]',
      );
      expect(el?.querySelector("[data-rows]")?.getAttribute("data-value")).toBe("4");
    });
    const done = detailOf(page, "property_improvement.property_improvement");
    expect(done.querySelector("[data-column]")?.getAttribute("data-name")).toBe("improvement_type");
    const pendingRow = page.querySelector<HTMLElement>(
      '[data-table="county.property"]',
    ) as HTMLElement;
    expect(pendingRow.querySelector("[data-rows]")).toBeNull();
    expect(pendingRow.querySelector("[data-footer-status='pending']")).not.toBeNull();
    const pending = detailOf(page, "county.property");
    expect(pending.querySelector("[data-column]")).toBeNull();
    expect(pending.querySelector("[data-footer-status='pending']")).not.toBeNull();
    expect(page.getAttribute("data-state")).toBe("ready");
  });

  it("a failed footer says why on its row while the others stay pending", async () => {
    footer.read.mockImplementation((url: string) =>
      url.includes(improvementCid()) ? Promise.reject(new Error("range read failed")) : NEVER(),
    );
    const page = await renderCatalog();
    const bad = (await vi.waitFor(() => {
      const el = page.querySelector<HTMLElement>(
        '[data-table="property_improvement.property_improvement"]',
      );
      expect(el?.textContent).toContain("range read failed");
      return el;
    })) as HTMLElement;
    expect(bad.querySelector("[data-footer-status='pending']")).toBeNull();
    const other = page.querySelector<HTMLElement>('[data-table="county.property"]') as HTMLElement;
    expect(other.querySelector("[data-footer-status='pending']")).not.toBeNull();
    expect(other.textContent).not.toContain("range read failed");
    expect(page.getAttribute("data-state")).toBe("ready");
  });

  it("CLS guard: the pending and the filled columns slot share one reserved-height class", async () => {
    footer.read.mockImplementation((url: string) =>
      url.includes(improvementCid())
        ? Promise.resolve({ columns: [{ name: "improvement_type", type: "STRING" }], rows: 4 })
        : NEVER(),
    );
    const page = await renderCatalog();
    await vi.waitFor(() =>
      expect(
        page.querySelector("[data-table='property_improvement.property_improvement'] [data-rows]"),
      ).not.toBeNull(),
    );
    const slotOf = (table: string): string =>
      (detailOf(page, table).querySelector("[data-columns-slot]") as HTMLElement).className;
    const filled = slotOf("property_improvement.property_improvement");
    const pending = slotOf("county.property");
    expect(filled).not.toBe("");
    expect(pending).toBe(filled);
    const css = readFileSync(
      resolve(import.meta.dirname, "../src/routes/DataCatalog.module.css"),
      "utf8",
    );
    expect(css).toMatch(/\.columnsSlot\s*\{[^}]*min-height:\s*var\(--space-/);
  });
});

describe("Catalog: valid definition lists (TC-083, ERR-33)", () => {
  it("every child of each dl is a dt/dd or a div holding only dt/dd, and keeps its data hooks", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    const lists = page.querySelectorAll("dl");
    expect(lists.length).toBeGreaterThan(0);
    for (const dl of lists) {
      for (const child of Array.from(dl.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === "div") {
          const kids = Array.from(child.children).map((k) => k.tagName.toLowerCase());
          expect(kids.length).toBeGreaterThan(0);
          for (const k of kids) expect(["dt", "dd"]).toContain(k);
          expect(kids).toContain("dt");
          expect(kids).toContain("dd");
        } else {
          expect(["dt", "dd"]).toContain(tag);
        }
      }
    }
    const p = detailOf(page, "county.property");
    expect(p.querySelector("[data-size]")?.getAttribute("data-value")).toBe("201");
    const listRow = page.querySelector<HTMLElement>('[data-table="county.property"]');
    // `ready` means the table list is painted; a row's count arrives with ITS footer (ERR-41), so
    // wait for it instead of reading it at once (a race that only loses on a loaded machine, CI).
    await vi.waitFor(() =>
      expect(listRow?.querySelector("[data-rows]")?.getAttribute("data-value")).toBe("20"),
    );
    expect(p.querySelector("[data-published-rows]")?.getAttribute("data-value")).toBe("7");
  });
});

describe("Catalog: unavailable (TC-054)", () => {
  it("every footer unreadable → Catalog unavailable · {reason} with a manifest link, no rows", async () => {
    footer.read.mockRejectedValue(new Error("copy.example.test answered 503"));
    const page = await renderCatalog();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      PAGE_TEXTS.catalogUnavailable("copy.example.test answered 503"),
    );
    expect(
      within(alert)
        .getByRole("link", { name: /manifest/i })
        .getAttribute("href"),
    ).toBe(ROUTES.dataManifest);
    expect(page.getAttribute("data-state")).toBe("error");
    expect(page.querySelectorAll("[data-table]")).toHaveLength(0);
  });

  it("an unreadable run index → Catalog unavailable with a non-empty reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 404 })),
    );
    const page = await renderCatalog();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^Catalog unavailable · .+/);
    expect(page.querySelectorAll("[data-table]")).toHaveLength(0);
  });

  it("one table's footer failing keeps the others and says why on its row", async () => {
    footer.read.mockImplementation(async (url: string) => {
      if (url.includes(fx.parts[2]?.cid ?? "")) throw new Error("range read failed");
      return { columns: [{ name: "parcel_identifier", type: "STRING" }], rows: 10 };
    });
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    const bad = page.querySelector<HTMLElement>(
      '[data-table="property_improvement.property_improvement"]',
    ) as HTMLElement;
    // The failing table says why once ITS footer has been attempted (ERR-41: per-table state).
    await vi.waitFor(() => expect(bad.textContent).toContain("range read failed"));
    expect(page.querySelectorAll("[data-table]")).toHaveLength(2);
  });
});

describe("Catalog: unclassified table parts (A13-7, CR-A-13 finding 4)", () => {
  it("counts the parts whose export batch has no known data group, with the reason", async () => {
    fx = await build(false, [
      "tables/mystery/unknown_table/part-00000.parquet",
      "tables/mystery/unknown_table/part-00001.parquet",
    ]);
    try {
      const page = await renderCatalog();
      await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
      const row = page.querySelector<HTMLElement>("[data-unclassified-parts]");
      expect(row).not.toBeNull();
      expect(row?.getAttribute("data-unclassified-parts")).toBe("2");
      expect(row?.textContent).toContain("unclassified table parts (2)");
      expect(row?.textContent).toMatch(/no known data group/);
      expect(page.querySelectorAll("[data-table]").length).toBe(2);
    } finally {
      fx = await build(false);
    }
  });

  it("shows no unclassified row when every part has a data group", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(page.querySelector("[data-unclassified-parts]")).toBeNull();
  });
});

describe("Catalog: find a table or field (A-16 T050, DataCatalog1440 board)", () => {
  it("filters the tables by table name or by a field in their footer", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.querySelectorAll("[data-rows]").length).toBe(2));
    const names = (): (string | null)[] =>
      [...page.querySelectorAll("[data-table]")].map((t) => t.getAttribute("data-table"));
    const find = screen.getByLabelText("Find a table or field");
    fireEvent.change(find, { target: { value: "improvement_type" } });
    expect(names()).toEqual(["property_improvement.property_improvement"]);
    fireEvent.change(find, { target: { value: "county.prop" } });
    expect(names()).toEqual(["county.property"]);
    fireEvent.change(find, { target: { value: "nothing_like_this" } });
    expect(names()).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain("nothing_like_this");
    fireEvent.change(find, { target: { value: "" } });
    expect(screen.getByRole("link", { name: "Search in Explore" }).getAttribute("href")).toBe(
      "/tx/travis/explore",
    );
  });
});
