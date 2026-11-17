import { companyKey } from "./company-name.js";

export enum BbbRating {
  APlus = "A+",
  A = "A",
  AMinus = "A-",
  BPlus = "B+",
  B = "B",
  BMinus = "B-",
  CPlus = "C+",
  C = "C",
  CMinus = "C-",
  DPlus = "D+",
  D = "D",
  DMinus = "D-",
  F = "F",
  NotRated = "NR",
}

export interface ArchiveCapture {
  originalUrl: string;
  timestamp: string;
}

export interface ProfileCapture extends ArchiveCapture {
  profileId: string;
}

export interface BbbProfile {
  profileId: string;
  name: string;
  alternateNames: string[];
  phones: string[];
  city: string | undefined;
  state: string | undefined;
  zip: string | undefined;
  rating: BbbRating | undefined;
  accredited: boolean;
  accreditedSince: string | undefined;
  outOfBusiness: boolean;
  profileUrl: string;
  snapshotUrl: string;
  snapshotAt: string;
}

const PROFILE_PATH = "/profile/";
const PROFILE_ID = /-(\d{4})-(\d+)\/?$/;
const PROFILE_SLUG = /\/profile\/[^/]+\/([^/?]+)-\d{4}-\d+\/?$/;
const SLUG_SEPARATOR = "-";
const RATINGS = new Set<string>(Object.values(BbbRating));

export function profileIdFromUrl(url: string): string | undefined {
  if (!url.includes(PROFILE_PATH)) return undefined;
  const match = PROFILE_ID.exec(url);
  return match ? `${match[1]}-${match[2]}` : undefined;
}

export function snapshotTimeOf(timestamp: string): string {
  const part = (start: number, end: number) => timestamp.slice(start, end);
  return `${part(0, 4)}-${part(4, 6)}-${part(6, 8)}T${part(8, 10)}:${part(10, 12)}:${part(12, 14)}Z`;
}

export function latestCapturePerProfile(captures: readonly ArchiveCapture[]): ProfileCapture[] {
  const latest = new Map<string, ProfileCapture>();
  for (const capture of captures) {
    const profileId = profileIdFromUrl(capture.originalUrl);
    if (profileId === undefined) continue;
    const current = latest.get(profileId);
    if (current === undefined || capture.timestamp > current.timestamp) {
      latest.set(profileId, { profileId, ...capture });
    }
  }
  return [...latest.values()].sort((a, b) => a.profileId.localeCompare(b.profileId));
}

export function bbbRatingOf(value: string | undefined): BbbRating | undefined {
  return value !== undefined && RATINGS.has(value) ? (value as BbbRating) : undefined;
}

export function slugCompanyKey(url: string): string | undefined {
  const slug = PROFILE_SLUG.exec(url)?.[1];
  return slug ? companyKey(slug.replaceAll(SLUG_SEPARATOR, " ")) : undefined;
}
