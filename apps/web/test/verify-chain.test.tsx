// A-13 review finding 11: Data · Verify walks the run chain one manifest at a time and stops at
// the first hit, so an unreadable older manifest never fails a CID found in a newer one.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const PINATA_HOST = "gateway.pinata.test";
const ORBITOR_HOST = "ipfs.orbitor.test";
const encode = (t: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(t);

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Built {
  manifest: RunManifestV1;
  bytes: Uint8Array<ArrayBuffer>;
  cid: string;
}

async function build(
  n: number,
  previous: string | null,
  artifacts: RunManifestV1["artifacts"] = [],
): Promise<Built> {
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: `travis-chain-${n}`,
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
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts,
    profiles: [],
    coverage: {},
    limitations: [],
  };
  const bytes = encode(JSON.stringify(manifest));
  return { manifest, bytes, cid: await rawCid(bytes) };
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

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

describe("Data · Verify run chain (finding 11)", () => {
  it("finds a CID in a newer manifest although an older ancestor is unreadable, and stops there", async () => {
    const file = encode("chain artifact (test)");
    const fileCid = await rawCid(file);
    const m1 = await build(1, null);
    const m2 = await build(2, m1.cid, [
      {
        name: "tables/county/property/part-00000.parquet",
        cid: fileCid,
        codec: "raw",
        size: file.length,
        sha256: await sha256(file),
        kind: "table",
      },
    ]);
    const m3 = await build(3, m2.cid);
    const byCid = new Map([
      [m2.cid, m2.bytes],
      [m3.cid, m3.bytes],
      [fileCid, file],
    ]);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = urlOf(input);
      if (url === "/runs/index.json") {
        return new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: [
              { runId: m1.manifest.runId, manifestCid: m1.cid, finishedAt: m1.manifest.finishedAt },
              { runId: m2.manifest.runId, manifestCid: m2.cid, finishedAt: m2.manifest.finishedAt },
              { runId: m3.manifest.runId, manifestCid: m3.cid, finishedAt: m3.manifest.finishedAt },
            ],
          }),
        );
      }
      const cid = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      const bytes = byCid.get(cid);
      return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { Component } = await import("../src/routes/DataVerify");
    render(
      <MemoryRouter initialEntries={[`/data/verify/${fileCid}`]}>
        <Routes>
          <Route path="/data/verify/:cid" element={<Component />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-lane="pinata"]')?.getAttribute("data-state")).toBe(
        "verified",
      ),
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(fetchMock.mock.calls.some(([i]) => urlOf(i).endsWith(m1.cid))).toBe(false);
  });
});
