// A-03 T033 (G-C3): the read path of one published artifact (spec FR-005, PO decision D-2;
// data-model.md § FetchByCid state; TC-032…034). The CID copy is tried first; the Filebase
// gateway is the labelled fallback when the copy errors, returns a non-200 or delivers no first
// byte within 4 s. The host that served the manifest is the host `partUrl` binds for the table
// parts. Both hosts down → exactly the fixed text. Bytes that do not hash to the CID are
// rejected. Every fetch is a vi.fn: no network.
import { readPathUrls } from "@countylens/shared";
import { rawCid } from "@countylens/query-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BOTH_HOSTS_DOWN_TEXT,
  BothHostsDownError,
  CidMismatchError,
  FIRST_BYTE_TIMEOUT_MS,
  fallbackLabel,
  fetchByCid,
  type FetchByCidOptions,
} from "../src/data/fetch-by-cid";

const COPY_HOST = "copy.example.test";
const GATEWAY_HOST = "ipfs.filebase.io";
const urls = readPathUrls({ cidCopyHost: COPY_HOST, filebaseGatewayHost: GATEWAY_HOST });

const BYTES = new TextEncoder().encode('{"schema":"test","hello":"world"}');
const OTHER_BYTES = new TextEncoder().encode('{"schema":"test","hello":"tampered"}');
let CID = "";
let PART_CID = "";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

/** One handler per host; a handler may throw (network error) or return any Response. */
function fakeFetch(handlers: {
  copy: () => Promise<Response> | Response;
  gateway?: () => Promise<Response> | Response;
}): FetchMock {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.host === COPY_HOST) return handlers.copy();
    if (url.host === GATEWAY_HOST && handlers.gateway !== undefined) return handlers.gateway();
    throw new TypeError(`unexpected host ${url.host}`);
  });
}

function ok(bytes: Uint8Array<ArrayBuffer> = BYTES): Response {
  return new Response(bytes, { status: 200 });
}

function status(code: number): Response {
  return new Response(null, { status: code });
}

/** 200 with headers, but a body that never delivers a byte. */
function stalledBody(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 });
}

