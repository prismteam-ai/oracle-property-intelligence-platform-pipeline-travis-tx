// A-11, AD-22: unit tests for the Pinata-own-API second-pin utility. Every HTTP call is a fake
// FetchLike; nothing here makes a real network call or reads a real JWT. Request/response shapes
// match the legacy `/pinning/*` and `/data/pinList` endpoints a real smoke test (2026-10-23)
// confirmed the saved PINATA_JWT can actually use (the newer v3 Files API 401s for that key).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PINATA_API,
  PINATA_PIN_BY_HASH_PATH,
  PINATA_PIN_LIST_PATH,
  PINATA_UNPIN_PATH,
  PINATA_UPLOAD_PATH,
  PINATA_USAGE_PATH,
  PinataHttpError,
  isPinned,
  pinByCid,
  pinataPin,
  pollUntilPinned,
  READ_TIMEOUT_MS,
  redactJwt,
  unpin,
  uploadTimeoutMs,
  uploadFile,
  usage,
  type FetchLike,
} from "../src/pinata-pin.js";

const JWT = "fake.jwt.value-should-never-appear-in-output";
const CID = "QmaGsUdioAd8YxCT1PP7AZcz8vFeTTMH6nTFAud1SqJhhV";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("pinByCid", () => {
  it("POSTs { hashToPin, pinataMetadata } with a bearer header and parses id/status", async () => {
    let seen:
      { url: string; method: string; headers: Record<string, string>; body: unknown } | undefined;
    const fetch: FetchLike = async (input, init) => {
      seen = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body)),
      };
      return jsonResponse(200, { id: "file-1", ipfsHash: CID, status: "searching" });
    };
    const result = await pinByCid(CID, "my-name", { jwt: JWT, fetch });
    expect(seen?.url).toBe(`${PINATA_API}${PINATA_PIN_BY_HASH_PATH}`);
    expect(seen?.method).toBe("POST");
    expect(seen?.headers.authorization).toBe(`Bearer ${JWT}`);
    expect(seen?.body).toEqual({ hashToPin: CID, pinataMetadata: { name: "my-name" } });
    expect(result).toEqual({ id: "file-1", status: "searching" });
  });

  it("omits pinataMetadata from the body when no name is given", async () => {
    let body: unknown;
    const fetch: FetchLike = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(200, { id: "file-2" });
    };
    await pinByCid(CID, undefined, { jwt: JWT, fetch });
    expect(body).toEqual({ hashToPin: CID });
  });

  it("throws on a non-OK response (e.g. a 403 NO_SCOPES_FOUND) and redacts the JWT", async () => {
    const fetch: FetchLike = async () =>
      new Response(
        JSON.stringify({ error: { reason: "NO_SCOPES_FOUND", details: `rejected for ${JWT}` } }),
        { status: 403, statusText: "Forbidden" },
      );
    await expect(pinByCid(CID, undefined, { jwt: JWT, fetch })).rejects.toThrow(
      /pinByHash of .* failed: 403 Forbidden/,
    );
    try {
      await pinByCid(CID, undefined, { jwt: JWT, fetch });
      expect.fail("expected a throw");
    } catch (err) {
      expect(String(err)).not.toContain(JWT);
      expect(String(err)).toContain("[redacted]");
      expect(String(err)).toContain("NO_SCOPES_FOUND");
    }
  });

  it("throws when the response body is not JSON, without leaking the JWT", async () => {
    const fetch: FetchLike = async () => new Response(`<html>${JWT}</html>`, { status: 200 });
    await expect(pinByCid(CID, undefined, { jwt: JWT, fetch })).rejects.toThrow(/non-JSON/);
  });
});

