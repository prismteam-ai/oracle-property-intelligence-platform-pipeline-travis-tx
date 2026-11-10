import { isAustinMetroZip } from "./austin-metro.js";
import type { BbbProfile } from "./bbb-profile.js";
import { companyKey, phoneKey } from "./company-name.js";
import { Confidence } from "./confidence.js";

export enum BbbMatchMethod {
  NameAndPhone = "name_and_phone",
  Phone = "phone",
  Name = "name",
}

export interface ContractorIdentity {
  contractorKey: string;
  phoneKeys: readonly string[];
}

export interface BbbMatch {
  contractorKey: string;
  profileId: string;
  method: BbbMatchMethod;
  confidence: Confidence;
}

export function matchContractorsToBbb(
  contractors: readonly ContractorIdentity[],
  profiles: readonly BbbProfile[],
): BbbMatch[] {
  const byName = indexBy(profiles, (profile) =>
    [profile.name, ...profile.alternateNames].map(companyKey),
  );
  const byPhone = indexBy(profiles, (profile) => profile.phones.map(phoneKey));

  return contractors.flatMap((contractor) => {
    const named = byName.get(contractor.contractorKey) ?? [];
    const phoned = distinct(contractor.phoneKeys.flatMap((key) => byPhone.get(key) ?? []));
    const both = named.filter((profile) => phoned.includes(profile));
    const matched = (profile: BbbProfile, method: BbbMatchMethod, confidence: Confidence) => [
      { contractorKey: contractor.contractorKey, profileId: profile.profileId, method, confidence },
    ];

    const newestOfBoth = newest(both);
    if (newestOfBoth) return matched(newestOfBoth, BbbMatchMethod.NameAndPhone, Confidence.High);
    const [onlyPhoned] = phoned;
    if (phoned.length === 1 && onlyPhoned) {
      return matched(onlyPhoned, BbbMatchMethod.Phone, Confidence.Medium);
    }
    const [onlyNamed] = named;
    if (named.length === 1 && onlyNamed) {
      return matched(onlyNamed, BbbMatchMethod.Name, Confidence.Medium);
    }
    const local = named.filter((profile) => isAustinMetroZip(profile.zip));
    const [onlyLocal] = local;
    if (local.length === 1 && onlyLocal) {
      return matched(onlyLocal, BbbMatchMethod.Name, Confidence.Low);
    }
    return [];
  });
}

function indexBy(
  profiles: readonly BbbProfile[],
  keysOf: (profile: BbbProfile) => (string | undefined)[],
): Map<string, BbbProfile[]> {
  const index = new Map<string, BbbProfile[]>();
  for (const profile of profiles) {
    for (const key of new Set(keysOf(profile))) {
      if (key === undefined) continue;
      index.set(key, [...(index.get(key) ?? []), profile]);
    }
  }
  return index;
}

function distinct(profiles: readonly BbbProfile[]): BbbProfile[] {
  return [...new Map(profiles.map((profile) => [profile.profileId, profile])).values()];
}

function newest(profiles: readonly BbbProfile[]): BbbProfile | undefined {
  return [...profiles].sort(
    (a, b) => b.snapshotAt.localeCompare(a.snapshotAt) || a.profileId.localeCompare(b.profileId),
  )[0];
}
