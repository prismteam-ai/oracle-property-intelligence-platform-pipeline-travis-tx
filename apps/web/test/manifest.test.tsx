// A-13 T022 (AC-3, FR-003c, FR-003d, FR-016; TC-005, TC-018, TC-019, TC-024): Data · Manifest
// (`/data/manifest`). The run chain first (latest → previous, each with Verify and Copy CID),
// then one row per manifest artifact with CID (`data-cid`), name, codec, size, SHA-256 and CAR;
// a file ≤ 50 MB links to Verify, a directory or a file over 50 MB reads "Verify via CAR" and
// links to its CAR. A read served by Filebase shows the fallback chip. Fixtures built in the
// test; fetches are vi.fn, no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { VERIFY_TEXTS, verifyPath } from "@countylens/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { humanBytes } from "../src/routes/DataManifest";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const cidOf = (seed: string): Promise<string> => rawCid(encode(seed));

interface Run {
  manifest: RunManifestV1;
  bytes: Uint8Array<ArrayBuffer>;
  cid: string;
}

async function buildRun(n: number, previous: string | null): Promise<Run> {
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: `travis-test-manifest-${n}`,
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
        captured_at: "2026-10-01T08:01:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "car/travis-county.car",
        cid: await cidOf(`car ${n}`),
        codec: "dag-json",
        size: 4000,
        sha256: "a".repeat(64),
        kind: "car",
      },
      {
        name: "tables/county",
        cid: await cidOf(`dir ${n}`),
        codec: "dag-json",
        size: 300,
        sha256: "b".repeat(64),
        kind: "directory",
        carCid: await cidOf(`car ${n}`),
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: await cidOf(`part ${n}`),
        codec: "raw",
        size: 1234,
        sha256: "c".repeat(64),
        kind: "table",
      },
      {
        name: "tables/county/structure/part-00000.parquet",
        cid: await cidOf(`big ${n}`),
        codec: "raw",
        size: 60 * 1024 * 1024,
        sha256: "d".repeat(64),
        kind: "table",
      },
    ],
    profiles: [],
    coverage: {},
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

function install(runs: Run[], copyDown = false) {
  const byCid = new Map(runs.map((r) => [r.cid, r.bytes]));
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === "/runs/index.json") {
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
    if (parsed.host === COPY_HOST && copyDown) return new Response(null, { status: 503 });
    const bytes = byCid.get(parsed.pathname.split("/").pop() ?? "");
    return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderManifest(): Promise<void> {
  await renderManifestAt("/data/manifest");
}

async function renderManifestAt(path: string): Promise<void> {
  const { Component } = await import("../src/routes/DataManifest");
  render(
    <MemoryRouter initialEntries={[path]}>
      <Component />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", FILEBASE_HOST);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const artifactRows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>("[data-artifact]"),
];

describe("Data · Manifest artifacts (FR-003d, TC-005)", () => {
  it("lists every artifact with CID, name, codec, size, SHA-256 and CAR", async () => {
    install([run1]);
    await renderManifest();
    await screen.findByRole("table");

    const rows = artifactRows();
    expect(rows).toHaveLength(run1.manifest.artifacts.length);
    run1.manifest.artifacts.forEach((artifact, i) => {
      const row = rows[i] as HTMLElement;
      expect(row.getAttribute("data-artifact")).toBe(artifact.name);
      expect(row.querySelector(`[data-cid="${artifact.cid}"]`)).not.toBeNull();
      expect(row.textContent).toContain(artifact.name);
      expect(row.textContent).toContain(artifact.codec);
      // A-16 board: human size and a short hash on screen; the exact values in the attributes.
      expect(row.querySelector("[data-size]")?.getAttribute("data-size")).toBe(
        String(artifact.size),
      );
      expect(row.querySelector("[data-size]")?.textContent).toBe(humanBytes(artifact.size));
      expect(row.querySelector("[data-sha256]")?.getAttribute("data-sha256")).toBe(artifact.sha256);
      expect(row.querySelector("[data-sha256]")?.getAttribute("title")).toBe(artifact.sha256);
      expect(row.textContent).toContain(artifact.sha256.slice(0, 8));
      if (artifact.carCid !== undefined) {
        expect(row.querySelector(`[data-car-cid="${artifact.carCid}"]`)).not.toBeNull();
      }
    });
  });

  it("links a file ≤ 50 MB to Verify and shows `Verify via CAR` for a directory or a file over 50 MB", async () => {
    install([run1]);
    await renderManifest();
    await screen.findByRole("table");

    const [car, dir, part, big] = artifactRows();
    expect(
      within(part as HTMLElement)
        .getByRole("link", { name: "Verify" })
        .getAttribute("href"),
    ).toBe(verifyPath(run1.manifest.artifacts[2]?.cid ?? ""));
    expect(within(car as HTMLElement).getByRole("link", { name: "Verify" })).toBeDefined();
    const viaCar = within(dir as HTMLElement).getByRole("link", { name: VERIFY_TEXTS.viaCar });
    expect(viaCar.getAttribute("href")).toBe(verifyPath(run1.manifest.artifacts[1]?.carCid ?? ""));
    expect(within(big as HTMLElement).getByText(VERIFY_TEXTS.viaCar)).toBeDefined();
    expect(within(big as HTMLElement).queryByRole("link", { name: "Verify" })).toBeNull();
  });
});

describe("Data · Manifest run chain (FR-003d, TC-024)", () => {
  it("lists the chain latest → previous with Verify and Copy CID per run", async () => {
    install([run1, run2]);
    await renderManifest();

    const chain = await screen.findByRole("list", { name: "Run chain" });
    const items = await within(chain).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(`[data-cid="${run2.cid}"]`)).not.toBeNull();
    expect(items[1]?.querySelector(`[data-cid="${run1.cid}"]`)).not.toBeNull();
    for (const [i, run] of [run2, run1].entries()) {
      const item = items[i] as HTMLElement;
      expect(within(item).getByRole("link", { name: "Verify" }).getAttribute("href")).toBe(
        verifyPath(run.cid),
      );
      expect(within(item).getAllByRole("button", { name: "Copy CID" }).length).toBeGreaterThan(0);
    }
    expect(items[1]?.textContent).toContain("previous: none");
  });
});

describe("Data · Manifest run numbering (D-10)", () => {
  it("labels each chain link with its runs/index.json number, as the header and Runs do", async () => {
    // Three runs in the index; only the last two link (run 2 starts a new chain), so chain
    // position (2, 1) and index number (3, 2) differ.
    const r1 = await buildRun(1, null);
    const r2 = await buildRun(2, null);
    const r3 = await buildRun(3, r2.cid);
    install([r1, r2, r3]);
    await renderManifest();
    const chain = await screen.findByRole("list", { name: "Run chain" });
    const items = await within(chain).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector("[data-chain-label]")?.textContent).toBe("Run 3 · this run");
    expect(items[1]?.querySelector("[data-chain-label]")?.textContent).toBe("Run 2");
  });
});