describe("uploadFile", () => {
  it("uploads the file as multipart/form-data with cidVersion 1 and parses IpfsHash into cid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "throwaway.txt");
    writeFileSync(filePath, "A-11 pinata-pin smoke test fixture, not real data");
    let seen:
      { url: string; headers: Record<string, string>; file: File; options: unknown } | undefined;
    const fetch: FetchLike = async (input, init) => {
      const form = init?.body;
      if (!(form instanceof FormData)) throw new Error("expected a FormData body");
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("expected a file field");
      seen = {
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        file,
        options: JSON.parse(String(form.get("pinataOptions"))),
      };
      return jsonResponse(200, {
        IpfsHash: CID,
        PinSize: 50,
        Timestamp: "2026-10-23T18:31:52.672Z",
        ID: "file-3",
        Name: "throwaway.txt",
      });
    };
    const result = await uploadFile(filePath, undefined, { jwt: JWT, fetch });
    expect(seen?.url).toBe(`${PINATA_API}${PINATA_UPLOAD_PATH}`);
    expect(seen?.headers.authorization).toBe(`Bearer ${JWT}`);
    expect(seen?.file.name).toBe("throwaway.txt");
    // AM-10 / T079: without cidVersion 1 Pinata answers a CIDv0 Qm… that never equals ours.
    expect(seen?.options).toEqual({ cidVersion: 1 });
    expect(result).toEqual({
      id: "file-3",
      cid: CID,
      pinSize: 50,
      timestamp: "2026-10-23T18:31:52.672Z",
    });
  });

  it("includes pinataMetadata as a JSON string field when a name is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "throwaway.txt");
    writeFileSync(filePath, "x");
    let metadata: string | undefined;
    const fetch: FetchLike = async (_input, init) => {
      const form = init?.body as FormData;
      metadata = form.get("pinataMetadata") as string;
      return jsonResponse(200, { IpfsHash: CID, ID: "file-5" });
    };
    await uploadFile(filePath, "a-11-smoke-throwaway", { jwt: JWT, fetch });
    expect(JSON.parse(metadata ?? "")).toEqual({ name: "a-11-smoke-throwaway" });
  });

  it("never sends a '/' in pinataMetadata.name (a slash makes Pinata answer a folder CID)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "manifest.json");
    writeFileSync(filePath, "{}");
    let metadata: string | undefined;
    const fetch: FetchLike = async (_input, init) => {
      metadata = (init?.body as FormData).get("pinataMetadata") as string;
      return jsonResponse(200, { IpfsHash: CID, ID: "file-6" });
    };
    await uploadFile(filePath, "runs/travis-full-run3-1-20261025/manifest.json", {
      jwt: JWT,
      fetch,
    });
    const sent = JSON.parse(metadata ?? "") as { name: string };
    expect(sent.name).not.toContain("/");
    expect(sent.name).toBe("runs > travis-full-run3-1-20261025 > manifest.json");
  });

  it("throws when the upload response carries no IpfsHash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "throwaway.txt");
    writeFileSync(filePath, "x");
    const fetch: FetchLike = async () => jsonResponse(200, { ID: "file-4" });
    await expect(uploadFile(filePath, undefined, { jwt: JWT, fetch })).rejects.toThrow(
      /returned no IpfsHash/,
    );
  });
});

describe("isPinned", () => {
  it("is true when pinList?status=pinned returns a non-empty rows array for the cid", async () => {
    let url: string | undefined;
    const fetch: FetchLike = async (input) => {
      url = String(input);
      return jsonResponse(200, { count: 1, rows: [{ id: "file-1", ipfs_pin_hash: CID }] });
    };
    expect(await isPinned(CID, { jwt: JWT, fetch })).toBe(true);
    expect(url).toBe(
      `${PINATA_API}${PINATA_PIN_LIST_PATH}?hashContains=${encodeURIComponent(CID)}&status=pinned`,
    );
  });

  it("is false when rows is empty", async () => {
    const fetch: FetchLike = async () => jsonResponse(200, { count: 0, rows: [] });
    expect(await isPinned(CID, { jwt: JWT, fetch })).toBe(false);
  });

  it("is false when the response has no rows field", async () => {
    const fetch: FetchLike = async () => jsonResponse(200, { count: 0 });
    expect(await isPinned(CID, { jwt: JWT, fetch })).toBe(false);
  });
});

