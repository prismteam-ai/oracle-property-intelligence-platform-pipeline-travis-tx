import type { DatasetInfo } from "@travis-oracle/query-core";
import type { Dataset } from "../data/dataset.js";

export function datasetInfo(dataset: Dataset): DatasetInfo {
  return {
    buildId: dataset.build.buildId,
    manifestCid: dataset.publication.manifestCid,
    rootCid: dataset.publication.rootCid,
    publishedAt: dataset.publication.publishedAt,
    coverage: dataset.coverage,
  };
}
