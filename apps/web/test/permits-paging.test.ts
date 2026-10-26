// A-11: client-side paging of the Permits list. All rows stay in memory (the count check in
// resolvePermitsState is unchanged); only PERMITS_PAGE_SIZE rows (newest first) are in the DOM
// at a time, so a full-county run (about 15,000 rows) does not freeze the browser. Rows below
// are in-test inputs.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PERMITS_PAGE_SIZE, PERMITS_TEXTS } from "@countylens/shared";
import type { PermitListRow } from "../src/engine/permit-list";
import {
  PermitsPage,
  TABLE_MEDIA_QUERY,
  resolvePermitsState,
  type PermitsLoaded,
} from "../src/routes/Permits.page";

const cid = (tag: string): string => `bafkrei${tag}`.padEnd(59, "a");

function row(n: number): PermitListRow {
  const id = String(n).padStart(6, "0");
  return {
    permit_number: `TEST-${id}`,
    improvement_status: "Permitted",
    status_class: "open",
    issue_date: "2026-09-01",
    final_date: null,
    permit_close_date: null,
    open_days: 30,
    contractor_resolution: "unresolved",
    contractor_name_as_printed: null,
    bbb_url: null,
    cid: cid(`permit${id}`),
    source_url: `https://source.test/TEST-${id}`,
    captured_at: "2026-10-20T14:02:05Z",
    table: "property_improvement/property_improvement",
    table_cid: cid("table"),
    run_id: "test-run",
    manifest_cid: cid("manifest"),
    as_of: "2026-10-01T00:00:00Z",
    missing: [],
  };
}

const loadedOf = (count: number): PermitsLoaded => ({
  runId: "test-run",
  manifestCid: cid("manifest"),
  permitsEmitted: count,
  rows: Array.from({ length: count }, (_, i) => row(i + 1)),
  fallbackLabel: null,
});

function stubViewport(wide: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: query === TABLE_MEDIA_QUERY ? wide : false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  });
}

async function renderReady(count: number, wide = true) {
  stubViewport(wide);
  render(createElement(PermitsPage, { load: () => Promise.resolve(loadedOf(count)) }));
  await waitFor(() => expect(screen.getByTestId("permits-range")).toBeTruthy());
}

const range = () => screen.getByTestId("permits-range");
const prev = () => screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement;
const next = () => screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement;
const bodyRows = () => document.querySelectorAll("table tbody tr").length;

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("Permits paging (table)", () => {
  it("uses a page size of 20", () => {
    expect(PERMITS_PAGE_SIZE).toBe(20);
  });

  it("shows 1-20 of N with 20 rows and Previous disabled on the first page", async () => {
    await renderReady(45);
    expect(range().textContent).toBe("Showing 1–20 of 45");
    expect(range().textContent).toBe(PERMITS_TEXTS.showing(1, 20, 45));
    expect(range().getAttribute("data-first")).toBe("1");
    expect(range().getAttribute("data-last")).toBe("20");
    expect(range().getAttribute("data-total")).toBe("45");
    expect(bodyRows()).toBe(20);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    expect(screen.getAllByRole("navigation", { name: "Permits pages" })).toHaveLength(1);
  });

  it("Next moves to 21-40, then to the partial last page, where Next is disabled", async () => {
    await renderReady(45);
    fireEvent.click(next());
    expect(range().textContent).toBe("Showing 21–40 of 45");
    expect(bodyRows()).toBe(20);
    expect(prev().disabled).toBe(false);
    fireEvent.click(next());
    expect(range().textContent).toBe("Showing 41–45 of 45");
    expect(range().getAttribute("data-last")).toBe("45");
    expect(bodyRows()).toBe(5);
    expect(next().disabled).toBe(true);
    expect(prev().disabled).toBe(false);
    const first = document.querySelector("table tbody tr td");
    expect(first?.textContent).toContain("TEST-000041");
    fireEvent.click(prev());
    expect(range().textContent).toBe("Showing 21–40 of 45");
  });

  it("lists the newest permit first: issue_date descending, undated last, ties in engine order", async () => {
    stubViewport(true);
    const rows = [
      { ...row(1), issue_date: "1978-03-01" },
      { ...row(2), issue_date: null },
      { ...row(3), issue_date: "2026-08-15" },
      { ...row(4), issue_date: "2001-01-01" },
      { ...row(5), issue_date: "2026-08-15" },
    ];
    const data: PermitsLoaded = { ...loadedOf(0), permitsEmitted: rows.length, rows };
    render(createElement(PermitsPage, { load: () => Promise.resolve(data) }));
    await waitFor(() => expect(screen.getByTestId("permits-range")).toBeTruthy());
    const numbers = [...document.querySelectorAll("table tbody tr")].map(
      (tr) => tr.querySelector("td")?.textContent ?? "",
    );
    expect(numbers.map((n) => n.match(/TEST-\d+/)?.[0])).toEqual([
      "TEST-000003",
      "TEST-000005",
      "TEST-000004",
      "TEST-000001",
      "TEST-000002",
    ]);
  });

  it("with 20 or fewer rows the pager shows and both buttons are disabled", async () => {
    await renderReady(17);
    expect(range().textContent).toBe("Showing 1–17 of 17");
    expect(bodyRows()).toBe(17);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
  });

  it("formats large totals with thousands separators but plain data attributes", async () => {
    await renderReady(1500);
    expect(range().textContent).toBe("Showing 1–20 of 1,500");
    expect(range().getAttribute("data-total")).toBe("1500");
  });
});

describe("Permits paging (cards)", () => {
  it("renders one page of cards below 600 px", async () => {
    await renderReady(25, false);
    const list = screen.getByRole("list", { name: "Permits" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    expect(document.querySelector("table")).toBeNull();
    fireEvent.click(next());
    expect(range().textContent).toBe("Showing 21–25 of 25");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(next().disabled).toBe(true);
  });
});

describe("resolvePermitsState keeps the exact count check", () => {
  it("is ready for a matching count and an error for a mismatch, whatever the page size", () => {
    const data = loadedOf(450);
    expect(resolvePermitsState(data)).toEqual({ kind: "ready", data });
    expect(resolvePermitsState({ ...data, permitsEmitted: 449 })).toEqual({
      kind: "error",
      message: PERMITS_TEXTS.countMismatch(450, 449),
    });
  });
});