describe("pollUntilPinned", () => {
  it("polls on a fake clock until isPinned turns true, without a real sleep", async () => {
    let call = 0;
    const fetch: FetchLike = async () => {
      call += 1;
      return jsonResponse(200, { rows: call >= 3 ? [{ id: "f", ipfs_pin_hash: CID }] : [] });
    };
    let clock = 0;
    const sleeps: number[] = [];
    const result = await pollUntilPinned(CID, {
      jwt: JWT,
      fetch,
      pollIntervalMs: 1000,
      pollTimeoutMs: 10_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    expect(call).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
    expect(result).toBe(clock);
  });

  it("throws once the timeout elapses without ever seeing the cid pinned", async () => {
    const fetch: FetchLike = async () => jsonResponse(200, { rows: [] });
    let clock = 0;
    await expect(
      pollUntilPinned(CID, {
        jwt: JWT,
        fetch,
        pollIntervalMs: 1000,
        pollTimeoutMs: 2500,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/did not confirm as pinned within 2500ms/);
  });
});

describe("pinataPin", () => {
  it("rejects a missing jwt before any fetch", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("must not be called");
    };
    await expect(pinataPin({ cid: CID }, { jwt: "", fetch })).rejects.toThrow(
      /PINATA_JWT is required/,
    );
  });

  it("rejects when neither cid nor filePath is given", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("must not be called");
    };
    await expect(pinataPin({}, { jwt: JWT, fetch })).rejects.toThrow(
      /requires a cid or a filePath/,
    );
  });

  it("pins by cid and polls pinList to confirm, reporting method pin_by_cid", async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes(PINATA_PIN_BY_HASH_PATH)) {
        return jsonResponse(200, { id: "file-1", status: "searching" });
      }
      return jsonResponse(200, { rows: [{ id: "file-1", ipfs_pin_hash: CID }] });
    };
    const result = await pinataPin(
      { cid: CID, name: "run1-car" },
      { jwt: JWT, fetch, pollIntervalMs: 0, now: () => 0, sleep: async () => {} },
    );
    expect(result).toEqual({
      cid: CID,
      id: "file-1",
      method: "pin_by_cid",
      pinned: true,
      polledMs: 0,
    });
    expect(calls[0]).toContain(PINATA_PIN_BY_HASH_PATH);
  });

  it("falls back to uploadFile when pin_by_cid fails (e.g. 403 NO_SCOPES_FOUND) and a filePath is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "throwaway.txt");
    writeFileSync(filePath, "fallback fixture");
    const fetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes(PINATA_PIN_BY_HASH_PATH)) {
        return jsonResponse(403, { error: { reason: "NO_SCOPES_FOUND" } });
      }
      if (url.includes(PINATA_UPLOAD_PATH))
        return jsonResponse(200, { ID: "file-9", IpfsHash: CID });
      return jsonResponse(200, { rows: [{ id: "file-9", ipfs_pin_hash: CID }] });
    };
    const result = await pinataPin(
      { cid: "QmDOESNOTEXISTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", filePath },
      { jwt: JWT, fetch, now: () => 0, sleep: async () => {} },
    );
    expect(result.method).toBe("upload");
    expect(result.cid).toBe(CID);
    expect(result.pinned).toBe(true);
  });

  it("rethrows the pin_by_cid error when it fails and no filePath fallback is given", async () => {
    const fetch: FetchLike = async (input) => {
      if (String(input).includes(PINATA_PIN_BY_HASH_PATH))
        return jsonResponse(403, { error: "nope" });
      throw new Error("must not poll after a failed pin with no fallback");
    };
    await expect(pinataPin({ cid: CID }, { jwt: JWT, fetch })).rejects.toThrow(/failed: 403/);
  });

  it("uploads directly when only a filePath is given (no cid)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "throwaway.txt");
    writeFileSync(filePath, "no cid fixture");
    const fetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes(PINATA_UPLOAD_PATH))
        return jsonResponse(200, { ID: "file-7", IpfsHash: CID });
      return jsonResponse(200, { rows: [{ id: "file-7", ipfs_pin_hash: CID }] });
    };
    const result = await pinataPin(
      { filePath },
      { jwt: JWT, fetch, now: () => 0, sleep: async () => {} },
    );
    expect(result.method).toBe("upload");
    expect(result.cid).toBe(CID);
  });
});

