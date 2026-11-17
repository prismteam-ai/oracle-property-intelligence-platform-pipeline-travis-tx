import {
  latestCapturePerProfile,
  type ProfileCapture,
  slugCompanyKey,
} from "../domain/bbb-profile.js";
import { SourceId } from "../domain/source-id.js";
import type {
  ArchivedProfileRecord,
  ArchivedSnapshots,
  ArchiveIndex,
  BbbArchiveStore,
  ProfileParser,
  SnapshotFetcher,
} from "./bbb-ports.js";

export interface BbbArchiveDependencies {
  index: ArchiveIndex;
  snapshots: SnapshotFetcher;
  parser: ProfileParser;
  store: BbbArchiveStore;
  archived: ArchivedSnapshots;
  now: () => Date;
}

export interface BbbArchiveOptions {
  runId: string;
  state: string;
  categories: readonly string[];
  priorityKeys: ReadonlySet<string>;
  budgetMs: number;
}

export interface BbbArchiveResult {
  source: SourceId;
  runId: string;
  captures: number;
  pending: number;
  prioritized: number;
  fetched: number;
  remaining: number;
  parsed: number;
  unparsed: number;
  failed: number;
  ratings: Record<string, number>;
}

export async function ingestBbbArchive(
  { index, snapshots, parser, store, archived, now }: BbbArchiveDependencies,
  { runId, state, categories, priorityKeys, budgetMs }: BbbArchiveOptions,
): Promise<BbbArchiveResult> {
  const deadline = now().getTime() + budgetMs;
  const captures = await index.captures({ state, categories, since: undefined });
  const pending = latestCapturePerProfile(captures).filter(
    (capture) => !archived.has(capture.profileId, capture.timestamp),
  );
  const isPriority = (capture: ProfileCapture) =>
    priorityKeys.has(slugCompanyKey(capture.originalUrl) ?? "");
  const ordered = [
    ...pending.filter(isPriority),
    ...pending.filter((capture) => !isPriority(capture)),
  ];

  let fetched = 0;
  let parsed = 0;
  let unparsed = 0;
  let failed = 0;
  const ratings: Record<string, number> = {};
  for (const capture of ordered) {
    if (now().getTime() >= deadline) break;
    fetched += 1;
    let record: ArchivedProfileRecord;
    try {
      const snapshot = await snapshots.fetch(capture);
      const profile = parser.parse(snapshot.body, capture) ?? null;
      record = { profileId: capture.profileId, capture, receipt: snapshot.receipt, profile };
      if (profile === null) unparsed += 1;
      else {
        parsed += 1;
        if (profile.rating) ratings[profile.rating] = (ratings[profile.rating] ?? 0) + 1;
      }
    } catch (error) {
      failed += 1;
      record = {
        profileId: capture.profileId,
        capture,
        profile: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await store.append(runId, record);
  }

  return {
    source: SourceId.BbbArchive,
    runId,
    captures: captures.length,
    pending: pending.length,
    prioritized: pending.filter(isPriority).length,
    fetched,
    remaining: pending.length - fetched,
    parsed,
    unparsed,
    failed,
    ratings,
  };
}
