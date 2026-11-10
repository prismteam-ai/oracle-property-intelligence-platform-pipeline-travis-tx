import { describe, expect, it } from "vitest";
import { exportKey, latestSupplementExport } from "../../src/domain/tcad-export-catalog.js";

const LARGE_FILES = "https://traviscad.org/wp-content/largefiles";
const CERTIFIED = `${LARGE_FILES}/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip`;
const SUPPLEMENT_335 = `${LARGE_FILES}/travis_SUPP%20335_2026_WEBSITE%20EXPORT_Renamed.zip`;
const PUBLISHED_LINKS = [
  CERTIFIED,
  `${LARGE_FILES}/2026%20Certified%20JSON%20SUPP%200%2007182026.zip`,
  `${LARGE_FILES}/2026%20Special%20export%20Supp%203%2010062026.zip`,
  `${LARGE_FILES}/227EARS090425.zip`,
  `${LARGE_FILES}/improvement_detail_2026.zip`,
  SUPPLEMENT_335,
  `${LARGE_FILES}/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip`,
];

describe("latestSupplementExport", () => {
  it("picks the newest supplement of the appraisal export and ignores other downloads", () => {
    expect(latestSupplementExport(PUBLISHED_LINKS)).toEqual({
      url: SUPPLEMENT_335,
      year: 2026,
      supplement: 335,
    });
  });

  it("falls back to the certified roll when no later supplement is published", () => {
    expect(latestSupplementExport([CERTIFIED])).toEqual({
      url: CERTIFIED,
      year: 2026,
      supplement: 0,
    });
  });

  it("prefers a newer appraisal year over a higher supplement number", () => {
    const nextYear = `${LARGE_FILES}/travis_SUPP%201_2027_WEBSITE%20EXPORT.zip`;
    expect(latestSupplementExport([SUPPLEMENT_335, nextYear])?.year).toBe(2027);
  });

  it("finds nothing when no appraisal export is linked", () => {
    expect(latestSupplementExport([`${LARGE_FILES}/227EARS090425.zip`])).toBeUndefined();
  });
});

describe("exportKey", () => {
  it("sorts by year, then supplement number", () => {
    const keys = [
      exportKey({ url: "", year: 2026, supplement: 335 }),
      exportKey({ url: "", year: 2026, supplement: 40 }),
      exportKey({ url: "", year: 2027, supplement: 0 }),
    ];
    expect([...keys].sort()).toEqual(["2026-supp-0040", "2026-supp-0335", "2027-supp-0000"]);
  });
});
