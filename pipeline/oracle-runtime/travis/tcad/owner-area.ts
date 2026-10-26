// A-04 T023 (AC-3, FR-003, D-6): where the owner lives, from the mailing ZIP, through the
// versioned gazetteer travis-places@1.0.0 (`ownerArea`, stamped with GAZETTEER_SHA256 on every
// row; no new list, oracle disagreement #14). Query DB only: public v1 keeps
// owner_area_class = unknown / not_in_export (disagreement #4).
//   non-US addrCountry or addrInternational → out_of_area, evidence foreign_mailing
//   Travis ZCTA → in_county · regional-county ZCTA → regional · other US ZCTA → out_of_area
//   no ZIP → unknown / no_zip · not a ZCTA → unknown / zip_not_zcta · redacted owner → unknown
import { ownerArea } from "../../../../packages/query-core/gazetteer/travis-places@1.0.0/index.js";
import { GAZETTEER_SHA256 } from "../../../../packages/query-core/src/sql.generated.js";

export type OwnerAreaClass = "in_county" | "regional" | "out_of_area" | "unknown";
export type OwnerAreaEvidence =
  | "travis_zcta"
  | "regional_zcta"
  | "us_zcta_outside"
  | "foreign_mailing"
  | "no_zip"
  | "zip_not_zcta";

export interface OwnerAreaFields {
  owner_area_class: OwnerAreaClass;
  owner_is_out_of_area: boolean | null;
  owner_area_evidence: OwnerAreaEvidence | null;
  area_list_sha256: string;
}

export interface MailingInput {
  /** Owner fields were redacted (D-7): nothing is read from the mailing columns. */
  redacted: boolean;
  addrZip: unknown;
  addrCountry: unknown;
  addrInternational: unknown;
}

const US = /^(US|USA|U\.S\.A?\.?|UNITED STATES( OF AMERICA)?)$/i;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** True when the mailing address is abroad by the source's own country / international mark. */
export function isForeignMailing(addrCountry: unknown, addrInternational: unknown): boolean {
  const country = text(addrCountry);
  if (country !== "" && !US.test(country)) return true;
  if (addrInternational === true || addrInternational === 1) return true;
  const intl = text(addrInternational);
  return intl !== "" && intl !== "0" && !/^(N|NO|FALSE)$/i.test(intl);
}

export function ownerAreaOf(input: MailingInput): OwnerAreaFields {
  const base = { area_list_sha256: GAZETTEER_SHA256 };
  if (input.redacted) {
    return {
      owner_area_class: "unknown",
      owner_is_out_of_area: null,
      owner_area_evidence: null,
      ...base,
    };
  }
  if (isForeignMailing(input.addrCountry, input.addrInternational)) {
    return {
      owner_area_class: "out_of_area",
      owner_is_out_of_area: true,
      owner_area_evidence: "foreign_mailing",
      ...base,
    };
  }
  const area = ownerArea(text(input.addrZip));
  switch (area.class) {
    case "in_county":
      return {
        owner_area_class: "in_county",
        owner_is_out_of_area: false,
        owner_area_evidence: "travis_zcta",
        ...base,
      };
    case "regional":
      return {
        owner_area_class: "regional",
        owner_is_out_of_area: true,
        owner_area_evidence: "regional_zcta",
        ...base,
      };
    case "out_of_area":
      return {
        owner_area_class: "out_of_area",
        owner_is_out_of_area: true,
        owner_area_evidence: "us_zcta_outside",
        ...base,
      };
    default:
      return {
        owner_area_class: "unknown",
        owner_is_out_of_area: null,
        owner_area_evidence: area.reason === "no_mailing_address" ? "no_zip" : "zip_not_zcta",
        ...base,
      };
  }
}
