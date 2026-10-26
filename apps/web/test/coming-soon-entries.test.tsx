// A-13 (AC-13, FR-013; TC-060, TC-062 … TC-070): every planned item has its in-context entry on the
// page the test cases name: a link to /soon/{id} with the Coming soon label, a target of at least
// 48 px (the entry's CSS), and no link to AI-user sign-in on any of those pages.
import { rawCid, type ExploreRow } from "@countylens/query-core";
import { PAGE_TEXTS } from "@countylens/shared";
import { QueryClient, QueryClientProvider, skipToken } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComingSoonEntries } from "../src/components/ComingSoonEntry";
import { PropertyDrawer } from "../src/routes/PropertyDrawer";

vi.mock("@countylens/api-client/react", () => ({
  useTRPC: () => ({
    explore: {
      search: {
        queryOptions: (input: unknown) => ({
          queryKey: ["explore", "search", input],
          queryFn: input === skipToken ? skipToken : async () => new Promise(() => undefined),
        }),
      },
    },
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Providers({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderAt(
  path: string,
  route: string,
  load: () => Promise<{ Component: () => ReactElement }>,
) {
  const { Component } = await load();
  return render(
    <Providers>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<Component />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
}

function expectEntry(container: HTMLElement, id: string): void {
  const link = container.querySelector<HTMLAnchorElement>(`[data-coming-soon-entry="${id}"]`);
  expect(link, `entry ${id}`).not.toBeNull();
  expect(link?.getAttribute("href")).toBe(`/soon/${id}`);
  expect(link?.textContent).toContain(PAGE_TEXTS.comingSoon);
}

const css = readFileSync(join(__dirname, "../src/components/ComingSoonEntry.module.css"), "utf8");

function expectNoAiUser(container: HTMLElement): void {
  expect(container.querySelector('a[href*="ai-user"]')).toBeNull();
  expect(container.querySelector('[data-coming-soon-entry="ai-user-sign-in"]')).toBeNull();
}

describe("Coming soon entry points", () => {
  it("the entry is a 48 px target (min-height var(--space-9))", () => {
    expect(css).toMatch(/min-height:\s*var\(--space-9\)/);
  });

  // PO 2026-10-26: Explore no longer lists its four Coming soon items above the results; they
  // stay in the More sheet's "Planned" list and at /soon/{item}.
  it("Explore · Filters: no Coming soon strip above the results", async () => {
    const { container } = await renderAt(
      "/tx/travis/explore",
      "/tx/travis/explore",
      () => import("../src/routes/Explore"),
    );
    for (const id of ["builder-mode", "saved-searches", "area-matrix", "other-counties"]) {
      expect(container.querySelector(`[data-coming-soon-entry="${id}"]`)).toBeNull();
    }
    expectNoAiUser(container);
  });

  it("Runs: Pipeline diagram and Gantt, Timeline scrubber", async () => {
    const { container } = await renderAt("/runs", "/runs", () => import("../src/routes/Runs"));
    for (const id of ["pipeline-diagram", "timeline-scrubber"]) expectEntry(container, id);
    expectNoAiUser(container);
  });

  it("Data · Verify: Gateway race", async () => {
    const { container } = await renderAt(
      "/data/verify/bafktest",
      "/data/verify/:cid",
      () => import("../src/routes/DataVerify"),
    );
    expectEntry(container, "gateway-race");
    expectNoAiUser(container);
  });

  it("Property drawer: Street View, Similar properties", async () => {
    const cid = await rawCid(new TextEncoder().encode("entry drawer"));
    const row = {
      property_cid: cid,
      address: null,
      dist_mi: 1,
      bearing: "N",
      lat: 30.3,
      lon: -97.7,
      roof_age_years: null,
      roof_age_basis: null,
      roof_age_confidence: null,
      permit: null,
      contractor: null,
      bbb_status: null,
      bbb_status_reason: null,
      tenure_years: null,
      tenure_basis: null,
      owner_area_class: "unknown",
      provenance: {
        cid,
        source_url: "https://example.test/x",
        captured_at: "2026-10-21T08:01:00.000Z",
        table: "t",
        table_cid: cid,
        run_id: "r",
        manifest_cid: cid,
        as_of: "2026-10-21",
      },
      missing: [],
    } as unknown as ExploreRow;
    const { container } = render(
      <MemoryRouter>
        <PropertyDrawer row={row} onClose={() => undefined} />
      </MemoryRouter>,
    );
    for (const id of ["street-view", "similar-properties"]) expectEntry(container, id);
    expectNoAiUser(container);
    expect(screen.getByRole("dialog").querySelectorAll("[data-coming-soon-entry]")).toHaveLength(2);
  });
});

describe("AI-user sign-in", () => {
  it("is never rendered as an entry or a link by any in-context entry list", () => {
    const { container } = render(
      <MemoryRouter>
        <ComingSoonEntries ids={["ai-user-sign-in"]} />
      </MemoryRouter>,
    );
    expectNoAiUser(container);
    expect(container.querySelector("a")).toBeNull();
  });
});