describe("unpin", () => {
  it("sends DELETE /pinning/unpin/<cid> with the bearer header", async () => {
    let seen: { url: string; method: string; auth: string | null } | undefined;
    const fetch: FetchLike = async (input, init) => {
      seen = {
        url: String(input),
        method: init?.method ?? "GET",
        auth: new Headers(init?.headers).get("authorization"),
      };
      return new Response("OK", { status: 200 });
    };
    await unpin(CID, { jwt: JWT, fetch });
    expect(seen).toEqual({
      url: `${PINATA_API}${PINATA_UNPIN_PATH}/${CID}`,
      method: "DELETE",
      auth: `Bearer ${JWT}`,
    });
  });

  it("throws a PinataHttpError carrying the status, with the JWT redacted", async () => {
    const fetch: FetchLike = async () =>
      new Response(`no such pin for ${JWT}`, {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "3" },
      });
    const err = await unpin(CID, { jwt: JWT, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PinataHttpError);
    expect((err as PinataHttpError).status).toBe(429);
    expect((err as PinataHttpError).retryAfter).toBe("3");
    expect(String(err)).not.toContain(JWT);
  });
});

describe("usage", () => {
  it("reads pin_count and pin_size_total from /data/userPinnedDataTotal", async () => {
    let url: string | undefined;
    const fetch: FetchLike = async (input) => {
      url = String(input);
      return jsonResponse(200, {
        pin_count: 12,
        pin_size_total: "123456",
        pin_size_with_replications_total: 246912,
      });
    };
    expect(await usage({ jwt: JWT, fetch })).toEqual({ pinCount: 12, pinSizeTotal: 123456 });
    expect(url).toBe(`${PINATA_API}${PINATA_USAGE_PATH}`);
  });

  it("throws when the fields are missing", async () => {
    const fetch: FetchLike = async () => jsonResponse(200, { nope: true });
    await expect(usage({ jwt: JWT, fetch })).rejects.toThrow(/no pin_count/);
  });
});

describe("redactJwt", () => {
  it("replaces every occurrence and leaves text alone for an empty JWT", () => {
    expect(redactJwt(`a ${JWT} b ${JWT}`, JWT)).toBe("a [redacted] b [redacted]");
    expect(redactJwt("plain", "")).toBe("plain");
  });
});

describe("multipart filename and timeouts (T079 review)", () => {
  it("sends only the basename as the multipart filename; the full path (slash-free) goes in pinataMetadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinata-pin-"));
    const filePath = join(dir, "part-00000.parquet");
    writeFileSync(filePath, "x");
    let fileName: string | undefined;
    let metadata: unknown;
    let signal: AbortSignal | null | undefined;
    const fetch: FetchLike = async (_input, init) => {
      const form = init?.body as FormData;
      fileName = (form.get("file") as File).name;
      metadata = JSON.parse(String(form.get("pinataMetadata")));
      signal = init?.signal;
      return jsonResponse(200, { IpfsHash: CID });
    };
    const name = "pipeline/data/runs/r/tables/t/part-00000.parquet";
    await uploadFile(filePath, name, { jwt: JWT, fetch });
    expect(fileName).toBe("part-00000.parquet");
    expect(fileName).not.toContain("/");
    expect(metadata).toEqual({
      name: "pipeline > data > runs > r > tables > t > part-00000.parquet",
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("scales the upload timeout with size and bounds reads and unpin", async () => {
    expect(uploadTimeoutMs(0)).toBe(60_000);
    expect(uploadTimeoutMs(250_000_000)).toBe(60_000 + 1_000_000);
    expect(READ_TIMEOUT_MS).toBe(30_000);
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetch: FetchLike = async (_input, init) => {
      signals.push(init?.signal);
      return jsonResponse(200, { rows: [], pin_count: 0, pin_size_total: 0 });
    };
    await isPinned(CID, { jwt: JWT, fetch });
    await usage({ jwt: JWT, fetch });
    await unpin(CID, { jwt: JWT, fetch });
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});
