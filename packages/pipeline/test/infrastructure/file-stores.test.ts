import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { SourceId } from "../../src/domain/source-id.js";
import { FileRawStore } from "../../src/infrastructure/file-raw-store.js";
import { JsonWatermarkStore } from "../../src/infrastructure/json-watermark-store.js";

const receipt = {
  url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
  fetchedAt: "2026-10-27T06:30:00.000Z",
  httpStatus: 200,
  bytes: 2,
  sha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-"));
});

describe("FileRawStore", () => {
  it("keeps each page byte for byte, gzipped, and appends its receipt to the run's log", async () => {
    const store = new FileRawStore(dataDir);

    for (const pageNumber of [1, 2]) {
      await store.savePage({
        runId: "20261027T063000Z",
        source: SourceId.AustinPermits,
        pageNumber,
        body: "[]",
        receipt,
      });
    }

    const runDir = join(dataDir, "raw", "austin-permits", "20261027T063000Z");
    expect(gunzipSync(await readFile(join(runDir, "page-00001.json.gz"))).toString("utf8")).toBe(
      "[]",
    );
    const receipts = (await readFile(join(runDir, "receipts.ndjson"), "utf8")).trim().split("\n");
    expect(receipts.map((line) => JSON.parse(line))).toEqual([
      { pageNumber: 1, file: "page-00001.json.gz", ...receipt },
      { pageNumber: 2, file: "page-00002.json.gz", ...receipt },
    ]);
  });
});

describe("JsonWatermarkStore", () => {
  it("has no watermark for a source that was never ingested", async () => {
    expect(
      await new JsonWatermarkStore(join(dataDir, "state")).read(SourceId.AustinPermits),
    ).toBeUndefined();
  });

  it("persists watermarks across instances", async () => {
    const stateDir = join(dataDir, "state");

    await new JsonWatermarkStore(stateDir).write(SourceId.AustinPermits, "2026-10-26");

    expect(await new JsonWatermarkStore(stateDir).read(SourceId.AustinPermits)).toBe("2026-10-26");
  });

  it("keeps each source in its own file so sources can be ingested in parallel", async () => {
    const stateDir = join(dataDir, "state");

    await new JsonWatermarkStore(stateDir).write(SourceId.AustinPermits, "2026-10-26");
    await new JsonWatermarkStore(stateDir).write(SourceId.TcadAppraisalExport, "2026-supp-0335");

    expect(JSON.parse(await readFile(join(stateDir, "austin-permits.json"), "utf8"))).toEqual({
      watermark: "2026-10-26",
    });
    expect(
      JSON.parse(await readFile(join(stateDir, "tcad-appraisal-export.json"), "utf8")),
    ).toEqual({ watermark: "2026-supp-0335" });
  });
});
