import { describe, expect, it } from "vitest";
import { PublicationIndex, publicationRecordKey } from "../../worker/publications.js";

const HISTORY = [
  {
    buildId: "20261027T080415Z",
    publishedAt: "2026-10-27T08:05:27.364Z",
    manifestCid: "bafkrei-one",
    rootCid: "bafybei-one",
    ipns: { name: "k51", resolvedCid: "bafkrei-one" },
  },
];

describe("PublicationIndex", () => {
  it("reads the publication history once per refresh interval", async () => {
    let reads = 0;
    let now = 0;
    const index = new PublicationIndex({
      read: async () => {
        reads += 1;
        return JSON.stringify(HISTORY);
      },
      now: () => now,
      refreshMs: 60_000,
    });

    expect(await index.list()).toEqual(HISTORY);
    now = 59_000;
    await index.list();
    expect(reads).toBe(1);
    now = 61_000;
    await index.list();
    expect(reads).toBe(2);
  });

  it("is empty before the first publication", async () => {
    const index = new PublicationIndex({ read: async () => null, now: () => 0, refreshMs: 1 });

    expect(await index.list()).toEqual([]);
  });
});

describe("publicationRecordKey", () => {
  it("maps a publication's path to its CI record in the mirror", () => {
    expect(publicationRecordKey("/api/publications/20261027T154926Z")).toBe(
      "publications/20261027T154926Z.json",
    );
  });

  it("accepts only build ids", () => {
    expect(publicationRecordKey("/api/publications/../secrets")).toBeUndefined();
    expect(publicationRecordKey("/api/publications/latest")).toBeUndefined();
  });
});
