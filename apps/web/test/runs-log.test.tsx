// A-13 T039 (G3): Runs · Log (`/runs/log`), US9, AC-12, FR-012; TC-057. Every event of every
// manifest in runs/index.json (run-events), newest first (the Time header sorts ascending),
// each with its run ID. Texts and source names come from the fixtures and @countylens/shared;
// no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { SOURCE_LABELS } from "@countylens/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runEvents } from "../src/data/run-events";

const COPY_HOST = "copy.example.test";
const GATEWAY_HOST = "ipfs.filebase.io";
const encode = (t: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(t);

function manifestOf(
  runId: string,
  start: string,
  captures: [string, string][],
  end: string,
): RunManifestV1 {
  return {
    schema: RUN_MANIFEST_SCHEMA,
    runId,
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: start,
    finishedAt: end,
    previousManifestCid: null,
    sources: captures.map(([name, at]) => ({
      name,
      url: "https://example.test/source",
      watermark: null,
      captured_at: at,
      records: 1,
      added: 1,
      changed: 0,
      removed: 0,
      limitations: [],
    })),
    artifacts: [],
    profiles: [],
    coverage: {},
    limitations: [`limitation of ${runId}`],
  };
}

interface Run {
  manifest: RunManifestV1;
  bytes: Uint8Array<ArrayBuffer>;
  cid: string;
}
let runs: Run[] = [];

beforeAll(async () => {
  const defs = [
    manifestOf(
      "test-run-one",
      "2026-10-19T08:00:00.000Z",
      [["tcad-2026-certified-json", "2026-10-19T08:05:00.000Z"]],
      "2026-10-19T08:10:00.000Z",
    ),
    manifestOf(
      "test-run-two",
      "2026-10-20T08:00:00.000Z",
      [
        ["austin-3syk-w9eu", "2026-10-20T08:01:00.000Z"],
        ["tcad-2026-certified-json", "2026-10-20T08:05:00.000Z"],
      ],
      "2026-10-20T08:12:00.000Z",
    ),
  ];
  runs = [];
  for (const manifest of defs) {
    const bytes = encode(JSON.stringify(manifest));
    runs.push({ manifest, bytes, cid: await rawCid(bytes) });
  }
});

function install(options: { failSecond?: boolean; indexStatus?: number } = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/runs/index.json") {
        if (options.indexStatus !== undefined)
          return new Response("x", { status: options.indexStatus });
        return new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: runs.map((r) => ({
              runId: r.manifest.runId,
              manifestCid: r.cid,
              finishedAt: r.manifest.finishedAt,
            })),
          }),
        );
      }
      const parsed = new URL(url);
      if (parsed.host === COPY_HOST) {
        const run = runs.find((r) => url.includes(r.cid));
        if (options.failSecond === true && run === runs[1])
          return new Response("x", { status: 503 });
        return run === undefined ? new Response("x", { status: 404 }) : new Response(run.bytes);
      }
      return new Response("x", { status: 503 });
    }),
  );
}

async function renderLog(): Promise<HTMLElement> {
  const { Component } = await import("../src/routes/RunsLog");
  render(
    <MemoryRouter initialEntries={["/runs/log"]}>
      <Component />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Runs · Log" });
}

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", GATEWAY_HOST);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Runs · Log", () => {
  it("lists every event of every run, newest first, each with its run ID", async () => {
    install();
    const page = await renderLog();
    await within(page).findByRole("table", { name: "Run events" });
    expect(page.getAttribute("data-state")).toBe("ready");
    const expected = runEvents(runs.map((r) => r.manifest)).reverse();
    expect(expected).toHaveLength(7);
    const items = page.querySelectorAll<HTMLElement>("tr[data-event]");
    expect([...items].map((li) => li.getAttribute("data-time"))).toEqual(
      expected.map((e) => e.time),
    );
    expect([...items].map((li) => li.getAttribute("data-run-id"))).toEqual(
      expected.map((e) => e.runId),
    );
    expect([...items].map((li) => li.getAttribute("data-event"))).toEqual(
      expected.map((e) => e.kind),
    );
    for (const li of items) expect(li.textContent).toContain(li.getAttribute("data-run-id"));
  });

  it("sorts oldest first from the Time header (A-13 AC-12)", async () => {
    install();
    const page = await renderLog();
    await within(page).findByRole("table", { name: "Run events" });
    const header = within(page).getByRole("columnheader", { name: /Time \(UTC\)/ });
    expect(header.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    const times = [...page.querySelectorAll<HTMLElement>("tr[data-event]")].map((tr) =>
      tr.getAttribute("data-time"),
    );
    expect(times).toEqual(runEvents(runs.map((r) => r.manifest)).map((e) => e.time));
  });

  it("names the captured source and shows the run's limitations on its finish event", async () => {
    install();
    const page = await renderLog();
    await within(page).findByRole("table", { name: "Run events" });
    expect(
      within(page).getAllByText(SOURCE_LABELS["austin-3syk-w9eu"], { exact: false }).length,
    ).toBe(1);
    expect(within(page).getByText("limitation of test-run-one")).toBeTruthy();
    expect(within(page).getByText("limitation of test-run-two")).toBeTruthy();
  });

  it("collapses a finish event's limitations behind a disclosure (D-6)", async () => {
    install();
    const page = await renderLog();
    await within(page).findByRole("table", { name: "Run events" });
    const finish = page.querySelector<HTMLElement>(
      'tr[data-event="finished"][data-run-id="test-run-two"]',
    );
    const details = finish?.querySelector("details");
    expect(details, "limitations sit in a <details>").not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Limitations (1)");
    expect(details?.textContent).toContain("limitation of test-run-two");
  });

  it("shows the run number from the index with the run ID as secondary text (D-6)", async () => {
    install();
    const page = await renderLog();
    await within(page).findByRole("table", { name: "Run events" });
    const started = page.querySelector<HTMLElement>(
      'tr[data-event="started"][data-run-id="test-run-two"]',
    );
    const cell = started?.querySelector("[data-run-number]")?.closest("td");
    expect(cell?.querySelector("[data-run-number]")?.textContent).toBe("Run 2");
    expect(cell?.querySelector("[data-run-id-text]")?.textContent).toBe("test-run-two");
    expect(started?.querySelector("td:last-child [data-status]")).not.toBeNull();
  });

  it("shows the progress bar while loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const page = await renderLog();
    expect(page.getAttribute("data-state")).toBe("loading");
    expect(await screen.findByRole("progressbar")).toBeTruthy();
  });

  it("an unreadable index says so with a link, and lists no event", async () => {
    install({ indexStatus: 404 });
    const page = await renderLog();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Run index unavailable · /);
    expect(page.getAttribute("data-state")).toBe("error");
    expect(page.querySelectorAll("tr[data-event]")).toHaveLength(0);
  });

  it("one unreadable manifest names its CID, and the other runs still list", async () => {
    install({ failSecond: true });
    const page = await renderLog();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Manifest unavailable · /);
    expect(alert.querySelector(`[data-cid="${runs[1]?.cid}"]`)).not.toBeNull();
    const items = page.querySelectorAll("tr[data-event]");
    expect(items).toHaveLength(runEvents([(runs[0] as Run).manifest]).length);
  });
});
