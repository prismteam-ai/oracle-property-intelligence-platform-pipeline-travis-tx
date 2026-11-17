import { isAustinMetroZip } from "../domain/austin-metro.js";
import { matchContractorsToBbb } from "../domain/bbb-match.js";
import { companyKey, phoneKey } from "../domain/company-name.js";
import {
  type ContractorIdentity,
  type IdentityCandidate,
  matchIdentities,
} from "../domain/identity-match.js";
import { ownerKey } from "../domain/owner-entity.js";
import { ownerLocality, ownershipYears } from "../domain/owner-signals.js";
import { permitLifecycle } from "../domain/permit-lifecycle.js";
import { estimateRoofAge } from "../domain/roof-age.js";
import { classifyRoofWork } from "../domain/roof-work.js";
import { streetAddressKey } from "../domain/street-address.js";
import type {
  BuildInputs,
  BusinessAddressKey,
  ClassifiedPermit,
  ContractorKey,
  ContractorLicense,
  LeadWarehouse,
  LicenseMatch,
  OwnerSignals,
  PropertyRoofAge,
  RegistryMatch,
  TableSummary,
} from "./lead-build-ports.js";

type NamedContractorKey = ContractorKey & { company: boolean };

export interface BuildOptions {
  buildId: string;
  asOf: string;
  inputs: BuildInputs;
  outputDir: string;
  previousDir: string | undefined;
}

export interface BuildResult {
  buildId: string;
  asOf: string;
  inputs: BuildInputs;
  sourceRows: Record<string, number>;
  roofWork: Record<string, number>;
  roofAgeConfidence: Record<string, number>;
  ownerLocality: Record<string, number>;
  bbbMatches: Record<string, number>;
  registryMatches: Record<string, number>;
  licenseMatches: Record<string, number>;
  tables: TableSummary[];
}

export async function buildLeadTables(
  warehouse: LeadWarehouse,
  { buildId, asOf, inputs, outputDir, previousDir }: BuildOptions,
): Promise<BuildResult> {
  const sourceRows = await warehouse.load(inputs);

  const classified: ClassifiedPermit[] = (await warehouse.permitCandidates()).map((candidate) => {
    const { work, basis } = classifyRoofWork(candidate);
    return {
      permitNumber: candidate.permitNumber,
      roofWork: work,
      roofWorkBasis: basis,
      ...permitLifecycle(candidate, asOf),
    };
  });
  await warehouse.saveClassifiedPermits(classified);

  const roofAges: PropertyRoofAge[] = (await warehouse.roofEvidence()).flatMap((evidence) => {
    const estimate = estimateRoofAge({
      asOf,
      yearBuilt: evidence.yearBuilt,
      permits: evidence.permits,
    });
    return estimate ? [{ propId: evidence.propId, ...estimate }] : [];
  });
  await warehouse.saveRoofAges(roofAges);

  const owners: OwnerSignals[] = (await warehouse.ownerFacts()).map((facts) => ({
    propId: facts.propId,
    locality: ownerLocality(facts.mailing),
    ownershipYears: ownershipYears(facts.deedDate, asOf),
    ownerKey: ownerKey({
      name: facts.name,
      mailingLine: facts.mailing.line,
      mailingZip: facts.mailing.zip,
    }),
  }));
  await warehouse.saveOwnerSignals(owners);

  const contractorKeys: NamedContractorKey[] = (await warehouse.contractorNames()).flatMap(
    ({ name, phone, company }) => {
      const key = companyKey(name);
      return key ? [{ name, phone, company, contractorKey: key, phoneKey: phoneKey(phone) }] : [];
    },
  );
  await warehouse.saveContractorKeys(contractorKeys.map(({ company, ...key }) => key));
  const contractors = contractorIdentities(contractorKeys);

  const bbbMatches = matchContractorsToBbb(contractors, await warehouse.bbbProfiles());
  await warehouse.saveBbbMatches(bbbMatches);

  const registryMatches: RegistryMatch[] = matchIdentities(
    contractors,
    await registryCandidates(warehouse, new Set(contractors.map((c) => c.contractorKey))),
  ).map(({ candidateId, ...match }) => ({ ...match, taxpayerNumber: candidateId }));
  await warehouse.saveRegistryMatches(registryMatches);

  const licenseMatches = matchLicenses(contractors, await warehouse.contractorLicenses());
  await warehouse.saveLicenseMatches(licenseMatches);

  const businessAddressKeys: BusinessAddressKey[] = (await warehouse.businessAddresses()).flatMap(
    ({ businessId, address }) => {
      const addressKey = streetAddressKey(address);
      return addressKey ? [{ businessId, addressKey }] : [];
    },
  );
  await warehouse.saveBusinessAddressKeys(businessAddressKeys);

  const tables = await warehouse.exportTables(outputDir, previousDir);

  return {
    buildId,
    asOf,
    inputs,
    sourceRows,
    roofWork: countBy(classified, (permit) => permit.roofWork),
    roofAgeConfidence: countBy(roofAges, (roofAge) => roofAge.confidence),
    ownerLocality: countBy(owners, (owner) => owner.locality),
    bbbMatches: countBy(bbbMatches, (match) => match.method),
    registryMatches: countBy(registryMatches, (match) => match.method),
    licenseMatches: countBy(licenseMatches, (match) => match.method),
    tables,
  };
}

