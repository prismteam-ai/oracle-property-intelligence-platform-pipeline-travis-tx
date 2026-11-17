import { describe, expect, it } from "vitest";
import { BbbMatchMethod, matchContractorsToBbb } from "../../src/domain/bbb-match.js";
import { type BbbProfile, BbbRating } from "../../src/domain/bbb-profile.js";
import { Confidence } from "../../src/domain/confidence.js";

const profile = (overrides: Partial<BbbProfile>): BbbProfile => ({
  profileId: "0825-1",
  name: "Reliable Roofing, Inc.",
  alternateNames: [],
  phones: [],
  city: "Austin",
  state: "TX",
  zip: "78704",
  rating: BbbRating.APlus,
  accredited: true,
  accreditedSince: "2014-05-20",
  outOfBusiness: false,
  profileUrl:
    "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/reliable-roofing-0825-1",
  snapshotUrl:
    "https://web.archive.org/web/20260710203309/https://www.bbb.org/us/tx/austin/profile/roofing-contractors/reliable-roofing-0825-1",
  snapshotAt: "2026-07-10T20:33:09Z",
  ...overrides,
});

describe("matchContractorsToBbb", () => {
  it("matches on name and phone together with high confidence", () => {
    const matches = matchContractorsToBbb(
      [{ contractorKey: "reliable roofing", phoneKeys: ["5125550142"] }],
      [profile({ phones: ["(512) 555-0142"] })],
    );

    expect(matches).toEqual([
      {
        contractorKey: "reliable roofing",
        profileId: "0825-1",
        method: BbbMatchMethod.NameAndPhone,
        confidence: Confidence.High,
      },
    ]);
  });

  it("matches a renamed business by its unique phone number", () => {
    const [match] = matchContractorsToBbb(
      [{ contractorKey: "rr exteriors", phoneKeys: ["5125550142"] }],
      [profile({ phones: ["512-555-0142"] })],
    );

    expect(match).toMatchObject({ method: BbbMatchMethod.Phone, confidence: Confidence.Medium });
  });

  it("matches by a unique name, including the business's alternate names", () => {
    const [match] = matchContractorsToBbb(
      [{ contractorKey: "1st capital roofing restoration contractor", phoneKeys: [] }],
      [
        profile({
          name: "1st Capital Certified Roofing",
          alternateNames: ["1st Capital Roofing & Restoration Contractor"],
        }),
      ],
    );

    expect(match).toMatchObject({ method: BbbMatchMethod.Name, confidence: Confidence.Medium });
  });

  it("settles a shared name on the one Austin-area business with low confidence", () => {
    const [match] = matchContractorsToBbb(
      [{ contractorKey: "lone star roofing", phoneKeys: [] }],
      [
        profile({ profileId: "0825-7", name: "Lone Star Roofing", zip: "78745" }),
        profile({ profileId: "0875-9", name: "Lone Star Roofing", city: "Dallas", zip: "75201" }),
      ],
    );

    expect(match).toEqual({
      contractorKey: "lone star roofing",
      profileId: "0825-7",
      method: BbbMatchMethod.Name,
      confidence: Confidence.Low,
    });
  });

  it("declines to guess between same-named businesses it cannot tell apart", () => {
    expect(
      matchContractorsToBbb(
        [{ contractorKey: "lone star roofing", phoneKeys: [] }],
        [
          profile({ profileId: "0825-7", name: "Lone Star Roofing", zip: "78745" }),
          profile({ profileId: "0825-8", name: "Lone Star Roofing", zip: "78660" }),
        ],
      ),
    ).toEqual([]);
  });

  it("prefers the most recent snapshot when one business has several profiles", () => {
    const [match] = matchContractorsToBbb(
      [{ contractorKey: "reliable roofing", phoneKeys: ["5125550142"] }],
      [
        profile({
          profileId: "0825-1",
          phones: ["5125550142"],
          snapshotAt: "2019-01-01T00:00:00Z",
        }),
        profile({
          profileId: "0825-2",
          phones: ["5125550142"],
          snapshotAt: "2026-01-01T00:00:00Z",
        }),
      ],
    );

    expect(match?.profileId).toBe("0825-2");
  });

  it("leaves contractors without any matching profile unmatched", () => {
    expect(
      matchContractorsToBbb(
        [{ contractorKey: "unknown co", phoneKeys: ["5120000000"] }],
        [profile({})],
      ),
    ).toEqual([]);
  });
});
