import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BbbRating } from "../../src/domain/bbb-profile.js";
import { BbbStateParser } from "../../src/infrastructure/bbb-state-parser.js";
import { NdjsonBbbArchiveStore } from "../../src/infrastructure/ndjson-bbb-archive-store.js";
import { SourceRequestError } from "../../src/infrastructure/source-request-error.js";
import { WaybackCdxIndex, WaybackSnapshotFetcher } from "../../src/infrastructure/wayback.js";

const PROFILE =
  "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/my-roof-pro-llc-0825-1000223239";
const USER_AGENT = "travis-oracle-pipeline/test";

describe("WaybackCdxIndex", () => {
  it("lists successful captures of profile pages per category, from the last run on", async () => {
    const urls: URL[] = [];
    const index = new WaybackCdxIndex({
      userAgent: USER_AGENT,
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return new Response(
          JSON.stringify([
            ["original", "timestamp"],
            [PROFILE, "20260710203309"],
          ]),
        );
      },
    });

    const captures = await index.captures({
      state: "tx",
      categories: ["roofing-contractors", "home-builders"],
      since: "20260101000000",
    });

    expect(captures).toEqual([
      { originalUrl: PROFILE, timestamp: "20260710203309" },
      { originalUrl: PROFILE, timestamp: "20260710203309" },
    ]);
    const query = urls[0];
    expect(query?.origin + (query?.pathname ?? "")).toBe("https://web.archive.org/cdx/search/cdx");
    expect(query?.searchParams.get("url")).toBe("bbb.org/us/tx/");
    expect(query?.searchParams.get("matchType")).toBe("prefix");
    expect(query?.searchParams.get("from")).toBe("20260101000000");
    expect(query?.searchParams.getAll("filter")).toEqual([
      "statuscode:200",
      "original:.*/profile/roofing-contractors/[^/?]+-[0-9]{4}-[0-9]+/?$",
    ]);
  });

  it("treats an empty answer as no captures", async () => {
    const index = new WaybackCdxIndex({
      userAgent: USER_AGENT,
      fetch: async () => new Response(""),
    });

    expect(
      await index.captures({ state: "tx", categories: ["siding-contractors"], since: undefined }),
    ).toEqual([]);
  });
});

describe("WaybackSnapshotFetcher", () => {
  it("fetches the archived bytes as captured, politely spaced, with a receipt", async () => {
    const urls: string[] = [];
    const sleeps: number[] = [];
    let clock = 0;
    const fetcher = new WaybackSnapshotFetcher({
      userAgent: USER_AGENT,
      minIntervalMs: 1000,
      fetch: async (input) => {
        urls.push(String(input));
        return new Response("<html></html>");
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
      },
      now: () => new Date(clock),
    });

    const first = await fetcher.fetch({ originalUrl: PROFILE, timestamp: "20260710203309" });
    await fetcher.fetch({ originalUrl: PROFILE, timestamp: "20250101000000" });

    expect(urls).toEqual([
      `https://web.archive.org/web/20260710203309id_/${PROFILE}`,
      `https://web.archive.org/web/20250101000000id_/${PROFILE}`,
    ]);
    expect(sleeps).toEqual([1000]);
    expect(first.receipt).toMatchObject({
      url: `https://web.archive.org/web/20260710203309id_/${PROFILE}`,
      httpStatus: 200,
      bytes: 13,
      sha256: createHash("sha256").update("<html></html>").digest("hex"),
    });
  });

  it("fails on a missing snapshot", async () => {
    const fetcher = new WaybackSnapshotFetcher({
      userAgent: USER_AGENT,
      minIntervalMs: 0,
      fetch: async () => new Response("gone", { status: 404 }),
      sleep: async () => {},
      now: () => new Date(0),
    });

    await expect(fetcher.fetch({ originalUrl: PROFILE, timestamp: "1" })).rejects.toBeInstanceOf(
      SourceRequestError,
    );
  });
});

const page = (state: unknown, terminator = ";") =>
  `<html><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)}${terminator}</script><script>window.__other = 1;</script></html>`;

const capture = { profileId: "0825-1000223239", originalUrl: PROFILE, timestamp: "20260710203309" };

describe("BbbStateParser", () => {
  it("reads the current profile layout", () => {
    const profile = new BbbStateParser().parse(
      page({
        businessProfile: {
          bbbId: "0825",
          businessId: "1000223239",
          names: { primary: "My Roof Pro LLC", altBusinessNames: ["Roof Pros"] },
          contactInformation: {
            phoneNumber: "(512) 262-9877",
            contacts: [{ name: { first: "Andrew" } }],
          },
          location: { postalAddress: { city: "Austin", stateCode: "TX", zipCode: "78746-6446" } },
          rating: { bbbRating: "A" },
          accreditationInformation: { isAccredited: true },
          dates: { accredited: "2023-12-27T00:00:00" },
          orgDetails: { isOutOfBusiness: false },
        },
      }),
      capture,
    );

    expect(profile).toEqual({
      profileId: "0825-1000223239",
      name: "My Roof Pro LLC",
      alternateNames: ["Roof Pros"],
      phones: ["(512) 262-9877"],
      city: "Austin",
      state: "TX",
      zip: "78746",
      rating: BbbRating.A,
      accredited: true,
      accreditedSince: "2023-12-27",
      outOfBusiness: false,
      profileUrl: PROFILE,
      snapshotUrl: `https://web.archive.org/web/20260710203309/${PROFILE}`,
      snapshotAt: "2026-07-10T20:33:09Z",
    });
  });

  it("reads the older layout that nests business data", () => {
    const profile = new BbbStateParser().parse(
      page(
        {
          businessProfile: {
            bbbId: "0825",
            businessId: "1000105107",
            businessData: {
              namePrimary: "1st Capital Certified Roofing",
              altBusinessNames: ["1st Capital Roofing & Restoration Contractor"],
              phoneNumbers: {
                allPhoneNumbers: [{ number: "(512) 629-1133" }, { number: "(512) 358-1300" }],
              },
              location: {
                postalAddress: { city: "Austin", stateCode: "TX", zipCode: "78739-1422" },
              },
              rating: { bbbRating: "A+" },
              isAccredited: true,
              dateAccredited: "2014-05-20T00:00:00",
              isOutOfBusiness: true,
            },
          },
        },
        "",
      ),
      { ...capture, profileId: "0825-1000105107" },
    );

    expect(profile).toMatchObject({
      profileId: "0825-1000105107",
      name: "1st Capital Certified Roofing",
      phones: ["(512) 629-1133", "(512) 358-1300"],
      rating: BbbRating.APlus,
      accreditedSince: "2014-05-20",
      outOfBusiness: true,
      zip: "78739",
    });
  });

  it("finds no profile in a page without the embedded state or a business name", () => {
    expect(new BbbStateParser().parse("<html>blocked</html>", capture)).toBeUndefined();
    expect(new BbbStateParser().parse(page({ businessProfile: {} }), capture)).toBeUndefined();
  });
});

describe("NdjsonBbbArchiveStore", () => {
  it("appends one JSON line per profile to the run's file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-bbb-"));
    const store = new NdjsonBbbArchiveStore(dataDir);

    await store.append("20261028T090000Z", {
      profileId: "0825-1",
      capture,
      profile: null,
      error: "HTTP 404",
    });
    await store.append("20261028T090000Z", { profileId: "0825-2", capture, profile: null });

    const lines = (
      await readFile(
        join(dataDir, "raw", "bbb-archive", "20261028T090000Z", "profiles.ndjson"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.profileId)).toEqual(["0825-1", "0825-2"]);
  });
});
