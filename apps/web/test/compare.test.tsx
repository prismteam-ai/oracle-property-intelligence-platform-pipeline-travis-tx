// A-13 T018 (AC-1, FR-001a, FR-001b, FR-016; TC-007, TC-014, TC-015): Runs · Compare
// (`/runs/compare?a=&b=`). With one published run it says why nothing can be compared and links
// to that run; with two it shows both manifest CIDs, the `previousManifestCid` link between them
// and "old manifest still resolves on Pinata and orbitor" only after both independent gateways
// answered for the old CID with its own bytes; Filebase is checked and listed as the labelled
// fallback but never decides the text (ARD § 16 AM-10). Fixtures are built in the test (real raw-leaves
// CIDs of test bytes, never shown as real data); fetches are vi.fn, no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { RUNS_TEXTS, VERIFY_TEXTS } from "@countylens/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const PINATA_HOST = "pinata.example.test";
const ORBITOR_HOST = "orbitor.example.test";

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

interface Run {
  manifest: RunManifestV1;
  bytes: Uint8Array<ArrayBuffer>;
  cid: string;
}

async function buildRun(n: number, previous: string | null): Promise<Run> {
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: `travis-test-run-${n}`,
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: `2026-10-0${n}T08:00:00.000Z`,
    finishedAt: `2026-10-0${n}T08:10:00.000Z`,
    previousManifestCid: previous,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: null,
        captured_at: `2026-10-0${n}T08:01:00.000Z`,
        records: 10 * n,
        added: n,
        changed: n + 1,
        removed: n + 2,
        limitations: [],
      },
    ],
    artifacts: [],
    profiles: [],
    coverage: { permits_emitted: { count: 10 * n, derivation: "published_rows" } },
    limitations: [],
  };
  const bytes = encode(JSON.stringify(manifest));
  return { manifest, bytes, cid: await rawCid(bytes) };
}

let run1: Run;
let run2: Run;

beforeAll(async () => {
  run1 = await buildRun(1, null);
  run2 = await buildRun(2, run1.cid);
});

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const indexOf = (runs: Run[]): string =>
  JSON.stringify({
    schema: RUNS_INDEX_SCHEMA,
    runs: runs.map((r) => ({
      runId: r.manifest.runId,
      manifestCid: r.cid,
      finishedAt: r.manifest.finishedAt,
    })),
  });

type Handler = (cid: string) => Response | Promise<Response>;

