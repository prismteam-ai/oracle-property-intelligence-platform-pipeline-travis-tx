import { describe, expect, it } from "vitest";
import type {
  ArchivedProfileRecord,
  ArchivedSnapshots,
  ArchiveIndex,
  BbbArchiveStore,
  CaptureQuery,
  ProfileParser,
  SnapshotFetcher,
} from "../../src/application/bbb-ports.js";
import { ingestBbbArchive } from "../../src/application/ingest-bbb-archive.js";
import {
  type ArchiveCapture,
  type BbbProfile,
  BbbRating,
  type ProfileCapture,
} from "../../src/domain/bbb-profile.js";
import { SourceId } from "../../src/domain/source-id.js";

const RUN_ID = "20261028T090000Z";
const profileUrl = (slug: string) =>
  `https://www.bbb.org/us/tx/austin/profile/roofing-contractors/${slug}`;
const ACME = profileUrl("acme-roofing-0825-1");
const BETA = profileUrl("beta-roofing-0825-2");
const GONE = profileUrl("gone-roofing-0825-3");
const ZETA = profileUrl("zeta-builders-0825-4");

const receipt = {
  url: "https://web.archive.org/web/x",
  fetchedAt: "2026-10-28T09:00:00.000Z",
  httpStatus: 200,
  bytes: 10,
  sha256: "abc",
};
const SECOND_MS = 1_000;

class FixedIndex implements ArchiveIndex {
  queries: CaptureQuery[] = [];
  constructor(private readonly answer: ArchiveCapture[]) {}
  async captures(query: CaptureQuery) {
    this.queries.push(query);
    return this.answer;
  }
}

class FakeSnapshots implements SnapshotFetcher {
  fetched: ArchiveCapture[] = [];
  constructor(private readonly clock: { ms: number }) {}
  async fetch(capture: ArchiveCapture) {
    this.fetched.push(capture);
    this.clock.ms += SECOND_MS;
    if (capture.originalUrl === GONE) throw new Error("HTTP 404");
    return {
      body: capture.originalUrl === BETA ? "<html>no state</html>" : "<html>state</html>",
      receipt,
    };
  }
}

class StateParser implements ProfileParser {
  parse(html: string, capture: ProfileCapture): BbbProfile | undefined {
    if (!html.includes(">state<")) return undefined;
    return {
      profileId: capture.profileId,
      name: "Acme Roofing",
      alternateNames: [],
      phones: [],
      city: "Austin",
      state: "TX",
      zip: "78704",
      rating: BbbRating.A,
      accredited: true,
      accreditedSince: undefined,
      outOfBusiness: false,
      profileUrl: capture.originalUrl,
      snapshotUrl: `https://web.archive.org/web/${capture.timestamp}/${capture.originalUrl}`,
      snapshotAt: "2026-07-10T20:33:09Z",
    };
  }
}

class MemoryStore implements BbbArchiveStore {
  records: ArchivedProfileRecord[] = [];
  async append(runId: string, record: ArchivedProfileRecord) {
    expect(runId).toBe(RUN_ID);
    this.records.push(record);
  }
}

class KnownSnapshots implements ArchivedSnapshots {
  constructor(private readonly known: string[] = []) {}
  has(profileId: string, timestamp: string) {
    return this.known.includes(`${profileId}@${timestamp}`);
  }
}

function setup(captures: ArchiveCapture[], archived = new KnownSnapshots()) {
  const clock = { ms: 0 };
  return {
    clock,
    deps: {
      index: new FixedIndex(captures),
      snapshots: new FakeSnapshots(clock),
      parser: new StateParser(),
      store: new MemoryStore(),
      archived,
      now: () => new Date(clock.ms),
    },
  };
}

const options = (budgetMs: number, priority: string[] = []) => ({
  runId: RUN_ID,
  state: "tx",
  categories: ["roofing-contractors"],
  priorityKeys: new Set(priority),
  budgetMs,
});

describe("ingestBbbArchive", () => {
  it("fetches the newest capture of each profile and keeps every outcome with its receipt", async () => {
    const { deps } = setup([
      { originalUrl: ACME, timestamp: "20210101000000" },
      { originalUrl: ACME, timestamp: "20260710203309" },
      { originalUrl: BETA, timestamp: "20250101000000" },
      { originalUrl: GONE, timestamp: "20240101000000" },
    ]);

    const result = await ingestBbbArchive(deps, options(60 * SECOND_MS));

    expect(deps.snapshots.fetched.map((capture) => capture.timestamp)).toEqual([
      "20260710203309",
      "20250101000000",
      "20240101000000",
    ]);
    expect(deps.store.records.map((record) => [record.profileId, record.profile !== null])).toEqual(
      [
        ["0825-1", true],
        ["0825-2", false],
        ["0825-3", false],
      ],
    );
    expect(deps.store.records[0]?.receipt).toEqual(receipt);
    expect(deps.store.records[2]?.error).toContain("404");
    expect(result).toEqual({
      source: SourceId.BbbArchive,
      runId: RUN_ID,
      captures: 4,
      pending: 3,
      prioritized: 0,
      fetched: 3,
      remaining: 0,
      parsed: 1,
      unparsed: 1,
      failed: 1,
      ratings: { A: 1 },
    });
  });

  it("skips snapshots it already archived", async () => {
    const { deps } = setup(
      [
        { originalUrl: ACME, timestamp: "20260710203309" },
        { originalUrl: BETA, timestamp: "20261001000000" },
      ],
      new KnownSnapshots(["0825-1@20260710203309"]),
    );

    const result = await ingestBbbArchive(deps, options(60 * SECOND_MS));

    expect(deps.snapshots.fetched.map((capture) => capture.originalUrl)).toEqual([BETA]);
    expect(result).toMatchObject({ pending: 1, fetched: 1 });
  });

  it("fetches profiles named like known contractors first", async () => {
    const { deps } = setup([
      { originalUrl: ACME, timestamp: "20260101000000" },
      { originalUrl: ZETA, timestamp: "20260101000000" },
    ]);

    const result = await ingestBbbArchive(deps, options(60 * SECOND_MS, ["zeta builders"]));

    expect(deps.snapshots.fetched.map((capture) => capture.originalUrl)).toEqual([ZETA, ACME]);
    expect(result.prioritized).toBe(1);
  });

  it("stops at the time budget and reports what is left", async () => {
    const { deps } = setup([
      { originalUrl: ACME, timestamp: "20260101000000" },
      { originalUrl: BETA, timestamp: "20260101000000" },
      { originalUrl: ZETA, timestamp: "20260101000000" },
    ]);

    const result = await ingestBbbArchive(deps, options(2 * SECOND_MS));

    expect(deps.snapshots.fetched).toHaveLength(2);
    expect(result).toMatchObject({ pending: 3, fetched: 2, remaining: 1 });
  });
});
