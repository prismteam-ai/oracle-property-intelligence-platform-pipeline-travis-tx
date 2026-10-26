// A-13 T024 (AC-4, AC-7, FR-004, FR-004a, FR-006a, FR-007, FR-015, FR-022; TC-008, TC-025 …
// TC-029, TC-033, TC-043): Explore · Filters (`/tx/travis/explore`). Searches go to
// `explore.search` through packages/api-client (mocked here) with a 250 ms debounce; the engine
// line reads "DuckDB on the server · same views"; the header reads "{n} within {r} mi of {place} ·
// roof ≥ {years} yrs"; each row shows its fields, provenance and the exact missing-reason texts;
// URL state drives every control, `view=map` falls back to the list; zero results show Close
// matches with "+{miles_outside} mi". Rows are built in the test (never shown as real data).
import { RUNS_INDEX_SCHEMA } from "@countylens/contract";
import { rawCid, resolvePlace, type ExploreResult, type ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { QueryClient, QueryClientProvider, skipToken } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  search: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@countylens/api-client/react", () => ({
  useTRPC: () => ({
    explore: {
      search: {
        queryOptions: (input: unknown) => ({
          queryKey: ["explore", "search", input],
          queryFn:
            input === skipToken ? skipToken : () => api.search(input as Record<string, unknown>),
        }),
      },
    },
  }),
}));