function installFetch(
  runs: Run[],
  hosts: { copy?: Handler; filebase?: Handler; pinata?: Handler; orbitor?: Handler },
) {
  const byCid = new Map(runs.map((r) => [r.cid, r.bytes]));
  const serve: Handler = (cid) => {
    const bytes = byCid.get(cid);
    return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes);
  };
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === "/runs/index.json") return new Response(indexOf(runs));
    const parsed = new URL(url);
    const cid = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    if (parsed.host === COPY_HOST) return (hosts.copy ?? serve)(cid);
    if (parsed.host === FILEBASE_HOST) return (hosts.filebase ?? serve)(cid);
    if (parsed.host === PINATA_HOST) return (hosts.pinata ?? serve)(cid);
    if (parsed.host === ORBITOR_HOST) return (hosts.orbitor ?? serve)(cid);
    throw new TypeError(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderCompare(search = ""): Promise<void> {
  const { Component } = await import("../src/routes/RunsCompare");
  render(
    <MemoryRouter initialEntries={[`/runs/compare${search}`]}>
      <Component />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", FILEBASE_HOST);
  vi.stubEnv("VITE_PINATA_GATEWAY_HOST", PINATA_HOST);
  vi.stubEnv("VITE_ORBITOR_GATEWAY_HOST", ORBITOR_HOST);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Compare with one published run (FR-001b, TC-014)", () => {
  it("says `first run · nothing to compare against`, links to the run and invents no second run", async () => {
    installFetch([run1], {});
    await renderCompare("?a=1&b=2");

    expect(await screen.findByText(RUNS_TEXTS.firstRun)).toBeDefined();
    // One card for the one real run, and no per-run comparison column (no second run invented).
    expect(document.querySelectorAll("[data-compare-single]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-compare-run]")).toHaveLength(0);
    // TC-014: a link to that run's manifest.
    expect(
      document.querySelector(`a[href*="${run1.cid}"]`),
      "link to the run's manifest",
    ).not.toBeNull();
    expect(document.querySelector(`[data-cid="${run1.cid}"]`)).not.toBeNull();
    expect(screen.getByRole("link", { name: run1.manifest.runId }).getAttribute("href")).toBe(
      "/runs",
    );
    expect(screen.queryByText(RUNS_TEXTS.oldManifestResolves)).toBeNull();
  });
});

describe("Compare falls back to the defaults for empty or 0 run numbers (review finding 12)", () => {
  for (const search of ["?a=&b=", "?a=0&b=0", "?a=0", "?b=", ""]) {
    it(`shows the previous and the latest run for ${JSON.stringify(search)}`, async () => {
      installFetch([run1, run2], {});
      await renderCompare(search);
      const cards = await screen.findAllByRole("article");
      expect(cards).toHaveLength(2);
      expect(cards[0]?.querySelector(`[data-cid="${run1.cid}"]`)).not.toBeNull();
      expect(cards[1]?.querySelector(`[data-cid="${run2.cid}"]`)).not.toBeNull();
    });
  }

  it("states the numbering contract once", async () => {
    installFetch([run1, run2], {});
    await renderCompare("?a=1&b=2");
    await screen.findAllByRole("article");
    expect(screen.getByText(RUNS_TEXTS.numbering)).toBeDefined();
  });
});

describe("Compare with two runs (FR-001a, TC-007, TC-015)", () => {
  it("shows both manifest CIDs, the previousManifestCid link and the newer run's per-source deltas", async () => {
    installFetch([run1, run2], {});
    await renderCompare("?a=1&b=2");

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector(`[data-cid="${run1.cid}"]`)).not.toBeNull();
    expect(cards[1]?.querySelector(`[data-cid="${run2.cid}"]`)).not.toBeNull();
    const link = document.querySelector("[data-previous-cid]");
    expect(link?.getAttribute("data-previous-cid")).toBe(run1.cid);
    const source = run2.manifest.sources[0];
    expect(cards[1]?.querySelector('[data-delta="added"]')?.textContent).toBe(
      String(source?.added),
    );
    expect(cards[1]?.querySelector('[data-delta="removed"]')?.textContent).toBe(
      String(source?.removed),
    );
  });

  it("shows the per-source change columns only for neighbours (label review 2026-10-26)", async () => {
    const run3 = await buildRun(3, run2.cid);
    installFetch([run1, run2, run3], {});
    await renderCompare("?a=2&b=3");
    await screen.findAllByRole("article");
    const near = await waitFor(() => {
      const table = document.querySelector("[data-change-table]");
      if (table === null) throw new Error("no change table yet");
      return table;
    });
    expect(near.getAttribute("data-neighbours")).toBe("yes");
    expect(near.textContent).toContain(`+${String(run3.manifest.sources[0]?.added)}`);
    cleanup();

    installFetch([run1, run2, run3], {});
    await renderCompare("?a=1&b=3");
    await screen.findAllByRole("article");
    const far = await waitFor(() => {
      const table = document.querySelector("[data-change-table]");
      if (table === null) throw new Error("no change table yet");
      return table;
    });
    expect(far.getAttribute("data-neighbours")).toBe("no");
    expect(far.querySelector("[data-delta-note]")).not.toBeNull();
    expect(far.textContent).not.toContain(`+${String(run3.manifest.sources[0]?.added)}`);
  });

  it("shows `old manifest still resolves on Pinata and orbitor` only after both independent gateways answered", async () => {
    let releasePinata: (r: Response) => void = () => undefined;
    const pinataAnswer = new Promise<Response>((resolve) => {
      releasePinata = resolve;
    });
    const fetchMock = installFetch([run1, run2], { pinata: () => pinataAnswer });
    await renderCompare("?a=1&b=2");
    await screen.findAllByRole("article");

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => urlOf(input).includes(FILEBASE_HOST))).toBe(
        true,
      ),
    );
    expect(screen.queryByText(RUNS_TEXTS.oldManifestResolves)).toBeNull();

    releasePinata(new Response(run1.bytes));
    expect(await screen.findByText(RUNS_TEXTS.oldManifestResolves)).toBeDefined();
    const checks = fetchMock.mock.calls
      .map(([input]) => new URL(urlOf(input), "https://app.test"))
      .filter((u) => u.pathname.endsWith(run1.cid) && u.host !== COPY_HOST);
    expect(new Set(checks.map((u) => u.host))).toEqual(
      new Set([PINATA_HOST, ORBITOR_HOST, FILEBASE_HOST]),
    );
  });

  it("withholds the text and shows the failed gateway when orbitor answers 504; re-check shows it", async () => {
    let orbitorUp = false;
    installFetch([run1, run2], {
      orbitor: (cid) =>
        orbitorUp && cid === run1.cid
          ? new Response(run1.bytes)
          : cid === run1.cid
            ? new Response(null, { status: 504 })
            : new Response(run2.bytes),
    });
    await renderCompare("?a=1&b=2");
    const check = await screen.findByRole("region", { name: /old manifest/i });
    await waitFor(() =>
      expect(check.querySelector('[data-gateway="orbitor"]')?.getAttribute("data-check")).toBe(
        "fails",
      ),
    );
    expect(screen.queryByText(RUNS_TEXTS.oldManifestResolves)).toBeNull();

    orbitorUp = true;
    fireEvent.click(within(check).getByRole("button", { name: /re-check/i }));
    expect(await screen.findByText(RUNS_TEXTS.oldManifestResolves)).toBeDefined();
  });

  it("a counted gateway with no readable answer shows no error pill on the old-manifest check", async () => {
    installFetch([run1, run2], {
      orbitor: (cid) =>
        cid === run1.cid ? new Response(null, { status: 504 }) : new Response(run2.bytes),
    });
    await renderCompare("?a=1&b=2");
    const check = await screen.findByRole("region", { name: /old manifest/i });
    await waitFor(() =>
      expect(check.querySelector('[data-gateway="orbitor"]')?.getAttribute("data-check")).toBe(
        "fails",
      ),
    );
    // Only the pill is withheld; a gateway miss is never shown as an error (no bytes differed).
    expect(check.querySelector('[data-status="error"]')).toBeNull();
    expect(screen.queryByText(RUNS_TEXTS.oldManifestResolves)).toBeNull();
  });

  it("a Filebase failure does not withhold the text; Filebase is listed as the fallback (AM-10)", async () => {
    installFetch([run1, run2], {
      filebase: (cid) =>
        cid === run1.cid ? new Response(null, { status: 504 }) : new Response(run2.bytes),
    });
    await renderCompare("?a=1&b=2");
    const check = await screen.findByRole("region", { name: /old manifest/i });
    expect(await screen.findByText(RUNS_TEXTS.oldManifestResolves)).toBeDefined();
    const filebase = check.querySelector('[data-gateway="filebase"]');
    await waitFor(() => expect(filebase?.getAttribute("data-check")).toBe("fails"));
    expect(filebase?.textContent).toContain(VERIFY_TEXTS.laneRoles.filebase);
    expect(check.querySelector('[data-gateway="pinata"]')?.textContent).not.toContain(
      VERIFY_TEXTS.laneRoles.filebase,
    );
  });

  it("defaults to the latest run and the one before it", async () => {
    installFetch([run1, run2], {});
    await renderCompare();
    const cards = await screen.findAllByRole("article");
    expect(cards[0]?.querySelector(`[data-cid="${run1.cid}"]`)).not.toBeNull();
    expect(cards[1]?.querySelector(`[data-cid="${run2.cid}"]`)).not.toBeNull();
  });

  it("labels a manifest read served by Filebase with the fallback chip (FR-016)", async () => {
    installFetch([run1, run2], { copy: () => new Response(null, { status: 500 }) });
    await renderCompare("?a=1&b=2");
    await screen.findAllByRole("article");
    expect((await screen.findAllByText(`fallback · ${FILEBASE_HOST}`)).length).toBeGreaterThan(0);
  });
});

describe("Compare errors (FR-021)", () => {
  it("says `Run index unavailable · {reason}` when the index cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("{not json")),
    );
    await renderCompare("?a=1&b=2");
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-error-text]")?.textContent).toMatch(
      /^Run index unavailable · .+/,
    );
  });
});
