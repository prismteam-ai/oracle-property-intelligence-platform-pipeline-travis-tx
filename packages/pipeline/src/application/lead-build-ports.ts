import type { BbbMatch } from "../domain/bbb-match.js";
import type { BbbProfile } from "../domain/bbb-profile.js";
import type { IdentityMatch } from "../domain/identity-match.js";
import type { MailingAddress, OwnerLocality } from "../domain/owner-signals.js";
import type { PermitDates, PermitLifecycle } from "../domain/permit-lifecycle.js";
import type { RoofAgeEstimate, RoofPermitEvidence } from "../domain/roof-age.js";
import type { PermitFacts, RoofWork } from "../domain/roof-work.js";

export interface BuildInputs {
  permitPages: string;
  appraisalTablesDir: string;
  parcelPages: string;
  addressPointPages?: string;
  bbbProfiles?: string;
  salesTaxPages?: string;
  franchisePages?: string;
  licensePages?: string;
  hailPages?: string;
}

export interface PermitCandidate extends PermitFacts, PermitDates {
  permitNumber: string;
  completedDate: string | undefined;
}

export interface ClassifiedPermit extends PermitLifecycle {
  permitNumber: string;
  roofWork: RoofWork;
  roofWorkBasis: string;
}

export interface PropertyRoofEvidence {
  propId: number;
  yearBuilt: number | undefined;
  permits: RoofPermitEvidence[];
}

export interface PropertyRoofAge extends RoofAgeEstimate {
  propId: number;
}

export interface OwnerFacts {
  propId: number;
  name: string | undefined;
  mailing: MailingAddress & { line: string | undefined };
  deedDate: string | undefined;
}

export interface OwnerSignals {
  propId: number;
  locality: OwnerLocality;
  ownershipYears: number | undefined;
  ownerKey: string | undefined;
}

export interface ContractorName {
  name: string | undefined;
  phone: string | undefined;
  company: boolean;
}

export interface ContractorKey {
  name: string | undefined;
  phone: string | undefined;
  contractorKey: string;
  phoneKey: string | undefined;
}

export interface RegistryTaxpayer {
  taxpayerNumber: string;
  names: string[];
  zips: string[];
  inTravisCounty: boolean;
}

export type RegistryMatch = Omit<IdentityMatch, "candidateId"> & { taxpayerNumber: string };

export interface ContractorLicense {
  licenseType: string;
  licenseNumber: string;
  businessName: string | undefined;
  phones: string[];
}

export type LicenseMatch = Omit<IdentityMatch, "candidateId"> &
  Pick<ContractorLicense, "licenseType" | "licenseNumber">;

export interface BusinessAddress {
  businessId: string;
  address: string | undefined;
}

export interface BusinessAddressKey {
  businessId: string;
  addressKey: string;
}

export interface TableSummary {
  table: string;
  rows: number;
  added: number;
  changed: number;
  removed: number;
}

export interface LeadWarehouse {
  load(inputs: BuildInputs): Promise<Record<string, number>>;
  permitCandidates(): Promise<PermitCandidate[]>;
  saveClassifiedPermits(rows: readonly ClassifiedPermit[]): Promise<void>;
  roofEvidence(): Promise<PropertyRoofEvidence[]>;
  saveRoofAges(rows: readonly PropertyRoofAge[]): Promise<void>;
  ownerFacts(): Promise<OwnerFacts[]>;
  saveOwnerSignals(rows: readonly OwnerSignals[]): Promise<void>;
  contractorNames(): Promise<ContractorName[]>;
  saveContractorKeys(rows: readonly ContractorKey[]): Promise<void>;
  bbbProfiles(): Promise<BbbProfile[]>;
  saveBbbMatches(rows: readonly BbbMatch[]): Promise<void>;
  registryTaxpayers(): AsyncIterable<RegistryTaxpayer[]>;
  saveRegistryMatches(rows: readonly RegistryMatch[]): Promise<void>;
  contractorLicenses(): Promise<ContractorLicense[]>;
  saveLicenseMatches(rows: readonly LicenseMatch[]): Promise<void>;
  businessAddresses(): Promise<BusinessAddress[]>;
  saveBusinessAddressKeys(rows: readonly BusinessAddressKey[]): Promise<void>;
  exportTables(outputDir: string, previousDir: string | undefined): Promise<TableSummary[]>;
}
