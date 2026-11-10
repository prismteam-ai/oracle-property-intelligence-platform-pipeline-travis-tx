import { describe, expect, it } from "vitest";
import { latestStormEventFiles } from "../../src/domain/storm-events.js";

const LISTING = `
<a href="StormEvents_details-ftp_v1.0_d1999_c20220425.csv.gz">StormEvents_details-ftp_v1.0_d1999_c20220425.csv.gz</a>
<a href="StormEvents_details-ftp_v1.0_d2024_c20260301.csv.gz">StormEvents_details-ftp_v1.0_d2024_c20260301.csv.gz</a>
<a href="StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz">StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz</a>
<a href="StormEvents_fatalities-ftp_v1.0_d2024_c20260728.csv.gz">StormEvents_fatalities-ftp_v1.0_d2024_c20260728.csv.gz</a>
<a href="StormEvents_details-ftp_v1.0_d2000_c20220425.csv.gz">StormEvents_details-ftp_v1.0_d2000_c20220425.csv.gz</a>
`;

describe("latestStormEventFiles", () => {
  it("keeps the newest event details file of each year from the first year on, oldest year first", () => {
    expect(latestStormEventFiles(LISTING, 2000)).toEqual([
      {
        year: 2000,
        createdOn: "2022-04-25",
        name: "StormEvents_details-ftp_v1.0_d2000_c20220425.csv.gz",
      },
      {
        year: 2024,
        createdOn: "2026-07-28",
        name: "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz",
      },
    ]);
  });

  it("finds nothing in a listing without event details files", () => {
    expect(latestStormEventFiles("<html></html>", 2000)).toEqual([]);
  });
});
