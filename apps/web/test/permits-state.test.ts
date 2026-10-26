// A-03 T053 (G-C4): the Permits list state machine `loading → ready | empty | error`
// (data-model.md § Permits page state; FR-003, FR-008, FR-009; plan § "Atlas element map" →
// Permits list and § States). The loader is injected, so no network, no DuckDB-WASM and no
// fixture data: the rows and the manifest facts below are in-test inputs of a state test, not
// published data. `A-03-TC-029` is the unit case `tests/e2e/build-checks.spec.ts` spawns.
// Red run (before T055/T056): `Cannot find module '../src/routes/Permits.page'`.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BBB_SEARCH_LINK_LABEL,
  CONTRACTOR_NOT_PRINTED_LABEL,
  EXPLORE_TEXTS,
  MISSING_REASON_LABELS,
  PERMITS_TEXTS,
  PROGRESS_LABELS,
  RUN_INDEX_TEXTS,
  missingLabel,
} from "@countylens/shared";
import { ENGINE_LINE_TEXT } from "../src/components/EngineLine";
import { truncateCid } from "../src/components/CidDisplay";
import { BOTH_HOSTS_DOWN_TEXT, BothHostsDownError } from "../src/data/fetch-by-cid";
import { RunIndexError } from "../src/data/runs-index";
import { EngineStartError } from "../src/engine/errors";
import { parsePermitRows, type PermitListRow } from "../src/engine/permit-list";
import {
  NO_CONTRACTOR_PRINTED,
  PermitsPage,
  STAGE_TEXTS,
  TABLE_MEDIA_QUERY,
  errorText,
  resolvePermitsState,
  type PermitsLoaded,
  type PermitsLoader,
} from "../src/routes/Permits.page";

/** A syntactically valid, obviously synthetic base32 CIDv1 (contract `isCidV1`). */
const cid = (tag: string): string => `bafkrei${tag}`.padEnd(59, "a");
const MANIFEST_CID = cid("manifest");
const TABLE_CID = cid("table");
const RUN_ID = "test-run";

function row(n: number, overrides: Partial<PermitListRow> = {}): PermitListRow {
  return {
    permit_number: `TEST-000${n}`,
    improvement_status: "Permitted",
    status_class: "open",
    // Newer for a lower n: ROWS below is already in the page's newest-first order.
    issue_date: `2026-09-0${10 - n}`,
    final_date: null,
    permit_close_date: null,
    open_days: 30 - n,
    contractor_resolution: "unresolved",
    contractor_name_as_printed: null,
    bbb_url: null,
    cid: cid(`permit${n}`),
    source_url: `https://source.test/TEST-000${n}`,
    captured_at: "2026-10-20T14:02:05Z",
    table: "property_improvement/property_improvement",
    table_cid: TABLE_CID,
    run_id: RUN_ID,
    manifest_cid: MANIFEST_CID,
    as_of: "2026-10-01T00:00:00Z",
    missing: [
      { field: "status_raw", reason: "no_lexicon_carrier" },
      { field: "contractor_company_cid", reason: "contractor_unresolved" },
      { field: "contractor_name_raw", reason: "no_lexicon_carrier" },
      { field: "final_date", reason: "not_closed" },
    ],
    ...overrides,
  };
}

const ROWS: PermitListRow[] = [
  row(1),
  row(2, {
    improvement_status: null,
    status_class: "stalled",
    missing: [
      { field: "improvement_status", reason: "enum_lacks_value" },
      { field: "status_raw", reason: "no_lexicon_carrier" },
      { field: "contractor_company_cid", reason: "source_missing" },
    ],
  }),
  row(3, {
    status_class: null,
    source_url: null,
    contractor_resolution: "resolved",
    missing: [
      { field: "status_class", reason: "needs_review" },
      { field: "source_url", reason: "not_in_export" },
      { field: "expiry_date", reason: "no_lexicon_carrier" },
    ],
  }),
];