const encode = (t: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(t);
let manifestCid: string;
let tableCid: string;
let propertyCids: string[];

beforeAll(async () => {
  manifestCid = await rawCid(encode("explore manifest"));
  tableCid = await rawCid(encode("explore table"));
  propertyCids = await Promise.all([1, 2, 3].map((n) => rawCid(encode(`property ${n}`))));
});

function makeRow(i: number, over: Partial<ExploreRow> = {}): ExploreRow {
  return {
    property_cid: propertyCids[i] ?? "",
    address: null,
    dist_mi: 1.25 + i,
    bearing: "NE",
    lat: 30.45,
    lon: -97.6,
    roof_age_years: 18,
    roof_age_basis: "permit_anchor",
    roof_age_confidence: "high",
    permit: null,
    contractor: null,
    bbb_status: null,
    bbb_status_reason: null,
    tenure_years: 12,
    tenure_basis: "latest_dated_sale",
    owner_area_class: "travis",
    provenance: {
      cid: propertyCids[i] ?? "",
      source_url: "https://traviscad.org/publicinformation",
      captured_at: "2026-10-21T08:02:00.000Z",
      table: "county/property",
      table_cid: tableCid,
      run_id: "travis-test-explore",
      manifest_cid: manifestCid,
      as_of: "2026-10-21",
    },
    missing: [{ field: "address", reason: "not_in_export" }],
    ...over,
  };
}

function result(rows: ExploreRow[], over: Partial<ExploreResult> = {}): ExploreResult {
  return {
    total_within_r: rows.length,
    tenure_unknown: 0,
    rows,
    close_matches: [],
    as_of: { runId: "travis-test-explore", manifestCid, finishedAt: "2026-10-21T08:10:00.000Z" },
    area: { label: "test", lat: 30.45, lon: -97.6 },
    engine: "server",
    queryDurationMs: 5,
    ...over,
  };
}

let lastLocation = "";
function LocationProbe(): null {
  const location = useLocation();
  lastLocation = `${location.pathname}${location.search}`;
  return null;
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderExplore(search: string): Promise<void> {
  const { Component } = await import("../src/routes/Explore");
  render(
    <Providers>
      <MemoryRouter initialEntries={[`/tx/travis/explore${search}`]}>
        <Routes>
          <Route path="/tx/travis/explore" element={<Component />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
}

beforeEach(() => {
  api.search.mockReset();
  api.search.mockImplementation(async () => result([makeRow(0), makeRow(1)]));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: [
              { runId: "travis-test-explore", manifestCid, finishedAt: "2026-10-21T08:10:00.000Z" },
            ],
          }),
        ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const header = (): HTMLElement | null => document.querySelector("[data-explore-header]");
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-result-row]")];
const field = (el: HTMLElement, name: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-field="${name}"]`);

describe("Explore · Filters search and header (AC-4, FR-004, FR-006a)", () => {
  it("searches the bound run on the server and shows the header and the server engine line", async () => {
    await renderExplore("?place=pflugerville&r=5&roof=15");
    await waitFor(() =>
      expect(header()?.textContent).toBe(EXPLORE_TEXTS.header(2, 5, "Pflugerville", 15)),
    );
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(api.search.mock.calls[0]?.[0]).toMatchObject({
      manifestCid,
      area: { place: "pflugerville" },
      radius_mi: 5,
      roof: 15,
      sort: "nearest",
    });
    expect(document.querySelector("[data-engine-line]")?.textContent).toContain(
      EXPLORE_TEXTS.engineServer,
    );
    const section = document.querySelector('section[data-route="explore"]');
    await waitFor(() => expect(section?.getAttribute("data-state")).toBe("ready"));
    expect(section?.getAttribute("data-view")).toBe("list");
  });

  it("keeps the A-13 tab contract: only the Explore mode tabs are tabs (TC-073)", async () => {
    await renderExplore("?place=pflugerville&r=5&roof=15");
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    // The scan clicks every tab in turn; a mode switch unmounts the results, so a results-view
    // tab would vanish mid-loop. Every tab must sit in the "Explore mode" tablist.
    const modes = screen.getByRole("tablist", { name: "Explore mode" });
    for (const tab of screen.getAllByRole("tab")) expect(modes.contains(tab)).toBe(true);
    const view = screen.getByRole("group", { name: "Results view" });
    const matches = within(view).getByRole("button", { name: /^Matches/ });
    expect(matches.getAttribute("aria-pressed")).toBe("true");
    expect(
      within(view)
        .getByRole("button", { name: /^Close/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("shows the gazetteer label for the place and offers it as an option while typing", async () => {
    await renderExplore("?place=pflugerville&r=5&roof=15");
    const label = resolvePlace("Pflugerville");
    if (label.status !== "found") throw new Error("gazetteer");
    expect(await screen.findByText(label.label)).toBeDefined();

    const box = screen.getByRole("combobox", { name: "Place" });
    fireEvent.change(box, { target: { value: "Pflugerville" } });
    const option = await screen.findByRole("option", { name: label.label });
    fireEvent.click(option);
    await waitFor(() => expect(lastLocation).toContain(`place=${label.id}`));
  });

  it("suggests places by prefix while typing, Pflugerville first", async () => {
    await renderExplore("?place=pflugerville&r=5&roof=15");
    const label = resolvePlace("Pflugerville");
    if (label.status !== "found") throw new Error("gazetteer");
    const box = screen.getByRole("combobox", { name: "Place" });
    fireEvent.change(box, { target: { value: "Pflug" } });
    const options = await screen.findAllByRole("option");
    expect(options[0]?.textContent).toBe(label.label);
  });

  it("updates the count live when the radius changes 5 → 3 mi, after a 250 ms debounce, without a new history entry", async () => {
    await renderExplore("?place=pflugerville&r=5&roof=15");
    await waitFor(() => expect(header()).not.toBeNull());
    api.search.mockImplementation(async () => result([makeRow(0)]));
    const historyLength = window.history.length;

    fireEvent.change(screen.getByLabelText("Radius"), { target: { value: "3" } });
    expect(lastLocation).toContain("r=3");
    expect(api.search).toHaveBeenCalledTimes(1);
    const waitedFrom = performance.now();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    // Still inside the 250 ms debounce, unless a loaded machine stalled the wait past it (then the
    // clock, not the page, decides: the assertion only applies when the wait really took < 200 ms).
    if (performance.now() - waitedFrom < 200) expect(api.search).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(header()?.textContent).toBe(EXPLORE_TEXTS.header(1, 3, "Pflugerville", 15)),
    );
    expect(api.search.mock.calls.at(-1)?.[0]).toMatchObject({ radius_mi: 3 });
    expect(window.history.length).toBe(historyLength);
  });
});

describe("Explore · Filters rows (AC-4, AC-7, FR-007, FR-022, NFR-003)", () => {
  it("shows every row field, the provenance with run and table CID, and no blank cell", async () => {
    await renderExplore("?at=30.2672,-97.7431&r=25&roof=0&view=list");
    await waitFor(() => expect(rows()).toHaveLength(2));
    const [first] = rows();
    if (first === undefined) throw new Error("row");
    expect(first.getAttribute("data-property-cid")).toBe(propertyCids[0]);
    expect(field(first, "address")?.textContent).toBe(EXPLORE_TEXTS.addressNotInExport);
    expect(field(first, "roof_age_years")?.textContent).toContain("18");
    // Codes show in plain words (the code stays in the tooltip).
    expect(field(first, "roof_age_basis")?.textContent).toBe("permit anchor");
    expect(field(first, "roof_age_confidence")?.textContent).toBe("high");
    expect(field(first, "distance")?.textContent).toBe("1.25 mi NE");
    expect(field(first, "lat_lon")?.textContent).toBe("30.45, -97.6");
    const provenance = first.querySelector("[data-provenance]");
    expect(provenance?.textContent).toContain("travis-test-explore");
    expect(provenance?.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(tableCid);
    for (const cell of first.querySelectorAll<HTMLElement>("[data-field]")) {
      expect((cell.textContent ?? "").trim(), cell.dataset["field"]).not.toMatch(
        /^(|null|undefined|NaN|—|-)$/,
      );
    }
  });

  it("shows the exact missing-reason texts for roof basis, BBB, tenure and owner area", async () => {
    api.search.mockImplementation(async () =>
      result([
        makeRow(0, {
          roof_age_years: null,
          roof_age_basis: "unknown",
          roof_age_confidence: null,
          tenure_years: null,
          tenure_basis: null,
          owner_area_class: "unknown",
          bbb_status: "not_checked",
          bbb_status_reason: "BBB lookups are not run for this county yet",
          permit: {
            cid: "p",
            number: "2026-000001 BP",
            status_raw: null,
            status_class: "closed",
            open_years: null,
            open_days: null,
            table_cid: tableCid,
          },
          contractor: { name_as_printed: null, resolution: "unresolved", company_cid: null },
        }),
        makeRow(1, { bbb_status: "blocked", permit: null }),
        makeRow(2, { bbb_status: "not_found" }),
      ]),
    );
    await renderExplore("?at=30.2672,-97.7431&r=25");
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [a, b, c] = rows() as [HTMLElement, HTMLElement, HTMLElement];
    expect(a.textContent).toContain(EXPLORE_TEXTS.roofUnknown);
    expect(field(a, "roof_age_basis")?.textContent).toBe(EXPLORE_TEXTS.roofUnknown);
    expect(field(a, "tenure_years")?.textContent).toBe(EXPLORE_TEXTS.tenureUnknown);
    expect(field(a, "owner_area_class")?.textContent).toBe(EXPLORE_TEXTS.ownerAreaUnknown);
    expect(field(a, "contractor_name")?.textContent).toBe(EXPLORE_TEXTS.contractorNotPrinted);
    expect(field(a, "status_raw")?.textContent).toBe(EXPLORE_TEXTS.noCarrier);
    expect(field(a, "bbb")?.textContent).toBe(
      EXPLORE_TEXTS.bbbNotChecked("BBB lookups are not run for this county yet"),
    );
    expect(field(b, "bbb")?.textContent).toBe(EXPLORE_TEXTS.bbbBlocked);
    expect(field(c, "bbb")?.textContent).toBe(EXPLORE_TEXTS.bbbNotFound);
    // Compact pills: a short visible label (data-short), the full reason as text and tooltip.
    const pill = (el: HTMLElement, name: string): Element | null | undefined =>
      field(el, name)?.querySelector("[data-status]");
    for (const [name, short, full] of [
      ["address", "No address", EXPLORE_TEXTS.addressNotInExport],
      ["roof_age_basis", "Roof age unknown", EXPLORE_TEXTS.roofUnknown],
      ["tenure_years", "Tenure unknown", EXPLORE_TEXTS.tenureUnknown],
      ["owner_area_class", "Owner area unknown", EXPLORE_TEXTS.ownerAreaUnknown],
      ["contractor_name", "No contractor printed", EXPLORE_TEXTS.contractorNotPrinted],
      ["status_raw", "Status not published", EXPLORE_TEXTS.noCarrier],
      [
        "bbb",
        "BBB not checked",
        EXPLORE_TEXTS.bbbNotChecked("BBB lookups are not run for this county yet"),
      ],
    ] as const) {
      expect(pill(a, name)?.getAttribute("data-short"), name).toBe(short);
      expect(pill(a, name)?.getAttribute("title"), name).toBe(full);
    }
    expect(pill(b, "bbb")?.getAttribute("data-short")).toBe("BBB blocked");
    expect(pill(c, "bbb")?.getAttribute("data-short")).toBe("No BBB profile");
  });

  it("names the field of every missing-data pill and groups identical reasons (ERR-20)", async () => {
    api.search.mockImplementation(async () =>
      result([
        makeRow(0, {
          missing: [
            { field: "address", reason: "not_in_export" },
            { field: "permit.status_raw", reason: "no_lexicon_carrier" },
            { field: "contractor.name_as_printed", reason: "no_lexicon_carrier" },
          ],
        }),
      ]),
    );
    await renderExplore("?at=30.2672,-97.7431&r=25");
    await waitFor(() => expect(rows()).toHaveLength(1));
    const groups = [...(rows()[0]?.querySelectorAll<HTMLElement>("[data-missing-group]") ?? [])];
    expect(groups).toHaveLength(2);
    const carrier = groups.find((g) => g.dataset["missingGroup"] === "no_lexicon_carrier");
    expect(carrier?.getAttribute("aria-label")).toBe(
      `permit.status_raw, contractor.name_as_printed: ${EXPLORE_TEXTS.noCarrier}`,
    );
    expect(carrier?.querySelector('[data-reason="no_lexicon_carrier"]')?.textContent).toBe(
      EXPLORE_TEXTS.noCarrier,
    );
    for (const g of groups)
      expect(g.getAttribute("aria-label")).toMatch(/^[a-z_.]+(, [a-z_.]+)*: .+/);
  });
});

describe("Explore tabs after the SQL tab was removed (A-16, PO decision)", () => {
  it("offers only Filters and AI", async () => {
    await renderExplore("");
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Filters", "AI"]);
    expect(screen.getByRole("tab", { name: "Filters" }).getAttribute("aria-selected")).toBe("true");
  });

  it("replaces an old ?mode=sql link with Filters and keeps the other parameters", async () => {
    await renderExplore("?mode=sql&place=pflugerville&r=5");
    await waitFor(() => expect(lastLocation).toBe("/tx/travis/explore?place=pflugerville&r=5"));
    expect(screen.queryByRole("tab", { name: "SQL" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Filters" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() =>
      expect(header()?.textContent).toBe(EXPLORE_TEXTS.headerNoRoof(2, 5, "Pflugerville")),
    );
  });

  it("drops the last AI question when the tab changes, so the AI tab opens afresh (PO 2026-10-26)", async () => {
    await renderExplore("?mode=ai&q=old%20question&place=pflugerville&r=5");
    fireEvent.click(await screen.findByRole("tab", { name: "Filters" }));
    await waitFor(() => expect(lastLocation).toContain("mode=filters"));
    expect(lastLocation).not.toMatch(/[?&]q=/);
    expect(lastLocation).toContain("place=pflugerville");
  });
});

describe("Explore · Filters URL state (FR-004a, TC-029)", () => {
  it("restores every control from the URL and falls back from view=map to the list", async () => {
    await renderExplore(
      "?place=pflugerville&r=5&roof=15&permit=open_stalled&openYrs=5&tenure=10&ooa=1&sort=open_desc&mode=filters&view=map",
    );
    await waitFor(() => expect(header()).not.toBeNull());
    expect((screen.getByLabelText("Radius") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Roof age") as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText("Open or stalled") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Open ≥") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Tenure") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Out-of-area owner") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("open_desc");
    expect(document.querySelector('section[data-route="explore"]')?.getAttribute("data-view")).toBe(
      "list",
    );
    expect(document.querySelector("[data-map]")).toBeNull();
    expect(api.search.mock.calls[0]?.[0]).toMatchObject({
      permit: "open_or_stalled",
      openYrs: 5,
      tenure: 10,
      ooa: true,
      sort: "open_desc",
    });
  });

  it("opens the Property drawer for a row and puts sel= in the URL", async () => {
    await renderExplore("?at=30.2672,-97.7431&r=25");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(rows()[1] as HTMLElement);
    const drawer = await screen.findByRole("dialog");
    expect(drawer.getAttribute("data-property-cid")).toBe(propertyCids[1]);
    expect(lastLocation).toContain(`sel=${propertyCids[1]}`);
  });
});

describe("Explore · Filters zero results (FR-015, TC-028)", () => {
  it("shows the zero-results line and Close matches with +{miles_outside} mi", async () => {
    api.search.mockImplementation(async () =>
      result([], {
        total_within_r: 0,
        close_matches: [
          { row: makeRow(0), miles_outside: 0.12 },
          { row: makeRow(1), miles_outside: 0.4 },
        ],
      }),
    );
    await renderExplore("?at=30.447765,-97.602116&r=0.5&roof=15");
    expect(await screen.findByText(EXPLORE_TEXTS.zeroResults(0.5, 2))).toBeDefined();
    const matches = [...document.querySelectorAll<HTMLElement>("[data-close-match]")];
    expect(matches).toHaveLength(2);
    const miles = matches[0]?.querySelector("[data-miles-outside]");
    expect(miles?.getAttribute("data-value")).toBe("0.12");
    expect(miles?.textContent).toBe(EXPLORE_TEXTS.milesOutside(0.12));
    expect(within(matches[0] as HTMLElement).getByText(/travis-test-explore/)).toBeDefined();
    expect(rows()).toHaveLength(0);
  });

  it("shows the search error in words and no rows", async () => {
    api.search.mockImplementation(async () => {
      throw new Error("The search could not run on the server; try again");
    });
    await renderExplore("?at=30.2672,-97.7431&r=25");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The search could not run on the server; try again");
    expect(
      document.querySelector('section[data-route="explore"]')?.getAttribute("data-state"),
    ).toBe("error");
  });
});
