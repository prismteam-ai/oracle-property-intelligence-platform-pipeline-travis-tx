import { isAustinMetroZip } from "./austin-metro.js";
import { isPlausibleDate, wholeYearsBetween } from "./iso-date.js";

export enum OwnerLocality {
  Local = "local",
  Regional = "regional",
  OutOfState = "out_of_state",
  Foreign = "foreign",
  Unknown = "unknown",
}

export interface MailingAddress {
  state: string | undefined;
  zip: string | undefined;
  country: string | undefined;
}

const HOME_STATE = "TX";
const DOMESTIC_COUNTRIES = new Set(["US", "USA"]);

export function ownerLocality({ state, zip, country }: MailingAddress): OwnerLocality {
  const countryCode = country?.trim().toUpperCase();
  if (countryCode && !DOMESTIC_COUNTRIES.has(countryCode)) return OwnerLocality.Foreign;

  const stateCode = state?.trim().toUpperCase();
  if (!stateCode) return OwnerLocality.Unknown;
  if (stateCode !== HOME_STATE) return OwnerLocality.OutOfState;

  return isAustinMetroZip(zip) ? OwnerLocality.Local : OwnerLocality.Regional;
}

export function ownershipYears(deedDate: string | undefined, asOf: string): number | undefined {
  if (!deedDate || !isPlausibleDate(deedDate, asOf)) return undefined;
  return wholeYearsBetween(deedDate, asOf);
}