function loaded(overrides: Partial<PermitsLoaded> = {}): PermitsLoaded {
  return {
    runId: RUN_ID,
    manifestCid: MANIFEST_CID,
    permitsEmitted: ROWS.length,
    rows: ROWS,
    fallbackLabel: null,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const immediate =
  (value: PermitsLoaded): PermitsLoader =>
  () =>
    Promise.resolve(value);

/** jsdom has no matchMedia: the page falls back to the compact layout unless stubbed. */
function stubViewport(wide: boolean): void {
  const matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query === TABLE_MEDIA_QUERY ? wide : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
}

function renderPage(load: PermitsLoader) {
  return render(createElement(PermitsPage, { load }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("resolvePermitsState (FR-008, FR-009)", () => {
  it("is empty only for a manifest count of 0 with 0 rows", () => {
    expect(resolvePermitsState(loaded({ permitsEmitted: 0, rows: [] }))).toEqual({
      kind: "empty",
      runId: RUN_ID,
      manifestCid: MANIFEST_CID,
    });
  });

  it("is ready when the row count equals the manifest count", () => {
    const data = loaded();
    expect(resolvePermitsState(data)).toEqual({ kind: "ready", data });
  });

  it("is the count-mismatch error for any other difference, with the exact text", () => {
    expect(resolvePermitsState(loaded({ permitsEmitted: 3, rows: [] }))).toEqual({
      kind: "error",
      message: "Row count does not match the manifest: 0 listed, 3 published",
    });
    expect(resolvePermitsState(loaded({ permitsEmitted: 2 }))).toEqual({
      kind: "error",
      message: PERMITS_TEXTS.countMismatch(3, 2),
    });
  });
});

describe("errorText: the fixed banner texts", () => {
  it("maps the engine, run-index and both-hosts-down failures to their fixed texts", () => {
    expect(errorText(new EngineStartError(new Error("wasm")))).toBe(PERMITS_TEXTS.engineFailure);
    expect(errorText(new RunIndexError("unreadable"))).toBe(RUN_INDEX_TEXTS.unreadable);
    expect(errorText(new RunIndexError("empty"))).toBe(RUN_INDEX_TEXTS.empty);
    expect(errorText(new BothHostsDownError(MANIFEST_CID))).toBe(BOTH_HOSTS_DOWN_TEXT);
    expect(errorText(new Error("part read failed"))).toBe("part read failed");
    expect(errorText("odd")).not.toBe("");
  });
});

describe("loading (FR-008, TC-024): progress bar and skeletons, never a table or the empty state", () => {
  it("shows the Atlas linear progress named Loading permits with the stage text, and skeletons in a role=status aria-busy container", async () => {
    const pending = deferred<PermitsLoaded>();
    let report: ((stage: string) => void) | undefined;
    renderPage((r) => {
      report = r;
      return pending.promise;
    });

    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-label")).toBe(PROGRESS_LABELS.permits);
    expect(bar.getAttribute("aria-valuetext")).toBe(STAGE_TEXTS.engine);
    await waitFor(() => expect(report).toBeDefined());
    act(() => report?.(STAGE_TEXTS.bind));
    expect(bar.getAttribute("aria-valuetext")).toBe(STAGE_TEXTS.bind);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.querySelector("table")).toBeNull();
    expect(status.querySelectorAll("td, th")).toHaveLength(0);
    expect(status.children.length, "skeleton placeholders").toBeGreaterThan(0);
    expect(document.querySelectorAll("table")).toHaveLength(0);
    expect(screen.queryByText(PERMITS_TEXTS.empty)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      pending.resolve(loaded());
      await pending.promise;
    });
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ready (FR-003, TC-020…025): the single page of permits with provenance and labels", () => {
  it("renders the Atlas data table from 600 px: one row per permit in the given order, no sorting or column controls (paging: permits-paging.test.ts)", async () => {
    stubViewport(true);
    renderPage(immediate(loaded()));
    const table = await screen.findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    expect(headers).toEqual([
      "Permit number",
      "Improvement status",
      "Status class",
      "Issue date",
      "Contractor",
      "Missing data",
      "Provenance",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(ROWS.length);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]?.textContent?.trim())).toEqual([
      "TEST-0001",
      "TEST-0002",
      "TEST-0003",
    ]);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(table.querySelectorAll("[aria-sort]")).toHaveLength(0);
    const buttons = within(table).getAllByRole("button");
    expect(buttons.every((b) => /copy/i.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
    expect(screen.getByTestId("permits-range").textContent).toBe(PERMITS_TEXTS.showing(1, 3, 3));
  });

  it("renders cards below 600 px with the same content, the provenance line last", async () => {
    stubViewport(false);
    renderPage(immediate(loaded()));
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(ROWS.length);
    expect(screen.queryByRole("table")).toBeNull();
    expect(cards.map((c) => c.querySelector("h3")?.textContent?.trim())).toEqual([
      "TEST-0001",
      "TEST-0002",
      "TEST-0003",
    ]);
    const first = cards[0] as HTMLElement;
    expect(first.lastElementChild?.textContent).toContain("Source:");
    expect(first.lastElementChild?.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(
      TABLE_CID,
    );
  });

  it.each([true, false])(
    "shows every missing reason of every row as its approved label (wide=%s)",
    async (wide) => {
      stubViewport(wide);
      renderPage(immediate(loaded()));
      const items = wide
        ? (await screen.findByRole("table")).querySelectorAll("tbody tr")
        : await screen.findAllByRole("article");
      expect(items).toHaveLength(ROWS.length);
      ROWS.forEach((r, i) => {
        const el = items[i] as HTMLElement;
        expect(JSON.parse(el.getAttribute("data-missing") ?? "null")).toEqual(r.missing);
        const counts = new Map<string, number>();
        for (const m of r.missing) {
          const label = missingLabel(m.field, m.reason);
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        for (const [label, n] of counts) {
          expect(within(el).getAllByText(label), `${r.permit_number}: ${label}`).toHaveLength(n);
        }
        for (const pill of el.querySelectorAll("[data-reason]")) {
          expect(pill.textContent?.trim().length).toBeGreaterThan(0);
        }
        const text = el.textContent ?? "";
        expect(text).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b|—|\bN\/A\b/);
      });
    },
  );

  it("shows the contractor cell as the status pill plus the reason label (TC-025)", async () => {
    stubViewport(true);
    renderPage(immediate(loaded()));
    const rows = (await screen.findByRole("table")).querySelectorAll("tbody tr");
    const contractor = (i: number): HTMLElement =>
      within(rows[i] as HTMLElement).getAllByRole("cell")[4] as HTMLElement;

    const unresolved = contractor(0);
    const pill = unresolved.querySelector("[data-status]");
    expect(pill?.getAttribute("data-status")).toBe("unavailable");
    expect(pill?.textContent?.trim()).toBe("unresolved");
    expect(within(unresolved).getByText(MISSING_REASON_LABELS.contractor_unresolved)).toBeTruthy();
    expect(within(unresolved).getByText(MISSING_REASON_LABELS.no_lexicon_carrier)).toBeTruthy();

    // contractor_company_cid source_missing: the permit printed none, so the pill says that and
    // never "unresolved" (A-16 data audit row 8).
    const notPrinted = contractor(1);
    expect(within(notPrinted).getByText(CONTRACTOR_NOT_PRINTED_LABEL)).toBeTruthy();
    const notPrintedPill = notPrinted.querySelector("[data-status]:not([data-reason])");
    expect(notPrintedPill?.textContent?.trim()).toBe(NO_CONTRACTOR_PRINTED);
    expect(notPrintedPill?.getAttribute("data-status")).toBe("unavailable");
    expect(within(notPrinted).queryByText("unresolved")).toBeNull();

    const resolved = contractor(2);
    const okPill = resolved.querySelector("[data-status]");
    expect(okPill?.getAttribute("data-status")).toBe("verified");
    expect(okPill?.textContent?.trim()).toBe("resolved");
  });

  it("shows the printed contractor name with its BBB search link, else says none was printed (data audit rows 1, 9, 17)", async () => {
    stubViewport(true);
    const printed = row(1, {
      contractor_name_as_printed: "TEST ROOFING CO",
      bbb_url: "https://www.bbb.org/search?find_text=TEST%20ROOFING%20CO",
      missing: [],
    });
    renderPage(immediate(loaded({ rows: [printed, row(2, { missing: [] })], permitsEmitted: 2 })));
    const rows = (await screen.findByRole("table")).querySelectorAll("tbody tr");
    const contractor = (i: number): HTMLElement =>
      within(rows[i] as HTMLElement).getAllByRole("cell")[4] as HTMLElement;

    expect(within(contractor(0)).getByText("As printed: TEST ROOFING CO")).toBeTruthy();
    const link = within(contractor(0)).getByRole("link", { name: BBB_SEARCH_LINK_LABEL });
    expect(link.getAttribute("href")).toBe(printed.bbb_url);
    expect(link.getAttribute("rel")).toContain("noopener");

    expect(within(contractor(1)).getByText(EXPLORE_TEXTS.contractorNotPrinted)).toBeTruthy();
    expect(within(contractor(1)).getByText(EXPLORE_TEXTS.bbbBlocked)).toBeTruthy();
    expect(within(contractor(1)).queryByRole("link")).toBeNull();
  });

  it("shows the final and close dates and days open under the issue date when the row has them", async () => {
    stubViewport(true);
    const closed = row(1, {
      status_class: "closed",
      final_date: "2026-09-20",
      permit_close_date: "2026-09-22",
      open_days: null,
      missing: [],
    });
    renderPage(immediate(loaded({ rows: [closed, row(2, { missing: [] })], permitsEmitted: 2 })));
    const rows = (await screen.findByRole("table")).querySelectorAll("tbody tr");
    const dates = (i: number): HTMLElement =>
      within(rows[i] as HTMLElement).getAllByRole("cell")[3] as HTMLElement;
    expect([...dates(0).querySelectorAll("[data-date-line]")].map((el) => el.textContent)).toEqual([
      "Final 2026-09-20",
      "Closed 2026-09-22",
    ]);
    expect([...dates(1).querySelectorAll("[data-date-line]")].map((el) => el.textContent)).toEqual([
      "Open 28 days",
    ]);
  });

  it("shows the displayed fields' values, or their Missing-reason label in the same cell", async () => {
    stubViewport(true);
    renderPage(immediate(loaded()));
    const rows = (await screen.findByRole("table")).querySelectorAll("tbody tr");
    const cells = (i: number) => within(rows[i] as HTMLElement).getAllByRole("cell");
    expect(cells(0)[1]?.textContent?.trim()).toBe("Permitted");
    expect(cells(0)[2]?.textContent?.trim()).toBe("open");
    expect(cells(0)[3]?.querySelector("[data-issue-date]")?.textContent?.trim()).toBe("2026-09-09");
    expect(cells(1)[1]?.textContent?.trim()).toBe(MISSING_REASON_LABELS.enum_lacks_value);
    expect(cells(1)[2]?.textContent?.trim()).toBe("stalled");
    expect(cells(2)[2]?.textContent?.trim()).toBe(MISSING_REASON_LABELS.needs_review);
  });

  it("shows the § 8 provenance line on every row: source link, capture time, table CID with data-cid, run (TC-021)", async () => {
    stubViewport(true);
    renderPage(immediate(loaded()));
    const rows = (await screen.findByRole("table")).querySelectorAll("tbody tr");
    ROWS.forEach((r, i) => {
      const el = rows[i] as HTMLElement;
      const provenance = within(el).getAllByRole("cell")[6] as HTMLElement;
      const link = within(provenance).queryByRole("link");
      if (r.source_url === null) {
        expect(link).toBeNull();
        expect(within(provenance).getByText(MISSING_REASON_LABELS.not_in_export)).toBeTruthy();
      } else {
        expect(link?.getAttribute("href")).toBe(r.source_url);
      }
      expect(provenance.querySelector("time")?.getAttribute("datetime")).toBe(r.captured_at);
      expect(provenance.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(r.table_cid);
      expect(provenance.textContent).toContain(truncateCid(r.table_cid));
      expect(provenance.textContent).toContain(`run ${r.run_id}`);
    });
  });

  it("shows the engine line verbatim, with the fallback chip beside it only on a fallback read (TC-023, TC-032)", async () => {
    stubViewport(true);
    const { unmount } = renderPage(immediate(loaded()));
    await screen.findByRole("table");
    const line = screen.getByText(ENGINE_LINE_TEXT);
    expect(line.textContent).toBe("DuckDB-WASM in your browser · read-only");
    expect(screen.queryByText(/^fallback · /)).toBeNull();
    unmount();

    renderPage(immediate(loaded({ fallbackLabel: "fallback · gateway.test" })));
    await screen.findByRole("table");
    const chip = screen.getByText("fallback · gateway.test");
    expect(chip.closest("[data-status]")?.getAttribute("data-status")).toBe("warning");
    expect(chip.closest("[data-engine-line]"), "beside the engine line").not.toBeNull();
  });
});

describe("A-03-TC-029: empty state only for a manifest 0; count mismatch otherwise (FR-008, FR-009)", () => {
  it("A-03-TC-029 (a): permits_emitted 0 and 0 rows → the empty state with the run ID and manifest CID; no table, progress bar or banner", async () => {
    renderPage(immediate(loaded({ permitsEmitted: 0, rows: [] })));
    const heading = await screen.findByRole("heading", { name: PERMITS_TEXTS.empty });
    expect(heading.textContent).toBe("No permits published in this run");
    const empty = heading.parentElement as HTMLElement;
    expect(empty.textContent).toContain(RUN_ID);
    expect(empty.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(MANIFEST_CID);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("A-03-TC-029 (b): permits_emitted 3 and 0 rows → the count-mismatch banner, not the empty state", async () => {
    renderPage(immediate(loaded({ permitsEmitted: 3, rows: [] })));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Row count does not match the manifest: 0 listed, 3 published",
    );
    expect(screen.queryByText(PERMITS_TEXTS.empty)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("A-03-TC-029 (c): the empty state is never rendered while the engine is loading", async () => {
    const pending = deferred<PermitsLoaded>();
    renderPage(() => pending.promise);
    await screen.findByRole("progressbar");
    expect(screen.queryByText(PERMITS_TEXTS.empty)).toBeNull();
    await act(async () => {
      pending.resolve(loaded({ permitsEmitted: 0, rows: [] }));
      await pending.promise;
    });
    await screen.findByRole("heading", { name: PERMITS_TEXTS.empty });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("error: engine failure and Retry", () => {
  it("shows the fixed engine-failure text in the error banner and Retry re-runs the load", async () => {
    const load = vi.fn<PermitsLoader>();
    load.mockRejectedValueOnce(new EngineStartError(new Error("WebAssembly.instantiate failed")));
    load.mockResolvedValueOnce(loaded());
    stubViewport(true);
    renderPage(load);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Query engine could not start");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByRole("table");
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ERR-11: a row that fails the contract/v1 check shows the fixed text; the detail goes to console.error only", () => {
  /** What the engine returned on the preview before ERR-10: `missing` entries as value arrays. */
  const unreadableRow = (): Record<string, unknown> => ({
    ...row(1),
    missing: [["status_raw", "no_lexicon_carrier"]],
  });

  it("parsePermitRows rejects the row with the fixed rows-unreadable text, keeping the zod detail off the message", () => {
    let caught: unknown;
    try {
      parsePermitRows([unreadableRow()]);
    } catch (error) {
      caught = error;
    }
    expect(errorText(caught)).toBe(PERMITS_TEXTS.rowsUnreadable);
    expect((caught as { detail?: unknown }).detail).toMatch(/expected object, received array/);
  });

  it("shows PERMITS_TEXTS.rowsUnreadable in the banner (never the zod message) and logs the detail with console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load: PermitsLoader = () =>
      Promise.resolve().then(() => loaded({ rows: parsePermitRows([unreadableRow()]) }));
    stubViewport(true);
    renderPage(load);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(PERMITS_TEXTS.rowsUnreadable);
    expect(alert.textContent).not.toMatch(/contract\/v1|expected object|path/);
    expect(
      document.querySelector('section[data-route="permits"]')?.getAttribute("data-state"),
    ).toBe("error");
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    const logged = consoleError.mock.calls.flat().map(String).join(" ");
    expect(logged).toMatch(/expected object, received array/);
  });
});

describe("TC-086: the level-2 heading is there in every state", () => {
  it("renders `Permits` as an h2 while loading, on error and when ready", async () => {
    const pending = deferred<PermitsLoaded>();
    const first = renderPage(() => pending.promise);
    expect(screen.getByRole("heading", { level: 2, name: "Permits" })).toBeDefined();
    first.unmount();

    const failing = vi.fn<PermitsLoader>();
    failing.mockRejectedValueOnce(new EngineStartError(new Error("boom")));
    stubViewport(true);
    const second = renderPage(failing);
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { level: 2, name: "Permits" })).toBeDefined();
    second.unmount();

    renderPage(immediate(loaded()));
    await screen.findByRole("table");
    expect(screen.getByRole("heading", { level: 2, name: "Permits" })).toBeDefined();
  });
});
