// A-13 T022 (AC-3, AC-7, FR-003, FR-003a–c, FR-016; TC-006, TC-018, TC-020, TC-021, TC-022,
// TC-023): Data · Verify (`/data/verify/:cid`) and its VerifyLane. Two independent lanes,
// Pinata and orbitor, then the labelled Filebase fallback lane (ARD § 16 AM-10), each with its
// exact URL; "Verified on Pinata and orbitor" only when both counted lanes match (a
// Filebase-only match never counts); ✓ only when the bytes' size and SHA-256 (and raw CID) equal
// the manifest; a mismatch shows both values; a readable 429 reads "rate-limited, retrying", an
// unreadable answer "no readable response (rate-limited or blocked), retrying"; a directory reads
// "Verify via CAR" and fetches nothing; no request ever goes to the CID copy for the artifact.
// Fixtures are built in the test (real digests of test bytes); fetches are vi.fn, no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { VERIFY_TEXTS } from "@countylens/shared";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyLane } from "../src/components/VerifyLane";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const PINATA_HOST = "gateway.pinata.test";
const ORBITOR_HOST = "ipfs.orbitor.test";
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let fileBytes: Uint8Array<ArrayBuffer>;
let fileCid: string;
let dirCid: string;
let manifestBytes: Uint8Array<ArrayBuffer>;
let manifestCid: string;
let manifest: RunManifestV1;

beforeAll(async () => {
  fileBytes = encode("published parquet bytes (test)");
  fileCid = await rawCid(fileBytes);
  dirCid = await rawCid(encode("dir"));
  manifest = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "travis-test-verify",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T08:00:00.000Z",
    finishedAt: "2026-10-21T08:10:00.000Z",
    previousManifestCid: null,
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
        name: "tables/county",
        cid: dirCid,
        codec: "dag-json",
        size: 3,
        sha256: "b".repeat(64),
        kind: "directory",
        carCid: dirCid,
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: fileCid,
        codec: "raw",
        size: fileBytes.length,
        sha256: await sha256(fileBytes),
        kind: "table",
      },
    ],
    profiles: [],
    coverage: {},
    limitations: [],
  };
  manifestBytes = encode(JSON.stringify(manifest));
  manifestCid = await rawCid(manifestBytes);
});

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

type Gateway = (url: URL) => Response | Promise<Response>;

