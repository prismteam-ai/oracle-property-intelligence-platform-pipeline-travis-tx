// A-13 T026 (AC-5, FR-005; TC-009, TC-031, TC-032, TC-034, TC-035): long-open roofing permits in
// Explore · Filters. "Open or stalled" + "Open ≥ 5" sorted by open longest send
// permit=open_or_stalled, openYrs=5, sort=open_desc; while `status_raw` has no lexicon carrier a
// stalled chip reads "Stalled {x} yrs · open past expiry, never closed" and an open one
// "Open {x} yrs · within its permit period"; the contractor reads the no-carrier text with its
// resolution badge; an empty list says "no open
// roofing permits in this radius on the current run". The PermitChip and ContractorBadge are
// tested directly too. Rows are built in the test (never shown as real data).
import { RUNS_INDEX_SCHEMA } from "@countylens/contract";
import { rawCid, type ExploreResult, type ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { QueryClient, QueryClientProvider, skipToken } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractorBadge } from "../src/components/ContractorBadge";
import { PermitChip } from "../src/components/PermitChip";

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
let cids: string[];

beforeAll(async () => {
  manifestCid = await rawCid(encode("permits manifest"));
  cids = await Promise.all([1, 2].map((n) => rawCid(encode(`permit property ${n}`))));
});

function permitRow(i: number, statusClass: string, openYears: number, openDays = 2337): ExploreRow {
  return {
    property_cid: cids[i] ?? "",
    address: null,
    dist_mi: 2,
    bearing: "S",
    lat: 30.4,
    lon: -97.6,
    roof_age_years: 20,
    roof_age_basis: "permit_anchor",
    roof_age_confidence: "high",
    permit: {
      cid: cids[i] ?? "",
      number: `2019-00000${i} BP`,
      status_raw: null,
      status_class: statusClass,
      open_years: openYears,
      open_days: openDays,
      table_cid: manifestCid,
    },
    contractor: { name_as_printed: null, resolution: "unresolved", company_cid: null },
    bbb_status: "not_checked",
    bbb_status_reason: "not run for this county",
    tenure_years: 3,
    tenure_basis: "latest_dated_sale",
    owner_area_class: "travis",
    provenance: {
      cid: cids[i] ?? "",
      source_url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
      captured_at: "2026-10-21T08:01:00.000Z",
      table: "property_improvement/property_improvement",
      table_cid: manifestCid,
      run_id: "travis-test-permits",
      manifest_cid: manifestCid,
      as_of: "2026-10-21",
    },
    missing: [
      { field: "permit.status_raw", reason: "no_lexicon_carrier" },
      { field: "contractor.name_as_printed", reason: "no_lexicon_carrier" },
    ],
  };
}

const result = (rows: ExploreRow[]): ExploreResult => ({
  total_within_r: rows.length,
  tenure_unknown: 0,
  rows,
  close_matches: [],
  as_of: { runId: "travis-test-permits", manifestCid, finishedAt: "2026-10-21T08:10:00.000Z" },
  area: { label: "test", lat: 30.4, lon: -97.6 },
  engine: "server",
  queryDurationMs: 3,
});

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
      </MemoryRouter>
    </Providers>,
  );
}

beforeEach(() => {
  api.search.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: [
              { runId: "travis-test-permits", manifestCid, finishedAt: "2026-10-21T08:10:00.000Z" },
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

describe("Open and stalled permits (AC-5, FR-005)", () => {
  it("sends open or stalled ≥ 5 yrs sorted by open longest and shows the no-carrier chips", async () => {
    api.search.mockImplementation(async () =>
      result([permitRow(0, "stalled", 6.4), permitRow(1, "open", 5.1)]),
    );
    await renderExplore("?place=pflugerville&r=5&roof=15");
    await waitFor(() => expect(api.search).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("Open or stalled"));
    fireEvent.change(screen.getByLabelText("Open ≥"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "open_desc" } });
    await waitFor(() =>
      expect(api.search.mock.calls.at(-1)?.[0]).toMatchObject({
        permit: "open_or_stalled",
        openYrs: 5,
        sort: "open_desc",
      }),
    );
    const chips = await screen.findAllByText(/^(Stalled|Open) [\d.]+ yrs · /);
    expect(chips.map((c) => c.closest("[data-permit-chip]")?.textContent)).toEqual([
      EXPLORE_TEXTS.stalledNoCarrier(6.4),
      EXPLORE_TEXTS.openNoCarrier(5.1),
    ]);
    const chip = document.querySelector("[data-permit-chip]");
    expect(chip?.getAttribute("data-open-days")).toBe("2337"); // the row's open_days, not years × 365.25
    for (const cell of document.querySelectorAll('[data-field="contractor_name"]')) {
      expect(cell.textContent).toBe(EXPLORE_TEXTS.contractorNotPrinted);
    }
    expect(document.querySelectorAll("[data-contractor-resolution]")).toHaveLength(2);
  });

  it("says every match is stalled (still open past expiry) when rows came back and none is open", async () => {
    api.search.mockImplementation(async () =>
      result([permitRow(0, "stalled", 6), permitRow(1, "stalled", 7)]),
    );
    await renderExplore("?place=austin&r=5&permit=open_stalled&openYrs=5");
    expect(await screen.findByText(EXPLORE_TEXTS.allStalled(2))).toBeDefined();
    expect(screen.queryByText(EXPLORE_TEXTS.noOpenPermits)).toBeNull();
  });

  it("says `no open roofing permits in this radius on the current run` for an empty open list", async () => {
    api.search.mockImplementation(async () => ({ ...result([]), total_within_r: 0 }));
    await renderExplore("?place=pflugerville&r=5&permit=open&openYrs=5");
    expect(await screen.findByText(EXPLORE_TEXTS.noOpenPermits)).toBeDefined();
    expect(document.querySelectorAll("[data-result-row]")).toHaveLength(0);
    expect(api.search.mock.calls[0]?.[0]).toMatchObject({ permit: "open", openYrs: 5 });
  });
});

describe("PermitChip and ContractorBadge", () => {
  it("uses the source-says texts once a status carrier exists, and nothing for a closed permit", () => {
    render(
      <>
        <PermitChip
          permit={{ ...(permitRow(0, "stalled", 6.4).permit as NonNullable<ExploreRow["permit"]>) }}
          statusRaw="Expired"
        />
        <PermitChip
          permit={{ ...(permitRow(0, "open", 2).permit as NonNullable<ExploreRow["permit"]>) }}
          statusRaw="Active"
        />
        <PermitChip
          permit={{ ...(permitRow(0, "closed", 0).permit as NonNullable<ExploreRow["permit"]>) }}
        />
      </>,
    );
    const chips = [...document.querySelectorAll("[data-permit-chip]")].map((c) => c.textContent);
    expect(chips).toEqual([
      EXPLORE_TEXTS.stalledExpired(6.4),
      EXPLORE_TEXTS.openSourceSays(2, "Active"),
    ]);
  });

  it("shows the resolution badge with the resolution in data-contractor-resolution", () => {
    render(
      <>
        <ContractorBadge resolution="resolved" />
        <ContractorBadge resolution={null} />
      </>,
    );
    const badges = [...document.querySelectorAll("[data-contractor-resolution]")];
    expect(badges.map((b) => b.getAttribute("data-contractor-resolution"))).toEqual([
      "resolved",
      "unresolved",
    ]);
    expect(badges[0]?.textContent).toMatch(/resolved/i);
  });
});
