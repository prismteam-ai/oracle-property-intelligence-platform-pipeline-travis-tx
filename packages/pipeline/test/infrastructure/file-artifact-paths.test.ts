import { describe, expect, it } from "vitest";
import { SourceId } from "../../src/domain/source-id.js";
import { FileArtifactPaths } from "../../src/infrastructure/file-artifact-paths.js";

describe("FileArtifactPaths", () => {
  const paths = new FileArtifactPaths("/data");

  it("keeps raw downloads per source and run", () => {
    expect(paths.rawFile("20261027T090000Z", SourceId.TcadAppraisalExport, "export.zip")).toBe(
      "/data/raw/tcad-appraisal-export/20261027T090000Z/export.zip",
    );
  });

  it("keeps derived tables per source and run as Parquet", () => {
    expect(paths.table("20261027T090000Z", SourceId.TcadAppraisalExport, "properties")).toBe(
      "/data/tables/tcad-appraisal-export/20261027T090000Z/properties.parquet",
    );
  });
});
