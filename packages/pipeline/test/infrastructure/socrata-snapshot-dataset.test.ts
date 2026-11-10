import { describe, expect, it } from "vitest";
import { SourceId } from "../../src/domain/source-id.js";
import { SocrataSnapshotDataset } from "../../src/infrastructure/socrata-snapshot-dataset.js";
import { SourceRequestError } from "../../src/infrastructure/source-request-error.js";

function datasetAnswering(body: unknown, status = 200, where?: string) {
  const urls: URL[] = [];
  const dataset = new SocrataSnapshotDataset({
    id: SourceId.TxSalesTaxPermits,
    baseUrl: "https://data.texas.gov",
    datasetId: "jrea-zgmq",
    columns: ["taxpayer_number", "outlet_name"],
    where,
    pageSize: 2,
    userAgent: "travis-oracle-pipeline/test",
    fetch: async (input) => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify(body), { status });
    },
    now: () => new Date("2026-10-27T11:00:00.000Z"),
  });
  return { dataset, urls };
}

const twoOutlets = [
  { ":id": "row-aaaa", taxpayer_number: "1", outlet_name: "ACME ROOFING" },
  { ":id": "row-bbbb", taxpayer_number: "2", outlet_name: "BEST HOMES" },
];

describe("SocrataSnapshotDataset", () => {
  it("uses the time the dataset's rows were last updated as its version", async () => {
    const { dataset, urls } = datasetAnswering({ rowsUpdatedAt: 1793088378 });

    expect(await dataset.version()).toBe(new Date(1793088378 * 1000).toISOString());
    expect(urls[0]?.toString()).toBe("https://data.texas.gov/api/views/jrea-zgmq.json");
  });

  it("pages through the selected columns in row-id order, continuing after the last row", async () => {
    const { dataset, urls } = datasetAnswering(twoOutlets, 200, "outlet_county_code = '227'");

    const page = await dataset.fetchPage("row-0000");

    expect(urls[0]?.pathname).toBe("/resource/jrea-zgmq.json");
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      $select: ":id, taxpayer_number, outlet_name",
      $where: "(outlet_county_code = '227') AND :id > 'row-0000'",
      $order: ":id",
      $limit: "2",
    });
    expect(page).toMatchObject({ recordCount: 2, lastKey: "row-bbbb", isLastPage: false });
    expect(page.receipt).toMatchObject({ httpStatus: 200, fetchedAt: "2026-10-27T11:00:00.000Z" });
    expect(page.receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("starts without a row filter and knows a short page is the last one", async () => {
    const { dataset, urls } = datasetAnswering(twoOutlets.slice(0, 1));

    const page = await dataset.fetchPage(undefined);

    expect(urls[0]?.searchParams.has("$where")).toBe(false);
    expect(page).toMatchObject({ recordCount: 1, isLastPage: true });
  });

  it("reports a failed request with its status", async () => {
    const { dataset } = datasetAnswering({ message: "throttled" }, 429);

    await expect(dataset.fetchPage(undefined)).rejects.toBeInstanceOf(SourceRequestError);
  });
});
