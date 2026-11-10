import { describe, expect, it } from "vitest";
import {
  type ArchiveCapture,
  BbbRating,
  bbbRatingOf,
  latestCapturePerProfile,
  profileIdFromUrl,
  slugCompanyKey,
  snapshotTimeOf,
} from "../../src/domain/bbb-profile.js";

const capture = (originalUrl: string, timestamp: string): ArchiveCapture => ({
  originalUrl,
  timestamp,
});

describe("profileIdFromUrl", () => {
  it("reads the bureau and business id at the end of a profile URL", () => {
    expect(
      profileIdFromUrl(
        "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/my-roof-pro-llc-0825-1000223239",
      ),
    ).toBe("0825-1000223239");
    expect(
      profileIdFromUrl(
        "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/a1-llc-0825-1000194524/",
      ),
    ).toBe("0825-1000194524");
  });

  it("has no id for pages that are not a business profile", () => {
    expect(
      profileIdFromUrl("https://www.bbb.org/us/tx/austin/category/roofing-contractors"),
    ).toBeUndefined();
  });
});

describe("snapshotTimeOf", () => {
  it("turns a Wayback timestamp into an ISO instant", () => {
    expect(snapshotTimeOf("20260710203309")).toBe("2026-07-10T20:33:09Z");
  });
});

describe("latestCapturePerProfile", () => {
  it("keeps only the newest capture of each profile, however its URL was spelled", () => {
    const latest = latestCapturePerProfile([
      capture(
        "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/acme-0825-1",
        "20210101000000",
      ),
      capture(
        "http://bbb.org/us/tx/austin/profile/roofing-contractors/acme-0825-1/",
        "20260101000000",
      ),
      capture(
        "https://www.bbb.org/us/tx/dallas/profile/roofing-contractors/other-0875-2",
        "20250101000000",
      ),
      capture("https://www.bbb.org/us/tx/austin/category/roofing-contractors", "20260101000000"),
    ]);

    expect(latest).toEqual([
      {
        profileId: "0825-1",
        ...capture(
          "http://bbb.org/us/tx/austin/profile/roofing-contractors/acme-0825-1/",
          "20260101000000",
        ),
      },
      {
        profileId: "0875-2",
        ...capture(
          "https://www.bbb.org/us/tx/dallas/profile/roofing-contractors/other-0875-2",
          "20250101000000",
        ),
      },
    ]);
  });
});

describe("bbbRatingOf", () => {
  it.each([
    ["A+", BbbRating.APlus],
    ["B-", BbbRating.BMinus],
    ["F", BbbRating.F],
    ["NR", BbbRating.NotRated],
  ])("accepts the letter grade %s", (grade, rating) => {
    expect(bbbRatingOf(grade)).toBe(rating);
  });

  it("rejects anything that is not a BBB grade", () => {
    expect(bbbRatingOf("AAA")).toBeUndefined();
    expect(bbbRatingOf(undefined)).toBeUndefined();
  });
});

describe("slugCompanyKey", () => {
  it("reads the business name a profile URL spells out, as a contractor key", () => {
    expect(
      slugCompanyKey(
        "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/my-roof-pro-llc-0825-1000223239/",
      ),
    ).toBe("my roof pro");
  });

  it("has no key for a URL without a profile slug", () => {
    expect(
      slugCompanyKey("https://www.bbb.org/us/tx/austin/category/roofing-contractors"),
    ).toBeUndefined();
  });
});