function install(
  opts: { pinata?: Gateway; orbitor?: Gateway; filebase?: Gateway; copyDown?: boolean } = {},
) {
  const serve: Gateway = (url) =>
    url.pathname.endsWith(manifestCid)
      ? new Response(manifestBytes)
      : url.pathname.endsWith(fileCid)
        ? new Response(fileBytes)
        : new Response(null, { status: 404 });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === "/runs/index.json") {
      return new Response(
        JSON.stringify({
          schema: RUNS_INDEX_SCHEMA,
          runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
        }),
      );
    }
    const parsed = new URL(url);
    if (parsed.host === COPY_HOST) {
      return opts.copyDown === true ? new Response(null, { status: 503 }) : serve(parsed);
    }
    if (parsed.host === PINATA_HOST) return (opts.pinata ?? serve)(parsed);
    if (parsed.host === ORBITOR_HOST) return (opts.orbitor ?? serve)(parsed);
    if (parsed.host === FILEBASE_HOST) {
      return parsed.pathname.endsWith(manifestCid)
        ? serve(parsed)
        : (opts.filebase ?? serve)(parsed);
    }
    throw new TypeError(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderVerify(cid: string): Promise<void> {
  const { Component } = await import("../src/routes/DataVerify");
  render(
    <MemoryRouter initialEntries={[`/data/verify/${cid}`]}>
      <Routes>
        <Route path="/data/verify/:cid" element={<Component />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lane = (gateway: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-lane="${gateway}"]`);
  expect(el, `lane ${gateway}`).not.toBeNull();
  return el as HTMLElement;
};

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", FILEBASE_HOST);
  vi.stubEnv("VITE_PINATA_GATEWAY_HOST", PINATA_HOST);
  vi.stubEnv("VITE_ORBITOR_GATEWAY_HOST", ORBITOR_HOST);
});

const result = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>("[data-verify-result]");
  expect(el, "page result").not.toBeNull();
  return el as HTMLElement;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Data · Verify page (AC-3, FR-003, TC-006, TC-022)", () => {
  it("shows ✓ lanes with the exact Pinata, orbitor and Filebase URLs and the compared values", async () => {
    const fetchMock = install();
    await renderVerify(fileCid);

    for (const g of ["pinata", "orbitor", "filebase"]) {
      await waitFor(() => expect(lane(g).getAttribute("data-state")).toBe("verified"));
    }
    expect(lane("pinata").textContent).toContain(`https://${PINATA_HOST}/ipfs/${fileCid}`);
    expect(lane("orbitor").textContent).toContain(`https://${ORBITOR_HOST}/ipfs/${fileCid}`);
    expect(lane("filebase").textContent).toContain(`https://${FILEBASE_HOST}/ipfs/${fileCid}`);
    // Independent lanes first, the Filebase fallback lane last (AM-10).
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-lane]")].map((el) => el.dataset.lane),
    ).toEqual(["pinata", "orbitor", "filebase"]);
    expect(result().getAttribute("data-verify-result")).toBe("verified");
    expect(result().textContent).toContain(VERIFY_TEXTS.independentVerified);
    for (const g of ["pinata", "orbitor"] as const) {
      expect(lane(g).getAttribute("data-independent")).toBe("true");
      expect(lane(g).textContent).toContain(VERIFY_TEXTS.laneRoles[g]);
      expect(lane(g).textContent).toContain(VERIFY_TEXTS.verified);
      expect(lane(g).textContent).toContain("✓");
      expect(lane(g).querySelector('[aria-label="verified"]')).not.toBeNull();
    }
    expect(lane("pinata").textContent).toContain("Public gateway · also holds our second copy");
    expect(lane("orbitor").textContent).toContain("Public gateway · holds no copy of ours");
    // The non-counted Filebase lane: neutral info glyph, never the green ✓ (AM-10).
    expect(lane("filebase").getAttribute("data-independent")).toBe("false");
    expect(lane("filebase").textContent).toContain("Our main storage host · fallback, not counted");
    expect(lane("filebase").textContent).toContain(VERIFY_TEXTS.fallbackVerified);
    expect(lane("filebase").textContent).not.toContain(VERIFY_TEXTS.verified);
    expect(lane("filebase").textContent).not.toContain("✓");
    expect(lane("filebase").querySelector('[aria-label="verified"]')).toBeNull();
    expect(lane("filebase").querySelector('h4 [data-icon="info"]')).not.toBeNull();
    expect(result().textContent).toBe(
      "Verified on Pinata and orbitor · two public gateways CountyLens does not operate; bytes match the manifest",
    );
    for (const g of ["pinata", "orbitor", "filebase"]) {
      expect(lane(g).textContent).toContain(manifest.artifacts[1]?.sha256 ?? "x");
      expect(lane(g).textContent).toContain(String(fileBytes.length));
    }
    const fileRequests = fetchMock.mock.calls
      .map(([input]) => new URL(urlOf(input), "https://app.test"))
      .filter((u) => u.pathname.endsWith(fileCid));
    expect(new Set(fileRequests.map((u) => u.host))).toEqual(
      new Set([PINATA_HOST, ORBITOR_HOST, FILEBASE_HOST]),
    );
    for (const [, init] of fetchMock.mock.calls.filter(([i]) => urlOf(i).endsWith(fileCid))) {
      expect(init?.credentials).toBe("omit");
      expect(init?.headers).toBeUndefined();
    }
  });

  it("shows a mismatch with both values and no ✓ when a gateway serves other bytes (TC-021)", async () => {
    install({ filebase: () => new Response(encode("tampered")) });
    await renderVerify(fileCid);

    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("mismatch"));
    expect(lane("filebase").textContent).toMatch(
      /^.*Mismatch · size \d+ vs \d+ · SHA-256 .+….+ vs .+….+/,
    );
    expect(lane("filebase").textContent).not.toContain("✓");
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    // A Filebase mismatch does not change the independent result (AM-10).
    await waitFor(() => expect(result().getAttribute("data-verify-result")).toBe("verified"));
  });

  it("a Filebase-only match is never shown as verified on two public gateways (AM-10)", async () => {
    install({
      pinata: () => new Response(encode("tampered")),
      orbitor: () => new Response(null, { status: 404 }),
    });
    await renderVerify(fileCid);

    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("mismatch"));
    await waitFor(() => expect(lane("orbitor").getAttribute("data-state")).toBe("failed"));
    await waitFor(() => expect(result().getAttribute("data-verify-result")).toBe("not_verified"));
    expect(result().textContent).toBe(
      "Not verified on two public gateways · bytes differ on Pinata; no verified answer from orbitor",
    );
    // Bytes differ on a counted lane: the page result is the error pill.
    expect(result().querySelector("[data-status]")?.getAttribute("data-status")).toBe("error");
    expect(document.body.textContent).not.toContain(VERIFY_TEXTS.independentVerified);
    expect(lane("filebase").textContent).toContain(VERIFY_TEXTS.fallbackVerified);
    expect(lane("filebase").textContent).not.toContain(VERIFY_TEXTS.verified);
    expect(lane("filebase").querySelector('[aria-label="verified"]')).toBeNull();
  });

  it("a counted lane with no readable answer (no mismatch) gives a warning page result, not an error", async () => {
    install({ orbitor: () => new Response(null, { status: 404 }) });
    await renderVerify(fileCid);

    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("orbitor").getAttribute("data-state")).toBe("failed"));
    await waitFor(() => expect(result().getAttribute("data-verify-result")).toBe("not_verified"));
    expect(result().textContent).toBe(
      "Not verified on two public gateways · no verified answer from orbitor",
    );
    expect(result().querySelector("[data-status]")?.getAttribute("data-status")).toBe("warning");
    expect(result().textContent).not.toMatch(/bytes differ/);
  });

  it("orders the headings: Counted gateways (Pinata, orbitor as h4), then the fallback group (Filebase h4)", async () => {
    install();
    await renderVerify(fileCid);
    await waitFor(() => expect(lane("orbitor").getAttribute("data-state")).toBe("verified"));
    const headings = [...document.querySelectorAll("h2, h3, h4")].map(
      (h) => `${h.tagName.toLowerCase()}:${h.textContent ?? ""}`,
    );
    const at = (text: string): number => headings.indexOf(text);
    expect(at(`h3:${VERIFY_TEXTS.countedLanesTitle}`)).toBeGreaterThan(-1);
    expect(at(`h3:${VERIFY_TEXTS.countedLanesTitle}`)).toBeLessThan(at("h4:✓Pinata"));
    expect(at("h4:✓Pinata")).toBeLessThan(at("h4:✓orbitor"));
    expect(at("h4:✓orbitor")).toBeLessThan(at(`h3:${VERIFY_TEXTS.fallbackLanesTitle}`));
    expect(at(`h3:${VERIFY_TEXTS.fallbackLanesTitle}`)).toBeLessThan(at("h4:Filebase"));
    expect(at("h4:Filebase")).toBeLessThan(at(`h3:${VERIFY_TEXTS.storedOnTitle}`));
  });

  it("a counted lane that gives up after its retries says so, without implying tampering", async () => {
    // The lane alone with an instant sleep (the page uses the real 2/4/8 s backoff).
    render(
      <VerifyLane
        gateway="pinata"
        url={`https://${PINATA_HOST}/ipfs/${fileCid}`}
        target={{
          cid: fileCid,
          size: fileBytes.length,
          sha256: manifest.artifacts[1]?.sha256 ?? "",
          kind: "table",
          codec: "raw",
        }}
        fetch={async () => new Response(null, { status: 429 })}
        sleep={async () => undefined}
      />,
    );
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("failed"));
    const reason = lane("pinata").querySelector("[data-lane-reason]");
    expect(reason?.textContent).toBe(
      "no readable answer after retries · Pinata may be rate-limiting; try again",
    );
    expect(lane("pinata").textContent).not.toMatch(/mismatch|tamper/i);
  });

  it("stays pending until both independent lanes end; one match is not enough", async () => {
    let releaseOrbitor: (r: Response) => void = () => undefined;
    const orbitorAnswer = new Promise<Response>((resolve) => {
      releaseOrbitor = resolve;
    });
    install({ orbitor: () => orbitorAnswer });
    await renderVerify(fileCid);

    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("verified"));
    expect(result().getAttribute("data-verify-result")).toBe("pending");
    expect(result().textContent).toBe(VERIFY_TEXTS.independentPending);
    await act(async () => releaseOrbitor(new Response(fileBytes)));
    await waitFor(() => expect(result().getAttribute("data-verify-result")).toBe("verified"));
  });

  it("shows the Stored on line: Filebase pin, Pinata copy within the free quota, GitHub Release CARs", async () => {
    install();
    await renderVerify(fileCid);
    const stored = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-stored-on]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    for (const line of VERIFY_TEXTS.storedOn) expect(stored.textContent).toContain(line);
    expect(stored.textContent).toContain(VERIFY_TEXTS.storedOnProvenance);
    expect(stored.textContent).toContain(
      "Pinata: second copy of every run manifest and of the latest run's table files that fit the free quota",
    );
    expect(stored.querySelector("ul")?.hasAttribute("aria-label")).toBe(false);
  });

  it("reads `Verify via CAR` for a directory and fetches nothing for it (FR-003c, TC-018)", async () => {
    const fetchMock = install();
    await renderVerify(dirCid);
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("via_car"));
    expect(lane("orbitor").textContent).toContain(VERIFY_TEXTS.viaCar);
    expect(lane("filebase").textContent).toContain(VERIFY_TEXTS.viaCar);
    expect(result().getAttribute("data-verify-result")).toBe("via_car");
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith(dirCid))).toBe(false);
  });

  it("shows the fallback chip when Filebase served the manifest, and still verifies on both gateways (FR-016, TC-023)", async () => {
    install({ copyDown: true });
    await renderVerify(fileCid);
    expect((await screen.findAllByText(`fallback · ${FILEBASE_HOST}`)).length).toBeGreaterThan(0);
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("orbitor").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("verified"));
  });

  it("verifies a run manifest itself by its CID", async () => {
    install();
    await renderVerify(manifestCid);
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
  });

  it("says the CID is not in this run's manifest when it is unknown", async () => {
    install();
    const unknown = await rawCid(encode("unknown"));
    await renderVerify(unknown);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(document.querySelector("[data-lane]")).toBeNull();
  });
});

