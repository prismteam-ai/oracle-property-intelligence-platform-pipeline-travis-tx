import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WindowKind } from "../../src/domain/ingest-window.js";
import { SourceId } from "../../src/domain/source-id.js";
import { SocrataPermitSource } from "../../src/infrastructure/socrata-permit-source.js";
import { SourceRequestError } from "../../src/infrastructure/source-request-error.js";

const FETCHED_AT = new Date("2026-10-27T06:30:00.000Z");
const USER_AGENT = "travis-oracle-pipeline/test";

type Call = { url: URL; headers: Headers };

function fakeFetch(body: string, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return new Response(body, { status });
  };
  return { calls, fetchImpl };
}

function sourceWith(fetchImpl: typeof fetch, pageSize = 2) {
  return new SocrataPermitSource({
    baseUrl: "https://data.austintexas.gov",
    datasetId: "3syk-w9eu",
    pageSize,
    userAgent: USER_AGENT,
    fetch: fetchImpl,
    now: () => FETCHED_AT,
  });
}

const twoPermits = JSON.stringify([
  { permit_number: "2026-000001 BP", statusdate: "2026-10-25T00:00:00.000" },
  { permit_number: "2026-000002 EP", statusdate: "2026-10-26T00:00:00.000" },
]);

describe("SocrataPermitSource", () => {
  it("identifies itself as the Austin permits source", () => {
    expect(sourceWith(fakeFetch("[]").fetchImpl).id).toBe(SourceId.AustinPermits);
  });

  it("pages a full load by permit number with an honest user agent", async () => {
    const { calls, fetchImpl } = fakeFetch(twoPermits);

    await sourceWith(fetchImpl).fetchPage({ kind: WindowKind.Full }, undefined);

    expect(calls[0]?.url.pathname).toBe("/resource/3syk-w9eu.json");
    expect(calls[0]?.url.searchParams.get("$query")).toBe(
      "SELECT * ORDER BY permit_number LIMIT 2",
    );
    expect(calls[0]?.headers.get("user-agent")).toBe(USER_AGENT);
  });

  it("filters a windowed load on every business date and continues after the last key", async () => {
    const { calls, fetchImpl } = fakeFetch(twoPermits);

    await sourceWith(fetchImpl).fetchPage(
      { kind: WindowKind.Since, since: "2026-10-19" },
      "2026-000002 EP",
    );

    expect(calls[0]?.url.searchParams.get("$query")).toBe(
      "SELECT * WHERE (statusdate >= '2026-10-19' OR issue_date >= '2026-10-19' OR applieddate >= '2026-10-19')" +
        " AND permit_number > '2026-000002 EP' ORDER BY permit_number LIMIT 2",
    );
  });

  it("escapes quotes in the continuation key", async () => {
    const { calls, fetchImpl } = fakeFetch("[]");

    await sourceWith(fetchImpl).fetchPage({ kind: WindowKind.Full }, "O'Brien");

    expect(calls[0]?.url.searchParams.get("$query")).toContain("permit_number > 'O''Brien'");
  });

  it("returns the exact body with a receipt, the last key and the latest status date", async () => {
    const { fetchImpl } = fakeFetch(twoPermits);

    const fetched = await sourceWith(fetchImpl).fetchPage({ kind: WindowKind.Full }, undefined);

    expect(fetched.body).toBe(twoPermits);
    expect(fetched.recordCount).toBe(2);
    expect(fetched.lastKey).toBe("2026-000002 EP");
    expect(fetched.maxBusinessDate).toBe("2026-10-26");
    expect(fetched.isLastPage).toBe(false);
    expect(fetched.receipt).toMatchObject({
      fetchedAt: FETCHED_AT.toISOString(),
      httpStatus: 200,
      bytes: Buffer.byteLength(twoPermits),
      sha256: createHash("sha256").update(twoPermits).digest("hex"),
    });
    expect(fetched.receipt.url).toContain("/resource/3syk-w9eu.json?%24query=");
  });

  it("marks a short page as the last one", async () => {
    const { fetchImpl } = fakeFetch(twoPermits);

    const fetched = await sourceWith(fetchImpl, 50).fetchPage({ kind: WindowKind.Full }, undefined);

    expect(fetched.isLastPage).toBe(true);
  });

  it("fails loudly on a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch("busy", 503);

    await expect(
      sourceWith(fetchImpl).fetchPage({ kind: WindowKind.Full }, undefined),
    ).rejects.toBeInstanceOf(SourceRequestError);
  });
});
