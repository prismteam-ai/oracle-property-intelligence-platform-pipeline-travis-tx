// A-13 review round, fixer A: Explore · Filters findings 5, 6, 8, 9, 10, 14, 15 (clearable
// number fields, the header names the request that answered, zero-result text, the BAD_REQUEST
// sentence, `sel` not in the results, Load more, combobox keyboard). Rows are built in the test.
import { RUNS_INDEX_SCHEMA } from "@countylens/contract";
import { rawCid, type ExploreResult, type ExploreRow } from "@countylens/query-core";
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
let cids: string[];

beforeAll(async () => {
  manifestCid = await rawCid(encode("review-a manifest"));
  tableCid = await rawCid(encode("review-a table"));
  cids = await Promise.all([0, 1, 2, 3, 4].map((n) => rawCid(encode(`review-a property ${n}`))));
});

function makeRow(i: number): ExploreRow {
  return {
    property_cid: cids[i] ?? "",
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
      cid: cids[i] ?? "",
      source_url: "https://traviscad.org/publicinformation",
      captured_at: "2026-10-21T08:02:00.000Z",
      table: "county/property",
      table_cid: tableCid,
      run_id: "travis-test-explore",
      manifest_cid: manifestCid,
      as_of: "2026-10-21",
    },
    missing: [{ field: "address", reason: "not_in_export" }],
  };
}

function result(rowIdx: number[], over: Partial<ExploreResult> = {}): ExploreResult {
  return {
    total_within_r: rowIdx.length,
    tenure_unknown: 0,
    rows: rowIdx.map(makeRow),
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
  api.search.mockImplementation(async () => result([0, 1]));
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

describe("number fields stay clearable (finding 5)", () => {
  it("select-all + backspace + typing 3 ends at r=3, and out-of-range values are clamped", async () => {
    await renderExplore("?place=pflugerville&r=5");
    await waitFor(() => expect(header()).not.toBeNull());
    const radius = screen.getByLabelText("Radius") as HTMLInputElement;
    fireEvent.change(radius, { target: { value: "" } });
    expect(radius.value).toBe("");
    fireEvent.change(radius, { target: { value: "3" } });
    expect(radius.value).toBe("3");
    expect(lastLocation).toContain("r=3");
    fireEvent.change(radius, { target: { value: "100" } });
    expect(lastLocation).toContain("r=25");
    fireEvent.change(radius, { target: { value: "0.1" } });
    expect(lastLocation).toContain("r=0.25");
  });

  it("clearing an optional filter (roof) removes it from the URL", async () => {
    await renderExplore("?place=pflugerville&roof=15");
    await waitFor(() => expect(header()).not.toBeNull());
    const roof = screen.getByLabelText("Roof age") as HTMLInputElement;
    fireEvent.change(roof, { target: { value: "" } });
    expect(roof.value).toBe("");
    expect(lastLocation).not.toContain("roof=");
  });

  it("shows the URL value again after leaving an emptied radius", async () => {
    await renderExplore("?place=pflugerville&r=5");
    await waitFor(() => expect(header()).not.toBeNull());
    const radius = screen.getByLabelText("Radius") as HTMLInputElement;
    fireEvent.change(radius, { target: { value: "" } });
    fireEvent.blur(radius);
    expect(radius.value).toBe("5");
  });
});

describe("the header names the request it answers (finding 6)", () => {
  it("keeps the older place name while the place changes and the older result arrives", async () => {
    let release: (r: unknown) => void = () => undefined;
    api.search.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await renderExplore("?place=pflugerville&r=5");
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1));
    // The URL moves to another place before the older answer arrives (inside the debounce).
    fireEvent.click(screen.getByRole("button", { name: /ooa78753/ }));
    expect(lastLocation).toContain("place=78753");
    await act(async () => release(result([0, 1])));
    await waitFor(() =>
      expect(header()?.textContent).toBe(EXPLORE_TEXTS.headerNoRoof(2, 5, "Pflugerville")),
    );
  });
});

describe("zero results text (finding 8)", () => {
  const zero = (): ExploreResult => result([], { total_within_r: 0 });
  it("says no open roofing permits when the permit filter is active and no rows came back", async () => {
    api.search.mockImplementation(async () => zero());
    await renderExplore("?place=pflugerville&r=5&permit=open_stalled");
    expect(await screen.findByText(EXPLORE_TEXTS.noOpenPermits)).toBeDefined();
    expect(screen.getByText(EXPLORE_TEXTS.zeroResults(5, 0))).toBeDefined();
  });
  it("keeps the permit sentence when other filters are active too (D-9: roof 15, open 5 yrs)", async () => {
    api.search.mockImplementation(async () => zero());
    await renderExplore("?place=pflugerville&r=5&permit=open_stalled&roof=15&openYrs=5");
    expect(await screen.findByText(EXPLORE_TEXTS.noOpenPermits)).toBeDefined();
  });
  it("uses only the generic zero-results text when no permit filter is active", async () => {
    api.search.mockImplementation(async () => zero());
    await renderExplore("?place=pflugerville&r=5&roof=15");
    expect(await screen.findByText(EXPLORE_TEXTS.zeroResults(5, 0))).toBeDefined();
    expect(screen.queryByText(EXPLORE_TEXTS.noOpenPermits)).toBeNull();
  });
});