describe("VerifyLane retries (AC-7, FR-003b, TC-020)", () => {
  const target = (): {
    cid: string;
    size: number;
    sha256: string;
    kind: "table";
    codec: string;
  } => ({
    cid: fileCid,
    size: fileBytes.length,
    sha256: manifest.artifacts[1]?.sha256 ?? "",
    kind: "table",
    codec: "raw",
  });

  it("shows `rate-limited, retrying` on a readable 429, never ✓, then ✓ after a matching answer", async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return calls < 3 ? new Response(null, { status: 429 }) : new Response(fileBytes);
    });
    let release: () => void = () => undefined;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <VerifyLane
        gateway="pinata"
        url={`https://${PINATA_HOST}/ipfs/${fileCid}`}
        target={target()}
        fetch={fetchImpl}
        sleep={sleep}
      />,
    );
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("retrying"));
    expect(within(lane("pinata")).getByText(VERIFY_TEXTS.rateLimited)).toBeDefined();
    expect(lane("pinata").textContent).not.toContain("✓");
    await act(async () => release());
    await waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 4000]);
    await act(async () => release());
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    expect(lane("pinata").textContent).toContain("✓");
  });

  it("shows `no readable response (rate-limited or blocked), retrying` on a network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(
      <VerifyLane
        gateway="filebase"
        url={`https://${FILEBASE_HOST}/ipfs/${fileCid}`}
        target={target()}
        fetch={fetchImpl}
        sleep={() => new Promise<void>(() => undefined)}
      />,
    );
    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("retrying"));
    expect(within(lane("filebase")).getByText(VERIFY_TEXTS.noReadableResponse)).toBeDefined();
    expect(lane("filebase").textContent).not.toContain("✓");
  });
});