function contractorIdentities(keys: readonly NamedContractorKey[]): ContractorIdentity[] {
  const identities = new Map<string, { phones: Set<string>; company: boolean }>();
  for (const { contractorKey, phoneKey: phone, company } of keys) {
    const known = identities.get(contractorKey) ?? { phones: new Set<string>(), company: false };
    if (phone) known.phones.add(phone);
    known.company ||= company;
    identities.set(contractorKey, known);
  }
  return [...identities].map(([contractorKey, { phones, company }]) => ({
    contractorKey,
    phoneKeys: [...phones],
    namedAsPerson: !company,
  }));
}

async function registryCandidates(
  warehouse: LeadWarehouse,
  contractorKeys: ReadonlySet<string>,
): Promise<IdentityCandidate[]> {
  const candidates: IdentityCandidate[] = [];
  for await (const taxpayers of warehouse.registryTaxpayers()) {
    for (const { taxpayerNumber, names, zips, inTravisCounty } of taxpayers) {
      const nameKeys = names.flatMap((name) => companyKey(name) ?? []);
      if (!nameKeys.some((key) => contractorKeys.has(key))) continue;
      candidates.push({
        id: taxpayerNumber,
        nameKeys,
        phoneKeys: [],
        local: inTravisCounty || zips.some(isAustinMetroZip),
      });
    }
  }
  return candidates;
}

function matchLicenses(
  contractors: readonly ContractorIdentity[],
  licenses: readonly ContractorLicense[],
): LicenseMatch[] {
  const businesses = new Map<string, ContractorLicense[]>();
  for (const license of licenses) {
    const business = companyKey(license.businessName) ?? licenseId(license);
    businesses.set(business, [...(businesses.get(business) ?? []), license]);
  }
  const candidates: IdentityCandidate[] = [...businesses].map(([id, held]) => ({
    id,
    nameKeys: held.flatMap((license) => companyKey(license.businessName) ?? []),
    phoneKeys: held.flatMap((license) => license.phones.flatMap((phone) => phoneKey(phone) ?? [])),
    local: true,
  }));
  return matchIdentities(contractors, candidates).flatMap(({ candidateId, ...match }) =>
    (businesses.get(candidateId) ?? []).map(({ licenseType, licenseNumber }) => ({
      ...match,
      licenseType,
      licenseNumber,
    })),
  );
}

function licenseId({ licenseType, licenseNumber }: ContractorLicense): string {
  return `${licenseType}#${licenseNumber}`;
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