describe("search errors (finding 9)", () => {
  it("maps BAD_REQUEST to the fixed sentence, hides the validator dump and offers Retry", async () => {
    const dump = '[{"code":"too_big","maximum":25,"path":["radius_mi"]}]';
    api.search.mockImplementationOnce(async () => {
      throw Object.assign(new Error(dump), { data: { code: "BAD_REQUEST" } });
    });
    await renderExplore("?place=pflugerville&r=5");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(EXPLORE_TEXTS.filtersOutOfRange);
    expect(document.body.textContent).not.toContain("too_big");
    api.search.mockImplementation(async () => result([0, 1]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });
});

describe("A-16 AC-13: index errors and the owner-area notice", () => {
  it.each([
    ["index_not_built", "is not built yet"],
    ["index_stale", "is out of date"],
  ])(
    "PRECONDITION_FAILED (%s) shows the fixed index sentence, not the raw message",
    async (code, words) => {
      api.search.mockImplementationOnce(async () => {
        throw Object.assign(new Error(`explore index unavailable for bafkreix (${code})`), {
          data: { code: "PRECONDITION_FAILED" },
        });
      });
      await renderExplore("?place=pflugerville&r=5");
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(words);
      expect(alert.textContent).toContain(
        "The run's published files and the Data pages still work",
      );
      expect(alert.textContent).not.toContain(`(${code})`);
    },
  );

  it("an out-of-area search on a run without owner area says why it finds nothing", async () => {
    api.search.mockImplementation(async () => ({
      ...result([], { total_within_r: 0 }),
      owner_area: {
        status: "not_published",
        reason: "owner_area_not_published",
        message: "owner area not published in this run",
      },
    }));
    await renderExplore("?place=pflugerville&r=5&ooa=1");
    const notice = await waitFor(() => {
      const el = document.querySelector("[data-owner-area-notice]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(notice.textContent).toContain("owner area not published in this run");
  });
});

describe("sel not in the results (finding 10)", () => {
  it("shows the notice instead of ignoring it", async () => {
    await renderExplore(`?place=pflugerville&r=5&sel=${cids[4]}`);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(await screen.findByText(EXPLORE_TEXTS.propertyNotInResults)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows no notice for a selected row that is in the results", async () => {
    await renderExplore(`?place=pflugerville&r=5&sel=${cids[0]}`);
    await screen.findByRole("dialog");
    expect(screen.queryByText(EXPLORE_TEXTS.propertyNotInResults)).toBeNull();
  });
});

// A-16 T050: the board's pager replaces "Load more" (finding 14 kept: same query, next page).
describe("Result pager (finding 14, Explore1440 board)", () => {
  // A-16 (PO 2026-10-26): 20 rows a page, the page in the URL; the mock answers 2 rows a page.
  it("fetches the next page with the same query, shows it and announces the range", async () => {
    api.search.mockImplementation(async (input) =>
      (input.page ?? 0) === 0
        ? result([0, 1], { total_within_r: 22 })
        : result([2, 3], { total_within_r: 22 }),
    );
    await renderExplore("?place=pflugerville&r=5&roof=15");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.search.mock.calls.at(-1)?.[0]).toMatchObject({ limit: 20 });
    const showing = (): HTMLElement | null => document.querySelector("[data-showing]");
    expect(showing()?.getAttribute("aria-live")).toBe("polite");
    expect(showing()?.textContent).toBe("Showing 1–2 of 22");
    expect(
      (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Page 2" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(showing()?.textContent).toBe("Showing 21–22 of 22"));
    expect(lastLocation).toContain("page=2");
    expect(api.search.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1, roof: 15, radius_mi: 5 });
    expect(rows()).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    // Every row keeps its provenance.
    for (const row of rows()) expect(row.textContent).toContain("travis-test-explore");
  });

  it("numbers the pages like Task B: first, around the current one, last, with gaps", async () => {
    const { pageNumbers } = await import("../src/routes/ExploreFilters");
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 5)).toEqual([1, 2, "gap", 5]);
    expect(pageNumbers(4, 9)).toEqual([1, "gap", 3, 4, 5, "gap", 9]);
  });

  it("disables both page buttons when every row is on one page", async () => {
    await renderExplore("?place=pflugerville&r=5");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: EXPLORE_TEXTS.loadMore })).toBeNull();
  });
});

describe("Place combobox keyboard (finding 15)", () => {
  it("moves with ArrowDown/ArrowUp via aria-activedescendant, chooses with Enter, clears with Escape", async () => {
    await renderExplore("?place=pflugerville&r=5");
    const box = screen.getByRole("combobox", { name: "Place" });
    fireEvent.change(box, { target: { value: "B" } });
    const places = (): HTMLElement => screen.getByRole("listbox", { name: "Places" });
    const options = await within(places()).findAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    const second = options[1]?.textContent ?? "";
    await waitFor(() => expect(lastLocation).toContain("place="));
    expect(lastLocation).not.toContain("place=pflugerville");
    expect(second).not.toBe("");

    fireEvent.change(box, { target: { value: "Aus" } });
    await within(places()).findAllByRole("option");
    fireEvent.keyDown(box, { key: "Escape" });
    // Escape drops the typed text; the box shows the chosen place again (A-16: it mirrors `place=`).
    expect((box as HTMLInputElement).value).not.toBe("Aus");
    expect(second).toContain((box as HTMLInputElement).value);
    expect(within(places()).queryAllByRole("option")).toHaveLength(0);
  });
});