function requestedUrls(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map(([input]) =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
}

function options(fetchMock: FetchMock, extra: Partial<FetchByCidOptions> = {}): FetchByCidOptions {
  return { urls, fetch: fetchMock, ...extra };
}

beforeAll(async () => {
  CID = await rawCid(BYTES);
  PART_CID = await rawCid(new TextEncoder().encode("part-00000.parquet"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchByCid: the CID copy first (D-2)", () => {
  it("serves the bytes from the copy with no fallback label and binds parts to the copy", async () => {
    const fetchMock = fakeFetch({ copy: () => ok() });
    const result = await fetchByCid(CID, options(fetchMock));

    expect(result.cid).toBe(CID);
    expect(Array.from(result.bytes)).toEqual(Array.from(BYTES));
    expect(result.source).toEqual({ kind: "copy", host: COPY_HOST });
    expect(fallbackLabel(result.source)).toBeNull();
    expect(requestedUrls(fetchMock)).toEqual([`https://${COPY_HOST}/${CID}`]);
    expect(
      result.partUrl({ name: "tables/county/property/part-00000.parquet", cid: PART_CID }),
    ).toBe(`https://${COPY_HOST}/${PART_CID}`);
  });

  it("rejects bytes that do not hash to the requested CID (constitution A3)", async () => {
    const fetchMock = fakeFetch({ copy: () => ok(OTHER_BYTES), gateway: () => ok(OTHER_BYTES) });
    const failure = await fetchByCid(CID, options(fetchMock)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CidMismatchError);
    const mismatch = failure as CidMismatchError;
    expect(mismatch.name).toBe("CidMismatchError");
    expect(mismatch.expected).toBe(CID);
    expect(mismatch.actual).toBe(await rawCid(OTHER_BYTES));
  });
});

describe("fetchByCid: the Filebase gateway as the labelled fallback (TC-032…034)", () => {
  it("falls back when the copy request errors (aborted) and labels `fallback · {host}`", async () => {
    const fetchMock = fakeFetch({
      copy: () => {
        throw new TypeError("Failed to fetch");
      },
      gateway: () => ok(),
    });
    const result = await fetchByCid(CID, options(fetchMock));

    expect(result.source).toEqual({ kind: "fallback", host: GATEWAY_HOST });
    expect(fallbackLabel(result.source)).toBe(`fallback · ${GATEWAY_HOST}`);
    expect(requestedUrls(fetchMock)).toEqual([
      `https://${COPY_HOST}/${CID}`,
      `https://${GATEWAY_HOST}/ipfs/${CID}`,
    ]);
    expect(Array.from(result.bytes)).toEqual(Array.from(BYTES));
  });

  it("falls back when the copy returns a non-200 (500) and never shows the 500 as data", async () => {
    const fetchMock = fakeFetch({ copy: () => status(500), gateway: () => ok() });
    const result = await fetchByCid(CID, options(fetchMock));

    expect(result.source.kind).toBe("fallback");
    expect(fallbackLabel(result.source)).toBe(`fallback · ${GATEWAY_HOST}`);
    expect(Array.from(result.bytes)).toEqual(Array.from(BYTES));
  });

  it("binds the table parts to the host that served the manifest (no mixed reads)", async () => {
    const fetchMock = fakeFetch({ copy: () => status(503), gateway: () => ok() });
    const result = await fetchByCid(CID, options(fetchMock));

    expect(
      result.partUrl({ name: "tables/county/property/part-00000.parquet", cid: PART_CID }),
    ).toBe(`https://${GATEWAY_HOST}/ipfs/${PART_CID}`);
  });

  it("falls back when the copy delivers no first byte within the timeout (headers only)", async () => {
    const copyStartedAt: number[] = [];
    const gatewayStartedAt: number[] = [];
    const fetchMock = fakeFetch({
      copy: () => {
        copyStartedAt.push(performance.now());
        return stalledBody();
      },
      gateway: () => {
        gatewayStartedAt.push(performance.now());
        return ok();
      },
    });
    const result = await fetchByCid(CID, options(fetchMock, { firstByteTimeoutMs: 50 }));

    expect(result.source).toEqual({ kind: "fallback", host: GATEWAY_HOST });
    expect(copyStartedAt).toHaveLength(1);
    expect(gatewayStartedAt).toHaveLength(1);
    expect((gatewayStartedAt[0] ?? 0) - (copyStartedAt[0] ?? 0)).toBeGreaterThanOrEqual(45);
  });

  it("falls back when the copy sends nothing at all (no headers) within the timeout", async () => {
    const fetchMock = fakeFetch({
      copy: () => new Promise<Response>(() => undefined),
      gateway: () => ok(),
    });
    const result = await fetchByCid(CID, options(fetchMock, { firstByteTimeoutMs: 50 }));

    expect(result.source.kind).toBe("fallback");
  });

  it("defaults the first-byte timeout to 4 s: the gateway request starts at 4.0 s, not before", async () => {
    vi.useFakeTimers();
    const fetchMock = fakeFetch({ copy: () => stalledBody(), gateway: () => ok() });
    const pending = fetchByCid(CID, options(fetchMock));

    await vi.advanceTimersByTimeAsync(3_999);
    expect(requestedUrls(fetchMock)).toEqual([`https://${COPY_HOST}/${CID}`]);

    await vi.advanceTimersByTimeAsync(1);
    expect(requestedUrls(fetchMock)).toEqual([
      `https://${COPY_HOST}/${CID}`,
      `https://${GATEWAY_HOST}/ipfs/${CID}`,
    ]);

    vi.useRealTimers();
    const result = await pending;
    expect(FIRST_BYTE_TIMEOUT_MS).toBe(4_000);
    expect(result.source.kind).toBe("fallback");
  });
});

describe("fetchByCid: both hosts down (TC-032 step 5)", () => {
  it("rejects with exactly the fixed both-hosts-down text when the copy and the gateway error", async () => {
    const fetchMock = fakeFetch({
      copy: () => {
        throw new TypeError("Failed to fetch");
      },
      gateway: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const failure = await fetchByCid(CID, options(fetchMock)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BothHostsDownError);
    expect((failure as BothHostsDownError).name).toBe("BothHostsDownError");
    expect((failure as BothHostsDownError).cid).toBe(CID);
    expect((failure as Error).message).toBe(
      "Data could not be reached from the CID copy or the Filebase gateway",
    );
    expect(BOTH_HOSTS_DOWN_TEXT).toBe(
      "Data could not be reached from the CID copy or the Filebase gateway",
    );
  });

  it("treats a 429 from the gateway as a non-200: both hosts down, not a retry", async () => {
    const fetchMock = fakeFetch({ copy: () => status(500), gateway: () => status(429) });
    await expect(fetchByCid(CID, options(fetchMock))).rejects.toBeInstanceOf(BothHostsDownError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rethrows the caller's own abort instead of blaming the hosts", async () => {
    const controller = new AbortController();
    const reason = new DOMException("navigated away", "AbortError");
    controller.abort(reason);
    const fetchMock = fakeFetch({
      copy: () => {
        throw reason;
      },
      gateway: () => ok(),
    });
    const failure = await fetchByCid(CID, options(fetchMock, { signal: controller.signal })).catch(
      (error: unknown) => error,
    );

    expect(failure).toBe(reason);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("fallbackLabel (plan § Fixed texts)", () => {
  it("is the word fallback, ` · ` and the configured gateway host", () => {
    expect(fallbackLabel({ kind: "fallback", host: "ipfs.filebase.io" })).toBe(
      "fallback · ipfs.filebase.io",
    );
  });

  it("is null when the copy served the read", () => {
    expect(fallbackLabel({ kind: "copy", host: COPY_HOST })).toBeNull();
  });
});
