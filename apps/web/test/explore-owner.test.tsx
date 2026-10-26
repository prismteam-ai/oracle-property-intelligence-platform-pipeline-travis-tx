// A-13 T030 (AC-8, FR-008; TC-036, TC-037): tenure and out-of-area owner filters. The preset
// `ooa78753` turns on "tenure > 10 years" and "out-of-area owner" for ZCTA 78753; each filter has
// a one-line definition on screen; rows show `tenure_years`, `tenure_basis` and
// `owner_area_class` (or their reasons); unknown tenure is excluded and counted as "tenure
// unknown: {n}". Rows are built in the test (never shown as real data).
import { RUNS_INDEX_SCHEMA } from "@countylens/contract";
import { rawCid, type ExploreResult, type ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { QueryClient, QueryClientProvider, skipToken } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
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
let cid: string;

beforeAll(async () => {
  manifestCid = await rawCid(encode("owner manifest"));
  cid = await rawCid(encode("owner property"));
});

const row = (over: Partial<ExploreRow>): ExploreRow => ({
  property_cid: cid,
  address: null,
  dist_mi: 1,
  bearing: "W",
  lat: 30.37,
  lon: -97.67,
  roof_age_years: 12,
  roof_age_basis: "built_year",
  roof_age_confidence: "low",
  permit: null,
  contractor: null,
  bbb_status: null,
  bbb_status_reason: null,
  tenure_years: 14,
  tenure_basis: "latest_dated_sale",
  owner_area_class: "out_of_state",
  provenance: {
    cid,
    source_url: "https://traviscad.org/publicinformation",
    captured_at: "2026-10-21T08:02:00.000Z",
    table: "county/property",
    table_cid: manifestCid,
    run_id: "travis-test-owner",
    manifest_cid: manifestCid,
    as_of: "2026-10-21",
  },
  missing: [],
  ...over,
});

const result = (rows: ExploreRow[], tenureUnknown: number): ExploreResult => ({
  total_within_r: rows.length,
  tenure_unknown: tenureUnknown,
  rows,
  close_matches: [],
  as_of: { runId: "travis-test-owner", manifestCid, finishedAt: "2026-10-21T08:10:00.000Z" },
  area: { label: "ZCTA5 78753", lat: 30.37, lon: -97.67 },
  engine: "server",
  queryDurationMs: 2,
});

function Providers({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderExplore(search = ""): Promise<void> {
  const { Component } = await import("../src/routes/Explore");
  render(
    <Providers>
      <MemoryRouter initialEntries={[`/tx/travis/explore${search}`]}>
        <Routes>
          <Route path="/tx/travis/explore" element={<Component />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
}

beforeEach(() => {
  api.search.mockReset();
  api.search.mockImplementation(async (input) =>
    input["tenure"] === undefined
      ? result([row({})], 0)
      : result([row({}), row({ owner_area_class: "unknown", property_cid: `${cid}x` })], 4),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: [
              { runId: "travis-test-owner", manifestCid, finishedAt: "2026-10-21T08:10:00.000Z" },
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

describe("Tenure and out-of-area owners (AC-8, FR-008)", () => {
  it("searches on bare Explore, and the ooa78753 preset turns on tenure > 10 and out-of-area for 78753", async () => {
    await renderExplore();
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /ooa78753/ }));
    await waitFor(() =>
      expect(api.search.mock.calls.at(-1)?.[0]).toMatchObject({
        area: { place: "78753" },
        tenure: 10,
        ooa: true,
      }),
    );
    expect((screen.getByLabelText("Tenure") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Out-of-area owner") as HTMLInputElement).checked).toBe(true);
  });

  it("shows one definition line per filter, the owner fields and `tenure unknown: {n}`", async () => {
    await renderExplore("?place=78753&r=5&tenure=10&ooa=1");
    await waitFor(() => expect(document.querySelectorAll("[data-result-row]")).toHaveLength(2));
    for (const f of ["tenure", "ooa"]) {
      const defs = document.querySelectorAll(`[data-filter-definition="${f}"]`);
      expect(defs).toHaveLength(1);
      expect((defs[0]?.textContent ?? "").trim().length).toBeGreaterThan(10);
      expect(defs[0]?.textContent).not.toContain("\n");
    }
    expect(document.querySelector("[data-tenure-unknown]")?.textContent).toBe(
      EXPLORE_TEXTS.tenureUnknownCount(4),
    );
    const [first, second] = [...document.querySelectorAll<HTMLElement>("[data-result-row]")];
    expect(first?.querySelector('[data-field="tenure_years"]')?.textContent).toContain("14");
    expect(first?.querySelector('[data-field="tenure_basis"]')?.textContent).toBe(
      "latest dated sale",
    );
    expect(first?.querySelector('[data-field="owner_area_class"]')?.textContent).toBe(
      "out of state",
    );
    expect(second?.querySelector('[data-field="owner_area_class"]')?.textContent).toBe(
      EXPLORE_TEXTS.ownerAreaUnknown,
    );
  });

  it("does not show the tenure-unknown count without the tenure filter", async () => {
    await renderExplore("?place=78753&r=5");
    await waitFor(() => expect(document.querySelectorAll("[data-result-row]")).toHaveLength(1));
    expect(document.querySelector("[data-tenure-unknown]")).toBeNull();
  });
});
