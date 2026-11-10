import { describe, expect, it } from "vitest";
import { TcadExportCatalogPage } from "../../src/infrastructure/tcad-export-catalog-page.js";

const PAGE = `
  <a href="https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip">Certified</a>
  <a href='https://traviscad.org/wp-content/largefiles/travis_SUPP%20335_2026_WEBSITE%20EXPORT_Renamed.zip'>Latest</a>
  <a href="/about">About</a>
`;

describe("TcadExportCatalogPage", () => {
  it("reads the public information page and returns its newest appraisal export", async () => {
    const requested: string[] = [];
    const catalog = new TcadExportCatalogPage({
      pageUrl: "https://traviscad.org/publicinformation",
      userAgent: "travis-oracle-pipeline/test",
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(PAGE);
      },
    });

    expect(await catalog.latestExport()).toMatchObject({ year: 2026, supplement: 335 });
    expect(requested).toEqual(["https://traviscad.org/publicinformation"]);
  });
});
