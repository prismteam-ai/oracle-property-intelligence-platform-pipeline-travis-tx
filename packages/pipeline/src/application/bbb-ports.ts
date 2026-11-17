import type { ArchiveCapture, BbbProfile, ProfileCapture } from "../domain/bbb-profile.js";
import type { FetchReceipt } from "../domain/fetch-receipt.js";

export interface CaptureQuery {
  state: string;
  categories: readonly string[];
  since: string | undefined;
}

export interface ArchiveIndex {
  captures(query: CaptureQuery): Promise<ArchiveCapture[]>;
}

export interface FetchedSnapshot {
  body: string;
  receipt: FetchReceipt;
}

export interface SnapshotFetcher {
  fetch(capture: ArchiveCapture): Promise<FetchedSnapshot>;
}

export interface ProfileParser {
  parse(html: string, capture: ProfileCapture): BbbProfile | undefined;
}

export interface ArchivedProfileRecord {
  profileId: string;
  capture: ProfileCapture;
  receipt?: FetchReceipt;
  profile: BbbProfile | null;
  error?: string;
}

export interface BbbArchiveStore {
  append(runId: string, record: ArchivedProfileRecord): Promise<void>;
}

export interface ArchivedSnapshots {
  has(profileId: string, timestamp: string): boolean;
}