describe("Data · Manifest run picker", () => {
  it("lists every indexed run newest first and opens the latest by default", async () => {
    install([run1, run2]);
    await renderManifest();
    const picker = await screen.findByRole("combobox", { name: "Run" });
    const options = within(picker).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      run2.manifest.runId,
      run1.manifest.runId,
    ]);
    expect(options[0]?.textContent).toMatch(/^Run 2 · /);
    expect((picker as HTMLSelectElement).value).toBe(run2.manifest.runId);
  });

  it("shows the run named by ?run= (its manifest, artifacts and chain)", async () => {
    install([run1, run2]);
    await renderManifestAt(`/data/manifest?run=${run1.manifest.runId}`);
    const chain = await screen.findByRole("list", { name: "Run chain" });
    const items = await within(chain).findAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.querySelector(`[data-cid="${run1.cid}"]`)).not.toBeNull();
    expect(items[0]?.querySelector("[data-chain-label]")?.textContent).toBe("Run 1 · this run");
    const picker = screen.getByRole("combobox", { name: "Run" }) as HTMLSelectElement;
    expect(picker.value).toBe(run1.manifest.runId);
    expect(artifactRows()).toHaveLength(run1.manifest.artifacts.length);
  });
});

describe("Data · Manifest fallback (FR-016)", () => {
  it("shows `fallback · ipfs.filebase.io` when the CID copy is down", async () => {
    install([run1], true);
    await renderManifest();
    await screen.findByRole("table");
    expect(screen.getAllByText(`fallback · ${FILEBASE_HOST}`).length).toBeGreaterThan(0);
    expect(artifactRows()).toHaveLength(run1.manifest.artifacts.length);
  });

  it("says where the bytes are stored: Filebase pin, Pinata copy within the free quota, GitHub Release CARs (AM-10)", async () => {
    install([run1]);
    await renderManifest();
    await screen.findByRole("table");
    const stored = document.querySelector<HTMLElement>("[data-stored-on]");
    expect(stored).not.toBeNull();
    expect(
      within(stored as HTMLElement)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([...VERIFY_TEXTS.storedOn]);
    expect(stored?.textContent).toContain(VERIFY_TEXTS.storedOnProvenance);
    // The Pinata line never claims every artifact.
    expect(VERIFY_TEXTS.storedOn[1]).toContain("that fit the free quota");
    // Stored on follows the manifest provenance line.
    const manifestLine = [...document.querySelectorAll("section > div")].find((el) =>
      el.textContent?.startsWith("Manifest "),
    );
    expect(manifestLine).toBeDefined();
    expect(
      (manifestLine as Element).compareDocumentPosition(stored as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
