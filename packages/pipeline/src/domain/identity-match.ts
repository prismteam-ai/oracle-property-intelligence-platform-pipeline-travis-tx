import { Confidence } from "./confidence.js";

export enum IdentityMatchMethod {
  NameAndPhone = "name_and_phone",
  Phone = "phone",
  Name = "name",
  LocalName = "local_name",
}

export interface ContractorIdentity {
  contractorKey: string;
  phoneKeys: readonly string[];
  namedAsPerson: boolean;
}

export interface IdentityCandidate {
  id: string;
  nameKeys: readonly string[];
  phoneKeys: readonly string[];
  local: boolean;
}

export interface IdentityMatch {
  contractorKey: string;
  candidateId: string;
  method: IdentityMatchMethod;
  confidence: Confidence;
}

export function matchIdentities(
  contractors: readonly ContractorIdentity[],
  candidates: readonly IdentityCandidate[],
): IdentityMatch[] {
  const byName = indexBy(candidates, (candidate) => candidate.nameKeys);
  const byPhone = indexBy(candidates, (candidate) => candidate.phoneKeys);

  return contractors.flatMap((contractor) => {
    const named = byName.get(contractor.contractorKey) ?? [];
    const phoned = distinct(contractor.phoneKeys.flatMap((key) => byPhone.get(key) ?? []));
    const matched = (
      candidate: IdentityCandidate,
      method: IdentityMatchMethod,
      confidence: Confidence,
    ) => [
      { contractorKey: contractor.contractorKey, candidateId: candidate.id, method, confidence },
    ];

    const both = named.filter((candidate) => phoned.includes(candidate));
    if (both.length === 1 && both[0])
      return matched(both[0], IdentityMatchMethod.NameAndPhone, Confidence.High);
    if (phoned.length === 1 && phoned[0])
      return matched(phoned[0], IdentityMatchMethod.Phone, Confidence.Medium);
    if (contractor.namedAsPerson) return [];
    if (named.length === 1 && named[0])
      return matched(named[0], IdentityMatchMethod.Name, Confidence.Medium);
    const local = named.filter((candidate) => candidate.local);
    if (local.length === 1 && local[0])
      return matched(local[0], IdentityMatchMethod.LocalName, Confidence.Low);
    return [];
  });
}

function indexBy(
  candidates: readonly IdentityCandidate[],
  keysOf: (candidate: IdentityCandidate) => readonly string[],
): Map<string, IdentityCandidate[]> {
  const index = new Map<string, IdentityCandidate[]>();
  for (const candidate of candidates) {
    for (const key of new Set(keysOf(candidate))) {
      index.set(key, [...(index.get(key) ?? []), candidate]);
    }
  }
  return index;
}

function distinct<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
